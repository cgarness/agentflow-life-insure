import React, { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from "recharts";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentProfile, Grouping, groupByDate, downloadCSV } from "@/lib/reports-queries";

interface Props {
  calls: any[];
  agents: AgentProfile[];
  grouping: Grouping;
  onGroupingChange: (g: Grouping) => void;
  loading: boolean;
}

const CallVolumeChart: React.FC<Props> = ({ calls, agents, grouping, onGroupingChange, loading }) => {
  const data = useMemo(() => {
    const agentMap = new Map(agents.map(a => [a.id, `${a.first_name} ${a.last_name?.charAt(0) || ""}.`]));
    const byAgent = new Map<string, { calls: number; totalDur: number }>();
    calls.forEach(c => {
      const name = agentMap.get(c.agent_id) || "Unknown";
      const cur = byAgent.get(name) || { calls: 0, totalDur: 0 };
      cur.calls++;
      cur.totalDur += (c.duration || 0);
      byAgent.set(name, cur);
    });
    return Array.from(byAgent.entries())
      .map(([name, v]) => ({ name, calls: v.calls, avgDuration: v.calls > 0 ? +(v.totalDur / v.calls / 60).toFixed(1) : 0 }))
      .sort((a, b) => b.calls - a.calls);
  }, [calls, agents]);

  const handleExport = () => {
    downloadCSV("call-volume-by-agent", ["Agent", "Calls", "Avg Duration (min)"], data.map(d => [d.name, String(d.calls), String(d.avgDuration)]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-6 w-48 mb-4" /><Skeleton className="h-[280px]" /></div>;

  return (
    <div className="bg-card rounded-xl border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground">Call Volume by Agent</h3>
        <div className="flex items-center gap-2">
          {(["daily", "weekly", "monthly"] as Grouping[]).map(g => (
            <button key={g} onClick={() => onGroupingChange(g)} className={`px-2.5 py-1 text-xs rounded-md capitalize ${g === grouping ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}>{g}</button>
          ))}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport}><Download className="w-3.5 h-3.5" /></Button>
        </div>
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
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
            <Bar yAxisId="left" dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Total Calls" />
            <Line yAxisId="right" type="monotone" dataKey="avgDuration" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 3 }} name="Avg Duration (min)" />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

export default CallVolumeChart;
