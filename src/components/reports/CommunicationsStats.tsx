import React, { useMemo } from "react";
import { Phone, MessageSquare, Mail, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, formatHours, downloadCSV, DateRange, ReportCallSummary } from "@/lib/reports-queries";
import { differenceInDays } from "date-fns";
import ReportSection from "./ReportSection";

interface Props { summary?: ReportCallSummary; range: DateRange; loading: boolean; }

const StatCard = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-accent/50 rounded-lg p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-lg font-bold text-foreground">{value}</p>
  </div>
);

const CommunicationsStats: React.FC<Props> = ({ summary, range, loading }) => {
  const stats = useMemo(() => {
    if (!summary) return { outbound: 0, inbound: 0, avgDur: 0, answerRate: 0, callsPerDay: 0, totalTalkTime: 0 };
    const days = Math.max(1, differenceInDays(range.end, range.start) + 1);
    return {
      outbound: summary.outbound,
      inbound: summary.inbound,
      avgDur: summary.avg_duration_seconds,
      answerRate: summary.answer_rate_pct,
      callsPerDay: +(summary.total_calls / days).toFixed(1),
      totalTalkTime: summary.total_duration_seconds,
    };
  }, [summary, range]);

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
          <StatCard label="Outbound" value={String(stats.outbound)} />
          <StatCard label="Inbound" value={String(stats.inbound)} />
          <StatCard label="Avg Duration" value={formatDuration(stats.avgDur)} />
          <StatCard label="Answer Rate" value={`${stats.answerRate}%`} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
          <StatCard label="Calls/Day" value={String(stats.callsPerDay)} />
          <StatCard label="Total Talk Time" value={formatHours(stats.totalTalkTime)} />
        </div>
      </div>
    </ReportSection>
  );
};

export default CommunicationsStats;
