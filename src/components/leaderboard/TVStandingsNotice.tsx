import React from "react";
import { AlertTriangle, Loader2, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Period } from "@/components/leaderboard/leaderboardTypes";
import { LeaderboardRetryButton } from "@/components/leaderboard/LeaderboardErrorBanner";
import { type StandingsStatus, standingsDetail } from "@/lib/leaderboardStatusCopy";

const PERIODS: { value: Period; label: string }[] = [
  { value: "Today", label: "Today" },
  { value: "This Week", label: "Week" },
  { value: "This Month", label: "Month" },
];

interface TVStandingsNoticeProps {
  /** "full" replaces the board when nothing is loaded; "strip" sits above a stale board. */
  variant: "full" | "strip";
  /** Still loading the first standings for this selection. */
  loading?: boolean;
  headline: string;
  status: StandingsStatus;
  period: Period;
  onPeriodChange: (period: Period) => void;
  onRetry?: () => void;
  formatTime: (ms: number) => string;
}

/**
 * TV mode's truthful state: never an empty podium or zero totals presented as
 * live. The full notice keeps the period buttons so a wall display can switch
 * period without leaving TV mode.
 */
const TVStandingsNotice: React.FC<TVStandingsNoticeProps> = ({
  variant,
  loading = false,
  headline,
  status,
  period,
  onPeriodChange,
  onRetry,
  formatTime,
}) => {
  const paused = status.kind === "maintenance" || status.kind === "busy";
  const Icon = loading ? Loader2 : paused ? PauseCircle : AlertTriangle;
  const detail = loading ? "" : standingsDetail(status, variant === "strip", Date.now(), formatTime);

  if (variant === "strip") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mx-auto flex w-full max-w-[72rem] shrink-0 items-center justify-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-2.5 text-center"
      >
        <Icon className={cn("h-5 w-5 shrink-0 text-amber-300", loading && "animate-spin")} />
        <p className="text-sm font-semibold text-amber-100">
          {loading ? "Loading standings for this period…" : `${headline} ${detail}`}
        </p>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <Icon className={cn("h-16 w-16 text-slate-400", loading && "animate-spin")} />
      <div className="max-w-2xl space-y-3">
        <h2 className="text-3xl font-black tracking-tight text-white">{loading ? "Loading standings…" : headline}</h2>
        {detail && <p className="text-lg text-slate-300">{detail}</p>}
      </div>
      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onPeriodChange(p.value)}
            aria-pressed={period === p.value}
            className={cn(
              "rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest transition-colors",
              period === p.value ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {!loading && !paused && !status.offline && onRetry && (
        <LeaderboardRetryButton
          onRetry={onRetry}
          availableAt={status.manualAvailableAt}
          className="border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
          formatTime={formatTime}
        />
      )}
    </div>
  );
};

export default TVStandingsNotice;
