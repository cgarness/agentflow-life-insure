import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent, cleanup, act } from "@testing-library/react";

/**
 * Regression suite for the Dashboard LeaderboardWidget half of the org
 * leaderboard RLS accuracy fix (approved D1).
 *
 * The defect being locked out: the widget's org view used to read raw
 * `clients` rows created this month and present the per-agent count as
 * "Wins" — a metric that contradicts the wins canon AND returns zero rows
 * for other agents under Agent RLS. Standings must come from the
 * `get_org_leaderboard_stats` aggregate (policies_sold → Wins), failures
 * must never render as a fake empty/zero board, and a superseded in-flight
 * response must never commit.
 */

const h = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  fromTables: [] as string[],
  mode: "auto" as "auto" | "manual",
  pending: [] as Array<(v: { data: unknown; error: unknown }) => void>,
  autoResult: (() => ({ data: [] as unknown, error: null as unknown })) as () => {
    data: unknown;
    error: unknown;
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = () => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ["select", "eq", "in", "gte", "lt", "lte", "order", "limit"]) q[m] = chain;
    q.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
    return q;
  };
  return {
    supabase: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        h.rpcCalls.push({ fn, args });
        if (h.mode === "manual") {
          return new Promise((resolve) => {
            h.pending.push(resolve as (v: { data: unknown; error: unknown }) => void);
          });
        }
        return Promise.resolve(h.autoResult());
      },
      from: (table: string) => {
        h.fromTables.push(table);
        return makeQuery();
      },
    },
  };
});

vi.mock("@/hooks/useAgencyGroup", () => ({
  useAgencyGroup: () => ({ agencyGroup: null }),
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

const THREE_ROWS = [
  rpcRow(),
  rpcRow({ agent_id: AG2, first_name: "Blake", last_name: "Brooks", policies_sold: 2 }),
  rpcRow({ agent_id: AG3, first_name: "Casey", last_name: "Cole", policies_sold: 1 }),
];

const rpcOk = (rows: unknown[]) => () => ({ data: rows, error: null });
const rpcFail = () => () => ({
  data: null,
  error: { message: "permission denied", code: "42501" },
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  h.rpcCalls.length = 0;
  h.fromTables.length = 0;
  h.pending.length = 0;
  h.mode = "auto";
  h.autoResult = rpcOk(THREE_ROWS);
  navigateSpy.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("org standings source", () => {
  it("loads the org view from get_org_leaderboard_stats over the current month and reads NO raw clients/profiles", async () => {
    render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery")).toBeInTheDocument());

    const boardCalls = h.rpcCalls.filter((c) => c.fn === "get_org_leaderboard_stats");
    expect(boardCalls.length).toBeGreaterThan(0);
    const now = new Date();
    const args = boardCalls[0].args as { p_start: string; p_end: string };
    expect(args.p_start).toBe(new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
    expect(new Date(args.p_end).getTime()).toBeGreaterThan(new Date(args.p_start).getTime());

    // The old fan-out read raw clients (as its "wins") and profiles (roster).
    expect(h.fromTables).not.toContain("clients");
    expect(h.fromTables).not.toContain("profiles");
  });

  it("maps policies_sold to Wins", async () => {
    h.autoResult = rpcOk([rpcRow({ policies_sold: 7 })]);
    render(<LeaderboardWidget userId={AG1} />);
    // "Your Standing" bar renders the current user's canonical wins count.
    await waitFor(() => expect(screen.getByText("7 Wins")).toBeInTheDocument());
    expect(screen.getByText("7")).toBeInTheDocument(); // podium pts value
  });
});

describe("truthful failure states", () => {
  it("shows the error state with Retry on initial failure — never the fake empty board — and Retry recovers", async () => {
    h.autoResult = rpcFail();
    render(<LeaderboardWidget userId={AG1} />);

    await waitFor(() => expect(screen.getByText("Couldn't load standings")).toBeInTheDocument());
    expect(screen.queryByText("No sales data yet")).not.toBeInTheDocument();

    h.autoResult = rpcOk(THREE_ROWS);
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));

    await waitFor(() => expect(screen.getByText("Avery")).toBeInTheDocument());
    expect(screen.queryByText("Couldn't load standings")).not.toBeInTheDocument();
    expect(h.rpcCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the last ranked snapshot behind the stale note when a refresh fails", async () => {
    const { rerender } = render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(screen.getByText("Avery")).toBeInTheDocument());

    // A re-fetch (same effect path the view/user changes take) that fails must
    // not blank the board into "No sales data yet" or fake zeros.
    h.autoResult = rpcFail();
    rerender(<LeaderboardWidget userId={AG2} />);

    await waitFor(() =>
      expect(screen.getByText(/Refresh failed — standings may be out of date/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("Avery")).toBeInTheDocument();
    expect(screen.queryByText("No sales data yet")).not.toBeInTheDocument();

    // Retry from the stale note recovers and clears it.
    h.autoResult = rpcOk(THREE_ROWS);
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    await waitFor(() =>
      expect(screen.queryByText(/Refresh failed/i)).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Avery")).toBeInTheDocument();
  });
});

describe("stale-response protection", () => {
  it("a superseded in-flight response cannot commit; the newest one renders", async () => {
    h.mode = "manual";
    const { rerender } = render(<LeaderboardWidget userId={AG1} />);
    await waitFor(() => expect(h.pending).toHaveLength(1));

    // Supersede the first request (cleanup cancels it) before it resolves.
    rerender(<LeaderboardWidget userId={AG2} />);
    await waitFor(() => expect(h.pending).toHaveLength(2));

    // The cancelled request resolves late with different data — must not render.
    act(() => {
      h.pending[0]({ data: [rpcRow({ first_name: "Stale" })], error: null });
    });
    await flush();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();

    act(() => {
      h.pending[1]({ data: [rpcRow({ first_name: "Fresh" })], error: null });
    });
    await flush();
    await waitFor(() => expect(screen.getByText("Fresh")).toBeInTheDocument());
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
  });
});
