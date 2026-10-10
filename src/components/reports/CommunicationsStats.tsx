import React from "react";
import type { ReportSummary } from "@/lib/reports-schemas";
import { formatCount, formatElapsed, formatRate, ratio } from "@/lib/reports-format";
import type { ReportExportFn, CsvCell } from "@/lib/reports-export";
import ReportSection from "./ReportSection";

interface Props {
  summary: ReportSummary;
  /** Number of AGENCY calendar days in the report window. */
  dayCount: number;
  onExport?: ReportExportFn;
}

interface Metric {
  label: string;
  value: string;
  subtitle?: string;
  /** Export label and raw value (numbers stay numbers; an undefined value is null, never 0). */
  exportLabel: string;
  raw: CsvCell;
}

type ExportRow = [string, CsvCell];

const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

/**
 * Call Summary — totals straight from the secured summary RPC. Rates come from the server
 * (`null` → "—"); the only client-side figure is calls made per agency day, from two canonical counts.
 * The two premium rows stay in the CSV only: the production band shows those amounts on screen.
 */
const CommunicationsStats: React.FC<Props> = ({ summary, dayCount, onExport }) => {
  const t = summary.totals;
  const callsPerDay = round1(ratio(t.calls_made, dayCount));

  /** CSV-only rows, first as before, so the export rows are unchanged. */
  const premiumRows: ExportRow[] = [
    ["Known annual premium (current monthly ×12)", t.premium.annual_premium],
    ["Average annual premium per known policy", t.premium.average_annual_premium],
  ];

  const metrics: Metric[] = [
    { label: "Calls made", value: formatCount(t.calls_made), subtitle: "Outbound dials", exportLabel: "Calls made (outbound)", raw: t.calls_made },
    { label: "Inbound calls", value: formatCount(t.inbound_calls), exportLabel: "Inbound calls", raw: t.inbound_calls },
    {
      label: "Contacted calls",
      value: formatCount(t.contacted),
      subtitle: "Outbound calls that reached a contact",
      exportLabel: "Contacted",
      raw: t.contacted,
    },
    {
      label: "Call contact rate",
      value: formatRate(t.contact_rate_pct),
      subtitle: "Contacted calls ÷ calls made",
      exportLabel: "Call contact rate (%)",
      raw: t.contact_rate_pct,
    },
    { label: "Talk time", value: formatElapsed(t.talk_time_seconds), subtitle: "On calls made", exportLabel: "Talk time (seconds)", raw: t.talk_time_seconds },
    {
      label: "Avg talk time per dial",
      value: formatElapsed(t.avg_talk_per_dial_seconds, 1),
      exportLabel: "Avg talk time per dial (seconds)",
      raw: t.avg_talk_per_dial_seconds,
    },
    {
      label: "Calls made per day",
      value: callsPerDay === null ? "—" : callsPerDay.toFixed(1),
      subtitle: `Over ${formatCount(dayCount)} ${dayCount === 1 ? "day" : "days"}`,
      exportLabel: "Calls made per day",
      raw: callsPerDay,
    },
    {
      label: "Inbound talk time",
      value: formatElapsed(t.inbound_talk_seconds),
      exportLabel: "Inbound talk time (seconds)",
      raw: t.inbound_talk_seconds,
    },
  ];

  const handleExport = onExport
    ? () => onExport("Call Summary", ["Metric", "Value"], [...premiumRows, ...metrics.map((m): ExportRow => [m.exportLabel, m.raw])])
    : undefined;

  return (
    <ReportSection title="Call summary" defaultOpen={false} onExport={handleExport}>
      <dl className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="min-w-0 rounded-lg border border-border/50 bg-muted/30 p-3">
            <dt className="text-xs font-medium leading-4 text-muted-foreground [overflow-wrap:anywhere]">{m.label}</dt>
            <dd className="mt-1 text-lg font-semibold leading-6 tracking-tight tabular-nums text-foreground [overflow-wrap:anywhere]">{m.value}</dd>
            {m.subtitle && <dd className="mt-0.5 text-[11px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">{m.subtitle}</dd>}
          </div>
        ))}
      </dl>
    </ReportSection>
  );
};

export default CommunicationsStats;
