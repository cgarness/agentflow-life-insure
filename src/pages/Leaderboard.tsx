import React, { useState, useEffect, useCallback, useRef } from "react";
import { Trophy, Download, ArrowUp, ArrowDown, Minus, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { startOfDay, startOfWeek, startOfMonth, subDays, subWeeks, subMonths } from "date-fns";
import { useBranding } from "@/contexts/BrandingContext";
import AgentScorecardModal from "@/components/leaderboard/AgentScorecardModal";
import LeaderboardAgentAvatar from "@/components/leaderboard/LeaderboardAgentAvatar";
import TVMode from "@/components/leaderboard/TVMode";
import { Badge as BadgeType, AgentFireStatus, computeBadges, computeFireStatus } from "@/components/leaderboard/useLeaderboardBadges";
import { useNavigate } from "react-router-dom";

type Period = "Today" | "This Week" | "This Month";
type Metric = "Policies Sold" | "Calls Made" | "Appointments Set" | "Talk Time" | "Conversion Rate";

interface AgentStats {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url?: string;
  callsMade: number;
  policiesSold: number;
  appointmentsSet: number;
  talkTime: number;
  conversionRate: number;
  /** Win (`wins` rows) count in the last 7 days — TV / “recent wins” column */
  recentWins7d: number;
  rank: number;
  prevRank: number | null;
}

interface Win {
  id: string;
  agent_name: string;
  contact_name: string;
  campaign_name: string;
  policy_type: string;
  created_at: string;
}

const metricKey = (m: Metric): keyof AgentStats => {
  switch (m) {
    case "Policies Sold": return "policiesSold";
    case "Calls Made": return "callsMade";
    case "Appointments Set": return "appointmentsSet";
    case "Talk Time": return "talkTime";
    case "Conversion Rate": return "conversionRate";
  }
};

const metricLabel = (m: Metric): string => {
  switch (m) {
    case "Policies Sold": return "policies sold";
    case "Calls Made": return "calls made";
    case "Appointments Set": return "appointments set";
    case "Talk Time": return "talk time";
    case "Conversion Rate": return "conversion rate";
  }
};

const formatMetricValue = (m: Metric, val: number): string => {
  if (m === "Talk Time") return `${(val / 3600).toFixed(1)} hrs`;
  if (m === "Conversion Rate") return `${val.toFixed(1)}%`;
  return String(val);
};

const getPeriodRange = (period: Period): { start: Date; end: Date } => {
  const now = new Date();
  switch (period) {
    case "Today": return { start: startOfDay(now), end: now };
    case "This Week": return { start: startOfWeek(now, { weekStartsOn: 1 }), end: now };
    case "This Month": return { start: startOfMonth(now), end: now };
  }
};

const getPrevPeriodRange = (period: Period): { start: Date; end: Date } => {
  const now = new Date();
  switch (period) {
    case "Today": { const prev = subDays(now, 1); return { start: startOfDay(prev), end: prev }; }
    case "This Week": { const prev = subWeeks(now, 1); return { start: startOfWeek(prev, { weekStartsOn: 1 }), end: prev }; }
    case "This Month": { const prev = subMonths(now, 1); return { start: startOfMonth(prev), end: prev }; }
  }
};

// ─── Badge display helpers ───

const BadgeIcons: React.FC<{ badges: BadgeType[]; max?: number }> = ({ badges, max = 3 }) => {
  if (badges.length === 0) return null;
  const shown = badges.slice(0, max);
  const extra = badges.length - max;
  return (
    <TooltipProvider delayDuration={200}>
      <span className="inline-flex items-center gap-0.5 ml-1">
        {shown.map(b => (
          <Tooltip key={b.id}>
            <TooltipTrigger asChild><span className="text-sm cursor-default">{b.icon}</span></TooltipTrigger>
            <TooltipContent><p className="text-xs font-medium">{b.label}</p><p className="text-xs text-muted-foreground">{b.description}</p></TooltipContent>
          </Tooltip>
        ))}
        {extra > 0 && (
          <Tooltip>
            <TooltipTrigger asChild><span className="text-[10px] text-muted-foreground cursor-default">+{extra}</span></TooltipTrigger>
            <TooltipContent>
              {badges.slice(max).map(b => <p key={b.id} className="text-xs">{b.icon} {b.label}</p>)}
            </TooltipContent>
          </Tooltip>
        )}
      </span>
    </TooltipProvider>
  );
};

const FireIcon: React.FC<{ fire: AgentFireStatus | undefined; agentName?: string }> = ({ fire, agentName }) => {
  if (!fire || fire.level === "none") return null;
  const text = fire.level === "blazing" ? "🔥🔥" : "🔥";
  const cls = fire.level === "blazing" ? "animate-fire-flicker" : "animate-fire-pulse";
  const tip = `${agentName || "Agent"} is ${fire.level === "blazing" ? "blazing" : "on fire"} today! ${fire.todayCalls} calls vs their ${fire.avgCalls}/day average`;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild><span className={`inline-block ml-1 ${cls}`}>{text}</span></TooltipTrigger>
        <TooltipContent><p className="text-xs">{tip}</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ─── Main Component ───

const Leaderboard: React.FC = () => {
  const { user, profile } = useAuth();
  const { formatDateTime } = useBranding();
  const navigate = useNavigate();
  const isAdmin = profile?.role?.toLowerCase() === "admin" || profile?.role?.toLowerCase() === "team leader";

  const [period, setPeriod] = useState<Period>("Today");
  const [metric, setMetric] = useState<Metric>("Policies Sold");
  const [agents, setAgents] = useState<AgentStats[]>([]);
  const [wins, setWins] = useState<Win[]>([]);
  const [loading, setLoading] = useState(true);
  const [scorecardAgent, setScorecardAgent] = useState<{ id: string; first_name: string; last_name: string } | null>(null);

  // Badges & Fire
  const [badgesMap, setBadgesMap] = useState<Map<string, BadgeType[]>>(new Map());
  const [fireMap, setFireMap] = useState<Map<string, AgentFireStatus>>(new Map());

  // Rank change animations
  const [rankAnimations, setRankAnimations] = useState<Map<string, "up" | "down">>(new Map());
  const prevRanksRef = useRef<Map<string, number>>(new Map());

  // TV Mode
  const [tvMode, setTvMode] = useState(false);

  // Win feed
  const prevWinCountRef = useRef<number>(0);
  const [changedWins, setChangedWins] = useState(false);

  const computeStats = useCallback(async (profiles: { id: string; first_name: string; last_name: string; avatar_url?: string | null }[], range: { start: Date; end: Date }) => {
    const startISO = range.start.toISOString();
    const endISO = range.end.toISOString();

    const [callsRes, apptsRes, winsRes] = await Promise.all([
      supabase.from("calls").select("agent_id, disposition_name, duration, started_at").gte("started_at", startISO).lte("started_at", endISO),
      supabase.from("appointments").select("created_by, created_at").gte("created_at", startISO).lte("created_at", endISO),
      supabase.from("wins").select("agent_id, created_at").gte("created_at", startISO).lte("created_at", endISO),
    ]);

    const calls = callsRes.data || [];
    const appts = apptsRes.data || [];
    const winsCurrent = winsRes.data || [];

    return profiles.map(p => {
      const agentCalls = calls.filter(c => c.agent_id === p.id);
      const callsMade = agentCalls.length;
      const policiesSold = winsCurrent.filter(w => w.agent_id === p.id).length;
      const talkTime = agentCalls.reduce((s, c) => s + (c.duration && c.duration > 0 ? c.duration : 0), 0);
      const appointmentsSet = appts.filter(a => a.created_by === p.id).length;
      const conversionRate = callsMade > 0 ? (policiesSold / callsMade) * 100 : 0;
      return { ...p, callsMade, policiesSold, appointmentsSet, talkTime, conversionRate, recentWins7d: 0, rank: 0, prevRank: null as number | null };
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);

    const { data: profileRows } = await supabase.from("profiles").select("id, first_name, last_name, avatar_url, role").eq("status", "Active");
    const allProfiles = profileRows || [];

    const range = getPeriodRange(period);
    const prevRange = getPrevPeriodRange(period);

    const [currentStats, prevStats] = await Promise.all([
      computeStats(allProfiles, range),
      computeStats(allProfiles, prevRange),
    ]);

    const key = metricKey(metric);

    // Sort and rank
    currentStats.sort((a, b) => (b[key] as number) - (a[key] as number));
    currentStats.forEach((a, i) => { a.rank = i + 1; });

    prevStats.sort((a, b) => (b[key] as number) - (a[key] as number));
    const prevRankMap = new Map<string, number>();
    prevStats.forEach((a, i) => { prevRankMap.set(a.id, i + 1); });
    currentStats.forEach(a => { a.prevRank = prevRankMap.get(a.id) ?? null; });

    // Animated rank changes (compare to last render, not prev period)
    const anims = new Map<string, "up" | "down">();
    currentStats.forEach(a => {
      const prevRank = prevRanksRef.current.get(a.id);
      if (prevRank !== undefined && prevRank !== a.rank) {
        anims.set(a.id, a.rank < prevRank ? "up" : "down");
      }
    });
    if (anims.size > 0) {
      setRankAnimations(anims);
      setTimeout(() => setRankAnimations(new Map()), 1500);
    }
    currentStats.forEach(a => prevRanksRef.current.set(a.id, a.rank));

    const sevenStart = subDays(new Date(), 7).toISOString();
    const { data: wins7dRows } = await supabase.from("wins").select("agent_id").gte("created_at", sevenStart);
    const wins7dByAgent = new Map<string, number>();
    for (const row of wins7dRows || []) {
      const aid = row.agent_id;
      if (!aid) continue;
      wins7dByAgent.set(aid, (wins7dByAgent.get(aid) ?? 0) + 1);
    }
    currentStats.forEach(a => {
      a.recentWins7d = wins7dByAgent.get(a.id) ?? 0;
    });

    setAgents(currentStats);
    setLoading(false);

    // Compute badges & fire status (non-blocking)
    const agentIds = currentStats.map(a => a.id);
    const [bdg, fire] = await Promise.all([
      computeBadges(agentIds, currentStats),
      computeFireStatus(agentIds),
    ]);
    setBadgesMap(bdg);
    setFireMap(fire);
  }, [period, metric, computeStats]);

  const fetchWins = useCallback(async () => {
    const { data } = await supabase.from("wins").select("*").order("created_at", { ascending: false }).limit(20);
    const newWins = (data || []) as Win[];
    if (prevWinCountRef.current > 0 && newWins.length > prevWinCountRef.current) {
      setChangedWins(true);
      setTimeout(() => setChangedWins(false), 1500);
    }
    prevWinCountRef.current = newWins.length;
    setWins(newWins);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchWins(); }, [fetchWins]);

  useEffect(() => {
    if (tvMode) document.body.dataset.tvMode = "true";
    else delete document.body.dataset.tvMode;
    return () => {
      delete document.body.dataset.tvMode;
    };
  }, [tvMode]);

  // Real-time subscriptions
  useEffect(() => {
    const channel = supabase
      .channel("leaderboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => { fetchData(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "wins" }, () => { fetchWins(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => { fetchData(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData, fetchWins]);

  // TV Mode fullscreen
  const enterTvMode = useCallback(() => {
    setTvMode(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  const exitTvMode = useCallback(() => {
    setTvMode(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const handler = () => { if (!document.fullscreenElement && tvMode) setTvMode(false); };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, [tvMode]);

  const topAgents = agents.filter(a => a.rank <= 3 && (a[metricKey(metric)] as number) > 0);
  const restAgents = agents.filter(a => a.rank > 3);
  const hasData = agents.some(a => (a[metricKey(metric)] as number) > 0);

  const exportCSV = () => {
    const headers = ["Rank", "Agent Name", "Calls Made", "Policies Sold", "Appointments Set", "Talk Time (minutes)", "Conversion Rate"];
    const rows = agents.map(a => [a.rank, `${a.first_name} ${a.last_name}`, a.callsMade, a.policiesSold, a.appointmentsSet, Math.round(a.talkTime / 60), `${a.conversionRate.toFixed(1)}%`]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `leaderboard-${period.toLowerCase().replace(" ", "-")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const openScorecard = (agent: AgentStats) => {
    if (!isAdmin && agent.id !== user?.id) return;
    setScorecardAgent({ id: agent.id, first_name: agent.first_name, last_name: agent.last_name });
  };

  const podiumOrder = (rank: number) => {
    if (rank === 1) return "md:order-2 md:z-[1] md:scale-[1.04]";
    if (rank === 2) return "md:order-1";
    return "md:order-3";
  };

  const metalConfig = (rank: number) => {
    if (rank === 1) {
      return {
        metal: "Gold",
        card: "bg-gradient-to-b from-amber-100/95 via-yellow-50 to-amber-200/80 border-2 border-amber-400/90 shadow-lg shadow-amber-500/30 ring-1 ring-amber-300/50 dark:from-amber-950/60 dark:via-amber-900/40 dark:to-amber-950/70 dark:border-amber-500/60 dark:shadow-amber-900/40 dark:ring-amber-600/30",
        trophyWrap: "bg-amber-400/25 ring-2 ring-amber-500/35 shadow-inner",
        trophyColor: "text-amber-600 dark:text-amber-400",
        rankPill: "bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 shadow-sm border border-amber-600/20",
        animate: "animate-trophy-shine",
      };
    }
    if (rank === 2) {
      return {
        metal: "Silver",
        card: "bg-gradient-to-b from-slate-100 via-zinc-50 to-slate-200/90 border-2 border-slate-300 shadow-md shadow-slate-400/25 ring-1 ring-slate-200/80 dark:from-slate-900/55 dark:via-zinc-900/45 dark:to-slate-800/70 dark:border-slate-500/70 dark:shadow-slate-950/50 dark:ring-slate-600/30",
        trophyWrap: "bg-slate-300/40 ring-2 ring-slate-400/40 shadow-inner dark:bg-slate-600/30 dark:ring-slate-500/40",
        trophyColor: "text-slate-500 dark:text-slate-300",
        rankPill: "bg-gradient-to-r from-slate-300 to-zinc-400 text-slate-900 shadow-sm border border-slate-500/25 dark:from-slate-600 dark:to-zinc-600 dark:text-white",
        animate: "",
      };
    }
    return {
      metal: "Bronze",
      card: "bg-gradient-to-b from-orange-100/90 via-amber-50 to-orange-200/85 border-2 border-orange-400/85 shadow-lg shadow-orange-500/20 ring-1 ring-orange-300/50 dark:from-orange-950/50 dark:via-amber-950/35 dark:to-orange-900/55 dark:border-orange-600/55 dark:shadow-orange-950/40 dark:ring-orange-800/30",
      trophyWrap: "bg-orange-400/25 ring-2 ring-orange-500/35 shadow-inner dark:bg-orange-900/40 dark:ring-orange-600/40",
      trophyColor: "text-orange-600 dark:text-orange-400",
      rankPill: "bg-gradient-to-r from-orange-400 to-amber-600 text-amber-950 shadow-sm border border-orange-700/20 dark:from-orange-600 dark:to-amber-700 dark:text-white",
      animate: "",
    };
  };

  const rankChangeDisplay = (a: AgentStats) => {
    if (a.prevRank === null) return <Minus className="w-3 h-3 text-muted-foreground" />;
    const diff = a.prevRank - a.rank;
    if (diff > 0) return <span className="inline-flex items-center gap-0.5 text-success text-xs font-medium"><ArrowUp className="w-3 h-3" />{diff}</span>;
    if (diff < 0) return <span className="inline-flex items-center gap-0.5 text-destructive text-xs font-medium"><ArrowDown className="w-3 h-3" />{Math.abs(diff)}</span>;
    return <Minus className="w-3 h-3 text-muted-foreground" />;
  };

  const getRowAnimation = (agentId: string) => {
    const anim = rankAnimations.get(agentId);
    if (anim === "up") return "animate-rank-up-glow";
    if (anim === "down") return "animate-rank-down-glow";
    return "";
  };

  // TV Mode render
  if (tvMode) {
    return (
      <TVMode
        agents={agents}
        wins={wins}
        badges={badgesMap}
        fireStatus={fireMap}
        onExit={exitTvMode}
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Leaderboard</h1>
        <div className="flex items-center gap-3">
          <div className="flex bg-accent rounded-lg p-0.5">
            {(["Today", "This Week", "This Month"] as Period[]).map(t => (
              <button key={t} onClick={() => setPeriod(t)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${period === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
            ))}
          </div>
          <select value={metric} onChange={e => setMetric(e.target.value as Metric)} className="h-9 px-3 rounded-lg bg-accent text-sm text-foreground border-0 focus:ring-2 focus:ring-primary/50">
            <option>Policies Sold</option>
            <option>Calls Made</option>
            <option>Appointments Set</option>
            <option>Talk Time</option>
            <option>Conversion Rate</option>
          </select>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={enterTvMode} className="h-9 w-9">
                  <Monitor className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Full Screen Display Mode</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Trophy className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">No activity for {period.toLowerCase()}</h2>
          <p className="text-muted-foreground mb-6">Start making calls to climb the leaderboard!</p>
          <Button onClick={() => navigate("/dialer")}>Go to Dialer</Button>
        </div>
      ) : (
        <>
          {/* Podium */}
          {topAgents.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 items-end max-w-3xl mx-auto lg:max-w-4xl">
              {topAgents.map(a => {
                const mc = metalConfig(a.rank);
                const initials = `${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`;
                const displayName = `${a.first_name} ${a.last_name?.[0] || ""}.`;
                const val = formatMetricValue(metric, a[metricKey(metric)] as number);
                const agentBadges = badgesMap.get(a.id) || [];
                const fire = fireMap.get(a.id);
                const isFirst = a.rank === 1;
                return (
                  <div
                    key={a.id}
                    onClick={() => openScorecard(a)}
                    className={`rounded-xl p-4 text-center transition-all duration-300 cursor-pointer hover:brightness-[1.02] hover:shadow-xl ${mc.card} ${podiumOrder(a.rank)} ${a.id === user?.id ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""} ${getRowAnimation(a.id)}`}
                  >
                    <div className={`inline-flex items-center justify-center w-9 h-9 rounded-full mb-2 ${mc.trophyWrap} ${mc.animate} ${rankAnimations.get(a.id) === "up" && isFirst ? "animate-tv-trophy-shimmer" : ""}`}>
                      <Trophy className={`${isFirst ? "w-5 h-5" : "w-4 h-4"} ${mc.trophyColor}`} />
                    </div>
                    <LeaderboardAgentAvatar
                      avatarUrl={a.avatar_url}
                      initials={initials}
                      alt={`${a.first_name} ${a.last_name}`.trim() || "Agent"}
                      className={`mx-auto mb-2 ${isFirst ? "h-11 w-11" : "h-9 w-9"}`}
                      fallbackClassName={isFirst ? "text-sm" : "text-xs"}
                    />
                    <h3 className={`font-bold text-foreground ${isFirst ? "text-base" : "text-sm"} leading-tight`}>
                      {displayName}
                      <FireIcon fire={fire} agentName={displayName} />
                    </h3>
                    {agentBadges.length > 0 && (
                      <div className="flex justify-center mt-0.5"><BadgeIcons badges={agentBadges} max={3} /></div>
                    )}
                    <span className={`inline-block text-[10px] uppercase tracking-wide px-2.5 py-0.5 rounded-full font-semibold mt-1.5 ${mc.rankPill}`}>#{a.rank} {mc.metal}</span>
                    <p className={`font-extrabold text-foreground tabular-nums tracking-tight mt-2 ${isFirst ? "text-3xl" : "text-2xl"}`}>{val}</p>
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mt-0.5">{metricLabel(metric)}</p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Rankings Table + Win Feed */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-card rounded-xl border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h3 className="font-semibold text-foreground">Full Rankings</h3>
                <button onClick={exportCSV} className="text-xs text-primary flex items-center gap-1 hover:underline"><Download className="w-3 h-3" /> Export CSV</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b bg-accent/50">
                      <th className="text-left py-3 px-4 font-medium w-16">Rank</th>
                      <th className="text-left py-3 font-medium">Agent</th>
                      <th className="text-right py-3 font-medium">Calls</th>
                      <th className="text-right py-3 font-medium">Policies</th>
                      <th className="text-right py-3 font-medium hidden lg:table-cell">Appts</th>
                      <th className="text-right py-3 font-medium hidden xl:table-cell">Talk Time</th>
                      <th className="text-right py-3 font-medium hidden lg:table-cell">Conv %</th>
                      <th className="text-right py-3 px-4 font-medium w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {restAgents.map(a => {
                      const initials = `${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`;
                      const displayName = `${a.first_name} ${a.last_name?.[0] || ""}.`;
                      const isMe = a.id === user?.id;
                      const agentBadges = badgesMap.get(a.id) || [];
                      const fire = fireMap.get(a.id);
                      return (
                        <tr key={a.id} className={`border-b last:border-0 hover:bg-accent/30 transition-all duration-600 ${isMe ? "bg-primary/5 border-l-2 border-primary" : ""} ${getRowAnimation(a.id)}`}>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1">
                              <span className="font-bold text-foreground">{a.rank}</span>
                              {rankChangeDisplay(a)}
                            </div>
                          </td>
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <LeaderboardAgentAvatar
                                avatarUrl={a.avatar_url}
                                initials={initials}
                                alt={`${a.first_name} ${a.last_name}`.trim() || "Agent"}
                                className="h-7 w-7"
                                fallbackClassName="text-[10px]"
                              />
                              <span className="font-medium text-foreground">
                                {displayName}
                                <FireIcon fire={fire} agentName={displayName} />
                              </span>
                              <BadgeIcons badges={agentBadges} max={3} />
                            </div>
                          </td>
                          <td className="py-3 text-right text-foreground">{a.callsMade}</td>
                          <td className="py-3 text-right text-foreground font-medium">{a.policiesSold}</td>
                          <td className="py-3 text-right text-foreground hidden lg:table-cell">{a.appointmentsSet}</td>
                          <td className="py-3 text-right text-foreground hidden xl:table-cell">{(a.talkTime / 3600).toFixed(1)} hrs</td>
                          <td className="py-3 text-right text-foreground hidden lg:table-cell">{a.conversionRate.toFixed(1)}%</td>
                          <td className="py-3 px-4 text-right">
                            {(isAdmin || isMe) && (
                              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => openScorecard(a)}>Scorecard</Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {restAgents.length === 0 && (
                      <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">All agents shown in podium above</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Win Feed */}
            <div className={`bg-card rounded-xl border p-5 ${changedWins ? "animate-leaderboard-flash" : ""}`}>
              <h3 className="font-semibold text-foreground mb-4">🏆 Recent Wins</h3>
              {wins.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No wins yet. Get dialing and close some deals! 🦈</p>
              ) : (
                <div className="space-y-3">
                  {wins.map(w => {
                    const winInitials = (w.agent_name || "??").split(" ").map(c => c[0]).join("").slice(0, 2);
                    const agentId = agents.find(a => `${a.first_name} ${a.last_name?.[0]}.` === w.agent_name || `${a.first_name} ${a.last_name}` === w.agent_name)?.id;
                    const fire = agentId ? fireMap.get(agentId) : undefined;
                    return (
                      <div key={w.id} className="flex items-start gap-3 pb-3 border-b last:border-0">
                        <div className="w-8 h-8 rounded-full bg-success/10 text-success text-xs font-bold flex items-center justify-center shrink-0">{winInitials}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground">
                            <span className="font-medium">{w.agent_name || "Agent"}</span>
                            {fire && fire.level !== "none" && <span className={`inline-block ml-1 ${fire.level === "blazing" ? "animate-fire-flicker" : "animate-fire-pulse"}`}>{fire.level === "blazing" ? "🔥🔥" : "🔥"}</span>}
                            {" "}closed {w.contact_name || "a deal"}
                          </p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {w.campaign_name && <span className="text-xs bg-accent text-accent-foreground px-1.5 py-0.5 rounded">{w.campaign_name}</span>}
                            {w.policy_type && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{w.policy_type}</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{formatDateTime(new Date(w.created_at))}</p>
                        </div>
                        <span className="text-lg shrink-0">🎉</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <AgentScorecardModal
        open={!!scorecardAgent}
        onOpenChange={open => { if (!open) setScorecardAgent(null); }}
        agent={scorecardAgent}
        badges={scorecardAgent ? badgesMap.get(scorecardAgent.id) || [] : []}
      />
    </div>
  );
};

export default Leaderboard;
