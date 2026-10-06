import React, { useMemo } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Calendar, TrendingUp, Trophy, type LucideIcon } from "lucide-react";
import type { ReportSummary, ReportVolume } from "@/lib/reports-schemas";
import { formatCount, formatPremium, formatRate, groupDailySeries, type Grouping } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import { PREMIUM_BASIS } from "@/lib/reports-integrity-text";
import { CURRENT_ASSIGNMENT_NOTE, POLICY_SOURCE_NOTE, policyQualityNote } from "@/lib/reports-policy-text";
import ReportSection from "./ReportSection";

interface Props {
  volume: ReportVolume;
  /** The summary panel's data, or null while it is not ready (loading, failed or denied). */
  summary: ReportSummary | null;
  grouping: Grouping;
  onExport?: ReportExportFn;
}

const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const PREMIUM_AXIS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

/** Sum cents, not floating dollars; retain all-unknown buckets as gaps, including in CSV. */
function productionSeries(volume: ReportVolume, grouping: Grouping) {
  return groupDailySeries(volume.by_date.map((d) => ({
    date: d.date, policies_sold: d.policies_sold, premium_policy_count: d.premium.policy_count,
    known_count: d.premium.known_count, unknown_count: d.premium.unknown_count,
    premium_cents: d.premium.annual_premium === null ? 0 : Math.round(d.premium.annual_premium * 100),
    unavailable_known_amount: d.premium.known_count > 0 && d.premium.annual_premium === null ? 1 : 0,
  })), grouping, ["policies_sold", "premium_policy_count", "known_count", "unknown_count", "premium_cents", "unavailable_known_amount"])
    .map((b) => ({ ...b,
      annual_premium: b.premium_policy_count > 0 && (b.known_count === 0 || b.unavailable_known_amount > 0) ? null : b.premium_cents / 100,
      coverage_pct: b.premium_policy_count > 0 ? 100 * b.known_count / b.premium_policy_count : null,
    }));
}

type ProductionPeriod = ReturnType<typeof productionSeries>[number];

function ProductionTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: ProductionPeriod }> }) {
  const period = payload?.[0]?.payload;
  if (!active || !period) return null;
  return (
    <div className="max-w-[280px] rounded-xl border border-border bg-card p-3 text-xs text-foreground shadow-lg">
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

function policiesLabel(n: number): string {
  return `${formatCount(n)} ${n === 1 ? "policy" : "policies"}`;
}

/** The summary only counts toward this chart when it describes the same scope, filter and period. */
function sameReport(summary: ReportSummary, volume: ReportVolume): boolean {
  return (
    summary.scope === volume.scope &&
    summary.requested_scope === volume.requested_scope &&
    summary.filter_agent_id === volume.filter_agent_id &&
    summary.window.start_date === volume.window.start_date &&
    summary.window.end_date === volume.window.end_date &&
    summary.window.time_zone === volume.window.time_zone
  );
}

interface TileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  subtitle?: string;
}

const Tile: React.FC<TileProps> = ({ icon: Icon, label, value, subtitle }) => (
  <div className="rounded-xl border border-border/50 bg-muted/40 p-4">
    <div className="flex items-center gap-2 mb-2">
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
    </div>
    <p className="break-words text-lg font-bold text-foreground" title={value}>{value}</p>
    {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
  </div>
);

/**
 * Policies Sold — normalized STORED policies (primary + additional) per AGENCY-calendar period, on each
 * policy's sale date; never wins. A count of policies, not clients, never divided into a rate. The
 * agent ranking is by CURRENT assignment, so it is labelled that way and never as seller credit.
 */
const PoliciesSoldChart: React.FC<Props> = ({ volume, summary, grouping, onExport }) => {
  const series = useMemo(() => productionSeries(volume, grouping), [volume, grouping]);
  const total = useMemo(() => series.reduce((sum, b) => sum + b.policies_sold, 0), [series]);
  const coverage = useMemo(() => series.reduce((sum, b) => ({
    known: sum.known + b.known_count, policies: sum.policies + b.premium_policy_count, unknown: sum.unknown + b.unknown_count,
  }), { known: 0, policies: 0, unknown: 0 }), [series]);
  const qualityNote = policyQualityNote(volume.policy_quality);

  const peak = useMemo(() => {
    let best: (typeof series)[number] | null = null;
    for (const b of series) if (b.policies_sold > 0 && (!best || b.policies_sold > best.policies_sold)) best = b;
    return best;
  }, [series]);

  const summaryReady = summary !== null && sameReport(summary, volume);
  const topPerformer = useMemo(() => {
    if (!summary || !summaryReady) return null;
    const ranked = summary.by_agent
      .filter((a) => a.policies_sold > 0)
      .sort((a, b) => b.policies_sold - a.policies_sold || a.name.localeCompare(b.name));
    return ranked[0] ?? null;
  }, [summary, summaryReady]);

  const handleExport = onExport
    ? () =>
        onExport(
          "Policies Sold",
          ["Period", "Policies sold", "Known annual premium", "Policies with known premium", "Policies with unknown premium", "Premium coverage (%)"],
          series.map((b) => [periodCell(b.first, b.last), b.policies_sold, b.annual_premium, b.known_count, b.unknown_count, b.coverage_pct]),
        )
    : undefined;

  return (
    <ReportSection title="Production trend" onExport={handleExport}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Production chart legend">
          <span><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-success" aria-hidden="true" />Policies sold · left axis</span>
          <span><span className="mr-2 inline-block h-0.5 w-4 bg-primary align-middle" aria-hidden="true" />Known annual premium · right axis</span>
        </div>
        <p>{formatCount(coverage.known)} / {formatCount(coverage.policies)} policies have known premium · {formatCount(coverage.unknown)} unknown</p>
      </div>
      {total === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No policies sold in this period.</p>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={series} margin={{ top: 8, right: 0, left: -12, bottom: 0 }} accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} minTickGap={12} />
            <YAxis yAxisId="policies" tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} width={48} />
            <YAxis yAxisId="premium" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} width={58} tickFormatter={(value: number) => PREMIUM_AXIS.format(value)} />
            <Tooltip content={<ProductionTooltip />} />
            <Bar yAxisId="policies" dataKey="policies_sold" name="Policies sold" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
            <Line yAxisId="premium" type="linear" dataKey="annual_premium" name="Known annual premium" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        <Tile icon={TrendingUp} label="Total policies sold" value={formatCount(total)} />
        <Tile
          icon={Trophy}
          label="Most policies — current assignments"
          value={topPerformer ? topPerformer.name : "—"}
          subtitle={
            !summaryReady
              ? "Agent summary not loaded"
              : topPerformer
                ? `${policiesLabel(topPerformer.policies_sold)} currently assigned`
                : undefined
          }
        />
        <Tile
          icon={Calendar}
          label="Peak period"
          value={peak ? peak.label : "—"}
          subtitle={peak ? policiesLabel(peak.policies_sold) : undefined}
        />
      </div>

      <p className="text-[11px] text-muted-foreground mt-3">
        {POLICY_SOURCE_NOTE} One client can hold several policies. {CURRENT_ASSIGNMENT_NOTE}
      </p>
      <p className="text-[11px] text-muted-foreground mt-1">{PREMIUM_BASIS} Missing premium is a gap, not zero.</p>
      {qualityNote && <p className="text-[11px] text-muted-foreground mt-1">{qualityNote}</p>}
    </ReportSection>
  );
};

export default PoliciesSoldChart;
