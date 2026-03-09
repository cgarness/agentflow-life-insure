import React, { useState, useEffect, useCallback, useRef } from "react";
import { Trophy, Download, ArrowUp, ArrowDown, Minus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { startOfDay, startOfWeek, startOfMonth, subDays, subWeeks, subMonths, formatDistanceToNow } from "date-fns";
import AgentScorecardModal from "@/components/leaderboard/AgentScorecardModal";
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
  goalProgress: number;
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
    case "Today": {
      const prev = subDays(now, 1);
      return { start: startOfDay(prev), end: prev };
    }
    case "This Week": {
      const prev = subWeeks(now, 1);
      return { start: startOfWeek(prev, { weekStartsOn: 1 }), end: prev };
    }
    case "This Month": {
      const prev = subMonths(now, 1);
      return { start: startOfMonth(prev), end: prev };
    }
  }
};

const Leaderboard: React.FC = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role?.toLowerCase() === "admin" || profile?.role?.toLowerCase() === "team leader";

  const [period, setPeriod] = useState<Period>("This Month");
  const [metric, setMetric] = useState<Metric>("Policies Sold");
  const [agents, setAgents] = useState<AgentStats[]>([]);
  const [wins, setWins] = useState<Win[]>([]);
  const [loading, setLoading] = useState(true);
  const [goals, setGoals] = useState<Record<string, number>>({});
  const [scorecardAgent, setScorecardAgent] = useState<{ id: string; first_name: string; last_name: string } | null>(null);
  const [changedAgents, setChangedAgents] = useState<Set<string>>(new Set());
  const [changedWins, setChangedWins] = useState(false);
  const prevAgentsRef = useRef<Map<string, string>>(new Map()); // id -> serialized metric values

  const computeStats = useCallback(async (profiles: { id: string; first_name: string; last_name: string }[], range: { start: Date; end: Date }) => {
    const startISO = range.start.toISOString();
    const endISO = range.end.toISOString();

    const [callsRes, apptsRes] = await Promise.all([
      supabase.from("calls").select("agent_id, disposition_name, duration, started_at").gte("started_at", startISO).lte("started_at", endISO),
      supabase.from("appointments").select("created_by, created_at").gte("created_at", startISO).lte("created_at", endISO),
    ]);

    const calls = callsRes.data || [];
    const appts = apptsRes.data || [];

    return profiles.map(p => {
      const agentCalls = calls.filter(c => c.agent_id === p.id);
      const callsMade = agentCalls.length;
      const policiesSold = agentCalls.filter(c => c.disposition_name && (/sold/i.test(c.disposition_name) || /policy/i.test(c.disposition_name))).length;
      const talkTime = agentCalls.reduce((s, c) => s + (c.duration && c.duration > 0 ? c.duration : 0), 0);
      const appointmentsSet = appts.filter(a => a.created_by === p.id).length;
      const conversionRate = callsMade > 0 ? (policiesSold / callsMade) * 100 : 0;

      return { ...p, callsMade, policiesSold, appointmentsSet, talkTime, conversionRate, goalProgress: 0, rank: 0, prevRank: null as number | null };
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);

    const [profilesRes, goalsRes] = await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name, avatar_url, role"),
      supabase.from("goals").select("metric, target_value"),
    ]);

    const allProfiles = (profilesRes.data || []).filter(p => p.role?.toLowerCase() !== "admin");
    const goalsMap: Record<string, number> = {};
    (goalsRes.data || []).forEach(g => { goalsMap[g.metric] = g.target_value; });
    setGoals(goalsMap);

    const range = getPeriodRange(period);
    const prevRange = getPrevPeriodRange(period);

    const [currentStats, prevStats] = await Promise.all([
      computeStats(allProfiles, range),
      computeStats(allProfiles, prevRange),
    ]);

    const key = metricKey(metric);

    // Calculate goal progress
    currentStats.forEach(a => {
      const goalsCount = Object.keys(goalsMap).length;
      if (goalsCount === 0) { a.goalProgress = 0; return; }
      let hit = 0;
      if (goalsMap.calls && a.callsMade >= goalsMap.calls) hit++;
      if (goalsMap.policies && a.policiesSold >= goalsMap.policies) hit++;
      if (goalsMap.appointments && a.appointmentsSet >= goalsMap.appointments) hit++;
      a.goalProgress = Math.round((hit / goalsCount) * 100);
    });

    // Sort and rank current
    currentStats.sort((a, b) => (b[key] as number) - (a[key] as number));
    currentStats.forEach((a, i) => { a.rank = i + 1; });

    // Sort and rank previous
    prevStats.sort((a, b) => (b[key] as number) - (a[key] as number));
    const prevRankMap = new Map<string, number>();
    prevStats.forEach((a, i) => { prevRankMap.set(a.id, i + 1); });

    currentStats.forEach(a => {
      a.prevRank = prevRankMap.get(a.id) ?? null;
    });

    // Detect which agents changed
    const changed = new Set<string>();
    currentStats.forEach(a => {
      const key = `${a.callsMade}-${a.policiesSold}-${a.appointmentsSet}-${a.talkTime}-${a.rank}`;
      const prev = prevAgentsRef.current.get(a.id);
      if (prev !== undefined && prev !== key) changed.add(a.id);
      prevAgentsRef.current.set(a.id, key);
    });
    if (changed.size > 0) {
      setChangedAgents(changed);
      setTimeout(() => setChangedAgents(new Set()), 1500);
    }

    setAgents(currentStats);
    setLoading(false);
  }, [period, metric, computeStats]);

  const fetchWins = useCallback(async () => {
    const { data } = await supabase.from("wins").select("*").order("created_at", { ascending: false }).limit(20);
    setWins((data || []) as Win[]);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchWins(); }, [fetchWins]);

  // Real-time subscriptions for calls, wins, and appointments
  useEffect(() => {
    const channel = supabase
      .channel("leaderboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => { fetchData(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "wins" }, () => { fetchWins(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => { fetchData(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchData, fetchWins]);

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
    if (rank === 1) return "md:order-2 md:-mb-4 md:pb-10";
    if (rank === 2) return "md:order-1";
    return "md:order-3";
  };

  const metalConfig = (rank: number) => {
    if (rank === 1) return { metal: "Gold", color: "from-yellow-300 to-yellow-500", trophyColor: "text-yellow-500", animate: "animate-trophy-shine" };
    if (rank === 2) return { metal: "Silver", color: "from-gray-200 to-gray-400", trophyColor: "text-gray-400", animate: "" };
    return { metal: "Bronze", color: "from-orange-300 to-orange-500", trophyColor: "text-orange-400", animate: "" };
  };

  const rankChangeIcon = (a: AgentStats) => {
    if (a.prevRank === null) return <Minus className="w-3 h-3 text-muted-foreground" />;
    if (a.prevRank > a.rank) return <ArrowUp className="w-3 h-3 text-success" />;
    if (a.prevRank < a.rank) return <ArrowDown className="w-3 h-3 text-destructive" />;
    return <Minus className="w-3 h-3 text-muted-foreground" />;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}
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
        </div>
      </div>

      {!hasData ? (
        /* Empty State */
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              {topAgents.map(a => {
                const mc = metalConfig(a.rank);
                const initials = `${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`;
                const displayName = `${a.first_name} ${a.last_name?.[0] || ""}.`;
                const val = formatMetricValue(metric, a[metricKey(metric)] as number);
                return (
                  <div
                    key={a.id}
                    onClick={() => openScorecard(a)}
                    className={`bg-card rounded-xl border p-6 text-center hover:shadow-lg transition-all cursor-pointer ${podiumOrder(a.rank)} ${a.id === user?.id ? "ring-2 ring-primary/30" : ""}`}
                  >
                    <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full mb-3 ${mc.animate}`}>
                      <Trophy className={`w-8 h-8 ${mc.trophyColor}`} />
                    </div>
                    <div className="w-16 h-16 rounded-full bg-primary/10 text-primary text-xl font-bold flex items-center justify-center mx-auto mb-3">{initials}</div>
                    <h3 className="font-bold text-foreground text-lg">{displayName}</h3>
                    <span className={`inline-block text-xs px-3 py-0.5 rounded-full font-medium mt-1 bg-gradient-to-r ${mc.color} text-foreground`}>#{a.rank} {mc.metal}</span>
                    <p className="text-3xl font-bold text-foreground mt-3">{val}</p>
                    <p className="text-xs text-muted-foreground">{metricLabel(metric)}</p>
                    <div className="flex justify-center gap-4 mt-3 text-xs text-muted-foreground">
                      <span>{a.callsMade} calls</span>
                      <span>{a.appointmentsSet} appts</span>
                    </div>
                    {a.goalProgress > 0 && (
                      <div className="mt-3">
                        <div className="w-full h-2 rounded-full bg-accent overflow-hidden">
                          <div className={`h-full rounded-full ${a.goalProgress >= 100 ? "bg-success" : a.goalProgress >= 70 ? "bg-primary" : "bg-warning"}`} style={{ width: `${Math.min(a.goalProgress, 100)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground mt-1">{a.goalProgress}% of goal</span>
                      </div>
                    )}
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
                      <th className="text-right py-3 font-medium">Goal</th>
                      <th className="text-right py-3 px-4 font-medium w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {restAgents.map(a => {
                      const initials = `${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`;
                      const displayName = `${a.first_name} ${a.last_name?.[0] || ""}.`;
                      const isMe = a.id === user?.id;
                      return (
                        <tr key={a.id} className={`border-b last:border-0 hover:bg-accent/30 transition-colors ${isMe ? "bg-primary/5 border-l-2 border-primary" : ""}`}>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1">
                              <span className="font-bold text-foreground">{a.rank}</span>
                              {rankChangeIcon(a)}
                            </div>
                          </td>
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{initials}</div>
                              <span className="font-medium text-foreground">{displayName}</span>
                            </div>
                          </td>
                          <td className="py-3 text-right text-foreground">{a.callsMade}</td>
                          <td className="py-3 text-right text-foreground font-medium">{a.policiesSold}</td>
                          <td className="py-3 text-right text-foreground hidden lg:table-cell">{a.appointmentsSet}</td>
                          <td className="py-3 text-right text-foreground hidden xl:table-cell">{(a.talkTime / 3600).toFixed(1)} hrs</td>
                          <td className="py-3 text-right text-foreground hidden lg:table-cell">{a.conversionRate.toFixed(1)}%</td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-accent overflow-hidden">
                                <div className={`h-full rounded-full ${a.goalProgress >= 50 ? "bg-success" : a.goalProgress >= 30 ? "bg-warning" : "bg-destructive"}`} style={{ width: `${Math.min(a.goalProgress, 100)}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground w-8 text-right">{a.goalProgress}%</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            {(isAdmin || isMe) && (
                              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => openScorecard(a)}>Scorecard</Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {restAgents.length === 0 && (
                      <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">All agents shown in podium above</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Win Feed */}
            <div className="bg-card rounded-xl border p-5">
              <h3 className="font-semibold text-foreground mb-4">🏆 Recent Wins</h3>
              {wins.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No wins yet. Get dialing and close some deals! 🦈</p>
              ) : (
                <div className="space-y-3">
                  {wins.map(w => {
                    const initials = (w.agent_name || "??").split(" ").map(c => c[0]).join("").slice(0, 2);
                    return (
                      <div key={w.id} className="flex items-start gap-3 pb-3 border-b last:border-0">
                        <div className="w-8 h-8 rounded-full bg-success/10 text-success text-xs font-bold flex items-center justify-center shrink-0">{initials}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground"><span className="font-medium">{w.agent_name || "Agent"}</span> closed {w.contact_name || "a deal"}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {w.campaign_name && <span className="text-xs bg-accent text-accent-foreground px-1.5 py-0.5 rounded">{w.campaign_name}</span>}
                            {w.policy_type && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{w.policy_type}</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(w.created_at), { addSuffix: true })}</p>
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
      />
    </div>
  );
};

export default Leaderboard;
