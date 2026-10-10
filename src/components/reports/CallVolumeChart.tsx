import React, { useMemo } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import type { ReportVolume } from "@/lib/reports-schemas";
import { formatCount, formatRate, groupDailySeries, type Grouping } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import { CHART_KEYS_DESC, CHART_THEME, PERIOD_UNIT, SERIES_COLOR, TOOLTIP_FRAME, TREND_SYNC_ID, partialDot, rateAxisMax } from "./reportChartTheme";
import ReportSection from "./ReportSection";
import { NoTooltip, TrendPanel } from "./ReportTrends";
import { useChartReadout } from "./useChartReadout";

interface Props {
  volume: ReportVolume;
  grouping: Grouping;
  onExport?: ReportExportFn;
}

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
    <div className={TOOLTIP_FRAME}>
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

/** The spoken form of CallingTooltip, for the focusable panel's live readout. */
function callingReadout(p: CallingPeriod): string {
  const rate = p.calls_made === 0 ? "unavailable" : formatRate(p.contact_rate_pct);
  return `${periodCell(p.first, p.last)}: ${formatCount(p.calls_made)} outbound ${p.calls_made === 1 ? "call" : "calls"}, ${formatCount(p.contacted)} contacted, call contact rate ${rate}; ${formatCount(p.inbound_calls)} inbound.`;
}

/**
 * Calling trend — outbound calls above the call contact rate, two single-axis panels sharing one series
 * and one hover. Rates use grouped counts, never an average of daily rates; a bucket with no outbound
 * calls has no rate and stays a gap. Inbound calls never enter the rate.
 */
const CallVolumeChart: React.FC<Props> = ({ volume, grouping, onExport }) => {
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

  const { handlers, readout } = useChartReadout(series, callingReadout);
  const unit = PERIOD_UNIT[grouping];
  const totals = useMemo(
    () => series.reduce((acc, b) => ({ calls: acc.calls + b.calls_made, inbound: acc.inbound + b.inbound_calls }), { calls: 0, inbound: 0 }),
    [series],
  );
  const rateMax = rateAxisMax(series.reduce((max, b) => Math.max(max, b.contact_rate_pct ?? 0), 0));
  const isEmpty = totals.calls === 0 && totals.inbound === 0;
  const meta = totals.inbound > 0
    ? `${formatCount(totals.inbound)} inbound ${totals.inbound === 1 ? "call" : "calls"} (not in call contact rate)`
    : undefined;

  const handleExport = onExport
    ? () =>
        onExport(
          "Call Volume",
          ["Period", "Calls made", "Contacted", "Inbound", "Call contact rate (%)"],
          series.map((b) => [periodCell(b.first, b.last), b.calls_made, b.contacted, b.inbound_calls, b.contact_rate_pct]),
        )
    : undefined;

  return (
    <ReportSection title="Calling trend" onExport={handleExport} meta={meta}>
      {isEmpty ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No calls in this period.</p>
      ) : (
        <>
          <TrendPanel caption="Outbound calls" size="main" readout={readout}>
            <ComposedChart data={series} syncId={TREND_SYNC_ID} margin={CHART_THEME.mainMargin} barCategoryGap="20%"
              accessibilityLayer aria-label={`Outbound calls by ${unit}`} desc={CHART_KEYS_DESC} {...handlers}>
              <CartesianGrid {...CHART_THEME.grid} />
              <XAxis dataKey="label" hide />
              <YAxis yAxisId="calls" {...CHART_THEME.yAxis} allowDecimals={false} />
              <Tooltip content={<CallingTooltip />} cursor={CHART_THEME.cursor} {...CHART_THEME.tooltip} />
              <Bar yAxisId="calls" dataKey="calls_made" name="Outbound calls" fill={SERIES_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </ComposedChart>
          </TrendPanel>
          <TrendPanel caption="Call contact rate" size="companion">
            <ComposedChart data={series} syncId={TREND_SYNC_ID} margin={CHART_THEME.margin} aria-label={`Call contact rate by ${unit}`}>
              <CartesianGrid {...CHART_THEME.grid} />
              <XAxis {...CHART_THEME.xAxis} />
              <YAxis yAxisId="rate" {...CHART_THEME.yAxis} domain={[0, rateMax]} ticks={[0, rateMax / 2, rateMax]} tickFormatter={(value: number) => `${value}%`} />
              <Tooltip content={<NoTooltip />} cursor={CHART_THEME.cursor} {...CHART_THEME.tooltip} />
              <Line yAxisId="rate" type="linear" dataKey="contact_rate_pct" name="Call contact rate" stroke={SERIES_COLOR} strokeWidth={2}
                dot={partialDot} activeDot={CHART_THEME.activeDot} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </TrendPanel>
        </>
      )}
    </ReportSection>
  );
};

export default CallVolumeChart;
