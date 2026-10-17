import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
/**
 * Dashboard, Goals and selected-user summaries count sales by agency Sold Date. The reader accepts only a payload
 * that names that basis and whose Sold Date windows are the agency calendar dates of the returned instants, so an
 * older backend (entry-time counts) or a UTC-dated window is never shown as Sold Date production.
 */
const io = vi.hoisted(() => ({ data: null as any, rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: io.rpc } }));
import { loadPerformanceDetails, loadPerformanceSummary } from "../performanceSummary";

const org = "11111111-1111-4111-8111-111111111111";
const totals = (over: Record<string, number> = {}) => ({ calls: 0, policies: 0, bookings: 0, annual_premium: 0, monthly_premium: 0,
  unknown_premiums: 0, talk_seconds: 0, workload: 0, leads: 0, estimated_duration_calls: 0, unknown_duration_calls: 0,
  conflicting_duration_calls: 0, ...over });
// Shape and serialization of get_performance_summary for the Teo fixture: as of Oct 16 2026 1:30 PM PDT.
const teoDay = () => ({ organization_id: org, agent_ids: null, scope: "team", period: "day", time_zone: "America/Los_Angeles",
  start_at: "2026-10-16T07:00:00+00:00", end_at: "2026-10-16T20:30:00+00:00",
  previous_start: "2026-10-15T07:00:00+00:00", previous_end: "2026-10-16T07:00:00+00:00", workload_end: "2026-10-17T07:00:00+00:00",
  policy_date_basis: "sold_date", sold_date_from: "2026-10-16", sold_date_through: "2026-10-16",
  previous_sold_date_from: "2026-10-15", previous_sold_date_through: "2026-10-15", undated_policies: 1,
  current: totals(), previous: totals({ policies: 3, annual_premium: 1801.08, monthly_premium: 150.09 }) });

beforeEach(() => {
  io.rpc.mockReset().mockImplementation(() => {
    const q: any = { abortSignal: () => q, then: (yes: any, no: any) => Promise.resolve({ data: io.data, error: null }).then(yes, no) };
    return q;
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T20:30:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("loadPerformanceSummary — Sold Date basis", () => {
  it("accepts the agency Sold Date windows and keeps the undated disclosure", async () => {
    io.data = teoDay();
    const s = await loadPerformanceSummary("day", "team", null);
    expect(s).toMatchObject({ policy_date_basis: "sold_date", sold_date_from: "2026-10-16", previous_sold_date_through: "2026-10-15", undated_policies: 1 });
    expect(s.current.policies).toBe(0);
    expect(s.previous.policies).toBe(3);
  });

  it("uses the agency date late in the evening, never the UTC date", async () => {
    vi.setSystemTime(new Date("2026-10-17T02:00:00Z")); // Oct 16, 7:00 PM PDT
    io.data = { ...teoDay(), end_at: "2026-10-17T02:00:00+00:00" };
    await expect(loadPerformanceSummary("day", "team", null)).resolves.toMatchObject({ sold_date_through: "2026-10-16" });
    io.data = { ...teoDay(), end_at: "2026-10-17T02:00:00+00:00", sold_date_through: "2026-10-17" };
    await expect(loadPerformanceSummary("day", "team", null)).rejects.toThrow("Performance Sold Date window changed. Retry.");
  });

  it("keeps whole calendar weeks across the DST change", async () => {
    vi.setSystemTime(new Date("2026-11-01T20:00:00Z")); // Sunday Nov 1, noon PST, the day DST ends
    io.data = { ...teoDay(), period: "week", start_at: "2026-10-26T07:00:00+00:00", end_at: "2026-11-01T20:00:00+00:00",
      previous_start: "2026-10-19T07:00:00+00:00", previous_end: "2026-10-26T07:00:00+00:00", workload_end: "2026-11-02T08:00:00+00:00",
      sold_date_from: "2026-10-26", sold_date_through: "2026-11-01", previous_sold_date_from: "2026-10-19", previous_sold_date_through: "2026-10-25" };
    await expect(loadPerformanceSummary("week", "team", null)).resolves.toMatchObject({ sold_date_through: "2026-11-01" });
  });

  it("accepts the previous day when the agency's local midnight occurs twice (America/Havana fall-back)", async () => {
    // Nov 1 2026, noon CST. Midnight happened at 04:00Z (CDT) and again at 05:00Z (CST); PostgreSQL starts the day at
    // the later one, so one millisecond before start_at is still Nov 1 locally.
    vi.setSystemTime(new Date("2026-11-01T17:00:00Z"));
    io.data = { ...teoDay(), time_zone: "America/Havana", start_at: "2026-11-01T05:00:00+00:00", end_at: "2026-11-01T17:00:00+00:00",
      previous_start: "2026-10-31T04:00:00+00:00", previous_end: "2026-11-01T05:00:00+00:00", workload_end: "2026-11-02T05:00:00+00:00",
      sold_date_from: "2026-11-01", sold_date_through: "2026-11-01", previous_sold_date_from: "2026-10-31", previous_sold_date_through: "2026-10-31" };
    await expect(loadPerformanceSummary("day", "team", null)).resolves.toMatchObject({ previous_sold_date_through: "2026-10-31" });
  });

  it.each([
    ["missing basis (older backend)", (d: any) => { delete d.policy_date_basis; }],
    ["entry-time basis", (d: any) => { d.policy_date_basis = "created_at"; }],
    ["missing undated count", (d: any) => { delete d.undated_policies; }],
    ["UTC start date", (d: any) => { d.sold_date_from = "2026-10-15"; }],
    ["inclusive previous end", (d: any) => { d.previous_sold_date_through = "2026-10-16"; }],
    ["shifted previous start", (d: any) => { d.previous_sold_date_from = "2026-10-14"; }],
  ])("rejects a %s payload", async (_label, edit) => {
    io.data = teoDay(); edit(io.data);
    await expect(loadPerformanceSummary("day", "team", null)).rejects.toThrow();
  });
});

describe("loadPerformanceDetails — Sold Date basis", () => {
  const details = () => ({ rows: [{ id: "22222222-2222-4222-8222-222222222222", sold_date: "2026-10-15", entered_at: "2026-10-16T19:48:00+00:00" }],
    start_at: "2026-10-01T07:00:00+00:00", end_at: "2026-10-16T20:30:00+00:00", workload_end: "2026-11-01T07:00:00+00:00",
    time_zone: "America/Los_Angeles", scope: "team", organization_id: org,
    policy_date_basis: "sold_date", sold_date_from: "2026-10-01", sold_date_through: "2026-10-16" });

  it("returns policy rows with their Sold Date and entry time", async () => {
    io.data = details();
    const d = await loadPerformanceDetails("policies_sold", "month", "team", null, "2026-10-16T20:30:00Z", 0);
    expect(d.rows[0]).toMatchObject({ sold_date: "2026-10-15", entered_at: "2026-10-16T19:48:00+00:00" });
  });

  it("rejects details without the Sold Date basis", async () => {
    io.data = details(); delete (io.data as any).policy_date_basis;
    await expect(loadPerformanceDetails("policies_sold", "month", "team", null, "2026-10-16T20:30:00Z", 0)).rejects.toThrow();
  });
});
