/**
 * reportChartTheme — the one chart chrome every Reports trend panel uses: solid hairline grid, 11px muted
 * ticks, 48px y-axes (so stacked plot areas line up), one accent series colour, a tooltip pinned to the top
 * of the panel and the partial-bucket dot. One measure per panel; never a second y-axis.
 */
import type { ReactElement } from "react";

/** Every trend series uses the one accent; the panel caption, not a colour, names the metric. */
export const SERIES_COLOR = "hsl(var(--primary))";
/** All trend panels render the same grouped series, so recharts syncs their hover by index. */
export const TREND_SYNC_ID = "report-trends";

const TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };

export const CHART_THEME = {
  /** Room above the top tick label; the main panel (no x-axis) also keeps room below its 0 label. */
  margin: { top: 8, right: 8, left: 0, bottom: 0 },
  mainMargin: { top: 8, right: 8, left: 0, bottom: 6 },
  grid: { vertical: false, stroke: "hsl(var(--border))" },
  /** interval 0 keeps every tick, so the 0 baseline label is never dropped as a collision. */
  yAxis: { width: 48, tickCount: 4, interval: 0, axisLine: false, tickLine: false, tick: TICK },
  /** Only the companion (lower) panel shows dates; the main panel's x-axis is hidden. */
  xAxis: { dataKey: "label", minTickGap: 16, tickLine: false, axisLine: { stroke: "hsl(var(--border))" }, tick: TICK },
  /** Pinned to the panel top so a finger never covers the readout. */
  tooltip: { position: { y: 0 }, allowEscapeViewBox: { x: false, y: true }, isAnimationActive: false },
  /** One hairline crosshair on every synced panel, so the hovered bucket lines up across all four. */
  cursor: { stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.4, strokeWidth: 1 },
  activeDot: { r: 4.5, fill: SERIES_COLOR, stroke: "hsl(var(--card))", strokeWidth: 2 },
} as const;

/**
 * Top of the zero-based call contact rate axis: the highest bucket rate rounded up to a multiple of 5,
 * at least 10 and at most 100, so a 7.4% rate is not drawn flat along a 0–100% axis.
 */
export function rateAxisMax(maxRatePct: number): number {
  return Math.min(100, Math.max(10, Math.ceil(maxRatePct / 5) * 5));
}

export const TOOLTIP_FRAME = "max-w-[280px] rounded-xl border border-border bg-card p-3 text-xs text-foreground shadow-lg";

interface DotProps {
  key?: string;
  cx?: number | null;
  cy?: number | null;
  payload?: { partial?: boolean };
}

/**
 * Line `dot` renderer (recharts calls it once per point, key included): filled for a fully known bucket,
 * hollow for a partial one (some premiums unknown). A gap (null value) gets no marker, so missing data is
 * never drawn as a point.
 */
export function partialDot({ key, cx, cy, payload }: DotProps): ReactElement {
  if (typeof cx !== "number" || typeof cy !== "number") return <g key={key} />;
  return payload?.partial
    ? <circle key={key} cx={cx} cy={cy} r={3.5} fill="hsl(var(--card))" stroke={SERIES_COLOR} strokeWidth={1.5} />
    : <circle key={key} cx={cx} cy={cy} r={3.5} fill={SERIES_COLOR} stroke="hsl(var(--card))" strokeWidth={1.5} />;
}
