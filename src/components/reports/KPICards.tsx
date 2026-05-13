import React from "react";
import { ReportCallSummary, formatDuration, formatHours } from "@/lib/reports-queries";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  summary?: ReportCallSummary;
  compSummary?: ReportCallSummary;
  comparing: boolean;
  loading: boolean;
}

const KPICards: React.FC<Props> = ({ summary, compSummary, comparing, loading }) => {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
    );
  }

  const renderTrend = (current: number, previous?: number, isDuration: boolean = false) => {
    if (!comparing || previous === undefined || previous === 0) return null;
    const diff = current - previous;
    const pct = (diff / previous) * 100;
    const isUp = diff >= 0;
    
    return (
      <div className={cn("flex items-center gap-1 text-[11px] font-medium mt-1", isUp ? "text-emerald-500" : "text-rose-500")}>
        {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        <span>{Math.abs(pct).toFixed(1)}% vs prev</span>
      </div>
    );
  };

  const totalCalls = summary?.total_calls || 0;
  const compTotalCalls = compSummary?.total_calls;
  
  const contacted = summary?.contacted || 0;
  const compContacted = compSummary?.contacted;
  
  const converted = summary?.converted || 0;
  const compConverted = compSummary?.converted;

  const totalDuration = summary?.total_duration_seconds || 0;
  const compTotalDuration = compSummary?.total_duration_seconds;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Total Calls */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between shadow-sm">
        <div>
          <p className="text-[12px] text-muted-foreground font-medium uppercase tracking-wider">Total Calls</p>
          <p className="text-[22px] font-medium text-foreground leading-tight mt-1">{totalCalls}</p>
        </div>
        <div>
          {renderTrend(totalCalls, compTotalCalls)}
        </div>
      </div>

      {/* Contacted */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between shadow-sm">
        <div>
          <p className="text-[12px] text-muted-foreground font-medium uppercase tracking-wider">Contacted</p>
          <p className="text-[22px] font-medium text-foreground leading-tight mt-1">{contacted}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mt-1">Rate: {summary?.answer_rate_pct || 0}%</p>
          {renderTrend(contacted, compContacted)}
        </div>
      </div>

      {/* Converted */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between shadow-sm">
        <div>
          <p className="text-[12px] text-muted-foreground font-medium uppercase tracking-wider">Converted</p>
          <p className="text-[22px] font-medium text-foreground leading-tight mt-1">{converted}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mt-1">Rate: {summary?.conversion_rate_pct || 0}%</p>
          {renderTrend(converted, compConverted)}
        </div>
      </div>

      {/* Talk Time */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between shadow-sm">
        <div>
          <p className="text-[12px] text-muted-foreground font-medium uppercase tracking-wider">Talk Time</p>
          <p className="text-[22px] font-medium text-foreground leading-tight mt-1">{formatHours(totalDuration)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mt-1">Avg: {formatDuration(summary?.avg_duration_seconds || 0)}</p>
          {renderTrend(totalDuration, compTotalDuration, true)}
        </div>
      </div>
    </div>
  );
};

export default KPICards;
