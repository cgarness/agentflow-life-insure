import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCount, formatElapsed } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import { roundHalfUp } from "@/lib/reports-kpi-format";
import type { ReportDispositionsV3 as ReportDispositions } from "@/lib/reports-v3-schemas";
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


function avgSeconds(d: { calls?: number; duration_seconds?: number }): number {
  return (d.calls ?? 0) > 0 ? (d.duration_seconds ?? 0) / d.calls! : 0;
}

const CallDurationAnalysis: React.FC<Props> = ({ dispositions, onExport }) => {
  const [tab, setTab] = useState<Tab>("disposition");

  const { top, truncated } = useMemo(() => {
    // Server order is calls DESC, so the first N rows are the top N by calls. The average is display arithmetic from
    // two exact server counts (total seconds and calls).
    const rows = dispositions.by_disposition.map((d) => ({ ...d, avg_duration_seconds: avgSeconds(d) }));
    return { top: rows.slice(0, TOP_N), truncated: rows.length > TOP_N };
  }, [dispositions]);

  const histogram = dispositions.duration_buckets;
  const empty = dispositions.call_population.attempts === 0;

  const handleExport = onExport
    ? () => {
        if (tab === "disposition") {
          onExport(
            "Call Duration by Disposition",
            ["Disposition", "Calls", "Avg duration (s)"],
            // Rounded once (half up, 1 dp) from the exact counts, the v2 precision.
            dispositions.by_disposition.map((d) => [d.name, d.calls, d.calls > 0 ? roundHalfUp(d.duration_seconds, d.calls, 1) : null]),
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
        </>
      )}
    </ReportSection>
  );
};

export default CallDurationAnalysis;
