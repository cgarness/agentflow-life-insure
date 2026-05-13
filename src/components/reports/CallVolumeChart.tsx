import React, { useMemo } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Grouping, downloadCSV, ReportCallVolumeTimeseries } from "@/lib/reports-queries";
import ReportSection from "./ReportSection";
import { format, parseISO } from "date-fns";

interface Props {
  volume?: ReportCallVolumeTimeseries;
  grouping: Grouping;
  onGroupingChange: (g: Grouping) => void;
  loading: boolean;
}

const CallVolumeChart: React.FC<Props> = ({ volume, grouping, onGroupingChange, loading }) => {
  const data = useMemo(() => {
    if (!volume) return [];
    return (volume.by_date || []).map((d) => {
      let formattedName = d.date;
      try { formattedName = format(parseISO(d.date), "MMM d"); } catch (_) { /* fallback */ }
      return {
        name: formattedName,
        fullDate: d.date,
        calls: d.total,
        contacted: d.contacted,
        converted: d.converted,
      };
    });
  }, [volume]);

  const handleExport = () => {
    downloadCSV("call-volume-timeseries", ["Date", "Calls", "Contacted", "Converted"],
      data.map(d => [d.fullDate, String(d.calls), String(d.contacted), String(d.converted)]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-6 w-48 mb-4" /><Skeleton className="h-[280px]" /></div>;

  return (
    <ReportSection title="Call Volume Trends" onExport={handleExport}>
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
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
            <Bar yAxisId="left" dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Total Calls" />
            <Line yAxisId="left" type="monotone" dataKey="contacted" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 3 }} name="Contacted" />
            <Line yAxisId="left" type="monotone" dataKey="converted" stroke="hsl(var(--success))" strokeWidth={2} dot={{ r: 3 }} name="Converted" />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ReportSection>
  );
};

export default CallVolumeChart;
