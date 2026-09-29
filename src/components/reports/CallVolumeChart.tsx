import React, { useMemo } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { ReportVolume } from "@/lib/reports-schemas";
import { formatCount, groupDailySeries, type Grouping } from "@/lib/reports-format";
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
const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
  fontSize: 12,
};

/** Unambiguous period cell for CSV (includes the year, unlike the short on-screen label). */
function periodCell(first: string, last: string): string {
  return first === last ? first : `${first} to ${last}`;
}

/**
 * Call Volume — outbound calls made (bars), contacted and inbound (lines), regrouped from the
 * server's zero-filled AGENCY-calendar daily series. Sums of daily counts are exact at any grouping.
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
      })),
    [volume.by_date, grouping],
  );

  const totals = useMemo(
    () =>
      series.reduce(
        (acc, b) => ({ calls: acc.calls + b.calls_made, inbound: acc.inbound + b.inbound_calls }),
        { calls: 0, inbound: 0 },
      ),
    [series],
  );
  const isEmpty = totals.calls === 0 && totals.inbound === 0;
  const showInbound = totals.inbound > 0;

  const handleExport = onExport
    ? () =>
        onExport(
          "Call Volume",
          ["Period", "Calls made", "Contacted", "Inbound"],
          series.map((b) => [periodCell(b.first, b.last), b.calls_made, b.contacted, b.inbound_calls]),
        )
    : undefined;

  return (
    <ReportSection title="Call Volume" onExport={handleExport}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex items-center gap-1 rounded-xl bg-muted/60 p-1" role="group" aria-label="Group by">
          {GROUPINGS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onGroupingChange(g)}
              aria-pressed={g === grouping}
              className={cn(
                "px-3 py-1 text-[11px] font-bold uppercase tracking-widest rounded-lg transition-colors",
                g === grouping ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g}
            </button>
          ))}
        </div>
        {!isEmpty && (
          <p className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
            {formatCount(totals.calls)} calls made
            {showInbound && ` · ${formatCount(totals.inbound)} inbound`}
          </p>
        )}
      </div>

      {isEmpty ? (
        <p className="text-sm text-muted-foreground text-center py-12">No calls in this period.</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} minTickGap={12} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
              cursor={{ fill: "hsl(var(--muted-foreground))", fillOpacity: 0.08 }}
              formatter={(value: number, name: string) => [formatCount(value), name]}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <Bar dataKey="calls_made" name="Calls made" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={48} />
            <Line type="monotone" dataKey="contacted" name="Contacted" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 3 }} />
            {showInbound && (
              <Line
                type="monotone"
                dataKey="inbound_calls"
                name="Inbound"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 2 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ReportSection>
  );
};

export default CallVolumeChart;
