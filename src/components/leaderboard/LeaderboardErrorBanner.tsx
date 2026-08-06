import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LeaderboardErrorBannerProps {
  /** Generic message from the hook — never a raw database error. */
  message: string;
  /**
   * "stale": a refresh failed but the last valid snapshot is still on screen.
   * "full": nothing has ever loaded — the error replaces the board.
   */
  variant: "stale" | "full";
  onRetry: () => void;
}

const LeaderboardErrorBanner: React.FC<LeaderboardErrorBannerProps> = ({
  message,
  variant,
  onRetry,
}) => {
  if (variant === "stale") {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
          <p className="text-sm text-foreground truncate">
            {message} Standings shown may be out of date.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0 gap-1.5">
          <RefreshCw className="w-3 h-3" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <AlertTriangle className="w-16 h-16 text-muted-foreground mb-4" />
      <h2 className="text-xl font-semibold text-foreground mb-2">{message}</h2>
      <p className="text-muted-foreground mb-6">
        Standings are unavailable right now. Check your connection and try again.
      </p>
      <Button variant="outline" onClick={onRetry} className="gap-1.5">
        <RefreshCw className="w-4 h-4" /> Retry
      </Button>
    </div>
  );
};

export default LeaderboardErrorBanner;
