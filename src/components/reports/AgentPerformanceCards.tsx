import React, { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentProfile, isSoldDisposition, DateRange } from "@/lib/reports-queries";
import { startOfDay, isToday, startOfMonth, endOfMonth, subDays, parseISO, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";

interface Props {
  calls: any[];
  agents: AgentProfile[];
  goals: any[];
  selectedAgent: string;
  onSelectAgent: (id: string) => void;
  loading: boolean;
}

const AgentPerformanceCards: React.FC<Props> = ({ calls, agents, goals, selectedAgent, onSelectAgent, loading }) => {
  const nonAdmin = useMemo(() => agents, [agents]);

  const agentStats = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now).toISOString();
    const monthStart = startOfMonth(now).toISOString();
    const monthEnd = endOfMonth(now).toISOString();

    return nonAdmin.map(agent => {
      const agentCalls = calls.filter(c => c.agent_id === agent.id);
      const todayCalls = agentCalls.filter(c => c.started_at >= todayStart);
      const monthCalls = agentCalls.filter(c => c.started_at >= monthStart && c.started_at <= monthEnd);
      const monthSold = monthCalls.filter(c => isSoldDisposition(c.disposition_name)).length;

      // Streak: consecutive days with calls
      const callDates = new Set(agentCalls.map(c => startOfDay(parseISO(c.started_at)).toISOString()));
      let streak = 0;
      for (let i = 0; i < 60; i++) {
        const d = startOfDay(subDays(now, i)).toISOString();
        if (callDates.has(d)) streak++;
        else if (i > 0) break; // Allow today to be missing
      }

      // Goal progress (simplified)
      const callGoal = goals.find(g => g.metric === "calls" && g.period === "daily");
      const goalTarget = callGoal?.target_value || 50;
      const goalPct = Math.min(100, Math.round(todayCalls.length / goalTarget * 100));

      return {
        id: agent.id,
        name: `${agent.first_name} ${agent.last_name?.charAt(0) || ""}.`,
        initials: `${agent.first_name?.charAt(0) || ""}${agent.last_name?.charAt(0) || ""}`,
        callsToday: todayCalls.length,
        policiesMonth: monthSold,
        goalPct,
        streak: streak >= 5 ? streak : 0,
      };
    });
  }, [nonAdmin, calls, goals]);

  if (loading) return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-48 shrink-0 rounded-xl" />)}
    </div>
  );

  if (agentStats.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
      {agentStats.map(a => (
        <button key={a.id}
          onClick={() => onSelectAgent(selectedAgent === a.id ? "" : a.id)}
          className={cn(
            "shrink-0 w-44 rounded-xl border p-3 text-left transition-all hover:shadow-md",
            selectedAgent === a.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-card hover:border-primary/40"
          )}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">{a.initials}</div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{a.name}</p>
              {a.streak > 0 && <span className="text-[10px] text-warning">🔥 {a.streak}d streak</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div><p className="text-[10px] text-muted-foreground">Today</p><p className="text-sm font-bold text-foreground">{a.callsToday}</p></div>
            <div><p className="text-[10px] text-muted-foreground">Sold/mo</p><p className="text-sm font-bold text-foreground">{a.policiesMonth}</p></div>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-accent overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", a.goalPct >= 80 ? "bg-success" : a.goalPct >= 50 ? "bg-warning" : "bg-destructive")} style={{ width: `${a.goalPct}%` }} />
          </div>
        </button>
      ))}
    </div>
  );
};

export default AgentPerformanceCards;
