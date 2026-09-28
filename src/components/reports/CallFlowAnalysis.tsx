import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCount, formatRate, ratio, timeZoneLabel } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import type { ReportVolume } from "@/lib/reports-schemas";
import { cn } from "@/lib/utils";
import ReportSection from "./ReportSection";

type Tab = "hour" | "day";
const TABS: { key: Tab; label: string }[] = [
  { key: "hour", label: "By hour" },
  { key: "day", label: "By day" },
];

interface Props {
  volume: ReportVolume;
  onExport?: ReportExportFn;
}

interface Row {
  label: string;
  calls: number;
  contacted: number;
  /** Contact rate in percent, null when no calls were made in the bucket. */
  rate: number | null;
}

const fmtHour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

function toRow(label: string, calls: number, contacted: number): Row {
  const r = ratio(contacted, calls);
  return { label, calls, contacted, rate: r === null ? null : Math.round(r * 1000) / 10 };
}

const tick = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
};
const textStyle = { color: "hsl(var(--foreground))" };

const CallFlowAnalysis: React.FC<Props> = ({ volume, onExport }) => {
  const [tab, setTab] = useState<Tab>("hour");

  const { hourly, daily, empty } = useMemo(() => {
    const byHour = [...volume.by_hour].sort((a, b) => a.hour - b.hour);
    const outside = byHour.some((h) => h.calls_made > 0 && (h.hour < 6 || h.hour > 21));
    const shownHours = outside ? byHour : byHour.filter((h) => h.hour >= 6 && h.hour <= 21);
    const byDay = [...volume.by_day_of_week].sort((a, b) => a.dow - b.dow);
    return {
      hourly: shownHours.map((h) => toRow(fmtHour(h.hour), h.calls_made, h.contacted)),
      daily: byDay.map((d) => toRow(d.dow_name, d.calls_made, d.contacted)),
      empty: byHour.every((h) => h.calls_made === 0),
    };
  }, [volume]);

  const rows = tab === "hour" ? hourly : daily;

  const handleExport = onExport
    ? () =>
        onExport(
          tab === "hour" ? "Call Flow by Hour" : "Call Flow by Day",
          [tab === "hour" ? "Hour" : "Day", "Calls made", "Contacted", "Contact rate %"],
          rows.map((r) => [r.label, r.calls, r.contacted, r.rate]),
        )
    : undefined;

  return (
    <ReportSection title="Call Flow" defaultOpen={false} onExport={handleExport}>
      {empty ? (
        <p className="text-sm text-muted-foreground text-center py-12">No outbound calls in this period.</p>
      ) : (
        <>
          <div className="flex items-center gap-1.5 mb-5 p-1 bg-muted/60 rounded-xl w-fit" role="group" aria-label="Call flow grouping">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={t.key === tab}
                onClick={() => setTab(t.key)}
                className={cn(
                  "px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all",
                  t.key === tab ? "bg-card text-primary shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Calls made</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rows} syncId="call-flow" margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={tick} interval="preserveStartEnd" />
              <YAxis tick={tick} allowDecimals={false} width={40} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={textStyle}
                itemStyle={textStyle}
                cursor={{ fill: "hsl(var(--muted))" }}
                formatter={(v: number) => [formatCount(v), "Calls made"]}
              />
              <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Calls made" />
            </BarChart>
          </ResponsiveContainer>

          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-5 mb-2">Contact rate</p>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={rows} syncId="call-flow" margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={tick} interval="preserveStartEnd" />
              <YAxis tick={tick} domain={[0, 100]} unit="%" width={40} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={textStyle}
                itemStyle={textStyle}
                formatter={(v: number | null) => [formatRate(v), "Contact rate"]}
              />
              <Line
                type="monotone"
                dataKey="rate"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 3, fill: "hsl(var(--primary))" }}
                connectNulls={false}
                name="Contact rate"
              />
            </LineChart>
          </ResponsiveContainer>

          <p className="text-[11px] text-muted-foreground mt-3">
            Contact rate is contacted calls divided by calls made; buckets with no calls show no rate.{" "}
            {tab === "hour" ? "Hours" : "Days"} are in the agency time zone:{" "}
            {timeZoneLabel(volume.window.time_zone, volume.window.time_zone_source)}.
          </p>
        </>
      )}
    </ReportSection>
  );
};

export default CallFlowAnalysis;
