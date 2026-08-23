// Rev 7 C10 — fleet-wide callback reconciliation with mocked Twilio.
// canonicalNumberConfig only reaches numbers that are later purchased or repaired, so the existing
// fleet keeps its bare status callback and would NOT retry C9's 5xx responses. This is the
// deterministic, idempotent, internal-only reconciliation used to close that gap before the status
// writer is deployed: enumerate active voice numbers → configure → READ BACK and verify → report by
// phone-number SID and database row → fail closed on any partial completion.
import { describe, expect, it } from "vitest";
import { canonicalNumberConfig } from "../../../supabase/functions/_shared/twilioNumberConfig";
import {
  reconcileNumberCallbacks,
  type FleetNumberRow,
  type ReconcileTwilioClient,
} from "../../../supabase/functions/repair-twilio-number-ownership/reconcile";

const MASTER = "AC" + "1".repeat(32);
const OTHER_ACCOUNT = "AC" + "9".repeat(32);
const CONFIG = canonicalNumberConfig("https://proj.supabase.co");

const rows: FleetNumberRow[] = [
  { id: "row-1", organization_id: "org-1", phone_number: "+15550000001", twilio_sid: "PN" + "1".repeat(32), status: "active" },
  { id: "row-2", organization_id: "org-1", phone_number: "+15550000002", twilio_sid: "PN" + "2".repeat(32), status: "Active" },
];

function payloadFor(accountSid: string, cfg = CONFIG) {
  return {
    account_sid: accountSid,
    voice_url: cfg.voiceUrl,
    voice_method: cfg.voiceMethod,
    sms_url: cfg.smsUrl,
    sms_method: cfg.smsMethod,
    status_callback: cfg.statusCallback,
    status_callback_method: cfg.statusCallbackMethod,
  };
}

const BARE = {
  account_sid: MASTER,
  voice_url: CONFIG.voiceUrl,
  voice_method: "POST",
  sms_url: CONFIG.smsUrl,
  sms_method: "POST",
  status_callback: "https://proj.supabase.co/functions/v1/twilio-voice-status",
  status_callback_method: "POST",
};

/** Mock Twilio: numbers start bare and become canonical once configured. */
function makeClient(opts: {
  initial?: Record<string, unknown>;
  failConfigureFor?: string[];
  verifyReturnsStale?: string[];
  accountFor?: Record<string, string>;
} = {}): ReconcileTwilioClient & { calls: string[] } {
  const state = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const initialFor = (sid: string) => ({
    ...(opts.initial ?? BARE),
    account_sid: opts.accountFor?.[sid] ?? MASTER,
  });
  return {
    calls,
    lookup: async (accountSid: string, sid: string) => {
      calls.push(`lookup:${sid}`);
      const cur = state.get(sid) ?? initialFor(sid);
      return { ok: true, status: 200, payload: cur };
    },
    configure: async (accountSid: string, sid: string) => {
      calls.push(`configure:${sid}`);
      if (opts.failConfigureFor?.includes(sid)) {
        return { ok: false, status: 500, payload: { code: 20500, message: "boom" } };
      }
      if (opts.verifyReturnsStale?.includes(sid)) {
        state.set(sid, { ...BARE, account_sid: MASTER }); // Twilio "accepted" but did not retain
        return { ok: true, status: 200, payload: state.get(sid) };
      }
      state.set(sid, payloadFor(MASTER));
      return { ok: true, status: 200, payload: state.get(sid) };
    },
  };
}

describe("C10 — complete success", () => {
  it("configures and read-back verifies every number, reporting per SID and row", async () => {
    const client = makeClient();
    const result = await reconcileNumberCallbacks({
      rows, masterAccountSid: MASTER, config: CONFIG, client,
    });
    expect(result.ok).toBe(true);
    expect(result.total).toBe(2);
    expect(result.reconciled).toBe(2);
    expect(result.alreadyCurrent).toBe(0);
    expect(result.failures).toEqual([]);
    expect(result.results.map((r) => [r.phoneNumberSid, r.rowId, r.status])).toEqual([
      [rows[0].twilio_sid, "row-1", "reconciled"],
      [rows[1].twilio_sid, "row-2", "reconciled"],
    ]);
    // every number was verified by a READ BACK after configure
    for (const r of rows) {
      expect(client.calls).toContain(`configure:${r.twilio_sid}`);
      expect(client.calls.filter((c) => c === `lookup:${r.twilio_sid}`).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("the canonical status callback carries the retry override", () => {
    expect(CONFIG.statusCallback.endsWith("#rc=3&rp=5xx,ct,rt")).toBe(true);
  });
});

describe("C10 — partial failure fails closed", () => {
  it("one configure failure makes the whole run not-ok, with the other number still reported", async () => {
    const client = makeClient({ failConfigureFor: [rows[1].twilio_sid] });
    const result = await reconcileNumberCallbacks({
      rows, masterAccountSid: MASTER, config: CONFIG, client,
    });
    expect(result.ok).toBe(false);
    expect(result.reconciled).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      phoneNumberSid: rows[1].twilio_sid, rowId: "row-2", step: "configure",
    });
    // no secret/token leakage in the reported reason
    expect(JSON.stringify(result.failures[0])).not.toMatch(/authorization|basic |token/i);
  });
});

describe("C10 — verification mismatch is a failure, not a success", () => {
  it("a number Twilio accepted but did not retain is reported as verify_mismatch", async () => {
    const client = makeClient({ verifyReturnsStale: [rows[0].twilio_sid] });
    const result = await reconcileNumberCallbacks({
      rows, masterAccountSid: MASTER, config: CONFIG, client,
    });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatchObject({
      phoneNumberSid: rows[0].twilio_sid, step: "verify",
    });
  });
});

describe("C10 — idempotent retry", () => {
  it("a number already carrying the canonical config is skipped without a write", async () => {
    const client = makeClient({ initial: payloadFor(MASTER) });
    const result = await reconcileNumberCallbacks({
      rows, masterAccountSid: MASTER, config: CONFIG, client,
    });
    expect(result.ok).toBe(true);
    expect(result.alreadyCurrent).toBe(2);
    expect(result.reconciled).toBe(0);
    expect(client.calls.filter((c) => c.startsWith("configure:"))).toEqual([]);
  });

  it("re-running after a successful run performs no further writes (same client state)", async () => {
    const client = makeClient();
    const first = await reconcileNumberCallbacks({ rows, masterAccountSid: MASTER, config: CONFIG, client });
    const configureCount = client.calls.filter((c) => c.startsWith("configure:")).length;
    const second = await reconcileNumberCallbacks({ rows, masterAccountSid: MASTER, config: CONFIG, client });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.alreadyCurrent).toBe(2);
    expect(client.calls.filter((c) => c.startsWith("configure:")).length).toBe(configureCount);
  });
});

describe("C10 — cross-account protection", () => {
  it("a number living in a different Twilio account is never configured", async () => {
    const client = makeClient({ accountFor: { [rows[0].twilio_sid]: OTHER_ACCOUNT } });
    const result = await reconcileNumberCallbacks({
      rows, masterAccountSid: MASTER, config: CONFIG, client,
    });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatchObject({
      phoneNumberSid: rows[0].twilio_sid, step: "cross_account",
    });
    expect(client.calls).not.toContain(`configure:${rows[0].twilio_sid}`);
  });

  it("rows without a twilio_sid are reported, never guessed at", async () => {
    const client = makeClient();
    const result = await reconcileNumberCallbacks({
      rows: [{ ...rows[0], twilio_sid: null }],
      masterAccountSid: MASTER, config: CONFIG, client,
    });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatchObject({ rowId: "row-1", step: "missing_sid" });
    expect(client.calls).toEqual([]);
  });
});

describe("C10 — the entry point is internal-only and not browser callable", () => {
  it("bulk reconciliation is gated by the existing internal authorization contract", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const idx = readFileSync(
      resolve(__dirname, "../../../supabase/functions/repair-twilio-number-ownership/index.ts"),
      "utf8",
    );
    expect(idx.includes("reconcileNumberCallbacks")).toBe(true);
    const authIdx = idx.indexOf("isAuthorizedInternalRequest");
    const reconcileIdx = idx.indexOf("reconcileNumberCallbacks");
    expect(authIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(reconcileIdx); // authorization precedes any bulk mutation
  });
});
