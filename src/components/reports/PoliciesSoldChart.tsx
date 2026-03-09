import React, { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Download, Trophy, TrendingUp, User, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentProfile, Grouping, groupByDate, downloadCSV } from "@/lib/reports-queries";

const LINE_COLORS = [
  "hsl(var(--success))", "hsl(var(--primary))", "hsl(var(--warning))",
  "hsl(var(--destructive))", "#8b5cf6", "#06b6d4", "#ec4899",
];

interface Props {
  calls: any[];
  agents: AgentProfile[];
  grouping: Grouping;
  selectedAgent?: string;
  loading: boolean;
}

const PoliciesSoldChart: React.FC<Props> = ({ calls, agents, grouping, selectedAgent, loading }) => {
  const { chartData, agentNames, summary } = useMemo(() => {
    const agentMap = new Map(agents.map(a => [a.id, `${a.first_name} ${a.last_name?.charAt(0) || ""}.`]));
    const soldCalls = calls.filter(c => {
      const dn = (c.disposition_name || "").toLowerCase();
      return dn.includes("sold") || dn.includes("policy");
    });

    const grouped = new Map<string, Map<string, number>>();
    const agentSales = new Map<string, number>();
    const daySales = new Map<string, number>();

    soldCalls.forEach(c => {
      const dateKey = groupByDate(c.started_at, grouping);
      const agentName = agentMap.get(c.agent_id) || "Unknown";
      if (!grouped.has(dateKey)) grouped.set(dateKey, new Map());
      const dateMap = grouped.get(dateKey)!;
      dateMap.set(agentName, (dateMap.get(agentName) || 0) + 1);
      agentSales.set(agentName, (agentSales.get(agentName) || 0) + 1);
      const dayKey = groupByDate(c.started_at, "daily");
      daySales.set(dayKey, (daySales.get(dayKey) || 0) + 1);
    });

    const allAgentNames = selectedAgent
      ? [agentMap.get(selectedAgent) || "Unknown"]
      : Array.from(new Set(soldCalls.map(c => agentMap.get(c.agent_id) || "Unknown")));

    const chartData = Array.from(grouped.entries())
      .map(([date, agents]) => {
        const row: any = { date };
        allAgentNames.forEach(n => { row[n] = agents.get(n) || 0; });
        return row;
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    let topPerformer = { name: "N/A", count: 0 };
    agentSales.forEach((count, name) => { if (count > topPerformer.count) topPerformer = { name, count }; });

    let bestDay = { date: "N/A", count: 0 };
    daySales.forEach((count, date) => { if (count > bestDay.count) bestDay = { date, count }; });

    const agentsWithSales = agentSales.size;
    const summary = {
      total: soldCalls.length,
      topPerformer,
      avgPerAgent: agentsWithSales > 0 ? +(soldCalls.length / agentsWithSales).toFixed(1) : 0,
      bestDay,
    };

    return { chartData, agentNames: allAgentNames, summary };
  }, [calls, agents, grouping, selectedAgent]);

  const handleExport = () => {
    downloadCSV("policies-sold", ["Date", ...agentNames], chartData.map(d => [d.date, ...agentNames.map(n => String(d[n] || 0))]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-6 w-48 mb-4" /><Skeleton className="h-[350px]" /></div>;

  return (
    <div className="bg-card rounded-xl border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground">Policies Sold</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport}><Download className="w-3.5 h-3.5" /></Button>
      </div>
      {chartData.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No policies sold in this period</p>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
            <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} allowDecimals={false} />
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
            {agentNames.length > 1 && <Legend />}
            {agentNames.map((name, i) => (
              <Line key={name} type="monotone" dataKey={name} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        {[
          { icon: TrendingUp, label: "Total Sold", value: String(summary.total) },
          { icon: Trophy, label: "Top Performer", value: `${summary.topPerformer.name} (${summary.topPerformer.count})` },
          { icon: User, label: "Avg Per Agent", value: String(summary.avgPerAgent) },
          { icon: Calendar, label: "Best Day", value: `${summary.bestDay.date} (${summary.bestDay.count})` },
        ].map(s => (
          <div key={s.label} className="bg-accent/50 rounded-lg p-3 text-center">
            <s.icon className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-sm font-bold text-foreground mt-0.5 truncate">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PoliciesSoldChart;
