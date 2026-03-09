import React, { useMemo } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentProfile, Grouping, getAgentName, downloadCSV } from "@/lib/reports-queries";
import ReportSection from "./ReportSection";

interface Props {
  calls: any[];
  compCalls?: any[];
  agents: AgentProfile[];
  grouping: Grouping;
  onGroupingChange: (g: Grouping) => void;
  loading: boolean;
  comparing: boolean;
}

const CallVolumeChart: React.FC<Props> = ({ calls, compCalls, agents, grouping, onGroupingChange, loading, comparing }) => {
  const data = useMemo(() => {
    const build = (c: any[]) => {
      const byAgent = new Map<string, { calls: number; totalDur: number; connected: number }>();
      c.forEach(call => {
        const name = getAgentName(agents, call.agent_id);
        const cur = byAgent.get(name) || { calls: 0, totalDur: 0, connected: 0 };
        cur.calls++;
        cur.totalDur += (call.duration || 0);
        if ((call.duration || 0) > 0) cur.connected++;
        byAgent.set(name, cur);
      });
      return byAgent;
    };
    const primary = build(calls);
    const comp = compCalls ? build(compCalls) : null;
    const allNames = new Set([...primary.keys(), ...(comp ? comp.keys() : [])]);
    return Array.from(allNames).map(name => {
      const p = primary.get(name) || { calls: 0, totalDur: 0, connected: 0 };
      const c = comp?.get(name) || { calls: 0, totalDur: 0, connected: 0 };
      return {
        name,
        calls: p.calls,
        avgDuration: p.calls > 0 ? +(p.totalDur / p.calls / 60).toFixed(1) : 0,
        answerRate: p.calls > 0 ? Math.round(p.connected / p.calls * 100) : 0,
        compCalls: c.calls,
      };
    }).sort((a, b) => b.calls - a.calls);
  }, [calls, compCalls, agents]);

  const handleExport = () => {
    downloadCSV("call-volume-by-agent", ["Agent", "Calls", "Avg Duration (min)", "Answer Rate"],
      data.map(d => [d.name, String(d.calls), String(d.avgDuration), `${d.answerRate}%`]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-6 w-48 mb-4" /><Skeleton className="h-[280px]" /></div>;

  return (
    <ReportSection title="Call Volume by Agent" onExport={handleExport}>
      <div className="flex items-center gap-1 mb-3">
        {(["daily", "weekly", "monthly"] as Grouping[]).map(g => (
          <button key={g} onClick={() => onGroupingChange(g)}
            className={`px-2.5 py-1 text-xs rounded-md capitalize ${g === grouping ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}>
            {g}
          </button>
        ))}
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No call data for this period</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
            <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <YAxis yAxisId="left" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} unit=" min" />
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
              formatter={(value: any, name: string) => {
                if (name === "Avg Duration") return [`${value} min`, name];
                return [value, name];
              }}
            />
            <Bar yAxisId="left" dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Calls" />
            {comparing && <Bar yAxisId="left" dataKey="compCalls" fill="hsl(var(--primary)/0.3)" radius={[4, 4, 0, 0]} name="Previous" />}
            <Line yAxisId="right" type="monotone" dataKey="avgDuration" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 3 }} name="Avg Duration" />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ReportSection>
  );
};

export default CallVolumeChart;
