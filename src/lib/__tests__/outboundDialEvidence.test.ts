// Recent-outbound callback routing (implementation_plan.md rev 4 §A3) — the Dial-evidence capture in
// twilio-voice-status, exercised with fake dependencies: trigger parsing, every verdict category/reason, the
// REST retry/timeout/re-read bounds, the RPC boundary, the single log line and its vocabulary, and the
// never-rejects / timers-cleared guarantees. The executed-handler proof lives in
// twilioVoiceStatusHandler.test.ts; the database re-checks live in supabase/tests/inbound_recent_outbound.sql.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIAL_EVIDENCE_BOUNDS,
  DIAL_EVIDENCE_LOG_TAG,
  captureDialEvidence,
  dialEvidenceTrigger,
  standardDialEvidenceDeps,
  type DialEvidenceBounds,
  type DialEvidenceDeps,
  type DialEvidenceTrigger,
} from "../../../supabase/functions/twilio-voice-status/dial-evidence";

const ACCOUNT = "AC" + "a".repeat(32);
const OTHER_ACCOUNT = "AC" + "b".repeat(32);
const PARENT = "CA" + "1".repeat(32);
const CHILD = "CA" + "2".repeat(32);
const OTHER_CALL = "CA" + "3".repeat(32);
const TOKEN = "outbound-auth-token-SECRET";
const IDENTITY = "agent_7f3c9e";
const DIALED = "+15551234567";
const CALLER_ID = "+15557654321";
const START_RFC2822 = "Sun, 27 Sep 2026 12:00:00 +0000";
const PARENT_URL = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Calls/${PARENT}.json`;
const CHILD_URL = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Calls/${CHILD}.json`;

/** Small bounds so the timeout paths run in milliseconds. */
const FAST: DialEvidenceBounds = { restTimeoutMs: 20, reReadDelayMs: 5, totalMs: 2_000 };

const SIGNED_PARAMS: Record<string, string> = {
  AccountSid: ACCOUNT,
  CallSid: PARENT,
  DialCallSid: CHILD,
  DialCallStatus: "completed",
  DialCallDuration: "42",
  CallStatus: "in-progress",
  Direction: "inbound",
  From: `client:${IDENTITY}`,
  To: DIALED,
};

function trigger(over: Partial<DialEvidenceTrigger> = {}): DialEvidenceTrigger {
  return {
    accountSid: ACCOUNT,
    parentCallSid: PARENT,
    dialCallSid: CHILD,
    dialCallStatus: "completed",
    signedFrom: `client:${IDENTITY}`,
    signedTo: DIALED,
    ...over,
  };
}

const parentRecord = (over: Record<string, unknown> = {}) => ({
  sid: PARENT, account_sid: ACCOUNT, from: `client:${IDENTITY}`, to: "", status: "completed", ...over,
});
const childRecord = (over: Record<string, unknown> = {}) => ({
  sid: CHILD, account_sid: ACCOUNT, parent_call_sid: PARENT, to: DIALED, from: CALLER_ID,
  status: "completed", start_time: START_RFC2822, ...over,
});

type Reply =
  | { status: number; body?: unknown }
  | "network"
  | "hang" // never settles and ignores its signal
  | "hang-abortable"; // never settles until its signal aborts

interface Harness {
  deps: DialEvidenceDeps;
  fetches: Array<{ url: string; headers: Record<string, string>; signal: AbortSignal }>;
  rpcs: Array<Record<string, unknown>>;
  logs: Array<{ tag: string; fields: Record<string, unknown> }>;
  sleeps: number[];
}

/**
 * Fake dependencies. Each URL serves its replies in order (the last one repeats). The default RPC mirrors the
 * record RPC's persisted answer for the outcome the supplied pair implies.
 */
function harness(opts: {
  parent?: Reply[];
  child?: Reply[];
  credentials?: DialEvidenceDeps["credentials"];
  rpc?: (args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
} = {}): Harness {
  const fetches: Harness["fetches"] = [];
  const rpcs: Harness["rpcs"] = [];
  const logs: Harness["logs"] = [];
  const sleeps: number[] = [];
  const queues: Record<string, Reply[]> = {
    [PARENT_URL]: [...(opts.parent ?? [{ status: 200, body: parentRecord() }])],
    [CHILD_URL]: [...(opts.child ?? [{ status: 200, body: childRecord() }])],
  };
  const deps: DialEvidenceDeps = {
    credentials: opts.credentials === undefined ? { accountSid: ACCOUNT, authToken: TOKEN } : opts.credentials,
    fetchJson: (url, init) => {
      fetches.push({ url, headers: init.headers, signal: init.signal });
      const q = queues[url] ?? [{ status: 404 }];
      const reply = q.length > 1 ? q.shift()! : q[0];
      if (reply === "network") return Promise.reject(new TypeError("fetch failed"));
      if (reply === "hang") return new Promise(() => {});
      if (reply === "hang-abortable") {
        return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      }
      return Promise.resolve({ status: reply.status, body: reply.body ?? null });
    },
    rpc: async (_fn, args) => {
      rpcs.push(args);
      if (opts.rpc) return opts.rpc(args);
      const child = String(args.p_child_status);
      return {
        data: {
          recorded: true, category: "persisted", reason: "recorded",
          outcome: child === "completed" ? "answered" : "unanswered", dialed_context: "unsaved",
        },
        error: null,
      };
    },
    now: () => Date.now(),
    sleep: opts.sleep ?? (async (ms) => { sleeps.push(ms); }),
    log: (tag, fields) => { logs.push({ tag, fields }); },
  };
  return { deps, fetches, rpcs, logs, sleeps };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("trigger — only a signed outbound browser Dial action starts a capture", () => {
  it("parses the six signed fields exactly as received", () => {
    expect(dialEvidenceTrigger(SIGNED_PARAMS)).toEqual(trigger());
    expect(dialEvidenceTrigger({ ...SIGNED_PARAMS, DialCallStatus: "no-answer" })?.dialCallStatus).toBe("no-answer");
    // busy/failed/canceled still trigger: they are logged as `excluded`, never silently dropped
    expect(dialEvidenceTrigger({ ...SIGNED_PARAMS, DialCallStatus: "busy" })).not.toBeNull();
  });

  it("parent-status callbacks, inbound calls and non-client callers never trigger", () => {
    const { DialCallStatus: _s, DialCallSid: _d, ...parentStatus } = SIGNED_PARAMS;
    expect(dialEvidenceTrigger({ ...parentStatus, CallStatus: "completed" })).toBeNull();
    expect(dialEvidenceTrigger({ ...SIGNED_PARAMS, From: "+15550001111", To: "+15559990000" })).toBeNull(); // inbound PSTN caller
    expect(dialEvidenceTrigger({ ...SIGNED_PARAMS, From: "sip:agent@example.com" })).toBeNull();
    expect(dialEvidenceTrigger({ ...SIGNED_PARAMS, From: "Client:agent" })).toBeNull();
  });

  it("a missing or malformed DialCallSid, CallSid, AccountSid or To never triggers", () => {
    expect(dialEvidenceTrigger({ ...SIGNED_PARAMS, DialCallSid: "" })).toBeNull();
    expect(dialEvidenceTrigger({ ...SIGNED_PARAMS, DialCallSid: "CA123" })).toBeNull();
    expect(dialEvidenceTrigger({ ...SIGNED_PARAMS, DialCallSid: "RE" + "2".repeat(32) })).toBeNull();
    expect(dialEvidenceTrigger({ ...SIGNED_PARAMS, DialCallStatus: " " })).toBeNull();
    expect(dialEvidenceTrigger({ ...SIGNED_PARAMS, CallSid: "" })).toBeNull();
    expect(dialEvidenceTrigger({ ...SIGNED_PARAMS, AccountSid: "" })).toBeNull();
    expect(dialEvidenceTrigger({ ...SIGNED_PARAMS, To: "" })).toBeNull();
  });

  it("never throws on unexpected input", () => {
    expect(dialEvidenceTrigger({} as Record<string, string>)).toBeNull();
    expect(dialEvidenceTrigger(null as unknown as Record<string, string>)).toBeNull();
    expect(dialEvidenceTrigger({ ...SIGNED_PARAMS, From: 7 } as unknown as Record<string, string>)).toBeNull();
  });

  it("the production bounds are the approved ones", () => {
    expect(DIAL_EVIDENCE_BOUNDS).toEqual({ restTimeoutMs: 2500, reReadDelayMs: 1500, totalMs: 8000 });
  });
});

describe("persisted — the accepted status pairs reach the RPC with child-derived values", () => {
  it("answered: signed completed + child completed → one RPC with the exact §1.3 arguments", async () => {
    const h = harness();
    const v = await captureDialEvidence(h.deps, trigger(), FAST);
    expect(v).toMatchObject({ category: "persisted", reason: "recorded", outcome: "answered", recorded: true, dialedContext: "unsaved" });
    expect(h.fetches.map((f) => f.url)).toEqual([PARENT_URL, CHILD_URL]);
    expect(h.fetches[0].headers).toEqual({
      Authorization: "Basic " + btoa(`${ACCOUNT}:${TOKEN}`),
      Accept: "application/json",
    });
    expect(h.rpcs).toEqual([{
      p_signed_account_sid: ACCOUNT,
      p_credential_account_sid: ACCOUNT,
      p_parent_call_sid: PARENT,
      p_dial_call_sid: CHILD,
      p_dial_call_status: "completed",
      p_signed_from: `client:${IDENTITY}`,
      p_signed_to: DIALED,
      p_parent_account_sid: ACCOUNT,
      p_parent_from: `client:${IDENTITY}`,
      p_child_account_sid: ACCOUNT,
      p_child_parent_call_sid: PARENT,
      p_child_to: DIALED,
      p_child_from: CALLER_ID,
      p_child_status: "completed",
      p_child_start_time: "2026-09-27T12:00:00.000Z",
    }]);
    expect(h.logs).toHaveLength(1);
  });

  it("answered: signed `answered` + child completed", async () => {
    const h = harness();
    const v = await captureDialEvidence(h.deps, trigger({ dialCallStatus: "answered" }), FAST);
    expect(v).toMatchObject({ category: "persisted", outcome: "answered" });
    expect(h.rpcs[0].p_dial_call_status).toBe("answered");
  });

  it.each(["no-answer", "canceled"])("unanswered: signed no-answer + child %s (a browser-ended ring)", async (childStatus) => {
    const h = harness({ child: [{ status: 200, body: childRecord({ status: childStatus }) }] });
    const v = await captureDialEvidence(h.deps, trigger({ dialCallStatus: "no-answer" }), FAST);
    expect(v).toMatchObject({ category: "persisted", reason: "recorded", outcome: "unanswered", providerChildStatus: childStatus });
    expect(h.rpcs).toHaveLength(1);
    expect(h.rpcs[0]).toMatchObject({ p_dial_call_status: "no-answer", p_child_status: childStatus, p_child_to: DIALED, p_child_from: CALLER_ID });
  });

  it("statuses compare as lower(btrim()) exactly like the RPC, and are passed on as received", async () => {
    const h = harness({
      child: [{ status: 200, body: childRecord({ status: " Completed" }) }],
      rpc: async () => ({ data: { recorded: true, category: "persisted", reason: "recorded", outcome: "answered", dialed_context: "unsaved" }, error: null }),
    });
    const v = await captureDialEvidence(h.deps, trigger({ dialCallStatus: "Completed " }), FAST);
    expect(v).toMatchObject({ category: "persisted", outcome: "answered", dialCallStatus: "completed", providerChildStatus: "completed" });
    expect(h.rpcs[0]).toMatchObject({ p_dial_call_status: "Completed ", p_child_status: " Completed" });
  });

  it("the stored destination and caller ID are the CHILD record's, never the signed or browser values", async () => {
    const h = harness({ child: [{ status: 200, body: childRecord({ to: "+1 (555) 123-4567", from: "+15550009999" }) }] });
    await captureDialEvidence(h.deps, trigger({ signedTo: "5551234567" }), FAST);
    expect(h.rpcs[0]).toMatchObject({ p_signed_to: "5551234567", p_child_to: "+1 (555) 123-4567", p_child_from: "+15550009999" });
  });

  it("redelivery is idempotent at the RPC boundary: the duplicate answer is persisted/duplicate, not recorded", async () => {
    const h = harness({
      rpc: async () => ({ data: { recorded: false, category: "persisted", reason: "duplicate", outcome: "answered", dialed_context: "unsaved" }, error: null }),
    });
    const v = await captureDialEvidence(h.deps, trigger(), FAST);
    expect(v).toMatchObject({ category: "persisted", reason: "duplicate", recorded: false });
  });

  it("the RPC's database verdicts pass through unchanged (unverified / missing / D3 context)", async () => {
    for (const [category, reason] of [
      ["unverified", "identity_not_unique"], ["unverified", "call_row_not_found"], ["unverified", "caller_id_mismatch"],
      ["unverified", "number_not_permitted"], ["unverified", "call_already_evidenced"], ["missing", "child_start_missing"],
    ]) {
      const h = harness({ rpc: async () => ({ data: { recorded: false, category, reason, outcome: null, dialed_context: null }, error: null }) });
      expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category, reason, outcome: null, recorded: false });
    }
    const ctx = harness({ rpc: async () => ({ data: { recorded: true, category: "persisted", reason: "recorded", outcome: "answered", dialed_context: "campaign" }, error: null }) });
    expect((await captureDialEvidence(ctx.deps, trigger(), FAST)).dialedContext).toBe("campaign");
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["unparsable", "not a date"],
  ])("a child start_time that is %s is passed as NULL (the RPC answers missing/child_start_missing)", async (_label, start) => {
    const h = harness({
      child: [{ status: 200, body: childRecord({ start_time: start }) }],
      rpc: async (args) => ({
        data: args.p_child_start_time === null
          ? { recorded: false, category: "missing", reason: "child_start_missing", outcome: null, dialed_context: null }
          : { recorded: true, category: "persisted", reason: "recorded", outcome: "answered", dialed_context: "unsaved" },
        error: null,
      }),
    });
    const v = await captureDialEvidence(h.deps, trigger(), FAST);
    expect(h.rpcs[0].p_child_start_time).toBeNull();
    expect(v).toMatchObject({ category: "missing", reason: "child_start_missing" });
  });
});

describe("excluded / unverified before any REST read", () => {
  it.each(["busy", "failed", "canceled", "BUSY", "in-progress"])("signed %s → excluded/status_not_qualifying, no REST, no RPC", async (s) => {
    const h = harness();
    const v = await captureDialEvidence(h.deps, trigger({ dialCallStatus: s }), FAST);
    expect(v).toMatchObject({ category: "excluded", reason: "status_not_qualifying", outcome: null, restHttpStatus: null });
    expect(h.fetches).toHaveLength(0);
    expect(h.rpcs).toHaveLength(0);
  });

  it.each([
    ["malformed AccountSid", { accountSid: "ACnot-a-sid" }],
    ["malformed CallSid", { parentCallSid: "CA123" }],
    ["malformed DialCallSid", { dialCallSid: "CA" + "z".repeat(32) }],
    ["non-client From", { signedFrom: "+15550001111" }],
    ["empty client identity", { signedFrom: "client: " }],
    ["blank To", { signedTo: "  " }],
  ])("%s → unverified/invalid_input, no REST", async (_label, over) => {
    const h = harness();
    expect(await captureDialEvidence(h.deps, trigger(over), FAST)).toMatchObject({ category: "unverified", reason: "invalid_input" });
    expect(h.fetches).toHaveLength(0);
  });

  it("no outbound credential → operational_failure/credentials_missing, no REST", async () => {
    for (const credentials of [null, { accountSid: ACCOUNT, authToken: " " }, { accountSid: "", authToken: TOKEN }]) {
      const h = harness({ credentials });
      expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "operational_failure", reason: "credentials_missing" });
      expect(h.fetches).toHaveLength(0);
    }
  });

  it("credential account ≠ signed AccountSid → unverified/account_mismatch, no REST", async () => {
    const h = harness({ credentials: { accountSid: OTHER_ACCOUNT, authToken: TOKEN } });
    expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "unverified", reason: "account_mismatch" });
    expect(h.fetches).toHaveLength(0);
  });
});

describe("unverified — provider evidence contradicts the signed request (nothing else is called)", () => {
  it("parent account ≠ signed account → account_mismatch; the child is never read", async () => {
    const h = harness({ parent: [{ status: 200, body: parentRecord({ account_sid: OTHER_ACCOUNT }) }] });
    expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "unverified", reason: "account_mismatch" });
    expect(h.fetches.map((f) => f.url)).toEqual([PARENT_URL]);
    expect(h.rpcs).toHaveLength(0);
  });

  it("parent `from` ≠ signed client identity → parent_from_mismatch; the child is never read", async () => {
    const h = harness({ parent: [{ status: 200, body: parentRecord({ from: "client:someone_else" }) }] });
    expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "unverified", reason: "parent_from_mismatch" });
    expect(h.fetches.map((f) => f.url)).toEqual([PARENT_URL]);
    expect(h.rpcs).toHaveLength(0);
  });

  it("child account ≠ signed account → account_mismatch", async () => {
    const h = harness({ child: [{ status: 200, body: childRecord({ account_sid: OTHER_ACCOUNT }) }] });
    expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "unverified", reason: "account_mismatch" });
    expect(h.rpcs).toHaveLength(0);
  });

  it("child parent_call_sid ≠ signed CallSid → child_parent_mismatch", async () => {
    const h = harness({ child: [{ status: 200, body: childRecord({ parent_call_sid: OTHER_CALL }) }] });
    expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "unverified", reason: "child_parent_mismatch" });
    expect(h.rpcs).toHaveLength(0);
  });

  it.each([
    ["completed", "no-answer"],
    ["completed", "canceled"],
    ["completed", "busy"],
    ["answered", "failed"],
    ["no-answer", "completed"],
    ["no-answer", "busy"],
    ["no-answer", "failed"],
  ])("signed %s + child %s → status_pair_unaccepted, no RPC", async (signed, child) => {
    const h = harness({ child: [{ status: 200, body: childRecord({ status: child }) }] });
    const v = await captureDialEvidence(h.deps, trigger({ dialCallStatus: signed }), FAST);
    expect(v).toMatchObject({ category: "unverified", reason: "status_pair_unaccepted", providerChildStatus: child });
    expect(h.rpcs).toHaveLength(0);
  });
});

describe("missing — Twilio has no final record within the bound", () => {
  it("parent 404 → missing/parent_not_found (not retried)", async () => {
    const h = harness({ parent: [{ status: 404 }] });
    expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "missing", reason: "parent_not_found", restHttpStatus: 404 });
    expect(h.fetches).toHaveLength(1);
  });

  it("child 404 → missing/child_not_found", async () => {
    const h = harness({ child: [{ status: 404 }] });
    expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "missing", reason: "child_not_found" });
    expect(h.fetches.map((f) => f.url)).toEqual([PARENT_URL, CHILD_URL]);
  });

  it.each(["queued", "initiated", "ringing", "in-progress"])("a non-final child (%s) is re-read once after reReadDelayMs, then accepted when final", async (s) => {
    const h = harness({ child: [{ status: 200, body: childRecord({ status: s }) }, { status: 200, body: childRecord() }] });
    const v = await captureDialEvidence(h.deps, trigger(), FAST);
    expect(v).toMatchObject({ category: "persisted", outcome: "answered", providerChildStatus: "completed" });
    expect(h.sleeps).toEqual([FAST.reReadDelayMs]);
    expect(h.fetches.map((f) => f.url)).toEqual([PARENT_URL, CHILD_URL, CHILD_URL]);
  });

  it("a child still non-final after the one re-read → missing/child_not_final, no RPC", async () => {
    const h = harness({ child: [{ status: 200, body: childRecord({ status: "in-progress" }) }] });
    const v = await captureDialEvidence(h.deps, trigger(), FAST);
    expect(v).toMatchObject({ category: "missing", reason: "child_not_final", providerChildStatus: "in-progress" });
    expect(h.fetches.filter((f) => f.url === CHILD_URL)).toHaveLength(2);
    expect(h.sleeps).toEqual([FAST.reReadDelayMs]);
    expect(h.rpcs).toHaveLength(0);
  });

  it("the production re-read delay is the approved 1.5 s", async () => {
    const h = harness({ child: [{ status: 200, body: childRecord({ status: "ringing" }) }, { status: 200, body: childRecord() }] });
    await captureDialEvidence(h.deps, trigger());
    expect(h.sleeps).toEqual([1500]);
  });
});

describe("operational_failure — REST, RPC and bound failures", () => {
  it("5xx then success → exactly one retry, then persisted", async () => {
    const h = harness({ parent: [{ status: 503 }, { status: 200, body: parentRecord() }] });
    expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "persisted" });
    expect(h.fetches.map((f) => f.url)).toEqual([PARENT_URL, PARENT_URL, CHILD_URL]);
  });

  it("5xx twice → rest_<status>, no third attempt", async () => {
    const h = harness({ child: [{ status: 500 }, { status: 502 }, { status: 200, body: childRecord() }] });
    expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "operational_failure", reason: "rest_502", restHttpStatus: 502 });
    expect(h.fetches.filter((f) => f.url === CHILD_URL)).toHaveLength(2);
    expect(h.rpcs).toHaveLength(0);
  });

  it("network error then success → one retry, then persisted; network twice → rest_network", async () => {
    const ok = harness({ parent: ["network", { status: 200, body: parentRecord() }] });
    expect(await captureDialEvidence(ok.deps, trigger(), FAST)).toMatchObject({ category: "persisted" });
    const bad = harness({ parent: ["network", "network", { status: 200, body: parentRecord() }] });
    expect(await captureDialEvidence(bad.deps, trigger(), FAST)).toMatchObject({ category: "operational_failure", reason: "rest_network", restHttpStatus: null });
    expect(bad.fetches).toHaveLength(2);
  });

  it.each([
    [401, "rest_auth_401"],
    [403, "rest_auth_403"],
    [429, "rest_429"],
    [400, "rest_400"],
  ])("HTTP %s → operational_failure/%s without a retry", async (status, reason) => {
    const h = harness({ parent: [{ status }, { status: 200, body: parentRecord() }] });
    expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "operational_failure", reason, restHttpStatus: status });
    expect(h.fetches).toHaveLength(1);
  });

  it("a 2xx without a JSON object body → rest_invalid_body", async () => {
    const h = harness({ parent: [{ status: 200, body: ["not", "a", "record"] }] });
    expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "operational_failure", reason: "rest_invalid_body" });
  });

  it("a never-settling fetch is cut at restTimeoutMs, retried once, then rest_timeout — each read's signal is aborted", async () => {
    const h = harness({ parent: ["hang"] });
    const t0 = Date.now();
    const v = await captureDialEvidence(h.deps, trigger(), FAST);
    expect(v).toMatchObject({ category: "operational_failure", reason: "rest_timeout", restHttpStatus: null });
    expect(h.fetches).toHaveLength(2);
    expect(h.fetches.every((f) => f.signal.aborted)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(FAST.totalMs);
    expect(h.rpcs).toHaveLength(0);
  });

  it("an abort-honouring fetch that times out is still classified as a timeout, not a network error", async () => {
    const h = harness({ child: ["hang-abortable"] });
    expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "operational_failure", reason: "rest_timeout" });
  });

  it("the whole capture is bounded by totalMs: bound_exceeded, the in-flight read aborted, nothing starts afterwards", async () => {
    const h = harness({ parent: ["hang"] });
    const v = await captureDialEvidence(h.deps, trigger(), { restTimeoutMs: 5_000, reReadDelayMs: 5, totalMs: 30 });
    expect(v).toMatchObject({ category: "operational_failure", reason: "bound_exceeded" });
    expect(h.fetches).toHaveLength(1);
    expect(h.fetches[0].signal.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.fetches).toHaveLength(1); // no retry after the bound
    expect(h.rpcs).toHaveLength(0);
    expect(h.logs).toHaveLength(1); // the abandoned body never logs a second verdict
  });

  it("a bound that expires during the re-read pause stops the capture: no further read, no RPC", async () => {
    let wake: () => void = () => {};
    const h = harness({
      child: [{ status: 200, body: childRecord({ status: "ringing" }) }, { status: 200, body: childRecord() }],
      sleep: () => new Promise<void>((r) => { wake = r; }), // a sleep that ignores its signal
    });
    const v = await captureDialEvidence(h.deps, trigger(), { restTimeoutMs: 1_000, reReadDelayMs: 5, totalMs: 30 });
    expect(v).toMatchObject({ category: "operational_failure", reason: "bound_exceeded", providerChildStatus: "ringing" });
    wake();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.fetches.filter((f) => f.url === CHILD_URL)).toHaveLength(1);
    expect(h.rpcs).toHaveLength(0);
    expect(h.logs).toHaveLength(1);
  });

  it("a bound that expires after the last read resolved never lets the RPC start after the verdict", async () => {
    vi.useFakeTimers();
    let fired = false;
    const child: Record<string, unknown> = childRecord();
    // The 8 s bound fires while the capture is evaluating the (already received) child record — the last
    // instant before the RPC. The status getter advances the clock synchronously at its first read.
    Object.defineProperty(child, "status", {
      enumerable: true,
      get: () => {
        if (!fired) { fired = true; vi.advanceTimersByTime(DIAL_EVIDENCE_BOUNDS.totalMs); }
        return "completed";
      },
    });
    const h = harness({ child: [{ status: 200, body: child }] });
    const v = await captureDialEvidence(h.deps, trigger(), { restTimeoutMs: 60_000, reReadDelayMs: 1500, totalMs: 8000 });
    expect(fired).toBe(true);
    expect(v).toMatchObject({ category: "operational_failure", reason: "bound_exceeded" });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(h.rpcs).toHaveLength(0);
    expect(h.logs).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an RPC error, a thrown RPC and a malformed RPC answer are operational failures", async () => {
    const err = harness({ rpc: async () => ({ data: null, error: { message: "permission denied for function" } }) });
    expect(await captureDialEvidence(err.deps, trigger(), FAST)).toMatchObject({ category: "operational_failure", reason: "rpc_error" });
    const thrown = harness({ rpc: async () => { throw new Error("connection reset"); } });
    expect(await captureDialEvidence(thrown.deps, trigger(), FAST)).toMatchObject({ category: "operational_failure", reason: "rpc_error" });
    for (const data of [null, "persisted", { category: "stored", reason: "recorded" }, { category: "persisted", reason: "Recorded at +15551234567" }]) {
      const odd = harness({ rpc: async () => ({ data, error: null }) });
      expect(await captureDialEvidence(odd.deps, trigger(), FAST)).toMatchObject({ category: "operational_failure", reason: "rpc_unexpected_result" });
    }
  });
});

describe("never rejects, logs exactly one line, and clears its timers", () => {
  it("dependencies that all throw still produce one verdict", async () => {
    const logged: unknown[] = [];
    const deps: DialEvidenceDeps = {
      credentials: { accountSid: ACCOUNT, authToken: TOKEN },
      fetchJson: () => { throw new Error("sync fetch failure"); },
      rpc: () => { throw new Error("sync rpc failure"); },
      now: () => { throw new Error("clock"); },
      sleep: () => Promise.reject(new Error("sleep")),
      log: (...a) => { logged.push(a); throw new Error("log sink down"); },
    };
    const v = await captureDialEvidence(deps, trigger(), FAST);
    expect(v).toMatchObject({ category: "operational_failure", reason: "rest_network", elapsedMs: null });
    expect(logged).toHaveLength(1);
  });

  it("a throwing credentials getter or a missing trigger is an unexpected_exception, not a rejection", async () => {
    const h = harness();
    Object.defineProperty(h.deps, "credentials", { get: () => { throw new Error("env"); } });
    expect(await captureDialEvidence(h.deps, trigger(), FAST)).toMatchObject({ category: "operational_failure", reason: "unexpected_exception" });
    const g = harness();
    const v = await captureDialEvidence(g.deps, null as unknown as DialEvidenceTrigger, FAST);
    expect(v).toMatchObject({ category: "operational_failure", reason: "unexpected_exception", dialCallStatus: "unrecognized" });
    expect(g.logs).toHaveLength(1);
  });

  it("a completed capture leaves no pending timer", async () => {
    vi.useFakeTimers();
    const h = harness({ parent: [{ status: 503 }, { status: 200, body: parentRecord() }] });
    const v = await captureDialEvidence(h.deps, trigger());
    expect(v.category).toBe("persisted");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a timed-out and a bound-exceeded capture leave no pending timer", async () => {
    vi.useFakeTimers();
    const timedOut = harness({ parent: ["hang"] });
    const p1 = captureDialEvidence(timedOut.deps, trigger());
    await vi.advanceTimersByTimeAsync(DIAL_EVIDENCE_BOUNDS.restTimeoutMs * 2);
    expect(await p1).toMatchObject({ reason: "rest_timeout" });
    expect(vi.getTimerCount()).toBe(0);

    const bounded = harness({ parent: ["hang"] });
    const p2 = captureDialEvidence(bounded.deps, trigger(), { restTimeoutMs: 60_000, reReadDelayMs: 1500, totalMs: 8000 });
    await vi.advanceTimersByTimeAsync(8000);
    expect(await p2).toMatchObject({ reason: "bound_exceeded" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the log line has exactly the documented keys and no number, identity, SID, token or URL", async () => {
    const scenarios: Array<[Harness, Partial<DialEvidenceTrigger>]> = [
      [harness(), {}],
      [harness(), { dialCallStatus: "busy" }],
      [harness({ parent: [{ status: 200, body: parentRecord({ from: "client:other" }) }] }), {}],
      [harness({ child: [{ status: 404 }] }), {}],
      [harness({ parent: [{ status: 401 }] }), {}],
      [harness({ child: [{ status: 200, body: childRecord({ status: `+15551234567 ${IDENTITY}` }) }] }), {}],
      [harness({ rpc: async () => ({ data: null, error: { message: `duplicate key ${CHILD} ${DIALED}` } }) }), {}],
      [harness(), { dialCallStatus: `completed ${DIALED}` }],
    ];
    const forbidden = [
      ACCOUNT, PARENT, CHILD, TOKEN, IDENTITY, "client:", "5551234567", "5557654321", "https://", "twilio.com", "Basic ",
    ];
    for (const [h, over] of scenarios) {
      await captureDialEvidence(h.deps, trigger(over), FAST);
      expect(h.logs).toHaveLength(1);
      expect(h.logs[0].tag).toBe(DIAL_EVIDENCE_LOG_TAG);
      expect(DIAL_EVIDENCE_LOG_TAG).toBe("[twilio-voice-status] dial-evidence");
      expect(Object.keys(h.logs[0].fields).sort()).toEqual([
        "category", "dial_call_status", "elapsed_ms", "outcome", "provider_child_status", "reason", "rest_http_status",
      ]);
      const text = JSON.stringify(h.logs[0]);
      for (const f of forbidden) expect(text).not.toContain(f);
    }
    // free text in a status field is reduced to a fixed word
    expect(scenarios[5][0].logs[0].fields.provider_child_status).toBe("unrecognized");
    expect(scenarios[7][0].logs[0].fields.dial_call_status).toBe("unrecognized");
  });
});

describe("standardDialEvidenceDeps — the index.ts adapters over fetch / supabase.rpc / console.log", () => {
  it("fetchJson issues a GET with the given headers and signal and returns status + JSON body", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ sid: PARENT }), { status: 200 }));
    const deps = standardDialEvidenceDeps({ credentials: null, fetch: fetchSpy, rpc: async () => ({ data: null, error: null }) });
    const signal = new AbortController().signal;
    expect(await deps.fetchJson(PARENT_URL, { headers: { Accept: "application/json" }, signal })).toEqual({ status: 200, body: { sid: PARENT } });
    expect(fetchSpy).toHaveBeenCalledWith(PARENT_URL, { method: "GET", headers: { Accept: "application/json" }, signal });
  });

  it("a non-2xx answer returns its status without a body; an unreadable 2xx body rejects (a network failure)", async () => {
    const deps404 = standardDialEvidenceDeps({ credentials: null, fetch: async () => new Response("nope", { status: 404 }), rpc: async () => ({ data: null, error: null }) });
    expect(await deps404.fetchJson(PARENT_URL, { headers: {}, signal: new AbortController().signal })).toEqual({ status: 404, body: null });
    const depsBad = standardDialEvidenceDeps({ credentials: null, fetch: async () => new Response("<html>", { status: 200 }), rpc: async () => ({ data: null, error: null }) });
    await expect(depsBad.fetchJson(PARENT_URL, { headers: {}, signal: new AbortController().signal })).rejects.toBeTruthy();
  });

  it("rpc adapts a PromiseLike builder and turns a synchronous throw into a rejection", async () => {
    const thenable = { then: (ok: (v: unknown) => void) => ok({ data: { recorded: true }, error: null }) } as PromiseLike<{ data: unknown; error: null }>;
    const deps = standardDialEvidenceDeps({ credentials: null, fetch, rpc: () => thenable });
    expect(await deps.rpc("record_outbound_dial_evidence", {})).toEqual({ data: { recorded: true }, error: null });
    const throwing = standardDialEvidenceDeps({ credentials: null, fetch, rpc: () => { throw new Error("sync"); } });
    await expect(throwing.rpc("record_outbound_dial_evidence", {})).rejects.toThrow("sync");
  });

  it("sleep resolves after its delay, or at once on abort with its timer cleared; log is console.log", async () => {
    vi.useFakeTimers();
    const deps = standardDialEvidenceDeps({ credentials: null, fetch, rpc: async () => ({ data: null, error: null }) });
    let done = false;
    const p = deps.sleep(1500).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);

    const ctl = new AbortController();
    const q = deps.sleep(60_000, ctl.signal);
    expect(vi.getTimerCount()).toBe(1);
    ctl.abort();
    await q;
    expect(vi.getTimerCount()).toBe(0);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    deps.log(DIAL_EVIDENCE_LOG_TAG, { category: "persisted" });
    expect(spy).toHaveBeenCalledWith(DIAL_EVIDENCE_LOG_TAG, { category: "persisted" });
  });
});
