import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
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
import {
  type LeaderboardEndpoint,
  type LeaderboardLoadResult,
  type LeaderboardRequestGate,
  type LeaderboardRunMode,
  type LeaderboardRunResult,
  canAutoRefreshLeaderboard,
  getLeaderboardRequestGate,
  resolveLeaderboardPollMs,
} from "@/lib/leaderboardRequestGate";
import { assertPageActive } from "@/lib/pageActivity";
import {
  type StandingsStatus,
  type WinsStatus,
  STANDINGS_STATUS_OK,
  WINS_STATUS_LOADING,
  standingsHeadline,
  standingsStatusKind,
} from "@/lib/leaderboardStatusCopy";

type FetchOptions = { silent?: boolean; mode?: LeaderboardRunMode };
type WinsFetchOptions = {
  mode?: LeaderboardRunMode;
  roster?: AgentStats[];
  notBefore?: number;
  /** Told when the gate deferred this read (nothing was sent). */
  onThrottled?: (availableAt: number) => void;
};
type StandingsIssue = Exclude<LeaderboardRunResult<unknown>, { status: "ok" } | { status: "superseded" }>;

const WIN_FLASH_MS = 3200;
const SPOTLIGHT_DELAY_MS = 500;
/** Spotlight stays visible long enough to spot the agent before ranks animate. */
const SPOTLIGHT_DURATION_MS = 4500;
/** 30 s by default; the legacy 4 s setting is rejected (2026-09-23 incident). */
const POLL_MS = resolveLeaderboardPollMs(import.meta.env.VITE_LEADERBOARD_POLL_MS);
/** Request-gate keys are per consumer, so the page and the Dashboard widget never share a result. */
const CONSUMER = "page";

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

const mapGroupStandingsRow = (r: Record<string, unknown>): AgentStats => {
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
  };
};

async function loadOrgStandings(
  range: { start: Date; end: Date },
  signal: AbortSignal,
): Promise<LeaderboardLoadResult<AgentStats[]>> {
  // One half-open [start, end) window shared by every metric; the period
  // bounds stay browser-local (Today / This Week / This Month, unchanged).
  const { data, error } = await supabase
    .rpc("get_org_leaderboard_stats", {
      p_start: range.start.toISOString(),
      p_end: range.end.toISOString(),
    })
    .abortSignal(signal);
  if (error || !data) {
    console.error("[leaderboard] get_org_leaderboard_stats failed:", error);
    return { data: null, error };
  }
  return { data: data.map(mapOrgStandingsRow), error: null };
}

/** One gated unit: a failing premium or 7-day sub-read fails the load — never "$0" / "0". */
async function loadGroupStandings(
  groupId: string,
  period: Period,
  signal: AbortSignal,
): Promise<LeaderboardLoadResult<AgentStats[]>> {
  const { data, error } = await supabase
    .rpc("get_agency_group_leaderboard", {
      p_group_id: groupId,
      p_period: mapPeriodToRpcParam(period),
    })
    .abortSignal(signal);
  if (error || !data) return { data: null, error };

  const rows = (data as Record<string, unknown>[]).map(mapGroupStandingsRow);
  await attachPremiumSoldToAgents(rows, getPeriodRange(period), undefined, signal);

  const agentIds = rows.map((a) => a.id);
  if (agentIds.length > 0) {
    // A follow-on read: never sent from a tab that went hidden or offline meanwhile.
    assertPageActive();
    const sevenStart = subDays(new Date(), 7).toISOString();
    const { data: wins7dRows, error: wins7dError } = await supabase
      .from("wins")
      .select("agent_id")
      .in("agent_id", agentIds)
      .gte("created_at", sevenStart)
      .abortSignal(signal);
    if (wins7dError) return { data: null, error: wins7dError };
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
  return { data: rows, error: null };
}

async function loadRecentWins(
  target: { orgId: string } | { agentIds: string[] },
  signal: AbortSignal,
): Promise<LeaderboardLoadResult<Win[]>> {
  let query = supabase.from("wins").select("*").order("created_at", { ascending: false }).limit(20);
  query = "agentIds" in target
    ? query.in("agent_id", target.agentIds)
    : query.eq("organization_id", target.orgId);
  const { data, error } = await query.abortSignal(signal);
  if (error || !data) return { data: null, error };
  const rawWins = data as Win[];
  const contactIds = [...new Set(rawWins.map((w) => w.contact_id).filter(Boolean))] as string[];
  const clientMonthlyById = await loadClientMonthlyPremiums(contactIds, signal);
  return {
    data: rawWins.map((w) => ({
      ...w,
      premiumSold: annualPremiumForWin(
        { ...w, agent_id: w.agent_id ?? null, contact_id: w.contact_id ?? null },
        clientMonthlyById,
      ),
    })),
    error: null,
  };
}

export function useLeaderboardData() {
  const { profile, user } = useAuth();
  const { agencyGroup } = useAgencyGroup();
  const orgId = profile?.organization_id ?? null;
  const userId = user?.id ?? null;
  /** The real auth user (what the RPC checks as auth.uid()) plus the effective organization. */
  const identityKey = userId && orgId ? `${userId}:${orgId}` : null;

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
  const [standingsStatus, setStandingsStatus] = useState<StandingsStatus>(STANDINGS_STATUS_OK);
  const [winsStatus, setWinsStatus] = useState<WinsStatus>(WINS_STATUS_LOADING);
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );

  const previousDisplayedRanksRef = useRef<Map<string, number>>(new Map());
  const previousMetricValuesRef = useRef<Map<string, number>>(new Map());
  const latestWinIdRef = useRef<string | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const agentsRef = useRef<AgentStats[]>([]);
  const fetchDataRef = useRef<(options?: FetchOptions) => Promise<void>>(async () => {});
  const fetchWinsRef = useRef<(options?: WinsFetchOptions) => Promise<Win[] | null>>(async () => null);
  const winFlashClearTimerRef = useRef<number | null>(null);
  const spotlightDelayTimerRef = useRef<number | null>(null);
  const spotlightClearTimerRef = useRef<number | null>(null);
  /** Monotonic fetch generation: only the newest in-flight fetch may commit state. */
  const fetchGenerationRef = useRef(0);
  const winsGenerationRef = useRef(0);
  /**
   * Synchronously-current metric. Fetch completions rank with THIS (never the
   * closure's metric), so a poll resolving after a metric switch ranks by the
   * latest selection — and the fetch callbacks need no `metric` dependency.
   */
  const metricRef = useRef<Metric>(metric);

  // Request-gate bookkeeping. Scheduler timers live apart from the win/rank
  // sequence timers, so a metric or period switch never cancels a scheduled check.
  const ownerRef = useRef<object>({});
  const gateRef = useRef<LeaderboardRequestGate | null>(null);
  const identityRef = useRef<string | null>(identityKey);
  const dirtyRef = useRef(false);
  const lastUpdatedAtRef = useRef<number | null>(null);
  const trailingTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  /** Trailing Recent Wins read for realtime wins that arrive faster than the spacing allows. */
  const winsTimerRef = useRef<number | null>(null);
  const pendingWinRef = useRef<{ id: string | null; agentId: string | null; eventAt: number } | null>(null);
  /** A win to celebrate once ANY committed Recent Wins list contains it. */
  const celebrateRef = useRef<{ id: string; agentId: string | null } | null>(null);
  const requestAutoRefreshRef = useRef<() => void>(() => {});
  /** After unmount nothing commits and nothing new is requested. */
  const mountedRef = useRef(true);

  // Group selection is by id, so group info arriving after mount never re-sends the org request.
  const groupId = view === "group" ? agencyGroup?.groupId ?? null : null;
  const standingsEndpoint: LeaderboardEndpoint = groupId ? "group_standings" : "org_standings";
  /** Scope of the standings on screen: viewer, view/group and period. */
  const scopeKey = `${identityKey ?? ""}|${groupId ?? "org"}|${period}`;
  /** Recent Wins are not period-scoped. */
  const winsScopeKey = `${identityKey ?? ""}|${groupId ?? "org"}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const winsScopeRef = useRef(winsScopeKey);
  winsScopeRef.current = winsScopeKey;
  const endpointRef = useRef(standingsEndpoint);
  endpointRef.current = standingsEndpoint;
  const periodRef = useRef(period);
  periodRef.current = period;
  /** The status kind on screen, for decisions made outside render. */
  const statusKindRef = useRef<StandingsStatus["kind"]>("ok");
  /**
   * The scope the standings on screen were loaded for, including the period's
   * START — after midnight, yesterday's "Today" is a different scope.
   */
  const snapshotScopeRef = useRef<string | null>(null);
  const winsSnapshotScopeRef = useRef<string | null>(null);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    statusKindRef.current = standingsStatus.kind;
  }, [standingsStatus.kind]);

  /** Snapshot tag of the CURRENT selection: scope + the period's start right now. */
  const currentSnapshotTag = useCallback(
    () => `${scopeRef.current}|${getPeriodRange(periodRef.current).start.toISOString()}`,
    [],
  );

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

  const clearAllSequenceTimers = clearWinSequenceTimers;

  const clearSchedulerTimers = useCallback(() => {
    if (trailingTimerRef.current != null) {
      window.clearTimeout(trailingTimerRef.current);
      trailingTimerRef.current = null;
    }
    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (winsTimerRef.current != null) {
      window.clearTimeout(winsTimerRef.current);
      winsTimerRef.current = null;
    }
    pendingWinRef.current = null;
    celebrateRef.current = null;
  }, []);

  const cancelRetry = useCallback(() => {
    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  /** One retry timer at the end of a backoff / maintenance hold. */
  const scheduleRetry = useCallback((at: number) => {
    if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      requestAutoRefreshRef.current();
    }, Math.max(0, at - Date.now()));
  }, []);

  const gateFor = useCallback((identity: string) => {
    const gate = getLeaderboardRequestGate(identity);
    gateRef.current = gate;
    return gate;
  }, []);

  // A different viewer: nothing of the previous one may remain on screen. Runs
  // before paint, so the previous viewer's rows are never drawn for the new one.
  useLayoutEffect(() => {
    if (identityRef.current === identityKey) return;
    identityRef.current = identityKey;
    gateRef.current?.release(ownerRef.current);
    gateRef.current = null;
    fetchGenerationRef.current += 1;
    winsGenerationRef.current += 1;
    agentsRef.current = [];
    hasLoadedOnceRef.current = false;
    latestWinIdRef.current = null;
    snapshotScopeRef.current = null;
    winsSnapshotScopeRef.current = null;
    lastUpdatedAtRef.current = null;
    previousDisplayedRanksRef.current = new Map();
    previousMetricValuesRef.current = new Map();
    dirtyRef.current = false;
    clearSchedulerTimers();
    clearAllSequenceTimers();
    setAgents([]);
    setWins([]);
    setLoadError(null);
    setStandingsStatus(STANDINGS_STATUS_OK);
    setWinsStatus(WINS_STATUS_LOADING);
    setInitialLoading(true);
    setFilterRefreshing(false);
    setRankAnimations(new Map());
    setRankMovements(new Map());
    setRankMotions(new Map());
    setRankDeltas(new Map());
    setFlashingWinId(null);
    setSpotlightAgentId(null);
    setNewLeaderId(null);
  }, [identityKey, clearSchedulerTimers, clearAllSequenceTimers]);

  // Org wins never appear under the Group title (or the reverse) while the other loads.
  useLayoutEffect(() => {
    if (winsSnapshotScopeRef.current === null || winsSnapshotScopeRef.current === winsScopeKey) return;
    winsGenerationRef.current += 1;
    winsSnapshotScopeRef.current = null;
    setWins([]);
    setWinsStatus(WINS_STATUS_LOADING);
  }, [winsScopeKey]);

  useEffect(() => {
    mountedRef.current = true;
    const owner = ownerRef.current;
    return () => {
      mountedRef.current = false;
      gateRef.current?.release(owner);
      clearSchedulerTimers();
    };
  }, [clearSchedulerTimers]);

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

  /**
   * Settle the visible loading flags. Only the NEWEST fetch generation ever
   * reaches endFetch (stale fetches return before it), so this must settle
   * unconditionally — a silent poll that superseded a visible fetch still owns
   * clearing the skeleton/spinner that fetch left behind.
   */
  const endFetch = useCallback(() => {
    if (!hasLoadedOnceRef.current) {
      hasLoadedOnceRef.current = true;
      setInitialLoading(false);
    }
    setFilterRefreshing(false);
  }, []);

  /**
   * Controlled metric change. The aggregate RPC already returned every metric,
   * so switching the selected metric is a pure re-rank of the cached rows:
   * ZERO fetches, no loading state, and one batched commit in which the new
   * metric can never render against the previous metric's rankings. Cached
   * rows are cloned before ranking — existing state objects are not mutated —
   * and live-data animation state is cleared so a filter-driven reorder never
   * reuses rank glow, movement, spotlight, or new-leader effects.
   */
  const changeMetric = useCallback((next: Metric) => {
    if (next === metricRef.current) return;
    metricRef.current = next;
    const reRanked = rankAgents(
      agentsRef.current.map((a) => ({ ...a })),
      next,
    );
    setRankAnimations(new Map());
    setRankMovements(new Map());
    setRankMotions(new Map());
    setRankDeltas(new Map());
    setNewLeaderId(null);
    setSpotlightAgentId(null);
    setMetric(next);
    setAgents(reRanked);
  }, []);

  /**
   * A failed or held standings run. Rows loaded for a DIFFERENT scope (another
   * period, view or group) are cleared rather than shown under this selection.
   */
  const applyStandingsIssue = useCallback(
    (result: StandingsIssue, gate: LeaderboardRequestGate, endpoint: LeaderboardEndpoint, scope: string) => {
      // Hidden or offline: nothing was sent, so nothing about the standings changed.
      if (result.status === "blocked" && result.reason === "inactive") return;
      if (result.status === "blocked" && result.reason === "throttled") {
        // Too soon for a manual retry: nothing was sent and nothing changed.
        setStandingsStatus((prev) => ({ ...prev, manualAvailableAt: gate.manualAvailableAt(endpoint) }));
        return;
      }
      const kind = standingsStatusKind(result.kind);
      if (snapshotScopeRef.current !== scope) {
        agentsRef.current = [];
        snapshotScopeRef.current = null;
        lastUpdatedAtRef.current = null;
        setAgents([]);
      }
      const hasSnapshot = agentsRef.current.length > 0;
      // The next check is when the gate will really accept the automatic run
      // (backoff AND spacing after a slow or timed-out answer), never earlier.
      const nextCheckAt = Math.max(result.retryAt, gate.autoAvailableAt(endpoint));
      setLoadError(standingsHeadline(kind, hasSnapshot));
      setStandingsStatus({
        kind,
        lastUpdatedAt: hasSnapshot ? lastUpdatedAtRef.current : null,
        nextCheckAt,
        manualAvailableAt: gate.manualAvailableAt(endpoint),
        offline: false,
      });
      scheduleRetry(nextCheckAt);
    },
    [scheduleRetry],
  );

  const fetchData = useCallback(
    async (options?: FetchOptions) => {
      if (!identityKey || !orgId) {
        endFetch();
        return;
      }
      const mode = options?.mode ?? "initial";
      const gen = ++fetchGenerationRef.current;
      const scope = scopeKey;
      const endpoint = standingsEndpoint;
      const gate = gateFor(identityKey);
      beginFetch(options?.silent);

      const range = getPeriodRange(period);
      const startIso = range.start.toISOString();
      const tag = `${scope}|${startIso}`;
      const result = await gate.run<AgentStats[]>(
        groupId
          ? {
              endpoint,
              channel: "standings",
              key: `${CONSUMER}|group_standings|${groupId}|${period}|${startIso}`,
              mode,
              owner: ownerRef.current,
              load: (signal) => loadGroupStandings(groupId, period, signal),
            }
          : {
              endpoint,
              channel: "standings",
              key: `${CONSUMER}|org_standings|${period}|${startIso}`,
              mode,
              owner: ownerRef.current,
              load: (signal) => loadOrgStandings(range, signal),
            },
      );

      if (!mountedRef.current || gen !== fetchGenerationRef.current || scopeRef.current !== scope) return;

      if (result.status === "ok") {
        const currentStats = rankAgents(
          result.data.map((a) => ({ ...a })),
          metricRef.current,
        );
        applyRankAnimations(currentStats, metricRef.current);
        const updatedAt = Date.now();
        agentsRef.current = currentStats;
        snapshotScopeRef.current = tag;
        lastUpdatedAtRef.current = updatedAt;
        setLoadError(null);
        setAgents(currentStats);
        setStandingsStatus({
          ...STANDINGS_STATUS_OK,
          lastUpdatedAt: updatedAt,
          manualAvailableAt: gate.manualAvailableAt(endpoint),
        });
        cancelRetry();
        // This selection is current now: a catch-up still waiting on the spacing
        // (e.g. the tab left and came back during this read) has nothing to do.
        dirtyRef.current = false;
        if (trailingTimerRef.current != null) {
          window.clearTimeout(trailingTimerRef.current);
          trailingTimerRef.current = null;
        }
      } else if (
        result.status === "blocked" &&
        result.reason === "throttled" &&
        snapshotScopeRef.current !== tag
      ) {
        // This selection's load was deferred by the spacing rule: load it as soon
        // as the gate allows, and keep the status' times truthful meanwhile.
        const nextAt = Math.max(result.availableAt, gate.autoAvailableAt(endpoint));
        setStandingsStatus((prev) =>
          prev.kind === "ok"
            ? prev
            : { ...prev, nextCheckAt: nextAt, manualAvailableAt: gate.manualAvailableAt(endpoint) },
        );
        scheduleRetry(nextAt);
        // Stay in the loading state over another selection's rows (never shown as
        // current); with nothing on screen, the error panel already says why.
        if (agentsRef.current.length > 0 || statusKindRef.current === "ok") return;
      } else if (result.status === "blocked" && result.reason === "inactive") {
        // The tab went hidden or offline before this was sent: nothing was. The
        // catch-up refresh loads it once the tab is visible and online again.
        dirtyRef.current = true;
        if (snapshotScopeRef.current !== tag) {
          // A new selection waits in its loading state (a silent run included) —
          // never under another selection's rows, headline or times. A server
          // hold still covers the endpoint, so it stays on screen.
          agentsRef.current = [];
          snapshotScopeRef.current = null;
          lastUpdatedAtRef.current = null;
          setAgents([]);
          const hold = gate.cooldown(endpoint);
          const heldKind = hold && (hold.kind === "maintenance" || hold.kind === "busy") ? hold.kind : null;
          setLoadError(heldKind ? standingsHeadline(heldKind, false) : null);
          setStandingsStatus({
            ...STANDINGS_STATUS_OK,
            kind: heldKind ?? "ok",
            manualAvailableAt: gate.manualAvailableAt(endpoint),
          });
          if (hasLoadedOnceRef.current) setFilterRefreshing(true);
          else setInitialLoading(true);
          return;
        }
      } else if (result.status !== "superseded") {
        // Group stays selected on failure: silently switching to My Agency would
        // send the viewer to the org endpoint (the paused one during maintenance).
        applyStandingsIssue(result, gate, endpoint, tag);
      }
      endFetch();

      // Recent Wins follow the standings whenever standings are on screen — after
      // a request that reached the network, or on the automatic cadence.
      const reachedNetwork = result.status === "ok" || result.status === "failed";
      if (
        (reachedNetwork || (result.status === "blocked" && result.reason !== "inactive" && mode === "auto")) &&
        (agentsRef.current.length > 0 || result.status === "ok")
      ) {
        void fetchWinsRef.current({
          mode: mode === "auto" ? "auto" : "initial",
          roster: agentsRef.current,
        });
      }
    },
    [
      identityKey,
      orgId,
      groupId,
      period,
      scopeKey,
      standingsEndpoint,
      gateFor,
      beginFetch,
      endFetch,
      applyRankAnimations,
      applyStandingsIssue,
      cancelRetry,
      scheduleRetry,
    ],
  );

  const retry = useCallback(() => {
    void fetchDataRef.current({ mode: "manual" });
  }, []);

  /** Returns the committed list, or null when nothing was committed. */
  const fetchWins = useCallback(
    async (options?: WinsFetchOptions): Promise<Win[] | null> => {
      if (!mountedRef.current || !identityKey || !orgId) return null;
      if (!options?.roster && (agentsRef.current.length === 0 || snapshotScopeRef.current !== currentSnapshotTag())) {
        // Recent Wins are read only while this selection's standings are on screen.
        dirtyRef.current = true;
        return null;
      }
      const roster = options?.roster ?? agentsRef.current;
      if (groupId && roster.length === 0) {
        // A group with nobody on its board has no wins to show (a read, not a guess).
        winsSnapshotScopeRef.current = winsScopeKey;
        setWins([]);
        setWinsStatus({ kind: "ok", lastUpdatedAt: Date.now() });
        return [];
      }
      if (!canAutoRefreshLeaderboard()) {
        // Re-checked before every Recent Wins dispatch (the read after standings
        // included): a tab hidden or offline since sends nothing; the catch-up
        // refresh on return reads the feed.
        dirtyRef.current = true;
        return null;
      }
      const gen = ++winsGenerationRef.current;
      const scope = winsScopeKey;
      const gate = gateFor(identityKey);
      const agentIds = groupId ? roster.map((a) => a.id).sort() : [];
      const result = await gate.run<Win[]>({
        endpoint: "wins",
        channel: "wins",
        key: groupId
          ? `${CONSUMER}|wins|group|${groupId}|${agentIds.join(",")}`
          : `${CONSUMER}|wins|org|${orgId}`,
        mode: options?.mode ?? "initial",
        owner: ownerRef.current,
        notBefore: options?.notBefore,
        load: (signal) => loadRecentWins(groupId ? { agentIds } : { orgId }, signal),
      });
      if (!mountedRef.current) return null;
      if (result.status === "blocked" && result.reason === "inactive") {
        // Queued, then the tab went hidden or offline: nothing was sent.
        dirtyRef.current = true;
        return null;
      }
      if (result.status === "blocked" && result.reason === "throttled") options?.onThrottled?.(result.availableAt);
      if (gen !== winsGenerationRef.current || winsScopeRef.current !== scope) return null;

      if (result.status === "ok") {
        const newWins = result.data;
        const newest = newWins[0];
        if (newest && !latestWinIdRef.current) {
          latestWinIdRef.current = newest.id;
        }
        winsSnapshotScopeRef.current = scope;
        setWins(newWins);
        setWinsStatus({ kind: "ok", lastUpdatedAt: Date.now() });
        // Celebrate a realtime win as soon as it is on screen, whichever read committed it.
        const celebrate = celebrateRef.current;
        if (celebrate && newWins.some((w) => w.id === celebrate.id)) {
          celebrateRef.current = null;
          beginWinSequence(celebrate.id, celebrate.agentId);
        }
        return newWins;
      }
      if (result.status === "failed" || (result.status === "blocked" && result.reason === "cooldown")) {
        // A failed read keeps the list on screen (same scope only) — never "No wins yet".
        const kept = winsSnapshotScopeRef.current === scope;
        if (!kept) setWins([]);
        setWinsStatus((prev) => ({ kind: "error", lastUpdatedAt: kept ? prev.lastUpdatedAt : null }));
      }
      return null;
    },
    [identityKey, orgId, groupId, winsScopeKey, gateFor, beginWinSequence, currentSnapshotTag],
  );

  fetchDataRef.current = fetchData;
  fetchWinsRef.current = fetchWins;

  /**
   * The only automatic trigger (poll, realtime, visible/online again, retry
   * timer): visible and online tabs only, never inside a backoff or maintenance
   * hold, and spaced by the gate so a slow database is never stampeded.
   */
  const requestAutoRefresh = useCallback(() => {
    const identity = identityRef.current;
    if (!identity) return;
    if (!canAutoRefreshLeaderboard()) {
      dirtyRef.current = true;
      return;
    }
    const gate = gateFor(identity);
    const endpoint = endpointRef.current;
    const hold = gate.cooldown(endpoint);
    if (hold) {
      dirtyRef.current = true;
      scheduleRetry(Math.max(hold.until, gate.autoAvailableAt(endpoint)));
      // Settle into the hold's state without a request — also when nothing has
      // loaded yet (a tab opened in the background during a hold) or the hold
      // comes from a request whose result was discarded (the viewer had moved
      // on): never "Live" or a skeleton during a hold.
      applyStandingsIssue(
        { status: "blocked", reason: "cooldown", kind: hold.kind, retryAt: hold.until },
        gate,
        endpoint,
        currentSnapshotTag(),
      );
      endFetch();
      if (agentsRef.current.length > 0) {
        // Standings are on screen: their Recent Wins keep their own (spaced) cadence.
        void fetchWinsRef.current({ mode: "auto" });
      }
      return;
    }
    const wait = gate.autoAvailableAt(endpoint) - Date.now();
    if (wait > 0) {
      dirtyRef.current = true;
      if (trailingTimerRef.current == null) {
        trailingTimerRef.current = window.setTimeout(() => {
          trailingTimerRef.current = null;
          requestAutoRefreshRef.current();
        }, wait);
      }
      return;
    }
    dirtyRef.current = false;
    boardDevLog("applying scoreboard refresh");
    void fetchDataRef.current({ silent: true, mode: "auto" });
  }, [gateFor, scheduleRetry, applyStandingsIssue, endFetch, currentSnapshotTag]);
  requestAutoRefreshRef.current = requestAutoRefresh;

  // Mount and every selection change. A hidden or offline tab sends nothing: the
  // gate refuses the run, the selection waits in its loading state (never under
  // another selection's rows) and loads once the tab is visible and online.
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Poll + visibility/online scheduling. Kept apart from the realtime channel, so
  // switching tabs never re-subscribes realtime or cancels a win animation.
  useEffect(() => {
    if (!identityKey) return;
    let pollId: number | null = null;
    const stopPoll = () => {
      if (pollId != null) {
        window.clearInterval(pollId);
        pollId = null;
      }
    };
    const startPoll = () => {
      if (pollId == null) pollId = window.setInterval(() => requestAutoRefreshRef.current(), POLL_MS);
    };
    const onEnvironmentChange = () => {
      setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
      if (!canAutoRefreshLeaderboard()) {
        stopPoll();
        for (const timer of [trailingTimerRef, winsTimerRef]) {
          if (timer.current != null) {
            window.clearTimeout(timer.current);
            timer.current = null;
          }
        }
        return;
      }
      startPoll();
      const updatedAt = lastUpdatedAtRef.current;
      if (dirtyRef.current || updatedAt === null || Date.now() - updatedAt >= POLL_MS) {
        requestAutoRefreshRef.current();
      }
    };
    if (canAutoRefreshLeaderboard()) startPoll();
    document.addEventListener("visibilitychange", onEnvironmentChange);
    window.addEventListener("online", onEnvironmentChange);
    window.addEventListener("offline", onEnvironmentChange);
    return () => {
      stopPoll();
      document.removeEventListener("visibilitychange", onEnvironmentChange);
      window.removeEventListener("online", onEnvironmentChange);
      window.removeEventListener("offline", onEnvironmentChange);
      clearSchedulerTimers();
    };
  }, [identityKey, clearSchedulerTimers]);

  // Realtime: only win INSERTs (the celebration). Standings changes arrive through
  // the poll — the calls binding shared the dialer's org-wide calls stream, and
  // appointments are not in the realtime publication at all.
  useEffect(() => {
    if (!orgId || !identityKey) return;
    let disposed = false;
    const identity = identityKey;

    /**
     * One spaced Recent Wins read for the latest win event. A burst of wins
     * becomes one trailing read (never a read per INSERT), and it never joins a
     * read that started before the win arrived.
     */
    const runPendingWin = () => {
      if (disposed || winsTimerRef.current != null) return;
      if (!canAutoRefreshLeaderboard()) {
        // Hidden or offline: keep the event; the catch-up refresh on return reads the feed.
        dirtyRef.current = true;
        return;
      }
      const wait = gateFor(identity).autoAvailableAt("wins") - Date.now();
      if (wait > 0) {
        winsTimerRef.current = window.setTimeout(() => {
          winsTimerRef.current = null;
          runPendingWin();
        }, wait);
        return;
      }
      const event = pendingWinRef.current;
      pendingWinRef.current = null;
      if (!event) return;
      // Celebrated only once a committed list contains it (see fetchWins).
      if (event.id) celebrateRef.current = { id: event.id, agentId: event.agentId };
      void (async () => {
        let deferredUntil: number | null = null;
        await fetchWinsRef.current({
          mode: "auto",
          notBefore: event.eventAt,
          onThrottled: (availableAt) => (deferredUntil = availableAt),
        });
        if (disposed || identityRef.current !== identity) return;
        if (deferredUntil !== null && winsTimerRef.current == null) {
          // Queued behind a slow read and then deferred: keep the event and retry then.
          pendingWinRef.current ??= event;
          winsTimerRef.current = window.setTimeout(() => {
            winsTimerRef.current = null;
            runPendingWin();
          }, Math.max(0, deferredUntil - Date.now()));
          return;
        }
        requestAutoRefreshRef.current();
      })();
    };

    const handleWinInsert = (payload: { new: Record<string, unknown> }) => {
      if (disposed) return;
      const row = payload.new as { id?: string; agent_id?: string | null };
      if (!canAutoRefreshLeaderboard() || agentsRef.current.length === 0) {
        dirtyRef.current = true;
        return;
      }
      pendingWinRef.current = { id: row?.id ?? null, agentId: row?.agent_id ?? null, eventAt: Date.now() };
      runPendingWin();
    };

    const channel = supabase.channel(`leaderboard-realtime-${orgId}`);
    channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "wins", filter: `organization_id=eq.${orgId}` },
        handleWinInsert,
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" && import.meta.env.DEV) {
          console.warn("[leaderboard] realtime channel error — using poll fallback");
        }
      });

    return () => {
      disposed = true;
      supabase.removeChannel(channel);
      clearAllSequenceTimers();
      if (winsTimerRef.current != null) {
        window.clearTimeout(winsTimerRef.current);
        winsTimerRef.current = null;
      }
      pendingWinRef.current = null;
      celebrateRef.current = null;
    };
  }, [orgId, identityKey, gateFor, clearAllSequenceTimers]);

  const standingsFrozen = !hasMeaningfulStandings(agents, metric);
  const reportedStandingsStatus = useMemo(
    () => (standingsStatus.offline === offline ? standingsStatus : { ...standingsStatus, offline }),
    [standingsStatus, offline],
  );
  // Offline with no wins loaded: nothing is loading, so never an endless "Loading recent wins…".
  const reportedWinsStatus = useMemo<WinsStatus>(
    () => (offline && winsStatus.kind === "loading" ? { kind: "error", lastUpdatedAt: null } : winsStatus),
    [winsStatus, offline],
  );

  return {
    view,
    setView,
    period,
    setPeriod,
    metric,
    setMetric: changeMetric,
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
    standingsStatus: reportedStandingsStatus,
    winsStatus: reportedWinsStatus,
    retry,
    fetchData,
    fetchWins,
  };
}
