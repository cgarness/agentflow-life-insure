import React, { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { TrendingUp, Trophy, User, Calendar, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentProfile, Grouping, groupByDate, downloadCSV, getAgentName, isSoldDisposition } from "@/lib/reports-queries";
import { parseISO } from "date-fns";
import ReportSection from "./ReportSection";

const LINE_COLORS = ["hsl(var(--success))", "hsl(var(--primary))", "hsl(var(--warning))", "hsl(var(--destructive))", "#8b5cf6", "#06b6d4", "#ec4899"];

interface Props {
  calls: any[];
  compCalls?: any[];
  agents: AgentProfile[];
  grouping: Grouping;
  selectedAgent?: string;
  loading: boolean;
  comparing: boolean;
}

const PoliciesSoldChart: React.FC<Props> = ({ calls, compCalls, agents, grouping, selectedAgent, loading, comparing }) => {
  const { chartData, agentNames, summary } = useMemo(() => {
    const soldCalls = calls.filter(c => isSoldDisposition(c.disposition_name));
    const grouped = new Map<string, Map<string, number>>();
    const agentSales = new Map<string, number>();
    const daySales = new Map<string, number>();
    const hourSales = new Map<number, number>();

    soldCalls.forEach(c => {
      const dateKey = groupByDate(c.started_at, grouping);
      const agentName = getAgentName(agents, c.agent_id);
      if (!grouped.has(dateKey)) grouped.set(dateKey, new Map());
      grouped.get(dateKey)!.set(agentName, (grouped.get(dateKey)!.get(agentName) || 0) + 1);
      agentSales.set(agentName, (agentSales.get(agentName) || 0) + 1);
      const dayKey = groupByDate(c.started_at, "daily");
      daySales.set(dayKey, (daySales.get(dayKey) || 0) + 1);
      const hour = parseISO(c.started_at).getHours();
      hourSales.set(hour, (hourSales.get(hour) || 0) + 1);
    });

    const allAgentNames = selectedAgent
      ? [getAgentName(agents, selectedAgent)]
      : Array.from(new Set(soldCalls.map(c => getAgentName(agents, c.agent_id))));

    const chartData = Array.from(grouped.entries()).map(([date, am]) => {
      const row: any = { date };
      allAgentNames.forEach(n => { row[n] = am.get(n) || 0; });
      return row;
    }).sort((a, b) => a.date.localeCompare(b.date));

    let topPerformer = { name: "N/A", count: 0 };
    agentSales.forEach((count, name) => { if (count > topPerformer.count) topPerformer = { name, count }; });
    let bestDay = { date: "N/A", count: 0 };
    daySales.forEach((count, date) => { if (count > bestDay.count) bestDay = { date, count }; });
    let bestHour = { hour: 0, count: 0 };
    hourSales.forEach((count, hour) => { if (count > bestHour.count) bestHour = { hour, count }; });

    const agentsWithSales = agentSales.size;
    return {
      chartData, agentNames: allAgentNames,
      summary: {
        total: soldCalls.length,
        topPerformer, bestDay, bestHour,
        avgPerAgent: agentsWithSales > 0 ? +(soldCalls.length / agentsWithSales).toFixed(1) : 0,
      },
    };
  }, [calls, agents, grouping, selectedAgent]);

  const handleExport = () => {
    downloadCSV("policies-sold", ["Date", ...agentNames], chartData.map(d => [d.date, ...agentNames.map(n => String(d[n] || 0))]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-6 w-48 mb-4" /><Skeleton className="h-[350px]" /></div>;

  const fmtHour = (h: number) => `${h > 12 ? h - 12 : h || 12}${h >= 12 ? "PM" : "AM"}`;

  return (
    <ReportSection title="Policies Sold" onExport={handleExport}>
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
        {[
          { icon: TrendingUp, label: "Total Sold", value: String(summary.total) },
          { icon: Trophy, label: "Top Performer", value: `${summary.topPerformer.name} (${summary.topPerformer.count})` },
          { icon: User, label: "Avg/Agent", value: String(summary.avgPerAgent) },
          { icon: Calendar, label: "Best Day", value: `${summary.bestDay.date} (${summary.bestDay.count})` },
          { icon: Clock, label: "Best Hour", value: `${fmtHour(summary.bestHour.hour)} (${summary.bestHour.count})` },
          { icon: Clock, label: "Avg Deal Cycle", value: "N/A" },
        ].map(s => (
          <div key={s.label} className="bg-accent/50 rounded-lg p-3 text-center">
            <s.icon className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
            <p className="text-xs font-bold text-foreground mt-0.5 truncate">{s.value}</p>
          </div>
        ))}
      </div>
    </ReportSection>
  );
};

export default PoliciesSoldChart;
