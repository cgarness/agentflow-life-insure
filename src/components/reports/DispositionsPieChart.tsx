import React, { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCSV, ReportCallSummary, ReportDispositionBreakdown } from "@/lib/reports-queries";
import ReportSection from "./ReportSection";

interface Props {
  breakdown?: ReportDispositionBreakdown;
  summary?: ReportCallSummary;
  loading: boolean;
}

const DispositionsPieChart: React.FC<Props> = ({ breakdown, summary, loading }) => {
  const { pieData, funnel, totalCalls } = useMemo(() => {
    const pieData = (breakdown?.by_disposition || [])
      .map(d => ({
        name: d.disposition_name,
        value: d.count,
        color: d.color || "hsl(var(--primary))",
      }))
      .sort((a, b) => b.value - a.value);

    const total = summary?.total_calls || 0;
    const connected = summary?.contacted || 0;
    const sold = summary?.converted || 0;

    const funnel = [
      { stage: "Total Calls", value: total, pct: "100%" },
      { stage: "Contacted", value: connected, pct: total > 0 ? `${Math.round(connected / total * 100)}%` : "0%" },
      { stage: "Converted", value: sold, pct: connected > 0 ? `${Math.round(sold / connected * 100)}%` : "0%" },
    ];

    return { pieData, funnel, totalCalls: total };
  }, [breakdown, summary]);

  const handleExport = () => {
    downloadCSV("disposition-breakdown", ["Disposition", "Count", "%"],
      pieData.map(d => [d.name, String(d.value), `${totalCalls > 0 ? Math.round(d.value / totalCalls * 100) : 0}%`]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-6 w-48 mb-4" /><Skeleton className="h-[350px]" /></div>;

  return (
    <ReportSection title="Call Outcomes & Dispositions" onExport={handleExport}>
      {totalCalls === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No call data for this period</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Pie */}
          <div className="relative">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center"><p className="text-2xl font-bold text-foreground">{totalCalls}</p><p className="text-xs text-muted-foreground">calls</p></div>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {pieData.slice(0, 6).map(d => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="font-medium text-foreground">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Funnel */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground mb-2">Conversion Funnel</p>
            {funnel.map((f, i) => (
              <div key={f.stage} className="rounded-md bg-primary/5 py-2.5 px-3 flex items-center justify-between"
                style={{ width: `${Math.max(30, 100 - i * 18)}%`, marginLeft: `${i * 4}%` }}>
                <span className="text-xs font-medium text-foreground">{f.stage}</span>
                <span className="text-xs"><span className="font-bold text-foreground">{f.value}</span>{i > 0 && <span className="text-primary ml-1">({f.pct})</span>}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ReportSection>
  );
};

export default DispositionsPieChart;
