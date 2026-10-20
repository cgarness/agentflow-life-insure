import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_THEME, TOOLTIP_FRAME } from "@/components/reports/reportChartTheme";
import { formatCents, formatMonth } from "@/lib/commission/installments";
import { customPeriod, historyHref, scheduledHref } from "@/lib/commission/centerFilters";
import type { TimelineBucket } from "@/lib/commission/centerSchemas";
import { rangeLabel } from "../shared/format";
import { FilterSelect } from "../shared/Bits";
import { TimelineKey } from "./TimelineKey";
import { timelinePatterns } from "./timelinePatterns";

const AXIS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Point = TimelineBucket & { label: string; received: number; advance: number; later: number };

function MonthTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: Point }> }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className={TOOLTIP_FRAME}>
      <p className="mb-2 font-semibold">{rangeLabel(p.from, p.to)}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <dt>Received</dt><dd className="text-right tabular-nums">{formatCents(p.received_cents)}</dd>
        <dt>Expected · Advance</dt><dd className="text-right tabular-nums">{formatCents(p.expected_advance_cents)}</dd>
        <dt>Expected · Months 10–12</dt><dd className="text-right tabular-nums">{formatCents(p.expected_later_cents)}</dd>
      </dl>
    </div>
  );
}

/**
 * Timeline: per month, recorded receipts and scheduled estimates as two separate bars — never stacked on each other.
 * Expected splits into Advance and Months 10–12 (hatched: estimates). Months inside the period sum exactly to the
 * Expected and Received cards; padding months outside it are dimmed. Choosing a month (click a bar or the select)
 * shows its figures and links to its exact records.
 */
export function CommissionTimeline({ buckets }: { buckets: TimelineBucket[] }) {
  const data = useMemo<Point[]>(() => buckets.map((b) => ({
    ...b, label: `${SHORT[Number(b.month.slice(5)) - 1]}${b.month.endsWith("-01") ? ` ${b.month.slice(2, 4)}` : ""}`,
    received: b.received_cents / 100, advance: b.expected_advance_cents / 100, later: b.expected_later_cents / 100,
  })), [buckets]);
  const firstInPeriod = buckets.find((b) => b.in_period)?.month ?? buckets[0]?.month ?? "";
  const [chosen, setChosen] = useState<string | null>(null);
  const month = buckets.find((b) => b.month === (chosen ?? firstInPeriod)) ?? buckets[0];
  const dim = (b: Point) => (b.in_period ? 1 : 0.45);
  const pick = (point: unknown) => {
    const m = (point as { payload?: Point } | undefined)?.payload?.month;
    if (m) setChosen(m);
  };

  return (
    <div className="space-y-3">
      <TimelineKey />
      <div className="h-56 sm:h-64 [--cc-advance:#2a78d6] [--cc-later:#eb6834] [--cc-received:#1baf7a] dark:[--cc-advance:#3987e5] dark:[--cc-later:#d95926] dark:[--cc-received:#199e70]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={CHART_THEME.mainMargin} barGap={2} barCategoryGap="22%" accessibilityLayer
            aria-label="Received and expected commission by month">
            {timelinePatterns()}
            <CartesianGrid {...CHART_THEME.grid} />
            <XAxis {...CHART_THEME.xAxis} interval="preserveStartEnd" minTickGap={4} tick={{ ...CHART_THEME.xAxis.tick, fontSize: 11 }} />
            <YAxis {...CHART_THEME.yAxis} tickFormatter={(v: number) => AXIS.format(v)} />
            <Tooltip content={<MonthTooltip />} cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.5 }} isAnimationActive={false} />
            <Bar dataKey="received" name="Received" fill="var(--cc-received)" radius={[4, 4, 0, 0]} maxBarSize={16} onClick={pick} isAnimationActive={false}>
              {data.map((b) => <Cell key={b.month} fillOpacity={dim(b)} cursor="pointer" />)}
            </Bar>
            <Bar dataKey="advance" name="Expected · Advance" stackId="expected" fill="url(#cc-hatch-advance)" stroke="var(--cc-advance)"
              strokeWidth={1} maxBarSize={16} onClick={pick} isAnimationActive={false}>
              {data.map((b) => <Cell key={b.month} fillOpacity={dim(b)} strokeOpacity={dim(b)} cursor="pointer" />)}
            </Bar>
            <Bar dataKey="later" name="Expected · Months 10–12" stackId="expected" fill="url(#cc-hatch-later)" stroke="var(--cc-later)"
              strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={16} onClick={pick} isAnimationActive={false}>
              {data.map((b) => <Cell key={b.month} fillOpacity={dim(b)} strokeOpacity={dim(b)} cursor="pointer" />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {month && (
        <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <FilterSelect label="Month" value={month.month} className="w-36"
              options={buckets.map((b) => [b.month, formatMonth(`${b.month}-01`)] as const)} onChange={setChosen} />
            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-sm" aria-live="polite">
              <dt className="text-muted-foreground">Expected</dt>
              <dd className="tabular-nums">{formatCents(month.expected_advance_cents + month.expected_later_cents)}
                <span className="text-xs text-muted-foreground"> · Advance {formatCents(month.expected_advance_cents)} · Months 10–12 {formatCents(month.expected_later_cents)}</span></dd>
              <dt className="text-muted-foreground">Received</dt><dd className="tabular-nums">{formatCents(month.received_cents)}</dd>
            </dl>
          </div>
          <div className="flex gap-4 whitespace-nowrap text-sm font-medium">
            <Link className="text-primary hover:underline" to={scheduledHref({ period: customPeriod(month.from, month.to) })}>
              Expected ({month.installment_count})
            </Link>
            <Link className="text-primary hover:underline" to={historyHref(customPeriod(month.from, month.to))}>
              Received ({month.receipt_count})
            </Link>
          </div>
        </div>
      )}
      {/* A table ignores the 1px box of sr-only, so the wrapper carries it. */}
      <div className="sr-only"><table>
        <caption>Received and expected commission by month</caption>
        <thead><tr><th scope="col">Dates</th><th scope="col">Received</th><th scope="col">Expected, Advance</th><th scope="col">Expected, Months 10–12</th></tr></thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.month}><th scope="row">{rangeLabel(b.from, b.to)}</th><td>{formatCents(b.received_cents)}</td>
              <td>{formatCents(b.expected_advance_cents)}</td><td>{formatCents(b.expected_later_cents)}</td></tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
