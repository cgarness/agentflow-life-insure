import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { formatCount, formatRate, ratio } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import type { ReportVolume } from "@/lib/reports-schemas";
import { CHART_KEYS_DESC, CHART_THEME, SERIES_COLOR, TOOLTIP_FRAME, rateAxisMax } from "./reportChartTheme";
import ReportSection from "./ReportSection";
import ReportSegmented from "./ReportSegmented";
import { NoTooltip, TrendPanel } from "./ReportTrends";
import { useChartReadout } from "./useChartReadout";

type Tab = "hour" | "day";
const TABS: ReadonlyArray<readonly [Tab, string]> = [["hour", "By hour"], ["day", "By day"]];
const SYNC_ID = "call-flow";

interface Props {
  volume: ReportVolume;
  onExport?: ReportExportFn;
}

interface Row {
  label: string;
  calls: number;
  contacted: number;
  /** Call contact rate in percent, null when no calls were made in the bucket. */
  rate: number | null;
}

const fmtHour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

function toRow(label: string, calls: number, contacted: number): Row {
  const r = ratio(contacted, calls);
  return { label, calls, contacted, rate: r === null ? null : Math.round(r * 1000) / 10 };
}

function FlowTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: Row }> }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className={TOOLTIP_FRAME}>
      <p className="mb-2 font-semibold">{row.label}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
        <dt>Calls made</dt><dd className="text-right font-semibold tabular-nums">{formatCount(row.calls)}</dd>
        <dt>Contacted calls</dt><dd className="text-right tabular-nums">{formatCount(row.contacted)}</dd>
        <dt>Call contact rate</dt><dd className="text-right font-semibold tabular-nums">{formatRate(row.rate)}</dd>
      </dl>
      {row.calls === 0 && <p className="mt-2 text-muted-foreground">No outbound calls; rate unavailable.</p>}
    </div>
  );
}

/** The spoken form of FlowTooltip, for the focusable panel's live readout. */
function flowReadout(row: Row): string {
  const rate = row.calls === 0 ? "unavailable" : formatRate(row.rate);
  return `${row.label}: ${formatCount(row.calls)} ${row.calls === 1 ? "call" : "calls"} made, ${formatCount(row.contacted)} contacted, call contact rate ${rate}.`;
}

/**
 * Call flow — outbound calls by agency hour or weekday above the call contact rate for the same buckets:
 * two single-axis panels on one series, styled like Trends. A bucket with no calls has no rate (a gap).
 */
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
  const { handlers, readout } = useChartReadout(rows, flowReadout);
  const unit = tab === "hour" ? "agency hour" : "weekday";
  const rateMax = rateAxisMax(rows.reduce((max, r) => Math.max(max, r.rate ?? 0), 0));

  const handleExport = onExport
    ? () =>
        onExport(
          tab === "hour" ? "Call Flow by Hour" : "Call Flow by Day",
          [tab === "hour" ? "Hour" : "Day", "Calls made", "Contacted", "Call contact rate %"],
          rows.map((r) => [r.label, r.calls, r.contacted, r.rate]),
        )
    : undefined;

  return (
    <ReportSection title="Call flow" defaultOpen={false} onExport={handleExport}>
      {empty ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No outbound calls in this period.</p>
      ) : (
        <>
          <ReportSegmented ariaLabel="Call flow view" value={tab} onChange={(next) => setTab(next)} options={TABS} className="mb-4" />
          <TrendPanel caption="Calls made" size="main" readout={readout}>
            <BarChart data={rows} syncId={SYNC_ID} margin={CHART_THEME.mainMargin} barCategoryGap="20%"
              accessibilityLayer aria-label={`Calls made by ${unit}`} desc={CHART_KEYS_DESC} {...handlers}>
              <CartesianGrid {...CHART_THEME.grid} />
              <XAxis dataKey="label" hide />
              <YAxis {...CHART_THEME.yAxis} allowDecimals={false} />
              <Tooltip content={<FlowTooltip />} cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.6 }} {...CHART_THEME.tooltip} />
              <Bar dataKey="calls" name="Calls made" fill={SERIES_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </TrendPanel>
          <TrendPanel caption="Call contact rate" size="companion">
            <LineChart data={rows} syncId={SYNC_ID} margin={CHART_THEME.margin} aria-label={`Call contact rate by ${unit}`}>
              <CartesianGrid {...CHART_THEME.grid} />
              <XAxis {...CHART_THEME.xAxis} />
              <YAxis {...CHART_THEME.yAxis} domain={[0, rateMax]} ticks={[0, rateMax / 2, rateMax]} tickFormatter={(value: number) => `${value}%`} />
              <Tooltip content={<NoTooltip />} cursor={CHART_THEME.cursor} {...CHART_THEME.tooltip} />
              <Line type="linear" dataKey="rate" name="Call contact rate" stroke={SERIES_COLOR} strokeWidth={2}
                dot={{ r: 3, fill: SERIES_COLOR, strokeWidth: 0 }} activeDot={CHART_THEME.activeDot} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </TrendPanel>
          <p className="mt-3 text-xs text-muted-foreground">
            Hours and days are in the agency time zone; a bucket with no calls shows no call contact rate.
          </p>
        </>
      )}
    </ReportSection>
  );
};

export default CallFlowAnalysis;
