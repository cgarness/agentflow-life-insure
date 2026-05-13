import React, { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCSV, ReportCallVolumeTimeseries } from "@/lib/reports-queries";
import { Lightbulb } from "lucide-react";
import ReportSection from "./ReportSection";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtHour = (h: number) => `${h > 12 ? h - 12 : h || 12}${h >= 12 ? "PM" : "AM"}`;

interface Props { volume?: ReportCallVolumeTimeseries; loading: boolean; }

const CallFlowAnalysis: React.FC<Props> = ({ volume, loading }) => {
  const [view, setView] = useState<"hourly" | "daily" | "speed">("hourly");

  const { hourlyData, dailyData, speedInsight } = useMemo(() => {
    // By hour (pad missing hours between 6 and 21)
    const hourBuckets = Array.from({ length: 16 }, (_, i) => {
      const h = i + 6;
      const data = volume?.by_hour?.find(x => x.hour === h) || { total: 0, contacted: 0 };
      return {
        hour: fmtHour(h),
        calls: data.total,
        answerRate: data.total > 0 ? Math.round(data.contacted / data.total * 100) : 0,
      };
    });

    // By day (0-6)
    const dayBuckets = DAYS.map((d, i) => {
      const data = volume?.by_day_of_week?.find(x => x.dow === i) || { total: 0, converted: 0 };
      return {
        day: d,
        calls: data.total,
        convRate: data.total > 0 ? +(data.converted / data.total * 100).toFixed(1) : 0,
      };
    });

    // Speed to lead
    const speedInsight = "Leads called within 1 hour typically have higher conversion rates";

    return { hourlyData: hourBuckets, dailyData: dayBuckets, speedInsight };
  }, [volume]);

  const handleExport = () => {
    if (view === "hourly") downloadCSV("calls-by-hour", ["Hour", "Calls", "Answer%"], hourlyData.map(d => [d.hour, String(d.calls), `${d.answerRate}%`]));
    else if (view === "daily") downloadCSV("calls-by-day", ["Day", "Calls", "Conv%"], dailyData.map(d => [d.day, String(d.calls), `${d.convRate}%`]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-[280px]" /></div>;

  return (
    <ReportSection title="Call Flow Analysis" defaultOpen={false} onExport={handleExport}>
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {[{ k: "hourly", l: "By Hour" }, { k: "daily", l: "By Day" }, { k: "speed", l: "Speed to Lead" }].map(v => (
          <button key={v.k} onClick={() => setView(v.k as any)}
            className={`px-2.5 py-1 text-xs rounded-md ${v.k === view ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}>
            {v.l}
          </button>
        ))}
      </div>

      {view === "hourly" && (
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={hourlyData}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
            <XAxis dataKey="hour" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
            <YAxis yAxisId="left" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} unit="%" />
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
            <Bar yAxisId="left" dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Calls" />
            <Line yAxisId="right" type="monotone" dataKey="answerRate" stroke="hsl(var(--success))" strokeWidth={2} dot={{ r: 2 }} name="Answer Rate" />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {view === "daily" && (
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={dailyData}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
            <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} unit="%" />
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
            <Bar yAxisId="left" dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Calls" />
            <Line yAxisId="right" type="monotone" dataKey="convRate" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 2 }} name="Conv Rate" />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {view === "speed" && (
        <div className="bg-primary/5 rounded-lg p-4 flex items-start gap-2">
          <Lightbulb className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-foreground">{speedInsight}</p>
        </div>
      )}
    </ReportSection>
  );
};

export default CallFlowAnalysis;
