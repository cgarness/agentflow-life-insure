import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCount, formatDuration } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import type { ReportDispositions } from "@/lib/reports-schemas";
import { cn } from "@/lib/utils";
import ReportSection from "./ReportSection";

type Tab = "disposition" | "distribution";
const TABS: { key: Tab; label: string }[] = [
  { key: "disposition", label: "By disposition" },
  { key: "distribution", label: "Distribution" },
];
const TOP_N = 10;

interface Props {
  dispositions: ReportDispositions;
  onExport?: ReportExportFn;
}

type DispositionRow = ReportDispositions["by_disposition"][number];

/** Call-weighted average of per-disposition averages; null when the group has no calls. */
function weightedAvg(rows: DispositionRow[]): number | null {
  const calls = rows.reduce((s, r) => s + r.calls, 0);
  if (calls === 0) return null;
  return rows.reduce((s, r) => s + r.avg_duration_seconds * r.calls, 0) / calls;
}

const tick = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
};
const textStyle = { color: "hsl(var(--foreground))" };

const CallDurationAnalysis: React.FC<Props> = ({ dispositions, onExport }) => {
  const [tab, setTab] = useState<Tab>("disposition");

  const { top, truncated, insight } = useMemo(() => {
    // Server order is calls DESC, so the first N rows are the top N by calls.
    const rows = dispositions.by_disposition;
    const convertAvg = weightedAvg(rows.filter((r) => r.converts));
    const otherAvg = weightedAvg(rows.filter((r) => !r.converts));
    return {
      top: rows.slice(0, TOP_N),
      truncated: rows.length > TOP_N,
      insight:
        convertAvg !== null && otherAvg !== null
          ? `Calls with a converting disposition averaged ${formatDuration(convertAvg)}, versus ${formatDuration(otherAvg)} for all other dispositions.`
          : null,
    };
  }, [dispositions]);

  const histogram = dispositions.duration_histogram;
  const empty = dispositions.total_calls === 0;

  const handleExport = onExport
    ? () => {
        if (tab === "disposition") {
          onExport(
            "Call Duration by Disposition",
            ["Disposition", "Calls", "Avg duration (s)"],
            dispositions.by_disposition.map((d) => [d.name, d.calls, d.avg_duration_seconds]),
          );
        } else {
          onExport("Call Duration Distribution", ["Range", "Calls"], histogram.map((h) => [h.range, h.calls]));
        }
      }
    : undefined;

  return (
    <ReportSection title="Call Duration" defaultOpen={false} onExport={handleExport}>
      {empty ? (
        <p className="text-sm text-muted-foreground text-center py-12">No calls in this period.</p>
      ) : (
        <>
          <div className="flex items-center gap-1.5 mb-5 p-1 bg-muted/60 rounded-xl w-fit" role="group" aria-label="Call duration view">
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

          {tab === "disposition" && (
            <>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">
                Average duration{truncated ? ` · top ${TOP_N} dispositions by calls` : ""}
              </p>
              <ResponsiveContainer width="100%" height={Math.max(200, top.length * 34)}>
                <BarChart data={top} layout="vertical" margin={{ left: 8, right: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={tick} tickFormatter={(v: number) => formatDuration(v)} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={tick} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={textStyle}
                    itemStyle={textStyle}
                    cursor={{ fill: "hsl(var(--muted))" }}
                    formatter={(v: number, _n: string, item: { payload?: DispositionRow }) => [
                      `${formatDuration(v)} across ${formatCount(item.payload?.calls ?? 0)} calls`,
                      "Avg duration",
                    ]}
                  />
                  <Bar dataKey="avg_duration_seconds" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Avg duration">
                    <LabelList
                      dataKey="avg_duration_seconds"
                      position="right"
                      formatter={(v: number) => formatDuration(v)}
                      fill="hsl(var(--foreground))"
                      fontSize={11}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {insight && <p className="text-xs text-muted-foreground mt-3 bg-primary/5 border border-primary/10 rounded-lg p-2.5">{insight}</p>}
            </>
          )}

          {tab === "distribution" && (
            <>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Calls by duration</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={histogram} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="range" tick={tick} />
                  <YAxis tick={tick} allowDecimals={false} width={40} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={textStyle}
                    itemStyle={textStyle}
                    cursor={{ fill: "hsl(var(--muted))" }}
                    formatter={(v: number) => [formatCount(v), "Calls"]}
                  />
                  <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Calls" />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}

          <p className="text-[11px] text-muted-foreground mt-3">Outbound calls; durations are carrier-timed.</p>
        </>
      )}
    </ReportSection>
  );
};

export default CallDurationAnalysis;
