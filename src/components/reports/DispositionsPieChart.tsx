import React, { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCSV } from "@/lib/reports-queries";

interface Props {
  calls: any[];
  dispositions: any[];
  loading: boolean;
}

const DispositionsPieChart: React.FC<Props> = ({ calls, dispositions, loading }) => {
  const { pieData, funnel, totalCalls } = useMemo(() => {
    const dispMap = new Map(dispositions.map(d => [d.name, d.color || "#3B82F6"]));
    const counts = new Map<string, number>();
    let connected = 0;
    let positive = 0;
    let sold = 0;

    calls.forEach(c => {
      const name = c.disposition_name || "No Disposition";
      counts.set(name, (counts.get(name) || 0) + 1);
      if ((c.duration || 0) > 0) connected++;
      const dn = (c.disposition_name || "").toLowerCase();
      if (dn.includes("sold") || dn.includes("interested") || dn.includes("appointment")) positive++;
      if (dn.includes("sold") || dn.includes("policy")) sold++;
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

    return { pieData, funnel, totalCalls: total };
  }, [calls, dispositions]);

  const handleExport = () => {
    downloadCSV("disposition-breakdown", ["Disposition", "Count", "Percentage"],
      pieData.map(d => [d.name, String(d.value), `${totalCalls > 0 ? Math.round(d.value / totalCalls * 100) : 0}%`]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-6 w-48 mb-4" /><Skeleton className="h-[350px]" /></div>;

  return (
    <div className="bg-card rounded-xl border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground">Call Outcomes & Dispositions</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport}><Download className="w-3.5 h-3.5" /></Button>
      </div>
      {totalCalls === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No call data for this period</p>
      ) : (
        <>
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
              <div className="text-center">
                <p className="text-2xl font-bold text-foreground">{totalCalls}</p>
                <p className="text-xs text-muted-foreground">calls</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-3 mb-4">
            {pieData.slice(0, 6).map(d => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                <span className="text-muted-foreground">{d.name}</span>
                <span className="font-medium text-foreground">{d.value}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Conversion Funnel</p>
            {funnel.map((f, i) => (
              <div key={f.stage} className="rounded-md bg-primary/5 py-2 px-3 flex items-center justify-between" style={{ width: `${Math.max(30, 100 - i * 20)}%`, marginLeft: `${i * 4}%` }}>
                <span className="text-xs font-medium text-foreground">{f.stage}</span>
                <span className="text-xs"><span className="font-bold text-foreground">{f.value}</span>{i > 0 && <span className="text-primary ml-1">({f.pct})</span>}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default DispositionsPieChart;
