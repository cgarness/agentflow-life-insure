import React from "react";
import {
  AlertCircle, BellRing, Cake, CalendarClock, CalendarDays, CalendarHeart, Check, CheckCircle2, Clock, EyeOff,
  PhoneMissed, Smartphone, UserX, Voicemail, Wallet, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DASHBOARD_STATUS, DASHBOARD_TONES, type DashboardStatusKey, type DashboardTone } from "@/components/dashboard/ui/dashboardTones";

/** A status label. Always text, so meaning never depends on color alone. */
export const DashboardStatusPill: React.FC<{ className: string; icon?: React.ElementType; children: React.ReactNode }> = ({
  className,
  icon: Icon,
  children,
}) => (
  <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", className)}>
    {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
    {children}
  </span>
);

const STATUS_ICONS: Record<DashboardStatusKey, React.ElementType> = {
  scheduled: CalendarClock, overdue: AlertCircle, dueToday: Clock, upcoming: CalendarDays,
  missed: PhoneMissed, voicemail: Voicemail, answeredOnMobile: Smartphone,
  // EyeOff, not a check mark: hidden from this Dashboard, never "done".
  cleared: EyeOff, dismissed: EyeOff,
  firstPayment: Wallet, birthday: Cake, anniversary: CalendarHeart, followUp: BellRing, needsReview: AlertCircle,
  snoozed: BellRing, confirmed: CheckCircle2, completed: Check, noShow: UserX, cancelled: XCircle,
};

/** One of the shared status badges (`DASHBOARD_STATUS`); `label` overrides its text. */
export const DashboardStatusBadge: React.FC<{ status: DashboardStatusKey; label?: string; testId?: string }> = ({ status, label, testId }) => (
  <span data-testid={testId} data-status={status} className="inline-flex">
    <DashboardStatusPill className={DASHBOARD_STATUS[status].className} icon={STATUS_ICONS[status]}>
      {label ?? DASHBOARD_STATUS[status].label}
    </DashboardStatusPill>
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
  /** Extra content under the meta line (a note, a voicemail player, an owner chip). */
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
      "flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-xl border border-border/60 bg-card/60 px-3 py-3",
      "transition-colors hover:border-border hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-background",
      // Actions wrap under the text whenever the row is too narrow for both (a phone, a half-width widget).
      "motion-reduce:transition-none",
      DASHBOARD_TONES[tone].rowRing,
      className,
    )}
  >
    <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
      {leading}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-semibold leading-5 text-foreground">{title}</p>
        {meta && <p className="line-clamp-2 break-words text-xs leading-4 text-muted-foreground">{meta}</p>}
        {detail}
      </div>
    </div>
    {(status || actions) && (
      // On a phone the status and actions take their own full-width line and wrap; from `sm` they sit at the end.
      <div className="ml-auto flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:shrink-0">
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
