import React, { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCSV, formatDuration, ReportDispositionBreakdown } from "@/lib/reports-queries";
import ReportSection from "./ReportSection";

interface Props { breakdown?: ReportDispositionBreakdown; loading: boolean; }

const CallDurationAnalysis: React.FC<Props> = ({ breakdown, loading }) => {
  const [view, setView] = useState<"histogram" | "byDisp">("histogram");

  const { byDisposition, histogram, insight } = useMemo(() => {
    if (!breakdown) return { byDisposition: [], histogram: [], insight: "" };

    const formatted = (breakdown.by_disposition || [])
      .map(d => ({
        name: d.disposition_name,
        avgDuration: Math.round(d.avg_duration || 0),
        count: d.count,
        color: d.color
      }))
      .sort((a, b) => b.avgDuration - a.avgDuration);

    const soldAvg = formatted.find(d => d.name.toLowerCase().includes("sold"));
    const niAvg = formatted.find(d => d.name.toLowerCase().includes("not interested"));
    
    let insightStr = "";
    if (soldAvg && niAvg && niAvg.avgDuration > 0) {
      const ratio = (soldAvg.avgDuration / niAvg.avgDuration).toFixed(1);
      insightStr = `Sold calls average ${formatDuration(soldAvg.avgDuration)} — ${ratio}x longer than Not Interested calls (${formatDuration(niAvg.avgDuration)})`;
    }

    const hist = breakdown.duration_histogram || [];

    return { byDisposition: formatted, histogram: hist, insight: insightStr };
  }, [breakdown]);

  const handleExport = () => {
    if (view === "byDisp") {
      downloadCSV("call-duration-by-disposition", ["Disposition", "Avg Duration", "Count"], 
        byDisposition.map(d => [d.name, formatDuration(d.avgDuration), String(d.count)])
      );
    } else {
      downloadCSV("call-duration-histogram", ["Range", "Count"], 
        histogram.map(h => [h.range, String(h.count)])
      );
    }
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-[280px]" /></div>;

  return (
    <ReportSection title="Call Duration Analysis" defaultOpen={false} onExport={handleExport}>
      <div className="flex items-center gap-1 mb-3">
        {[{ k: "histogram", l: "Distribution" }, { k: "byDisp", l: "By Disposition" }].map(v => (
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
          {byDisposition.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No disposition data for this period</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={Math.max(200, byDisposition.length * 30)}>
                <BarChart data={byDisposition} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                  <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} unit="s" />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                    formatter={(v: number, name: string) => {
                      if (name === "avgDuration") return [formatDuration(v), "Avg Duration"];
                      return [v, name];
                    }} 
                  />
                  <Bar dataKey="avgDuration" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="avgDuration" />
                </BarChart>
              </ResponsiveContainer>
              {insight && <p className="text-xs text-muted-foreground mt-2 bg-primary/5 rounded-lg p-2.5">💡 {insight}</p>}
            </>
          )}
        </>
      )}
    </ReportSection>
  );
};

export default CallDurationAnalysis;
