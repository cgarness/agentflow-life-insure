// Corrective pass 6, finding 1 — the DURABLE per-call engine decision, coordinated with actual routing.
//
// The handler records the engine THIS call is routed with BEFORE any engine-specific work, and then routes
// with the PERSISTED decision. These regressions cover both cutover directions through the handler
// sequence, a duplicate webhook, a decision that cannot be recorded (never inferred), and the ordering
// requirement that nothing engine-specific runs before the decision is durable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideInboundStart,
  isDatabaseObjectAbsentError,
  isSchemaCacheError,
  readPersistedEngineDecision,
  recordInboundEngineDecision,
  type EngineDecisionResult,
  type LoadOptions,
  type OwnerLookupResult,
  type QueryDb,
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

/** A `from()` db whose maybeSingle() answers from a script (one entry per attempt) — the row read. */
function scriptedTable(script: Array<() => Promise<{ data: unknown; error: { message: string; code?: string } | null }>>): QueryDb & { calls: number; selected: string[] } {
  const db = {
    calls: 0,
    selected: [] as string[],
    from(_table: string) {
      const b: Record<string, unknown> = {};
      const self = () => b;
      b.select = (c: string) => { db.selected.push(c); return b; };
      b.eq = self; b.limit = self;
      b.maybeSingle = () => { const i = db.calls++; return script[Math.min(i, script.length - 1)](); };
      return b;
    },
  };
  return db as QueryDb & { calls: number; selected: string[] };
}

/**
 * One shared `calls.routing_engine` cell with the REAL contract around it: the RPC is the only writer and
 * it is first-decision-wins under the row's lock; the table read is a plain snapshot that reserves nothing.
 * Both are driven through the production helpers (recordInboundEngineDecision / readPersistedEngineDecision).
 */
function engineStore() {
  const cell: { engine: string | null } = { engine: null };
  const store = {
    writes: 0,
    saved: () => cell.engine,
    /** The RPC. `cacheError` makes PostgREST answer PGRST202 without ever reaching the database. */
    rpc(opts: { cacheError?: boolean }): RpcDb {
      return {
        rpc(_name: string, args: Record<string, unknown>) {
          if (opts.cacheError) return Promise.resolve({ data: null, error: PGRST202 });
          const first = cell.engine === null;
          if (first) { cell.engine = String(args.p_engine); store.writes += 1; }
          return Promise.resolve({ data: { recorded: true, engine: cell.engine, first }, error: null });
        },
      };
    },
    /** The row read. `snapshotBeforeWrites` freezes the value as it was when the builder was created. */
    table(opts: { snapshotBeforeWrites?: boolean } = {}): QueryDb {
      const snapshot = cell.engine;
      return {
        from(_table: string) {
          const b: Record<string, unknown> = {};
          const self = () => b;
          b.select = self; b.eq = self; b.limit = self;
          b.maybeSingle = () => Promise.resolve({
            data: { routing_engine: opts.snapshotBeforeWrites ? snapshot : cell.engine },
            error: null,
          });
          return b;
        },
      } as QueryDb;
    },
  };
  return store;
}

/** The two PostgREST answers this pass is about — copied from the documented error shapes. */
const PGRST202 = { message: "Could not find the function public.record_inbound_engine_decision(p_call_row_id, p_engine, p_org_id) in the schema cache", code: "PGRST202" };
const PGRST202_MESSAGE_ONLY = { message: "Could not find the function public.record_inbound_engine_decision in the schema cache" };
/** PostgreSQL's own answer, which IS evidence: the column does not exist in the database. */
const PG_42703 = { message: 'column calls.routing_engine does not exist', code: "42703" };

type StartHarness = {
  order: string[];
  ownerCalls: number;
  abandon: ReturnType<typeof vi.fn>;
  run: (over?: Partial<Parameters<typeof runInboundStartRequest>[0]>) => Promise<Awaited<ReturnType<typeof runInboundStartRequest>>>;
};

function harness(
  engine: RoutingEngine,
  decision: (engine: RoutingEngine) => Promise<EngineDecisionResult>,
  readEngineDecision?: ((opts: LoadOptions) => Promise<Awaited<ReturnType<typeof readPersistedEngineDecision>>>) | null,
): StartHarness {
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
      readEngineDecision: readEngineDecision === undefined
        ? null
        : readEngineDecision === null
        ? null
        : async (opts: LoadOptions) => { order.push("read-row"); return await readEngineDecision(opts); },
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

  // Corrective pass 8: PostgREST documents that a stale schema cache reports a function missing while the
  // database function exists, so PGRST202 is AMBIGUOUS metadata — it is retried like any other transient
  // failure and reported as a failure, never as an established schema state.
  it("a PostgREST schema-cache miss (PGRST202) is a plain FAILURE, retried, and never flagged as schema absence", async () => {
    const db = scriptedRpc([async () => ({ data: null, error: PGRST202 })]);
    const r = await recordInboundEngineDecision(db, CALL, ORG, "v2");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.schemaAbsent).toBeFalsy();
    expect(r.ok === false && r.schemaCache).toBe(true);
    expect(db.calls).toBe(3);                                        // retried inside the budget, not decided on sight
  });

  it("the same message with no code reaches the regex path and is classified the same way", async () => {
    const db = scriptedRpc([async () => ({ data: null, error: PGRST202_MESSAGE_ONLY })]);
    const r = await recordInboundEngineDecision(db, CALL, ORG, "v2");
    expect(r.ok === false && r.schemaAbsent).toBeFalsy();
    expect(r.ok === false && r.schemaCache).toBe(true);
    expect(isSchemaCacheError(PGRST202_MESSAGE_ONLY)).toBe(true);
    expect(isDatabaseObjectAbsentError(PGRST202_MESSAGE_ONLY)).toBe(false);
    expect(isDatabaseObjectAbsentError(PGRST202)).toBe(false);
  });

  it("PostgreSQL's own answers ARE evidence: 42703 / 42P01 / 42883 stop on the first attempt", async () => {
    for (const code of ["42703", "42P01", "42883"]) {
      const db = scriptedRpc([async () => ({ data: null, error: { message: "does not exist", code } })]);
      const r = await recordInboundEngineDecision(db, CALL, ORG, "v2");
      expect(r.ok === false && r.schemaAbsent).toBe(true);
      expect(db.calls).toBe(1);
      expect(isDatabaseObjectAbsentError({ message: "x", code })).toBe(true);
    }
  });

  it("readPersistedEngineDecision reports what the ROW holds, and only PostgreSQL may report absence", async () => {
    const decided = scriptedTable([async () => ({ data: { routing_engine: "v2" }, error: null })]);
    expect(await readPersistedEngineDecision(decided, CALL, ORG)).toMatchObject({ kind: "decided", engine: "v2" });
    expect(decided.selected).toEqual(["routing_engine"]);
    const undecided = scriptedTable([async () => ({ data: { routing_engine: null }, error: null })]);
    expect(await readPersistedEngineDecision(undecided, CALL, ORG)).toMatchObject({ kind: "undecided" });
    const absent = scriptedTable([async () => ({ data: null, error: PG_42703 })]);
    expect(await readPersistedEngineDecision(absent, CALL, ORG)).toMatchObject({ kind: "column_absent" });
    expect(absent.calls).toBe(1);
    const cache = scriptedTable([async () => ({ data: null, error: { message: "Could not find the 'routing_engine' column of 'calls' in the schema cache", code: "PGRST204" } })]);
    expect(await readPersistedEngineDecision(cache, CALL, ORG)).toMatchObject({ kind: "unavailable" });
    const gone = scriptedTable([async () => ({ data: null, error: null })]);
    expect(await readPersistedEngineDecision(gone, CALL, ORG)).toMatchObject({ kind: "unavailable" });
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

  // ── Corrective pass 7, finding 1 — an UNRESOLVED decision is never replaced by the current flag ─────
  it("saved v2 decision + current legacy flag + a TRANSIENT RPC error: the failure path answers, no legacy work and no legacy TwiML", async () => {
    // The duplicate initial webhook of a call already carrying routing_engine='v2', after the
    // organization rolled back to legacy. The RPC (the only way to read that decision) fails.
    const h = harness("legacy", async () => ({ ok: false, error: "connection reset", attempts: 3 }));
    const outcome = await h.run();
    expect(outcome.kind).toBe("respond");
    expect(outcome.kind === "respond" && outcome.reason).toBe("engine_decision_unavailable");
    expect(outcome.kind === "respond" && outcome.twiml).toBe(SORRY);   // the sorry greeting, never legacy TwiML
    expect(h.abandon).toHaveBeenCalledTimes(1);
    expect(h.ownerCalls).toBe(0);
    expect(h.order).toEqual(["settings", "decide:legacy"]);            // no engine-specific work of either engine
  });

  it("an RPC that answers 'call_not_found' is unresolved too — the current flag does not decide the engine", async () => {
    const db = scriptedRpc([async () => ({ data: { recorded: false, reason: "call_not_found" }, error: null })]);
    const h = harness("legacy", (engine: RoutingEngine) => recordInboundEngineDecision(db, CALL, ORG, engine));
    const outcome = await h.run();
    expect(outcome.kind).toBe("respond");
    expect(outcome.kind === "respond" && outcome.reason).toBe("engine_decision_unavailable");
    expect(h.ownerCalls).toBe(0);
  });

  // ── Corrective pass 8 — through the REAL boundary: scripted PostgREST answers drive withRetries →
  //    recordInboundEngineDecision → readPersistedEngineDecision → runInboundStartRequest. Nothing
  //    injects a classification.
  const realDecision = (rpcDb: RpcDb) => (engine: RoutingEngine) => recordInboundEngineDecision(rpcDb, CALL, ORG, engine);
  const realRead = (tableDb: QueryDb) => (opts: LoadOptions) => readPersistedEngineDecision(tableDb, CALL, ORG, opts);

  for (const flag of ["legacy", "v2"] as const) {
    it(`saved v2 decision + ${flag} organization flag + the documented PGRST202 cache error: the row decides, and it routes V2`, async () => {
      // The cache lost the function; the DATA still holds this call's decision. Pre-fix the handler read
      // the cache error as "the whole v2 schema is gone" and routed LEGACY.
      const h = harness(flag, realDecision(scriptedRpc([async () => ({ data: null, error: PGRST202 })])),
        realRead(scriptedTable([async () => ({ data: { routing_engine: "v2" }, error: null })])));
      const outcome = await h.run();
      expect(outcome.kind).toBe("proceed");
      expect(outcome.kind === "proceed" && outcome.decision.kind).toBe("v2");
      expect(h.order).toEqual(["settings", `decide:${flag}`, "read-row", "owner"]);
      expect(h.abandon).not.toHaveBeenCalled();
    });

    it(`saved v2 decision + ${flag} flag + the cache message with no code: same outcome through the regex path`, async () => {
      const h = harness(flag, realDecision(scriptedRpc([async () => ({ data: null, error: PGRST202_MESSAGE_ONLY })])),
        realRead(scriptedTable([async () => ({ data: { routing_engine: "v2" }, error: null })])));
      const outcome = await h.run();
      expect(outcome.kind === "proceed" && outcome.decision.kind).toBe("v2");
    });

    it(`${flag} flag + PGRST202 + a row read that is ALSO unavailable: unresolved — no engine work, no routing TwiML`, async () => {
      const h = harness(flag, realDecision(scriptedRpc([async () => ({ data: null, error: PGRST202 })])),
        realRead(scriptedTable([async () => ({ data: null, error: { message: "connection reset" } })])));
      const outcome = await h.run();
      expect(outcome.kind).toBe("respond");
      expect(outcome.kind === "respond" && outcome.reason).toBe("engine_decision_unavailable");
      expect(outcome.kind === "respond" && outcome.twiml).toBe(SORRY);
      expect(h.ownerCalls).toBe(0);
      expect(h.order).toEqual(["settings", `decide:${flag}`, "read-row"]);
    });
  }

  it("PGRST202 with no row reader configured stays unresolved — a cache error alone never authorizes an engine", async () => {
    const h = harness("legacy", realDecision(scriptedRpc([async () => ({ data: null, error: PGRST202 })])), null);
    const outcome = await h.run();
    expect(outcome.kind).toBe("respond");
    expect(outcome.kind === "respond" && outcome.reason).toBe("engine_decision_unavailable");
    expect(h.ownerCalls).toBe(0);
  });

  it("the ACTUAL rollback state — PostgreSQL rejects calls.routing_engine — is the one case that proceeds legacy", async () => {
    // M6 rolled back: the RPC is gone (the cache says so) AND PostgreSQL itself rejects the column, so no
    // call can carry a v2 decision. Established against the exact object, not inferred from the migration.
    for (const flag of ["legacy", "v2"] as const) {
      const h = harness(flag, realDecision(scriptedRpc([async () => ({ data: null, error: PGRST202 })])),
        realRead(scriptedTable([async () => ({ data: null, error: PG_42703 })])));
      const outcome = await h.run();
      expect(outcome.kind).toBe("proceed");
      expect(outcome.kind === "proceed" && outcome.decision.kind).toBe("legacy");
      expect(h.abandon).not.toHaveBeenCalled();
      expect(h.ownerCalls).toBe(0);
    }
  });

  // ── Corrective pass 9, finding 1 — a NULL read reserves nothing; only the atomic RPC decides ────────
  it("an UNDECIDED row fails closed under BOTH organization flags — a NULL read is not a reservation", async () => {
    for (const flag of ["legacy", "v2"] as const) {
      const h = harness(flag, realDecision(scriptedRpc([async () => ({ data: null, error: PGRST202 })])),
        realRead(scriptedTable([async () => ({ data: { routing_engine: null }, error: null })])));
      const outcome = await h.run();
      expect(outcome.kind).toBe("respond");                            // pre-fix under 'legacy': proceed/legacy
      expect(outcome.kind === "respond" && outcome.reason).toBe("engine_decision_unavailable");
      expect(outcome.kind === "respond" && outcome.twiml).toBe(SORRY);
      expect(h.ownerCalls).toBe(0);
      expect(h.order).toEqual(["settings", `decide:${flag}`, "read-row"]);
    }
  });

  it("REPEATED DELIVERY: the first delivery must not route legacy off a NULL read that a later delivery decides v2", async () => {
    // One shared row, one atomic first-decision-wins writer — the real helpers drive both deliveries.
    const store = engineStore();
    // Delivery 1: legacy flag, the RPC is cache-blind, the row still reads NULL.
    const first = harness("legacy", realDecision(store.rpc({ cacheError: true })), realRead(store.table()));
    const o1 = await first.run();
    expect(o1.kind).toBe("respond");                                   // nothing routed, nothing decided
    expect(o1.kind === "respond" && o1.reason).toBe("engine_decision_unavailable");
    expect(store.saved()).toBeNull();
    expect(first.ownerCalls).toBe(0);
    // The organization activates v2 and the cache recovers; Twilio redelivers the SAME call.
    const second = harness("v2", realDecision(store.rpc({})), realRead(store.table()));
    const o2 = await second.run();
    expect(o2.kind === "proceed" && o2.decision.kind).toBe("v2");
    expect(store.saved()).toBe("v2");
    // Pre-fix the first delivery routed LEGACY while the second routed V2 for the same call.
  });

  it("OVERLAPPING DELIVERY: a NULL snapshot must not route legacy when another delivery has committed v2", async () => {
    const store = engineStore();
    // Delivery A's row read is served from a snapshot taken BEFORE delivery B commits its decision.
    const staleSnapshot = store.table({ snapshotBeforeWrites: true });
    const a = harness("legacy", realDecision(store.rpc({ cacheError: true })), async (opts: LoadOptions) => {
      // between A's failed RPC and A's row read, delivery B records v2 atomically
      await recordInboundEngineDecision(store.rpc({}), CALL, ORG, "v2");
      return await readPersistedEngineDecision(staleSnapshot, CALL, ORG, opts);
    });
    const outcome = await a.run();
    expect(store.saved()).toBe("v2");                                  // B's decision is committed
    expect(outcome.kind).toBe("respond");                              // pre-fix: A proceeded LEGACY anyway
    expect(outcome.kind === "respond" && outcome.reason).toBe("engine_decision_unavailable");
    expect(a.ownerCalls).toBe(0);
  });

  it("the atomic RPC remains the only writer: a NULL row read never records a decision", async () => {
    const store = engineStore();
    const h = harness("legacy", realDecision(store.rpc({ cacheError: true })), realRead(store.table()));
    await h.run();
    expect(store.saved()).toBeNull();
    expect(store.writes).toBe(0);
  });

  it("a persisted LEGACY decision read from the row still wins over a v2 organization flag", async () => {
    const h = harness("v2", realDecision(scriptedRpc([async () => ({ data: null, error: PGRST202 })])),
      realRead(scriptedTable([async () => ({ data: { routing_engine: "legacy" }, error: null })])));
    const outcome = await h.run();
    expect(outcome.kind === "proceed" && outcome.decision.kind).toBe("legacy");
    expect(h.ownerCalls).toBe(0);
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

  it("a STALLED decision RPC on a legacy-flagged organization is UNRESOLVED, not permission to route legacy — and a late success routes nothing", async () => {
    // Corrective pass 7, finding 1: the same duplicate-webhook case, with the RPC stalling instead of
    // erroring. The organization reads legacy; the call may already be v2 work; the stalled read is
    // abandoned at the deadline, the caller is answered on the failure path, and the result that arrives
    // afterwards changes no routing.
    const deadline = createRequestDeadline(REQUEST_DEADLINE_MS);
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    let release: ((v: { data: unknown; error: null }) => void) | null = null;
    const late = new Promise<{ data: unknown; error: { message: string } | null }>((r) => {
      release = r as (v: { data: unknown; error: null }) => void;
    });
    const stalled = scriptedRpc([() => late]);
    const abandon = vi.fn(async () => { await sleep(200); });
    let ownerCalls = 0;
    const run = runInboundStartRequest({
      loadSettings: async () => settingsOk("legacy"),
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
    expect(value.kind === "respond" && value.twiml).toBe(SORRY);
    expect(elapsedMs).toBeLessThanOrEqual(REQUEST_DEADLINE_MS);
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(ownerCalls).toBe(0);
    // The late SUCCESSFUL result (the persisted decision really was v2) arrives after the response and
    // changes nothing: no owner lookup, no second routing decision.
    release?.({ data: { recorded: true, engine: "v2", first: false }, error: null });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ownerCalls).toBe(0);
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
