import React, { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, Mail, FileDown, X } from "lucide-react";
import { Badge as BadgeType } from "./useLeaderboardBadges";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { startOfWeek, endOfWeek, subWeeks, format, startOfDay } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip as ReTooltip } from "recharts";

interface AgentData {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AgentData | null;
  badges?: BadgeType[];
}

interface WeekStats {
  callsMade: number;
  policiesSold: number;
  appointmentsSet: number;
  talkTime: number;
  premiumSold: number;
}

const AgentScorecardModal: React.FC<Props> = ({ open, onOpenChange, agent, badges = [] }) => {
  const { profile } = useAuth();
  const isAdmin = profile?.role?.toLowerCase() === "admin" || profile?.role?.toLowerCase() === "team leader";
  const [weekOffset, setWeekOffset] = useState(0);
  const [stats, setStats] = useState<WeekStats>({ callsMade: 0, policiesSold: 0, appointmentsSet: 0, talkTime: 0, premiumSold: 0 });
  const [goals, setGoals] = useState<Record<string, number>>({});
  const [trendData, setTrendData] = useState<{ week: string; calls: number; policies: number }[]>([]);
  const [coachingNotes, setCoachingNotes] = useState("");
  const [originalNotes, setOriginalNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const weekStart = startOfWeek(subWeeks(now, weekOffset), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

  const fetchWeekStats = useCallback(async () => {
    if (!agent) return;
    const ws = startOfDay(weekStart).toISOString();
    const we = new Date(weekEnd.getTime() + 86400000 - 1).toISOString();

    const [callsRes, apptsRes, winsRes] = await Promise.all([
      supabase.from("calls").select("disposition_name, duration").eq("agent_id", agent.id).gte("started_at", ws).lte("started_at", we),
      supabase.from("appointments").select("id").eq("created_by", agent.id).gte("created_at", ws).lte("created_at", we),
      supabase.from("wins").select("id, premium_amount").eq("agent_id", agent.id).gte("created_at", ws).lte("created_at", we),
    ]);

    const calls = callsRes.data || [];
    const callsMade = calls.length;
    const wins = winsRes.data || [];
    const policiesSold = wins.length;
    const premiumSold = wins.reduce((sum, w: any) => sum + (Number(w.premium_amount) || 0), 0);
    const talkTime = calls.reduce((s, c) => s + (c.duration && c.duration > 0 ? c.duration : 0), 0);
    const appointmentsSet = (apptsRes.data || []).length;

    setStats({ callsMade, policiesSold, appointmentsSet, talkTime, premiumSold });
  }, [agent, weekStart, weekEnd]);

  const fetchGoals = useCallback(async () => {
    // Scorecard is weekly view, so fetch weekly goals
    const { data } = await supabase.from("goals").select("metric, target_value").eq("period", "weekly");
    if (data) {
      const m: Record<string, number> = {};
      data.forEach(g => { 
        const key = g.metric.replace(/^(daily_|weekly_|monthly_)/, "");
        m[key] = g.target_value; 
      });
      setGoals(m);
    }
  }, []);

  const fetchTrend = useCallback(async () => {
    if (!agent) return;
    const trendNow = new Date();
    const weeks: { week: string; calls: number; policies: number }[] = [];
    for (let i = 3; i >= 0; i--) {
      const ws = startOfWeek(subWeeks(trendNow, i), { weekStartsOn: 1 });
      const we = endOfWeek(ws, { weekStartsOn: 1 });
      const [callsRes, winsRes] = await Promise.all([
        supabase.from("calls").select("id").eq("agent_id", agent.id).gte("started_at", startOfDay(ws).toISOString()).lte("started_at", new Date(we.getTime() + 86400000 - 1).toISOString()),
        supabase.from("wins").select("id").eq("agent_id", agent.id).gte("created_at", startOfDay(ws).toISOString()).lte("created_at", new Date(we.getTime() + 86400000 - 1).toISOString()),
      ]);
      
      weeks.push({
        week: format(ws, "MMM d"),
        calls: (callsRes.data || []).length,
        policies: (winsRes.data || []).length,
      });
    }
    setTrendData(weeks);
  }, [agent]);

  const fetchCoachingNotes = useCallback(async () => {
    if (!agent) return;
    const wsStr = format(weekStart, "yyyy-MM-dd");
    const { data } = await supabase.from("agent_scorecards").select("coaching_notes").eq("agent_id", agent.id).eq("week_start", wsStr).maybeSingle();
    const notes = data?.coaching_notes || "";
    setCoachingNotes(notes);
    setOriginalNotes(notes);
  }, [agent, weekStart]);

  useEffect(() => {
    if (!open || !agent) return;
    fetchWeekStats();
    fetchGoals();
    fetchTrend();
    fetchCoachingNotes();
  }, [open, agent, weekOffset, fetchWeekStats, fetchGoals, fetchTrend, fetchCoachingNotes]);

  const saveCoachingNotes = async () => {
    if (!agent) return;
    setSaving(true);
    const wsStr = format(weekStart, "yyyy-MM-dd");
    const weStr = format(weekEnd, "yyyy-MM-dd");

    const { data: existing } = await supabase.from("agent_scorecards").select("id").eq("agent_id", agent.id).eq("week_start", wsStr).maybeSingle();

    if (existing) {
      await supabase.from("agent_scorecards").update({ coaching_notes: coachingNotes }).eq("id", existing.id);
    } else {
      await supabase.from("agent_scorecards").insert({
        agent_id: agent.id,
        week_start: wsStr,
        week_end: weStr,
        coaching_notes: coachingNotes,
        calls_made: stats.callsMade,
        policies_sold: stats.policiesSold,
        appointments_set: stats.appointmentsSet,
        talk_time: stats.talkTime,
        conversion_rate: stats.premiumSold, // Reusing column for premium for now as per "replace" requirement
      });
    }
    setOriginalNotes(coachingNotes);
    setSaving(false);
    toast.success("Coaching notes saved");
  };

  const formatTalkTime = (seconds: number) => {
    const hrs = seconds / 3600;
    return `${hrs.toFixed(1)} hrs`;
  };

  const goalHit = (metric: string, value: number) => {
    const target = goals[metric];
    if (!target) return null;
    return value >= target;
  };

  if (!agent) return null;
  const initials = `${agent.first_name?.[0] || ""}${agent.last_name?.[0] || ""}`;
  const displayName = `${agent.first_name} ${agent.last_name?.[0] || ""}.`;

  const statItems = [
    { label: "Calls Made", value: stats.callsMade, metric: "calls" },
    { label: "Policies Sold", value: stats.policiesSold, metric: "policies" },
    { label: "Appointments Set", value: stats.appointmentsSet, metric: "appointments" },
    { label: "Talk Time", value: stats.talkTime, metric: "talk_time", display: formatTalkTime(stats.talkTime) },
    { label: "Premium Sold", value: stats.premiumSold, metric: "premium", display: `$${stats.premiumSold.toLocaleString()}` },
    { label: "Goal Progress", value: 0, metric: "goal", isGoal: true },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0A0A0B]/95 glass-card border-white/10 rounded-[2rem] p-0 overflow-hidden shadow-2xl">
        <div className="absolute top-4 right-4 z-50">
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-8 pb-4 border-b border-white/5 bg-gradient-to-br from-white/[0.03] to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/60 text-white font-bold text-2xl flex items-center justify-center shadow-lg border border-white/10">{initials}</div>
              <div>
                <DialogTitle className="text-2xl font-black uppercase italic tracking-tight">{displayName}</DialogTitle>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                  <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
                    {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-white/5 p-1 rounded-xl border border-white/5">
              <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => w + 1)} className="hover:bg-white/10 h-8 w-8"><ChevronLeft className="w-4 h-4" /></Button>
              <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)} className="text-[10px] font-bold uppercase tracking-widest px-3 h-8 hover:bg-white/10">This Week</Button>
              <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => Math.max(0, w - 1))} disabled={weekOffset === 0} className="hover:bg-white/10 h-8 w-8"><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        </div>

        <div className="p-8 space-y-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {statItems.map(s => {
              if (s.isGoal) {
                const totalGoals = Object.keys(goals).length;
                const goalsHit = [
                  goalHit("calls", stats.callsMade),
                  goalHit("policies", stats.policiesSold),
                  goalHit("appointments", stats.appointmentsSet),
                ].filter(v => v === true).length;
                const pct = totalGoals > 0 ? Math.round((goalsHit / totalGoals) * 100) : 0;
                return (
                  <div key={s.label} className="bg-white/5 border border-white/5 rounded-2xl p-4 transition-all hover:bg-white/[0.08]">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{s.label}</p>
                    <p className="text-2xl font-black text-foreground">{totalGoals > 0 ? `${pct}%` : "—"}</p>
                    {totalGoals > 0 && (
                      <div className="w-full h-1.5 rounded-full bg-white/10 mt-2 overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    )}
                  </div>
                );
              }
              const hit = goalHit(s.metric, s.value);
              const target = goals[s.metric];
              return (
                <div key={s.label} className="bg-white/5 border border-white/5 rounded-2xl p-4 transition-all hover:bg-white/[0.08]">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{s.label}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-black text-foreground">{s.display ?? s.value}</p>
                    {hit === true && <CheckCircle2 className="w-4 h-4 text-success" />}
                    {hit === false && <XCircle className="w-4 h-4 text-destructive" />}
                  </div>
                  {target && (
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase">Goal:</span>
                      <span className="text-[10px] font-black text-primary uppercase">{target}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Achievements / Badges */}
          {badges.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 italic">Active Achievements</h4>
              <div className="flex flex-wrap gap-2">
                {badges.map(b => (
                  <TooltipProvider key={b.id} delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border bg-white/5 backdrop-blur-sm ${b.color.split(' ').filter(c => c.startsWith('border-') || c.startsWith('text-')).join(' ')}`}>
                          <span className="scale-125">{b.icon}</span>
                          {b.label}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="bg-popover/90 backdrop-blur-md border-white/10 rounded-lg"><p className="text-xs font-bold uppercase">{b.description}</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
            </div>
          )}

          {/* 4-week trend */}
          <div>
            <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4 italic">4-Week Performance Trend</h4>
            <div className="h-44 bg-white/5 rounded-2xl p-4 border border-white/5">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData}>
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#888888", fontWeight: "bold" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#888888", fontWeight: "bold" }} axisLine={false} tickLine={false} width={30} />
                  <ReTooltip 
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    contentStyle={{ backgroundColor: 'rgba(10,10,11,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '12px' }}
                    labelStyle={{ color: '#fff', fontWeight: 'bold', marginBottom: '4px' }}
                  />
                  <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Calls Made" barSize={32} />
                  <Bar dataKey="policies" fill="#10b981" radius={[4, 4, 0, 0]} name="Policies Sold" barSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Coaching Notes */}
          {isAdmin && (
            <div className="bg-white/5 rounded-2xl p-6 border border-white/5">
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 italic">Coaching & Leadership Notes</h4>
              <Textarea
                value={coachingNotes}
                onChange={e => setCoachingNotes(e.target.value)}
                placeholder="Strategize for next week..."
                className="bg-black/20 border-white/10 rounded-xl focus:ring-primary/20 min-h-[100px] text-sm"
              />
              <div className="flex justify-end mt-4">
                <Button 
                  size="sm" 
                  onClick={saveCoachingNotes} 
                  disabled={saving || coachingNotes === originalNotes}
                  className="rounded-xl px-6 font-bold uppercase tracking-widest text-[10px] shadow-lg shadow-primary/20"
                >
                  {saving ? "Deploying..." : "Update Strategy"}
                </Button>
              </div>
            </div>
          )}

          {!isAdmin && coachingNotes && (
            <div className="bg-primary/5 rounded-2xl p-6 border border-primary/10">
              <h4 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-3 italic">Coaching Insights</h4>
              <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed italic">{coachingNotes}</div>
            </div>
          )}

          <div className="flex gap-3 pb-4">
            <Button variant="outline" size="sm" disabled className="flex-1 rounded-xl border-white/10 bg-white/5 h-10 font-bold uppercase tracking-widest text-[10px] opacity-50"><Mail className="w-3.5 h-3.5 mr-2" /> Dispatch Email</Button>
            <Button variant="outline" size="sm" disabled className="flex-1 rounded-xl border-white/10 bg-white/5 h-10 font-bold uppercase tracking-widest text-[10px] opacity-50"><FileDown className="w-3.5 h-3.5 mr-2" /> Export Intel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AgentScorecardModal;
