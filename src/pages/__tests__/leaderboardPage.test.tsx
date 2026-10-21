import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import type { AgentStats, Win } from "@/components/leaderboard/leaderboardTypes";
import { STANDINGS_STATUS_OK, type StandingsStatus } from "@/lib/leaderboardStatusCopy";

/**
 * Page-preservation + error-state suite for the leaderboard RLS accuracy fix.
 *
 * Podium, full rankings, CSV export, TV mode entry, the removal of the zero-activity banner,
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
  performanceSnapshot: { period: "today", time_zone: "UTC", start_at: "2026-10-04T00:00:00Z", end_at: "2026-10-04T06:00:00Z", organization_id: "org", group_id: null, roster: "active", rows: ROSTER, excluded: { calls_made: 0, appointments_set: 0, policies_sold: 0 } },
  view: "org",
  setView: vi.fn(),
  period: "Today",
  setPeriod: vi.fn(),
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
  standingsStatus: STANDINGS_STATUS_OK as StandingsStatus,
  winsStatus: { kind: "ok", lastUpdatedAt: 1 },
  retry: vi.fn(),
});

/** A name now shows on the podium or table and, for the signed-in agent, on Your Performance too. */
const expectShown = (name: RegExp) => expect(screen.getAllByText(name).length).toBeGreaterThan(0);
const tableRows = () => Array.from(document.querySelectorAll('[role="rowgroup"] [role="row"]')) as HTMLElement[];
const podiumCards = () =>
  Array.from(document.querySelectorAll(".rounded-xl.flex-col.items-center")) as HTMLElement[];

beforeEach(() => {
  h.hookState = baseHookState();
  navigateSpy.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("board preservation on RPC-fed standings", () => {
  it("shows the separately supplied photo on the actual podium without changing its displayed rank", async () => {
    vi.spyOn(window.HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(window.HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1);
    h.hookState.agents = ROSTER.map((a, i) => i === 0 ? { ...a, avatar_url: "https://photos.test/avery.png" } : a);
    render(<Leaderboard />);
    const photos = await screen.findAllByRole("img", { name: "Avery Adams" });
    expect(photos.length).toBeGreaterThan(0);
    expect(photos.every(photo => photo.getAttribute("src") === "https://photos.test/avery.png")).toBe(true);
    expectShown(/Blake/);
    expect(screen.queryByText("Standings are paused for maintenance.")).not.toBeInTheDocument();
  });

  it("renders the podium (top 3) and Full Rankings with every ranked agent, the top three included", () => {
    render(<Leaderboard />);
    expect(podiumCards().map((c) => within(c).getByRole("heading").textContent)).toEqual(["Blake B.", "Avery A.", "Casey C."]);
    // The agent cell reads avatar initials, the name, then the YOU label for the signed-in agent.
    expect(tableRows().map((r) => within(r).getAllByRole("cell")[1].textContent)).toEqual(["AAAvery A.You", "BBBlake B.", "CCCasey C.", "DDDrew D."]);
    expect(screen.queryByText("All agents shown in podium above")).not.toBeInTheDocument();
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
      '"Rank","Agent","Agent ID","Organization","Organization ID","Calls Made","Policies Sold","Annualized Premium USD","Unknown Premium Policies","Appointments Set","Talk Time Seconds","Policies per 100 Calls","Ratio Denominator Calls","Period","Agency Timezone","Start Inclusive","As Of Exclusive","Roster","Group ID"',
    );
    expect(csvText).toContain('"1","Avery Adams"');
    expect(csvText).toContain('"40","4","4800.00","0","0","0","10","40"');
    expect(csvText).toContain('"4","Drew Dunn"');
    expect(csvText).toContain('"10","1","1200.00","0","0","0","10","10"');
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

  it("keeps a zero roster visible without the removed activity or dialer prompt", () => {
    h.hookState = { ...baseHookState(), agents: ROSTER.map((a, i) => agent({ ...a, callsMade: 0, policiesSold: 0, premiumSold: 0, conversionRate: 0, rank: i + 1 })), standingsFrozen: true };
    render(<Leaderboard />);
    expect(screen.queryByText(/first sale takes the lead|No activity|Go to Dialer/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No agents on the board")).not.toBeInTheDocument();
    expectShown(/Avery/);
  });

  it("shows the Agency Group toggle only when a group exists and routes view changes", () => {
    const setView = vi.fn();
    h.hookState = {
      ...baseHookState(),
      setView,
      agencyGroup: { groupId: "g-1", groupName: "FFL National" },
    };
    render(<Leaderboard />);
    expect(screen.getByRole("button", { name: "My Agency" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "FFL National" }));
    expect(setView).toHaveBeenCalledWith("group");
    fireEvent.click(screen.getByRole("button", { name: "My Agency" }));
    expect(setView).toHaveBeenCalledWith("org");
  });

  it("keeps Today / This Week / This Month and routes a period change", () => {
    const setPeriod = vi.fn();
    h.hookState = { ...baseHookState(), setPeriod };
    render(<Leaderboard />);
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "This Week" }));
    expect(setPeriod).toHaveBeenLastCalledWith("This Week");
    fireEvent.click(screen.getByRole("button", { name: "This Month" }));
    expect(setPeriod).toHaveBeenLastCalledWith("This Month");
  });
});

describe("AP-only board", () => {
  it("has no metric selector and says the board ranks by Annual Premium", () => {
    render(<Leaderboard />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Metric")).not.toBeInTheDocument();
    expect(screen.getByText("Ranked by Annual Premium")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bAP\b|Annualized/);
  });

  it("Full Rankings has exactly Rank, Agent, Annual Premium, Policies and Calls", () => {
    render(<Leaderboard />);
    expect(screen.getByRole("table", { name: "Full rankings by Annual Premium" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Rank", "Agent", "Annual Premium", "Policies", "Calls",
    ]);
    const drew = tableRows()[3];
    expect(within(drew).getAllByRole("cell").map((c) => c.textContent)).toEqual(["4", "DDDrew D.", "$1,200.00", "1", "10"]);
  });

  it("each podium card shows Annual Premium first, then Policies and Calls", () => {
    render(<Leaderboard />);
    const blake = podiumCards()[0];
    expect(blake).toHaveTextContent("#2 Silver");
    // Annual Premium, its label, then each stat (label first in the DOM for screen readers; the figure sits above it on screen).
    expect(blake.textContent).toMatch(/\$3,600\.00Annual Premium.*Policies3.*Calls30$/);
  });

  it("shows no Appointments anywhere — podium, card, table, notes — even when appointments were excluded", () => {
    h.hookState = {
      ...baseHookState(),
      agents: ROSTER.map((a) => ({ ...a, appointmentsSet: 7 })),
      performanceSnapshot: { ...baseHookState().performanceSnapshot, excluded: { calls_made: 1, appointments_set: 5, policies_sold: 0 } },
    };
    render(<Leaderboard />);
    expect(document.body.textContent).not.toMatch(/appointment|appts/i);
    expect(screen.getByText("Outside active roster: 1 calls, 0 policies")).toBeInTheDocument();
  });

  it("marks the signed-in agent's row with YOU and a blue tint wherever it ranks", () => {
    // Avery (the signed-in user) ranked 4th.
    const reordered = [ROSTER[1], ROSTER[2], ROSTER[3], ROSTER[0]].map((a, i) => ({ ...a, rank: i + 1 }));
    h.hookState = { ...baseHookState(), agents: reordered };
    render(<Leaderboard />);
    const rows = tableRows();
    const mine = rows.filter((r) => within(r).queryByText("You"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toBe(rows[3]);
    expect(mine[0]).toHaveAttribute("aria-current", "true");
    expect(mine[0].className).toMatch(/bg-primary/);
    expect(rows.slice(0, 3).every((r) => !r.className.includes("bg-primary"))).toBe(true);
  });

  it("places Your Performance beside the podium with the signed-in agent's AP, rank, Policies and Calls", () => {
    render(<Leaderboard />);
    const card = screen.getByRole("region", { name: "Your Performance" });
    expect(card).toHaveTextContent("Today · My Agency");
    expect(card).toHaveTextContent("$4,800.00");
    expect(within(card).getByText("Rank").nextElementSibling).toHaveTextContent("#1 of 4");
    expect(within(card).getByText("Policies").nextElementSibling).toHaveTextContent("4");
    expect(within(card).getByText("Calls").nextElementSibling).toHaveTextContent("40");
  });

  it("Your Performance shows real movement only, and none on a frozen board", () => {
    const rankMovements = new Map([["aaaa0000-0000-0000-0000-000000000001", { direction: "up" as const, spots: 2 }]]);
    h.hookState = { ...baseHookState(), rankMovements };
    const { unmount } = render(<Leaderboard />);
    const card = screen.getByRole("region", { name: "Your Performance" });
    expect(within(card).getByText("Moved up 2 spots since the last leaderboard update")).toBeInTheDocument();
    unmount();

    h.hookState = { ...baseHookState(), rankMovements, standingsFrozen: true };
    render(<Leaderboard />);
    expect(screen.queryByText(/Moved up/)).not.toBeInTheDocument();
  });

  it("a signed-in agent outside the active roster gets an unavailable card — never zeros", () => {
    h.hookState = { ...baseHookState(), agents: ROSTER.slice(1).map((a, i) => ({ ...a, rank: i + 1 })) };
    render(<Leaderboard />);
    const card = screen.getByRole("region", { name: "Your Performance" });
    expect(card).toHaveTextContent("Your stats aren't on this board");
    expect(card).toHaveTextContent("Only active agents in your agency are ranked.");
    expect(card.textContent).not.toMatch(/\$|#\d|Rank|Policies|Calls/);
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });

  it("names the Agency Group in Group view", () => {
    h.hookState = { ...baseHookState(), view: "group", agencyGroup: { groupId: "g-1", groupName: "FFL National" } };
    render(<Leaderboard />);
    expect(screen.getByRole("region", { name: "Your Performance" })).toHaveTextContent("Today · FFL National");
  });
});

describe("truthful failure states", () => {
  it("keeps the last snapshot behind a stale banner when a refresh fails, and Retry refetches", () => {
    const retry = vi.fn();
    h.hookState = { ...baseHookState(), loadError: "Couldn't refresh standings.", retry };
    render(<Leaderboard />);

    // The board is still the last valid snapshot…
    expectShown(/Avery/);
    expectShown(/Drew/);
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

describe("maintenance and stale states (leaderboard recovery)", () => {
  const MIN = 60_000;
  const maintenance = (over: Partial<StandingsStatus> = {}): StandingsStatus => ({
    ...STANDINGS_STATUS_OK,
    kind: "maintenance",
    nextCheckAt: Date.now() + 5 * MIN,
    manualAvailableAt: Date.now() + 5 * MIN,
    ...over,
  });

  it("with nothing loaded, the pause is a maintenance panel — no board, no Recent Wins, no 'check your connection', no active Retry", () => {
    h.hookState = {
      ...baseHookState(),
      agents: [],
      loadError: "Standings are paused for maintenance.",
      standingsStatus: maintenance(),
    };
    render(<Leaderboard />);
    expect(screen.getByText("Standings are paused for maintenance.")).toBeInTheDocument();
    expect(screen.getByText(/We'll check again automatically at/)).toBeInTheDocument();
    expect(screen.queryByText(/connection/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No agents on the board")).not.toBeInTheDocument();
    expect(screen.queryByText(/Recent Wins/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/i })).not.toBeInTheDocument();
  });

  it("over a snapshot, preserves the real status strip without the removed activity banner", () => {
    const zeros = ROSTER.map((a, i) => agent({ ...a, callsMade: 0, policiesSold: 0, premiumSold: 0, conversionRate: 0, rank: i + 1 }));
    h.hookState = {
      ...baseHookState(),
      agents: zeros,
      standingsFrozen: true,
      loadError: "Standings are paused for maintenance.",
      standingsStatus: maintenance({ lastUpdatedAt: new Date(2026, 8, 25, 9, 5).getTime() }),
    };
    render(<Leaderboard />);
    // The branding mock formats times as String(date).
    expect(screen.getByText(/Standings are paused for maintenance\. Showing results from .*09:05:00/)).toBeInTheDocument();
    expect(screen.queryByText(/^No activity as of/)).not.toBeInTheDocument();
    expect(screen.queryByText(/first sale takes the lead/i)).not.toBeInTheDocument();
  });

  it("a Retry that is not accepted yet stays focusable, says when it will be, and sends nothing", () => {
    const retry = vi.fn();
    h.hookState = {
      ...baseHookState(),
      agents: [],
      loadError: "Couldn't load the leaderboard.",
      retry,
      standingsStatus: { ...STANDINGS_STATUS_OK, kind: "error", manualAvailableAt: Date.now() + 20_000 },
    };
    render(<Leaderboard />);
    const button = screen.getByRole("button", { name: /Retry/i });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleDescription(/Retry available at/);
    fireEvent.click(button);
    expect(retry).not.toHaveBeenCalled();
  });

  it("Recent Wins: a failed read says unavailable, a pending read shows no 'No wins yet'", () => {
    h.hookState = { ...baseHookState(), wins: [], winsStatus: { kind: "error", lastUpdatedAt: null } };
    const { unmount } = render(<Leaderboard />);
    expect(screen.getByText("Recent wins are unavailable right now.")).toBeInTheDocument();
    expect(screen.queryByText(/No wins yet/)).not.toBeInTheDocument();
    unmount();

    h.hookState = { ...baseHookState(), wins: [], winsStatus: { kind: "loading", lastUpdatedAt: null } };
    render(<Leaderboard />);
    expect(screen.getByText("Loading recent wins…").closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByText(/No wins yet/)).not.toBeInTheDocument();
  });
});

describe("offline (review follow-up)", () => {
  it("offline with standings on screen is not live: the strip says so, with no Retry that cannot succeed", () => {
    h.hookState = {
      ...baseHookState(),
      standingsStatus: { ...STANDINGS_STATUS_OK, lastUpdatedAt: new Date(2026, 8, 25, 9, 5).getTime(), offline: true },
    };
    render(<Leaderboard />);
    expect(screen.getByText(/Standings are not updating\. Showing results from .*09:05:00.*You're offline/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/i })).not.toBeInTheDocument();
  });
});

describe("rev 1.2: offline mount and pending switches", () => {
  it("offline with nothing loaded shows the offline banner (with the filters), never an endless skeleton or 'No agents'", () => {
    h.hookState = {
      ...baseHookState(),
      agents: [],
      initialLoading: true,
      standingsStatus: { ...STANDINGS_STATUS_OK, offline: true },
    };
    render(<Leaderboard />);
    expect(screen.getByText("Standings are not updating.")).toBeInTheDocument();
    expect(screen.getByText("You're offline — standings can't load until you reconnect.")).toBeInTheDocument();
    expect(screen.queryByText("No agents on the board")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/i })).not.toBeInTheDocument();
  });

  it("a switch still loading with no rows shows a loading board — never 'No agents on the board' before a read says so", () => {
    h.hookState = { ...baseHookState(), agents: [], filterRefreshing: true };
    render(<Leaderboard />);
    expect(screen.queryByText("No agents on the board")).not.toBeInTheDocument();
    expect(screen.getByText("Loading standings…")).toBeInTheDocument();
  });
});

describe("rev 1.2 review: no spinner while offline", () => {
  it("an offline switch shows the offline banner with no 'Refreshing' spinner (nothing is in flight)", () => {
    h.hookState = {
      ...baseHookState(),
      agents: [],
      filterRefreshing: true,
      standingsStatus: { ...STANDINGS_STATUS_OK, offline: true },
    };
    render(<Leaderboard />);
    expect(screen.getByText("Standings are not updating.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Refreshing")).not.toBeInTheDocument();
  });
});

describe("D14: a wholly unknown premium is never shown as a $0 sale", () => {
  // Ranks come from the data and stay as given; only the displayed premium changes.
  const D14_ROSTER: AgentStats[] = [
    agent({ id: "bbbb0000-0000-0000-0000-000000000001", first_name: "Avery", last_name: "Adams", policiesSold: 4, premiumSold: 4800, unknownPremiums: 0, rank: 1 }),
    agent({ id: "bbbb0000-0000-0000-0000-000000000002", first_name: "Blake", last_name: "Brooks", policiesSold: 3, premiumSold: 3600, unknownPremiums: 1, rank: 2 }),
    agent({ id: "bbbb0000-0000-0000-0000-000000000003", first_name: "Casey", last_name: "Cole", policiesSold: 2, premiumSold: 0, unknownPremiums: 2, rank: 3 }),
    agent({ id: "bbbb0000-0000-0000-0000-000000000004", first_name: "Drew", last_name: "Dunn", policiesSold: 2, premiumSold: 0, unknownPremiums: 2, rank: 4 }),
    agent({ id: "bbbb0000-0000-0000-0000-000000000005", first_name: "Emery", last_name: "Ellis", policiesSold: 1, premiumSold: 0, unknownPremiums: 0, rank: 5 }),
    agent({ id: "bbbb0000-0000-0000-0000-000000000006", first_name: "Finley", last_name: "Fox", policiesSold: 0, premiumSold: 0, unknownPremiums: 0, rank: 6 }),
  ];
  const premiumCell = (name: string) =>
    (screen.getByText(name).closest('[role="row"]') as HTMLElement).querySelectorAll('[role="cell"]')[2] as HTMLElement;

  it("full rankings: all-unknown shows — with its marker; partial keeps the subtotal; genuine and empty zeros stay $0.00", () => {
    h.hookState = { ...baseHookState(), agents: D14_ROSTER };
    render(<Leaderboard />);
    expect(premiumCell("Drew D.").textContent).toBe("—*");
    expect(premiumCell("Drew D.").querySelector("[title]")).toHaveAttribute("title", "2 policies have unknown premium");
    expect(premiumCell("Emery E.").textContent).toBe("$0.00"); // a known $0 premium
    expect(premiumCell("Finley F.").textContent).toBe("$0.00"); // no policies
    const rows = Array.from(document.querySelectorAll('[role="rowgroup"] [role="row"]')).map((r) => r.querySelectorAll('[role="cell"]')[0].textContent);
    expect(rows).toEqual(["1", "2", "3", "4", "5", "6"]); // order and ranks unchanged (top three included)
  });

  it("podium: an all-unknown premium reads —, a partial one keeps its amount", () => {
    h.hookState = { ...baseHookState(), agents: D14_ROSTER };
    render(<Leaderboard />);
    // One podium card per agent: the card root is the rounded flex column that carries the Annual Premium caption.
    const podiumValue = (first: string) => {
      const cards = [...new Set(screen.getAllByText(new RegExp(`^${first}`))
        .map((e) => e.closest(".rounded-xl.flex-col.items-center")).filter(Boolean))] as HTMLElement[];
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent("Annual Premium");
      return cards[0];
    };
    expect(podiumValue("Casey")).toHaveTextContent("—");
    expect(podiumValue("Casey")).not.toHaveTextContent("$0.00");
    expect(podiumValue("Blake")).toHaveTextContent("$3,600.00");
  });

  it("podium: policies sold with every premium known and totalling $0 keep a genuine $0.00", () => {
    const roster = [D14_ROSTER[0], D14_ROSTER[1], { ...D14_ROSTER[4], rank: 3 }, { ...D14_ROSTER[2], rank: 4 }];
    h.hookState = { ...baseHookState(), agents: roster };
    render(<Leaderboard />);
    const cards = [...new Set(screen.getAllByText(/^Emery/).map((e) => e.closest(".rounded-xl.flex-col.items-center")).filter(Boolean))] as HTMLElement[];
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("$0.00");
    expect(cards[0]).not.toHaveTextContent("—");
    expect(premiumCell("Casey C.").textContent).toBe("—*"); // the all-unknown agent, now in the table
  });
});

describe("on-screen notes under the filters (material only)", () => {
  const NOTES = /Active agents ·|As of |policies with unknown premium|Talk time includes|Outside active roster|Stored call duration|unknown provenance/;
  const snapshotWith = (over: Record<string, unknown>) => ({ ...baseHookState().performanceSnapshot, ...over });

  it("a routine snapshot renders no caption", () => {
    render(<Leaderboard />);
    expectShown(/Avery/);
    expect(screen.queryAllByText(NOTES)).toHaveLength(0);
  });

  it("activity outside the active roster renders exactly that note", () => {
    h.hookState = { ...baseHookState(), performanceSnapshot: snapshotWith({ excluded: { calls_made: 2, appointments_set: 0, policies_sold: 0 } }) };
    render(<Leaderboard />);
    expect(screen.getAllByText(NOTES)).toHaveLength(1);
    expect(screen.getByText("Outside active roster: 2 calls, 0 policies")).toBeInTheDocument();
  });

  it("unknown premiums render their note; estimated talk time no longer adds one (Talk Time is not on the board)", () => {
    const rows = ROSTER.map((a, i) => (i === 0 ? { ...a, unknownPremiums: 1, estimatedDurationCalls: 2, unknownDurationCalls: 5 } : a));
    h.hookState = { ...baseHookState(), performanceSnapshot: snapshotWith({ rows }) };
    render(<Leaderboard />);
    expect(screen.getByText("Annual premium (1 policies with unknown premium)")).toBeInTheDocument();
    expect(screen.queryByText(/Talk time includes|unknown provenance|Stored call duration/)).not.toBeInTheDocument();
  });
});
