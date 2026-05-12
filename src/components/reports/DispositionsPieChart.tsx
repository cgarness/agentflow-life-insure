import React, { useMemo, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCSV, Grouping, groupByDate } from "@/lib/reports-queries";
import ReportSection from "./ReportSection";

interface Props {
  calls: any[];
  dispositions: any[];
  grouping: Grouping;
  loading: boolean;
}

const DispositionsPieChart: React.FC<Props> = ({ calls, dispositions, grouping, loading }) => {
  const [showTrend, setShowTrend] = useState(false);

  const { pieData, funnel, totalCalls, trendData, trendNames } = useMemo(() => {
    const dispMap = new Map(dispositions.map(d => [d.name, d.color || "#3B82F6"]));
    const counts = new Map<string, number>();
    let connected = 0, positive = 0, sold = 0;

    // Trend data
    const byDateDisp = new Map<string, Map<string, number>>();

    calls.forEach(c => {
      const name = c.disposition_name || "No Disposition";
      counts.set(name, (counts.get(name) || 0) + 1);
      if ((c.duration || 0) > 0) connected++;
      const dn = (c.disposition_name || "").toLowerCase();
      if (dn.includes("sold") || dn.includes("interested") || dn.includes("appointment")) positive++;
      if (dn.includes("sold") || dn.includes("policy")) sold++;

      if (c.started_at) {
        const dateKey = groupByDate(c.started_at, grouping);
        if (!byDateDisp.has(dateKey)) byDateDisp.set(dateKey, new Map());
        const dm = byDateDisp.get(dateKey)!;
        dm.set(name, (dm.get(name) || 0) + 1);
      }
    });

    const total = calls.length;
    const pieData = Array.from(counts.entries())
      .map(([name, value]) => ({ name, value, color: dispMap.get(name) || "hsl(var(--primary))" }))
      .sort((a, b) => b.value - a.value);

    const funnel = [
      { stage: "Total Calls", value: total, pct: "100%" },
      { stage: "Connected", value: connected, pct: total > 0 ? `${Math.round(connected / total * 100)}%` : "0%" },
      { stage: "Positive Outcome", value: positive, pct: connected > 0 ? `${Math.round(positive / connected * 100)}%` : "0%" },
      { stage: "Sold", value: sold, pct: positive > 0 ? `${Math.round(sold / positive * 100)}%` : "0%" },
    ];

    const topDisps = pieData.slice(0, 5).map(d => d.name);
    const trendData = Array.from(byDateDisp.entries()).map(([date, dm]) => {
      const totalForDate = Array.from(dm.values()).reduce((s, v) => s + v, 0);
      const row: any = { date };
      topDisps.forEach(n => { row[n] = totalForDate > 0 ? +((dm.get(n) || 0) / totalForDate * 100).toFixed(1) : 0; });
      return row;
    }).sort((a, b) => a.date.localeCompare(b.date));

    return { pieData, funnel, totalCalls: total, trendData, trendNames: topDisps };
  }, [calls, dispositions, grouping]);

  const handleExport = () => {
    downloadCSV("disposition-breakdown", ["Disposition", "Count", "%"],
      pieData.map(d => [d.name, String(d.value), `${totalCalls > 0 ? Math.round(d.value / totalCalls * 100) : 0}%`]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-6 w-48 mb-4" /><Skeleton className="h-[350px]" /></div>;

  const TREND_COLORS = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6"];

  return (
    <ReportSection title="Call Outcomes & Dispositions" onExport={handleExport}>
      {totalCalls === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No call data for this period</p>
      ) : (
        <>
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
              <div className="flex flex-wrap gap-2.5 mt-4">
                {pieData.slice(0, 6).map(d => (
                   <div key={d.name} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider bg-slate-50 dark:bg-slate-900/50 px-2 py-1 rounded-lg border border-slate-200/50 dark:border-slate-800/50">
                    <span className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: d.color }} />
                    <span className="text-slate-500 dark:text-slate-400">{d.name}</span>
                    <span className="text-slate-900 dark:text-slate-100">{d.value}</span>
                  </div>
                ))}
              </div>

            </div>
            {/* Funnel */}
            <div className="space-y-2">
              <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-4">Conversion Funnel</p>
              {funnel.map((f, i) => (
                <div key={f.stage} className="rounded-2xl bg-gradient-to-r from-primary/10 to-transparent py-3.5 px-5 flex items-center justify-between border border-primary/5 shadow-sm transition-all hover:scale-[1.02] duration-300"
                  style={{ width: `${Math.max(40, 100 - i * 15)}%`, marginLeft: `${i * 3}%` }}>
                  <span className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-tight">{f.stage}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-slate-900 dark:text-slate-100">{f.value}</span>
                    {i > 0 && <span className="text-[10px] font-black text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">{f.pct}</span>}
                  </div>
                </div>
              ))}
            </div>

          </div>

          {/* Disposition Trends */}
          <div className="mt-4 border-t pt-4">
            <button onClick={() => setShowTrend(t => !t)} className="text-xs text-primary hover:underline mb-3">
              {showTrend ? "Hide" : "Show"} Disposition Trends Over Time
            </button>
            {showTrend && trendData.length > 0 && (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} unit="%" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
                  <Legend />
                  {trendNames.map((n, i) => (
                    <Line key={n} type="monotone" dataKey={n} stroke={TREND_COLORS[i % TREND_COLORS.length]} strokeWidth={1.5} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </ReportSection>
  );
};

export default DispositionsPieChart;
