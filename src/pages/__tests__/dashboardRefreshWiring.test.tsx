import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { useEffect } from "react";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Wiring of the Dashboard's single Refresh control (D-7 as approved: every
 * widget; rev 1.2: coordinated). One accepted click sends one refresh signal to
 * the stat cards and to each widget, with one tracker; the control waits for the
 * work the mounted sections report — never longer than its bound — and nothing
 * refreshes on a timer.
 */

type Outcome = { status: string };
type Tracker = {
  register: (section: string) => () => void;
  report: (signal: number, section: string, work: Promise<Outcome>) => void;
};

const h = vi.hoisted(() => {
  const props = {} as Record<string, Record<string, unknown>>;
  const statsArgs = [] as unknown[][];
  /** The work each section reports for the next signal (default: done at once). */
  const work = {} as Record<string, Promise<Outcome>>;
  return { props, statsArgs, work };
});

/** A section stub that registers with the tracker and reports its (controllable) work. */
function useReportingStub(name: string, p: { refreshSignal?: number; refreshTracker?: Tracker }) {
  h.props[name] = p as Record<string, unknown>;
  const { refreshSignal, refreshTracker } = p;
  useEffect(() => refreshTracker?.register(name), [refreshTracker, name]);
  useEffect(() => {
    if (!refreshSignal || !refreshTracker) return;
    refreshTracker.report(refreshSignal, name, h.work[name] ?? Promise.resolve({ status: "ok" }));
  }, [refreshSignal, refreshTracker, name]);
}
type StubProps = { refreshSignal?: number; refreshTracker?: Tracker };
// Referenced lazily by the (hoisted) vi.mock factories, at render time.
function SectionStub({ name, ...p }: StubProps & { name: string }) {
  useReportingStub(name, p);
  return null;
}
function useStatsStub(args: unknown[]) {
  h.statsArgs.push(args);
  useReportingStub("stats", args[4] as StubProps);
  return { data: null, loading: false, section: { failed: false, offline: false, refreshing: false, complete: true, updatedAt: null } };
}

vi.mock("@/components/dashboard/widgets/CallbacksWidget", () => ({ default: (p: StubProps) => <SectionStub name="callbacks" {...p} /> }));
vi.mock("@/components/dashboard/widgets/AppointmentsWidget", () => ({ default: (p: StubProps) => <SectionStub name="appointments" {...p} /> }));
vi.mock("@/components/dashboard/widgets/GoalProgressWidget", () => ({ default: (p: StubProps) => <SectionStub name="goal_progress" {...p} /> }));
vi.mock("@/components/dashboard/widgets/LeaderboardWidget", () => ({ default: (p: StubProps) => <SectionStub name="leaderboard" {...p} /> }));
vi.mock("@/components/dashboard/widgets/MissedCallsWidget", () => ({ default: (p: StubProps) => <SectionStub name="missed_calls" {...p} /> }));
vi.mock("@/components/dashboard/widgets/AnniversariesWidget", () => ({ default: (p: StubProps) => <SectionStub name="anniversaries" {...p} /> }));
vi.mock("@/components/dashboard/StatCards", () => ({ default: () => null }));
vi.mock("@/components/dashboard/AgencyGroupInviteBanner", () => ({ default: () => null }));
vi.mock("@/components/dashboard/DashboardDetailModal", () => ({ default: () => null }));
vi.mock("@/hooks/useDashboardStats", () => ({
  useDashboardStats: (...args: unknown[]) => useStatsStub(args),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "aaaa0000-0000-0000-0000-000000000001" },
    profile: { organization_id: "0f000000-0000-0000-0000-0000000000aa", role: "Agent" },
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return q;
    },
  },
}));

import Dashboard from "@/pages/Dashboard";

const WIDGETS = ["callbacks", "appointments", "goal_progress", "leaderboard", "missed_calls", "anniversaries"];
const SECTIONS = ["stats", ...WIDGETS];

beforeEach(() => {
  for (const key of Object.keys(h.props)) delete h.props[key];
  for (const key of Object.keys(h.work)) delete h.work[key];
  h.statsArgs.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderDashboard = async () => {
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
  await waitFor(() => expect(Object.keys(h.props).sort()).toEqual([...SECTIONS].sort()));
};

describe("Dashboard Refresh wiring", () => {
  it("one accepted click signals the stat cards and every widget once, with one tracker; the Leaderboard widget also gets the viewer's organization", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await renderDashboard();
    for (const s of SECTIONS) expect(h.props[s].refreshSignal).toBe(0);
    const tracker = h.props.stats.refreshTracker;
    expect(tracker).toBeTruthy();
    for (const w of WIDGETS) expect(h.props[w].refreshTracker).toBe(tracker);
    expect(h.props.leaderboard.organizationId).toBe("0f000000-0000-0000-0000-0000000000aa");

    // Not accepted in the first 30 s after the Dashboard opens.
    fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
    for (const s of SECTIONS) expect(h.props[s].refreshSignal).toBe(0);

    vi.setSystemTime(new Date(Date.now() + 31_000));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
    });
    for (const s of SECTIONS) expect(h.props[s].refreshSignal).toBe(1);
    await waitFor(() => expect(screen.getByText("Refresh")).toBeInTheDocument());
  });

  it("waits for the work the sections actually started: 'Refreshing…' until the slow one settles", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await renderDashboard();
    let finish!: (v: Outcome) => void;
    h.work.missed_calls = new Promise<Outcome>((r) => (finish = r));
    // A section that sent nothing (the leaderboard's spacing / hold) never holds the others up.
    h.work.leaderboard = Promise.resolve({ status: "deferred" });
    vi.setSystemTime(new Date(Date.now() + 31_000));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    await act(async () => finish({ status: "ok" }));
    await waitFor(() => expect(screen.getByText("Refresh")).toBeInTheDocument());
  });

  it("is bounded: a section whose work never settles releases the control at the wait bound", async () => {
    await renderDashboard();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    h.work.callbacks = new Promise<Outcome>(() => {});
    vi.setSystemTime(new Date(Date.now() + 31_000));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_000);
    });
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(screen.getByText("Refresh")).toBeInTheDocument();
  });
});
