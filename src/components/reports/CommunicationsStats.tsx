import React, { useMemo } from "react";
import { Download, Phone, MessageSquare, Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, downloadCSV } from "@/lib/reports-queries";

interface Props {
  calls: any[];
  loading: boolean;
}

const CommunicationsStats: React.FC<Props> = ({ calls, loading }) => {
  const stats = useMemo(() => {
    const outbound = calls.filter(c => c.direction === "outbound").length;
    const inbound = calls.filter(c => c.direction === "inbound").length;
    const withDuration = calls.filter(c => (c.duration || 0) > 0);
    const avgDuration = withDuration.length > 0
      ? withDuration.reduce((sum, c) => sum + (c.duration || 0), 0) / withDuration.length
      : 0;
    const answerRate = calls.length > 0 ? Math.round(withDuration.length / calls.length * 100) : 0;
    return { outbound, inbound, avgDuration, answerRate };
  }, [calls]);

  const handleExport = () => {
    downloadCSV("communications-stats", ["Metric", "Value"], [
      ["Outbound Calls", String(stats.outbound)],
      ["Inbound Calls", String(stats.inbound)],
      ["Average Duration", formatDuration(stats.avgDuration)],
      ["Answer Rate", `${stats.answerRate}%`],
    ]);
  };

  if (loading) return <div className="bg-card rounded-xl border p-5 space-y-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;

  return (
    <div className="space-y-4">
      {/* Calls */}
      <div className="bg-card rounded-xl border p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-foreground text-sm">Calls</h3>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport}><Download className="w-3.5 h-3.5" /></Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-accent/50 rounded-lg p-3"><p className="text-xs text-muted-foreground">Outbound</p><p className="text-lg font-bold text-foreground">{stats.outbound}</p></div>
          <div className="bg-accent/50 rounded-lg p-3"><p className="text-xs text-muted-foreground">Inbound</p><p className="text-lg font-bold text-foreground">{stats.inbound}</p></div>
          <div className="bg-accent/50 rounded-lg p-3"><p className="text-xs text-muted-foreground">Avg Duration</p><p className="text-lg font-bold text-foreground">{formatDuration(stats.avgDuration)}</p></div>
          <div className="bg-accent/50 rounded-lg p-3"><p className="text-xs text-muted-foreground">Answer Rate</p><p className="text-lg font-bold text-foreground">{stats.answerRate}%</p></div>
        </div>
      </div>

      {/* SMS Placeholder */}
      <div className="bg-card rounded-xl border p-5 opacity-60">
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-muted-foreground text-sm">SMS</h3>
          <Lock className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
        </div>
        <p className="text-xs text-muted-foreground">SMS analytics will be available when Telnyx SMS is configured in Settings</p>
      </div>

      {/* Email Placeholder */}
      <div className="bg-card rounded-xl border p-5 opacity-60">
        <div className="flex items-center gap-2 mb-2">
          <Mail className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-muted-foreground text-sm">Email</h3>
          <Lock className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
        </div>
        <p className="text-xs text-muted-foreground">Email analytics will be available when SMTP is configured in Settings</p>
      </div>
    </div>
  );
};

export default CommunicationsStats;
