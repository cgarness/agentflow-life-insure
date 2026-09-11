// Corrective pass 3, finding 4 — the webhook deadline is enforced across the WHOLE request, tested at the
// handler level (the sequences index.ts runs, with fake timers): a slow-but-successful settings read
// followed by a failing owner lookup, stalled stage dependencies, stalled initial planning and delayed
// failure side effects all yield an explicit response inside the deadline, and nothing that arrives after
// the response is routed. Twilio's ceiling is 15 s; the request deadline is 12 s (REQUEST_DEADLINE_MS).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BUDGET_MS,
  REQUEST_DEADLINE_MS,
  createRequestDeadline,
  runInfrastructureFailure,
  withRetries,
  type LoadOptions,
  type QueryDb,
} from "../../../supabase/functions/twilio-voice-inbound/settings";
import {
  runInboundStartRequest,
  runInitialV2Request,
  runStageRequest,
} from "../../../supabase/functions/twilio-voice-inbound/request";
import { FAILURE_PATH_RESERVE_MS, RESPONSE_RESERVE_MS } from "../../../supabase/functions/twilio-voice-inbound/settings";
import type { StageDeps } from "../../../supabase/functions/twilio-voice-inbound/stages";

const ORG = "11111111-1111-4111-8111-111111111111";
const CALL = "22222222-2222-4222-8222-222222222222";
const ATT = "33333333-3333-4333-8333-333333333333";
const A1 = "44444444-4444-4444-8444-444444444441";
const PARENT_SID = "CA" + "a".repeat(32);

const never = <T,>() => new Promise<T>(() => {});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const elapsedSince = (t0: number) => Date.now() - t0;

/** Runs `p` under fake timers, advancing time until it settles; returns the value and the elapsed ms. */
async function settleUnderFakeTimers<T>(p: Promise<T>, maxMs = 60_000): Promise<{ value: T; elapsedMs: number }> {
  const t0 = Date.now();
  let done = false;
  let value: T | undefined;
  let error: unknown;
  p.then((v) => { done = true; value = v; }, (e) => { done = true; error = e; });
  for (let i = 0; i < maxMs / 50 && !done; i++) await vi.advanceTimersByTimeAsync(50);
  if (!done) throw new Error(`did not settle within ${maxMs} ms`);
  if (error) throw error;
  return { value: value as T, elapsedMs: elapsedSince(t0) };
}

/** A query builder whose maybeSingle() resolves per-call from a script (each entry = one attempt). */
function scriptedDb(script: Array<() => Promise<{ data: unknown; error: { message: string; code?: string } | null }>>): QueryDb & { calls: number } {
  const db = {
    calls: 0,
    from() {
      const b: Record<string, unknown> = {};
      const self = () => b;
      b.select = self; b.eq = self;
      b.maybeSingle = () => { const i = db.calls++; const fn = script[Math.min(i, script.length - 1)]; return fn(); };
      return b;
    },
  };
  return db;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("withRetries — the budget is ABSOLUTE", () => {
  it("three stalled reads with the defaults finish inside the 6 000 ms budget (pre-fix: ≈7 810 ms)", async () => {
    const db = scriptedDb([never, never, never]);
    const { value, elapsedMs } = await settleUnderFakeTimers(withRetries(() => db.from("t").select("x").eq("a", 1).maybeSingle(), { sleep }));
    expect(value.ok).toBe(false);
    expect(elapsedMs).toBeLessThanOrEqual(DEFAULT_BUDGET_MS);
    expect(elapsedMs).toBeGreaterThanOrEqual(DEFAULT_BUDGET_MS - 100);   // it used the budget, it did not give up early
    expect(db.calls).toBeGreaterThanOrEqual(2);
  });

  it("a request deadline clips the read further (remaining minus the reserve)", async () => {
    const deadline = createRequestDeadline(3_000);
    const db = scriptedDb([never, never, never]);
    const { value, elapsedMs } = await settleUnderFakeTimers(withRetries(() => db.from("t").select("x").eq("a", 1).maybeSingle(), { sleep, deadline, reserveMs: 1_000 }));
    expect(value.ok).toBe(false);
    expect(elapsedMs).toBeLessThanOrEqual(2_000);
    expect(deadline.remaining()).toBeGreaterThanOrEqual(1_000);   // the reserve is intact
  });
});

describe("runInfrastructureFailure — side effects bounded by what the deadline leaves", () => {
  it("stalled side effects never delay the response past the deadline; with nothing left they are started but not awaited", async () => {
    const deadline = createRequestDeadline(1_500);
    const abandon = vi.fn(() => never<unknown>());
    const handed: Promise<unknown>[] = [];
    const { value, elapsedMs } = await settleUnderFakeTimers(runInfrastructureFailure({ abandon, background: (p) => { handed.push(p); } }, { deadline }));
    expect(value).toBe("handed_over");
    expect(elapsedMs).toBeLessThanOrEqual(1_000);                 // 1 500 − 500 reserve (pre-fix: 4 000)
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(handed).toHaveLength(1);                               // the decision is kept alive in the background
    expect(deadline.abandoned).toContain("infrastructure_failure_decision");
  });
});

describe("handler level — the initial request", () => {
  it("slow settings success (third attempt) followed by a stalled owner lookup and stalled side effects: sorry greeting inside the deadline", async () => {
    const deadline = createRequestDeadline(REQUEST_DEADLINE_MS);
    const settingsDb = scriptedDb([never, never, async () => ({ data: { routing_engine: "v2", inbound_group_agent_ids: [], browser_ring_seconds: 20, mobile_ring_seconds: 20 }, error: null })]);
    const ownerDb = scriptedDb([never, never, never]);
    const { loadV2RoutingSettings, resolveContactAssignedAgent } = await import("../../../supabase/functions/twilio-voice-inbound/settings");
    const abandon = vi.fn(async () => { await sleep(400); });      // the decision lands
    const notify = vi.fn(() => never<unknown>());                  // notification work stalls forever
    const handed: Promise<unknown>[] = [];
    const logs: string[] = [];
    const run = runInboundStartRequest({
      loadSettings: (opts: LoadOptions) => loadV2RoutingSettings(settingsDb, ORG, { sleep, ...opts }),
      loadOwner: (opts: LoadOptions) => resolveContactAssignedAgent(ownerDb, ORG, "55555555-5555-4555-8555-555555555555", "lead", { sleep, ...opts }),
      directLineOwnerId: null,
      failure: { abandon, notify, background: (p) => { handed.push(p); } },
      sorryTwiml: "<Response><Say>sorry</Say><Hangup/></Response>",
      log: (m) => { logs.push(m); },
    }, deadline);
    const { value, elapsedMs } = await settleUnderFakeTimers(run);
    expect(value.kind).toBe("respond");
    expect(value.kind === "respond" && value.twiml).toContain("sorry");
    expect(elapsedMs).toBeLessThanOrEqual(REQUEST_DEADLINE_MS);   // pre-fix: ≈5.3 s + 7.8 s + 4 s ≈ 17 s (> Twilio's 15 s)
    expect(settingsDb.calls).toBe(3);                              // the slow success really happened
    expect(abandon).toHaveBeenCalledTimes(1);                      // the failure decision was taken and awaited …
    expect(notify).toHaveBeenCalledTimes(1);                       // … notification work started AFTER it, in the background
    expect(handed).toHaveLength(1);
    expect(logs.some((m) => m.includes("infrastructure-failure path"))).toBe(true);
    // … and nothing that arrives later changes the answer: the owner read is never consulted again
    const ownerCalls = ownerDb.calls;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ownerDb.calls).toBe(ownerCalls);
  });

  it("a settings read that fails fast is answered at once — the side effects run inside their own deadline", async () => {
    const deadline = createRequestDeadline(REQUEST_DEADLINE_MS);
    const settingsDb = scriptedDb([async () => ({ data: null, error: { message: "connection reset" } })]);
    const { loadV2RoutingSettings } = await import("../../../supabase/functions/twilio-voice-inbound/settings");
    const abandon = vi.fn(async () => { await sleep(300); });
    const notify = vi.fn(async () => {});
    const order: string[] = [];
    const run = runInboundStartRequest({
      loadSettings: (opts: LoadOptions) => loadV2RoutingSettings(settingsDb, ORG, { sleep, ...opts }),
      loadOwner: () => { throw new Error("must not be consulted"); },
      directLineOwnerId: null,
      failure: { abandon: async () => { order.push("abandon"); return abandon(); }, notify: async () => { order.push("notify"); return notify(); }, background: () => {} },
      sorryTwiml: "<Response><Say>sorry</Say><Hangup/></Response>",
      log: () => {},
    }, deadline);
    const { value, elapsedMs } = await settleUnderFakeTimers(run);
    expect(value.kind).toBe("respond");
    expect(elapsedMs).toBeLessThan(2_000);
    expect(abandon).toHaveBeenCalledTimes(1);                      // the decision completed …
    await vi.advanceTimersByTimeAsync(10);
    expect(order).toEqual(["abandon", "notify"]);                  // … and notification work only AFTER it
  });
});

function stageDeps(script: Record<string, (args: Record<string, unknown>) => Promise<{ data?: unknown; error?: { message: string; code?: string } | null }>>, attemptRow: Record<string, unknown> | null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps: StageDeps = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      const fn = script[name];
      if (!fn) return { data: { updated: true }, error: null };
      const r = await fn(args);
      return { data: r.data ?? null, error: r.error ?? null };
    },
    loadAttempt: async () => attemptRow as unknown as ReturnType<StageDeps["loadAttempt"]> extends Promise<infer T> ? T : never,
    resolveIdentities: async (ids) => ids.map((id) => ({ agentId: id, identity: `agent_${id.slice(-2)}` })),
    persistRoutedAgents: async () => true,
    loadAgentGreeting: async () => ({ text: null, url: null }),
    urls: {
      stage: (q) => `https://x.supabase.co/functions/v1/twilio-voice-inbound?${new URLSearchParams(q).toString()}`,
      recordingStatus: (q) => `https://x.supabase.co/functions/v1/twilio-recording-status${Object.keys(q).length ? `?${new URLSearchParams(q).toString()}` : ""}`,
      claimCallbackBase: "https://x.supabase.co/functions/v1/inbound-call-claim",
    },
    settings: { browserRingSeconds: 20, mobileRingSeconds: 20, recordingEnabled: true, greetingText: "Org greeting", greetingUrl: "" },
    log: () => {},
    sleep,
  };
  return { deps, calls };
}

const ownerBrowserAttempt = () => ({
  id: ATT, stage: "owner_browser", mode: "owner", owner_agent_id: A1, reserved_agent_ids: [A1], browser_ring_timeout_sent: 20,
  mobile_number_dialed: null, voicemail_kind: null, voicemail_agent_id: null, voicemail_group_ids: null, terminal: false,
});

describe("handler level — stage callbacks", () => {
  it("a stalled advance RPC on the owner_browser return: failure path + sorry inside the deadline, and the late result is never routed", async () => {
    const deadline = createRequestDeadline(REQUEST_DEADLINE_MS);
    let releaseAdvance: (() => void) | null = null;
    const { deps, calls } = stageDeps({
      advance_to_owner_mobile: () => new Promise((resolve) => { releaseAdvance = () => resolve({ data: { updated: true, forward: true, stage: "owner_mobile", mobile: "+15559990001" } }); }),
    }, ownerBrowserAttempt());
    const abandon = vi.fn(async () => { await sleep(1_000); });    // a real database decision, not instant
    const abandonSettled: number[] = [];
    const run = runStageRequest({
      loadPhoneSettings: async () => null,
      loadV2Settings: async () => ({ ok: true, settings: { engine: "v2", groupIds: [], browserRingSeconds: 20, mobileRingSeconds: 20 }, configured: true, attempts: 1 }),
      loadCallIdentity: async () => ({ ok: true, call: { id: CALL, organization_id: ORG, twilio_call_sid: PARENT_SID }, attempts: 1 }),
      buildDeps: () => deps,
      parseDialBridged: () => null,
      failure: () => ({ abandon: async () => { await abandon(); abandonSettled.push(Date.now()); }, background: () => {} }),
      twiml: { empty: "<Response/>", sorry: "<Response><Say>sorry</Say><Hangup/></Response>", whisperReject: () => "<Response><Hangup/></Response>" },
      log: () => {},
    }, deadline, { stage: "owner_browser", callRowId: CALL, orgId: ORG, attemptId: ATT, agentId: A1, gather: false,
      params: { CallSid: PARENT_SID, DialCallStatus: "no-answer" } });
    const { value, elapsedMs } = await settleUnderFakeTimers(run);
    expect(value.status).toBe(200);
    expect(value.twiml).toContain("sorry");                       // explicit failure, not a guessed voicemail / mobile dial
    expect(elapsedMs).toBeLessThanOrEqual(REQUEST_DEADLINE_MS);
    expect(deadline.abandoned).toContain("rpc:advance_to_owner_mobile");
    expect(deadline.abandoned).not.toContain("infrastructure_failure_decision");
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(abandonSettled).toHaveLength(1);                       // the decision COMPLETED before the response (budget reserved for it)
    const rpcCount = calls.length;
    releaseAdvance!();                                            // the abandoned RPC now "commits"
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.length).toBe(rpcCount);                          // nothing further is routed from it
  });

  it("a stalled stored-call read on the mobile leg status callback is redelivered (503) inside the deadline", async () => {
    const deadline = createRequestDeadline(REQUEST_DEADLINE_MS);
    const callDb = scriptedDb([never, never, never]);
    const { loadCallIdentity } = await import("../../../supabase/functions/twilio-voice-inbound/settings");
    const { deps } = stageDeps({}, ownerBrowserAttempt());
    const run = runStageRequest({
      loadPhoneSettings: async () => null,
      loadV2Settings: async () => ({ ok: true, settings: { engine: "v2", groupIds: [], browserRingSeconds: 20, mobileRingSeconds: 20 }, configured: true, attempts: 1 }),
      loadCallIdentity: (opts) => loadCallIdentity(callDb, CALL, { sleep, ...opts }),
      buildDeps: () => deps,
      parseDialBridged: () => null,
      failure: () => ({ abandon: async () => {} }),
      twiml: { empty: "<Response/>", sorry: "<Response><Say>sorry</Say><Hangup/></Response>", whisperReject: () => "<Response><Hangup/></Response>" },
      log: () => {},
    }, deadline, { stage: "mobile_leg_status", callRowId: CALL, orgId: ORG, attemptId: ATT, agentId: A1, gather: false,
      params: { CallSid: "CA" + "c".repeat(32), ParentCallSid: PARENT_SID, CallStatus: "completed" } });
    const { value, elapsedMs } = await settleUnderFakeTimers(run);
    expect(value.status).toBe(503);
    expect(elapsedMs).toBeLessThanOrEqual(REQUEST_DEADLINE_MS);
  });

  it("a stalled planning RPC on the initial request: sorry inside the deadline, side effects bounded, the late plan never emits a ring", async () => {
    const deadline = createRequestDeadline(REQUEST_DEADLINE_MS);
    let releasePlan: (() => void) | null = null;
    const { deps, calls } = stageDeps({
      plan_inbound_route: () => new Promise((resolve) => { releasePlan = () => resolve({ data: { created: true, stage: "owner_browser", attempt: ownerBrowserAttempt() } }); }),
    }, null);
    const abandon = vi.fn(async () => { await sleep(800); });     // the decision lands (finalize + D13 + closure)
    const notify = vi.fn(() => never<unknown>());                  // missed-call notification work stalls forever
    const handed: Promise<unknown>[] = [];
    const timeline: string[] = [];
    const run = runInitialV2Request(deps, { callRowId: CALL, orgId: ORG, ownerAgentId: A1, ownerSource: "contact", groupIds: [], fromNumber: "+19995551234", parentCallSid: PARENT_SID },
      deadline, { abandon: async () => { timeline.push("abandon:start"); await abandon(); timeline.push("abandon:done"); }, notify, background: (p) => { handed.push(p); },
        sorryTwiml: "<Response><Say>sorry</Say><Hangup/></Response>", log: () => {} });
    const { value, elapsedMs } = await settleUnderFakeTimers(run);
    timeline.push("responded");
    expect(value.twiml).toContain("sorry");
    expect(value.twiml).not.toContain("<Client");
    expect(elapsedMs).toBeLessThanOrEqual(REQUEST_DEADLINE_MS);
    expect(deadline.abandoned).toContain("rpc:plan_inbound_route");
    expect(timeline).toEqual(["abandon:start", "abandon:done", "responded"]);   // pre-fix: finalize never ran (blocked behind the stalled notify)
    expect(notify).toHaveBeenCalledTimes(1);                       // notification work started after the decision …
    expect(handed).toHaveLength(1);                                // … and lives in the background, never awaited
    const n = calls.length;
    releasePlan!();                                                // the abandoned planning promise resolves AFTER the response
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.length).toBe(n);                                  // nothing further is routed from it (the database refuses / closes it: A19, A20, barrier proofs)
  });
});

describe("handler level — the abandon decision is never blocked and never lost", () => {
  it("the abandon decision itself outliving the deadline is handed to the background (kept alive), the response still leaves on time", async () => {
    const deadline = createRequestDeadline(3_000);
    const { deps } = stageDeps({ plan_inbound_route: () => never() }, null);
    const handed: Promise<unknown>[] = [];
    const abandon = vi.fn(() => never<unknown>());
    const run = runInitialV2Request(deps, { callRowId: CALL, orgId: ORG, ownerAgentId: A1, ownerSource: "contact", groupIds: [], fromNumber: "+19995551234", parentCallSid: PARENT_SID },
      deadline, { abandon, background: (p) => { handed.push(p); }, sorryTwiml: "<Response><Say>sorry</Say><Hangup/></Response>", log: () => {} });
    const { value, elapsedMs } = await settleUnderFakeTimers(run);
    expect(value.twiml).toContain("sorry");
    expect(elapsedMs).toBeLessThanOrEqual(3_000 - RESPONSE_RESERVE_MS + 60);
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(handed).toHaveLength(1);
    expect(deadline.abandoned).toContain("infrastructure_failure_decision");
  });

  it("routing RPC waits keep the failure budget free: an abandoned stage RPC leaves at least the failure reserve for the decision", async () => {
    const deadline = createRequestDeadline(REQUEST_DEADLINE_MS);
    const { deps } = stageDeps({ advance_to_owner_mobile: () => never() }, ownerBrowserAttempt());
    let remainingAtDecision = -1;
    const run = runStageRequest({
      loadPhoneSettings: async () => null,
      loadV2Settings: async () => ({ ok: true, settings: { engine: "v2", groupIds: [], browserRingSeconds: 20, mobileRingSeconds: 20 }, configured: true, attempts: 1 }),
      loadCallIdentity: async () => ({ ok: true, call: { id: CALL, organization_id: ORG, twilio_call_sid: PARENT_SID }, attempts: 1 }),
      buildDeps: () => deps,
      parseDialBridged: () => null,
      failure: () => ({ abandon: async () => { remainingAtDecision = deadline.remaining(); }, background: () => {} }),
      twiml: { empty: "<Response/>", sorry: "<Response><Say>sorry</Say><Hangup/></Response>", whisperReject: () => "<Response><Hangup/></Response>" },
      log: () => {},
    }, deadline, { stage: "owner_browser", callRowId: CALL, orgId: ORG, attemptId: ATT, agentId: A1, gather: false, params: { CallSid: PARENT_SID, DialCallStatus: "no-answer" } });
    await settleUnderFakeTimers(run);
    expect(remainingAtDecision).toBeGreaterThanOrEqual(FAILURE_PATH_RESERVE_MS - 100);   // pre-fix: ≈ RESPONSE_RESERVE_MS (500) only
  });
});
