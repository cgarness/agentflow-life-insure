import React, { useMemo } from "react";
import { Phone, MessageSquare, Mail, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, formatHours, downloadCSV, DateRange, ReportCallSummary } from "@/lib/reports-queries";
import { differenceInDays } from "date-fns";
import ReportSection from "./ReportSection";

interface Props { summary?: ReportCallSummary; compSummary?: ReportCallSummary; range: DateRange; loading: boolean; comparing: boolean; }

const StatCard = ({ label, value, compValue, comparing }: { label: string; value: string; compValue?: string; comparing: boolean }) => {
  return (
    <div className="bg-accent/50 rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
      {comparing && compValue && <p className="text-xs text-muted-foreground mt-0.5">prev: {compValue}</p>}
    </div>
  );
};

const CommunicationsStats: React.FC<Props> = ({ summary, compSummary, range, loading, comparing }) => {
  const compute = (s: ReportCallSummary | undefined, r: DateRange) => {
    if (!s) return { outbound: 0, inbound: 0, avgDur: 0, answerRate: 0, callsPerDay: 0, totalTalkTime: 0 };
    const days = Math.max(1, differenceInDays(r.end, r.start) + 1);
    const callsPerDay = +(s.total_calls / days).toFixed(1);
    return {
      outbound: s.outbound,
      inbound: s.inbound,
      avgDur: s.avg_duration_seconds,
      answerRate: s.answer_rate_pct,
      callsPerDay,
      totalTalkTime: s.total_duration_seconds,
    };
  };

  const stats = useMemo(() => compute(summary, range), [summary, range]);
  const compStats = useMemo(() => compSummary ? compute(compSummary, range) : null, [compSummary, range]);

  const handleExport = () => {
    downloadCSV("communications-stats", ["Metric", "Value"], [
      ["Outbound", String(stats.outbound)], ["Inbound", String(stats.inbound)],
      ["Avg Duration", formatDuration(stats.avgDur)], ["Answer Rate", `${stats.answerRate}%`],
      ["Calls/Day", String(stats.callsPerDay)], ["Total Talk Time", formatHours(stats.totalTalkTime)],
    ]);
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-[300px]" /></div>;

  return (
    <ReportSection title="Communications Stats" onExport={handleExport}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Phone className="w-4 h-4 text-primary" /><span className="text-sm font-semibold text-foreground">Calls</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Outbound" value={String(stats.outbound)} compValue={compStats ? String(compStats.outbound) : undefined} comparing={comparing} />
          <StatCard label="Inbound" value={String(stats.inbound)} compValue={compStats ? String(compStats.inbound) : undefined} comparing={comparing} />
          <StatCard label="Avg Duration" value={formatDuration(stats.avgDur)} compValue={compStats ? formatDuration(compStats.avgDur) : undefined} comparing={comparing} />
          <StatCard label="Answer Rate" value={`${stats.answerRate}%`} compValue={compStats ? `${compStats.answerRate}%` : undefined} comparing={comparing} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
          <StatCard label="Calls/Day" value={String(stats.callsPerDay)} comparing={false} />
          <StatCard label="Total Talk Time" value={formatHours(stats.totalTalkTime)} comparing={false} />
        </div>
      </div>
    </ReportSection>
  );
};

export default CommunicationsStats;
