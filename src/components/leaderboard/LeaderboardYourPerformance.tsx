import React, { useId } from "react";
import { UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import LeaderboardAgentAvatar from "@/components/leaderboard/LeaderboardAgentAvatar";
import LeaderboardApValue from "@/components/leaderboard/LeaderboardApValue";
import LeaderboardRankMovement from "@/components/leaderboard/LeaderboardRankMovement";
import OdometerValue from "@/components/leaderboard/OdometerValue";
import { isPremiumWhollyUnknown } from "@/lib/premiumAvailability";
import {
  type AgentStats,
  type LeaderboardView,
  type Period,
  type RankMovement,
  AP_FULL_LABEL,
  AP_LABEL,
  formatCount,
} from "@/components/leaderboard/leaderboardTypes";

interface LeaderboardYourPerformanceProps {
  /** The ranked board on screen (same snapshot, same order as the podium and Full Rankings). */
  agents: AgentStats[];
  userId?: string;
  /** A real movement since the previous update of this same selection; undefined when there was none. */
  movement?: RankMovement;
  period: Period;
  view: LeaderboardView;
  groupName?: string | null;
  className?: string;
}

const policies = (n: number) => `${n} ${n === 1 ? "policy" : "policies"}`;

/**
 * The signed-in agent's own standing, read from the board already on screen (no request of its own). An agent who is
 * not on this board — outside the authorized active roster of this view — gets an unavailable state, never zeros.
 */
const LeaderboardYourPerformance: React.FC<LeaderboardYourPerformanceProps> = ({
  agents,
  userId,
  movement,
  period,
  view,
  groupName,
  className,
}) => {
  const headingId = useId();
  const me = userId ? agents.find((a) => a.id === userId) : undefined;
  const scope = view === "group" && groupName ? groupName : "My Agency";
  const unknown = me?.unknownPremiums ?? 0;

  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex flex-col rounded-xl border border-primary/30 bg-primary/[0.05] p-4 shadow-sm sm:p-5", className)}
    >
      <div className="flex items-center gap-3">
        {me && (
          <LeaderboardAgentAvatar
            avatarUrl={me.avatar_url}
            initials={`${me.first_name?.[0] || ""}${me.last_name?.[0] || ""}`}
            alt={`${me.first_name} ${me.last_name}`.trim() || "You"}
            className="h-10 w-10 shrink-0 ring-2 ring-primary/50"
            fallbackClassName="text-xs"
          />
        )}
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-foreground">Your Performance</h2>
          <p className="truncate text-xs text-muted-foreground">{period} · {scope}</p>
        </div>
      </div>

      {me ? (
        // Beside the podium (xl) the card is a column; stacked under it, AP and the stats share one row.
        <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:items-end xl:grid-cols-1 xl:items-stretch">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" title={AP_FULL_LABEL}>
              {AP_LABEL}
            </p>
            <div className="whitespace-nowrap text-3xl font-extrabold leading-tight tracking-tight text-foreground">
              <LeaderboardApValue agent={me} />
            </div>
            {unknown > 0 && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {isPremiumWhollyUnknown(me.policiesSold, unknown)
                  ? `Premium unknown for ${policies(unknown)}`
                  : `Includes ${policies(unknown)} with unknown premium`}
              </p>
            )}
          </div>
          <dl className="grid grid-cols-3 gap-2 border-t border-primary/15 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0 xl:border-l-0 xl:border-t xl:pl-0 xl:pt-3">
            <div className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Rank</dt>
              <dd className="text-lg font-bold tabular-nums text-foreground">
                #{me.rank} <span className="text-xs font-medium text-muted-foreground">of {agents.length}</span>
              </dd>
              <dd className="min-h-4">
                <LeaderboardRankMovement movement={movement} suffix="since last update" className="text-[11px]" />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Policies</dt>
              <dd className="text-lg font-bold text-foreground">
                <OdometerValue value={me.policiesSold} format={formatCount} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Calls</dt>
              <dd className="text-lg font-bold text-foreground">
                <OdometerValue value={me.callsMade} format={formatCount} />
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="mt-4 flex flex-1 flex-col items-start gap-1">
          <UserX className="h-5 w-5 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">Your stats aren't on this board</p>
          <p className="text-xs text-muted-foreground">
            Only active agents in {view === "group" && groupName ? groupName : "your agency"} are ranked.
          </p>
        </div>
      )}
    </section>
  );
};

export default LeaderboardYourPerformance;
