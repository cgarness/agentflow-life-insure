import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { AgentStats, Win } from "@/components/leaderboard/leaderboardTypes";
import { STANDINGS_STATUS_OK, type StandingsStatus, type WinsStatus } from "@/lib/leaderboardStatusCopy";

/**
 * TV mode and Recent Wins must never present an outage as live data: no empty
 * podium or zero totals under "LIVE", no "No wins yet" unless a read succeeded.
 */

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "aaaa0000-0000-0000-0000-000000000001" },
    profile: { organization_id: "0f000000-0000-0000-0000-0000000000aa", role: "Agent" },
  }),
}));

vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    branding: { timezone: "America/Chicago", companyName: "AgentFlow" },
    formatDate: (d: string | Date) => String(d),
    formatTime: (d: string | Date) => String(d),
  }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = () => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ["select", "eq", "in", "order", "limit", "update"]) q[m] = chain;
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
    return q;
  };
  return { supabase: { from: () => makeQuery() } };
});

import TVMode from "@/components/leaderboard/TVMode";
import RecentWinsPanel from "@/components/leaderboard/RecentWinsPanel";

const agent = (over: Partial<AgentStats>): AgentStats => ({
  id: "aaaa0000-0000-0000-0000-000000000001",
  first_name: "Avery",
  last_name: "Adams",
  callsMade: 40,
  policiesSold: 4,
  appointmentsSet: 1,
  talkTime: 600,
  conversionRate: 10,
  premiumSold: 4800,
  recentWins7d: 1,
  rank: 1,
  ...over,
});

const ROSTER = [
  agent({}),
  agent({ id: "aaaa0000-0000-0000-0000-000000000002", first_name: "Blake", last_name: "Brooks", policiesSold: 3, rank: 2 }),
];

const WIN: Win = {
  id: "win-1",
  agent_id: ROSTER[0].id,
  agent_name: "Avery A.",
  contact_name: "Pat",
  campaign_name: "",
  policy_type: "Term",
  created_at: new Date(2026, 8, 25, 9, 0).toISOString(),
};

const maintenance: StandingsStatus = {
  ...STANDINGS_STATUS_OK,
  kind: "maintenance",
  nextCheckAt: Date.now() + 300_000,
  manualAvailableAt: Date.now() + 300_000,
};

const renderTv = (props: Partial<React.ComponentProps<typeof TVMode>> = {}) =>
  render(
    <TVMode
      agents={ROSTER}
      wins={[]}
      period="Today"
      onPeriodChange={vi.fn()}
      onExit={vi.fn()}
      winsStatus={{ kind: "ok", lastUpdatedAt: 1 }}
      {...props}
    />,
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TV mode", () => {
  it("live standings keep the live labels and the board (unchanged behaviour)", () => {
    renderTv();
    expect(screen.getAllByText("Calls").length).toBeGreaterThan(0);
    expect(screen.getByText("Live Feed")).toBeInTheDocument();
    expect(screen.getByText(/Live Ranking/)).toBeInTheDocument();
    expect(screen.getAllByText("LIVE NEWS FEED").length).toBeGreaterThan(0);
    expect(screen.queryByText("Standings are paused for maintenance.")).not.toBeInTheDocument();
  });

  it("maintenance with nothing loaded replaces the board with a notice — no zero totals, no LIVE, no 'No wins yet' — and keeps the period buttons", () => {
    const onPeriodChange = vi.fn();
    renderTv({
      agents: [],
      standingsStatus: maintenance,
      statusHeadline: "Standings are paused for maintenance.",
      winsStatus: { kind: "loading", lastUpdatedAt: null },
      onPeriodChange,
    });
    expect(screen.getByText("Standings are paused for maintenance.")).toBeInTheDocument();
    expect(screen.getByText(/We'll check again automatically at/)).toBeInTheDocument();
    expect(screen.queryByText("Live Feed")).not.toBeInTheDocument();
    expect(screen.queryByText(/Live Ranking/)).not.toBeInTheDocument();
    expect(screen.queryByText("LIVE NEWS FEED")).not.toBeInTheDocument();
    expect(screen.getAllByText("NEWS FEED").length).toBeGreaterThan(0);
    expect(screen.queryByText(/No wins yet/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Standings paused for maintenance").length).toBeGreaterThan(0);
    // Neither the agency totals strip nor the ranking table (both label a "Calls" column) is drawn.
    expect(screen.queryByText("Calls")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(onPeriodChange).toHaveBeenCalledWith("This Week");
  });

  it("while the first standings load, TV says so instead of drawing an empty zero board", () => {
    renderTv({ agents: [], loading: true, winsStatus: { kind: "loading", lastUpdatedAt: null } });
    expect(screen.getByText("Loading standings…")).toBeInTheDocument();
    expect(screen.queryByText("Live Feed")).not.toBeInTheDocument();
  });

  it("maintenance over a snapshot keeps the board under a strip, and drops the live wording", () => {
    renderTv({
      standingsStatus: { ...maintenance, lastUpdatedAt: new Date(2026, 8, 25, 9, 5).getTime() },
      statusHeadline: "Standings are paused for maintenance.",
    });
    expect(screen.getByText(/Standings are paused for maintenance\. Showing results from/)).toBeInTheDocument();
    expect(screen.getAllByText(/Avery A\./).length).toBeGreaterThan(0);
    expect(screen.getByText(/^Ranking/)).toBeInTheDocument();
    expect(screen.queryByText("Live Feed")).not.toBeInTheDocument();
  });

  it("the ticker shows a custom banner or neutral copy when wins are unavailable — never 'No wins yet'", () => {
    renderTv({ winsStatus: { kind: "error", lastUpdatedAt: null } });
    expect(screen.queryByText(/No wins yet/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Recent wins unavailable").length).toBeGreaterThan(0);
  });
});

describe("Recent Wins panel", () => {
  const status = (s: WinsStatus) => s;

  it("says 'No wins yet' only after a successful empty read", () => {
    const { rerender } = render(<RecentWinsPanel wins={[]} agents={ROSTER} flashingWinId={null} status={status({ kind: "ok", lastUpdatedAt: 1 })} />);
    expect(screen.getByText(/No wins yet/)).toBeInTheDocument();

    rerender(<RecentWinsPanel wins={[]} agents={ROSTER} flashingWinId={null} status={status({ kind: "loading", lastUpdatedAt: null })} />);
    expect(screen.queryByText(/No wins yet/)).not.toBeInTheDocument();
    expect(screen.getByText("Loading recent wins…").closest('[role="status"]')).not.toBeNull();

    rerender(<RecentWinsPanel wins={[]} agents={ROSTER} flashingWinId={null} status={status({ kind: "error", lastUpdatedAt: null })} />);
    expect(screen.queryByText(/No wins yet/)).not.toBeInTheDocument();
    expect(screen.getByText("Recent wins are unavailable right now.")).toBeInTheDocument();
  });

  it("keeps the list when a refresh fails, with the time it is from", () => {
    render(
      <RecentWinsPanel
        wins={[WIN]}
        agents={ROSTER}
        flashingWinId={null}
        status={status({ kind: "error", lastUpdatedAt: new Date(2026, 8, 25, 9, 5).getTime() })}
      />,
    );
    expect(screen.getByText("Avery A.")).toBeInTheDocument();
    expect(screen.getByText(/Couldn't refresh — showing wins as of/)).toBeInTheDocument();
  });

  it("without a status behaves exactly as before", () => {
    render(<RecentWinsPanel wins={[]} agents={ROSTER} flashingWinId={null} />);
    expect(screen.getByText(/No wins yet/)).toBeInTheDocument();
  });
});

describe("TV offline (review follow-up)", () => {
  it("drops the live wording and shows the offline strip", () => {
    renderTv({ standingsStatus: { ...STANDINGS_STATUS_OK, lastUpdatedAt: Date.now() - 60_000, offline: true } });
    expect(screen.queryByText("Live Feed")).not.toBeInTheDocument();
    expect(screen.queryByText("LIVE NEWS FEED")).not.toBeInTheDocument();
    expect(screen.getByText(/Standings are not updating\. .*You're offline/)).toBeInTheDocument();
  });
});

describe("TV review follow-ups", () => {
  it("a period switch in progress is not presented as live", () => {
    renderTv({ refreshing: true });
    expect(screen.queryByText("Live Feed")).not.toBeInTheDocument();
    expect(screen.getByText("Loading standings for this period…")).toBeInTheDocument();
  });

  it("never promises a wins load that cannot happen (standings failed, nothing loaded)", () => {
    renderTv({
      agents: [],
      standingsStatus: { ...STANDINGS_STATUS_OK, kind: "error" },
      statusHeadline: "Couldn't load the leaderboard.",
      winsStatus: { kind: "loading", lastUpdatedAt: null },
    });
    expect(screen.queryByText(/Loading recent wins/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Standings unavailable").length).toBeGreaterThan(0);
  });
});

describe("TV rev 1.2: offline and pending switches", () => {
  it("offline with nothing loaded: an offline notice (no spinner, no Retry) and an offline ticker — never 'Loading…'", () => {
    renderTv({
      agents: [],
      loading: true,
      standingsStatus: { ...STANDINGS_STATUS_OK, offline: true },
      winsStatus: { kind: "loading", lastUpdatedAt: null },
    });
    expect(screen.getByText("Standings are not updating.")).toBeInTheDocument();
    expect(screen.getByText("You're offline — standings can't load until you reconnect.")).toBeInTheDocument();
    expect(screen.queryByText("Loading standings…")).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading recent wins/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/recent wins can't load until you reconnect/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Retry/i })).not.toBeInTheDocument();
  });

  it("a period switch still loading with no rows is a loading notice — never an empty podium labelled live", () => {
    renderTv({ agents: [], refreshing: true, standingsStatus: STANDINGS_STATUS_OK });
    expect(screen.getByText("Loading standings…")).toBeInTheDocument();
    expect(screen.queryByText(/LIVE NEWS FEED/)).not.toBeInTheDocument();
  });
});
