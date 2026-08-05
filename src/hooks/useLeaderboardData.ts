import { useState, useEffect, useCallback, useRef } from "react";
import { subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useAgencyGroup } from "@/hooks/useAgencyGroup";
import { buildRankMotionMap, buildRankDeltaMap, computeRankMovements, type RankMotionKind } from "@/components/leaderboard/leaderboardRankMotion";
import { attachPremiumSoldToAgents, annualPremiumForWin, loadClientMonthlyPremiums } from "@/components/leaderboard/leaderboardPremium";
import {
  type AgentStats,
  type Win,
  type Period,
  type Metric,
  type LeaderboardView,
  type RankMovement,
  metricKey,
  getPeriodRange,
  mapPeriodToRpcParam,
  rankAgents,
  hasMeaningfulStandings,
  metricValueMapsEqual,
  snapshotMetricValues,
} from "@/components/leaderboard/leaderboardTypes";

type FetchOptions = { silent?: boolean };

const WIN_FLASH_MS = 3200;
const SPOTLIGHT_DELAY_MS = 500;
/** Spotlight stays visible long enough to spot the agent before ranks animate. */
const SPOTLIGHT_DURATION_MS = 4500;
/** Coalesce rapid sim inserts into one scoreboard pull so rows don't all tick together. */
const BOARD_REFRESH_DEBOUNCE_MS = 550;

const boardDevLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) {
    console.log("[board]", ...args);
  }
};

type OrgLeaderboardStatsRow =
  Database["public"]["Functions"]["get_org_leaderboard_stats"]["Returns"][number];

/**
 * Organization standings come ONLY from the get_org_leaderboard_stats aggregate
 * RPC. Agent RLS hides other agents' raw calls/appointments/clients rows, so a
 * browser-side reconstruction fabricates zero standings for everyone else.
 */
const mapOrgStandingsRow = (r: OrgLeaderboardStatsRow): AgentStats => {
  const callsMade = Number(r.calls_made) || 0;
  const policiesSold = Number(r.policies_sold) || 0;
  return {
    id: r.agent_id,
    first_name: r.first_name,
    last_name: r.last_name,
    avatar_url: r.avatar_url || undefined,
    callsMade,
    policiesSold,
    appointmentsSet: Number(r.appointments_set) || 0,
    talkTime: Number(r.talk_time_seconds) || 0,
    conversionRate: callsMade > 0 ? (policiesSold / callsMade) * 100 : 0,
    // The server already annualized (monthly × 12) exactly once.
    premiumSold: Number(r.annualized_premium) || 0,
    recentWins7d: Number(r.recent_wins_7d) || 0,
    rank: 0,
  };
};

export function useLeaderboardData() {
  const { profile } = useAuth();
  const { agencyGroup } = useAgencyGroup();
  const orgId = profile?.organization_id ?? null;

  const [view, setView] = useState<LeaderboardView>("org");
  const [period, setPeriod] = useState<Period>("Today");
  const [metric, setMetric] = useState<Metric>("Policies Sold");
  const [agents, setAgents] = useState<AgentStats[]>([]);
  const [wins, setWins] = useState<Win[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [filterRefreshing, setFilterRefreshing] = useState(false);
  const [rankAnimations, setRankAnimations] = useState<Map<string, "up" | "down">>(new Map());
  const [rankMovements, setRankMovements] = useState<Map<string, RankMovement>>(new Map());
  const [rankMotions, setRankMotions] = useState<Map<string, RankMotionKind>>(new Map());
  const [rankDeltas, setRankDeltas] = useState<Map<string, number>>(new Map());
  const [flashingWinId, setFlashingWinId] = useState<string | null>(null);
  const [spotlightAgentId, setSpotlightAgentId] = useState<string | null>(null);
  const [newLeaderId, setNewLeaderId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const previousDisplayedRanksRef = useRef<Map<string, number>>(new Map());
  const previousMetricValuesRef = useRef<Map<string, number>>(new Map());
  const latestWinIdRef = useRef<string | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const agentsRef = useRef<AgentStats[]>([]);
  const fetchDataRef = useRef<(options?: FetchOptions) => Promise<void>>(async () => {});
  const fetchWinsRef = useRef<(options?: FetchOptions) => Promise<void>>(async () => {});
  const orgIdRef = useRef<string | null>(orgId);
  const winFlashClearTimerRef = useRef<number | null>(null);
  const spotlightDelayTimerRef = useRef<number | null>(null);
  const spotlightClearTimerRef = useRef<number | null>(null);
  const boardRefreshTimerRef = useRef<number | null>(null);
  /** Monotonic fetch generation: only the newest in-flight fetch may commit state. */
  const fetchGenerationRef = useRef(0);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    orgIdRef.current = orgId;
  }, [orgId]);

  const movementFilterKey = `${view}:${period}:${metric}:${orgId ?? ""}`;

  const clearWinSequenceTimers = useCallback(() => {
    if (winFlashClearTimerRef.current != null) {
      window.clearTimeout(winFlashClearTimerRef.current);
      winFlashClearTimerRef.current = null;
    }
    if (spotlightDelayTimerRef.current != null) {
      window.clearTimeout(spotlightDelayTimerRef.current);
      spotlightDelayTimerRef.current = null;
    }
    if (spotlightClearTimerRef.current != null) {
      window.clearTimeout(spotlightClearTimerRef.current);
      spotlightClearTimerRef.current = null;
    }
  }, []);

  const clearAllSequenceTimers = useCallback(() => {
    clearWinSequenceTimers();
    if (boardRefreshTimerRef.current != null) {
      window.clearTimeout(boardRefreshTimerRef.current);
      boardRefreshTimerRef.current = null;
    }
  }, [clearWinSequenceTimers]);

  useEffect(() => {
    previousDisplayedRanksRef.current = new Map();
    previousMetricValuesRef.current = new Map();
    setRankMovements(new Map());
    clearAllSequenceTimers();
    setFlashingWinId(null);
    setSpotlightAgentId(null);
  }, [movementFilterKey, clearAllSequenceTimers]);

  const commitRankSnapshot = useCallback((sortedAgents: AgentStats[], activeMetric: Metric) => {
    sortedAgents.forEach((a) => previousDisplayedRanksRef.current.set(a.id, a.rank));
    previousMetricValuesRef.current = snapshotMetricValues(sortedAgents, activeMetric);
  }, []);

  const applyRankAnimations = useCallback((sortedAgents: AgentStats[], activeMetric: Metric) => {
    const frozen = !hasMeaningfulStandings(sortedAgents, activeMetric);
    const valuesUnchanged = metricValueMapsEqual(
      sortedAgents,
      previousMetricValuesRef.current,
      activeMetric,
    );

    if (frozen || valuesUnchanged) {
      setRankMovements(new Map());
      commitRankSnapshot(sortedAgents, activeMetric);
      return;
    }

    const movements = computeRankMovements(sortedAgents, previousDisplayedRanksRef.current);
    setRankMovements(movements);

    const motions = buildRankMotionMap(sortedAgents, previousDisplayedRanksRef.current);
    const deltas = buildRankDeltaMap(sortedAgents, previousDisplayedRanksRef.current);
    const anims = new Map<string, "up" | "down">();

    motions.forEach((kind, id) => {
      const prev = previousDisplayedRanksRef.current.get(id);
      const agent = sortedAgents.find((x) => x.id === id);
      if (prev === undefined || !agent) return;
      if (agent.rank < prev) anims.set(id, "up");
      else if (agent.rank > prev) anims.set(id, "down");
    });

    const prevLeaderId = [...previousDisplayedRanksRef.current.entries()].find(([, r]) => r === 1)?.[0];
    const nextLeader = sortedAgents.find((a) => a.rank === 1);
    const leaderScore = nextLeader ? (nextLeader[metricKey(activeMetric)] as number) : 0;
    if (
      prevLeaderId &&
      nextLeader &&
      prevLeaderId !== nextLeader.id &&
      leaderScore > 0
    ) {
      setNewLeaderId(nextLeader.id);
      setTimeout(() => setNewLeaderId(null), 2800);
    }

    if (movements.size > 0) {
      let logged = 0;
      for (const [id, movement] of movements) {
        if (logged >= 3) break;
        const prev = previousDisplayedRanksRef.current.get(id);
        const agent = sortedAgents.find((a) => a.id === id);
        if (prev === undefined || !agent) continue;
        boardDevLog(
          `rank movement: ${agent.first_name} ${agent.last_name?.[0] ?? ""}. #${prev} → #${agent.rank} (${movement.direction} ${movement.spots})`,
        );
        logged += 1;
      }
    }

    commitRankSnapshot(sortedAgents, activeMetric);

    if (motions.size > 0) {
      setRankMotions(motions);
      setRankDeltas(deltas);
      setTimeout(() => {
        setRankMotions(new Map());
        setRankDeltas(new Map());
      }, 1400);
    }
    if (anims.size > 0) {
      setRankAnimations(anims);
      setTimeout(() => setRankAnimations(new Map()), 1500);
    }
  }, [commitRankSnapshot]);

  const beginWinSequence = useCallback(
    (winId: string, agentId?: string | null) => {
      clearWinSequenceTimers();
      latestWinIdRef.current = winId;

      setFlashingWinId(winId);
      winFlashClearTimerRef.current = window.setTimeout(() => {
        setFlashingWinId(null);
        winFlashClearTimerRef.current = null;
      }, WIN_FLASH_MS);

      if (agentId) {
        spotlightDelayTimerRef.current = window.setTimeout(() => {
          setSpotlightAgentId(agentId);
          spotlightDelayTimerRef.current = null;
          spotlightClearTimerRef.current = window.setTimeout(() => {
            setSpotlightAgentId(null);
            spotlightClearTimerRef.current = null;
          }, SPOTLIGHT_DURATION_MS);
        }, SPOTLIGHT_DELAY_MS);
      } else {
        setSpotlightAgentId(null);
      }
    },
    [clearWinSequenceTimers],
  );

  const beginFetch = useCallback((silent?: boolean) => {
    if (silent) return;
    if (!hasLoadedOnceRef.current) {
      setInitialLoading(true);
    } else {
      setFilterRefreshing(true);
    }
  }, []);

  const endFetch = useCallback((silent?: boolean) => {
    if (silent) return;
    if (!hasLoadedOnceRef.current) {
      hasLoadedOnceRef.current = true;
      setInitialLoading(false);
    }
    setFilterRefreshing(false);
  }, []);

  const fetchGroupData = useCallback(
    async (gen: number, groupId: string, options?: FetchOptions) => {
      beginFetch(options?.silent);
      const { data, error } = await supabase.rpc("get_agency_group_leaderboard", {
        p_group_id: groupId,
        p_period: mapPeriodToRpcParam(period),
      });

      if (gen !== fetchGenerationRef.current) return;

      if (error || !data) {
        setView("org");
        endFetch(options?.silent);
        return;
      }

      const rows = (data as Record<string, unknown>[]).map((r) => {
        const callsMade = Number(r.calls_made) || 0;
        const policiesSold = Number(r.policies_sold) || 0;
        return {
          id: r.agent_id as string,
          first_name: r.agent_first_name as string,
          last_name: r.agent_last_name as string,
          avatar_url: (r.agent_avatar_url as string | null) ?? undefined,
          callsMade,
          policiesSold,
          appointmentsSet: Number(r.appointments_set) || 0,
          talkTime: Number(r.talk_time_seconds) || 0,
          conversionRate: callsMade > 0 ? (policiesSold / callsMade) * 100 : 0,
          premiumSold: 0,
          recentWins7d: 0,
          rank: 0,
          organizationId: (r.organization_id as string | null) ?? null,
          organizationName: (r.organization_name as string | null) ?? null,
        } as AgentStats;
      });

      await attachPremiumSoldToAgents(rows, getPeriodRange(period));

      if (gen !== fetchGenerationRef.current) return;

      rankAgents(rows, metric);

      applyRankAnimations(rows, metric);

      const agentIds = rows.map((a) => a.id);
      if (agentIds.length > 0) {
        const sevenStart = subDays(new Date(), 7).toISOString();
        const { data: wins7dRows } = await supabase
          .from("wins")
          .select("agent_id")
          .in("agent_id", agentIds)
          .gte("created_at", sevenStart);
        if (gen !== fetchGenerationRef.current) return;
        const wins7dByAgent = new Map<string, number>();
        for (const row of wins7dRows || []) {
          const aid = row.agent_id;
          if (!aid) continue;
          wins7dByAgent.set(aid, (wins7dByAgent.get(aid) ?? 0) + 1);
        }
        rows.forEach((a) => {
          a.recentWins7d = wins7dByAgent.get(a.id) ?? 0;
        });
      }

      setAgents(rows);
      endFetch(options?.silent);
    },
    [period, metric, beginFetch, endFetch, applyRankAnimations],
  );

  const fetchOrgData = useCallback(
    async (gen: number, options?: FetchOptions) => {
      if (!orgId) {
        endFetch(options?.silent);
        return;
      }

      beginFetch(options?.silent);

      // One half-open [start, end) window shared by every metric; the period
      // bounds stay browser-local (Today / This Week / This Month, unchanged).
      const range = getPeriodRange(period);
      const { data, error } = await supabase.rpc("get_org_leaderboard_stats", {
        p_start: range.start.toISOString(),
        p_end: range.end.toISOString(),
      });

      if (gen !== fetchGenerationRef.current) return;

      if (error || !data) {
        console.error("[leaderboard] get_org_leaderboard_stats failed:", error);
        setLoadError(
          agentsRef.current.length > 0
            ? "Couldn't refresh standings."
            : "Couldn't load the leaderboard.",
        );
        endFetch(options?.silent);
        return;
      }

      const currentStats = data.map(mapOrgStandingsRow);

      rankAgents(currentStats, metric);

      applyRankAnimations(currentStats, metric);

      setLoadError(null);
      setAgents(currentStats);
      endFetch(options?.silent);
    },
    [orgId, period, metric, beginFetch, endFetch, applyRankAnimations],
  );

  const fetchData = useCallback(
    async (options?: FetchOptions) => {
      const gen = ++fetchGenerationRef.current;
      if (view === "group" && agencyGroup) {
        return fetchGroupData(gen, agencyGroup.groupId, options);
      }
      return fetchOrgData(gen, options);
    },
    [view, agencyGroup, fetchGroupData, fetchOrgData],
  );

  const retry = useCallback(() => {
    void fetchData();
  }, [fetchData]);

  const fetchWins = useCallback(
    async (_options?: FetchOptions) => {
      const currentAgents = agentsRef.current;
      let query = supabase.from("wins").select("*").order("created_at", { ascending: false }).limit(20);

      if (view === "org") {
        if (!orgId) return;
        query = query.eq("organization_id", orgId);
      } else if (view === "group") {
        if (currentAgents.length === 0) return;
        query = query.in(
          "agent_id",
          currentAgents.map((a) => a.id),
        );
      }

      const { data } = await query;
      const rawWins = (data || []) as Win[];
      const contactIds = [...new Set(rawWins.map((w) => w.contact_id).filter(Boolean))] as string[];
      const clientMonthlyById = await loadClientMonthlyPremiums(contactIds);
      const newWins = rawWins.map((w) => ({
        ...w,
        premiumSold: annualPremiumForWin(w, clientMonthlyById),
      }));
      const newest = newWins[0];

      if (newest && !latestWinIdRef.current) {
        latestWinIdRef.current = newest.id;
      }

      setWins(newWins);
    },
    [view, orgId],
  );

  fetchDataRef.current = fetchData;
  fetchWinsRef.current = fetchWins;

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    void fetchWins();
  }, [fetchWins, view, orgId]);

  useEffect(() => {
    return () => clearAllSequenceTimers();
  }, [clearAllSequenceTimers]);

  useEffect(() => {
    if (!orgId) return;

    const refreshBoard = () => {
      boardDevLog("applying scoreboard refresh");
      void fetchDataRef.current({ silent: true });
    };

    const scheduleRefreshBoard = () => {
      if (boardRefreshTimerRef.current != null) {
        window.clearTimeout(boardRefreshTimerRef.current);
      }
      const jitter = BOARD_REFRESH_DEBOUNCE_MS + Math.round(Math.random() * 500);
      boardRefreshTimerRef.current = window.setTimeout(() => {
        boardRefreshTimerRef.current = null;
        refreshBoard();
      }, jitter);
    };

    const refreshWins = () => {
      void fetchWinsRef.current({ silent: true });
    };

    const refreshBoardAndWins = () => {
      refreshBoard();
      refreshWins();
    };

    const pollRefresh = () => {
      if (document.visibilityState !== "visible") return;
      refreshBoardAndWins();
    };

    const handleWinInsert = (payload: { new: Record<string, unknown> }) => {
      const row = payload.new as { id?: string; agent_id?: string | null };
      void (async () => {
        await fetchWinsRef.current({ silent: true });
        if (row?.id) {
          beginWinSequence(row.id, row.agent_id ?? null);
        }
        scheduleRefreshBoard();
      })();
    };

    const channel = supabase.channel(`leaderboard-realtime-${orgId}`);
    const orgFilter = `organization_id=eq.${orgId}`;

    channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "calls", filter: orgFilter },
        scheduleRefreshBoard,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "wins", filter: orgFilter },
        handleWinInsert,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "appointments", filter: orgFilter },
        scheduleRefreshBoard,
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" && import.meta.env.DEV) {
          console.warn("[leaderboard] realtime channel error — using poll fallback");
        }
      });

    const pollMs = Number(import.meta.env.VITE_LEADERBOARD_POLL_MS || 4000);
    const pollId = window.setInterval(pollRefresh, pollMs);

    return () => {
      window.clearInterval(pollId);
      supabase.removeChannel(channel);
      clearAllSequenceTimers();
    };
  }, [orgId, beginWinSequence, clearAllSequenceTimers]);

  const standingsFrozen = !hasMeaningfulStandings(agents, metric);

  return {
    view,
    setView,
    period,
    setPeriod,
    metric,
    setMetric,
    agents,
    wins,
    initialLoading,
    filterRefreshing,
    rankAnimations,
    rankMovements,
    rankMotions,
    rankDeltas,
    flashingWinId,
    spotlightAgentId,
    newLeaderId,
    standingsFrozen,
    agencyGroup,
    loadError,
    retry,
    fetchData,
    fetchWins,
  };
}
