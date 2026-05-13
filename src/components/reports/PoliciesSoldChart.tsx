import React, { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, Trophy, User, Calendar, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Grouping, groupByDate, downloadCSV, ReportCallVolumeTimeseries, ReportCallSummary, AgentProfile } from "@/lib/reports-queries";
import ReportSection from "./ReportSection";

const LINE_COLORS = ["hsl(var(--success))", "hsl(var(--primary))", "hsl(var(--warning))", "hsl(var(--destructive))", "#8b5cf6", "#06b6d4", "#ec4899"];

interface Props {
  summary?: ReportCallSummary;
  volume?: ReportCallVolumeTimeseries;
  agents: AgentProfile[];
  grouping: Grouping;
  selectedAgent?: string;
  loading: boolean;
}

const PoliciesSoldChart: React.FC<Props> = ({ summary, volume, agents, grouping, selectedAgent, loading }) => {
  const { chartData, stats } = useMemo(() => {
    const grouped = new Map<string, number>();

    volume?.by_date?.forEach(d => {
      const dateKey = groupByDate(d.date, grouping);
      grouped.set(dateKey, (grouped.get(dateKey) || 0) + d.converted);
    });

    const chartData = Array.from(grouped.entries()).map(([date, converted]) => ({
      date,
      Total: converted,
    })).sort((a, b) => a.date.localeCompare(b.date));

    let topPerformer = { name: "N/A", count: 0 };
    let agentsWithSales = 0;
    summary?.calls_by_agent?.forEach(a => {
      if (a.converted > 0) agentsWithSales++;
      if (a.converted > topPerformer.count) {
        const ag = agents.find(ag => ag.id === a.agent_id);
        const name = ag ? `${ag.first_name} ${ag.last_name?.charAt(0) || ""}.` : "Unknown";
        topPerformer = { name, count: a.converted };
      }
    });

    let bestDay = { date: "N/A", count: 0 };
    volume?.by_date?.forEach(d => {
      if (d.converted > bestDay.count) bestDay = { date: d.date, count: d.converted };
    });

    let bestHour = { hour: 0, count: 0 };
    volume?.by_hour?.forEach(h => {
      if (h.converted > bestHour.count) bestHour = { hour: h.hour, count: h.converted };
    });

    const totalSold = summary?.converted || 0;

    return {
      chartData,
      stats: {
        total: totalSold,
        topPerformer,
        bestDay,
        bestHour,
        avgPerAgent: agentsWithSales > 0 ? +(totalSold / agentsWithSales).toFixed(1) : 0,
      },
    };
  }, [summary, volume, grouping, agents]);

  const handleExport = () => {
    downloadCSV("policies-sold", ["Date", "Total Sold"],
      chartData.map(d => [d.date, String(d.Total || 0)])
    );
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
            <Line type="monotone" dataKey="Total" stroke={LINE_COLORS[0]} strokeWidth={3} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
        {[
          { icon: TrendingUp, label: "Total Sold", value: String(stats.total) },
          { icon: Trophy, label: "Top Performer", value: `${stats.topPerformer.name} (${stats.topPerformer.count})` },
          { icon: User, label: "Avg/Agent", value: String(stats.avgPerAgent) },
          { icon: Calendar, label: "Best Day", value: stats.bestDay.count > 0 ? `${stats.bestDay.date} (${stats.bestDay.count})` : "N/A" },
          { icon: Clock, label: "Best Hour", value: stats.bestHour.count > 0 ? `${fmtHour(stats.bestHour.hour)} (${stats.bestHour.count})` : "N/A" },
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
