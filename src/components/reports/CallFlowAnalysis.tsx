import React, { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { parseISO } from "date-fns";
import { downloadCSV, isSoldDisposition } from "@/lib/reports-queries";
import { Lightbulb } from "lucide-react";
import ReportSection from "./ReportSection";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtHour = (h: number) => `${h > 12 ? h - 12 : h || 12}${h >= 12 ? "PM" : "AM"}`;

interface Props { calls: any[]; campaignLeads: any[]; loading: boolean; }

const CallFlowAnalysis: React.FC<Props> = ({ calls, campaignLeads, loading }) => {
  const [view, setView] = useState<"hourly" | "daily" | "firstVsFollow" | "speed">("hourly");

  const { hourlyData, dailyData, firstVsFollow, speedInsight } = useMemo(() => {
    // By hour
    const hourBuckets = Array.from({ length: 16 }, (_, i) => ({ hour: i + 6, calls: 0, answered: 0, sold: 0 }));
    calls.forEach(c => {
      const h = parseISO(c.started_at).getHours();
      if (h >= 6 && h <= 21) {
        const b = hourBuckets[h - 6];
        b.calls++;
        if ((c.duration || 0) > 0) b.answered++;
        if (isSoldDisposition(c.disposition_name)) b.sold++;
      }
    });
    const hourlyData = hourBuckets.map(b => ({
      hour: fmtHour(b.hour), calls: b.calls,
      answerRate: b.calls > 0 ? Math.round(b.answered / b.calls * 100) : 0,
    }));

    // By day
    const dayBuckets = DAYS.map(d => ({ day: d, calls: 0, answered: 0, sold: 0 }));
    calls.forEach(c => {
      const dow = parseISO(c.started_at).getDay();
      dayBuckets[dow].calls++;
      if ((c.duration || 0) > 0) dayBuckets[dow].answered++;
      if (isSoldDisposition(c.disposition_name)) dayBuckets[dow].sold++;
    });
    const dailyData = dayBuckets.map(b => ({
      day: b.day, calls: b.calls,
      convRate: b.calls > 0 ? +(b.sold / b.calls * 100).toFixed(1) : 0,
    }));

    // First vs follow-up
    const first = campaignLeads.filter(l => (l.call_attempts || 0) === 1);
    const follow = campaignLeads.filter(l => (l.call_attempts || 0) > 1);
    const firstVsFollow = {
      first: { count: first.length, label: "First Call" },
      follow: { count: follow.length, label: "Follow-Up" },
    };

    // Speed to lead
    const speedInsight = "Leads called within 1 hour typically have higher conversion rates";

    return { hourlyData, dailyData, firstVsFollow, speedInsight };
  }, [calls, campaignLeads]);

  const handleExport = () => {
    if (view === "hourly") downloadCSV("calls-by-hour", ["Hour", "Calls", "Answer%"], hourlyData.map(d => [d.hour, String(d.calls), `${d.answerRate}%`]));
    else if (view === "daily") downloadCSV("calls-by-day", ["Day", "Calls", "Conv%"], dailyData.map(d => [d.day, String(d.calls), `${d.convRate}%`]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-[280px]" /></div>;

  return (
    <ReportSection title="Call Flow Analysis" defaultOpen={false} onExport={handleExport}>
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {[{ k: "hourly", l: "By Hour" }, { k: "daily", l: "By Day" }, { k: "firstVsFollow", l: "First vs Follow-Up" }, { k: "speed", l: "Speed to Lead" }].map(v => (
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

      {view === "firstVsFollow" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-accent/50 rounded-lg p-4 text-center">
            <p className="text-xs text-muted-foreground">First Calls</p>
            <p className="text-2xl font-bold text-foreground">{firstVsFollow.first.count}</p>
          </div>
          <div className="bg-accent/50 rounded-lg p-4 text-center">
            <p className="text-xs text-muted-foreground">Follow-Up Calls</p>
            <p className="text-2xl font-bold text-foreground">{firstVsFollow.follow.count}</p>
          </div>
        </div>
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
