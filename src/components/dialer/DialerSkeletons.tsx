import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function HistorySkeleton() {
  return (
    <div className="space-y-4 animate-in fade-in duration-500">
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
