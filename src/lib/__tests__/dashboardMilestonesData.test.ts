import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Client Milestones data access: what is read (clients only, never leads), how scope
 * is applied, that a truncated read is never complete (R4), that failures throw, and
 * that writes go only through the two review RPCs and never report a write that did
 * not happen.
 */

type Call = { table: string; ops: Array<[string, unknown[]]> };
type Result = { data: unknown; error: unknown; count?: number | null };

const h = vi.hoisted(() => ({
  calls: [] as Call[],
  respond: ((_call: Call): Result => ({ data: [], error: null, count: 0 })) as (call: Call) => Result,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: null, error: null } as Result,
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "gt", "or", "order", "limit", "abortSignal"]) {
      q[op] = (...args: unknown[]) => {
        call.ops.push([op, args]);
        return q;
      };
    }
    q.then = (yes: (v: Result) => unknown, no: (e: unknown) => unknown) => {
      h.calls.push(call);
      return Promise.resolve(h.respond(call)).then(yes, no);
    };
    return q;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    h.rpcCalls.push({ fn, args });
    return Promise.resolve(h.rpcResult);
  };
  return { supabase: { from, rpc } };
});
vi.mock("@/lib/pageActivity", () => ({ assertPageActive: () => undefined }));

import {
  clearMilestoneReview,
  loadClientMilestones,
  MILESTONE_CLIENT_CAP,
  remindAtFor,
  reviewInputFor,
  setMilestoneReview,
} from "@/lib/dashboard-milestones-data";
import { readAllExact } from "@/lib/paged-exact-read";
import type { Milestone } from "@/lib/dashboard-milestones";

const USER = "aaaa0000-0000-4000-8000-000000000001";
const ORG = "bbbb0000-0000-4000-8000-000000000002";
const CLIENT = "cccc0000-0000-4000-8000-000000000003";
const REVIEW = "dddd0000-0000-4000-8000-000000000004";
const NOW = new Date(2026, 9, 29, 12);
const OFF = { reviewsEnabled: false, firstPaymentStart: null };
const ON = { reviewsEnabled: true, firstPaymentStart: "2026-10-01" };
const signal = () => new AbortController().signal;

const ops = (call: Call, op: string) => call.ops.filter(([name]) => name === op).map(([, args]) => args);
const clientRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id, first_name: "Pat", last_name: "Lee", phone: "5550001111", created_at: "2026-01-01T12:00:00Z",
  date_of_birth: "1960-11-01", effective_date: null, draft_date: null, primary_policy_id: null,
  policy_type: "Term", carrier: "", policy_number: "", premium: 0, face_amount: 0, sold_date: null, custom_fields: null, ...extra,
});

beforeEach(() => {
  h.calls = [];
  h.rpcCalls = [];
  h.respond = () => ({ data: [], error: null, count: 0 });
  h.rpcResult = { data: null, error: null };
});

describe("readAllExact (R4: truncation is never silent)", () => {
  const pages = (rows: { id: string }[], serverLimit: number, count: number | null) =>
    vi.fn(async (afterId: string | null, limit: number) => {
      const start = afterId ? rows.findIndex((r) => r.id === afterId) + 1 : 0;
      return { data: rows.slice(start, start + Math.min(limit, serverLimit)), error: null, count };
    });
  const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(5, "0") }));

  it("keeps reading when the server returns fewer rows than asked for", async () => {
    const page = pages(ids(25), 10, 25);
    const result = await readAllExact(page, { context: "t", pageSize: 100 });
    expect(result).toMatchObject({ complete: true, total: 25 });
    expect(result.rows).toHaveLength(25);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it("is incomplete at the cap and reports the server's total", async () => {
    const result = await readAllExact(pages(ids(30), 100, 30), { context: "t", pageSize: 10, cap: 20 });
    expect(result).toMatchObject({ complete: false, total: 30 });
    expect(result.rows).toHaveLength(20);
  });

  it("is complete exactly at the cap when that is everything", async () => {
    const result = await readAllExact(pages(ids(20), 100, 20), { context: "t", pageSize: 10, cap: 20 });
    expect(result.complete).toBe(true);
  });

  it("without a count, completeness needs an empty page; the cap alone is incomplete", async () => {
    expect((await readAllExact(pages(ids(15), 100, null), { context: "t", pageSize: 10 })).complete).toBe(true);
    expect((await readAllExact(pages(ids(15), 100, null), { context: "t", pageSize: 10, cap: 15 })).complete).toBe(false);
  });

  it("stops (incomplete) when a page repeats rows instead of advancing", async () => {
    const page = vi.fn(async () => ({ data: ids(3), error: null, count: null }));
    const result = await readAllExact(page, { context: "t", pageSize: 3 });
    expect(result).toMatchObject({ complete: false });
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("throws on a returned error instead of returning the rows read so far", async () => {
    let n = 0;
    const page = async () => (n++ === 0 ? { data: ids(10), error: null, count: 20 } : { data: null, error: { message: "timeout" } });
    await expect(readAllExact(page, { context: "t", pageSize: 10 })).rejects.toThrow();
  });
});

describe("loadClientMilestones", () => {
  it("reads only clients, scoped to the organization and (filtered) to the viewer", async () => {
    h.respond = () => ({ data: [clientRow(CLIENT)], error: null, count: 1 });
    const load = await loadClientMilestones({ userId: USER, organizationId: ORG, isFiltered: true }, OFF, 30, signal(), NOW);
    expect(h.calls.map((c) => c.table)).toEqual(["clients"]);
    const [clients] = h.calls;
    expect(ops(clients, "eq")).toEqual([["organization_id", ORG], ["assigned_agent_id", USER]]);
    expect(ops(clients, "order")).toEqual([["id", { ascending: true }]]);
    expect(ops(clients, "select")[0][1]).toEqual({ count: "exact" });
    expect(load).toMatchObject({ complete: true, clientsLoaded: 1, clientsTotal: 1 });
    expect(load.items[0]).toMatchObject({ kind: "client_birthday", clientId: CLIENT, status: "pending" });
  });

  it("does not filter by agent for an Admin team view and never queries leads", async () => {
    await loadClientMilestones({ userId: USER, organizationId: ORG, isFiltered: false }, OFF, 30, signal(), NOW);
    expect(h.calls.every((c) => c.table === "clients")).toBe(true);
    expect(ops(h.calls[0], "eq")).toEqual([["organization_id", ORG]]);
  });

  it("reads the viewer's own review rows only when reviews are on", async () => {
    await loadClientMilestones({ userId: USER, organizationId: ORG, isFiltered: true }, ON, 30, signal(), NOW);
    const reviews = h.calls.find((c) => c.table === "dashboard_milestone_reviews")!;
    expect(ops(reviews, "eq")).toEqual([["user_id", USER], ["organization_id", ORG]]);
    expect(ops(reviews, "or")[0][0]).toBe("milestone_kind.eq.first_payment,occurrence_date.gte.2025-10-28");
  });

  it("marks a truncated client read incomplete, with the server's total", async () => {
    let served = 0;
    h.respond = (call) => {
      if (call.table !== "clients") return { data: [], error: null, count: 0 };
      const limit = ops(call, "limit")[0][0] as number;
      const rows = Array.from({ length: limit }, () => clientRow(`cccc0000-0000-4000-8000-${String(served++).padStart(12, "0")}`));
      return { data: rows, error: null, count: 6212 };
    };
    const load = await loadClientMilestones({ userId: USER, organizationId: ORG, isFiltered: false }, OFF, 30, signal(), NOW);
    expect(load).toMatchObject({ complete: false, clientsLoaded: MILESTONE_CLIENT_CAP, clientsTotal: 6212 });
  });

  it("fails on a client read error and on a review read error (never an empty list)", async () => {
    h.respond = (call) => (call.table === "clients" ? { data: null, error: { message: "denied" } } : { data: [], error: null, count: 0 });
    await expect(loadClientMilestones({ userId: USER, organizationId: ORG, isFiltered: true }, OFF, 30, signal(), NOW)).rejects.toThrow();
    h.respond = (call) => (call.table === "clients" ? { data: [], error: null, count: 0 } : { data: null, error: { message: "denied" } });
    await expect(loadClientMilestones({ userId: USER, organizationId: ORG, isFiltered: true }, ON, 30, signal(), NOW)).rejects.toThrow();
  });

  it("fails closed without an organization or with an invalid user id", async () => {
    await expect(loadClientMilestones({ userId: USER, organizationId: null, isFiltered: true }, OFF, 30, signal(), NOW)).rejects.toThrow();
    await expect(loadClientMilestones({ userId: "not-a-uuid", organizationId: ORG, isFiltered: true }, OFF, 30, signal(), NOW)).rejects.toThrow();
    expect(h.calls).toEqual([]);
  });
});

describe("review actions", () => {
  const item = {
    kind: "policy_anniversary", clientId: CLIENT, eventKey: "primary", occurrenceDate: "2026-11-05",
  } as Milestone;
  const stored = {
    id: REVIEW, milestone_kind: "policy_anniversary", client_id: CLIENT, event_key: "primary", occurrence_year: 2026,
    occurrence_date: "2026-11-05", state: "reviewed", remind_at: null, updated_at: "2026-10-29T19:00:00.123456+00:00",
  };

  it("Mark Reviewed sends only the event identity; user and organization are derived by the server", async () => {
    h.rpcResult = { data: stored, error: null };
    const row = await setMilestoneReview(reviewInputFor(item, { state: "reviewed" })!);
    expect(row.id).toBe(REVIEW);
    expect(h.rpcCalls).toEqual([{
      fn: "set_dashboard_milestone_review",
      args: { p_kind: "policy_anniversary", p_client_id: CLIENT, p_event_key: "primary", p_occurrence_date: "2026-11-05", p_state: "reviewed", p_remind_at: undefined },
    }]);
    expect(JSON.stringify(h.rpcCalls)).not.toMatch(/user_id|organization_id/);
  });

  it("Remind Later stores the local start of the chosen day", async () => {
    h.rpcResult = { data: { ...stored, state: "snoozed", remind_at: "2026-11-01T07:00:00+00:00" }, error: null };
    const remindAt = remindAtFor("three_days", NOW);
    expect([remindAt.getFullYear(), remindAt.getMonth(), remindAt.getDate(), remindAt.getHours()]).toEqual([2026, 10, 1, 0]);
    await setMilestoneReview(reviewInputFor(item, { state: "snoozed", remindAt })!);
    expect(h.rpcCalls[0].args.p_remind_at).toBe(remindAt.toISOString());
  });

  it("treats an RPC error or an empty answer as a failure", async () => {
    h.rpcResult = { data: null, error: { message: "permission denied for table" } };
    await expect(setMilestoneReview(reviewInputFor(item, { state: "reviewed" })!)).rejects.toThrow("Couldn't update this reminder");
    h.rpcResult = { data: null, error: null };
    await expect(setMilestoneReview(reviewInputFor(item, { state: "reviewed" })!)).rejects.toThrow("Couldn't update this reminder");
  });

  it("refuses invalid input before any request", async () => {
    await expect(setMilestoneReview({ ...reviewInputFor(item, { state: "reviewed" })!, remindAt: "2026-11-01T00:00:00Z" })).rejects.toThrow();
    expect(reviewInputFor({ ...item, eventKey: null }, { state: "reviewed" })).toBeNull();
    expect(h.rpcCalls).toEqual([]);
  });

  it("Undo removes the row only if unchanged since the action", async () => {
    h.rpcResult = { data: true, error: null };
    await clearMilestoneReview({ id: REVIEW, updatedAt: stored.updated_at });
    expect(h.rpcCalls[0]).toEqual({ fn: "clear_dashboard_milestone_review", args: { p_id: REVIEW, p_expected_updated_at: stored.updated_at } });
    h.rpcResult = { data: false, error: null };
    await expect(clearMilestoneReview({ id: REVIEW, updatedAt: stored.updated_at })).rejects.toThrow("changed since");
  });
});
