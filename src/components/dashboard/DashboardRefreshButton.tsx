import React, { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTimeReached } from "@/hooks/useTimeReached";
import { formatStatusTime } from "@/lib/leaderboardStatusCopy";

/** Minimum time between manual Dashboard refreshes, and after the Dashboard opens. */
export const DASHBOARD_REFRESH_COOLDOWN_MS = 30_000;

interface DashboardRefreshButtonProps {
  /**
   * Asks the stat cards and every visible widget for one load each; resolves when
   * the work they started settles, or at the Dashboard's wait bound.
   */
  onRefresh: () => Promise<void>;
}

/**
 * The Dashboard's only refresh: it replaced a 2-minute automatic refresh.
 * Bounded — never while a refresh runs, and not again for 30 s after the
 * Dashboard opens or after each refresh. It never claims every widget succeeded.
 */
const DashboardRefreshButton: React.FC<DashboardRefreshButtonProps> = ({ onRefresh }) => {
  const [refreshing, setRefreshing] = useState(false);
  const [availableAt, setAvailableAt] = useState(() => Date.now() + DASHBOARD_REFRESH_COOLDOWN_MS);
  const ready = useTimeReached(availableAt);
  const mountedRef = useRef(true);
  const hintId = "dashboard-refresh-hint";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleClick = async () => {
    if (refreshing || Date.now() < availableAt) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      if (mountedRef.current) {
        setRefreshing(false);
        setAvailableAt(Date.now() + DASHBOARD_REFRESH_COOLDOWN_MS);
      }
    }
  };

  const blocked = refreshing || !ready;
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleClick()}
        aria-disabled={blocked}
        aria-busy={refreshing}
        aria-describedby={blocked && !refreshing ? hintId : undefined}
        className="rounded-xl h-10 px-4 bg-card shadow-sm border-border text-muted-foreground hover:bg-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 mr-2 text-primary ${refreshing ? "animate-spin" : ""}`} />
        <span className="text-xs font-semibold">{refreshing ? "Refreshing…" : "Refresh"}</span>
        <span className="sr-only"> dashboard</span>
      </Button>
      {!refreshing && !ready && (
        <span id={hintId} className="hidden text-[10px] text-muted-foreground sm:inline">
          Available at {formatStatusTime(availableAt)}
        </span>
      )}
    </span>
  );
};

export default DashboardRefreshButton;
