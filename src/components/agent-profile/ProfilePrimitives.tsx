/**
 * Shared presentational primitives for the Agent Profile and Team Profile.
 *
 * Every colour here is a THEME TOKEN (`bg-card`, `text-muted-foreground`, `border-border`,
 * `text-primary`, `text-success`, `text-warning`, `text-destructive`). Nothing is a raw hex value
 * and nothing is defined only under `dark:`, so both themes stay readable without a second
 * definition to keep in sync. The semantic mapping is fixed and applied consistently:
 *
 *     primary (blue)   the page accent, and every neutral data bar
 *     success (green)  ONLY a healthy / completed state
 *     warning (amber)  ONLY something that needs attention soon
 *     destructive (red) ONLY an actual problem
 *     muted            "no evidence either way" — which is NOT the same as healthy
 *
 * That last line is load-bearing: a licence with no expiration date on file is unknown, not
 * current, and rendering it green is an assertion the data does not support.
 */

import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** A section shell: title, optional description and action, and a bordered body. */
export const ProfileSection: React.FC<{
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ title, description, action, className, children }) => (
  <Card className={cn("border-border/60 bg-card shadow-sm", className)}>
    <CardContent className="p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </CardContent>
  </Card>
);

/**
 * A premium stat tile.
 *
 * `hint` is not decoration. Several of these numbers have a definition that is not obvious from the
 * label — "Total Policies" counts additional policies, "Total Monthly Premium" is not annualized —
 * and stating it on the tile is what keeps the page honest rather than merely impressive.
 */
export const StatTile: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  caveat?: string;
  icon?: React.ReactNode;
}> = ({ label, value, hint, caveat, icon }) => (
  <div className="group relative overflow-hidden rounded-xl border border-border/60 bg-card p-5 transition-colors hover:border-primary/30">
    <div className="flex items-start justify-between gap-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {icon && <span className="shrink-0 text-muted-foreground/70">{icon}</span>}
    </div>
    <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
      {value}
    </p>
    {hint && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    {caveat && (
      <p className="mt-1.5 text-xs leading-relaxed text-warning">{caveat}</p>
    )}
    <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary/40 opacity-0 transition-opacity group-hover:opacity-100" />
  </div>
);

/** A label whose definition is worth stating, without spending a line on it. */
export const DefinitionHint: React.FC<{ children: React.ReactNode; text: string }> = ({
  children,
  text,
}) => (
  <TooltipProvider delayDuration={200}>
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help border-b border-dotted border-muted-foreground/50">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

/**
 * What a section renders when its query FAILED.
 *
 * This is the whole reason the data layer throws instead of coalescing to `[]`. A failed aggregate
 * must never be able to render as a confident zero, so this component shows no number at all — only
 * what happened and a way to try again.
 */
export const MetricUnavailable: React.FC<{
  title?: string;
  onRetry?: () => void;
  className?: string;
}> = ({ title = "This section couldn't load", onRetry, className }) => (
  <div
    className={cn(
      "flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5",
      className,
    )}
  >
    <div className="flex items-start gap-3">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The figures are unavailable right now, so none are shown. This is not a zero.
        </p>
      </div>
    </div>
    {onRetry && (
      <Button variant="outline" size="sm" onClick={onRetry} className="ml-7">
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        Try again
      </Button>
    )}
  </div>
);

/** A truthful empty state: the query succeeded and there is genuinely nothing yet. */
export const ProfileEmptyState: React.FC<{
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ title, description, icon, action, className }) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center",
      className,
    )}
  >
    {icon && <div className="mb-3 text-muted-foreground/60">{icon}</div>}
    <p className="text-sm font-medium text-foreground">{title}</p>
    {description && (
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
    )}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** Loading placeholder sized to the section it stands in for. */
export const ProfileSkeletonBlock: React.FC<{ rows?: number; className?: string }> = ({
  rows = 3,
  className,
}) => (
  <div className={cn("space-y-3", className)}>
    {Array.from({ length: rows }).map((_, i) => (
      <Skeleton key={i} className="h-10 w-full" />
    ))}
  </div>
);

/** A horizontal share bar. Always `primary`; a per-row rainbow would imply meaning that is absent. */
export const ShareBar: React.FC<{ percent: number; className?: string }> = ({
  percent,
  className,
}) => (
  <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-accent", className)}>
    <div
      className="h-full rounded-full bg-primary transition-all"
      style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
    />
  </div>
);
