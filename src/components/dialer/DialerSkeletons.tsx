import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function HistorySkeleton() {
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-start gap-3">
          <Skeleton className="w-7 h-7 rounded-full shrink-0 bg-accent/30" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-3/4 bg-accent/20" />
            </div>
            <Skeleton className="h-3 w-1/4 bg-accent/20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LeadInfoSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 animate-in fade-in duration-500">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-2 w-12 bg-accent/30" />
          <Skeleton className="h-4 w-full bg-accent/20" />
        </div>
      ))}
    </div>
  );
}

/** Campaign-selection table loading state — table-row skeletons, not card blocks. */
export function CampaignTableSkeleton({ columns = 6 }: { columns?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card shadow-sm animate-in fade-in duration-200">
      <div className="flex items-center gap-4 border-b border-border px-4 py-3">
        {Array.from({ length: columns }).map((_, j) => (
          <Skeleton key={j} className="h-3 w-24 bg-accent/30" />
        ))}
      </div>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          data-testid="campaign-table-skeleton-row"
          className="flex items-center gap-4 border-b border-border/50 px-4 py-4 last:border-b-0"
        >
          {Array.from({ length: columns }).map((_, j) => (
            <Skeleton key={j} className={j === 0 ? "h-4 w-40 bg-accent/20" : "h-4 w-20 bg-accent/20"} />
          ))}
        </div>
      ))}
    </div>
  );
}
