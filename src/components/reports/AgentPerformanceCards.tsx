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
    <div className="flex gap-4 overflow-x-auto pb-6 scrollbar-hide">
      {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-56 shrink-0 rounded-[2rem]" />)}
    </div>
  );


  if (agentStats.length === 0) return null;

  return (
  return (
    <div className="flex gap-5 overflow-x-auto pb-6 scrollbar-hide -mx-2 px-2">
      {agentStats.map(a => (
        <button key={a.id}
          onClick={() => onSelectAgent(selectedAgent === a.id ? "" : a.id)}
          className={cn(
            "shrink-0 w-60 rounded-[2rem] border p-6 text-left transition-all duration-500 group relative overflow-hidden",
            selectedAgent === a.id 
              ? "border-primary bg-primary/[0.03] shadow-2xl shadow-primary/10 ring-1 ring-primary/20 scale-[1.02] z-10" 
              : "bg-white dark:bg-slate-950 border-slate-200/50 dark:border-slate-800/50 hover:border-primary/30 hover:shadow-xl hover:shadow-slate-200/50 dark:hover:shadow-none hover:-translate-y-1"
          )}>
          {selectedAgent === a.id && (
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-primary/10 to-transparent pointer-events-none" />
          )}
          
          <div className="flex items-center gap-4 mb-5 relative z-10">
            <div className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-black transition-all duration-500 group-hover:scale-110 shadow-sm",
              selectedAgent === a.id 
                ? "bg-primary text-primary-foreground shadow-primary/20" 
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 group-hover:bg-primary/10 group-hover:text-primary"
            )}>
              {a.initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn(
                "text-base font-extrabold truncate transition-colors",
                selectedAgent === a.id ? "text-primary" : "text-slate-900 dark:text-slate-100"
              )}>{a.name}</p>
              {a.streak > 0 && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-orange-600 dark:text-orange-400">{a.streak}d streak</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-5 relative z-10">
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Today</p>
              <div className="flex items-baseline gap-1">
                <p className="text-xl font-black text-slate-900 dark:text-slate-100 leading-none">{a.callsToday}</p>
                <span className="text-[10px] font-bold text-slate-400">calls</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Monthly</p>
              <div className="flex items-baseline gap-1">
                <p className="text-xl font-black text-slate-900 dark:text-slate-100 leading-none">{a.policiesMonth}</p>
                <span className="text-[10px] font-bold text-slate-400">sold</span>
              </div>
            </div>
          </div>

          <div className="space-y-2 relative z-10">
            <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
              <span className={selectedAgent === a.id ? "text-primary/70" : "text-slate-400"}>Daily Goal</span>
              <span className={cn(
                selectedAgent === a.id ? "text-primary" : "text-slate-600 dark:text-slate-400"
              )}>{a.goalPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-900 overflow-hidden border border-slate-200/20 dark:border-slate-800/20 shadow-inner">
              <div 
                className={cn(
                  "h-full rounded-full transition-all duration-1000 ease-out relative", 
                  a.goalPct >= 100 ? "bg-emerald-500" : a.goalPct >= 80 ? "bg-primary" : a.goalPct >= 50 ? "bg-amber-500" : "bg-rose-500"
                )} 
                style={{ width: `${a.goalPct}%` }} 
              >
                <div className="absolute inset-0 bg-white/20 blur-[2px] opacity-50" />
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>

  );
};

export default AgentPerformanceCards;
