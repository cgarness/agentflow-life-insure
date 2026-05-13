import React, { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentProfile, ReportCallSummary } from "@/lib/reports-queries";
import { cn } from "@/lib/utils";

interface Props {
  summary?: ReportCallSummary;
  agents: AgentProfile[];
  goals: any[];
  selectedAgent: string;
  onSelectAgent: (id: string) => void;
  loading: boolean;
}

const AgentPerformanceCards: React.FC<Props> = ({ summary, agents, goals, selectedAgent, onSelectAgent, loading }) => {
  const nonAdmin = useMemo(() => agents, [agents]);

  const agentStats = useMemo(() => {
    if (!summary) return [];

    return nonAdmin.map(agent => {
      const agentData = summary.calls_by_agent.find(a => a.agent_id === agent.id) || {
        total: 0,
        contacted: 0,
        converted: 0,
      };

      // Goal progress (simplified)
      const callGoal = goals.find(g => g.metric === "calls" && g.period === "daily");
      const goalTarget = callGoal?.target_value || 50;
      // Since period could be anything, goalPct is just relative to the data. 
      // If we don't know the days, we just do a rough pct or cap it at 100.
      const goalPct = Math.min(100, Math.round(agentData.total / goalTarget * 100));

      return {
        id: agent.id,
        name: `${agent.first_name} ${agent.last_name?.charAt(0) || ""}.`,
        initials: `${agent.first_name?.charAt(0) || ""}${agent.last_name?.charAt(0) || ""}`,
        callsPeriod: agentData.total,
        policiesPeriod: agentData.converted,
        goalPct,
      };
    });
  }, [nonAdmin, summary, goals]);

  if (loading) return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-48 shrink-0 rounded-xl" />)}
    </div>
  );

  if (agentStats.length === 0) return null;

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
      {agentStats.map(a => (
        <button key={a.id}
          onClick={() => onSelectAgent(selectedAgent === a.id ? "" : a.id)}
          className={cn(
            "shrink-0 w-48 rounded-2xl border p-4 text-left transition-all duration-200 group",
            selectedAgent === a.id 
              ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20" 
              : "bg-card border-slate-200/60 dark:border-slate-800/60 hover:border-primary/40 hover:shadow-md"
          )}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary transition-transform group-hover:scale-105">
              {a.initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{a.name}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Calls</p>
              <p className="text-base font-black text-foreground leading-none mt-1">{a.callsPeriod}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Sold</p>
              <p className="text-base font-black text-foreground leading-none mt-1">{a.policiesPeriod}</p>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div 
              className={cn(
                "h-full rounded-full transition-all duration-1000 ease-out", 
                a.goalPct >= 80 ? "bg-emerald-500" : a.goalPct >= 50 ? "bg-amber-500" : "bg-rose-500"
              )} 
              style={{ width: `${a.goalPct}%` }} 
            />
          </div>
        </button>
      ))}
    </div>
  );
};

export default AgentPerformanceCards;
