import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { AgentStats, Win } from "@/components/leaderboard/leaderboardTypes";

/**
 * Page-preservation + error-state suite for the leaderboard RLS accuracy fix.
 *
 * Podium, full rankings, CSV export, TV mode entry, the zero-activity banner,
 * and the Agency Group toggle must all keep working when standings are fed by
 * the aggregate RPC — and the new failure states must render truthfully:
 * a failed refresh keeps the last snapshot behind a stale banner, and an
 * initial failure shows an error panel with Retry, never the valid-empty state.
 */

const h = vi.hoisted(() => ({
  hookState: {} as Record<string, unknown>,
}));

vi.mock("@/hooks/useLeaderboardData", () => ({
  useLeaderboardData: () => h.hookState,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "aaaa0000-0000-0000-0000-000000000001" },
    profile: { organization_id: "0f000000-0000-0000-0000-0000000000aa" },
  }),
}));

// RecentWinsPanel formats win timestamps through the branding context;
// TVMode additionally reads branding.timezone.
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    branding: { timezone: "America/Chicago" },
    formatDate: (d: string | Date) => String(d),
    formatTime: (d: string | Date) => String(d),
  }),
}));

// TVMode reads organizations/company_settings directly; stub the client so the
// page tree renders without a network. The hook itself is module-mocked below.
vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = () => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ["select", "eq", "in", "order", "limit", "update"]) q[m] = chain;
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.single = () => Promise.resolve({ data: null, error: null });
    q.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
    return q;
  };
  return { supabase: { from: () => makeQuery() } };
});

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigateSpy,
}));

import Leaderboard from "@/pages/Leaderboard";

const agent = (over: Partial<AgentStats>): AgentStats => ({
  id: "aaaa0000-0000-0000-0000-000000000001",
  first_name: "Avery",
  last_name: "Adams",
  avatar_url: undefined,
  callsMade: 0,
  policiesSold: 0,
  appointmentsSet: 0,
  talkTime: 0,
  conversionRate: 0,
  premiumSold: 0,
  recentWins7d: 0,
  rank: 1,
  ...over,
});

const ROSTER: AgentStats[] = [
  agent({ id: "aaaa0000-0000-0000-0000-000000000001", first_name: "Avery", last_name: "Adams", callsMade: 40, policiesSold: 4, premiumSold: 4800, conversionRate: 10, rank: 1 }),
  agent({ id: "aaaa0000-0000-0000-0000-000000000002", first_name: "Blake", last_name: "Brooks", callsMade: 30, policiesSold: 3, premiumSold: 3600, conversionRate: 10, rank: 2 }),
  agent({ id: "aaaa0000-0000-0000-0000-000000000003", first_name: "Casey", last_name: "Cole", callsMade: 20, policiesSold: 2, premiumSold: 2400, conversionRate: 10, rank: 3 }),
  agent({ id: "aaaa0000-0000-0000-0000-000000000004", first_name: "Drew", last_name: "Dunn", callsMade: 10, policiesSold: 1, premiumSold: 1200, conversionRate: 10, rank: 4 }),
];

const baseHookState = () => ({
  view: "org",
  setView: vi.fn(),
  period: "Today",
  setPeriod: vi.fn(),
  metric: "Policies Sold",
  setMetric: vi.fn(),
  agents: ROSTER,
  wins: [] as Win[],
  initialLoading: false,
  filterRefreshing: false,
  rankAnimations: new Map(),
  rankMovements: new Map(),
  rankMotions: new Map(),
  rankDeltas: new Map(),
  flashingWinId: null,
  spotlightAgentId: null,
  newLeaderId: null,
  standingsFrozen: false,
  agencyGroup: null,
  fetchData: vi.fn(),
  fetchWins: vi.fn(),
  loadError: null as string | null,
  retry: vi.fn(),
});

beforeEach(() => {
  h.hookState = baseHookState();
  navigateSpy.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("board preservation on RPC-fed standings", () => {
  it("renders the podium (top 3) and the full rankings table (rank 4+)", () => {
    render(<Leaderboard />);
    expect(screen.getByText(/Avery/)).toBeInTheDocument();
    expect(screen.getByText(/Blake/)).toBeInTheDocument();
    expect(screen.getByText(/Casey/)).toBeInTheDocument();
    // Rank 4 appears only in the Full Rankings table.
    expect(screen.getByText(/Drew/)).toBeInTheDocument();
    expect(screen.queryByText("No agents on the board")).not.toBeInTheDocument();
  });

  it("exports the standings CSV with the standard columns", async () => {
    let exportedBlob: Blob | null = null;
    const createObjectURL = vi.fn((blob: Blob) => {
      exportedBlob = blob;
      return "blob:leaderboard-test";
    });
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });

    render(<Leaderboard />);
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));

    await waitFor(() => expect(exportedBlob).not.toBeNull());
    // jsdom's Blob has no .text(); FileReader is the portable read path.
    const csvText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlob!);
    });
    expect(csvText).toContain(
      "Rank,Agent Name,Calls Made,Policies Sold,Premium Sold (Annual),Appointments Set,Talk Time (minutes),Conversion Rate",
    );
    expect(csvText).toContain("1,Avery Adams,40,4,4800,0,0,10.0%");
    expect(csvText).toContain("4,Drew Dunn,10,1,1200,0,0,10.0%");
  });

  it("enters TV mode from the filters button", () => {
    const { container } = render(<Leaderboard />);
    const tvButton = Array.from(container.querySelectorAll("button")).find((b) =>
      b.querySelector("svg.lucide-monitor"),
    );
    expect(tvButton).toBeTruthy();
    fireEvent.click(tvButton!);
    // TVMode replaces the page; the standard filters header is gone.
    expect(screen.queryByRole("button", { name: /Export CSV/i })).not.toBeInTheDocument();
  });

  it("shows the calm zero-activity banner (not an empty state) when the roster is all zeros", () => {
    h.hookState = { ...baseHookState(), agents: ROSTER.map((a, i) => agent({ ...a, callsMade: 0, policiesSold: 0, premiumSold: 0, conversionRate: 0, rank: i + 1 })), standingsFrozen: true };
    render(<Leaderboard />);
    expect(screen.getByText(/first sale takes the lead/i)).toBeInTheDocument();
    expect(screen.queryByText("No agents on the board")).not.toBeInTheDocument();
    expect(screen.getByText(/Avery/)).toBeInTheDocument();
  });

  it("shows the Agency Group toggle only when a group exists and routes view changes", () => {
    const setView = vi.fn();
    h.hookState = {
      ...baseHookState(),
      setView,
      agencyGroup: { groupId: "g-1", groupName: "FFL National" },
    };
    render(<Leaderboard />);
    fireEvent.click(screen.getByRole("button", { name: "FFL National" }));
    expect(setView).toHaveBeenCalledWith("group");
    fireEvent.click(screen.getByRole("button", { name: "My Agency" }));
    expect(setView).toHaveBeenCalledWith("org");
  });
});

describe("truthful failure states", () => {
  it("keeps the last snapshot behind a stale banner when a refresh fails, and Retry refetches", () => {
    const retry = vi.fn();
    h.hookState = { ...baseHookState(), loadError: "Couldn't refresh standings.", retry };
    render(<Leaderboard />);

    // The board is still the last valid snapshot…
    expect(screen.getByText(/Avery/)).toBeInTheDocument();
    expect(screen.getByText(/Drew/)).toBeInTheDocument();
    // …behind an explicit stale-data banner.
    expect(screen.getByText(/Couldn't refresh standings/i)).toBeInTheDocument();
    expect(screen.queryByText("No agents on the board")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows an error panel with Retry on initial failure — never the valid-empty state", () => {
    const retry = vi.fn();
    h.hookState = { ...baseHookState(), agents: [], loadError: "Couldn't load the leaderboard.", retry };
    render(<Leaderboard />);

    expect(screen.getByText(/Couldn't load the leaderboard/i)).toBeInTheDocument();
    // A failure must be distinguishable from a legitimately empty roster.
    expect(screen.queryByText("No agents on the board")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders the legitimate empty state only when there is no error and no roster", () => {
    h.hookState = { ...baseHookState(), agents: [], loadError: null };
    render(<Leaderboard />);
    expect(screen.getByText("No agents on the board")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/i })).not.toBeInTheDocument();
  });
});
