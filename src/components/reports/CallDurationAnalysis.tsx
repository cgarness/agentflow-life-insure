import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCount, formatElapsed } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import type { ReportDispositions } from "@/lib/reports-schemas";
import { BAR_GRID, CHART_THEME, CHART_TICK, DIAGNOSTIC_TOOLTIP, SERIES_COLOR } from "./reportChartTheme";
import ReportSection from "./ReportSection";
import ReportSegmented from "./ReportSegmented";

type Tab = "disposition" | "distribution";
const TABS: ReadonlyArray<readonly [Tab, string]> = [["disposition", "By disposition"], ["distribution", "Distribution"]];
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
          ? `Calls with a converting disposition averaged ${formatElapsed(convertAvg, 1)}, versus ${formatElapsed(otherAvg, 1)} for all other dispositions.`
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
    <ReportSection title="Call duration" defaultOpen={false} onExport={handleExport}>
      {empty ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No outbound calls in this period.</p>
      ) : (
        <>
          <ReportSegmented ariaLabel="Call duration view" value={tab} onChange={(next) => setTab(next)} options={TABS} className="mb-4" />

          {tab === "disposition" && (
            <>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Average duration{truncated ? ` · top ${TOP_N} by calls` : ""}
              </p>
              <ResponsiveContainer width="100%" height={Math.max(200, top.length * 34)}>
                <BarChart data={top} layout="vertical" margin={{ left: 8, right: 72 }}>
                  <CartesianGrid {...BAR_GRID} />
                  <XAxis type="number" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }}
                    tickFormatter={(v: number) => formatElapsed(v)} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={CHART_TICK} tickLine={false} axisLine={false} />
                  <Tooltip
                    {...DIAGNOSTIC_TOOLTIP}
                    formatter={(v: number, _n: string, item: { payload?: DispositionRow }) => [
                      `${formatElapsed(v, 1)} across ${formatCount(item.payload?.calls ?? 0)} calls`,
                      "Avg duration",
                    ]}
                  />
                  <Bar dataKey="avg_duration_seconds" fill={SERIES_COLOR} radius={[0, 4, 4, 0]} maxBarSize={24} name="Avg duration" isAnimationActive={false}>
                    <LabelList
                      dataKey="avg_duration_seconds"
                      position="right"
                      formatter={(v: number) => formatElapsed(v, 1)}
                      fill="hsl(var(--foreground))"
                      fontSize={11}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {insight && <p className="mt-3 text-xs text-muted-foreground">{insight}</p>}
            </>
          )}

          {tab === "distribution" && (
            <>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Calls by duration</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={histogram} margin={CHART_THEME.margin}>
                  <CartesianGrid {...CHART_THEME.grid} />
                  <XAxis dataKey="range" tick={CHART_TICK} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} />
                  <YAxis {...CHART_THEME.yAxis} allowDecimals={false} />
                  <Tooltip {...DIAGNOSTIC_TOOLTIP} formatter={(v: number) => [formatCount(v), "Calls"]} />
                  <Bar dataKey="calls" fill={SERIES_COLOR} radius={[4, 4, 0, 0]} maxBarSize={48} name="Calls" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}

          <p className="mt-3 text-xs text-muted-foreground">Stored outbound call durations; estimates and unknown provenance are listed in Data basis.</p>
        </>
      )}
    </ReportSection>
  );
};

export default CallDurationAnalysis;
