import React, { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Calendar, TrendingUp, Trophy, type LucideIcon } from "lucide-react";
import type { ReportSummary, ReportVolume } from "@/lib/reports-schemas";
import { formatCount, groupDailySeries, type Grouping } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import ReportSection from "./ReportSection";

interface Props {
  volume: ReportVolume;
  /** The summary panel's data, or null while it is not ready (loading, failed or denied). */
  summary: ReportSummary | null;
  grouping: Grouping;
  onExport?: ReportExportFn;
}

const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
  fontSize: 12,
};

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
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">{label}</p>
    </div>
    <p className="text-lg font-bold text-foreground truncate" title={value}>{value}</p>
    {subtitle && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{subtitle}</p>}
  </div>
);

/**
 * Policies Sold — canonical wins per AGENCY-calendar period. This is a count of policies, not of
 * clients, and is deliberately never divided into a rate of any kind.
 */
const PoliciesSoldChart: React.FC<Props> = ({ volume, summary, grouping, onExport }) => {
  const series = useMemo(
    () =>
      groupDailySeries(
        volume.by_date.map((d) => ({ date: d.date, policies_sold: d.policies_sold })),
        grouping,
        ["policies_sold"],
      ).map((b) => ({
        key: b.key,
        label: b.label,
        first: b.first,
        last: b.last,
        policies_sold: b.policies_sold,
      })),
    [volume.by_date, grouping],
  );

  const total = useMemo(() => series.reduce((sum, b) => sum + b.policies_sold, 0), [series]);

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
          ["Period", "Policies sold"],
          series.map((b) => [periodCell(b.first, b.last), b.policies_sold]),
        )
    : undefined;

  return (
    <ReportSection title="Policies Sold" onExport={handleExport}>
      {total === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No policies sold in this period.</p>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} minTickGap={12} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
              formatter={(value: number) => [formatCount(value), "Policies sold"]}
            />
            <Line type="monotone" dataKey="policies_sold" name="Policies sold" stroke="hsl(var(--success))" strokeWidth={3} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        <Tile icon={TrendingUp} label="Total policies sold" value={formatCount(total)} />
        <Tile
          icon={Trophy}
          label="Top performer"
          value={topPerformer ? topPerformer.name : "—"}
          subtitle={
            !summaryReady ? "Agent summary not loaded" : topPerformer ? policiesLabel(topPerformer.policies_sold) : undefined
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
        Policies sold are counted from wins; one client can buy several policies.
      </p>
    </ReportSection>
  );
};

export default PoliciesSoldChart;
