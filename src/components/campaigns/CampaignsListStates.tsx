import React from "react";
import { AlertCircle, Megaphone, RotateCcw, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder; renders the same shell as the list so nothing jumps when rows arrive. */
export function CampaignsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div data-testid="campaigns-skeleton" role="status" aria-busy="true" aria-label="Loading campaigns"
      className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="flex h-10 items-center gap-6 border-b border-border/60 bg-muted/40 px-4">
        <Skeleton className="h-3 w-24" /><Skeleton className="hidden h-3 w-16 sm:block" /><Skeleton className="hidden h-3 w-28 sm:block" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 border-b border-border/40 px-4 py-3.5 last:border-b-0">
          <Skeleton className="h-4 w-4 rounded" />
          <div className="flex min-w-0 flex-1 items-center gap-2"><Skeleton className="h-4 w-48 max-w-full" /><Skeleton className="h-4 w-14" /></div>
          <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
          <Skeleton className="hidden h-2 w-40 md:block" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function CampaignsLoadError({ tooLarge, retryable = true, onRetry }: { tooLarge: boolean; retryable?: boolean; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-xl border border-border/60 bg-card px-6 py-16 text-center">
      <AlertCircle className="mb-3 h-8 w-8 text-destructive" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">
        {tooLarge ? "There are too many campaigns to display." : "Couldn't load campaigns."}
      </p>
      {!tooLarge && retryable && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-4 h-9 gap-2 rounded-lg">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />Retry
        </Button>
      )}
    </div>
  );
}

export function CampaignsEmpty({ action }: { action: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border/60 bg-card px-6 py-16 text-center">
      <Megaphone className="mb-3 h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">No campaigns yet</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function CampaignsFilteredEmpty({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border/60 bg-card px-6 py-16 text-center">
      <SearchX className="mb-3 h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">No campaigns match</p>
      <Button type="button" variant="outline" size="sm" onClick={onReset} className="mt-4 h-9 rounded-lg">Reset filters</Button>
    </div>
  );
}

/** One compact line for a failed background refresh or failed metrics; rows stay on screen. */
export function CampaignsNotice({ children, onRetry }: { children: React.ReactNode; onRetry: () => void }) {
  return (
    <div role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
      <AlertCircle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
      <span>{children}</span>
      <button type="button" onClick={onRetry}
        className="rounded font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Retry
      </button>
    </div>
  );
}
