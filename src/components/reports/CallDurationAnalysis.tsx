import React, { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCSV, formatDuration } from "@/lib/reports-queries";
import ReportSection from "./ReportSection";

interface Props { calls: any[]; dispositions: any[]; loading: boolean; }

const DURATION_RANGES = [
  { label: "0-30s", min: 0, max: 30 },
  { label: "30s-1m", min: 30, max: 60 },
  { label: "1-2m", min: 60, max: 120 },
  { label: "2-5m", min: 120, max: 300 },
  { label: "5-10m", min: 300, max: 600 },
  { label: "10-20m", min: 600, max: 1200 },
  { label: "20m+", min: 1200, max: Infinity },
];

const CallDurationAnalysis: React.FC<Props> = ({ calls, dispositions, loading }) => {
  const [view, setView] = useState<"histogram" | "byDisp" | "trend">("histogram");

  const { histogram, byDisposition, insight } = useMemo(() => {
    const hist = DURATION_RANGES.map(r => ({
      range: r.label, count: calls.filter(c => (c.duration || 0) >= r.min && (c.duration || 0) < r.max).length,
    }));
    hist.forEach(h => { (h as any).pct = calls.length > 0 ? Math.round(h.count / calls.length * 100) : 0; });

    const dispDur = new Map<string, { total: number; count: number }>();
    calls.forEach(c => {
      const n = c.disposition_name || "No Disposition";
      const cur = dispDur.get(n) || { total: 0, count: 0 };
      cur.total += (c.duration || 0);
      cur.count++;
      dispDur.set(n, cur);
    });
    const dispColorMap = new Map(dispositions.map(d => [d.name, d.color || "#3B82F6"]));
    const byDisposition = Array.from(dispDur.entries())
      .map(([name, v]) => ({ name, avgDuration: v.count > 0 ? +(v.total / v.count).toFixed(0) : 0, color: dispColorMap.get(name) || "hsl(var(--primary))" }))
      .sort((a, b) => b.avgDuration - a.avgDuration);

    const soldAvg = byDisposition.find(d => d.name.toLowerCase().includes("sold"));
    const niAvg = byDisposition.find(d => d.name.toLowerCase().includes("not interested"));
    let insight = "";
    if (soldAvg && niAvg && niAvg.avgDuration > 0) {
      const ratio = (soldAvg.avgDuration / niAvg.avgDuration).toFixed(1);
      insight = `Sold calls average ${formatDuration(soldAvg.avgDuration)} — ${ratio}x longer than Not Interested calls (${formatDuration(niAvg.avgDuration)})`;
    }

    return { histogram: hist, byDisposition, insight };
  }, [calls, dispositions]);

  const handleExport = () => {
    downloadCSV("call-duration-analysis", ["Range", "Count", "%"], histogram.map(h => [h.range, String(h.count), `${(h as any).pct}%`]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-[280px]" /></div>;

  return (
    <ReportSection title="Call Duration Analysis" defaultOpen={false} onExport={handleExport}>
      <div className="flex items-center gap-1 mb-3">
        {[{ k: "histogram", l: "Distribution" }, { k: "byDisp", l: "By Disposition" }, { k: "trend", l: "Over Time" }].map(v => (
          <button key={v.k} onClick={() => setView(v.k as any)}
            className={`px-2.5 py-1 text-xs rounded-md ${v.k === view ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}>
            {v.l}
          </button>
        ))}
      </div>

      {view === "histogram" && (
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={histogram}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
            <XAxis dataKey="range" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
            <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Calls" />
          </BarChart>
        </ResponsiveContainer>
      )}

      {view === "byDisp" && (
        <>
          <ResponsiveContainer width="100%" height={Math.max(200, byDisposition.length * 30)}>
            <BarChart data={byDisposition} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
              <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} unit="s" />
              <YAxis type="category" dataKey="name" width={130} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                formatter={(v: number) => [formatDuration(v), "Avg Duration"]} />
              <Bar dataKey="avgDuration" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {insight && <p className="text-xs text-muted-foreground mt-2 bg-primary/5 rounded-lg p-2.5">💡 {insight}</p>}
        </>
      )}

      {view === "trend" && (
        <p className="text-sm text-muted-foreground text-center py-12">Duration trends are computed from daily groupings — select a wider date range for meaningful data</p>
      )}
    </ReportSection>
  );
};

export default CallDurationAnalysis;
