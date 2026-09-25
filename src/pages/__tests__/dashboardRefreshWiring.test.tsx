import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Wiring of the Dashboard's single Refresh control (D-7 as approved: every
 * widget). One accepted click refreshes the stat cards and sends one refresh
 * signal to each widget; nothing refreshes on a timer.
 */

const h = vi.hoisted(() => {
  const props = {} as Record<string, Record<string, unknown>>;
  // Records the props each widget stub receives (hoisted: vi.mock factories run first).
  const stub = (name: string) => (p: Record<string, unknown>) => {
    props[name] = p;
    return null;
  };
  return { props, stub, refresh: vi.fn(() => Promise.resolve()) };
});

vi.mock("@/components/dashboard/widgets/CallbacksWidget", () => ({ default: h.stub("callbacks") }));
vi.mock("@/components/dashboard/widgets/AppointmentsWidget", () => ({ default: h.stub("appointments") }));
vi.mock("@/components/dashboard/widgets/GoalProgressWidget", () => ({ default: h.stub("goal_progress") }));
vi.mock("@/components/dashboard/widgets/LeaderboardWidget", () => ({ default: h.stub("leaderboard") }));
vi.mock("@/components/dashboard/widgets/MissedCallsWidget", () => ({ default: h.stub("missed_calls") }));
vi.mock("@/components/dashboard/widgets/AnniversariesWidget", () => ({ default: h.stub("anniversaries") }));
vi.mock("@/components/dashboard/StatCards", () => ({ default: () => null }));
vi.mock("@/components/dashboard/AgencyGroupInviteBanner", () => ({ default: () => null }));
vi.mock("@/components/dashboard/DashboardDetailModal", () => ({ default: () => null }));
vi.mock("@/hooks/useDashboardStats", () => ({
  useDashboardStats: () => ({ data: null, loading: false, refresh: h.refresh }),
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Dashboard Refresh wiring", () => {
  it("one accepted click refreshes the stat cards and signals every widget once; the Leaderboard widget also gets the viewer's organization", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(Object.keys(h.props).sort()).toEqual([...WIDGETS].sort()));
    for (const w of WIDGETS) expect(h.props[w].refreshSignal).toBe(0);
    expect(h.props.leaderboard.organizationId).toBe("0f000000-0000-0000-0000-0000000000aa");

    // Not accepted in the first 30 s after the Dashboard opens.
    fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
    expect(h.refresh).not.toHaveBeenCalled();

    vi.setSystemTime(new Date(Date.now() + 31_000));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    for (const w of WIDGETS) expect(h.props[w].refreshSignal).toBe(1);
  });
});
