import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, waitFor, act, cleanup } from "@testing-library/react";
import { startOfDay, startOfWeek } from "date-fns";

/**
 * Regression suite for the organization-leaderboard RLS accuracy fix.
 *
 * The defect being locked out: the org view used to reconstruct every agent's
 * metrics from raw `calls` / `appointments` / `clients` queries in the browser.
 * Under Agent RLS those queries silently return only the caller's own rows, so
 * every other agent rendered with fabricated zero/partial standings — and any
 * query error was also swallowed into zeros. Standings must come from the
 * `get_org_leaderboard_stats` aggregate RPC, and an RPC failure must surface an
 * explicit error state, never a plausible-looking zero board.
 */

const h = vi.hoisted(() => {
  const state = {
    rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    fromTables: [] as string[],
    mode: "auto" as "auto" | "manual",
    pending: [] as Array<(v: { data: unknown; error: unknown }) => void>,
    autoResult: (() => ({ data: [] as unknown, error: null as unknown })) as () => {
      data: unknown;
      error: unknown;
    },
  };
  return state;
});

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = () => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of [
      "select",
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "in",
      "order",
      "limit",
    ]) {
      q[m] = chain;
    }
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled, onRejected);
    return q;
  };
  const channelObj: Record<string, unknown> = {};
  channelObj.on = () => channelObj;
  channelObj.subscribe = () => channelObj;
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
      channel: () => channelObj,
      removeChannel: () => {},
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    profile: { organization_id: "0f000000-0000-0000-0000-0000000000aa" },
    user: { id: "aaaa0000-0000-0000-0000-000000000001" },
  }),
}));

vi.mock("@/hooks/useAgencyGroup", () => ({
  useAgencyGroup: () => ({ agencyGroup: null }),
}));

import { useLeaderboardData } from "@/hooks/useLeaderboardData";

type HookResult = ReturnType<typeof useLeaderboardData>;

let hookResult: HookResult;

function Probe() {
  hookResult = useLeaderboardData();
  return null;
}

const AGENT_A = "aaaa0000-0000-0000-0000-000000000001";
const AGENT_B = "aaaa0000-0000-0000-0000-000000000002";
const AGENT_C = "aaaa0000-0000-0000-0000-000000000003";

const rpcRow = (over: Record<string, unknown> = {}) => ({
  agent_id: AGENT_A,
  first_name: "Avery",
  last_name: "Adams",
  avatar_url: "",
  calls_made: 5,
  appointments_set: 2,
  policies_sold: 1,
  annualized_premium: 1200,
  talk_time_seconds: 300,
  recent_wins_7d: 3,
  ...over,
});

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
  h.autoResult = rpcOk([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("org view standings source", () => {
  it("loads standings from the get_org_leaderboard_stats aggregate RPC with half-open ISO bounds", async () => {
    h.autoResult = rpcOk([rpcRow(), rpcRow({ agent_id: AGENT_B, last_name: "Brooks" })]);
    render(<Probe />);

    await waitFor(() => expect(hookResult.agents).toHaveLength(2));

    const boardCalls = h.rpcCalls.filter((c) => c.fn === "get_org_leaderboard_stats");
    expect(boardCalls.length).toBeGreaterThan(0);
    const args = boardCalls[0].args as { p_start: string; p_end: string };
    // Default period is Today: browser-local midnight → now, serialized as ISO.
    expect(args.p_start).toBe(startOfDay(new Date()).toISOString());
    expect(new Date(args.p_end).getTime()).toBeGreaterThan(new Date(args.p_start).getTime());
  });

  it("issues NO raw calls/appointments/clients reads for org standings", async () => {
    h.autoResult = rpcOk([rpcRow()]);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));

    // The wins feed (RecentWinsPanel) is org-readable under RLS and stays a
    // direct query; the RLS-broken metric tables must never be read here.
    expect(h.fromTables).not.toContain("calls");
    expect(h.fromTables).not.toContain("appointments");
    expect(h.fromTables).not.toContain("clients");
  });

  it("maps RPC fields without re-annualizing premium and derives conversion rate client-side", async () => {
    h.autoResult = rpcOk([
      rpcRow({ annualized_premium: 1200, calls_made: 10, policies_sold: 2 }),
      rpcRow({
        agent_id: AGENT_B,
        last_name: "Brooks",
        calls_made: 0,
        policies_sold: 2,
        annualized_premium: 0,
        recent_wins_7d: 0,
      }),
    ]);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(2));

    const a = hookResult.agents.find((x) => x.id === AGENT_A)!;
    // The server already multiplied monthly premium × 12 exactly once.
    expect(a.premiumSold).toBe(1200);
    expect(a.conversionRate).toBe(20);
    expect(a.recentWins7d).toBe(3);
    expect(a.talkTime).toBe(300);
    expect(a.appointmentsSet).toBe(2);

    const b = hookResult.agents.find((x) => x.id === AGENT_B)!;
    expect(b.conversionRate).toBe(0); // zero calls ⇒ 0, never NaN/Infinity
  });

  it("ranks tied standings deterministically by last name, first name, then id", async () => {
    const tied = { calls_made: 0, appointments_set: 0, policies_sold: 0, annualized_premium: 0, talk_time_seconds: 0, recent_wins_7d: 0 };
    h.autoResult = rpcOk([
      rpcRow({ ...tied, agent_id: AGENT_C, first_name: "Zoe", last_name: "Zimmer" }),
      rpcRow({ ...tied, agent_id: AGENT_B, first_name: "Avery", last_name: "Adams" }),
      rpcRow({ ...tied, agent_id: AGENT_A, first_name: "Avery", last_name: "Adams" }),
    ]);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(3));

    expect(hookResult.agents.map((x) => x.id)).toEqual([AGENT_A, AGENT_B, AGENT_C]);
    expect(hookResult.agents.map((x) => x.rank)).toEqual([1, 2, 3]);
  });
});

describe("error contract — failures are never zero standings", () => {
  it("surfaces loadError on an initial RPC failure instead of a fake empty board", async () => {
    h.autoResult = rpcFail();
    render(<Probe />);

    await waitFor(() => expect(hookResult.loadError).toBeTruthy());
    expect(hookResult.agents).toHaveLength(0);
    expect(hookResult.initialLoading).toBe(false);
  });

  it("keeps the last valid snapshot when a refresh fails", async () => {
    h.autoResult = rpcOk([rpcRow({ calls_made: 7 })]);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));
    expect(hookResult.agents[0].callsMade).toBe(7);

    h.autoResult = rpcFail();
    await act(async () => {
      await hookResult.fetchData();
    });

    await waitFor(() => expect(hookResult.loadError).toBeTruthy());
    // The board must keep showing the last real standings — not zeros, not empty.
    expect(hookResult.agents).toHaveLength(1);
    expect(hookResult.agents[0].callsMade).toBe(7);
  });

  it("retry() clears the error and reloads standings", async () => {
    h.autoResult = rpcFail();
    render(<Probe />);
    await waitFor(() => expect(hookResult.loadError).toBeTruthy());

    h.autoResult = rpcOk([rpcRow()]);
    await act(async () => {
      hookResult.retry();
    });

    await waitFor(() => expect(hookResult.agents).toHaveLength(1));
    expect(hookResult.loadError).toBeNull();
  });
});

describe("stale-response protection", () => {
  it("discards an older in-flight response that resolves after a newer one", async () => {
    h.mode = "manual";
    render(<Probe />);
    await waitFor(() => expect(h.pending).toHaveLength(1));

    let secondFetch: Promise<void>;
    act(() => {
      secondFetch = hookResult.fetchData() as Promise<void>;
    });
    await waitFor(() => expect(h.pending).toHaveLength(2));

    // Newest resolves first…
    act(() => {
      h.pending[1]({ data: [rpcRow({ calls_made: 99, first_name: "New" })], error: null });
    });
    await flush();
    await act(async () => {
      await secondFetch!;
    });
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));
    expect(hookResult.agents[0].callsMade).toBe(99);

    // …then the stale original lands and must be ignored.
    act(() => {
      h.pending[0]({ data: [rpcRow({ calls_made: 1, first_name: "Old" })], error: null });
    });
    await flush();

    expect(hookResult.agents).toHaveLength(1);
    expect(hookResult.agents[0].callsMade).toBe(99);
    expect(hookResult.agents[0].first_name).toBe("New");
  });

  it("a silent poll that supersedes the visible INITIAL fetch settles initialLoading; the stale visible fetch cannot resurrect it", async () => {
    h.mode = "manual";
    render(<Probe />);
    // Visible initial fetch (gen 1) is pending.
    await waitFor(() => expect(h.pending).toHaveLength(1));
    expect(hookResult.initialLoading).toBe(true);

    // A silent poll (gen 2) supersedes it — exactly what the 4s interval does.
    act(() => {
      void hookResult.fetchData({ silent: true });
    });
    await waitFor(() => expect(h.pending).toHaveLength(2));

    // The newest (silent) fetch resolves: it must commit AND settle the
    // visible loading state the superseded fetch left behind.
    act(() => {
      h.pending[1]({ data: [rpcRow({ calls_made: 99, first_name: "Poll" })], error: null });
    });
    await flush();
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));
    expect(hookResult.agents[0].callsMade).toBe(99);
    expect(hookResult.initialLoading).toBe(false);
    expect(hookResult.filterRefreshing).toBe(false);

    // The stale visible fetch resolves afterwards: no data overwrite, and no
    // loading state belonging to the newer fetch is touched.
    act(() => {
      h.pending[0]({ data: [rpcRow({ calls_made: 1, first_name: "Stale" })], error: null });
    });
    await flush();
    expect(hookResult.agents[0].callsMade).toBe(99);
    expect(hookResult.agents[0].first_name).toBe("Poll");
    expect(hookResult.initialLoading).toBe(false);
    expect(hookResult.filterRefreshing).toBe(false);
  });

  it("a silent poll that supersedes a visible FILTER refresh settles filterRefreshing", async () => {
    h.autoResult = rpcOk([rpcRow({ calls_made: 7 })]);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));
    expect(hookResult.initialLoading).toBe(false);

    // Visible period switch — filterRefreshing turns on (gen 2 pending).
    h.mode = "manual";
    act(() => {
      hookResult.setPeriod("This Week");
    });
    await waitFor(() => expect(h.pending).toHaveLength(1));
    expect(hookResult.filterRefreshing).toBe(true);

    // Silent poll supersedes (gen 3) and resolves first.
    act(() => {
      void hookResult.fetchData({ silent: true });
    });
    await waitFor(() => expect(h.pending).toHaveLength(2));
    act(() => {
      h.pending[1]({ data: [rpcRow({ calls_made: 42, first_name: "Week" })], error: null });
    });
    await flush();
    await waitFor(() => expect(hookResult.agents[0]?.callsMade).toBe(42));
    expect(hookResult.filterRefreshing).toBe(false);
    expect(hookResult.initialLoading).toBe(false);

    // The superseded visible refresh lands late: ignored entirely.
    act(() => {
      h.pending[0]({ data: [rpcRow({ calls_made: 5, first_name: "Old" })], error: null });
    });
    await flush();
    expect(hookResult.agents[0].callsMade).toBe(42);
    expect(hookResult.filterRefreshing).toBe(false);
  });

  it("a period switch mid-flight discards the old period's late response", async () => {
    h.mode = "manual";
    render(<Probe />);
    await waitFor(() => expect(h.pending).toHaveLength(1));

    act(() => {
      hookResult.setPeriod("This Week");
    });
    await waitFor(() => expect(h.pending).toHaveLength(2));

    const weekArgs = h.rpcCalls[h.rpcCalls.length - 1].args as { p_start: string };
    expect(weekArgs.p_start).toBe(
      startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString(),
    );

    act(() => {
      h.pending[1]({ data: [rpcRow({ calls_made: 42, first_name: "Week" })], error: null });
    });
    await flush();
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));

    act(() => {
      h.pending[0]({ data: [rpcRow({ calls_made: 5, first_name: "Today" })], error: null });
    });
    await flush();

    expect(hookResult.agents[0].first_name).toBe("Week");
    expect(hookResult.agents[0].callsMade).toBe(42);
  });
});
