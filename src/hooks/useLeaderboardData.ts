import { useState, useEffect, useCallback, useRef } from "react";
import { subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAgencyGroup } from "@/hooks/useAgencyGroup";
import {
  computeBadges,
  computeFireStatus,
  type Badge as BadgeType,
  type AgentFireStatus,
} from "@/components/leaderboard/useLeaderboardBadges";
import {
  type AgentStats,
  type Win,
  type Period,
  type Metric,
  type LeaderboardView,
  metricKey,
  getPeriodRange,
  getPrevPeriodRange,
  mapPeriodToRpcParam,
} from "@/components/leaderboard/leaderboardTypes";

type FetchOptions = { silent?: boolean };

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
  const [badgesMap, setBadgesMap] = useState<Map<string, BadgeType[]>>(new Map());
  const [fireMap, setFireMap] = useState<Map<string, AgentFireStatus>>(new Map());
  const [rankAnimations, setRankAnimations] = useState<Map<string, "up" | "down">>(new Map());
  const [flashingWinId, setFlashingWinId] = useState<string | null>(null);

  const prevRanksRef = useRef<Map<string, number>>(new Map());
  const latestWinIdRef = useRef<string | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const agentsRef = useRef<AgentStats[]>([]);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

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

  const applyBadgesAndFire = useCallback(async (stats: AgentStats[]) => {
    const agentIds = stats.map((a) => a.id);
    if (agentIds.length === 0) {
      setBadgesMap(new Map());
      setFireMap(new Map());
      return;
    }
    const [bdg, fire] = await Promise.all([
      computeBadges(agentIds, stats),
      computeFireStatus(agentIds),
    ]);
    setBadgesMap(bdg);
    setFireMap(fire);
  }, []);

  const computeStats = useCallback(
    async (
      profiles: { id: string; first_name: string; last_name: string; avatar_url?: string | null }[],
      range: { start: Date; end: Date },
    ) => {
      if (!orgId) return [];

      const startISO = range.start.toISOString();
      const endISO = range.end.toISOString();

      const [callsRes, apptsRes, winsRes] = await Promise.all([
        supabase
          .from("calls")
          .select("agent_id, disposition_name, duration, started_at")
          .eq("organization_id", orgId)
          .gte("started_at", startISO)
          .lte("started_at", endISO),
        supabase
          .from("appointments")
          .select("created_by, created_at")
          .eq("organization_id", orgId)
          .gte("created_at", startISO)
          .lte("created_at", endISO),
        supabase
          .from("wins")
          .select("agent_id, created_at")
          .eq("organization_id", orgId)
          .gte("created_at", startISO)
          .lte("created_at", endISO),
      ]);

      const calls = callsRes.data || [];
      const appts = apptsRes.data || [];
      const winsCurrent = winsRes.data || [];

      return profiles.map((p) => {
        const agentCalls = calls.filter((c) => c.agent_id === p.id);
        const callsMade = agentCalls.length;
        const policiesSold = winsCurrent.filter((w) => w.agent_id === p.id).length;
        const talkTime = agentCalls.reduce(
          (s, c) => s + (c.duration && c.duration > 0 ? c.duration : 0),
          0,
        );
        const appointmentsSet = appts.filter((a) => a.created_by === p.id).length;
        const conversionRate = callsMade > 0 ? (policiesSold / callsMade) * 100 : 0;
        return {
          ...p,
          callsMade,
          policiesSold,
          appointmentsSet,
          talkTime,
          conversionRate,
          recentWins7d: 0,
          rank: 0,
          prevRank: null as number | null,
        };
      });
    },
    [orgId],
  );

  const fetchGroupData = useCallback(
    async (groupId: string, options?: FetchOptions) => {
      beginFetch(options?.silent);
      const { data, error } = await supabase.rpc("get_agency_group_leaderboard", {
        p_group_id: groupId,
        p_period: mapPeriodToRpcParam(period),
      });

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
          recentWins7d: 0,
          rank: 0,
          prevRank: null as number | null,
          organizationId: (r.organization_id as string | null) ?? null,
          organizationName: (r.organization_name as string | null) ?? null,
        } as AgentStats;
      });

      const key = metricKey(metric);
      rows.sort((a, b) => (b[key] as number) - (a[key] as number));
      rows.forEach((a, i) => {
        a.rank = i + 1;
      });

      const agentIds = rows.map((a) => a.id);
      if (agentIds.length > 0) {
        const sevenStart = subDays(new Date(), 7).toISOString();
        const { data: wins7dRows } = await supabase
          .from("wins")
          .select("agent_id")
          .in("agent_id", agentIds)
          .gte("created_at", sevenStart);
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
      void applyBadgesAndFire(rows);
    },
    [period, metric, beginFetch, endFetch, applyBadgesAndFire],
  );

  const fetchOrgData = useCallback(
    async (options?: FetchOptions) => {
      if (!orgId) {
        endFetch(options?.silent);
        return;
      }

      beginFetch(options?.silent);

      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, avatar_url, role")
        .eq("organization_id", orgId)
        .eq("status", "Active");
      const allProfiles = profileRows || [];

      const range = getPeriodRange(period);
      const prevRange = getPrevPeriodRange(period);

      const [currentStats, prevStats] = await Promise.all([
        computeStats(allProfiles, range),
        computeStats(allProfiles, prevRange),
      ]);

      const key = metricKey(metric);

      currentStats.sort((a, b) => (b[key] as number) - (a[key] as number));
      currentStats.forEach((a, i) => {
        a.rank = i + 1;
      });

      prevStats.sort((a, b) => (b[key] as number) - (a[key] as number));
      const prevRankMap = new Map<string, number>();
      prevStats.forEach((a, i) => {
        prevRankMap.set(a.id, i + 1);
      });
      currentStats.forEach((a) => {
        a.prevRank = prevRankMap.get(a.id) ?? null;
      });

      const anims = new Map<string, "up" | "down">();
      currentStats.forEach((a) => {
        const prevRank = prevRanksRef.current.get(a.id);
        if (prevRank !== undefined && prevRank !== a.rank) {
          anims.set(a.id, a.rank < prevRank ? "up" : "down");
        }
      });
      if (anims.size > 0) {
        setRankAnimations(anims);
        setTimeout(() => setRankAnimations(new Map()), 1500);
      }
      currentStats.forEach((a) => prevRanksRef.current.set(a.id, a.rank));

      const sevenStart = subDays(new Date(), 7).toISOString();
      const { data: wins7dRows } = await supabase
        .from("wins")
        .select("agent_id")
        .eq("organization_id", orgId)
        .gte("created_at", sevenStart);
      const wins7dByAgent = new Map<string, number>();
      for (const row of wins7dRows || []) {
        const aid = row.agent_id;
        if (!aid) continue;
        wins7dByAgent.set(aid, (wins7dByAgent.get(aid) ?? 0) + 1);
      }
      currentStats.forEach((a) => {
        a.recentWins7d = wins7dByAgent.get(a.id) ?? 0;
      });

      setAgents(currentStats);
      endFetch(options?.silent);
      void applyBadgesAndFire(currentStats);
    },
    [orgId, period, metric, computeStats, beginFetch, endFetch, applyBadgesAndFire],
  );

  const fetchData = useCallback(
    async (options?: FetchOptions) => {
      if (view === "group" && agencyGroup) {
        return fetchGroupData(agencyGroup.groupId, options);
      }
      return fetchOrgData(options);
    },
    [view, agencyGroup, fetchGroupData, fetchOrgData],
  );

  const fetchWins = useCallback(
    async (options?: FetchOptions) => {
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
      const newWins = (data || []) as Win[];
      const newest = newWins[0];

      if (newest && latestWinIdRef.current && newest.id !== latestWinIdRef.current) {
        setFlashingWinId(newest.id);
        setTimeout(() => setFlashingWinId(null), 1500);
      }
      if (newest) {
        latestWinIdRef.current = newest.id;
      }

      setWins(newWins);
    },
    [view, orgId],
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    void fetchWins();
  }, [fetchWins, agents]);

  useEffect(() => {
    const onWinEvent = () => {
      void fetchWins({ silent: true });
      void fetchData({ silent: true });
    };

    const channel = supabase
      .channel("leaderboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => {
        void fetchData({ silent: true });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "wins" }, onWinEvent)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => {
        void fetchData({ silent: true });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchData, fetchWins]);

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
    badgesMap,
    fireMap,
    rankAnimations,
    flashingWinId,
    agencyGroup,
    fetchData,
    fetchWins,
  };
}
