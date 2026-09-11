// D13 tier 0 (implementation_plan.md rev 3 §3.2/§3.4 + safeguard 2) — fail-first tests for the shared
// notification helper used by BOTH twilio-voice-inbound and twilio-voice-status.
//
// Scenario that must hold: offline contact owner A, dialed-number owner B, no browser targets. The SQL
// planner wrote missed_recipient_ids=[A]. Every later writer (the parent status callback included) must
// resolve ONLY through the snapshot: A gets one notification, B never appears, a failed first insert is
// retried, repeated callbacks are idempotent, and a later reassignment of the contact changes nothing.
import { describe, expect, it } from "vitest";
import {
  buildMissedCallNotificationRows,
  hasRecipientSnapshot,
  missedCallLabel,
  resolveMissedCallRecipientsFromDb,
} from "../../../supabase/functions/_shared/notification-recipients";
import {
  convergeSnapshotNotifications,
  insertMissedCallNotifications,
} from "../../../supabase/functions/_shared/notifications";

const A = "aaaaaaaa-0000-0000-0000-0000000000a1";
const B = "aaaaaaaa-0000-0000-0000-0000000000a4";
const C = "aaaaaaaa-0000-0000-0000-0000000000a9";
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";
const ORG = "aaaaaaaa-0000-0000-0000-00000000000a";
const CALL_ID = "cccccccc-0000-0000-0000-000000000001";

type Answer = { data?: unknown; error?: { message: string } | null };

/** A tiny fake client: profile answers keyed by the filter that reached them; RPC calls are recorded. */
function makeDb(opts: {
  activeSnapshot?: string[];
  admins?: string[];
  snapshotError?: string;
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  numberOwner?: string | null;
  contactAgent?: string | null;
}) {
  const tables: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      tables.push(table);
      const calls: Array<{ m: string; args: unknown[] }> = [];
      const answer = (): Answer => {
        if (table === "profiles") {
          if (calls.some((c) => c.m === "eq" && c.args[0] === "role")) return { data: (opts.admins ?? []).map((id) => ({ id })) };
          if (calls.some((c) => c.m === "in" && c.args[0] === "id")) {
            if (opts.snapshotError) return { error: { message: opts.snapshotError } };
            return { data: (opts.activeSnapshot ?? []).map((id) => ({ id })) };
          }
          return { data: { id: (calls.find((c) => c.m === "eq" && c.args[0] === "id")?.args[1] as string) } };
        }
        if (table === "phone_numbers") return { data: opts.numberOwner ? { assigned_to: opts.numberOwner } : null };
        if (table === "leads") return { data: opts.contactAgent ? { assigned_agent_id: opts.contactAgent } : null };
        if (table === "notifications") return { data: null };
        return { data: null };
      };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "not", "limit", "maybeSingle", "upsert"]) {
        builder[m] = (...args: unknown[]) => { calls.push({ m, args }); return builder; };
      }
      builder.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null, ...answer() });
      return builder;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (opts.rpc) return await opts.rpc(name, args);
      return { data: { call_id: args.p_call_row_id, missed_notified: true, voicemails_owed: 0, voicemails_notified: 0 }, error: null };
    },
  };
  return { db, tables, rpcCalls };
}

const snapshotCall = {
  id: CALL_ID,
  contact_id: "llllllll-0000-0000-0000-000000000001",
  contact_type: "lead",
  contact_name: "Alexa Caller",
  contact_phone: "+19995551234",
  organization_id: ORG,
  agent_id: null,
  caller_id_used: "+15550001111",
  routed_agent_ids: [] as string[],
  missed_recipient_ids: [A],
  missed_reason: "forwarded_to_mobile",
  missed_for_agent_id: A,
};

describe("T0.1 — the snapshot outranks every other tier, B never appears", () => {
  it("A/B scenario: contact owner A in the snapshot, number owner B and later contact owner C are never consulted", async () => {
    const { db, tables } = makeDb({ activeSnapshot: [A], numberOwner: B, contactAgent: C, admins: [ADMIN] });
    const res = await resolveMissedCallRecipientsFromDb(db, snapshotCall);
    expect(res.ok).toBe(true);
    expect((res as { recipients: string[]; tier: string }).recipients).toEqual([A]);
    expect((res as { tier: string }).tier).toBe("snapshot");
    expect(tables).not.toContain("phone_numbers");
    expect(tables).not.toContain("leads");
  });

  it("a reassignment after the miss changes nothing — the snapshot is durable, tiers 1–3 are skipped", async () => {
    const { db, tables } = makeDb({ activeSnapshot: [A], contactAgent: C });
    const res = await resolveMissedCallRecipientsFromDb(db, { ...snapshotCall, routed_agent_ids: [C] });
    expect((res as { recipients: string[] }).recipients).toEqual([A]);
    expect(tables.filter((t) => t === "profiles")).toHaveLength(1);
  });

  it("when nobody in the snapshot is Active any more, only Active Admins are notified (never B)", async () => {
    const { db, tables } = makeDb({ activeSnapshot: [], admins: [ADMIN], numberOwner: B });
    const res = await resolveMissedCallRecipientsFromDb(db, snapshotCall);
    expect((res as { recipients: string[]; tier: string }).recipients).toEqual([ADMIN]);
    expect((res as { tier: string }).tier).toBe("managers");
    expect(tables).not.toContain("phone_numbers");
  });

  it("a snapshot validation error fails CLOSED at tier 'snapshot' — never an empty tier, never a blast", async () => {
    const { db } = makeDb({ snapshotError: "boom", admins: [ADMIN] });
    const res = await resolveMissedCallRecipientsFromDb(db, snapshotCall);
    expect(res.ok).toBe(false);
    expect((res as { failedTier: string }).failedTier).toBe("snapshot");
  });

  it("legacy rows (no snapshot) keep tiers 1–4 exactly as before", async () => {
    const { db, tables } = makeDb({ numberOwner: B });
    const res = await resolveMissedCallRecipientsFromDb(db, { ...snapshotCall, missed_recipient_ids: [], missed_reason: null });
    expect((res as { recipients: string[]; tier: string }).recipients).toEqual([B]);
    expect((res as { tier: string }).tier).toBe("number_owner");
    expect(tables).toContain("phone_numbers");
    expect(hasRecipientSnapshot({ missed_recipient_ids: [] })).toBe(false);
    expect(hasRecipientSnapshot({ missed_recipient_ids: null })).toBe(false);
    expect(hasRecipientSnapshot({ missed_recipient_ids: [A] })).toBe(true);
  });
});

describe("T0.2 — both call sites converge snapshot rows through the ONE SQL rule", () => {
  it("insertMissedCallNotifications delegates to converge_inbound_notifications and never resolves tiers in TypeScript", async () => {
    const { db, tables, rpcCalls } = makeDb({ activeSnapshot: [A] });
    const r = await insertMissedCallNotifications(db as never, snapshotCall);
    expect(r.ok).toBe(true);
    expect(rpcCalls).toEqual([{ name: "converge_inbound_notifications", args: { p_call_row_id: CALL_ID } }]);
    expect(tables).toEqual([]);   // no profiles/phone_numbers/leads/notifications access at all
  });

  it("a failed first insert (RPC error) is reported RETRYABLE so the parent status callback answers 503 and the sweep also owns it", async () => {
    const { db } = makeDb({ rpc: async () => ({ data: null, error: { message: "connection reset" } }) });
    const r = await insertMissedCallNotifications(db as never, snapshotCall);
    expect(r).toMatchObject({ ok: false, retryable: true, reason: "converge_rpc_failed" });
  });

  it("an incomplete convergence (no Active recipient yet) is sweep-owned, not webhook-retryable", async () => {
    const { db } = makeDb({ rpc: async () => ({ data: { missed_notified: false }, error: null }) });
    const r = await insertMissedCallNotifications(db as never, snapshotCall);
    expect(r).toMatchObject({ ok: true, retryable: false, reason: "converge_incomplete_sweep_owned" });
  });

  it("repeated callbacks re-run the same idempotent convergence (event_key ON CONFLICT DO NOTHING in SQL)", async () => {
    const { db, rpcCalls } = makeDb({});
    await insertMissedCallNotifications(db as never, snapshotCall);
    await insertMissedCallNotifications(db as never, snapshotCall);
    await convergeSnapshotNotifications(db, snapshotCall);
    expect(rpcCalls.map((c) => c.name)).toEqual(Array(3).fill("converge_inbound_notifications"));
  });

  it("a client without rpc cannot silently fall back to tiers 1–4 for a snapshot row", async () => {
    const { db } = makeDb({ activeSnapshot: [A] });
    const noRpc = { from: db.from } as never;
    const r = await insertMissedCallNotifications(noRpc, snapshotCall);
    expect(r).toMatchObject({ ok: false, retryable: true, reason: "converge_rpc_unavailable" });
  });
});

describe("T0.3 — D13 label parity with private.missed_call_label", () => {
  it("forwarded_to_mobile carries the approved label; legacy rows keep the old body", () => {
    expect(missedCallLabel("forwarded_to_mobile")).toBe("Missed in AgentFlow — forwarded to mobile.");
    expect(missedCallLabel(null)).toBeNull();
    const d13 = buildMissedCallNotificationRows({
      recipients: [A], callId: CALL_ID, organizationId: ORG, contactId: null, contactName: "Alexa Caller",
      contactPhone: "+19995551234", missedReason: "forwarded_to_mobile",
    })[0];
    expect(d13.body).toBe("Missed in AgentFlow — forwarded to mobile. Alexa Caller (+19995551234)");
    expect(d13.metadata.reason).toBe("forwarded_to_mobile");
    expect(d13.event_key).toBe(`missed_call:${CALL_ID}`);
    const legacy = buildMissedCallNotificationRows({
      recipients: [A], callId: CALL_ID, organizationId: ORG, contactId: null, contactName: "Alexa Caller", contactPhone: "+19995551234",
    })[0];
    expect(legacy.body).toBe("Missed call from Alexa Caller (+19995551234)");
    expect(legacy.metadata).not.toHaveProperty("reason");
  });
});
