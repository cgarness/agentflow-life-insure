import React, { useMemo } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { ReportVolume } from "@/lib/reports-schemas";
import { formatCount, formatRate, groupDailySeries, type Grouping } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import { cn } from "@/lib/utils";
import ReportSection from "./ReportSection";

interface Props {
  volume: ReportVolume;
  grouping: Grouping;
  onGroupingChange: (g: Grouping) => void;
  onExport?: ReportExportFn;
}

const GROUPINGS: Grouping[] = ["daily", "weekly", "monthly"];

const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };

interface CallingPeriod {
  first: string;
  last: string;
  calls_made: number;
  contacted: number;
  inbound_calls: number;
  contact_rate_pct: number | null;
}

function CallingTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: CallingPeriod }> }) {
  const period = payload?.[0]?.payload;
  if (!active || !period) return null;
  return (
    <div className="max-w-[280px] rounded-xl border border-border bg-card p-3 text-xs text-foreground shadow-lg">
      <p className="mb-2 font-semibold">{periodCell(period.first, period.last)}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
        <dt>Outbound calls</dt><dd className="text-right font-semibold tabular-nums">{formatCount(period.calls_made)}</dd>
        <dt>Contacted outbound calls</dt><dd className="text-right tabular-nums">{formatCount(period.contacted)}</dd>
        <dt>Call contact rate</dt><dd className="text-right font-semibold tabular-nums">{formatRate(period.contact_rate_pct)}</dd>
        <dt>Inbound calls</dt><dd className="text-right tabular-nums">{formatCount(period.inbound_calls)}</dd>
      </dl>
      <p className="mt-2 text-muted-foreground">{period.calls_made === 0 ? "No outbound calls; rate unavailable." : `${formatCount(period.contacted)} contacted ÷ ${formatCount(period.calls_made)} outbound calls`}</p>
    </div>
  );
}

/** Unambiguous period cell for CSV (includes the year, unlike the short on-screen label). */
function periodCell(first: string, last: string): string {
  return first === last ? first : `${first} to ${last}`;
}

/**
 * Outbound calls (bars) and call contact rate (line) on separate count/percentage axes.
 * Rates use grouped counts, never an average of daily rates; no calls means an unavailable rate.
 */
const CallVolumeChart: React.FC<Props> = ({ volume, grouping, onGroupingChange, onExport }) => {
  const series = useMemo(
    () =>
      groupDailySeries(
        // Explicit rows: the schema is parsed at runtime, so every field is present.
        volume.by_date.map((d) => ({ date: d.date, calls_made: d.calls_made, contacted: d.contacted, inbound_calls: d.inbound_calls })),
        grouping,
        ["calls_made", "contacted", "inbound_calls"],
      ).map((b) => ({
        key: b.key,
        label: b.label,
        first: b.first,
        last: b.last,
        calls_made: b.calls_made,
        contacted: b.contacted,
        inbound_calls: b.inbound_calls,
        contact_rate_pct: b.calls_made > 0 ? 100 * b.contacted / b.calls_made : null,
      })),
    [volume.by_date, grouping],
  );

  const totals = useMemo(
    () =>
      series.reduce(
        (acc, b) => ({ calls: acc.calls + b.calls_made, contacted: acc.contacted + b.contacted, inbound: acc.inbound + b.inbound_calls }),
        { calls: 0, contacted: 0, inbound: 0 },
      ),
    [series],
  );
  const isEmpty = totals.calls === 0 && totals.inbound === 0;
  const showInbound = totals.inbound > 0;

  const handleExport = onExport
    ? () =>
        onExport(
          "Call Volume",
          ["Period", "Calls made", "Contacted", "Inbound", "Call contact rate (%)"],
          series.map((b) => [periodCell(b.first, b.last), b.calls_made, b.contacted, b.inbound_calls, b.contact_rate_pct]),
        )
    : undefined;

  return (
    <ReportSection title="Calling trend" onExport={handleExport}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex items-center gap-1 rounded-xl bg-muted/60 p-1" role="group" aria-label="Group by">
          {GROUPINGS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onGroupingChange(g)}
              aria-pressed={g === grouping}
              className={cn(
                "px-3 py-2 text-[11px] font-bold uppercase tracking-widest rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                g === grouping ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g}
            </button>
          ))}
        </div>
        {!isEmpty && (
          <p className="text-xs text-muted-foreground">
            {formatCount(totals.calls)} outbound calls · {formatRate(totals.calls > 0 ? 100 * totals.contacted / totals.calls : null)} call contact rate
            {showInbound && ` · ${formatCount(totals.inbound)} inbound`}
          </p>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="Calling chart legend">
        <span><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-primary" aria-hidden="true" />Outbound calls · left axis</span>
        <span><span className="mr-2 inline-block h-0.5 w-4 bg-warning align-middle" aria-hidden="true" />Call contact rate · right axis</span>
      </div>

      {isEmpty ? (
        <p className="text-sm text-muted-foreground text-center py-12">No calls in this period.</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={series} margin={{ top: 8, right: 0, left: -12, bottom: 0 }} accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} minTickGap={12} />
            <YAxis yAxisId="calls" tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} width={48} />
            <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => `${value}%`} />
            <Tooltip content={<CallingTooltip />} cursor={{ fill: "hsl(var(--muted-foreground))", fillOpacity: 0.08 }} />
            <Bar yAxisId="calls" dataKey="calls_made" name="Outbound calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
            <Line yAxisId="rate" type="linear" dataKey="contact_rate_pct" name="Call contact rate" stroke="hsl(var(--warning))" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Call contact rate uses outbound calls only.</p>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded py-1 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">How call contact rate is calculated</summary>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Call contact rate = contacted outbound calls ÷ outbound calls. Inbound calls are shown separately and do not enter the rate.</p>
      </details>
    </ReportSection>
  );
};

export default CallVolumeChart;
