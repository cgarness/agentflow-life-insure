import React, { useState, useEffect } from "react";
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
  conversionRate: number;
}

const AgentScorecardModal: React.FC<Props> = ({ open, onOpenChange, agent, badges = [] }) => {
  const { profile } = useAuth();
  const isAdmin = profile?.role?.toLowerCase() === "admin" || profile?.role?.toLowerCase() === "team leader";
  const [weekOffset, setWeekOffset] = useState(0);
  const [stats, setStats] = useState<WeekStats>({ callsMade: 0, policiesSold: 0, appointmentsSet: 0, talkTime: 0, conversionRate: 0 });
  const [goals, setGoals] = useState<Record<string, number>>({});
  const [trendData, setTrendData] = useState<{ week: string; calls: number; policies: number }[]>([]);
  const [coachingNotes, setCoachingNotes] = useState("");
  const [originalNotes, setOriginalNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const weekStart = startOfWeek(subWeeks(now, weekOffset), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

  useEffect(() => {
    if (!open || !agent) return;
    fetchWeekStats();
    fetchGoals();
    fetchTrend();
    fetchCoachingNotes();
  }, [open, agent, weekOffset]);

  const fetchWeekStats = async () => {
    if (!agent) return;
    const ws = startOfDay(weekStart).toISOString();
    const we = new Date(weekEnd.getTime() + 86400000 - 1).toISOString();

    const [callsRes, apptsRes] = await Promise.all([
      supabase.from("calls").select("disposition_name, duration").eq("agent_id", agent.id).gte("started_at", ws).lte("started_at", we),
      supabase.from("appointments").select("id").eq("created_by", agent.id).gte("created_at", ws).lte("created_at", we),
    ]);

    const calls = callsRes.data || [];
    const callsMade = calls.length;
    const policiesSold = calls.filter(c => c.disposition_name && (/sold/i.test(c.disposition_name) || /policy/i.test(c.disposition_name))).length;
    const talkTime = calls.reduce((s, c) => s + (c.duration && c.duration > 0 ? c.duration : 0), 0);
    const appointmentsSet = (apptsRes.data || []).length;
    const conversionRate = callsMade > 0 ? (policiesSold / callsMade) * 100 : 0;

    setStats({ callsMade, policiesSold, appointmentsSet, talkTime, conversionRate });
  };

  const fetchGoals = async () => {
    const { data } = await supabase.from("goals").select("metric, target_value");
    if (data) {
      const m: Record<string, number> = {};
      data.forEach(g => { m[g.metric] = g.target_value; });
      setGoals(m);
    }
  };

  const fetchTrend = async () => {
    if (!agent) return;
    const weeks: { week: string; calls: number; policies: number }[] = [];
    for (let i = 3; i >= 0; i--) {
      const ws = startOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
      const we = endOfWeek(ws, { weekStartsOn: 1 });
      const { data } = await supabase.from("calls").select("disposition_name").eq("agent_id", agent.id).gte("started_at", startOfDay(ws).toISOString()).lte("started_at", new Date(we.getTime() + 86400000 - 1).toISOString());
      const c = data || [];
      weeks.push({
        week: format(ws, "MMM d"),
        calls: c.length,
        policies: c.filter(x => x.disposition_name && (/sold/i.test(x.disposition_name) || /policy/i.test(x.disposition_name))).length,
      });
    }
    setTrendData(weeks);
  };

  const fetchCoachingNotes = async () => {
    if (!agent) return;
    const wsStr = format(weekStart, "yyyy-MM-dd");
    const { data } = await supabase.from("agent_scorecards").select("coaching_notes").eq("agent_id", agent.id).eq("week_start", wsStr).maybeSingle();
    const notes = data?.coaching_notes || "";
    setCoachingNotes(notes);
    setOriginalNotes(notes);
  };

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
        conversion_rate: stats.conversionRate,
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
    { label: "Conversion Rate", value: stats.conversionRate, metric: "conversion", display: `${stats.conversionRate.toFixed(1)}%` },
    { label: "Goal Progress", value: 0, metric: "goal", isGoal: true },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center">{initials}</div>
              <div>
                <DialogTitle>{displayName}</DialogTitle>
                <p className="text-xs text-muted-foreground">
                  {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => w + 1)}><ChevronLeft className="w-4 h-4" /></Button>
              <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)} className="text-xs">This Week</Button>
              <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => Math.max(0, w - 1))} disabled={weekOffset === 0}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
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
                <div key={s.label} className="bg-accent/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-xl font-bold text-foreground">{totalGoals > 0 ? `${pct}%` : "—"}</p>
                  {totalGoals > 0 && (
                    <div className="w-full h-1.5 rounded-full bg-accent mt-1 overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  )}
                </div>
              );
            }
            const hit = goalHit(s.metric, s.value);
            const target = goals[s.metric];
            return (
              <div key={s.label} className="bg-accent/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-xl font-bold text-foreground">{s.display ?? s.value}</p>
                  {hit === true && <CheckCircle2 className="w-4 h-4 text-success" />}
                  {hit === false && <XCircle className="w-4 h-4 text-destructive" />}
                </div>
                {target && <p className="text-xs text-muted-foreground">Goal: {target}</p>}
              </div>
            );
          })}
        </div>

        {/* 4-week trend */}
        <div className="mt-4">
          <h4 className="text-sm font-medium text-foreground mb-2">4-Week Trend</h4>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData}>
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={30} />
                <ReTooltip />
                <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} name="Calls" />
                <Bar dataKey="policies" fill="hsl(var(--success, 142 76% 36%))" radius={[3, 3, 0, 0]} name="Policies" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Coaching Notes */}
        {isAdmin && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-foreground mb-2">Coaching Notes</h4>
            <Textarea
              value={coachingNotes}
              onChange={e => setCoachingNotes(e.target.value)}
              placeholder="Write coaching notes for this agent..."
              rows={3}
            />
            <div className="flex justify-end mt-2">
              <Button size="sm" onClick={saveCoachingNotes} disabled={saving || coachingNotes === originalNotes}>
                {saving ? "Saving..." : "Save Notes"}
              </Button>
            </div>
          </div>
        )}

        {!isAdmin && coachingNotes && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-foreground mb-2">Coaching Notes</h4>
            <div className="bg-accent/50 rounded-lg p-3 text-sm text-foreground whitespace-pre-wrap">{coachingNotes}</div>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" disabled><Mail className="w-4 h-4 mr-1" /> Send Scorecard</Button>
              </TooltipTrigger>
              <TooltipContent>Email sending coming soon</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" disabled><FileDown className="w-4 h-4 mr-1" /> Download PDF</Button>
              </TooltipTrigger>
              <TooltipContent>PDF export coming soon</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AgentScorecardModal;
