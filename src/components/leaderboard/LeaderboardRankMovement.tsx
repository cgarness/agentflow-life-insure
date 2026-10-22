import React from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RankMovement } from "@/components/leaderboard/leaderboardTypes";

interface LeaderboardRankMovementProps {
  movement?: RankMovement;
  /** Appended to the visible spots, e.g. "since last update" on the Your Performance card. */
  suffix?: string;
  className?: string;
}

/** A live rank change since the previous leaderboard update; renders nothing when there was none. */
const LeaderboardRankMovement: React.FC<LeaderboardRankMovementProps> = ({ movement, suffix, className }) => {
  if (!movement) return null;
  const up = movement.direction === "up";
  const Icon = up ? ArrowUp : ArrowDown;
  const label = `Moved ${up ? "up" : "down"} ${movement.spots} spot${movement.spots === 1 ? "" : "s"} since the last leaderboard update`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium whitespace-nowrap",
        up ? "text-success" : "text-destructive",
        className,
      )}
      title={label}
    >
      <Icon className="w-3 h-3" aria-hidden />
      <span aria-hidden>{movement.spots}{suffix ? ` ${suffix}` : ""}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
};

export default LeaderboardRankMovement;
