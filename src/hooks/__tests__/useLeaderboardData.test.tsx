import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, waitFor, act, cleanup } from "@testing-library/react";
import { startOfDay, startOfMonth, startOfWeek } from "date-fns";

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
    signals: [] as AbortSignal[],
    channelBindings: [] as Array<{ table: string; event: string }>,
    winInsert: null as null | ((payload: { new: Record<string, unknown> }) => void),
    /** When set, each wins read waits for a manual resolve. */
    holdWins: false,
    winsPending: [] as Array<(v: { data: unknown; error: unknown }) => void>,
    subscribeCount: 0,
    removeChannelCount: 0,
    userId: "aaaa0000-0000-0000-0000-000000000001",
    orgId: "0f000000-0000-0000-0000-0000000000aa",
    agencyGroup: null as null | { groupId: string; groupName: string; role: "leader" | "member" },
    fromResult: (() => ({ data: [] as unknown, error: null as unknown })) as (table: string) => {
      data: unknown;
      error: unknown;
    },
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
  const makeQuery = (table: string) => {
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
    q.abortSignal = (signal: AbortSignal) => {
      h.signals.push(signal);
      return q;
    };
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => {
      if (table === "wins" && h.holdWins) {
        return new Promise<{ data: unknown; error: unknown }>((resolve) => h.winsPending.push(resolve)).then(onFulfilled, onRejected);
      }
      return Promise.resolve({ count: 0, ...h.fromResult(table) }).then(onFulfilled, onRejected);
    };
    return q;
  };
  const channelObj: Record<string, unknown> = {};
  channelObj.on = (
    _type: string,
    opts: { table: string; event: string },
    handler: (payload: { new: Record<string, unknown> }) => void,
  ) => {
    h.channelBindings.push({ table: opts.table, event: opts.event });
    if (opts.table === "wins") h.winInsert = handler;
    return channelObj;
  };
  channelObj.subscribe = () => {
    h.subscribeCount += 1;
    return channelObj;
  };
  return {
    supabase: {
      // PostgREST builders are thenables with .abortSignal(); mirror that shape.
      rpc: (fn: string, args: Record<string, unknown>) => {
        h.rpcCalls.push({ fn, args });
        const result =
          h.mode === "manual"
            ? new Promise((resolve) => {
                h.pending.push(resolve as (v: { data: unknown; error: unknown }) => void);
              })
            : Promise.resolve(h.autoResult());
        const builder = {
          abortSignal: (signal: AbortSignal) => {
            h.signals.push(signal);
            return builder;
          },
          then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            result.then(onFulfilled, onRejected),
        };
        return builder;
      },
      from: (table: string) => {
        h.fromTables.push(table);
        return makeQuery(table);
      },
      channel: () => channelObj,
      removeChannel: () => {
        h.removeChannelCount += 1;
      },
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    profile: { organization_id: h.orgId },
    user: { id: h.userId },
  }),
}));

vi.mock("@/hooks/useAgencyGroup", () => ({
  useAgencyGroup: () => ({ agencyGroup: h.agencyGroup }),
}));

import { useLeaderboardData } from "@/hooks/useLeaderboardData";
import { getLeaderboardRequestGate, resetLeaderboardRequestGates } from "@/lib/leaderboardRequestGate";

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
  resetLeaderboardRequestGates();
  h.rpcCalls.length = 0;
  h.fromTables.length = 0;
  h.signals.length = 0;
  h.channelBindings.length = 0;
  h.winInsert = null;
  h.holdWins = false;
  h.winsPending.length = 0;
  h.subscribeCount = 0;
  h.removeChannelCount = 0;
  h.userId = "aaaa0000-0000-0000-0000-000000000001";
  h.orgId = "0f000000-0000-0000-0000-0000000000aa";
  h.agencyGroup = null;
  h.fromResult = () => ({ data: [], error: null });
  h.pending.length = 0;
  h.mode = "auto";
  h.autoResult = rpcOk([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

// Distinct per-metric leaders: Policies → A, Calls → B, Talk Time → C, Premium → A.
const METRIC_ROSTER = [
  rpcRow({
    agent_id: AGENT_A, first_name: "Avery", last_name: "Adams",
    policies_sold: 5, calls_made: 10, talk_time_seconds: 100,
    annualized_premium: 6000, appointments_set: 4, recent_wins_7d: 2,
  }),
  rpcRow({
    agent_id: AGENT_B, first_name: "Blake", last_name: "Brooks",
    policies_sold: 2, calls_made: 50, talk_time_seconds: 200,
    annualized_premium: 1200, appointments_set: 1, recent_wins_7d: 1,
  }),
  rpcRow({
    agent_id: AGENT_C, first_name: "Casey", last_name: "Cole",
    policies_sold: 1, calls_made: 20, talk_time_seconds: 900,
    annualized_premium: 300, appointments_set: 0, recent_wins_7d: 0,
  }),
];

describe("metric switching — synchronous re-rank of cached standings", () => {
  it("re-ranks immediately on switch with ZERO new RPC calls and no loading state", async () => {
    h.autoResult = rpcOk(METRIC_ROSTER);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(3));
    // Default metric is Policies Sold → Agent A leads.
    expect(hookResult.agents[0].id).toBe(AGENT_A);

    const rpcCountBefore = h.rpcCalls.filter((c) => c.fn === "get_org_leaderboard_stats").length;

    act(() => {
      hookResult.setMetric("Calls Made");
    });

    // Synchronous, same-commit outcome: no awaits, no flushes.
    expect(hookResult.metric).toBe("Calls Made");
    expect(hookResult.agents[0].id).toBe(AGENT_B);
    expect(hookResult.agents[0].rank).toBe(1);
    expect(
      h.rpcCalls.filter((c) => c.fn === "get_org_leaderboard_stats").length,
    ).toBe(rpcCountBefore);
    expect(hookResult.filterRefreshing).toBe(false);
    expect(hookResult.initialLoading).toBe(false);
  });

  it("keeps every agent's identity and metric values attached through the switch", async () => {
    h.autoResult = rpcOk(METRIC_ROSTER);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(3));

    act(() => {
      hookResult.setMetric("Calls Made");
    });

    const blake = hookResult.agents.find((a) => a.id === AGENT_B)!;
    expect(blake.first_name).toBe("Blake");
    expect(blake.last_name).toBe("Brooks");
    expect(blake.callsMade).toBe(50);
    expect(blake.policiesSold).toBe(2);
    expect(blake.rank).toBe(1);

    const avery = hookResult.agents.find((a) => a.id === AGENT_A)!;
    expect(avery.first_name).toBe("Avery");
    expect(avery.callsMade).toBe(10);
    expect(avery.policiesSold).toBe(5);
    expect(avery.premiumSold).toBe(6000);
  });

  it("settles rapid metric switches on the final metric's ordering with zero RPC calls", async () => {
    h.autoResult = rpcOk(METRIC_ROSTER);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(3));
    const rpcCountBefore = h.rpcCalls.filter((c) => c.fn === "get_org_leaderboard_stats").length;

    act(() => {
      hookResult.setMetric("Calls Made");
      hookResult.setMetric("Talk Time");
      hookResult.setMetric("Premium Sold");
      hookResult.setMetric("Calls Made");
    });

    expect(hookResult.metric).toBe("Calls Made");
    expect(hookResult.agents.map((a) => a.id)).toEqual([AGENT_B, AGENT_C, AGENT_A]);
    expect(
      h.rpcCalls.filter((c) => c.fn === "get_org_leaderboard_stats").length,
    ).toBe(rpcCountBefore);
    expect(hookResult.filterRefreshing).toBe(false);
  });

  it("ranks a poll that resolves AFTER a metric switch by the latest metric, and issues no fetch for the switch itself", async () => {
    h.autoResult = rpcOk(METRIC_ROSTER);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(3));

    h.mode = "manual";
    act(() => {
      void hookResult.fetchData({ silent: true });
    });
    await waitFor(() => expect(h.pending).toHaveLength(1));

    act(() => {
      hookResult.setMetric("Calls Made");
    });
    // The switch itself must not have queued another fetch.
    expect(h.pending).toHaveLength(1);

    // The pre-switch poll resolves with refreshed numbers (Blake now 60 calls).
    const refreshed = METRIC_ROSTER.map((r) =>
      r.agent_id === AGENT_B ? { ...r, calls_made: 60 } : { ...r },
    );
    act(() => {
      h.pending[0]({ data: refreshed, error: null });
    });
    await flush();

    expect(hookResult.agents[0].id).toBe(AGENT_B);
    expect(hookResult.agents[0].callsMade).toBe(60);
    expect(hookResult.agents.map((a) => a.id)).toEqual([AGENT_B, AGENT_C, AGENT_A]);
  });

  it("a superseded stale response can never restore the previous metric's ordering", async () => {
    h.autoResult = rpcOk(METRIC_ROSTER);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(3));

    // Two refreshes of the same standings JOIN one request (never two RPCs);
    // only the newest caller may commit, ranked by the metric chosen meanwhile.
    h.mode = "manual";
    const before = h.rpcCalls.length;
    act(() => {
      void hookResult.fetchData({ silent: true }); // gen N (will become stale)
    });
    act(() => {
      void hookResult.fetchData({ silent: true }); // gen N+1 (newest) — joins gen N's request
    });
    await waitFor(() => expect(h.pending).toHaveLength(1));
    expect(h.rpcCalls.length - before).toBe(1);

    act(() => {
      hookResult.setMetric("Calls Made");
    });

    act(() => {
      h.pending[0]({ data: METRIC_ROSTER.map((r) => ({ ...r })), error: null });
    });
    await flush();
    await waitFor(() => expect(hookResult.agents.map((a) => a.id)).toEqual([AGENT_B, AGENT_C, AGENT_A]));
    // The Policies ordering never returns.
    await flush();
    expect(hookResult.agents.map((a) => a.id)).toEqual([AGENT_B, AGENT_C, AGENT_A]);
  });

  it("a period change still fetches with the visible refresh lifecycle", async () => {
    h.autoResult = rpcOk(METRIC_ROSTER);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(3));

    h.mode = "manual";
    act(() => {
      hookResult.setPeriod("This Week");
    });
    await waitFor(() => expect(h.pending).toHaveLength(1));
    expect(hookResult.filterRefreshing).toBe(true);

    act(() => {
      h.pending[0]({ data: METRIC_ROSTER.map((r) => ({ ...r })), error: null });
    });
    await flush();
    expect(hookResult.filterRefreshing).toBe(false);
    expect(hookResult.agents).toHaveLength(3);
  });

  it("clears live rank/leader animation state synchronously on a metric switch", async () => {
    h.autoResult = rpcOk(METRIC_ROSTER);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(3));

    // A refresh with a new Policies leader populates the live animation maps.
    h.autoResult = rpcOk(
      METRIC_ROSTER.map((r) =>
        r.agent_id === AGENT_B ? { ...r, policies_sold: 9 } : { ...r },
      ),
    );
    await act(async () => {
      await hookResult.fetchData();
    });
    await waitFor(() => expect(hookResult.agents[0].id).toBe(AGENT_B));
    expect(hookResult.rankMotions.size).toBeGreaterThan(0);

    act(() => {
      hookResult.setMetric("Talk Time");
    });

    expect(hookResult.rankAnimations.size).toBe(0);
    expect(hookResult.rankMovements.size).toBe(0);
    expect(hookResult.rankMotions.size).toBe(0);
    expect(hookResult.rankDeltas.size).toBe(0);
    expect(hookResult.newLeaderId).toBeNull();
    expect(hookResult.spotlightAgentId).toBeNull();
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

  it("retry() is bounded: refused (no request) for 30 s after the last request, then clears the error and reloads", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    h.autoResult = rpcFail();
    render(<Probe />);
    await waitFor(() => expect(hookResult.loadError).toBeTruthy());
    const afterFailure = h.rpcCalls.length;
    expect(hookResult.standingsStatus.manualAvailableAt).toBeGreaterThan(Date.now());

    h.autoResult = rpcOk([rpcRow()]);
    await act(async () => {
      hookResult.retry();
    });
    await flush();
    expect(h.rpcCalls.length).toBe(afterFailure);
    expect(hookResult.loadError).toBeTruthy();

    vi.setSystemTime(new Date(Date.now() + 31_000));
    await act(async () => {
      hookResult.retry();
    });

    await waitFor(() => expect(hookResult.agents).toHaveLength(1));
    expect(hookResult.loadError).toBeNull();
    expect(h.rpcCalls.length).toBe(afterFailure + 1);
  });
});

describe("stale-response protection", () => {
  it("serializes: a newer queued request replaces an older queued one without a network call, and only the newest commits", async () => {
    h.mode = "manual";
    render(<Probe />);
    await waitFor(() => expect(h.pending).toHaveLength(1)); // Today, in flight

    act(() => {
      hookResult.setPeriod("This Week"); // queued behind Today
    });
    act(() => {
      hookResult.setPeriod("This Month"); // replaces the queued week request
    });
    await flush();
    expect(h.rpcCalls).toHaveLength(1);

    // The obsolete Today response lands: discarded, and only then does the newest start.
    act(() => {
      h.pending[0]({ data: [rpcRow({ calls_made: 1, first_name: "Old" })], error: null });
    });
    await waitFor(() => expect(h.pending).toHaveLength(2));
    expect(hookResult.agents).toHaveLength(0);
    // The week request never reached the network.
    expect(h.rpcCalls).toHaveLength(2);
    expect((h.rpcCalls[1].args as { p_start: string }).p_start).toBe(
      startOfMonth(new Date()).toISOString(),
    );

    act(() => {
      h.pending[1]({ data: [rpcRow({ calls_made: 99, first_name: "New" })], error: null });
    });
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));
    expect(hookResult.agents[0].first_name).toBe("New");
    expect(hookResult.agents[0].callsMade).toBe(99);
  });

  it("a silent poll that joins the visible INITIAL fetch settles initialLoading with one request; nothing can resurrect it", async () => {
    h.mode = "manual";
    render(<Probe />);
    await waitFor(() => expect(h.pending).toHaveLength(1));
    expect(hookResult.initialLoading).toBe(true);

    // A silent poll for the same standings joins the in-flight request.
    act(() => {
      void hookResult.fetchData({ silent: true });
    });
    await flush();
    expect(h.rpcCalls).toHaveLength(1);

    act(() => {
      h.pending[0]({ data: [rpcRow({ calls_made: 99, first_name: "Poll" })], error: null });
    });
    await flush();
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));
    expect(hookResult.agents[0].first_name).toBe("Poll");
    expect(hookResult.initialLoading).toBe(false);
    expect(hookResult.filterRefreshing).toBe(false);

    await flush();
    expect(hookResult.initialLoading).toBe(false);
    expect(hookResult.filterRefreshing).toBe(false);
  });

  it("a silent poll that joins a visible FILTER refresh settles filterRefreshing", async () => {
    h.autoResult = rpcOk([rpcRow({ calls_made: 7 })]);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));
    expect(hookResult.initialLoading).toBe(false);

    h.mode = "manual";
    act(() => {
      hookResult.setPeriod("This Week");
    });
    await waitFor(() => expect(h.pending).toHaveLength(1));
    expect(hookResult.filterRefreshing).toBe(true);

    act(() => {
      void hookResult.fetchData({ silent: true });
    });
    await flush();
    expect(h.pending).toHaveLength(1);

    act(() => {
      h.pending[0]({ data: [rpcRow({ calls_made: 42, first_name: "Week" })], error: null });
    });
    await flush();
    await waitFor(() => expect(hookResult.agents[0]?.callsMade).toBe(42));
    expect(hookResult.filterRefreshing).toBe(false);
    expect(hookResult.initialLoading).toBe(false);
  });

  it("a period switch mid-flight waits for the in-flight request, and the old period's late response never commits", async () => {
    h.mode = "manual";
    render(<Probe />);
    await waitFor(() => expect(h.pending).toHaveLength(1));

    act(() => {
      hookResult.setPeriod("This Week");
    });
    await flush();
    // Serialized: the week request waits for today's to settle.
    expect(h.pending).toHaveLength(1);

    act(() => {
      h.pending[0]({ data: [rpcRow({ calls_made: 5, first_name: "Today" })], error: null });
    });
    await waitFor(() => expect(h.pending).toHaveLength(2));
    expect(hookResult.agents).toHaveLength(0);

    const weekArgs = h.rpcCalls[h.rpcCalls.length - 1].args as { p_start: string };
    expect(weekArgs.p_start).toBe(
      startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString(),
    );

    act(() => {
      h.pending[1]({ data: [rpcRow({ calls_made: 42, first_name: "Week" })], error: null });
    });
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));
    expect(hookResult.agents[0].first_name).toBe("Week");
    expect(hookResult.agents[0].callsMade).toBe(42);
  });
});

// ── Request discipline and truthful states (2026-09-25 leaderboard recovery) ──

/** The production pause: `RAISE SQLSTATE 'PT503'` surfaces through PostgREST as this error. */
const rpcMaintenance = () => () => ({
  data: null,
  error: {
    code: "PT503",
    message: "Standings temporarily paused",
    hint: "Leaderboard maintenance is in progress. Avoid repeated retries.",
    details: null,
  },
});

const setVisibility = (state: "visible" | "hidden", dispatch = true) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  if (dispatch) document.dispatchEvent(new Event("visibilitychange"));
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

afterEach(() => {
  Reflect.deleteProperty(document, "visibilityState");
});

describe("maintenance hold (PT503)", () => {
  it("shows maintenance — never zeros — and sends nothing else during the 5-minute hold, not even Recent Wins", async () => {
    h.autoResult = rpcMaintenance();
    render(<Probe />);
    await waitFor(() => expect(hookResult.standingsStatus.kind).toBe("maintenance"));
    expect(hookResult.loadError).toBe("Standings are paused for maintenance.");
    expect(hookResult.agents).toHaveLength(0);
    expect(hookResult.initialLoading).toBe(false);
    expect(hookResult.standingsStatus.nextCheckAt).toBeGreaterThanOrEqual(Date.now() + 260_000);

    const calls = h.rpcCalls.length;
    await act(async () => {
      await hookResult.fetchData({ silent: true, mode: "auto" });
    });
    await act(async () => {
      hookResult.retry();
    });
    await flush();
    expect(h.rpcCalls.length).toBe(calls);
    expect(h.fromTables.filter((t) => t === "wins")).toHaveLength(0);
  });

  it("a remount during the hold shows maintenance with zero requests — never the skeleton or the empty roster", async () => {
    h.autoResult = rpcMaintenance();
    const first = render(<Probe />);
    await waitFor(() => expect(hookResult.standingsStatus.kind).toBe("maintenance"));
    first.unmount();
    const calls = h.rpcCalls.length;

    render(<Probe />);
    await waitFor(() => expect(hookResult.standingsStatus.kind).toBe("maintenance"));
    expect(h.rpcCalls.length).toBe(calls);
    expect(hookResult.initialLoading).toBe(false);
    expect(hookResult.loadError).toBeTruthy();
    expect(hookResult.agents).toHaveLength(0);
  });

  it("keeps the same-period snapshot behind the maintenance status, but never shows it under a newly selected period", async () => {
    h.autoResult = rpcOk([rpcRow({ first_name: "Today" })]);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));

    h.autoResult = rpcMaintenance();
    await act(async () => {
      await hookResult.fetchData({ silent: true });
    });
    await waitFor(() => expect(hookResult.standingsStatus.kind).toBe("maintenance"));
    expect(hookResult.agents[0].first_name).toBe("Today");
    expect(hookResult.standingsStatus.lastUpdatedAt).not.toBeNull();

    const calls = h.rpcCalls.length;
    act(() => {
      hookResult.setPeriod("This Week");
    });
    await waitFor(() => expect(hookResult.agents).toHaveLength(0));
    expect(hookResult.standingsStatus.kind).toBe("maintenance");
    expect(hookResult.standingsStatus.lastUpdatedAt).toBeNull();
    expect(h.rpcCalls.length).toBe(calls);
  });
});

describe("request discipline", () => {
  it("group info arriving after mount does not re-send the org request", async () => {
    h.autoResult = rpcOk([rpcRow()]);
    const { rerender } = render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));

    h.agencyGroup = { groupId: "bbbb0000-0000-0000-0000-00000000000g", groupName: "Summit", role: "member" };
    rerender(<Probe />);
    await flush();
    expect(hookResult.agencyGroup?.groupName).toBe("Summit");
    expect(h.rpcCalls.filter((c) => c.fn === "get_org_leaderboard_stats")).toHaveLength(1);
  });

  it("binds realtime to wins INSERTs only, once; tab switches, failures and metric switches never re-subscribe", async () => {
    h.autoResult = rpcOk(METRIC_ROSTER);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(3));
    expect(h.channelBindings).toEqual([{ table: "wins", event: "INSERT" }]);
    expect(h.subscribeCount).toBe(1);

    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    h.autoResult = rpcFail();
    await act(async () => {
      await hookResult.fetchData({ silent: true });
    });
    act(() => {
      hookResult.setMetric("Calls Made");
    });
    await flush();
    expect(h.subscribeCount).toBe(1);
    expect(h.removeChannelCount).toBe(0);
  });

  it("a tab that mounts hidden defers its first load until it is shown", async () => {
    setVisibility("hidden", false);
    h.autoResult = rpcOk([rpcRow()]);
    render(<Probe />);
    await flush();
    expect(h.rpcCalls).toHaveLength(0);
    expect(hookResult.initialLoading).toBe(true);

    act(() => setVisibility("visible"));
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));
    expect(h.rpcCalls).toHaveLength(1);
  });

  it("polls every 30 s only while visible — never on the legacy 4 s cadence — and not at all while hidden", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    h.autoResult = rpcOk([rpcRow()]);
    render(<Probe />);
    await advance(10);
    expect(hookResult.agents).toHaveLength(1);
    const standings = () => h.rpcCalls.filter((c) => c.fn === "get_org_leaderboard_stats").length;
    expect(standings()).toBe(1);

    await advance(4_000);
    expect(standings()).toBe(1);
    await advance(26_000); // 30 s after the first load
    expect(standings()).toBe(2);

    act(() => setVisibility("hidden"));
    await advance(120_000);
    expect(standings()).toBe(2);

    act(() => setVisibility("visible")); // data is now stale → one catch-up refresh
    await advance(10);
    expect(standings()).toBe(3);
  });

  it("a different viewer never sees the previous viewer's rows, and the old viewer's late response is discarded", async () => {
    h.mode = "manual";
    const { rerender } = render(<Probe />);
    await waitFor(() => expect(h.pending).toHaveLength(1));
    act(() => {
      h.pending[0]({ data: [rpcRow({ first_name: "First" })], error: null });
    });
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));

    act(() => {
      void hookResult.fetchData({ silent: true }); // old viewer's request, still in flight
    });
    await waitFor(() => expect(h.pending).toHaveLength(2));

    h.userId = "aaaa0000-0000-0000-0000-000000000009";
    rerender(<Probe />);
    expect(hookResult.agents).toHaveLength(0);
    expect(hookResult.initialLoading).toBe(true);
    await waitFor(() => expect(h.pending).toHaveLength(3)); // the new viewer's own request

    act(() => {
      h.pending[1]({ data: [rpcRow({ first_name: "Stale" })], error: null });
    });
    await flush();
    expect(hookResult.agents).toHaveLength(0);

    act(() => {
      h.pending[2]({ data: [rpcRow({ first_name: "Second" })], error: null });
    });
    await waitFor(() => expect(hookResult.agents[0]?.first_name).toBe("Second"));
  });

  it("unmounting mid-flight commits nothing and sends nothing further (no Recent Wins read)", async () => {
    h.mode = "manual";
    const { unmount } = render(<Probe />);
    await waitFor(() => expect(h.pending).toHaveLength(1));
    unmount();
    act(() => {
      h.pending[0]({ data: [rpcRow()], error: null });
    });
    await flush();
    expect(h.fromTables.filter((t) => t === "wins")).toHaveLength(0);
  });
});

describe("Recent Wins truthfulness", () => {
  const WIN = { id: "win-1", agent_id: AGENT_A, agent_name: "Avery A.", contact_name: "C", campaign_name: "", policy_type: "Term", created_at: new Date().toISOString() };

  it("a failed Recent Wins read is an error state, never an empty feed", async () => {
    h.autoResult = rpcOk([rpcRow()]);
    h.fromResult = (t) => (t === "wins" ? { data: null, error: { code: "500", message: "boom" } } : { data: [], error: null });
    render(<Probe />);
    await waitFor(() => expect(hookResult.winsStatus.kind).toBe("error"));
    expect(hookResult.wins).toHaveLength(0);
    expect(hookResult.winsStatus.lastUpdatedAt).toBeNull();
  });

  it("keeps the list on screen when a later refresh fails", async () => {
    h.autoResult = rpcOk([rpcRow()]);
    h.fromResult = (t) => (t === "wins" ? { data: [WIN], error: null } : { data: [], error: null });
    render(<Probe />);
    await waitFor(() => expect(hookResult.wins).toHaveLength(1));
    expect(hookResult.winsStatus.kind).toBe("ok");

    h.fromResult = (t) => (t === "wins" ? { data: null, error: { code: "500", message: "boom" } } : { data: [], error: null });
    await act(async () => {
      await hookResult.fetchWins({ mode: "initial" });
    });
    await waitFor(() => expect(hookResult.winsStatus.kind).toBe("error"));
    expect(hookResult.wins).toHaveLength(1);
    expect(hookResult.winsStatus.lastUpdatedAt).not.toBeNull();
  });

  it("loads Recent Wins after the standings, never in parallel with them", async () => {
    h.mode = "manual";
    render(<Probe />);
    await waitFor(() => expect(h.pending).toHaveLength(1));
    expect(h.fromTables.filter((t) => t === "wins")).toHaveLength(0);
    act(() => {
      h.pending[0]({ data: [rpcRow()], error: null });
    });
    await waitFor(() => expect(h.fromTables.filter((t) => t === "wins")).toHaveLength(1));
  });
});

describe("review follow-ups", () => {
  it("a tab opened in the background during a hold settles into the hold's state when shown — no skeleton, no request", async () => {
    h.autoResult = rpcMaintenance();
    const first = render(<Probe />);
    await waitFor(() => expect(hookResult.standingsStatus.kind).toBe("maintenance"));
    first.unmount();
    const calls = h.rpcCalls.length;

    setVisibility("hidden", false);
    render(<Probe />);
    await flush();
    expect(hookResult.initialLoading).toBe(true);
    act(() => setVisibility("visible"));
    await waitFor(() => expect(hookResult.standingsStatus.kind).toBe("maintenance"));
    expect(hookResult.initialLoading).toBe(false);
    expect(h.rpcCalls.length).toBe(calls);
  });

  it("a Retry pressed during a period switch never leaves the old period's rows under the new label", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    h.autoResult = rpcOk([rpcRow({ first_name: "Today" })]);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));

    vi.setSystemTime(new Date(Date.now() + 41_000));
    h.mode = "manual";
    act(() => {
      hookResult.retry(); // manual Today refresh, in flight
    });
    await waitFor(() => expect(h.pending).toHaveLength(1));
    act(() => {
      hookResult.setPeriod("This Week"); // queued
    });
    act(() => {
      hookResult.retry(); // joins the queued week load
    });
    act(() => {
      h.pending[0]({ data: [rpcRow({ first_name: "Today" })], error: null });
    });
    await waitFor(() => expect(h.pending).toHaveLength(2)); // the week load still runs
    act(() => {
      h.pending[1]({ data: [rpcRow({ first_name: "Week" })], error: null });
    });
    await waitFor(() => expect(hookResult.agents[0]?.first_name).toBe("Week"));
    expect(hookResult.period).toBe("This Week");
  });

  it("a burst of realtime wins becomes ONE spaced Recent Wins read, and the win on screen is celebrated", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    const WIN = { id: "win-9", agent_id: AGENT_A, agent_name: "Avery A.", contact_name: "C", campaign_name: "", policy_type: "Term", created_at: new Date().toISOString() };
    h.autoResult = rpcOk([rpcRow()]);
    render(<Probe />);
    await advance(10);
    const winsReads = () => h.fromTables.filter((t) => t === "wins").length;
    expect(winsReads()).toBe(1);

    h.fromResult = (t) => (t === "wins" ? { data: [WIN], error: null } : { data: [], error: null });
    for (let i = 0; i < 5; i += 1) {
      act(() => h.winInsert?.({ new: { id: "win-9", agent_id: AGENT_A } }));
      await advance(1_000);
    }
    expect(winsReads()).toBe(1);
    await advance(10_000); // 15 s after the last wins read
    expect(winsReads()).toBe(2);
    expect(hookResult.wins[0]?.id).toBe("win-9");
    expect(hookResult.flashingWinId).toBe("win-9");
  });

  it("with standings on screen, Recent Wins keep refreshing (spaced) during a standings hold", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    h.autoResult = rpcOk([rpcRow()]);
    render(<Probe />);
    await advance(10);
    h.autoResult = rpcMaintenance();
    await advance(30_000); // poll → PT503 → hold
    expect(hookResult.standingsStatus.kind).toBe("maintenance");
    expect(hookResult.agents).toHaveLength(1);
    const winsBefore = h.fromTables.filter((t) => t === "wins").length;
    const standingsBefore = h.rpcCalls.length;
    await advance(60_000); // two more poll ticks inside the hold
    expect(h.rpcCalls.length).toBe(standingsBefore);
    const winsAfter = h.fromTables.filter((t) => t === "wins").length;
    expect(winsAfter).toBeGreaterThan(winsBefore);
    expect(winsAfter - winsBefore).toBeLessThanOrEqual(2);
  });
});

describe("review follow-ups (2)", () => {
  it("the promised next check is when the next request is really sent, even after a timed-out request", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    h.mode = "manual"; // the load never settles
    render(<Probe />);
    await advance(10);
    await advance(25_000); // gate timeout
    expect(hookResult.standingsStatus.kind).toBe("error");
    const promised = hookResult.standingsStatus.nextCheckAt!;
    const calls = h.rpcCalls.length;
    await advance(promised - Date.now() - 1_000);
    expect(h.rpcCalls.length).toBe(calls);
    await advance(2_000);
    expect(h.rpcCalls.length).toBe(calls + 1);
  });

  it("an empty roster still loads its (org) Recent Wins instead of loading forever", async () => {
    h.autoResult = rpcOk([]);
    render(<Probe />);
    await waitFor(() => expect(hookResult.winsStatus.kind).toBe("ok"));
    expect(h.fromTables.filter((t) => t === "wins")).toHaveLength(1);
  });
});

describe("review follow-ups (3)", () => {
  it("celebrates a realtime win even when its Recent Wins read is joined by the post-standings read", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    const WIN = { id: "win-7", agent_id: AGENT_A, agent_name: "Avery A.", contact_name: "C", campaign_name: "", policy_type: "Term", created_at: new Date().toISOString() };
    h.autoResult = rpcOk([rpcRow()]);
    render(<Probe />);
    await advance(10);

    h.mode = "manual"; // the next standings poll stays in flight
    await advance(30_000);
    expect(h.pending).toHaveLength(1);

    h.fromResult = (t) => (t === "wins" ? { data: [WIN], error: null } : { data: [], error: null });
    act(() => h.winInsert?.({ new: { id: "win-7", agent_id: AGENT_A } }));
    await advance(10);
    act(() => {
      h.pending[0]({ data: [rpcRow()], error: null });
    });
    await advance(10);
    expect(hookResult.wins[0]?.id).toBe("win-7");
    expect(hookResult.flashingWinId).toBe("win-7");
  });
});

describe("review round 2", () => {
  const WIN = { id: "win-5", agent_id: AGENT_A, agent_name: "Avery A.", contact_name: "C", campaign_name: "", policy_type: "Term", created_at: new Date().toISOString() };

  it("Today → Week → Today while Today is in flight never sends the abandoned Week request", async () => {
    h.mode = "manual";
    render(<Probe />);
    await waitFor(() => expect(h.pending).toHaveLength(1));
    act(() => hookResult.setPeriod("This Week"));
    act(() => hookResult.setPeriod("Today"));
    act(() => {
      h.pending[0]({ data: [rpcRow({ first_name: "Today" })], error: null });
    });
    await waitFor(() => expect(hookResult.agents[0]?.first_name).toBe("Today"));
    await flush();
    expect(h.rpcCalls).toHaveLength(1);
  });

  it("a hold started by a request whose result was discarded still shows — never 'Live' during a hold", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    h.autoResult = rpcOk([rpcRow()]);
    render(<Probe />);
    await advance(10);
    expect(hookResult.standingsStatus.kind).toBe("ok");
    // Another request of this viewer (e.g. one the page had moved on from) meets the pause.
    const gate = getLeaderboardRequestGate(`${h.userId}:${h.orgId}`);
    await act(async () => {
      await gate.run({ endpoint: "org_standings", channel: "standings", key: "elsewhere", mode: "initial", owner: {}, load: () => Promise.resolve({ data: null, error: { code: "PT503" } }) });
    });
    await advance(30_000); // next poll tick meets the hold
    expect(hookResult.standingsStatus.kind).toBe("maintenance");
    expect(hookResult.agents).toHaveLength(1);
  });

  it("a realtime win queued behind a slow Recent Wins read is retried, not dropped", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    h.autoResult = rpcOk([rpcRow()]);
    h.holdWins = true;
    render(<Probe />);
    await advance(10);
    expect(h.winsPending).toHaveLength(1); // the post-standings wins read is still in flight
    await advance(16_000);
    act(() => h.winInsert?.({ new: { id: "win-5", agent_id: AGENT_A } }));
    await advance(10);
    h.holdWins = false;
    h.fromResult = (t) => (t === "wins" ? { data: [WIN], error: null } : { data: [], error: null });
    act(() => h.winsPending[0]({ data: [], error: null })); // the slow read settles (without the win)
    await advance(10);
    expect(hookResult.wins).toHaveLength(0);
    // After a 16 s response the gate spaces the next read 2 × 16 s after it; the
    // deferred read then runs by itself.
    await advance(33_000);
    expect(hookResult.wins[0]?.id).toBe("win-5");
    expect(hookResult.flashingWinId).toBe("win-5");
  });

  it("a Recent Wins timer never sends a read after the tab is hidden", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    h.autoResult = rpcOk([rpcRow()]);
    render(<Probe />);
    await advance(10);
    const reads = () => h.fromTables.filter((t) => t === "wins").length;
    const before = reads();
    act(() => h.winInsert?.({ new: { id: "win-5", agent_id: AGENT_A } })); // < 15 s after the last read → timer
    act(() => setVisibility("hidden"));
    await advance(60_000);
    expect(reads()).toBe(before);
  });

  it("no Recent Wins read without standings of the current selection on screen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    h.autoResult = rpcOk([rpcRow()]);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));
    h.autoResult = rpcMaintenance();
    act(() => hookResult.setPeriod("This Week"));
    await waitFor(() => expect(hookResult.agents).toHaveLength(0));
    const reads = h.fromTables.filter((t) => t === "wins").length;
    // Past the gate's spacing, so only the on-screen rule can refuse the read.
    vi.setSystemTime(new Date(Date.now() + 60_000));
    await act(async () => {
      await hookResult.fetchWins({ mode: "auto" });
    });
    expect(h.fromTables.filter((t) => t === "wins").length).toBe(reads);
  });

  it("after midnight, a failed refresh never keeps yesterday's 'Today' rows", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 25, 23, 59, 30));
    h.autoResult = rpcOk([rpcRow({ first_name: "Yesterday" })]);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));

    vi.setSystemTime(new Date(2026, 8, 26, 0, 0, 30));
    h.autoResult = rpcMaintenance();
    await act(async () => {
      await hookResult.fetchData({ silent: true });
    });
    await waitFor(() => expect(hookResult.standingsStatus.kind).toBe("maintenance"));
    expect(hookResult.agents).toHaveLength(0);
  });
});

describe("review round 2 (deferred load)", () => {
  it("an early manual Retry on a failed new selection never leaves the spinner on, and keeps the times truthful", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    h.autoResult = rpcOk([rpcRow({ first_name: "Today" })]);
    render(<Probe />);
    await waitFor(() => expect(hookResult.agents).toHaveLength(1));

    h.autoResult = rpcFail();
    act(() => hookResult.setPeriod("This Week"));
    await waitFor(() => expect(hookResult.standingsStatus.kind).toBe("error"));
    expect(hookResult.agents).toHaveLength(0);
    const calls = h.rpcCalls.length;

    await act(async () => {
      await hookResult.fetchData({ mode: "manual" }); // too early: deferred by the gate
    });
    await flush();
    expect(h.rpcCalls.length).toBe(calls);
    expect(hookResult.filterRefreshing).toBe(false);
    expect(hookResult.standingsStatus.manualAvailableAt).toBeGreaterThan(Date.now());
    expect(hookResult.standingsStatus.nextCheckAt).toBeGreaterThan(Date.now());
  });
});
