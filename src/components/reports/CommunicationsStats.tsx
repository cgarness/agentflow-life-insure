import React, { useMemo } from "react";
import { Phone, MessageSquare, Mail, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, formatHours, downloadCSV, DateRange } from "@/lib/reports-queries";
import { differenceInDays } from "date-fns";
import ReportSection from "./ReportSection";

interface Props { calls: any[]; compCalls?: any[]; range: DateRange; loading: boolean; comparing: boolean; }

const StatCard = ({ label, value, compValue, comparing }: { label: string; value: string; compValue?: string; comparing: boolean }) => {
  return (
    <div className="bg-accent/50 rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
      {comparing && compValue && <p className="text-xs text-muted-foreground mt-0.5">prev: {compValue}</p>}
    </div>
  );
};

const CommunicationsStats: React.FC<Props> = ({ calls, compCalls, range, loading, comparing }) => {
  const compute = (c: any[], r: DateRange) => {
    const outbound = c.filter(x => x.direction === "outbound").length;
    const inbound = c.filter(x => x.direction === "inbound").length;
    const withDur = c.filter(x => (x.duration || 0) > 0);
    const avgDur = withDur.length > 0 ? withDur.reduce((s, x) => s + (x.duration || 0), 0) / withDur.length : 0;
    const answerRate = c.length > 0 ? Math.round(withDur.length / c.length * 100) : 0;
    const days = Math.max(1, differenceInDays(r.end, r.start) + 1);
    const callsPerDay = +(c.length / days).toFixed(1);
    const totalTalkTime = c.reduce((s, x) => s + (x.duration || 0), 0);
    const longest = c.reduce((best, x) => (x.duration || 0) > (best?.duration || 0) ? x : best, c[0]);
    const shortestConn = withDur.reduce((best, x) => !best || x.duration < best.duration ? x : best, null as any);
    return { outbound, inbound, avgDur, answerRate, callsPerDay, totalTalkTime, longest, shortestConn };
  };

  const stats = useMemo(() => compute(calls, range), [calls, range]);
  const compStats = useMemo(() => compCalls ? compute(compCalls, range) : null, [compCalls, range]);

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Calls/Day" value={String(stats.callsPerDay)} comparing={false} />
          <StatCard label="Total Talk Time" value={formatHours(stats.totalTalkTime)} comparing={false} />
          <StatCard label="Longest Call" value={stats.longest ? `${formatDuration(stats.longest.duration)} — ${stats.longest.contact_name || "Unknown"}` : "—"} comparing={false} />
          <StatCard label="Shortest Connected" value={stats.shortestConn ? `${formatDuration(stats.shortestConn.duration)} — ${stats.shortestConn.contact_name || "Unknown"}` : "—"} comparing={false} />
        </div>

        {/* SMS placeholder */}
        <div className="bg-accent/30 rounded-lg p-4 opacity-60 flex items-center gap-3">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground flex-1">SMS analytics available when Twilio SMS is configured</span>
          <Lock className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        {/* Email placeholder */}
        <div className="bg-accent/30 rounded-lg p-4 opacity-60 flex items-center gap-3">
          <Mail className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground flex-1">Email analytics available when SMTP is configured</span>
          <Lock className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      </div>
    </ReportSection>
  );
};

export default CommunicationsStats;
