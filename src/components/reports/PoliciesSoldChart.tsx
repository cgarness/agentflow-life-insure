import React, { useMemo } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import type { ReportVolume } from "@/lib/reports-schemas";
import { formatCount, formatPremium, formatRate, groupDailySeries, type Grouping } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import { CHART_KEYS_DESC, CHART_THEME, PERIOD_UNIT, SERIES_COLOR, TOOLTIP_FRAME, TREND_SYNC_ID, partialDot } from "./reportChartTheme";
import ReportSection from "./ReportSection";
import { NoTooltip, TrendPanel } from "./ReportTrends";
import { useChartReadout } from "./useChartReadout";

interface Props {
  volume: ReportVolume;
  grouping: Grouping;
  onExport?: ReportExportFn;
}

const PREMIUM_AXIS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

/** Sum cents, not floating dollars; retain all-unknown buckets as gaps, including in CSV. */
function productionSeries(volume: ReportVolume, grouping: Grouping) {
  return groupDailySeries(volume.by_date.map((d) => ({
    date: d.date, policies_sold: d.policies_sold, premium_policy_count: d.premium.policy_count,
    known_count: d.premium.known_count, unknown_count: d.premium.unknown_count,
    premium_cents: d.premium.annual_premium === null ? 0 : Math.round(d.premium.annual_premium * 100),
    unavailable_known_amount: d.premium.known_count > 0 && d.premium.annual_premium === null ? 1 : 0,
  })), grouping, ["policies_sold", "premium_policy_count", "known_count", "unknown_count", "premium_cents", "unavailable_known_amount"])
    .map((b) => {
      const annual_premium = b.premium_policy_count > 0 && (b.known_count === 0 || b.unavailable_known_amount > 0) ? null : b.premium_cents / 100;
      return { ...b, annual_premium,
        coverage_pct: b.premium_policy_count > 0 ? 100 * b.known_count / b.premium_policy_count : null,
        /** A real amount that covers only some of the bucket's policies: drawn as a hollow dot. */
        partial: annual_premium !== null && b.known_count > 0 && b.known_count < b.premium_policy_count,
      };
    });
}

type ProductionPeriod = ReturnType<typeof productionSeries>[number];

function ProductionTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: ProductionPeriod }> }) {
  const period = payload?.[0]?.payload;
  if (!active || !period) return null;
  return (
    <div className={TOOLTIP_FRAME}>
      <p className="mb-2 font-semibold">{periodCell(period.first, period.last)}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
        <dt>Policies sold</dt><dd className="text-right font-semibold tabular-nums">{formatCount(period.policies_sold)}</dd>
        <dt>Known annual premium</dt><dd className="text-right font-semibold tabular-nums">{formatPremium(period.annual_premium)}</dd>
        <dt>Premium coverage</dt><dd className="text-right tabular-nums">{formatRate(period.coverage_pct)}</dd>
      </dl>
      <p className="mt-2 text-muted-foreground">{formatCount(period.known_count)} of {formatCount(period.premium_policy_count)} policies known · {formatCount(period.unknown_count)} unknown</p>
      {period.annual_premium === null && <p className="mt-1 text-muted-foreground">Known premium unavailable for this period.</p>}
    </div>
  );
}

function periodCell(first: string, last: string): string {
  return first === last ? first : `${first} to ${last}`;
}

/** The spoken form of ProductionTooltip, for the focusable panel's live readout. */
function productionReadout(p: ProductionPeriod): string {
  const amount = p.annual_premium === null ? "unavailable" : formatPremium(p.annual_premium);
  return `${periodCell(p.first, p.last)}: ${formatCount(p.policies_sold)} ${p.policies_sold === 1 ? "policy" : "policies"} sold; known annual premium ${amount}; ${formatCount(p.known_count)} of ${formatCount(p.premium_policy_count)} policies known, ${formatCount(p.unknown_count)} unknown.`;
}

/**
 * Production trend — normalized STORED policies (primary + additional) per AGENCY-calendar period, on each
 * policy's sale date (never wins), above the known annual premium of those policies. Two single-axis panels
 * share one series and one hover. A count of policies, not clients, never divided into a rate; a premium
 * bucket with no known amount is a gap, never $0.
 */
const PoliciesSoldChart: React.FC<Props> = ({ volume, grouping, onExport }) => {
  const series = useMemo(() => productionSeries(volume, grouping), [volume, grouping]);
  const { handlers, readout } = useChartReadout(series, productionReadout);
  const unit = PERIOD_UNIT[grouping];
  const totals = useMemo(() => series.reduce((sum, b) => ({
    policies_sold: sum.policies_sold + b.policies_sold, known: sum.known + b.known_count,
    policies: sum.policies + b.premium_policy_count, unknown: sum.unknown + b.unknown_count,
  }), { policies_sold: 0, known: 0, policies: 0, unknown: 0 }), [series]);
  const hasPartial = series.some((b) => b.partial);
  const hasGap = series.some((b) => b.premium_policy_count > 0 && b.annual_premium === null);
  const meta = totals.unknown > 0
    ? `${formatCount(totals.known)} of ${formatCount(totals.policies)} ${totals.policies === 1 ? "premium" : "premiums"} known · ${formatCount(totals.unknown)} unknown`
    : undefined;

  const handleExport = onExport
    ? () =>
        onExport(
          "Policies Sold",
          ["Period", "Policies sold", "Known annual premium", "Policies with known premium", "Policies with unknown premium", "Premium coverage (%)"],
          series.map((b) => [periodCell(b.first, b.last), b.policies_sold, b.annual_premium, b.known_count, b.unknown_count, b.coverage_pct]),
        )
    : undefined;

  return (
    <ReportSection title="Production trend" onExport={handleExport} meta={meta}>
      {totals.policies_sold === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No policies sold in this period.</p>
      ) : (
        <>
          <TrendPanel caption="Policies sold" size="main" readout={readout}>
            <ComposedChart data={series} syncId={TREND_SYNC_ID} margin={CHART_THEME.mainMargin} barCategoryGap="20%"
              accessibilityLayer aria-label={`Policies sold by ${unit}`} desc={CHART_KEYS_DESC} {...handlers}>
              <CartesianGrid {...CHART_THEME.grid} />
              <XAxis dataKey="label" hide />
              <YAxis yAxisId="policies" {...CHART_THEME.yAxis} allowDecimals={false} />
              <Tooltip content={<ProductionTooltip />} cursor={CHART_THEME.cursor} {...CHART_THEME.tooltip} />
              <Bar yAxisId="policies" dataKey="policies_sold" name="Policies sold" fill={SERIES_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </ComposedChart>
          </TrendPanel>
          <TrendPanel caption="Known annual premium" size="companion">
            <ComposedChart data={series} syncId={TREND_SYNC_ID} margin={CHART_THEME.margin} aria-label={`Known annual premium by ${unit}`}>
              <CartesianGrid {...CHART_THEME.grid} />
              <XAxis {...CHART_THEME.xAxis} />
              <YAxis yAxisId="premium" {...CHART_THEME.yAxis} tickFormatter={(value: number) => PREMIUM_AXIS.format(value)} />
              <Tooltip content={<NoTooltip />} cursor={CHART_THEME.cursor} {...CHART_THEME.tooltip} />
              <Line yAxisId="premium" type="linear" dataKey="annual_premium" name="Known annual premium" stroke={SERIES_COLOR} strokeWidth={2}
                dot={partialDot} activeDot={CHART_THEME.activeDot} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </TrendPanel>
          {(hasPartial || hasGap) && (
            <ul aria-label="Known annual premium key" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {hasPartial && (
                <li className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full border-[1.5px] border-primary bg-card" />
                  <span className="sr-only">Hollow dot: </span>Some premiums unknown
                </li>
              )}
              {hasGap && <li>Gap = known premium unavailable, not $0</li>}
            </ul>
          )}
        </>
      )}
    </ReportSection>
  );
};

export default PoliciesSoldChart;
