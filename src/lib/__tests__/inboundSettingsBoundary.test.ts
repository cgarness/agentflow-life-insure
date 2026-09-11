// Corrective pass, defect 4 — settings and owner reads at the REAL dependency boundary (a fake PostgREST
// query builder that fails a scripted number of times). A failed read is never a different routing
// decision: no silent legacy downgrade, no "unassigned caller" from an unavailable owner lookup.
import { describe, expect, it } from "vitest";
import {
  StageReadError,
  decideInboundStart,
  isSchemaAbsentError,
  loadAttemptRow,
  loadCallIdentity,
  loadV2RoutingSettings,
  resolveContactAssignedAgent,
  resolveInboundStart,
  runInfrastructureFailure,
  withRetries,
  type QueryDb,
} from "../../../supabase/functions/twilio-voice-inbound/settings";

const ORG = "aaaaaaaa-0000-0000-0000-00000000000a";
const A1 = "aaaaaaaa-0000-0000-0000-0000000000a1";
const CALL = "cccccccc-0000-0000-0000-000000000001";

type Answer = { data?: unknown; error?: { message: string; code?: string } | null; throw?: boolean; hang?: boolean };

/** Scripted query builder: each `.from()` consumes the next answer; records every call. */
function fakeDb(answers: Answer[]) {
  const calls: Array<{ table: string; ops: string[] }> = [];
  const db = {
    from(table: string) {
      const rec = { table, ops: [] as string[] };
      calls.push(rec);
      const answer = answers.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "maybeSingle"]) {
        builder[m] = () => { rec.ops.push(m); return builder; };
      }
      builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        if (answer.hang) return;                        // never settles (upstream stall)
        if (answer.throw) return reject(new Error("socket hang up"));
        return resolve({ data: answer.data ?? null, error: answer.error ?? null });
      };
      return builder;
    },
  };
  return { db, calls };
}
const sleeps: number[] = [];
const opts = { sleep: async (ms: number) => { sleeps.push(ms); } };

describe("loadV2RoutingSettings — bounded retries, explicit failure, truthful 'not configured'", () => {
  it("a transient error is retried and the third read succeeds (attempts=3, engine=v2)", async () => {
    const { db, calls } = fakeDb([{ error: { message: "connection reset" } }, { throw: true }, { data: { routing_engine: "v2", inbound_group_agent_ids: [A1], browser_ring_seconds: 20, mobile_ring_seconds: 25 } }]);
    const r = await loadV2RoutingSettings(db, ORG, opts);
    expect(r).toMatchObject({ ok: true, configured: true, attempts: 3, settings: { engine: "v2", groupIds: [A1], browserRingSeconds: 20, mobileRingSeconds: 25 } });
    expect(calls).toHaveLength(3);
  });

  it("a persistent failure is reported as a FAILURE — never as legacy", async () => {
    const { db } = fakeDb([{ error: { message: "db down" } }, { error: { message: "db down" } }, { error: { message: "db down" } }]);
    const r = await loadV2RoutingSettings(db, ORG, opts);
    expect(r).toEqual({ ok: false, error: "db down", attempts: 3 });
  });

  it("no settings row is a SUCCESSFUL 'not configured' ⇒ legacy", async () => {
    const { db } = fakeDb([{ data: null }]);
    const r = await loadV2RoutingSettings(db, ORG, opts);
    expect(r).toMatchObject({ ok: true, configured: false, settings: { engine: "legacy", groupIds: [] } });
  });
});

describe("resolveContactAssignedAgent — unassigned vs unavailable", () => {
  it("a contact without an assigned agent is SUCCESSFULLY unassigned (agentId null)", async () => {
    const { db } = fakeDb([{ data: { assigned_agent_id: null } }]);
    expect(await resolveContactAssignedAgent(db, ORG, "llllllll-0000-0000-0000-000000000001", "lead", opts)).toEqual({ ok: true, agentId: null, attempts: 1 });
  });
  it("an assigned agent is returned; a missing contact row is unassigned; no contact id skips the read", async () => {
    const { db, calls } = fakeDb([{ data: { assigned_agent_id: A1 } }, { data: null }]);
    expect(await resolveContactAssignedAgent(db, ORG, "llllllll-0000-0000-0000-000000000001", "client", opts)).toEqual({ ok: true, agentId: A1, attempts: 1 });
    expect(calls[0].table).toBe("clients");
    expect(await resolveContactAssignedAgent(db, ORG, "llllllll-0000-0000-0000-000000000002", "recruit", opts)).toEqual({ ok: true, agentId: null, attempts: 1 });
    expect(await resolveContactAssignedAgent(db, ORG, null, "lead", opts)).toEqual({ ok: true, agentId: null, attempts: 0 });
  });
  it("a lookup that keeps failing is a FAILURE — never 'no owner'", async () => {
    const { db } = fakeDb([{ throw: true }, { throw: true }, { throw: true }]);
    const r = await resolveContactAssignedAgent(db, ORG, "llllllll-0000-0000-0000-000000000001", "lead", opts);
    expect(r).toEqual({ ok: false, error: "socket hang up", attempts: 3 });
  });
});

describe("decideInboundStart — the handler's decision at the boundary", () => {
  const v2 = { ok: true as const, configured: true, attempts: 1, settings: { engine: "v2" as const, groupIds: [A1], browserRingSeconds: 20, mobileRingSeconds: 20 } };
  it("settings unavailable ⇒ infrastructure failure, not legacy", () => {
    expect(decideInboundStart({ ok: false, error: "db down", attempts: 3 }, null)).toMatchObject({ kind: "infrastructure_failure", reason: "settings_unavailable" });
  });
  it("owner lookup unavailable on a v2 organization ⇒ infrastructure failure, not the group", () => {
    expect(decideInboundStart(v2, { ok: false, error: "boom", attempts: 3 })).toMatchObject({ kind: "infrastructure_failure", reason: "owner_lookup_unavailable" });
    expect(decideInboundStart(v2, null)).toMatchObject({ kind: "infrastructure_failure", reason: "owner_lookup_unavailable" });
  });
  it("legacy engine never needs the owner lookup; v2 carries the successful owner result (null = unassigned)", () => {
    expect(decideInboundStart({ ...v2, settings: { ...v2.settings, engine: "legacy" } }, null)).toMatchObject({ kind: "legacy" });
    expect(decideInboundStart(v2, { ok: true, agentId: null, attempts: 1 })).toMatchObject({ kind: "v2", contactOwnerId: null });
    expect(decideInboundStart(v2, { ok: true, agentId: A1, attempts: 1 })).toMatchObject({ kind: "v2", contactOwnerId: A1 });
  });
});

describe("loadCallIdentity — the stored parent every stage callback is bound to", () => {
  it("returns the stored row after a retry; reports failure after exhausting attempts; null for an unknown row", async () => {
    const { db } = fakeDb([{ throw: true }, { data: { id: CALL, organization_id: ORG, twilio_call_sid: "CA" + "1".repeat(32) } }]);
    expect(await loadCallIdentity(db, CALL, opts)).toMatchObject({ ok: true, attempts: 2, call: { twilio_call_sid: "CA" + "1".repeat(32) } });
    const { db: down } = fakeDb([{ throw: true }, { throw: true }, { throw: true }]);
    expect(await loadCallIdentity(down, CALL, opts)).toMatchObject({ ok: false, attempts: 3 });
    const { db: none } = fakeDb([{ data: null }]);
    expect(await loadCallIdentity(none, CALL, opts)).toEqual({ ok: true, call: null, attempts: 1 });
  });
});

describe("schema-absent columns (plan §14 rollback state) degrade to legacy — deterministically, on the first attempt", () => {
  it("recognises PostgreSQL 42703/42P01 and PostgREST schema-cache errors", () => {
    expect(isSchemaAbsentError({ message: "column inbound_routing_settings.routing_engine does not exist", code: "42703" })).toBe(true);
    expect(isSchemaAbsentError({ message: "relation \"public.inbound_routing_settings\" does not exist", code: "42P01" })).toBe(true);
    expect(isSchemaAbsentError({ message: "Could not find the 'routing_engine' column of 'inbound_routing_settings' in the schema cache", code: "PGRST204" })).toBe(true);
    expect(isSchemaAbsentError({ message: "connection reset" })).toBe(false);
    expect(isSchemaAbsentError({ message: "canceling statement due to statement timeout", code: "57014" })).toBe(false);
  });

  it("M5 rolled back (42703) ⇒ ok, legacy, schemaAbsent, ONE attempt — never an infrastructure failure", async () => {
    const { db, calls } = fakeDb([{ error: { message: "column inbound_routing_settings.routing_engine does not exist", code: "42703" } }]);
    const r = await loadV2RoutingSettings(db, ORG, opts);
    expect(r).toMatchObject({ ok: true, configured: false, schemaAbsent: true, attempts: 1, settings: { engine: "legacy" } });
    expect(calls).toHaveLength(1);
    expect(decideInboundStart(r, null).kind).toBe("legacy");
  });

  it("a PostgREST schema-cache miss (PGRST204) is the same rollback state", async () => {
    const { db, calls } = fakeDb([{ error: { message: "Could not find the 'browser_ring_seconds' column of 'inbound_routing_settings' in the schema cache", code: "PGRST204" } }]);
    const r = await loadV2RoutingSettings(db, ORG, opts);
    expect(r).toMatchObject({ ok: true, schemaAbsent: true, attempts: 1 });
    expect(calls).toHaveLength(1);
  });
});

describe("withRetries — bounded in COUNT and in WALL TIME", () => {
  it("an attempt that never settles is abandoned at the per-attempt ceiling; all attempts stay bounded", async () => {
    const { db, calls } = fakeDb([{ hang: true }, { hang: true }, { hang: true }]);
    const r = await withRetries(() => (db as QueryDb).from("inbound_routing_settings").select("x").eq("a", 1).maybeSingle(), { ...opts, attemptTimeoutMs: 15 });
    expect(r).toMatchObject({ ok: false, attempts: 3, timedOut: true });
    expect(r.ok === false && r.error).toMatch(/exceeded 15 ms/);
    expect(calls).toHaveLength(3);
  });

  it("no further attempt starts once the total budget is spent", async () => {
    let clock = 0;
    const { db, calls } = fakeDb([{ error: { message: "db down" } }, { error: { message: "db down" } }, { error: { message: "db down" } }]);
    const r = await withRetries(
      () => { clock += 40; return (db as QueryDb).from("t").select("x").eq("a", 1).maybeSingle(); },
      { ...opts, budgetMs: 250, now: () => clock },
    );
    // attempt 1 (40 ms) + 100 ms pause < 250 ⇒ attempt 2; 80 ms + 200 ms pause ≥ 250 ⇒ no third attempt
    expect(r).toMatchObject({ ok: false, attempts: 2 });
    expect(r.ok === false && r.error).toMatch(/retry budget of 250 ms exhausted/);
    expect(calls).toHaveLength(2);
  });
});

describe("direct line (P1): the contact-owner lookup is irrelevant and its failure cannot change the outcome", () => {
  const v2 = { ok: true as const, configured: true, attempts: 1, settings: { engine: "v2" as const, groupIds: [], browserRingSeconds: 20, mobileRingSeconds: 20 } };
  it("a failed or absent owner lookup still proceeds as v2 when the number is a direct line", () => {
    expect(decideInboundStart(v2, { ok: false, error: "leads read failed", attempts: 3 }, A1)).toEqual({ kind: "v2", settings: v2.settings, contactOwnerId: null });
    expect(decideInboundStart(v2, null, A1)).toEqual({ kind: "v2", settings: v2.settings, contactOwnerId: null });
  });
  it("without a direct line the same failure is still an infrastructure failure", () => {
    expect(decideInboundStart(v2, { ok: false, error: "leads read failed", attempts: 3 }, null).kind).toBe("infrastructure_failure");
  });
});

describe("loadAttemptRow — a failed attempt read is never 'no attempt'", () => {
  const row = { id: "e1", stage: "owner_mobile", terminal: false };
  it("retries a transient error and returns the row", async () => {
    const { db, calls } = fakeDb([{ error: { message: "reset" } }, { data: row }]);
    expect(await loadAttemptRow(db, ORG, "e1", opts)).toEqual({ ok: true, attempt: row, attempts: 2 });
    expect(calls).toHaveLength(2);
  });
  it("no row is a SUCCESSFUL null; a persistent failure is reported and surfaces as StageReadError at the deps boundary", async () => {
    expect(await loadAttemptRow(fakeDb([{ data: null }]).db, ORG, "e1", opts)).toEqual({ ok: true, attempt: null, attempts: 1 });
    const r = await loadAttemptRow(fakeDb([{ throw: true }, { throw: true }, { throw: true }]).db, ORG, "e1", opts);
    expect(r).toEqual({ ok: false, error: "socket hang up", attempts: 3 });
    const err = new StageReadError("inbound_route_attempts", r.ok === false ? r.error : "");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("inbound_route_attempts unavailable: socket hang up");
  });
});

describe("the handler's failure glue — an infrastructure failure is ANSWERED, a routable decision proceeds", () => {
  const legacy = { kind: "legacy" as const, settings: { engine: "legacy" as const, groupIds: [], browserRingSeconds: 20, mobileRingSeconds: 20 } };
  it("a failure decision runs the documented side effects IN ORDER and responds with the sorry TwiML", async () => {
    const order: string[] = [];
    const outcome = await resolveInboundStart(
      { kind: "infrastructure_failure", reason: "settings_unavailable", error: "db down" },
      async (reason) => {
        const result = await runInfrastructureFailure({
          markMissed: async () => { order.push("missed"); },
          finalize: async () => { order.push("finalize"); },
        });
        order.push(result);
        return `<Response><Say>sorry ${reason}</Say><Hangup/></Response>`;
      },
    );
    expect(outcome).toEqual({ kind: "respond", twiml: "<Response><Say>sorry settings_unavailable</Say><Hangup/></Response>", reason: "settings_unavailable" });
    expect(order).toEqual(["missed", "finalize", "completed"]);
  });
  it("a routable decision performs NO side effects", async () => {
    let called = 0;
    const outcome = await resolveInboundStart(legacy, async () => { called += 1; return "x"; });
    expect(outcome).toEqual({ kind: "proceed", decision: legacy });
    expect(called).toBe(0);
  });
  it("a missed-mark failure still finalizes; a stalled side effect is cut at the deadline and the greeting is still delivered", async () => {
    const order: string[] = [];
    const errored = await runInfrastructureFailure({
      markMissed: async () => { throw new Error("rpc down"); },
      finalize: async () => { order.push("finalize"); },
    });
    expect(errored).toBe("errored");
    expect(order).toEqual(["finalize"]);
    const timed = await runInfrastructureFailure(
      { markMissed: async () => {}, finalize: () => new Promise(() => {}) },
      { deadlineMs: 20 },
    );
    expect(timed).toBe("timed_out");
  });
});
