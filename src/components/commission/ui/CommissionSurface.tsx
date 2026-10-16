import React from "react";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Presentational building blocks shared by the Commission Calculator and Settings › Commission Grids.
 * Theme tokens only (card / muted / border / primary / success / warning / destructive), so light and
 * dark both read correctly. No data, no state, no behaviour.
 */

/** A small tinted square holding a section icon. */
export const IconTile: React.FC<{ icon: LucideIcon; tone?: "primary" | "muted" | "warning" | "destructive"; className?: string }> = ({
  icon: Icon,
  tone = "primary",
  className,
}) => (
  <span
    className={cn(
      "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
      tone === "primary" && "bg-primary/10 text-primary ring-primary/15",
      tone === "muted" && "bg-muted text-muted-foreground ring-border/60",
      tone === "warning" && "bg-warning/10 text-warning ring-warning/20",
      tone === "destructive" && "bg-destructive/10 text-destructive ring-destructive/20",
      className,
    )}
    aria-hidden
  >
    <Icon className="h-4 w-4" />
  </span>
);

/** Section header: icon tile, title (+ optional count), one-line description and right-aligned actions. */
export const SectionHeader: React.FC<{
  icon?: LucideIcon;
  title: React.ReactNode;
  count?: number;
  description?: React.ReactNode;
  action?: React.ReactNode;
  as?: "h2" | "h3";
}> = ({ icon, title, count, description, action, as: Heading = "h2" }) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex min-w-0 items-center gap-3">
      {icon && <IconTile icon={icon} />}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Heading className="text-sm font-semibold tracking-tight text-foreground">{title}</Heading>
          {count !== undefined && (
            <span className="rounded-md bg-muted px-1.5 py-px text-[11px] font-medium tabular-nums text-muted-foreground">{count}</span>
          )}
        </div>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
    {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
  </div>
);

/** A soft-bordered surface with a header and a body. */
export const SurfaceSection: React.FC<
  React.ComponentProps<typeof SectionHeader> & { className?: string; bodyClassName?: string; children?: React.ReactNode }
> = ({ className, bodyClassName, children, ...header }) => (
  <section className={cn("rounded-xl border border-border/60 bg-card shadow-sm", className)}>
    <div className="px-4 py-3.5 sm:px-5">
      <SectionHeader {...header} />
    </div>
    {children !== undefined && <div className={cn("border-t border-border/50 px-4 py-4 sm:px-5", bodyClassName)}>{children}</div>}
  </section>
);

/** Small status pill with a coloured dot. */
export const StatusPill: React.FC<{ tone: "success" | "warning" | "primary" | "muted"; children: React.ReactNode; className?: string }> = ({
  tone,
  children,
  className,
}) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
      tone === "success" && "bg-success/10 text-success ring-success/20",
      tone === "warning" && "bg-warning/10 text-warning ring-warning/25",
      tone === "primary" && "bg-primary/10 text-primary ring-primary/20",
      tone === "muted" && "bg-muted text-muted-foreground ring-border/70",
      className,
    )}
  >
    <span
      className={cn(
        "h-1.5 w-1.5 rounded-full",
        tone === "success" && "bg-success",
        tone === "warning" && "bg-warning",
        tone === "primary" && "bg-primary",
        tone === "muted" && "bg-muted-foreground/60",
      )}
      aria-hidden
    />
    {children}
  </span>
);

/** Centered empty / no-access / error state. */
export const StatePanel: React.FC<{
  icon: LucideIcon;
  title?: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "muted" | "warning" | "destructive";
  dashed?: boolean;
  compact?: boolean;
  role?: "alert" | "status";
  className?: string;
}> = ({ icon, title, body, action, tone = "muted", dashed, compact, role, className }) => (
  <div
    role={role}
    className={cn(
      "flex flex-col items-center justify-center text-center",
      compact ? "gap-2 px-4 py-6" : "min-h-[240px] gap-3 px-6 py-10",
      dashed && "rounded-xl border border-dashed border-border/80 bg-muted/20",
      className,
    )}
  >
    <IconTile icon={icon} tone={tone} className={compact ? undefined : "h-11 w-11 rounded-xl [&>svg]:h-5 [&>svg]:w-5"} />
    <div className="max-w-md space-y-1">
      {title && <p className="text-sm font-semibold text-foreground">{title}</p>}
      {body && <p className="text-sm text-muted-foreground">{body}</p>}
    </div>
    {action}
  </div>
);

/** Skeleton lines with a screen-reader status label (the label is the visible-loading text it replaces). */
export const LoadingBlock: React.FC<{ label: string; rows?: number; className?: string }> = ({ label, rows = 3, className }) => (
  <div role="status" className={cn("space-y-3", className)}>
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, i) => (
      <Skeleton key={i} className={cn("h-10 w-full rounded-lg", i === rows - 1 && rows > 1 && "w-2/3")} />
    ))}
  </div>
);

/** One row of a grid list (Settings › Commission Grids). */
export const GRID_ROW =
  "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md px-2 py-3 transition-colors hover:bg-muted/40";
