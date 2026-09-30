// Agent-voicemail callback repair (2026-09-30) — producer → consumer contract and canonicalization independence.
//
// Production evidence: every agent-mailbox recording callback (`mailbox=agent%3A<uuid>`) failed X-Twilio-Signature
// validation while group callbacks (`mailbox=group`) passed. WHICH canonicalization step differed was never
// measured, so the repair must not depend on it. The new agent query carries only [A-Za-z0-9._-] bytes, so every
// canonical form of it is the same string.
//
// This suite proves that locally, end to end:
//   * the URL comes from the REAL producer (twilio-voice-inbound stages.ts) through the same builder as
//     twilio-voice-inbound/index.ts (pinned below);
//   * it is signed and delivered to the REAL twilio-recording-status handler (bundled, signature validation
//     included), across six canonical query forms in BOTH directions;
//   * the old-defect negative control shows the harness can still represent the historical failure — a
//     callback signed over one colon canonicalization and delivered with another is rejected — while a correctly
//     signed legacy `agent:<uuid>` callback is still stored.
// What it cannot prove is Twilio's own behaviour in production; that is verified by the first natural agent
// voicemail after deployment.
import { createHmac, webcrypto } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StageDeps, handleInitialV2 } from "../../../supabase/functions/twilio-voice-inbound/stages";

const REPO = path.resolve(__dirname, "../../..");
const FN_DIR = "supabase/functions/twilio-recording-status";
const SUPABASE_URL = "https://example.supabase.co";
const AUTH_TOKEN = "twilio-auth-token";
const PLATFORM = "AC" + "a".repeat(32);
const ACCOUNT_B = "AC" + "b".repeat(32);
const REC = "RE" + "d".repeat(32);
const CALL_SID = "CA" + "e".repeat(32);
const AGENT = "33333333-3333-4333-8333-333333333333";
const CALL_ROW = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "44444444-4444-4444-8444-444444444444";
const FN_URL = `${SUPABASE_URL}/functions/v1/twilio-recording-status`;
const PARAMS = {
  RecordingSid: REC, RecordingUrl: "https://api.twilio.com/recordings/RE", RecordingStatus: "completed",
  RecordingDuration: "7", CallSid: CALL_SID, AccountSid: ACCOUNT_B,
};

type Handler = (req: Request) => Promise<Response>;

// ── Canonical query forms (the six B1 forms; the :443 origin variants are excluded — they change the origin,
//    not the query, and would reject group callbacks too). `search` includes its leading "?". ───────────────
const FORMS = ["raw", "colon_decoded", "colon_encoded", "fully_decoded", "form_reencoded", "legacy_reencoded"] as const;
type Form = (typeof FORMS)[number];
const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
function queryForm(search: string, form: Form): string {
  const body = search.startsWith("?") ? search.slice(1) : search;
  switch (form) {
    case "raw": return `?${body}`;
    case "colon_decoded": return `?${body.replace(/%3A/gi, ":")}`;
    case "colon_encoded": return `?${body.replace(/:/g, "%3A")}`;
    case "fully_decoded":
      return `?${body.split("&").map((p) => {
        const eq = p.indexOf("=");
        return eq === -1 ? safeDecode(p) : `${safeDecode(p.slice(0, eq))}=${safeDecode(p.slice(eq + 1))}`;
      }).join("&")}`;
    case "form_reencoded": return `?${new URLSearchParams(body).toString()}`;
    case "legacy_reencoded":
      return `?${[...new URLSearchParams(body).entries()].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`;
  }
}

// ── Producer: the REAL stage machine with the production URL builder ─────────────────────────────────────
// Mirrors twilio-voice-inbound/index.ts `urls.recordingStatus` (pinned by the first test below).
const recordingStatusBuilder = (query: Record<string, string>) => {
  const qs = new URLSearchParams(query).toString();
  return `${FN_URL}${qs ? `?${qs}` : ""}`;
};

function producerDeps(plan: () => { data?: unknown; error?: { message: string } }): StageDeps {
  return {
    rpc: async (name) => (name === "plan_inbound_route" ? { data: plan().data ?? null, error: plan().error ?? null } : { data: { updated: true }, error: null }),
    loadAttempt: async () => null,
    resolveIdentities: async () => [],
    persistRoutedAgents: async () => true,
    loadAgentGreeting: async () => ({ text: null, url: null }),
    urls: {
      stage: (q) => `${SUPABASE_URL}/functions/v1/twilio-voice-inbound?${new URLSearchParams(q).toString()}`,
      recordingStatus: recordingStatusBuilder,
      claimCallbackBase: `${SUPABASE_URL}/functions/v1/inbound-call-claim`,
    },
    settings: { browserRingSeconds: 20, mobileRingSeconds: 20, recordingEnabled: true, greetingText: "Org greeting", greetingUrl: "" },
    log: () => {},
    sleep: async () => {},
  };
}

const attempt = (over: Record<string, unknown>) => ({
  id: ATTEMPT, stage: "owner_voicemail", mode: "owner", owner_agent_id: AGENT, reserved_agent_ids: [],
  browser_ring_timeout_sent: null, mobile_number_dialed: null, voicemail_kind: "agent", voicemail_agent_id: AGENT,
  voicemail_group_ids: [], terminal: false, ...over,
});

/** The search string Twilio will call: the TwiML attribute, XML-unescaped, with the #rc fragment stripped. */
function producedSearch(twiml: string): string {
  const m = /<Record [^>]*recordingStatusCallback="([^"]*)"/.exec(twiml);
  if (!m) throw new Error("no recording callback in TwiML");
  const url = m[1].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").split("#")[0];
  expect(url.startsWith(FN_URL)).toBe(true);
  return url.slice(FN_URL.length);
}

const initial = { callRowId: CALL_ROW, orgId: ORG, parentCallSid: "CA" + "a".repeat(32), fromNumber: "" };
const PRODUCED: Array<[string, string, () => Promise<string>]> = [
  ["agent (owner_voicemail)", `agent:${AGENT}`, async () => (await handleInitialV2(producerDeps(() => ({ data: { created: true, stage: "owner_voicemail", attempt: attempt({}) } })),
    { ...initial, ownerAgentId: AGENT, ownerSource: "contact", groupIds: [] })).twiml],
  ["agent, planner failure (no attempt id)", `agent:${AGENT}`, async () => (await handleInitialV2(producerDeps(() => ({ error: { message: "db down" } })),
    { ...initial, ownerAgentId: AGENT, ownerSource: "contact", groupIds: [] })).twiml],
  ["group (group_voicemail)", "group", async () => (await handleInitialV2(producerDeps(() => ({ data: { created: true, stage: "group_voicemail", attempt: attempt({ stage: "group_voicemail", mode: "group", owner_agent_id: null, voicemail_kind: "group", voicemail_agent_id: null }) } })),
    { ...initial, ownerAgentId: null, ownerSource: null, groupIds: [] })).twiml],
];

// ── Consumer: the REAL twilio-recording-status handler over a minimal store model ───────────────────────
interface Model { rpcs: Array<{ fn: string; args: Record<string, unknown> }>; uploads: string[]; fetches: Array<{ url: string; method?: string }>; stored: Set<string> }
let bundlePath: string;
const nodeRequire = createRequire(__filename);

function bundle(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "trs-contract-"));
  writeFileSync(path.join(dir, "supabase-stub.mjs"), "export const createClient = (...a) => globalThis.__TEST_CREATE_CLIENT__(...a);\nexport default { createClient };\n");
  writeFileSync(path.join(dir, "idempotency.ts"), readFileSync(path.join(REPO, FN_DIR, "idempotency.ts"), "utf8"));
  const idx = readFileSync(path.join(REPO, FN_DIR, "index.ts"), "utf8");
  const patched = idx.replace(/from "https:\/\/esm\.sh\/@supabase\/supabase-js@2";/, 'from "./supabase-stub.mjs";');
  expect(patched).not.toBe(idx); // the ONLY edit is the remote import specifier
  writeFileSync(path.join(dir, "index.ts"), patched);
  const out = path.join(dir, "handler.cjs");
  execFileSync(path.join(REPO, "node_modules/.bin/esbuild"), [path.join(dir, "index.ts"), "--bundle", "--format=cjs", "--platform=node", `--outfile=${out}`], { stdio: "pipe" });
  return out;
}

function client(m: Model) {
  const builder = () => {
    const api: Record<string, unknown> = {
      select: () => api, eq: () => api, is: () => api, update: () => api,
      maybeSingle: async () => ({ data: null, error: null }), // no voicemail row yet: the store pipeline runs
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    };
    return api;
  };
  return {
    from: () => builder(),
    storage: { from: () => ({ upload: async (p: string) => { m.uploads.push(p); return { data: { path: p }, error: null }; }, remove: async () => ({ data: [], error: null }) }) },
    async rpc(fn: string, args: Record<string, unknown>) {
      m.rpcs.push({ fn, args });
      if (fn === "upsert_voicemail_from_recording") {
        m.stored.add(String(args.p_recording_sid));
        return { data: { status: args.p_status, storage_path: args.p_storage_path, provider_account_sid: args.p_account_sid }, error: null };
      }
      if (fn === "converge_inbound_notifications") return { data: { voicemails_owed: 1, voicemails_notified: 1 }, error: null };
      return { data: { updated: true }, error: null };
    },
  };
}

async function consumer(m: Model): Promise<Handler> {
  (globalThis as Record<string, unknown>).__TEST_CREATE_CLIENT__ = () => client(m);
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    m.fetches.push({ url: String(url), method: init?.method });
    return init?.method === "DELETE" ? new Response(null, { status: 204 }) : new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as typeof globalThis.fetch;
  let captured: Handler | undefined;
  const env: Record<string, string> = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: "service-role-key", TWILIO_ACCOUNT_SID: PLATFORM, TWILIO_AUTH_TOKEN: AUTH_TOKEN };
  (globalThis as Record<string, unknown>).Deno = { env: { get: (k: string) => env[k] }, serve: (h: Handler) => { captured = h; } };
  delete nodeRequire.cache[nodeRequire.resolve(bundlePath)];
  nodeRequire(bundlePath);
  if (!captured) throw new Error("handler never registered");
  return captured;
}

/** Twilio's signature over `signedSearch`, delivered on `sentSearch`. */
function callback(signedSearch: string, sentSearch: string): Request {
  let signing = `${FN_URL}${signedSearch}`;
  for (const k of Object.keys(PARAMS).sort()) signing += k + (PARAMS as Record<string, string>)[k];
  const signature = createHmac("sha1", AUTH_TOKEN).update(signing, "utf8").digest("base64");
  return new Request(`${FN_URL}${sentSearch}`, {
    method: "POST", headers: { "x-twilio-signature": signature, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(PARAMS).toString(),
  });
}

async function deliver(signedSearch: string, sentSearch: string) {
  const m: Model = { rpcs: [], uploads: [], fetches: [], stored: new Set() };
  const res = await (await consumer(m))(callback(signedSearch, sentSearch));
  const upsert = m.rpcs.find((r) => r.fn === "upsert_voicemail_from_recording")?.args;
  return { status: res.status, m, upsert };
}

beforeAll(() => {
  if (!(globalThis.crypto as Crypto | undefined)?.subtle) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true, writable: true });
  }
  bundlePath = bundle();
}, 120_000);
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).Deno;
  delete (globalThis as Record<string, unknown>).__TEST_CREATE_CLIENT__;
});

describe("the producer's URL builder is the one mirrored here", () => {
  it("twilio-voice-inbound/index.ts builds the recording-status URL with URLSearchParams on SUPABASE_URL", () => {
    const src = readFileSync(path.join(REPO, "supabase/functions/twilio-voice-inbound/index.ts"), "utf8");
    expect(src).toContain("return `${supabasePublicOrigin()}/functions/v1/twilio-recording-status`;");
    expect(src).toContain("recordingStatus: (query) => {\n        const qs = new URLSearchParams(query).toString();\n        return `${recordingStatusUrl()}${qs ? `?${qs}` : \"\"}`;");
  });
});

describe.each(PRODUCED)("producer → consumer: %s", (_label, expectedMailbox, produce) => {
  it("the produced query is only [A-Za-z0-9._-] bytes and every canonical form of it is identical", async () => {
    const search = producedSearch(await produce());
    expect(search).toMatch(/^\?[A-Za-z0-9._\-=&]+$/);
    expect(search).not.toContain("agent%3A");
    for (const f of FORMS) expect(queryForm(search, f)).toBe(search);
  });

  it.each(FORMS)("signed over the %s form, delivered raw ⇒ stored in the intended mailbox", async (form) => {
    const search = producedSearch(await produce());
    const { status, upsert, m } = await deliver(queryForm(search, form), search);
    expect(status).toBe(200);
    expect(upsert).toMatchObject({ p_mailbox: expectedMailbox, p_call_row_id: CALL_ROW, p_org_id: ORG, p_status: "stored" });
    expect(m.uploads).toHaveLength(1);
  });

  it.each(FORMS)("signed raw, delivered in the %s form ⇒ stored in the intended mailbox", async (form) => {
    const search = producedSearch(await produce());
    const { status, upsert } = await deliver(search, queryForm(search, form));
    expect(status).toBe(200);
    expect(upsert).toMatchObject({ p_mailbox: expectedMailbox, p_status: "stored" });
  });
});

describe("legacy form: compatibility vs the old-defect negative control (two separate requirements)", () => {
  // The URL the pre-repair producer issued for an agent mailbox.
  const LEGACY = `?${new URLSearchParams({ source: "voicemail", mailbox: `agent:${AGENT}`, call_row_id: CALL_ROW, org_id: ORG, attempt_id: ATTEMPT }).toString()}`;

  it("the legacy agent query DOES depend on colon canonicalization (its forms differ)", () => {
    expect(LEGACY).toContain("mailbox=agent%3A");
    expect(queryForm(LEGACY, "colon_decoded")).not.toBe(LEGACY);
    expect(queryForm(LEGACY, "fully_decoded")).not.toBe(LEGACY);
  });

  it("LEGACY COMPATIBILITY: a correctly signed legacy agent:<uuid> callback is still stored for that agent", async () => {
    const { status, upsert } = await deliver(LEGACY, LEGACY);
    expect(status).toBe(200);
    expect(upsert).toMatchObject({ p_mailbox: `agent:${AGENT}`, p_attempt_id: ATTEMPT, p_status: "stored" });
  });

  it.each(["colon_decoded", "fully_decoded"] as const)(
    "OLD-DEFECT NEGATIVE CONTROL: signed over the %s form but delivered with %%3A ⇒ 403, nothing read or written",
    async (form) => {
      const { status, m } = await deliver(queryForm(LEGACY, form), LEGACY);
      expect(status).toBe(403);
      expect(m.rpcs).toEqual([]);
      expect(m.uploads).toEqual([]);
      expect(m.fetches).toEqual([]);
    },
  );
});
