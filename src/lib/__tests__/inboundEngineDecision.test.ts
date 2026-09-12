// Corrective pass 6, finding 1 — the DURABLE per-call engine decision, coordinated with actual routing.
//
// The handler records the engine THIS call is routed with BEFORE any engine-specific work, and then routes
// with the PERSISTED decision. These regressions cover both cutover directions through the handler
// sequence, a duplicate webhook, a decision that cannot be recorded (never inferred), and the ordering
// requirement that nothing engine-specific runs before the decision is durable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideInboundStart,
  recordInboundEngineDecision,
  type EngineDecisionResult,
  type LoadOptions,
  type OwnerLookupResult,
  type RoutingEngine,
  type RpcDb,
  type V2SettingsResult,
} from "../../../supabase/functions/twilio-voice-inbound/settings";
import { runInboundStartRequest } from "../../../supabase/functions/twilio-voice-inbound/request";
import { createRequestDeadline, REQUEST_DEADLINE_MS } from "../../../supabase/functions/twilio-voice-inbound/settings";

const ORG = "11111111-1111-4111-8111-111111111111";
const CALL = "22222222-2222-4222-8222-222222222222";
const OWNER = "44444444-4444-4444-8444-444444444441";
const SORRY = "<Response><Say>sorry</Say><Hangup/></Response>";

const settingsOk = (engine: RoutingEngine): V2SettingsResult => ({
  ok: true,
  configured: true,
  attempts: 1,
  settings: { engine, groupIds: [], browserRingSeconds: 20, mobileRingSeconds: 20 },
});

/** An `rpc()` db whose result comes from a script (one entry per attempt). */
function scriptedRpc(script: Array<() => Promise<{ data: unknown; error: { message: string; code?: string } | null }>>): RpcDb & { calls: number; args: Record<string, unknown>[] } {
  const db = {
    calls: 0,
    args: [] as Record<string, unknown>[],
    rpc(_name: string, args: Record<string, unknown>) {
      db.args.push(args);
      const i = db.calls++;
      return script[Math.min(i, script.length - 1)]();
    },
  };
  return db;
}

type StartHarness = {
  order: string[];
  ownerCalls: number;
  abandon: ReturnType<typeof vi.fn>;
  run: (over?: Partial<Parameters<typeof runInboundStartRequest>[0]>) => Promise<Awaited<ReturnType<typeof runInboundStartRequest>>>;
};

function harness(engine: RoutingEngine, decision: (engine: RoutingEngine) => Promise<EngineDecisionResult>): StartHarness {
  const order: string[] = [];
  const state = { ownerCalls: 0 };
  const abandon = vi.fn(async () => {});
  const h: StartHarness = {
    order,
    get ownerCalls() { return state.ownerCalls; },
    abandon,
    run: (over) => runInboundStartRequest({
      loadSettings: async () => { order.push("settings"); return settingsOk(engine); },
      recordEngineDecision: async (e: RoutingEngine, _opts: LoadOptions) => { order.push(`decide:${e}`); return await decision(e); },
      loadOwner: async (): Promise<OwnerLookupResult> => { order.push("owner"); state.ownerCalls += 1; return { ok: true, agentId: OWNER, attempts: 1 }; },
      directLineOwnerId: null,
      failure: { abandon },
      sorryTwiml: SORRY,
      log: () => {},
      ...(over ?? {}),
    }, createRequestDeadline(REQUEST_DEADLINE_MS)),
  } as StartHarness;
  return h;
}

const ok = (engine: RoutingEngine, first = true): EngineDecisionResult => ({ ok: true, engine, first, attempts: 1 });

describe("record_inbound_engine_decision at the boundary", () => {
  it("returns the PERSISTED engine and whether this request recorded it", async () => {
    const db = scriptedRpc([async () => ({ data: { recorded: true, engine: "v2", first: true }, error: null })]);
    const r = await recordInboundEngineDecision(db, CALL, ORG, "v2");
    expect(r).toEqual({ ok: true, engine: "v2", first: true, attempts: 1 });
    expect(db.args[0]).toEqual({ p_call_row_id: CALL, p_org_id: ORG, p_engine: "v2" });
  });

  it("a duplicate webhook is handed the FIRST decision, not its own", async () => {
    const db = scriptedRpc([async () => ({ data: { recorded: true, engine: "v2", first: false }, error: null })]);
    const r = await recordInboundEngineDecision(db, CALL, ORG, "legacy");
    expect(r).toEqual({ ok: true, engine: "v2", first: false, attempts: 1 });
  });

  it("a transient error is retried; a persistent one is reported as a FAILURE, never as an engine", async () => {
    const flaky = scriptedRpc([
      async () => ({ data: null, error: { message: "connection reset" } }),
      async () => ({ data: { recorded: true, engine: "legacy", first: true }, error: null }),
    ]);
    await expect(recordInboundEngineDecision(flaky, CALL, ORG, "legacy")).resolves.toMatchObject({ ok: true, engine: "legacy" });
    const dead = scriptedRpc([async () => ({ data: null, error: { message: "connection reset" } })]);
    const r = await recordInboundEngineDecision(dead, CALL, ORG, "v2");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("connection reset");
  });

  it("a missing function (M6 rolled back) is a deterministic failure — one attempt, flagged as a schema absence", async () => {
    const db = scriptedRpc([async () => ({ data: null, error: { message: "Could not find the function public.record_inbound_engine_decision", code: "PGRST202" } })]);
    const r = await recordInboundEngineDecision(db, CALL, ORG, "v2");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.schemaAbsent).toBe(true);
    expect(db.calls).toBe(1);
  });

  it("a call row that does not exist records nothing and is NOT reported as a decision", async () => {
    const db = scriptedRpc([async () => ({ data: { recorded: false, reason: "call_not_found" }, error: null })]);
    const r = await recordInboundEngineDecision(db, CALL, ORG, "v2");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("call_not_found");
  });
});

describe("the start sequence routes with the PERSISTED decision", () => {
  it("records the decision BEFORE any engine-specific work (the owner lookup)", async () => {
    const h = harness("v2", async (e) => ok(e));
    const outcome = await h.run();
    expect(outcome.kind).toBe("proceed");
    expect(h.order).toEqual(["settings", "decide:v2", "owner"]);
  });

  it("cutover direction 1 — the organization now reads legacy, but this call was already decided v2: it keeps routing v2", async () => {
    const h = harness("legacy", async () => ok("v2", false));
    const outcome = await h.run();
    expect(outcome.kind).toBe("proceed");
    expect(outcome.kind === "proceed" && outcome.decision.kind).toBe("v2");
    expect(h.order).toEqual(["settings", "decide:legacy", "owner"]);   // the owner lookup follows the PERSISTED engine
  });

  it("cutover direction 2 — the organization now reads v2, but this call was decided legacy: it stays legacy and no v2 work starts", async () => {
    const h = harness("v2", async () => ok("legacy", false));
    const outcome = await h.run();
    expect(outcome.kind).toBe("proceed");
    expect(outcome.kind === "proceed" && outcome.decision.kind).toBe("legacy");
    expect(h.order).toEqual(["settings", "decide:v2"]);                // the owner lookup never runs
    expect(h.ownerCalls).toBe(0);
  });

  it("a decision that cannot be recorded is NEVER inferred for a v2 organization: the failure path answers and no v2 work starts", async () => {
    const h = harness("v2", async () => ({ ok: false, error: "connection reset", attempts: 3 }));
    const outcome = await h.run();
    expect(outcome.kind).toBe("respond");
    expect(outcome.kind === "respond" && outcome.twiml).toBe(SORRY);
    expect(outcome.kind === "respond" && outcome.reason).toBe("engine_decision_unavailable");
    expect(h.abandon).toHaveBeenCalledTimes(1);
    expect(h.ownerCalls).toBe(0);
  });

  it("a legacy organization is unaffected when the decision cannot be recorded (recovery owns no legacy work)", async () => {
    const h = harness("legacy", async () => ({ ok: false, error: "Could not find the function", attempts: 1, schemaAbsent: true }));
    const outcome = await h.run();
    expect(outcome.kind).toBe("proceed");
    expect(outcome.kind === "proceed" && outcome.decision.kind).toBe("legacy");
    expect(h.abandon).not.toHaveBeenCalled();
  });

  it("with no call row to record against, the sequence is unchanged", async () => {
    const h = harness("v2", async (e) => ok(e));
    const outcome = await h.run({ recordEngineDecision: null });
    expect(outcome.kind).toBe("proceed");
    expect(h.order).toEqual(["settings", "owner"]);
  });
});

describe("the decision participates in the request deadline", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-12T12:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  /** Runs `p` under fake timers, advancing until it settles; returns the value and the elapsed ms. */
  async function settle<T>(p: Promise<T>, maxMs = 60_000): Promise<{ value: T; elapsedMs: number }> {
    const t0 = Date.now();
    let done = false; let value: T | undefined; let error: unknown;
    p.then((v) => { done = true; value = v; }, (e) => { done = true; error = e; });
    for (let i = 0; i < maxMs / 50 && !done; i++) await vi.advanceTimersByTimeAsync(50);
    if (!done) throw new Error(`did not settle within ${maxMs} ms`);
    if (error) throw error;
    return { value: value as T, elapsedMs: Date.now() - t0 };
  }

  it("a STALLED decision RPC for a v2 organization is bounded, answered on the failure path, and no v2 work starts", async () => {
    const deadline = createRequestDeadline(REQUEST_DEADLINE_MS);
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const stalled = scriptedRpc([() => new Promise(() => {})]);
    const abandon = vi.fn(async () => { await sleep(300); });
    let ownerCalls = 0;
    const run = runInboundStartRequest({
      loadSettings: async () => settingsOk("v2"),
      recordEngineDecision: (engine: RoutingEngine, opts: LoadOptions) =>
        recordInboundEngineDecision(stalled, CALL, ORG, engine, { sleep, ...opts }),
      loadOwner: async (): Promise<OwnerLookupResult> => { ownerCalls += 1; return { ok: true, agentId: OWNER, attempts: 1 }; },
      directLineOwnerId: null,
      failure: { abandon },
      sorryTwiml: SORRY,
      log: () => {},
    }, deadline);
    const { value, elapsedMs } = await settle(run);
    expect(value.kind).toBe("respond");
    expect(value.kind === "respond" && value.reason).toBe("engine_decision_unavailable");
    expect(elapsedMs).toBeLessThanOrEqual(REQUEST_DEADLINE_MS);
    expect(deadline.remaining()).toBeGreaterThan(0);          // the response reserve survived
    expect(abandon).toHaveBeenCalledTimes(1);                 // the failure decision was taken and awaited
    expect(ownerCalls).toBe(0);                               // no engine-specific work started
  });

  it("a STALLED decision RPC for a legacy organization still answers inside the deadline, on the legacy path", async () => {
    const deadline = createRequestDeadline(REQUEST_DEADLINE_MS);
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const stalled = scriptedRpc([() => new Promise(() => {})]);
    const abandon = vi.fn(async () => {});
    const run = runInboundStartRequest({
      loadSettings: async () => settingsOk("legacy"),
      recordEngineDecision: (engine: RoutingEngine, opts: LoadOptions) =>
        recordInboundEngineDecision(stalled, CALL, ORG, engine, { sleep, ...opts }),
      loadOwner: async (): Promise<OwnerLookupResult> => ({ ok: true, agentId: OWNER, attempts: 1 }),
      directLineOwnerId: null,
      failure: { abandon },
      sorryTwiml: SORRY,
      log: () => {},
    }, deadline);
    const { value, elapsedMs } = await settle(run);
    expect(value.kind).toBe("proceed");
    expect(value.kind === "proceed" && value.decision.kind).toBe("legacy");
    expect(elapsedMs).toBeLessThanOrEqual(REQUEST_DEADLINE_MS);
    expect(abandon).not.toHaveBeenCalled();
    // A legacy organization owns no recoverable v2 work, so the audit write gets ONE attempt, not the full
    // retry budget: the legacy critical path is never lengthened for a result it does not use.
    expect(stalled.calls).toBe(1);
  });
});

describe("decideInboundStart with a persisted engine", () => {
  it("the persisted decision outranks the organization's current flag in both directions", () => {
    const ownerOk: OwnerLookupResult = { ok: true, agentId: OWNER, attempts: 1 };
    expect(decideInboundStart(settingsOk("legacy"), ownerOk, null, "v2").kind).toBe("v2");
    expect(decideInboundStart(settingsOk("v2"), ownerOk, null, "legacy").kind).toBe("legacy");
    expect(decideInboundStart(settingsOk("v2"), ownerOk, null, null).kind).toBe("v2");
  });

  it("a failed settings read is still an infrastructure failure, whatever was persisted", () => {
    const failed: V2SettingsResult = { ok: false, error: "connection reset", attempts: 3 };
    const d = decideInboundStart(failed, null, null, "v2");
    expect(d.kind).toBe("infrastructure_failure");
    expect(d.kind === "infrastructure_failure" && d.reason).toBe("settings_unavailable");
  });

  it("a v2 call with a failed owner lookup is still answered, not routed to the group", () => {
    const d = decideInboundStart(settingsOk("legacy"), { ok: false, error: "timeout", attempts: 3 }, null, "v2");
    expect(d.kind).toBe("infrastructure_failure");
    expect(d.kind === "infrastructure_failure" && d.reason).toBe("owner_lookup_unavailable");
  });
});
