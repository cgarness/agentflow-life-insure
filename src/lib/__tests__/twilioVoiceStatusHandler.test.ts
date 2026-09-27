// Recent-outbound callback routing (implementation_plan.md rev 4 §A3/§A6/§A9) — the REAL twilio-voice-status
// handler, executed with its Dial-evidence capture and, as the control, the same source with exactly the
// capture lines removed (which must reproduce the v42 baseline byte-for-byte). Every request runs through
// both builds against identical modelled state: HTTP status, body, the calls table, every calls write, every
// other RPC and every non-capture fetch must be identical — the capture is best-effort and invisible to the
// webhook (AGENT_RULES #30 rev 7(c) guarantees unchanged). The bundle is built from the package closure the
// deployment packager lists (scripts/edge_payload.mjs), so a module missing from the deploy fails here.
import { createHmac, webcrypto } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const REPO = path.resolve(__dirname, "../../..");
const FN = "twilio-voice-status";
const FN_DIR = `supabase/functions/${FN}`;
/** main @ 5d37e5f — the twilio-voice-status source deployed as v42 (plan §A1: repo == production). */
const V42_COMMIT = "5d37e5f";
const SUPABASE_URL = "https://example.supabase.co";
const AUTH_TOKEN = "twilio-auth-token";
const ACCOUNT = "AC" + "a".repeat(32);
const OTHER_ACCOUNT = "AC" + "b".repeat(32);
const PARENT = "CA" + "1".repeat(32);
const CHILD = "CA" + "2".repeat(32);
const INBOUND_PARENT = "CA" + "4".repeat(32);
const INBOUND_CHILD = "CA" + "5".repeat(32);
const IDENTITY = "agent_7f3c9e";
const AGENT = "aaaaaaaa-0000-4000-8000-0000000000a1";
const ORG = "22222222-2222-4222-8222-222222222222";
const OUT_ROW = "11111111-1111-4111-8111-111111111111";
const IN_ROW = "33333333-3333-4333-8333-333333333333";
const DIALED = "+15551234567";
const DID = "+15557654321";
const CALLER = "+15550001111";
const NOW = new Date("2026-09-27T12:00:00.000Z");
const TAG = "[twilio-voice-status] dial-evidence";

const EXPECTED_CLOSURE = [
  "functions/_shared/notification-recipients.ts",
  "functions/_shared/notifications.ts",
  "functions/_shared/twilioOutboundCreds.ts",
  "functions/twilio-voice-status/dial-evidence.ts",
  "functions/twilio-voice-status/duration.ts",
  "functions/twilio-voice-status/index.ts",
  "functions/twilio-voice-status/terminal-guard.ts",
];

type Handler = (req: Request) => Promise<Response>;
type Build = "head" | "control";

interface CallRow {
  id: string;
  twilio_call_sid: string;
  direction: "outbound" | "inbound";
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration: number | null;
  is_missed: boolean | null;
  organization_id: string | null;
  agent_id: string | null;
  contact_id: string | null;
  contact_type: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  caller_id_used: string | null;
  routed_agent_ids: string[] | null;
  missed_for_agent_id: string | null;
  missed_reason: string | null;
  missed_recipient_ids: string[] | null;
  routing_engine: string | null;
  [k: string]: unknown;
}

interface Model {
  calls: CallRow[];
  callWrites: Array<{ patch: Record<string, unknown>; filters: Array<[string, string, unknown]>; landed: number }>;
  rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
  /** private.outbound_dial_evidence, modelled at the RPC boundary (ON CONFLICT DO NOTHING). */
  evidence: Array<Record<string, unknown>>;
  fetches: Array<{ url: string; capture: boolean; auth?: string }>;
  background: Promise<unknown>[];
  /** Twilio call records served by the REST double, by SID. */
  twilio: Record<string, Record<string, unknown>>;
  env: Record<string, string>;
  envThrows: string[];
  selectError: boolean;
  updateError: boolean;
  captureFetch: "serve" | "hang" | "throw";
  evidenceRpc: "model" | "throw" | "hang" | "error";
  edgeRuntime: "present" | "absent" | "throws";
  unexpected: string[];
}

const outboundRow = (over: Partial<CallRow> = {}): CallRow => ({
  id: OUT_ROW, twilio_call_sid: PARENT, direction: "outbound", status: "connected",
  started_at: "2026-09-27T11:59:50.000Z", ended_at: null, duration: null, is_missed: false,
  organization_id: ORG, agent_id: AGENT, contact_id: null, contact_type: null, contact_name: null,
  contact_phone: DIALED, caller_id_used: DID, routed_agent_ids: null, missed_for_agent_id: null,
  missed_reason: null, missed_recipient_ids: null, routing_engine: null, ...over,
});

const inboundRow = (over: Partial<CallRow> = {}): CallRow => ({
  id: IN_ROW, twilio_call_sid: INBOUND_PARENT, direction: "inbound", status: "ringing",
  started_at: "2026-09-27T11:59:40.000Z", ended_at: null, duration: null, is_missed: false,
  organization_id: ORG, agent_id: null, contact_id: null, contact_type: null, contact_name: null,
  contact_phone: CALLER, caller_id_used: DID, routed_agent_ids: [AGENT], missed_for_agent_id: AGENT,
  missed_reason: "no_answer", missed_recipient_ids: [AGENT], routing_engine: "v2", ...over,
});

const parentRecord = (over: Record<string, unknown> = {}) => ({
  sid: PARENT, account_sid: ACCOUNT, from: `client:${IDENTITY}`, to: "", status: "completed", ...over,
});
const childRecord = (over: Record<string, unknown> = {}) => ({
  sid: CHILD, account_sid: ACCOUNT, parent_call_sid: PARENT, to: DIALED, from: DID, status: "completed",
  start_time: "Sun, 27 Sep 2026 11:59:52 +0000", stir_verstat: "TN-Validation-Passed-A", ...over,
});

function model(over: Partial<Model> = {}): Model {
  return {
    calls: [outboundRow(), inboundRow()],
    callWrites: [], rpcs: [], evidence: [], fetches: [], background: [],
    twilio: { [PARENT]: parentRecord(), [CHILD]: childRecord() },
    env: {
      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_AUTH_TOKEN: AUTH_TOKEN,
    },
    envThrows: [], selectError: false, updateError: false,
    captureFetch: "serve", evidenceRpc: "model", edgeRuntime: "present", unexpected: [],
    ...over,
  };
}

// ── bundling ──────────────────────────────────────────────────────────────────────────────────────────
const nodeRequire = createRequire(__filename);
const builds: Partial<Record<Build, { bundle: string; inputs: string[] }>> = {};
let closure: string[] = [];
let v42Source: string | null = null;

const IMPORT_LINES =
  'import { loadOutboundTwilioCreds } from "../_shared/twilioOutboundCreds.ts";\n' +
  'import { captureDialEvidence, dialEvidenceTrigger, standardDialEvidenceDeps } from "./dial-evidence.ts";\n';

/** Removes exactly the lines the capture added to index.ts (2 imports, the hand-off helper, the start block). */
function withoutCapture(src: string): string {
  expect(src.split(IMPORT_LINES)).toHaveLength(2);
  const cut = (startMarker: string, endMarker: string, nonEmptyLines: number, mustContain: string) => {
    const start = src.indexOf(startMarker);
    const end = src.indexOf(endMarker, start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const removed = src.slice(start, end + endMarker.length);
    expect(removed.split("\n").filter(Boolean)).toHaveLength(nonEmptyLines);
    expect(removed).toContain(mustContain);
    return removed;
  };
  const helper = cut("/**\n * Recent-outbound routing (rev 4 §A3)", "\n}\n\n", 15, "function keepDialEvidenceAlive(");
  const start = cut("    // Recent-outbound routing (rev 4 §A3)", "      })());\n    }\n\n", 15, "captureDialEvidence(");
  const out = src.replace(IMPORT_LINES, "").replace(helper, "").replace(start, "");
  for (const gone of ["dial-evidence", "DialEvidence", "twilioOutboundCreds", "loadOutboundTwilioCreds", "waitUntil"]) {
    expect(out).not.toContain(gone);
  }
  expect(src.split("\n").length - out.split("\n").length).toBe(34);
  return out;
}

function bundle(files: Record<string, string>, tag: string): { bundle: string; inputs: string[] } {
  const dir = mkdtempSync(path.join(tmpdir(), `tvs-${tag}-`));
  for (const [name, src] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), src);
  }
  const fnDir = path.join(dir, "functions", FN);
  writeFileSync(
    path.join(fnDir, "supabase-stub.mjs"),
    "export const createClient = (...a) => globalThis.__TEST_CREATE_CLIENT__(...a);\nexport default { createClient };\n",
  );
  const index = files[`functions/${FN}/index.ts`];
  const patched = index.replace(/from "https:\/\/esm\.sh\/@supabase\/supabase-js@2";/, 'from "./supabase-stub.mjs";');
  // the ONLY edit is the remote import specifier
  expect(index.split("\n").filter((l, i) => l !== patched.split("\n")[i])).toHaveLength(1);
  writeFileSync(path.join(fnDir, "index.ts"), patched);
  const out = path.join(dir, "handler.cjs");
  const meta = path.join(dir, "meta.json");
  execFileSync(
    path.join(REPO, "node_modules/.bin/esbuild"),
    [path.join(fnDir, "index.ts"), "--bundle", "--format=cjs", "--platform=node", `--outfile=${out}`, `--metafile=${meta}`],
    { stdio: "pipe" },
  );
  const inputs = Object.keys(JSON.parse(readFileSync(meta, "utf8")).inputs as Record<string, unknown>)
    .map((p) => path.relative(dir, path.resolve(REPO, p)).split(path.sep).join("/"))
    .filter((p) => !p.startsWith(".."))
    .sort();
  return { bundle: out, inputs };
}

beforeAll(() => {
  closure = execFileSync("node", ["scripts/edge_payload.mjs", "closure", FN_DIR], { cwd: REPO, encoding: "utf8" })
    .split("\n").filter(Boolean);
  const head = Object.fromEntries(closure.map((n) => [n, readFileSync(path.join(REPO, "supabase", n), "utf8")]));
  builds.head = bundle(head, "head");
  const control: Record<string, string> = { ...head, [`functions/${FN}/index.ts`]: withoutCapture(head[`functions/${FN}/index.ts`]) };
  delete control[`functions/${FN}/dial-evidence.ts`];
  delete control["functions/_shared/twilioOutboundCreds.ts"];
  builds.control = bundle(control, "control");
  try {
    v42Source = execFileSync("git", ["show", `${V42_COMMIT}:${FN_DIR}/index.ts`], { cwd: REPO, encoding: "utf8", stdio: "pipe" });
  } catch {
    v42Source = null; // shallow clone: the byte-for-byte baseline probe is skipped
  }
  // The handler signs with crypto.subtle; jsdom's `crypto` may lack it (see voicemailOwnershipRecovery.test.ts).
  if (!(globalThis.crypto as Crypto | undefined)?.subtle) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true, writable: true });
  }
}, 120_000);

// ── the modelled platform ─────────────────────────────────────────────────────────────────────────────
function makeClient(m: Model) {
  function builder(table: string) {
    if (table !== "calls") m.unexpected.push(`from:${table}`);
    const filters: Array<[string, string, unknown]> = [];
    let mode: "select" | "update" = "select";
    let patch: Record<string, unknown> = {};
    const matches = (r: CallRow) => filters.every(([, col, val]) => r[col] === val);
    const api: Record<string, unknown> = {
      select: () => api,
      update: (p: Record<string, unknown>) => { mode = "update"; patch = p; return api; },
      eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return api; },
      is: (c: string, v: unknown) => { filters.push(["is", c, v]); return api; },
      maybeSingle: async () => {
        if (m.selectError) return { data: null, error: { message: "connection refused" } };
        const rows = m.calls.filter(matches);
        return { data: rows[0] ? { ...rows[0] } : null, error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        if (mode !== "update") { resolve({ data: m.calls.filter(matches).map((r) => ({ ...r })), error: null }); return; }
        if (m.updateError) { resolve({ data: null, error: { message: "could not serialize access" } }); return; }
        const hit = m.calls.filter(matches);
        for (const r of hit) Object.assign(r, patch);
        m.callWrites.push({ patch: { ...patch }, filters: [...filters], landed: hit.length });
        resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
      },
    };
    return api;
  }

  const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  return {
    from: (t: string) => builder(t),
    rpc(fn: string, args: Record<string, unknown>) {
      m.rpcs.push({ fn, args });
      if (fn === "converge_inbound_notifications") {
        return Promise.resolve({ data: { missed_notified: true, voicemails_owed: 0, voicemails_notified: 0 }, error: null });
      }
      if (fn !== "record_outbound_dial_evidence") {
        m.unexpected.push(`rpc:${fn}`);
        return Promise.resolve({ data: null, error: null });
      }
      if (m.evidenceRpc === "throw") throw new Error("connection reset");
      if (m.evidenceRpc === "hang") return new Promise(() => {});
      if (m.evidenceRpc === "error") return Promise.resolve({ data: null, error: { message: "permission denied" } });
      // The database re-checks live in supabase/tests/inbound_recent_outbound.sql; this models the boundary.
      const rows = m.calls.filter((c) => c.twilio_call_sid === args.p_parent_call_sid && c.direction === "outbound");
      const verdict = (recorded: boolean, category: string, reason: string, outcome: string | null) =>
        Promise.resolve({ data: { recorded, category, reason, outcome, dialed_context: outcome ? "unsaved" : null }, error: null });
      if (rows.length !== 1) return verdict(false, "unverified", "call_row_not_found", null);
      const outcome = args.p_child_status === "completed" ? "answered" : "unanswered";
      if (m.evidence.some((e) => e.dial_call_sid === args.p_dial_call_sid)) return verdict(false, "persisted", "duplicate", outcome);
      if (m.evidence.some((e) => e.call_id === rows[0].id)) return verdict(false, "unverified", "call_already_evidenced", null);
      m.evidence.push({
        dial_call_sid: args.p_dial_call_sid, call_id: rows[0].id, outcome,
        dialed_to_digits: digits(args.p_child_to), caller_id_digits: digits(args.p_child_from),
        provider_started_at: args.p_child_start_time,
      });
      return verdict(true, "persisted", "recorded", outcome);
    },
  };
}

function installPlatform(m: Model, build: Build): Handler {
  (globalThis as Record<string, unknown>).__TEST_CREATE_CLIENT__ = () => makeClient(m);
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    const u = String(url);
    const capture = Boolean(init?.signal); // only the capture passes an AbortSignal (STIR/SHAKEN does not)
    const auth = capture ? String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "") : undefined;
    m.fetches.push(capture ? { url: u, capture, auth } : { url: u, capture });
    if (capture && m.captureFetch === "throw") throw new Error("socket hang up");
    if (capture && m.captureFetch === "hang") return new Promise<Response>(() => {});
    const hit = u.match(/\/Accounts\/(AC[0-9a-fA-F]{32})\/Calls\/(CA[0-9a-fA-F]{32})\.json$/);
    const rec = hit ? m.twilio[hit[2]] : undefined;
    if (!rec || rec.account_sid !== hit?.[1]) return Promise.resolve(new Response('{"code":20404}', { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(rec), { status: 200 }));
  }) as typeof globalThis.fetch;
  if (m.edgeRuntime === "absent") delete (globalThis as Record<string, unknown>).EdgeRuntime;
  else {
    (globalThis as Record<string, unknown>).EdgeRuntime = {
      waitUntil: (p: Promise<unknown>) => {
        if (m.edgeRuntime === "throws") throw new Error("waitUntil unavailable");
        m.background.push(p);
      },
    };
  }
  let captured: Handler | undefined;
  (globalThis as Record<string, unknown>).Deno = {
    env: {
      get: (k: string) => {
        if (m.envThrows.includes(k)) throw new Error(`env access denied: ${k}`);
        return m.env[k];
      },
    },
    serve: (h: Handler) => { captured = h; },
  };
  const target = builds[build]!.bundle;
  delete nodeRequire.cache[nodeRequire.resolve(target)];
  nodeRequire(target);
  if (!captured) throw new Error("handler never registered");
  return captured;
}

function signedRequest(params: Record<string, string>, token = AUTH_TOKEN): Request {
  const url = `${SUPABASE_URL}/functions/v1/${FN}`;
  let signing = url;
  for (const k of Object.keys(params).sort()) signing += k + params[k];
  const signature = createHmac("sha1", token).update(signing, "utf8").digest("base64");
  return new Request(url, {
    method: "POST",
    headers: { "x-twilio-signature": signature, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

const dialAction = (dialCallStatus: string, over: Record<string, string> = {}) => ({
  AccountSid: ACCOUNT, ApiVersion: "2010-04-01", CallSid: PARENT, CallStatus: "in-progress", Direction: "inbound",
  DialCallSid: CHILD, DialCallStatus: dialCallStatus, DialCallDuration: dialCallStatus === "completed" ? "42" : "0",
  From: `client:${IDENTITY}`, To: DIALED, ...over,
});
const parentStatusCallback = () => ({
  AccountSid: ACCOUNT, CallSid: PARENT, CallStatus: "completed", CallDuration: "45", Direction: "inbound",
  From: `client:${IDENTITY}`, To: DIALED,
});
const inboundDialAction = () => ({
  AccountSid: ACCOUNT, CallSid: INBOUND_PARENT, CallStatus: "in-progress", Direction: "inbound",
  DialCallSid: INBOUND_CHILD, DialCallStatus: "no-answer", DialCallDuration: "0", From: CALLER, To: DID,
});

let logSpy: ReturnType<typeof vi.spyOn>;
const evidenceLines = () =>
  (logSpy.mock.calls as unknown[][]).filter((c) => c[0] === TAG).map((c) => c[1] as Record<string, unknown>);

interface RunResult {
  model: Model;
  status: number;
  body: string;
  contentType: string | null;
  lines: Array<Record<string, unknown>>;
  /** The webhook-owned state right after this request (and its background work) finished. */
  state: {
    calls: CallRow[];
    callWrites: Model["callWrites"];
    rpcs: Model["rpcs"];
    webhookFetches: Model["fetches"];
    unexpected: string[];
  };
}

/**
 * Delivers the requests in order to one build over one model and lets each request's background work settle
 * before the next. `untracked`: the capture was not handed to waitUntil (runtime absent/throwing), so wait for
 * its RPC instead — otherwise it could still be running when the next build reinstalls the platform globals.
 */
async function run(build: Build, m: Model, requests: Array<() => Request>, untracked = false): Promise<RunResult[]> {
  const out: RunResult[] = [];
  for (const req of requests) {
    vi.setSystemTime(NOW); // every delivery happens at the same instant in both builds
    logSpy.mockClear();
    const handler = installPlatform(m, build);
    const before = m.background.length;
    const res = await handler(req());
    const body = await res.text();
    await Promise.all(m.background.slice(before));
    if (untracked && build === "head") {
      await vi.waitFor(() => expect(evidenceLines()).toHaveLength(1));
    }
    out.push({
      model: m, status: res.status, body, contentType: res.headers.get("Content-Type"), lines: evidenceLines(),
      state: structuredClone({
        calls: m.calls,
        callWrites: m.callWrites,
        rpcs: m.rpcs.filter((x) => x.fn !== "record_outbound_dial_evidence"),
        webhookFetches: m.fetches.filter((f) => !f.capture),
        unexpected: m.unexpected,
      }),
    });
  }
  return out;
}

/** Everything the webhook itself is responsible for — must be identical with and without the capture. */
function observable(r: RunResult) {
  return { status: r.status, body: r.body, contentType: r.contentType, ...r.state };
}

async function both(setup: () => Model, requests: Array<() => Request>, untracked = false) {
  const head = await run("head", setup(), requests, untracked);
  const control = await run("control", setup(), requests);
  expect(head.map(observable)).toEqual(control.map(observable));
  for (const c of control) {
    expect(c.lines).toHaveLength(0);
    expect(c.model.background).toHaveLength(0);
    expect(c.model.fetches.filter((f) => f.capture)).toHaveLength(0);
  }
  return { head, control };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const k of ["Deno", "EdgeRuntime", "__TEST_CREATE_CLIENT__"]) delete (globalThis as Record<string, unknown>)[k];
});

// ── the builds themselves ─────────────────────────────────────────────────────────────────────────────
describe("the executed builds", () => {
  it("the head bundle is built from exactly the 7-file deploy closure; the control drops only the two new modules", () => {
    expect(closure).toEqual(EXPECTED_CLOSURE);
    expect(builds.head!.inputs).toEqual([...EXPECTED_CLOSURE, `functions/${FN}/supabase-stub.mjs`].sort());
    expect(builds.control!.inputs).toEqual(
      [...EXPECTED_CLOSURE, `functions/${FN}/supabase-stub.mjs`]
        .filter((n) => !n.endsWith("/dial-evidence.ts") && !n.endsWith("/twilioOutboundCreds.ts"))
        .sort(),
    );
  });

  it("removing exactly the capture lines reproduces the v42 source byte-for-byte", () => {
    if (!v42Source) return;
    const head = readFileSync(path.join(REPO, FN_DIR, "index.ts"), "utf8");
    expect(withoutCapture(head)).toBe(v42Source);
  });
});

// ── equivalence: the capture never changes what the webhook does ──────────────────────────────────────
describe("identical webhook behaviour with and without the capture", () => {
  const cases: Array<[string, () => Model, Array<() => Request>, string | null]> = [
    ["outbound answered Dial action (completed)", () => model(), [() => signedRequest(dialAction("completed"))], "persisted"],
    ["outbound unanswered Dial action (no-answer, child no-answer)",
      () => model({ calls: [outboundRow({ status: "ringing" })], twilio: { [PARENT]: parentRecord(), [CHILD]: childRecord({ status: "no-answer" }) } }),
      [() => signedRequest(dialAction("no-answer"))], "persisted"],
    ["browser-ended ring (no-answer, child canceled)",
      () => model({ calls: [outboundRow({ status: "ringing" })], twilio: { [PARENT]: parentRecord(), [CHILD]: childRecord({ status: "canceled" }) } }),
      [() => signedRequest(dialAction("no-answer"))], "persisted"],
    ["outbound busy Dial action (excluded, no REST)", () => model(), [() => signedRequest(dialAction("busy"))], "excluded"],
    ["ladder-suppressed: the row is already terminal", () => model({ calls: [outboundRow({ status: "completed", ended_at: "2026-09-27T11:59:59.000Z", duration: 50 })] }),
      [() => signedRequest(dialAction("completed"))], "persisted"],
    ["no calls row matches (200 unmatched)", () => model({ calls: [] }), [() => signedRequest(dialAction("completed"))], "unverified"],
    ["calls lookup fails (503)", () => model({ selectError: true }), [() => signedRequest(dialAction("completed"))], "persisted"],
    ["calls update fails (503)", () => model({ updateError: true }), [() => signedRequest(dialAction("no-answer"))], "unverified"],
    ["Twilio has no child record (missing)", () => model({ twilio: { [PARENT]: parentRecord() } }), [() => signedRequest(dialAction("completed"))], "missing"],
    ["parent record from another identity (unverified)", () => model({ twilio: { [PARENT]: parentRecord({ from: "client:other" }), [CHILD]: childRecord() } }),
      [() => signedRequest(dialAction("completed"))], "unverified"],
    ["parent-status callback (no Dial action)", () => model(), [() => signedRequest(parentStatusCallback())], null],
    ["inbound Dial action with a missed v2 convergence", () => model(), [() => signedRequest(inboundDialAction())], null],
    ["non-client caller", () => model(), [() => signedRequest(dialAction("completed", { From: DID }))], null],
    ["bad signature (403)", () => model(), [() => signedRequest(dialAction("completed"), "wrong-token")], null],
  ];

  it.each(cases)("%s", async (_label, setup, requests, category) => {
    const { head } = await both(setup, requests);
    const r = head[0];
    if (category === null) {
      expect(r.model.background).toHaveLength(0);
      expect(r.model.fetches.filter((f) => f.capture)).toHaveLength(0);
      expect(r.model.rpcs.filter((x) => x.fn === "record_outbound_dial_evidence")).toHaveLength(0);
      expect(r.lines).toHaveLength(0);
    } else {
      expect(r.model.background).toHaveLength(1);
      expect(r.lines).toHaveLength(1);
      expect(r.lines[0].category).toBe(category);
    }
  });

  it("the equivalence is not vacuous: the matrix covers 200, 403 and 503 answers and real terminal writes", async () => {
    const statuses = new Set<number>();
    for (const [, setup, requests] of cases) for (const r of await run("control", setup(), requests)) statuses.add(r.status);
    expect([...statuses].sort()).toEqual([200, 403, 503]);
    const [answered] = await run("control", model(), [() => signedRequest(dialAction("completed"))]);
    expect(answered.model.calls[0]).toMatchObject({ status: "completed", duration: 42, shaken_stir: "A", ended_at: NOW.toISOString() });
  });
});

// ── the capture itself, through the real handler ──────────────────────────────────────────────────────
describe("the capture runs once per outbound Dial action, in the background", () => {
  it.each([
    ["completed", "completed", "answered"],
    ["no-answer", "no-answer", "unanswered"],
  ])("signed %s → exactly one waitUntil task, one parent + one child read, one RPC with the child's values", async (signed, child, outcome) => {
    const m = model({ twilio: { [PARENT]: parentRecord(), [CHILD]: childRecord({ status: child }) } });
    const [r] = await run("head", m, [() => signedRequest(dialAction(signed))]);
    expect(m.background).toHaveLength(1);
    expect(m.fetches.filter((f) => f.capture).map((f) => f.url)).toEqual([
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Calls/${PARENT}.json`,
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Calls/${CHILD}.json`,
    ]);
    const evidenceRpcs = m.rpcs.filter((x) => x.fn === "record_outbound_dial_evidence");
    expect(evidenceRpcs).toHaveLength(1);
    expect(evidenceRpcs[0].args).toMatchObject({
      p_signed_account_sid: ACCOUNT, p_credential_account_sid: ACCOUNT, p_parent_call_sid: PARENT, p_dial_call_sid: CHILD,
      p_dial_call_status: signed, p_signed_from: `client:${IDENTITY}`, p_signed_to: DIALED, p_child_to: DIALED,
      p_child_from: DID, p_child_status: child, p_child_start_time: "2026-09-27T11:59:52.000Z",
    });
    expect(m.evidence).toEqual([expect.objectContaining({ dial_call_sid: CHILD, call_id: OUT_ROW, outcome })]);
    expect(r.lines).toEqual([expect.objectContaining({ category: "persisted", reason: "recorded", outcome })]);
  });

  it("the capture authenticates its REST reads with the OUTBOUND (master-first) credential, never the webhook token", async () => {
    const basic = (sid: string, token: string) => `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
    const withMaster = () => model({ env: { ...model().env, TWILIO_MASTER_ACCOUNT_SID: ACCOUNT, TWILIO_MASTER_AUTH_TOKEN: "master-token" } });
    const { head } = await both(withMaster, [() => signedRequest(dialAction("completed"))]);
    const reads = head[0].model.fetches.filter((f) => f.capture);
    expect(reads).toHaveLength(2);
    for (const f of reads) expect(f.auth).toBe(basic(ACCOUNT, "master-token"));
    expect(head[0].lines).toEqual([expect.objectContaining({ category: "persisted", reason: "recorded" })]);

    const { head: fallback } = await both(() => model(), [() => signedRequest(dialAction("completed"))]);
    for (const f of fallback[0].model.fetches.filter((x) => x.capture)) expect(f.auth).toBe(basic(ACCOUNT, AUTH_TOKEN));
  });

  it("the capture reads with the OUTBOUND credential: a master account other than the signed one is refused before any REST read", async () => {
    const setup = () => model({ env: { ...model().env, TWILIO_MASTER_ACCOUNT_SID: OTHER_ACCOUNT, TWILIO_MASTER_AUTH_TOKEN: "master-token" } });
    const { head } = await both(setup, [() => signedRequest(dialAction("completed"))]);
    expect(head[0].lines).toEqual([expect.objectContaining({ category: "unverified", reason: "account_mismatch" })]);
    expect(head[0].model.fetches.filter((f) => f.capture)).toHaveLength(0);
  });

  it("redelivery of the same Dial action is idempotent at the RPC boundary and answers exactly like the control", async () => {
    const { head } = await both(() => model(), [
      () => signedRequest(dialAction("completed")),
      () => signedRequest(dialAction("completed")),
    ]);
    expect(head.map((r) => r.lines.map((l) => `${l.category}/${l.reason}`))).toEqual([["persisted/recorded"], ["persisted/duplicate"]]);
    expect(head[1].model.evidence).toHaveLength(1);
  });

  it("every log category is produced by its case, and no line carries a number, identity, SID, token or URL", async () => {
    const seen = new Set<string>();
    const lines: Array<Record<string, unknown>> = [];
    for (const [setup, req] of [
      [() => model(), () => signedRequest(dialAction("completed"))],
      [() => model(), () => signedRequest(dialAction("failed"))],
      [() => model({ twilio: { [PARENT]: parentRecord({ from: "client:someone" }), [CHILD]: childRecord() } }), () => signedRequest(dialAction("completed"))],
      [() => model({ twilio: { [CHILD]: childRecord() } }), () => signedRequest(dialAction("completed"))],
      [() => model({ evidenceRpc: "error" }), () => signedRequest(dialAction("completed"))],
    ] as Array<[() => Model, () => Request]>) {
      const [r] = await run("head", setup(), [req]);
      expect(r.lines).toHaveLength(1);
      seen.add(String(r.lines[0].category));
      lines.push(...r.lines);
    }
    expect([...seen].sort()).toEqual(["excluded", "missing", "operational_failure", "persisted", "unverified"]);
    const text = JSON.stringify(lines);
    for (const f of [ACCOUNT, PARENT, CHILD, AUTH_TOKEN, IDENTITY, "client:", "5551234567", "5557654321", "https://", "twilio.com"]) {
      expect(text).not.toContain(f);
    }
  });
});

describe("a failing or hanging capture changes nothing", () => {
  const hangTimers = () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: NOW });
  };

  it("the response resolves before the capture settles (the capture's fetch never settles), then the read bound ends it", async () => {
    hangTimers();
    const m = model({ captureFetch: "hang" });
    const handler = installPlatform(m, "head");
    const res = await handler(signedRequest(dialAction("completed")));
    expect(res.status).toBe(200);
    expect(m.background).toHaveLength(1);
    let settled = false;
    void m.background[0].then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    // the terminal write had already landed while the capture was still waiting on Twilio
    expect(m.calls[0]).toMatchObject({ status: "completed", duration: 42 });
    await vi.advanceTimersByTimeAsync(2 * 2500);
    await m.background[0];
    expect(settled).toBe(true);
    expect(evidenceLines()).toEqual([expect.objectContaining({ category: "operational_failure", reason: "rest_timeout" })]);
    expect(vi.getTimerCount()).toBe(0);

    vi.setSystemTime(NOW);
    const control = model({ captureFetch: "hang" });
    const controlRes = await installPlatform(control, "control")(signedRequest(dialAction("completed")));
    expect(controlRes.status).toBe(res.status);
    expect(control.calls).toEqual(m.calls);
    expect(control.callWrites).toEqual(m.callWrites);
  });

  it("an evidence RPC that never answers is cut by the 8 s bound; the webhook already answered", async () => {
    hangTimers();
    const m = model({ evidenceRpc: "hang" });
    const res = await installPlatform(m, "head")(signedRequest(dialAction("completed")));
    expect(res.status).toBe(200);
    await vi.advanceTimersByTimeAsync(8000);
    await m.background[0];
    expect(evidenceLines()).toEqual([expect.objectContaining({ category: "operational_failure", reason: "bound_exceeded" })]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["the capture's fetch throws synchronously", () => model({ captureFetch: "throw" }), "rest_network"],
    ["the evidence RPC throws", () => model({ evidenceRpc: "throw" }), "rpc_error"],
    ["the evidence RPC returns an error", () => model({ evidenceRpc: "error" }), "rpc_error"],
    ["no outbound credential is configured", () => model({ env: { ...model().env, TWILIO_ACCOUNT_SID: "" } }), "credentials_missing"],
  ])("%s → identical webhook behaviour, one operational_failure line", async (_label, setup, reason) => {
    const { head } = await both(setup, [() => signedRequest(dialAction("completed"))]);
    expect(head[0].lines).toEqual([expect.objectContaining({ category: "operational_failure", reason })]);
  });

  it("a throwing credential load is contained in the background task (no dial-evidence verdict, response unchanged)", async () => {
    const { head } = await both(() => model({ envThrows: ["TWILIO_MASTER_ACCOUNT_SID"] }), [() => signedRequest(dialAction("completed"))]);
    expect(head[0].model.background).toHaveLength(1);
    expect(head[0].lines).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith("[twilio-voice-status] dial-evidence background task failed:", "Error");
  });

  it.each([
    ["throwing", "throws" as const],
    ["absent", "absent" as const],
  ])("EdgeRuntime.waitUntil %s does not change the response; the task still runs, just not kept alive", async (_label, edgeRuntime) => {
    const { head } = await both(() => model({ edgeRuntime }), [() => signedRequest(dialAction("completed"))], true);
    expect(head[0].model.background).toHaveLength(0);
    expect(head[0].lines).toEqual([expect.objectContaining({ category: "persisted", reason: "recorded" })]);
    if (edgeRuntime === "throws") {
      expect(console.warn).toHaveBeenCalledWith("[twilio-voice-status] EdgeRuntime.waitUntil unavailable:", expect.any(Error));
    }
  });
});
