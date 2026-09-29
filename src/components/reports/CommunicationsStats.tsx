import React from "react";
import { Clock, Headphones, Percent, Phone, PhoneIncoming, Timer, TrendingUp, UserCheck, type LucideIcon } from "lucide-react";
import type { ReportSummary } from "@/lib/reports-schemas";
import { formatCount, formatDuration, formatHours, formatRate, ratio } from "@/lib/reports-format";
import type { ReportExportFn, CsvCell } from "@/lib/reports-export";
import ReportSection from "./ReportSection";

interface Props {
  summary: ReportSummary;
  /** Number of AGENCY calendar days in the report window. */
  dayCount: number;
  onExport?: ReportExportFn;
}

interface Metric {
  icon: LucideIcon;
  label: string;
  value: string;
  subtitle?: string;
  /** Export label and raw value (numbers stay numbers; an undefined value is null, never 0). */
  exportLabel: string;
  raw: CsvCell;
}

const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

const StatTile: React.FC<Omit<Metric, "exportLabel" | "raw">> = ({ icon: Icon, label, value, subtitle }) => (
  <div className="rounded-xl border border-border/50 bg-muted/40 p-4">
    <div className="flex items-center gap-2 mb-2">
      <Icon className="w-3.5 h-3.5 text-primary" />
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">{label}</p>
    </div>
    <p className="text-xl font-bold text-foreground tracking-tight truncate" title={value}>{value}</p>
    {subtitle && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{subtitle}</p>}
  </div>
);

/**
 * Call Summary — totals straight from the secured summary RPC. Rates come from the server
 * (`null` → "—"); the only client-side figure is calls made per agency day, from two canonical counts.
 */
const CommunicationsStats: React.FC<Props> = ({ summary, dayCount, onExport }) => {
  const t = summary.totals;
  const callsPerDay = round1(ratio(t.calls_made, dayCount));

  const metrics: Metric[] = [
    {
      icon: Phone,
      label: "Calls made",
      value: formatCount(t.calls_made),
      subtitle: "Outbound dials",
      exportLabel: "Calls made (outbound)",
      raw: t.calls_made,
    },
    {
      icon: PhoneIncoming,
      label: "Inbound calls",
      value: formatCount(t.inbound_calls),
      exportLabel: "Inbound calls",
      raw: t.inbound_calls,
    },
    {
      icon: UserCheck,
      label: "Contacted",
      value: formatCount(t.contacted),
      subtitle: "Outbound calls that reached a contact",
      exportLabel: "Contacted",
      raw: t.contacted,
    },
    {
      icon: Percent,
      label: "Call contact rate",
      value: formatRate(t.contact_rate_pct),
      subtitle: "Contacted calls ÷ calls made",
      exportLabel: "Call contact rate (%)",
      raw: t.contact_rate_pct,
    },
    {
      icon: Clock,
      label: "Talk time",
      value: formatHours(t.talk_time_seconds),
      subtitle: "On calls made",
      exportLabel: "Talk time (seconds)",
      raw: t.talk_time_seconds,
    },
    {
      icon: Timer,
      label: "Avg talk time per dial",
      value: formatDuration(t.avg_talk_per_dial_seconds),
      exportLabel: "Avg talk time per dial (seconds)",
      raw: t.avg_talk_per_dial_seconds,
    },
    {
      icon: TrendingUp,
      label: "Calls made per day",
      value: callsPerDay === null ? "—" : callsPerDay.toFixed(1),
      subtitle: `Over ${formatCount(dayCount)} ${dayCount === 1 ? "day" : "days"}`,
      exportLabel: "Calls made per day",
      raw: callsPerDay,
    },
    {
      icon: Headphones,
      label: "Inbound talk time",
      value: formatHours(t.inbound_talk_seconds),
      exportLabel: "Inbound talk time (seconds)",
      raw: t.inbound_talk_seconds,
    },
  ];

  const handleExport = onExport
    ? () => onExport("Call Summary", ["Metric", "Value"], metrics.map((m) => [m.exportLabel, m.raw]))
    : undefined;

  return (
    <ReportSection title="Call Summary" onExport={handleExport}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <StatTile key={m.label} icon={m.icon} label={m.label} value={m.value} subtitle={m.subtitle} />
        ))}
      </div>
    </ReportSection>
  );
};

export default CommunicationsStats;
