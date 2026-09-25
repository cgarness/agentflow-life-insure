import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent, cleanup, act, within } from "@testing-library/react";

/**
 * Regression suite for the Dashboard LeaderboardWidget.
 *
 * Data-source half (org leaderboard RLS accuracy fix, approved D1): standings
 * must come from the `get_org_leaderboard_stats` aggregate, ranked by its
 * canonical `policies_sold` — never rebuilt from raw `clients`/`profiles`
 * rows, which return zero rows for other agents under Agent RLS. Failures must
 * never render as a fake empty/zero board, and a superseded in-flight response
 * must never commit.
 *
 * Presentation half (standings-preview simplification): the widget shows only
 * rank, profile photo (initials fallback) and name for the top 3 — no points,
 * wins, trophies or "Your Standing" card — and never presents an all-zero
 * month's alphabetical tie-break as a real #1/#2/#3.
 */

type RpcResult = { data: unknown; error: unknown };
type GroupInfo = { groupId: string; groupName: string; role: "leader" | "member" };

const h = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  fromTables: [] as string[],
  mode: "auto" as "auto" | "manual",
  pending: [] as Array<(v: { data: unknown; error: unknown }) => void>,
  autoResult: ((_fn: string) => ({ data: [] as unknown, error: null as unknown })) as (fn: string) => {
    data: unknown;
    error: unknown;
  },
  // Must stay the same object between renders — it is an effect dependency.
  agencyGroup: null as null | { groupId: string; groupName: string; role: "leader" | "member" },
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = () => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ["abortSignal", "select", "eq", "in", "gte", "lt", "lte", "order", "limit"]) q[m] = chain;
    q.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
    return q;
  };
  return {
    supabase: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        h.rpcCalls.push({ fn, args });
        if (h.mode === "manual") {
          const request = new Promise((resolve) => {
            h.pending.push(resolve as (v: { data: unknown; error: unknown }) => void);
          });
          return Object.assign(request, { abortSignal: () => request });
        }
        const request = Promise.resolve(h.autoResult(fn));
        return Object.assign(request, { abortSignal: () => request });
      },
      from: (table: string) => {
        h.fromTables.push(table);
        return makeQuery();
      },
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: { organization_id: "test-org" } }),
}));

vi.mock("@/hooks/useAgencyGroup", () => ({
  useAgencyGroup: () => ({ agencyGroup: h.agencyGroup, isLoading: false }),
}));

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigateSpy,
}));

import LeaderboardWidget from "@/components/dashboard/widgets/LeaderboardWidget";

const AG1 = "aaaa0000-0000-0000-0000-000000000001";
const AG2 = "aaaa0000-0000-0000-0000-000000000002";
const AG3 = "aaaa0000-0000-0000-0000-000000000003";
const AG4 = "aaaa0000-0000-0000-0000-000000000004";
const AVERY_PHOTO = "https://cdn.example.test/avatars/avery.png";
const GROUP: GroupInfo = { groupId: "bbbb0000-0000-0000-0000-00000000000g", groupName: "Summit Partners", role: "member" };
const NO_SALES_COPY = "No sales recorded yet this month.";

const rpcRow = (over: Record<string, unknown> = {}) => ({
  agent_id: AG1,
  first_name: "Avery",
  last_name: "Adams",
  avatar_url: "",
  calls_made: 10,
  appointments_set: 2,
  policies_sold: 4,
  annualized_premium: 4800,
  talk_time_seconds: 300,
  recent_wins_7d: 1,
  ...over,
});

const groupRow = (over: Record<string, unknown> = {}) => ({
  organization_id: "cccc0000-0000-0000-0000-000000000001",
  organization_name: "North Agency",
  agent_id: AG1,
  agent_first_name: "Gale",
  agent_last_name: "Grant",
  agent_avatar_url: "",
  calls_made: 5,
  appointments_set: 1,
  policies_sold: 6,
  talk_time_seconds: 100,
  ...over,
});

const THREE_ROWS = [
  rpcRow(),
  rpcRow({ agent_id: AG2, first_name: "Blake", last_name: "Brooks", policies_sold: 2 }),
  rpcRow({ agent_id: AG3, first_name: "Casey", last_name: "Cole", policies_sold: 1 }),
];

const GROUP_ROWS = [
  groupRow({ agent_id: AG3, agent_first_name: "Hana", agent_last_name: "Hill", organization_name: "South Agency", policies_sold: 2 }),
  groupRow(),
];

const rpcOk = (rows: unknown[]) => () => ({ data: rows, error: null });
const rpcFail = () => () => ({
  data: null,
  error: { message: "permission denied", code: "42501" },
});
const byRpc =
  (org: () => RpcResult, group: () => RpcResult) =>
  (fn: string): RpcResult =>
    fn === "get_agency_group_leaderboard" ? group() : org();

const callsTo = (fn: string) => h.rpcCalls.filter((c) => c.fn === fn);
const rankedRows = () =>
  within(screen.getByRole("list", { name: /top agents/i })).getAllByRole("listitem");
const rankLabelOf = (row: HTMLElement) => within(row).getByText(/^#\d+$/).textContent;

// jsdom never loads images (no canvas), so Radix Avatar would stay on the
// initials forever. Make the real <img> path reachable; restoreAllMocks undoes it.
const imagesLoadInstantly = () => {
  vi.spyOn(window.HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  vi.spyOn(window.HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1);
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

let gateNow = Date.now();
beforeEach(() => {
  gateNow = Date.now();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.spyOn(Date, "now").mockImplementation(() => gateNow);
  h.rpcCalls.length = 0;
  h.fromTables.length = 0;
  h.pending.length = 0;
  h.mode = "auto";
  h.autoResult = rpcOk(THREE_ROWS);
  h.agencyGroup = null;
  navigateSpy.mockReset();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  // Only the widget's own expected failure log may be silenced; any React
  // warning (missing key, bad nesting, act) must fail the test.
  const unexpected = consoleErrorSpy.mock.calls.filter(
    (args) => !String(args[0]).startsWith("[LeaderboardWidget]"),
  );
  cleanup();
  vi.restoreAllMocks();
  expect(unexpected).toEqual([]);
});

describe("org standings source", () => {
  it("loads the org view from get_org_leaderboard_stats over the current month and reads NO raw clients/profiles", async () => {
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());

    const boardCalls = callsTo("get_org_leaderboard_stats");
    expect(boardCalls.length).toBeGreaterThan(0);
    const now = new Date();
    const args = boardCalls[0].args as { p_start: string; p_end: string };
    expect(args.p_start).toBe(new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
    expect(new Date(args.p_end).getTime()).toBeGreaterThan(new Date(args.p_start).getTime());

    // The old fan-out read raw clients (as its "wins") and profiles (roster).
    expect(h.fromTables).not.toContain("clients");
    expect(h.fromTables).not.toContain("profiles");
  });

  it("stays on the org RPC by default even when an agency group exists", async () => {
    h.agencyGroup = GROUP;
    h.autoResult = byRpc(rpcOk(THREE_ROWS), rpcOk(GROUP_ROWS));
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Group" })).toBeInTheDocument();
    expect(callsTo("get_org_leaderboard_stats").length).toBeGreaterThan(0);
    expect(callsTo("get_agency_group_leaderboard")).toHaveLength(0);
    expect(h.fromTables).toHaveLength(0);
  });

  it("orders the top 3 by canonical policies_sold (ties: last name, first name, id) — not by input order, name, calls or premium", async () => {
    // Every other signal disagrees with the policies_sold order: Aaron Abbott
    // is first in input order, first alphabetically and top on calls, premium
    // and recent wins, yet has the fewest policies. The 4–4 tie is listed
    // out of order, and both its first names and its ids sort the opposite
    // way to its last names — only the last-name tie-break yields Brooks first.
    h.autoResult = rpcOk([
      rpcRow({ agent_id: AG1, first_name: "Aaron", last_name: "Abbott", policies_sold: 1, calls_made: 999, annualized_premium: 99999, recent_wins_7d: 9 }),
      rpcRow({ agent_id: AG2, first_name: "Dana", last_name: "Diaz", policies_sold: 4, calls_made: 3, annualized_premium: 30, recent_wins_7d: 0 }),
      rpcRow({ agent_id: AG3, first_name: "Casey", last_name: "Young", policies_sold: 7, calls_made: 2, annualized_premium: 20, recent_wins_7d: 0 }),
      rpcRow({ agent_id: AG4, first_name: "Zoe", last_name: "Brooks", policies_sold: 4, calls_made: 1, annualized_premium: 10, recent_wins_7d: 0 }),
    ]);
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(rankedRows()).toHaveLength(3));

    const rows = rankedRows();
    expect(rows.map(rankLabelOf)).toEqual(["#1", "#2", "#3"]);
    expect(within(rows[0]).getByText("Casey Young")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Zoe Brooks")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Dana Diaz")).toBeInTheDocument();
    expect(screen.queryByText("Aaron Abbott")).not.toBeInTheDocument();
  });
});

describe("standings preview rows", () => {
  it("renders each agent's profile photo, with the existing initials fallback when there is no photo", async () => {
    imagesLoadInstantly();
    h.autoResult = rpcOk([
      rpcRow({ avatar_url: AVERY_PHOTO }),
      rpcRow({ agent_id: AG2, first_name: "Blake", last_name: "Brooks", avatar_url: null, policies_sold: 2 }),
      rpcRow({ agent_id: AG3, first_name: "Casey", last_name: "Cole", avatar_url: "   ", policies_sold: 1 }),
    ]);
    render(<LeaderboardWidget userId={AG4} />);
    await waitFor(() => expect(rankedRows()).toHaveLength(3));
    const [avery, blake, casey] = rankedRows();

    const photo = within(avery).getByRole("img", { name: "Avery Adams" });
    expect(photo).toHaveAttribute("src", AVERY_PHOTO);
    expect(within(avery).queryByText("AA")).not.toBeInTheDocument();

    expect(within(blake).queryByRole("img")).not.toBeInTheDocument();
    expect(within(blake).getByText("BB")).toBeInTheDocument();
    expect(within(casey).queryByRole("img")).not.toBeInTheDocument();
    expect(within(casey).getByText("CC")).toBeInTheDocument();

    // Photos and fallbacks share one consistent size.
    for (const avatarRoot of [
      photo.parentElement,
      within(blake).getByText("BB").parentElement,
      within(casey).getByText("CC").parentElement,
    ]) {
      expect(avatarRoot).toHaveClass("h-10", "w-10");
    }
  });

  it("renders a neutral placeholder name and initials when a profile has no name", async () => {
    h.autoResult = rpcOk([rpcRow({ first_name: "", last_name: "" })]);
    render(<LeaderboardWidget userId={AG4} />);
    await waitFor(() => expect(rankedRows()).toHaveLength(1));
    const [row] = rankedRows();
    expect(within(row).getByText("Unnamed agent")).toBeInTheDocument();
    expect(within(row).getByText("?")).toBeInTheDocument();
    expect(rankLabelOf(row)).toBe("#1");
  });

  it.each([
    ["the user is in the top 3", AG1],
    ["the user is outside the top 3", AG4],
  ])("shows no points, wins, trophies, Your Standing card or motivational copy when %s", async (_label, userId) => {
    h.autoResult = rpcOk([
      ...THREE_ROWS.map((r, i) => ({ ...r, policies_sold: 987 - i })),
      rpcRow({ agent_id: AG4, first_name: "Dana", last_name: "Diaz", policies_sold: 1 }),
    ]);
    const { container } = render(<LeaderboardWidget userId={userId} />);
    await waitFor(() => expect(rankedRows()).toHaveLength(3));

    // Per-element queries: concatenated textContent ("987pts") has no word boundary.
    expect(screen.queryAllByText(/\bpts\b/i)).toHaveLength(0);
    expect(screen.queryAllByText(/\bpoints?\b/i)).toHaveLength(0);
    expect(screen.queryAllByText(/\bwins?\b/i)).toHaveLength(0);
    expect(screen.queryAllByText(/98[567]/)).toHaveLength(0);
    expect(screen.queryByText(/Your Standing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/On the podium!/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Keep pushing!/i)).not.toBeInTheDocument();
    expect(container.querySelector(".lucide-trophy, .lucide-medal, .lucide-star")).toBeNull();
    // No award-style decoration of any kind inside the standings rows.
    expect(screen.getByRole("list", { name: /top agents/i }).querySelector("svg")).toBeNull();
  });

  it("marks only the current user's row, with a subtle tint and a small You label and no score", async () => {
    render(<LeaderboardWidget userId={AG2} />);
    await waitFor(() => expect(rankedRows()).toHaveLength(3));
    const [first, mine, third] = rankedRows();

    expect(within(mine).getByText("Blake Brooks")).toBeInTheDocument();
    expect(within(mine).getByText("You")).toBeInTheDocument();
    expect(mine).toHaveClass("bg-primary/5");
    for (const other of [first, third]) {
      expect(within(other).queryByText("You")).not.toBeInTheDocument();
      expect(other).not.toHaveClass("bg-primary/5");
    }
    expect(screen.getAllByText("You")).toHaveLength(1);
    expect(within(mine).queryAllByText(/\d/).filter((el) => el.textContent !== "#2")).toHaveLength(0);
  });

  it("marks no row and adds no standing card when the current user is outside the top 3", async () => {
    // Dana has a sale but ranks #4 (1–1 tie with Cole, broken by last name).
    h.autoResult = rpcOk([
      ...THREE_ROWS,
      rpcRow({ agent_id: AG4, first_name: "Dana", last_name: "Diaz", policies_sold: 1 }),
    ]);
    render(<LeaderboardWidget userId={AG4} />);
    await waitFor(() => expect(rankedRows()).toHaveLength(3));

    expect(screen.queryByText("You")).not.toBeInTheDocument();
    expect(screen.queryByText("Dana Diaz")).not.toBeInTheDocument();
    for (const row of rankedRows()) expect(row).not.toHaveClass("bg-primary/5");
  });

  it("View Full Standings navigates to /leaderboard", async () => {
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(rankedRows()).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: /View Full Standings/i }));
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith("/leaderboard");
  });
});

describe("zero-activity month", () => {
  it("shows the neutral no-sales message instead of an alphabetical #1/#2/#3 when nobody has sold", async () => {
    h.autoResult = rpcOk([
      rpcRow({ policies_sold: 0 }),
      rpcRow({ agent_id: AG2, first_name: "Blake", last_name: "Brooks", policies_sold: 0 }),
      rpcRow({ agent_id: AG3, first_name: "Casey", last_name: "Cole", policies_sold: 0 }),
    ]);
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText(NO_SALES_COPY)).toBeInTheDocument());

    expect(screen.queryByRole("list", { name: /top agents/i })).not.toBeInTheDocument();
    expect(screen.queryAllByText(/^#\d+$/)).toHaveLength(0);
    for (const name of ["Avery Adams", "Blake Brooks", "Casey Cole"]) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
    expect(screen.queryByText("You")).not.toBeInTheDocument();
    expect(screen.queryByText("No sales data yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load standings")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /View Full Standings/i })).toBeInTheDocument();
    // Still the canonical source — the safeguard is presentation only.
    expect(callsTo("get_org_leaderboard_stats").length).toBeGreaterThan(0);
  });

  it("does not present a lone zero-sales agent as #1 either", async () => {
    h.autoResult = rpcOk([rpcRow({ policies_sold: 0 })]);
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText(NO_SALES_COPY)).toBeInTheDocument());
    expect(screen.queryByRole("list", { name: /top agents/i })).not.toBeInTheDocument();
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });

  it("keeps the stale note (with a working Retry) when a refresh fails over a zero-sales snapshot", async () => {
    const zeroRows = THREE_ROWS.map((r) => ({ ...r, policies_sold: 0 }));
    h.autoResult = rpcOk(zeroRows);
    const { rerender } = render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText(NO_SALES_COPY)).toBeInTheDocument());

    h.autoResult = rpcFail();
    gateNow += 31_000;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() =>
      expect(screen.getByText(/Refresh failed — standings may be out of date/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(NO_SALES_COPY)).toBeInTheDocument();

    h.autoResult = rpcOk(zeroRows);
    gateNow += 31_000;
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    await waitFor(() => expect(screen.queryByText(/Refresh failed/i)).not.toBeInTheDocument());
    expect(screen.getByText(NO_SALES_COPY)).toBeInTheDocument();
  });

  // Zero-sale agents only tie, so in a partly-zero month they never fill the
  // remaining slots: sellers only, ranks unchanged. The viewer (Avery, first
  // alphabetically and so first among the zero ties) has no sale in each case.
  it.each([
    ["one agent has sold", { Blake: 3 }, ["#1 Blake Brooks"]],
    ["two agents have sold", { Blake: 3, Dana: 5 }, ["#1 Dana Diaz", "#2 Blake Brooks"]],
    [
      "three or more agents have sold",
      { Blake: 3, Dana: 5, Casey: 1, Evan: 2 },
      ["#1 Dana Diaz", "#2 Blake Brooks", "#3 Evan Ellis"],
    ],
  ])("shows only agents with a sale when %s", async (_label, sold, expected) => {
    const roster = [
      rpcRow({ agent_id: AG1, first_name: "Avery", last_name: "Adams" }),
      rpcRow({ agent_id: AG2, first_name: "Blake", last_name: "Brooks" }),
      rpcRow({ agent_id: AG3, first_name: "Casey", last_name: "Cole" }),
      rpcRow({ agent_id: AG4, first_name: "Dana", last_name: "Diaz" }),
      rpcRow({ agent_id: "aaaa0000-0000-0000-0000-000000000005", first_name: "Evan", last_name: "Ellis" }),
    ].map((r) => ({ ...r, policies_sold: (sold as Record<string, number>)[r.first_name] ?? 0 }));
    h.autoResult = rpcOk(roster);
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(rankedRows()).toHaveLength(expected.length));

    const shown = rankedRows().map((row) => `${rankLabelOf(row)} ${within(row).getByRole("paragraph").textContent}`);
    expect(shown).toEqual(expected);
    expect(screen.queryByText("Avery Adams")).not.toBeInTheDocument();
    expect(screen.queryByText("You")).not.toBeInTheDocument();
    expect(screen.queryByText(NO_SALES_COPY)).not.toBeInTheDocument();
  });

  it("shows only agents with a sale in the group view too", async () => {
    h.agencyGroup = GROUP;
    h.autoResult = byRpc(
      rpcOk(THREE_ROWS),
      rpcOk([groupRow({ policies_sold: 2 }), groupRow({ agent_id: AG3, agent_first_name: "Hana", agent_last_name: "Hill", policies_sold: 0 })]),
    );
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    await waitFor(() => expect(screen.getByText("Gale Grant")).toBeInTheDocument());
    expect(rankedRows()).toHaveLength(1);
    expect(screen.queryByText("Hana Hill")).not.toBeInTheDocument();
  });

  it("applies the same safeguard to the group view", async () => {
    h.agencyGroup = GROUP;
    h.autoResult = byRpc(rpcOk(THREE_ROWS), rpcOk(GROUP_ROWS.map((r) => ({ ...r, policies_sold: 0 }))));
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    await waitFor(() => expect(screen.getByText(NO_SALES_COPY)).toBeInTheDocument());
    expect(screen.queryByText("Gale Grant")).not.toBeInTheDocument();
    expect(screen.queryByText("North Agency")).not.toBeInTheDocument();

    // The toggle stays available, so the user is never stuck in the group view.
    fireEvent.click(screen.getByRole("button", { name: "My Agency" }));
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());
    expect(screen.queryByText(NO_SALES_COPY)).not.toBeInTheDocument();
  });
});

describe("empty roster", () => {
  it("shows the neutral empty state — no list, no trophy, no error", async () => {
    h.autoResult = rpcOk([]);
    const { container } = render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("No sales data yet")).toBeInTheDocument());

    expect(container.querySelector(".lucide-users")).not.toBeNull();
    expect(container.querySelector(".lucide-trophy")).toBeNull();
    expect(screen.queryByRole("list", { name: /top agents/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load standings")).not.toBeInTheDocument();
    expect(screen.queryByText(NO_SALES_COPY)).not.toBeInTheDocument();
  });
});

describe("agency group view", () => {
  it("Group loads get_agency_group_leaderboard for the month, ranks it, and shows org names as secondary text", async () => {
    h.agencyGroup = GROUP;
    h.autoResult = byRpc(rpcOk(THREE_ROWS), rpcOk(GROUP_ROWS));
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    await waitFor(() => expect(screen.getByText("Gale Grant")).toBeInTheDocument());

    const groupCalls = callsTo("get_agency_group_leaderboard");
    expect(groupCalls).toHaveLength(1);
    expect(groupCalls[0].args).toEqual({ p_group_id: GROUP.groupId, p_period: "month" });

    const [first, second] = rankedRows();
    expect(rankLabelOf(first)).toBe("#1");
    expect(within(first).getByText("Gale Grant")).toBeInTheDocument();
    expect(within(first).getByText("North Agency")).toBeInTheDocument();
    expect(rankLabelOf(second)).toBe("#2");
    expect(within(second).getByText("Hana Hill")).toBeInTheDocument();
    expect(within(second).getByText("South Agency")).toBeInTheDocument();
    expect(h.fromTables).toHaveLength(0);

    // The current user (AG1 = Gale Grant here) is marked in the group view too.
    expect(within(first).getByText("You")).toBeInTheDocument();
    expect(first).toHaveClass("bg-primary/5");
    expect(within(second).queryByText("You")).not.toBeInTheDocument();
    expect(second).not.toHaveClass("bg-primary/5");
  });

  it("falls back to org standings when the group RPC fails, and resets the toggle so Group can be retried", async () => {
    h.agencyGroup = GROUP;
    h.autoResult = byRpc(rpcOk(THREE_ROWS), rpcFail());
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());
    const orgCallsBefore = callsTo("get_org_leaderboard_stats").length;

    gateNow += 31_000;
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    await waitFor(() =>
      expect(callsTo("get_org_leaderboard_stats").length).toBeGreaterThan(orgCallsBefore),
    );
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());
    expect(screen.queryByText("Couldn't load standings")).not.toBeInTheDocument();
    expect(callsTo("get_agency_group_leaderboard")).toHaveLength(1);

    // The view was reset to "org", so choosing Group again really re-requests it.
    gateNow += 31_000;
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    await waitFor(() => expect(callsTo("get_agency_group_leaderboard")).toHaveLength(2));
  });

  it("hides group org names when a kept group snapshot is shown under My Agency after an org refresh fails", async () => {
    h.agencyGroup = GROUP;
    let orgFails = false;
    h.autoResult = byRpc(() => (orgFails ? rpcFail()() : rpcOk(THREE_ROWS)()), rpcOk(GROUP_ROWS));
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    await waitFor(() => expect(screen.getByText("North Agency")).toBeInTheDocument());

    gateNow += 31_000;
    orgFails = true;
    fireEvent.click(screen.getByRole("button", { name: "My Agency" }));
    await waitFor(() =>
      expect(screen.getByText(/Refresh failed — standings may be out of date/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("Gale Grant")).toBeInTheDocument();
    expect(screen.queryByText("North Agency")).not.toBeInTheDocument();
    expect(screen.queryByText("South Agency")).not.toBeInTheDocument();
  });
});

describe("truthful failure states", () => {
  it("shows the error state with Retry on initial failure — never the fake empty board — and Retry recovers", async () => {
    h.autoResult = rpcFail();
    render(<LeaderboardWidget userId={AG1} />);

    await waitFor(() => expect(screen.getByText("Couldn't load standings")).toBeInTheDocument());
    expect(screen.queryByText("No sales data yet")).not.toBeInTheDocument();
    expect(screen.queryByText(NO_SALES_COPY)).not.toBeInTheDocument();

    h.autoResult = rpcOk(THREE_ROWS);
    gateNow += 31_000;
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));

    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());
    expect(screen.queryByText("Couldn't load standings")).not.toBeInTheDocument();
    expect(h.rpcCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the last ranked snapshot behind the stale note when a refresh fails", async () => {
    const { rerender } = render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());

    // A re-fetch (same effect path the view/user changes take) that fails must
    // not blank the board into "No sales data yet" or fake zeros.
    h.autoResult = rpcFail();
    gateNow += 31_000;
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() =>
      expect(screen.getByText(/Refresh failed — standings may be out of date/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("Avery Adams")).toBeInTheDocument();
    expect(screen.queryByText("No sales data yet")).not.toBeInTheDocument();

    // Retry from the stale note recovers and clears it.
    h.autoResult = rpcOk(THREE_ROWS);
    gateNow += 31_000;
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    await waitFor(() =>
      expect(screen.queryByText(/Refresh failed/i)).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Avery Adams")).toBeInTheDocument();
  });
});

describe("stale-response protection", () => {
  it("a superseded in-flight response cannot commit, or end the newer request's loading state; the newest one renders", async () => {
    h.mode = "manual";
    const { rerender, container } = render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(h.pending).toHaveLength(1));
    // Loading renders the three row placeholders, never a blank widget.
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);

    // Supersede the first request (cleanup cancels it) before it resolves.
    rerender(<LeaderboardWidget userId={AG2} />);
    await waitFor(() => expect(h.pending).toHaveLength(2));

    // The cancelled request resolves late with different data — must not render,
    // and must not flip the still-pending newer request into a fake empty board.
    act(() => {
      h.pending[0]({ data: [rpcRow({ first_name: "Stale" })], error: null });
    });
    await flush();
    expect(screen.queryByText("Stale Adams")).not.toBeInTheDocument();
    expect(screen.queryByText("No sales data yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /top agents/i })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);

    act(() => {
      h.pending[1]({ data: [rpcRow({ first_name: "Fresh" })], error: null });
    });
    await flush();
    await waitFor(() => expect(screen.getByText("Fresh Adams")).toBeInTheDocument());
    expect(screen.queryByText("Stale Adams")).not.toBeInTheDocument();
  });

  it("a superseded org response that resolves AFTER the newest one cannot overwrite it", async () => {
    h.mode = "manual";
    const { rerender } = render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(h.pending).toHaveLength(1));
    rerender(<LeaderboardWidget userId={AG2} />);
    await waitFor(() => expect(h.pending).toHaveLength(2));

    act(() => {
      h.pending[1]({ data: [rpcRow({ first_name: "Fresh" })], error: null });
    });
    await waitFor(() => expect(screen.getByText("Fresh Adams")).toBeInTheDocument());

    act(() => {
      h.pending[0]({ data: [rpcRow({ first_name: "Stale" })], error: null });
    });
    await flush();
    expect(screen.getByText("Fresh Adams")).toBeInTheDocument();
    expect(screen.queryByText("Stale Adams")).not.toBeInTheDocument();
  });

  it("a superseded group response that resolves AFTER the newest one cannot overwrite it", async () => {
    h.agencyGroup = GROUP;
    h.mode = "manual";
    const { rerender } = render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(h.pending).toHaveLength(1));
    act(() => {
      h.pending[0]({ data: THREE_ROWS, error: null });
    });
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    await waitFor(() => expect(h.pending).toHaveLength(2));
    rerender(<LeaderboardWidget userId={AG2} />);
    await waitFor(() => expect(h.pending).toHaveLength(3));
    expect(callsTo("get_agency_group_leaderboard")).toHaveLength(2);

    act(() => {
      h.pending[2]({ data: [groupRow({ agent_first_name: "Fresh" })], error: null });
    });
    await waitFor(() => expect(screen.getByText("Fresh Grant")).toBeInTheDocument());

    act(() => {
      h.pending[1]({ data: [groupRow({ agent_first_name: "Stale" })], error: null });
    });
    await flush();
    expect(screen.getByText("Fresh Grant")).toBeInTheDocument();
    expect(screen.queryByText("Stale Grant")).not.toBeInTheDocument();
  });
});


describe("Dashboard request resilience", () => {
  it("does not retain the previous identity's snapshot after an account change", async () => {
    const { rerender } = render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());
    h.autoResult = rpcFail();
    rerender(<LeaderboardWidget userId={AG2} />);
    await waitFor(() => expect(screen.getByText("Couldn't load standings")).toBeInTheDocument());
    expect(screen.queryByText("Avery Adams")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /top agents/i })).not.toBeInTheDocument();
  });

  it("does not turn repeated Retry clicks into repeated backend requests", async () => {
    h.autoResult = rpcFail();
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Couldn't load standings")).toBeInTheDocument());
    const count = h.rpcCalls.length;
    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
      await flush();
    }
    expect(h.rpcCalls).toHaveLength(count);
  });

  it("reuses the valid agency snapshot when returning from a group failure within ten seconds", async () => {
    h.agencyGroup = GROUP;
    h.autoResult = byRpc(rpcOk(THREE_ROWS), rpcFail());
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    await flush();
    await waitFor(() => expect(screen.getByText("Avery Adams")).toBeInTheDocument());
    expect(callsTo("get_org_leaderboard_stats")).toHaveLength(1);
    expect(callsTo("get_agency_group_leaderboard")).toHaveLength(1);
  });
});
