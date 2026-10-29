import React from "react";
import { cn } from "@/lib/utils";
import { DASHBOARD_TONES, type DashboardTone } from "@/components/dashboard/ui/dashboardTones";

/** A status label. Always text, so meaning never depends on color alone. */
export const DashboardStatusPill: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => (
  <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", className)}>
    {children}
  </span>
);

/** A tinted 40 px icon well at the start of a row. */
export const DashboardIconWell: React.FC<{ tone: DashboardTone; icon: React.ElementType; label?: string }> = ({
  tone,
  icon: Icon,
  label,
}) => (
  <span
    className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", DASHBOARD_TONES[tone].soft)}
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  >
    <Icon className={cn("h-5 w-5", DASHBOARD_TONES[tone].text)} aria-hidden="true" />
  </span>
);

/** List wrapper: rows are list items, so screen readers announce the count. */
export const DashboardList: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({
  label,
  children,
  className,
}) => (
  <ul aria-label={label} className={cn("space-y-2", className)}>
    {children}
  </ul>
);

interface DashboardListRowProps {
  tone: DashboardTone;
  leading: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  /** Extra content under the meta line (a note, a voicemail player). */
  detail?: React.ReactNode;
  status?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  testId?: string;
}

/**
 * One Dashboard row. Readable type (14 px title, 12 px meta), a visible ring while a
 * control inside has keyboard focus, and actions that wrap under the text on a narrow
 * screen instead of squeezing it.
 */
export const DashboardListRow: React.FC<DashboardListRowProps> = ({
  tone,
  leading,
  title,
  meta,
  detail,
  status,
  actions,
  className,
  testId,
}) => (
  <li
    data-testid={testId}
    className={cn(
      // A short fade-in only; none at all under prefers-reduced-motion.
      "animate-in fade-in-0 duration-150 motion-reduce:animate-none",
      "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/60 bg-card/60 px-3 py-2.5",
      "transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-background",
      "motion-reduce:transition-none sm:flex-nowrap",
      DASHBOARD_TONES[tone].rowRing,
      className,
    )}
  >
    <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
      {leading}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        {meta && <p className="line-clamp-2 break-words text-xs text-muted-foreground">{meta}</p>}
        {detail}
      </div>
    </div>
    {(status || actions) && (
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
        {status}
        {actions}
      </div>
    )}
  </li>
);

/** Shown only after a SUCCESSFUL empty read — never for a failure. */
export const DashboardEmptyState: React.FC<{
  tone: DashboardTone;
  icon: React.ElementType;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  notice?: React.ReactNode;
}> = ({ tone, icon: Icon, title, hint, action, notice }) => (
  <div className="flex flex-col items-center py-8 text-center">
    {notice}
    <span className={cn("mb-3 flex h-14 w-14 items-center justify-center rounded-full", DASHBOARD_TONES[tone].soft)}>
      <Icon className={cn("h-7 w-7 opacity-70", DASHBOARD_TONES[tone].text)} aria-hidden="true" />
    </span>
    <p className="text-sm font-medium text-foreground">{title}</p>
    {hint && <p className="mt-1 max-w-xs text-xs text-muted-foreground">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** Loading placeholder rows (no motion when reduced motion is requested). */
export const DashboardRowSkeleton: React.FC<{ rows?: number }> = ({ rows = 3 }) => (
  <div className="space-y-2" aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/30 motion-reduce:animate-none" />
    ))}
  </div>
);
