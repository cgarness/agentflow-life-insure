import React, { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentProfile, getAgentName, downloadCSV } from "@/lib/reports-queries";
import ReportSection from "./ReportSection";

const LINE_COLORS = ["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))", "#8b5cf6", "#06b6d4"];

interface Props { scorecards: any[]; agents: AgentProfile[]; selectedAgent?: string; loading: boolean; }

const GoalTracking: React.FC<Props> = ({ scorecards, agents, selectedAgent, loading }) => {
  const { chartData, agentNames, consistency } = useMemo(() => {
    const nonAdmin = agents.filter(a => a.role?.toLowerCase() !== "admin");
    const filtered = selectedAgent ? scorecards.filter(s => s.agent_id === selectedAgent) : scorecards;

    // Group by week
    const byWeek = new Map<string, Map<string, number>>();
    filtered.forEach(sc => {
      const week = sc.week_start;
      if (!byWeek.has(week)) byWeek.set(week, new Map());
      const name = getAgentName(agents, sc.agent_id);
      const goalsHit = [sc.goal_calls_hit, sc.goal_policies_hit, sc.goal_appointments_hit].filter(Boolean).length;
      const totalGoals = 3;
      const pct = Math.round(goalsHit / totalGoals * 100);
      byWeek.get(week)!.set(name, pct);
    });

    const agentNames = selectedAgent
      ? [getAgentName(agents, selectedAgent)]
      : Array.from(new Set(filtered.map(s => getAgentName(agents, s.agent_id))));

    const chartData = Array.from(byWeek.entries())
      .map(([week, am]) => {
        const row: any = { week };
        agentNames.forEach(n => { row[n] = am.get(n) || 0; });
        return row;
      })
      .sort((a, b) => a.week.localeCompare(b.week))
      .slice(-12);

    // Consistency
    const consistency = nonAdmin.map(a => {
      const aSc = scorecards.filter(s => s.agent_id === a.id);
      const recentWeeks = aSc.slice(-12);
      const hittingWeeks = recentWeeks.filter(s => s.goal_calls_hit && s.goal_policies_hit && s.goal_appointments_hit).length;
      const pct = recentWeeks.length > 0 ? Math.round(hittingWeeks / recentWeeks.length * 100) : 0;
      return { name: getAgentName(agents, a.id), pct, weeks: recentWeeks.length };
    }).sort((a, b) => b.pct - a.pct);

    return { chartData, agentNames, consistency };
  }, [scorecards, agents, selectedAgent]);

  const handleExport = () => {
    downloadCSV("goal-tracking", ["Week", ...agentNames], chartData.map(d => [d.week, ...agentNames.map(n => `${d[n]}%`)]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-[300px]" /></div>;

  return (
    <ReportSection title="Goal Tracking Over Time" defaultOpen={false} onExport={handleExport}>
      {chartData.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No scorecard data available. Goals are tracked weekly in agent scorecards.</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
              <XAxis dataKey="week" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} unit="%" domain={[0, 100]} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
              {agentNames.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
              <ReferenceLine y={100} stroke="hsl(var(--success))" strokeDasharray="3 3" label={{ value: "Target", position: "right", fill: "hsl(var(--success))", fontSize: 10 }} />
              <ReferenceLine y={80} stroke="hsl(var(--warning))" strokeDasharray="3 3" />
              <ReferenceLine y={50} stroke="hsl(var(--destructive))" strokeDasharray="3 3" />
              {agentNames.map((name, i) => (
                <Line key={name} type="monotone" dataKey={name} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>

          <div className="mt-4 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Goal Consistency (last 12 weeks)</p>
            <div className="space-y-1.5">
              {consistency.slice(0, 10).map(c => (
                <div key={c.name} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate text-foreground font-medium">{c.name}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-accent overflow-hidden">
                    <div className={`h-full rounded-full ${c.pct >= 80 ? "bg-success" : c.pct >= 50 ? "bg-warning" : "bg-destructive"}`} style={{ width: `${c.pct}%` }} />
                  </div>
                  <span className="text-muted-foreground w-10 text-right">{c.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </ReportSection>
  );
};

export default GoalTracking;
