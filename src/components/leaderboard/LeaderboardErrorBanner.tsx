import React, { useId } from "react";
import { AlertTriangle, PauseCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTimeReached } from "@/hooks/useTimeReached";
import {
  type StandingsStatus,
  STANDINGS_STATUS_OK,
  formatStatusTime,
  retryAvailableCopy,
  standingsDetail,
} from "@/lib/leaderboardStatusCopy";

interface LeaderboardRetryButtonProps {
  onRetry: () => void;
  /** Earliest accepted retry; before it the control is aria-disabled but stays focusable. */
  availableAt: number | null;
  size?: "sm" | "default";
  className?: string;
  formatTime?: (ms: number) => string;
}

/**
 * Retry that cannot be spammed. Until the request gate accepts a manual run it
 * stays focusable, does nothing on click, and says when it will be available.
 */
export const LeaderboardRetryButton: React.FC<LeaderboardRetryButtonProps> = ({
  onRetry,
  availableAt,
  size = "sm",
  className,
  formatTime = formatStatusTime,
}) => {
  const ready = useTimeReached(availableAt);
  const hintId = useId();
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="outline"
        size={size}
        aria-disabled={!ready}
        aria-describedby={ready ? undefined : hintId}
        onClick={() => {
          // Checked against the clock at click time, not only the re-enable timer.
          if (availableAt === null || Date.now() >= availableAt) onRetry();
        }}
        className={cn(
          "shrink-0 gap-1.5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
          className,
        )}
      >
        <RefreshCw className={size === "sm" ? "w-3 h-3" : "w-4 h-4"} /> Retry
      </Button>
      {!ready && availableAt !== null && (
        <span id={hintId} className="text-xs text-muted-foreground">
          {retryAvailableCopy(availableAt, formatTime)}
        </span>
      )}
    </span>
  );
};

interface LeaderboardErrorBannerProps {
  /** Headline from the hook — never a raw database error. */
  message: string;
  /**
   * "stale": standings are not live but the last valid snapshot for this
   * selection is still on screen. "full": nothing is loaded for this selection.
   */
  variant: "stale" | "full";
  onRetry: () => void;
  status?: StandingsStatus;
  formatTime?: (ms: number) => string;
}

const LeaderboardErrorBanner: React.FC<LeaderboardErrorBannerProps> = ({
  message,
  variant,
  onRetry,
  status = STANDINGS_STATUS_OK,
  formatTime = formatStatusTime,
}) => {
  const paused = status.kind === "maintenance" || status.kind === "busy";
  // No Retry during a server hold (it would be refused) or while offline (it cannot succeed).
  const canRetry = !paused && !status.offline;
  const Icon = paused ? PauseCircle : AlertTriangle;
  const detail = standingsDetail(status, variant === "stale", Date.now(), formatTime);

  if (variant === "stale") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10">
        <div role="status" aria-live="polite" className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 shrink-0 text-amber-500" />
          <p className="text-sm text-foreground">
            {message} {detail || "Standings shown may be out of date."}
          </p>
        </div>
        {canRetry && (
          <LeaderboardRetryButton onRetry={onRetry} availableAt={status.manualAvailableAt} formatTime={formatTime} />
        )}
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center py-20 text-center">
      <Icon className="w-16 h-16 text-muted-foreground mb-4" />
      <h2 className="text-xl font-semibold text-foreground mb-2">{message}</h2>
      <p className="text-muted-foreground mb-6 max-w-md">{detail}</p>
      {canRetry && (
        <LeaderboardRetryButton
          onRetry={onRetry}
          availableAt={status.manualAvailableAt}
          size="default"
          formatTime={formatTime}
        />
      )}
    </div>
  );
};

export default LeaderboardErrorBanner;
