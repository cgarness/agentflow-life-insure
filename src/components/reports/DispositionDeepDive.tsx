import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCount, formatRate } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import type { ReportDispositions } from "@/lib/reports-schemas";
import { cn } from "@/lib/utils";
import { BAR_GRID, CHART_TICK, DIAGNOSTIC_TOOLTIP } from "./reportChartTheme";
import ReportSection from "./ReportSection";
import ReportSegmented from "./ReportSegmented";

type Tab = "agent" | "campaign";
type Mode = "count" | "pct";
const TABS: ReadonlyArray<readonly [Tab, string]> = [["agent", "By agent"], ["campaign", "By campaign"]];
const MODES: ReadonlyArray<readonly [Mode, string]> = [["count", "Count"], ["pct", "% of row total"]];
const TOP_N = 8;
const OTHER_COLOR = "hsl(var(--muted-foreground))";
/** A later series whose configured colour repeats an earlier one is drawn lighter, never recoloured. */
const REPEAT_OPACITY = 0.55;

interface Series {
  /** Synthetic chart key (disposition keys may contain dots, which recharts reads as paths). */
  id: string;
  name: string;
  color: string;
  /** Disposition key in the payload's `counts` map; null for the grouped "Other" series. */
  key: string | null;
  /** True when an earlier series has the same configured colour (Disposition Settings allow repeats). */
  repeat: boolean;
}

type ChartRow = { name: string; total: number } & Record<string, number | string>;

interface Props {
  dispositions: ReportDispositions;
  onExport?: ReportExportFn;
}

const truncate = (s: string) => (s.length > 18 ? `${s.slice(0, 18)}…` : s);
const sameColor = (a: string) => a.trim().toLowerCase();

/** Every series is named in text; a repeated colour's swatch is lighter and ringed, as its bars are lighter. */
function SeriesLegend({ series }: { series: Series[] }) {
  return (
    <ul aria-label="Dispositions" className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {series.map((s) => (
        <li key={s.id} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-repeat-color={s.repeat || undefined}>
          <span aria-hidden="true" className={cn("flex h-2.5 w-2.5 shrink-0 rounded-full", s.repeat && "ring-1 ring-foreground/40")}>
            {/* The configured disposition colour (data-driven). */}
            <span className={cn("h-full w-full rounded-full", s.repeat && "opacity-[0.55]")} style={{ backgroundColor: s.color }} />
          </span>
          <span className="break-words">{s.name}</span>
        </li>
      ))}
    </ul>
  );
}

const DispositionDeepDive: React.FC<Props> = ({ dispositions, onExport }) => {
  const [tab, setTab] = useState<Tab>("agent");
  const [mode, setMode] = useState<Mode>("count");

  const series = useMemo<Series[]>(() => {
    // Server order is calls DESC, so the first N rows are the top N by calls.
    const all = dispositions.by_disposition;
    const top: Series[] = all.slice(0, TOP_N).map((d, i, shown) => ({
      id: `s${i}`, name: d.name, color: d.color, key: d.key,
      repeat: shown.slice(0, i).some((earlier) => sameColor(earlier.color) === sameColor(d.color)),
    }));
    if (all.length > TOP_N) top.push({ id: "other", name: "Other", color: OTHER_COLOR, key: null, repeat: false });
    return top;
  }, [dispositions]);

  const source = tab === "agent" ? dispositions.by_agent : dispositions.by_campaign;

  /** Per-row counts for each series; "Other" is the row total minus the top-N series. */
  const counted = useMemo(
    () =>
      source
        .filter((r) => r.total > 0)
        .map((r) => {
          // The server's counts map omits dispositions this row never used: a genuine zero.
          const counts = series.map((s) => (s.key !== null && s.key in r.counts ? r.counts[s.key] : 0));
          const other = series.findIndex((s) => s.key === null);
          if (other >= 0) counts[other] = Math.max(0, r.total - counts.reduce((a, b) => a + b, 0));
          return { name: r.name, total: r.total, counts };
        }),
    [source, series],
  );

  const chartData = useMemo<ChartRow[]>(
    () =>
      counted.map((r) => {
        const row: ChartRow = { name: r.name, total: r.total };
        series.forEach((s, i) => {
          row[`raw_${s.id}`] = r.counts[i];
          // Rows with total 0 were filtered out above, so the share is always defined here.
          row[s.id] = mode === "count" ? r.counts[i] : (r.counts[i] / r.total) * 100;
        });
        return row;
      }),
    [counted, series, mode],
  );

  const handleExport = onExport
    ? () =>
        onExport(
          tab === "agent" ? "Disposition Deep Dive - By agent" : "Disposition Deep Dive - By campaign",
          ["Name", ...series.map((s) => s.name), "Total"],
          counted.map((r) => [r.name, ...r.counts, r.total]),
        )
    : undefined;

  return (
    <ReportSection title="Disposition deep dive" defaultOpen={false} onExport={handleExport}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ReportSegmented ariaLabel="Break down by" value={tab} onChange={(next) => setTab(next)} options={TABS} />
        <ReportSegmented ariaLabel="Show values as" value={mode} onChange={(next) => setMode(next)} options={MODES} />
      </div>

      {tab === "campaign" && dispositions.campaign_attribution_unavailable_calls > 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          {formatCount(dispositions.campaign_attribution_unavailable_calls)} calls have unavailable campaign attribution (missing or restricted).
        </p>
      )}
      {chartData.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {dispositions.total_calls === 0
            ? "No outbound calls in this period."
            : tab === "campaign"
              ? `No campaign breakdown is available for the ${formatCount(dispositions.total_calls)} outbound calls in this period.`
              : `None of the ${formatCount(dispositions.total_calls)} outbound calls in this period has an assigned agent.`}
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={Math.max(240, chartData.length * 40 + 60)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid {...BAR_GRID} />
              <XAxis
                type="number"
                tick={CHART_TICK}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                allowDecimals={false}
                domain={mode === "pct" ? [0, 100] : [0, "auto"]}
                // Float shares can stack to 100.00000000000001, which would stretch the axis to 120%.
                allowDataOverflow={mode === "pct"}
                tickFormatter={(v: number) => (mode === "pct" ? `${v}%` : formatCount(v))}
              />
              <YAxis type="category" dataKey="name" width={130} tick={CHART_TICK} tickLine={false} axisLine={false} tickFormatter={truncate} />
              <Tooltip
                {...DIAGNOSTIC_TOOLTIP}
                formatter={(v: number, name: string, item: { dataKey?: string | number; payload?: ChartRow }) => {
                  const raw = item.payload?.[`raw_${String(item.dataKey)}`];
                  const suffix = typeof raw === "number" ? ` (${formatCount(raw)})` : "";
                  return [mode === "pct" ? `${formatRate(v)}${suffix}` : formatCount(v), name];
                }}
              />
              {series.map((s) => (
                <Bar key={s.id} dataKey={s.id} name={s.name} stackId="d" fill={s.color} fillOpacity={s.repeat ? REPEAT_OPACITY : 1} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <SeriesLegend series={series} />
          <p className="mt-3 text-xs text-muted-foreground">
            Outbound calls{tab === "campaign" ? " with a campaign" : " with an assigned agent"}.
            {series.some((s) => s.key === null) ? ` Top ${TOP_N} dispositions by calls; the rest are grouped as Other.` : ""}
          </p>
        </>
      )}
    </ReportSection>
  );
};

export default DispositionDeepDive;
