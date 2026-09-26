import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor, act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The Dashboard used to re-run its stat queries every 2 minutes in every tab,
 * visible or not. It now refreshes only through one bounded Refresh control,
 * which reloads the stat cards and asks every widget for one reload.
 */

type QueryResult = { data: unknown; error: unknown; count?: number | null };

const h = vi.hoisted(() => ({
  fromCalls: [] as string[],
  result: ((_table: string): QueryResult => ({ data: [], error: null, count: 0 })) as (table: string) => QueryResult,
  deferNext: null as null | { table: string; resolvers: Array<(v: QueryResult) => void> },
  signals: [] as AbortSignal[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ["select", "eq", "in", "gte", "lt", "lte", "not", "or", "order", "limit"]) q[m] = chain;
    q.abortSignal = (signal: AbortSignal) => {
      h.signals.push(signal);
      return q;
    };
    q.maybeSingle = () => Promise.resolve(h.result(table));
    q.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
      if (h.deferNext && h.deferNext.table === table) {
        const d = h.deferNext;
        return new Promise<QueryResult>((resolve) => d.resolvers.push(resolve)).then(onFulfilled, onRejected);
      }
      return Promise.resolve(h.result(table)).then(onFulfilled, onRejected);
    };
    return q;
  };
  return {
    supabase: {
      from: (table: string) => {
        h.fromCalls.push(table);
        return makeQuery(table);
      },
    },
  };
});

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ getDataScope: () => "all" }),
}));

import DashboardRefreshButton, { DASHBOARD_REFRESH_COOLDOWN_MS } from "@/components/dashboard/DashboardRefreshButton";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { resetDashboardSectionLanes } from "@/lib/dashboardRefresh";
import AppointmentsWidget from "@/components/dashboard/widgets/AppointmentsWidget";
import MissedCallsWidget from "@/components/dashboard/widgets/MissedCallsWidget";

const USER = "aaaa0000-0000-0000-0000-000000000001";

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  resetDashboardSectionLanes();
  h.signals.length = 0;
  h.fromCalls.length = 0;
  h.result = () => ({ data: [], error: null, count: 0 });
  h.deferNext = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DashboardRefreshButton", () => {
  it("is not accepted for 30 s after the Dashboard opens, runs once, ignores clicks while running, then waits 30 s again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let finish!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(<DashboardRefreshButton onRefresh={onRefresh} />);

    const button = screen.getByRole("button", { name: "Refresh dashboard" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onRefresh).not.toHaveBeenCalled();

    vi.setSystemTime(new Date(Date.now() + DASHBOARD_REFRESH_COOLDOWN_MS + 1));
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();

    await act(async () => {
      finish();
    });
    await waitFor(() => expect(screen.getByText("Refresh")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(Date.now() + DASHBOARD_REFRESH_COOLDOWN_MS + 1));
    fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});

describe("useDashboardStats", () => {
  const STAT_TABLES = new Set(["calls", "clients", "appointments", "leads"]);
  const statQueries = () => h.fromCalls.filter((t) => STAT_TABLES.has(t)).length;

  it("has no automatic refresh: one load, then nothing for 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    renderHook(() => useDashboardStats(USER, "Agent", "my", "day"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const firstLoad = statQueries();
    expect(firstLoad).toBe(9);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(statQueries()).toBe(firstLoad);
  });

  it("a failed refresh keeps the numbers on screen — never zeros — and says it failed", async () => {
    h.result = (t) => (t === "calls" ? { data: [], error: null, count: 12 } : { data: [], error: null, count: 0 });
    const { result, rerender } = renderHook(({ signal }) => useDashboardStats(USER, "Agent", "my", "day", { refreshSignal: signal }), {
      initialProps: { signal: 0 },
    });
    await waitFor(() => expect(result.current.data?.callsToday).toBe(12));

    vi.spyOn(console, "error").mockImplementation(() => {});
    h.result = () => ({ data: null, error: { message: "timeout" }, count: null });
    rerender({ signal: 1 });
    await waitFor(() => expect(result.current.section.failed).toBe(true));
    expect(result.current.data?.callsToday).toBe(12);
    expect(result.current.loading).toBe(false);
  });

  it("a first load behaves as before: an unused query failing never zeroes the cards", async () => {
    let n = 0;
    h.result = (t) => {
      if (t !== "calls") return { data: [], error: null, count: 0 };
      n += 1;
      // The 9th query is the (undisplayed) talk-time read; make it fail.
      return n === 3 ? { data: null, error: { message: "statement timeout" }, count: null } : { data: [], error: null, count: 5 };
    };
    const { result } = renderHook(() => useDashboardStats(USER, "Agent", "my", "day"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.callsToday).toBe(5);
  });

  it("a failed switch never shows the previous selection's numbers under the new one", async () => {
    h.result = (t) => (t === "calls" ? { data: [], error: null, count: 12 } : { data: [], error: null, count: 0 });
    const { result, rerender } = renderHook(({ range }) => useDashboardStats(USER, "Agent", "my", range), {
      initialProps: { range: "day" as "day" | "month" },
    });
    await waitFor(() => expect(result.current.data?.callsToday).toBe(12));

    vi.spyOn(console, "error").mockImplementation(() => {});
    h.result = () => ({ data: null, error: { message: "timeout" }, count: null });
    rerender({ range: "month" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Never Day's 12 under Month — and, with every displayed query failed, never a made-up 0.
    expect(result.current.data).toBeNull();
    expect(result.current.section.failed).toBe(true);
  });

  it("a switch never overlaps the running load: it is aborted, the new period waits for it, and its late answer never commits", async () => {
    h.deferNext = { table: "calls", resolvers: [] };
    const { result, rerender } = renderHook(({ range }) => useDashboardStats(USER, "Agent", "my", range), {
      initialProps: { range: "day" as "day" | "week" },
    });
    await waitFor(() => expect(h.deferNext!.resolvers.length).toBeGreaterThan(0));
    const dayResolvers = [...h.deferNext!.resolvers];
    const daySignals = [...h.signals];

    rerender({ range: "week" });
    await flush();
    // Day is aborted; nothing for Week is sent while Day is still on the wire.
    expect(daySignals.every((signal) => signal.aborted)).toBe(true);
    expect(h.deferNext!.resolvers).toHaveLength(dayResolvers.length);
    expect(h.fromCalls).toHaveLength(9);

    act(() => dayResolvers.forEach((r) => r({ data: [], error: null, count: 111 })));
    await waitFor(() => expect(h.deferNext!.resolvers.length).toBeGreaterThan(dayResolvers.length));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    const weekResolvers = h.deferNext!.resolvers.slice(dayResolvers.length);
    act(() => weekResolvers.forEach((r) => r({ data: [], error: null, count: 7 })));
    await waitFor(() => expect(result.current.data?.callsToday).toBe(7));
    expect(result.current.loading).toBe(false);
  });
});

describe("widgets reload on the Refresh signal", () => {
  const APPT = { id: "a1", title: "Review", contact_name: "Pat Lee", start_time: new Date().toISOString(), type: "Sales Call", status: "Scheduled" };

  it("Schedule reloads once per signal (a remount loads once) and keeps its rows when a refresh fails", async () => {
    h.result = (t) => (t === "appointments" ? { data: [APPT], error: null } : { data: [], error: null });
    const { rerender } = render(
      <MemoryRouter>
        <AppointmentsWidget userId={USER} role="Agent" adminToggle="my" refreshSignal={0} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Pat Lee")).toBeInTheDocument());
    const loads = () => h.fromCalls.filter((t) => t === "appointments").length;
    expect(loads()).toBe(1);

    h.result = () => ({ data: null, error: { message: "boom" } });
    rerender(
      <MemoryRouter>
        <AppointmentsWidget userId={USER} role="Agent" adminToggle="my" refreshSignal={1} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(loads()).toBe(2));
    await flush();
    expect(screen.getByText("Pat Lee")).toBeInTheDocument();
    expect(screen.queryByText("Your schedule is clear for today")).not.toBeInTheDocument();
  });

  it("Missed Calls clears its list when a refresh finds nothing (never leaves calls that are gone)", async () => {
    const CALL = {
      id: "c1", contact_id: null, contact_name: "Jordan Kay", contact_phone: "+15555550100",
      created_at: new Date().toISOString(), disposition_name: null, direction: "inbound", is_missed: true,
      missed_reason: null, outcome: null, agent_id: null, answered_by_agent_id: null, voicemail_id: null,
    };
    h.result = (t) => (t === "calls" ? { data: [CALL], error: null } : { data: [], error: null });
    const { rerender } = render(<MissedCallsWidget userId={USER} role="Admin" adminToggle="team" refreshSignal={0} />);
    await waitFor(() => expect(screen.getByText("Jordan Kay")).toBeInTheDocument());

    h.result = () => ({ data: [], error: null });
    rerender(<MissedCallsWidget userId={USER} role="Admin" adminToggle="team" refreshSignal={1} />);
    await waitFor(() => expect(screen.getByText("All caught up!")).toBeInTheDocument());
    expect(screen.queryByText("Jordan Kay")).not.toBeInTheDocument();
  });
});
