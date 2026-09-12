// Corrective pass 5, finding 4 — v2 failure notifications honour the COMMITTED D13 snapshot, through the actual
// failure-dependency wiring (failure.ts) and the REAL shared notification helper (_shared/notifications.ts +
// notification-recipients.ts) against a fake PostgREST client. Agent A is the saved recipient; B owns the
// dialed number and would be chosen by the legacy tiers. A receives exactly one correctly labelled alert
// through the SQL convergence rule; B receives none. A failed abandon decision triggers no classification.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MISSED_CALL_NOTIFICATION_PROJECTION,
  infrastructureFailureDeps,
  notifyAfterAbandon,
  type FailureDb,
  type MissedCallRow,
} from "../../../supabase/functions/twilio-voice-inbound/failure";
import { createRequestDeadline, runInfrastructureFailure } from "../../../supabase/functions/twilio-voice-inbound/settings";
import { insertMissedCallNotifications } from "../../../supabase/functions/_shared/notifications";

const ORG = "11111111-1111-4111-8111-111111111111";
const CALL = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";   // intended recipient (the D13 snapshot)
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";   // number owner (what the legacy tiers would pick)
const NUMBER = "+15550001111";

const REQUIRED_COLUMNS = ["id", "organization_id", "is_missed", "missed_reason", "missed_for_agent_id", "missed_recipient_ids", "missed_notified_at", "routed_agent_ids", "caller_id_used", "contact_id", "contact_name", "contact_phone"];

/** A recording PostgREST fake: the abandon RPC commits the D13 classification; converge is recorded; legacy upserts are recorded. */
function fakeDb(opts: { abandonFails?: boolean; convergeFailsTimes?: number; abandonCommits?: boolean } = {}) {
  const state = {
    call: {
      id: CALL, organization_id: ORG, contact_id: null, contact_type: null, contact_name: null, contact_phone: "+19995551234",
      agent_id: null, caller_id_used: NUMBER, routed_agent_ids: [] as string[], is_missed: false, missed_reason: null,
      missed_for_agent_id: null, missed_recipient_ids: [] as string[], missed_notified_at: null as string | null,
    } as MissedCallRow & Record<string, unknown>,
    rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
    projections: [] as string[],
    legacyUpserts: [] as unknown[][],
    convergeFailures: opts.convergeFailsTimes ?? 0,
    converged: 0,
  };
  const project = (cols: string) => {
    const wanted = cols.split(",").map((c) => c.trim());
    const out: Record<string, unknown> = {};
    for (const c of wanted) if (c in state.call) out[c] = (state.call as Record<string, unknown>)[c];
    return out;
  };
  const db: FailureDb = {
    rpc: async (name, args) => {
      state.rpcCalls.push({ name, args });
      if (name === "abandon_inbound_routing") {
        if (opts.abandonFails) return { data: null, error: { message: "canceling statement due to statement timeout" } };
        if (opts.abandonCommits !== false) {
          // the SQL decision: finalize + D13 classification with the intended recipient(s)
          state.call.is_missed = true; state.call.missed_reason = "no_answer";
          state.call.missed_recipient_ids = (args.p_recipient_ids as string[]).length ? (args.p_recipient_ids as string[]) : [A];
          state.call.missed_for_agent_id = (args.p_for_agent_id as string | null) ?? A;
        }
        return { data: { updated: true }, error: null };
      }
      if (name === "converge_inbound_notifications") {
        if (state.convergeFailures > 0) { state.convergeFailures -= 1; return { data: null, error: { message: "deadlock detected" } }; }
        state.converged += 1; state.call.missed_notified_at = new Date().toISOString();
        return { data: { call_id: CALL, missed_notified: true }, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      let cols = "";
      const self = () => b;
      b.select = (c: string) => { cols = c; return b; };
      b.eq = self; b.in = self; b.not = self; b.limit = self; b.order = self;
      b.maybeSingle = async () => {
        if (table === "calls") { state.projections.push(cols); return { data: project(cols), error: null }; }
        if (table === "phone_numbers") return { data: { assigned_to: B }, error: null };
        return { data: null, error: null };
      };
      b.single = b.maybeSingle;
      b.upsert = async (rows: unknown[]) => { if (table === "notifications") state.legacyUpserts.push(rows); return { error: null }; };
      b.then = (resolve: (v: unknown) => void) => {
        // list queries (profiles validation for the legacy tiers)
        if (table === "profiles") return resolve({ data: [{ id: A, first_name: "A" }, { id: B, first_name: "B" }], error: null });
        return resolve({ data: [], error: null });
      };
      return b;
    },
  };
  return { db, state };
}

const notifier = (db: FailureDb, row: MissedCallRow) => insertMissedCallNotifications(db as never, row as never);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false; let value: T | undefined; let error: unknown;
  p.then((v) => { done = true; value = v; }, (e) => { done = true; error = e; });
  for (let i = 0; i < 200 && !done; i++) await vi.advanceTimersByTimeAsync(50);
  if (error) throw error;
  return value as T;
}

describe("failure notification — the committed D13 snapshot decides, through the real helper", () => {
  it("saved recipient A vs number owner B: A is alerted once via the SQL convergence rule, B never (no legacy tier)", async () => {
    const { db, state } = fakeDb();
    const handed: Promise<unknown>[] = [];
    const deps = infrastructureFailureDeps(db, notifier, { callRowId: CALL, organizationId: ORG, reason: "planning_deadline" }, (p) => { handed.push(p); });
    const result = await settle(runInfrastructureFailure(deps, { deadline: createRequestDeadline(12_000) }));
    expect(result).toBe("completed");
    await settle(Promise.all(handed));
    expect(state.rpcCalls.map((c) => c.name)).toEqual(["abandon_inbound_routing", "converge_inbound_notifications"]);   // decision first, then convergence
    expect(state.converged).toBe(1);
    expect(state.legacyUpserts).toEqual([]);                        // pre-fix: the legacy tiers upserted an alert for B
    expect(state.call.missed_recipient_ids).toEqual([A]);
    // every projection on this path carries the D13 columns (tier 0 cannot be bypassed by an incomplete row)
    expect(state.projections.length).toBeGreaterThan(0);
    for (const p of state.projections) for (const col of REQUIRED_COLUMNS) expect(p).toContain(col);
    expect(MISSED_CALL_NOTIFICATION_PROJECTION).toContain("missed_recipient_ids");
  });

  it("reassignment: the number owner changes and the contact is reassigned, the committed snapshot still decides", async () => {
    const { db, state } = fakeDb();
    state.call.agent_id = null; (state.call as Record<string, unknown>).contact_id = "33333333-3333-4333-8333-333333333333";
    const handed: Promise<unknown>[] = [];
    const deps = infrastructureFailureDeps(db, notifier, { callRowId: CALL, organizationId: ORG, reason: "stage_deadline:owner_browser", recipients: [A] }, (p) => { handed.push(p); });
    await settle(runInfrastructureFailure(deps, { deadline: createRequestDeadline(12_000) }));
    await settle(Promise.all(handed));
    expect(state.converged).toBe(1);
    expect(state.legacyUpserts).toEqual([]);
    expect(state.rpcCalls.find((c) => c.name === "abandon_inbound_routing")?.args.p_recipient_ids).toEqual([A]);
  });

  it("retries: a failed convergence is reported as retryable and never falls back to the legacy tiers; the next attempt converges", async () => {
    const { db, state } = fakeDb({ convergeFailsTimes: 1 });
    const handed: Promise<unknown>[] = [];
    const deps = infrastructureFailureDeps(db, notifier, { callRowId: CALL, organizationId: ORG, reason: "planning_deadline" }, (p) => { handed.push(p); });
    await settle(runInfrastructureFailure(deps, { deadline: createRequestDeadline(12_000) }));
    await settle(Promise.all(handed));
    expect(state.converged).toBe(0);
    expect(state.legacyUpserts).toEqual([]);                        // no fallback blast to B
    // the durable sweep (or a later attempt) converges from the same committed row
    const again = await settle(notifyAfterAbandon(db, notifier, CALL, ORG));
    expect(again.kind).toBe("delivered");
    expect(state.converged).toBe(1);
    const third = await settle(notifyAfterAbandon(db, notifier, CALL, ORG));
    expect(third).toEqual({ kind: "skipped", reason: "already_notified" });   // exactly one alert
  });

  it("a stalled notification never delays the failure response; the decision was still awaited", async () => {
    const { db, state } = fakeDb();
    const handed: Promise<unknown>[] = [];
    const stalled = infrastructureFailureDeps(db, () => new Promise(() => {}), { callRowId: CALL, organizationId: ORG, reason: "planning_deadline" }, (p) => { handed.push(p); });
    const t0 = Date.now();
    const result = await settle(runInfrastructureFailure(stalled, { deadline: createRequestDeadline(12_000) }));
    expect(result).toBe("completed");
    expect(Date.now() - t0).toBeLessThan(500);
    expect(state.call.is_missed).toBe(true);
    expect(handed).toHaveLength(1);                                 // the stalled work lives in the background only
  });

  it("a FAILED abandon decision triggers no notification and no separate legacy classification", async () => {
    const { db, state } = fakeDb({ abandonFails: true });
    const handed: Promise<unknown>[] = [];
    const notify = vi.fn(notifier);
    const deps = infrastructureFailureDeps(db, notify, { callRowId: CALL, organizationId: ORG, reason: "planning_deadline" }, (p) => { handed.push(p); });
    const result = await settle(runInfrastructureFailure(deps, { deadline: createRequestDeadline(12_000) }));
    expect(result).toBe("errored");
    await settle(Promise.all(handed));
    expect(notify).not.toHaveBeenCalled();
    expect(state.call.is_missed).toBe(false);
    expect(state.legacyUpserts).toEqual([]);
    expect(state.rpcCalls.map((c) => c.name)).toEqual(["abandon_inbound_routing"]);
  });

  it("a decision that has not landed yet is skipped by the notifier (no classification), never routed to B", async () => {
    const { db, state } = fakeDb({ abandonCommits: false });
    const r = await settle(notifyAfterAbandon(db, notifier, CALL, ORG));
    expect(r).toEqual({ kind: "skipped", reason: "not_missed" });
    expect(state.legacyUpserts).toEqual([]);
    expect(state.converged).toBe(0);
  });
});
