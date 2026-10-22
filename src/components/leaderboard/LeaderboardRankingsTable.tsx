import React from "react";
import { motion, LayoutGroup } from "framer-motion";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import LeaderboardAgentAvatar from "@/components/leaderboard/LeaderboardAgentAvatar";
import LeaderboardApValue from "@/components/leaderboard/LeaderboardApValue";
import LeaderboardRankMovement from "@/components/leaderboard/LeaderboardRankMovement";
import OdometerValue from "@/components/leaderboard/OdometerValue";
import type { AgentStats, LeaderboardView, RankMovement } from "@/components/leaderboard/leaderboardTypes";
import { ANNUAL_PREMIUM_LABEL, formatCount } from "@/components/leaderboard/leaderboardTypes";
import {
  type RankMotionKind,
  tableRowLayoutTransition,
} from "@/components/leaderboard/leaderboardRankMotion";
import { agentHighlightClass } from "@/components/leaderboard/leaderboardHighlight";

interface LeaderboardRankingsTableProps {
  /** Every ranked agent, in AP order — the podium's top three included. */
  agents: AgentStats[];
  view: LeaderboardView;
  userId?: string;
  rankAnimations: Map<string, "up" | "down">;
  rankMovements: Map<string, RankMovement>;
  rankMotions: Map<string, RankMotionKind>;
  rankDeltas: Map<string, number>;
  spotlightAgentId?: string | null;
  newLeaderId?: string | null;
  onExportCsv: () => void;
}

/**
 * Rank · Agent · AP · Policies · Calls — the same five columns at every width. Phones get tighter tracks so all
 * five fit a 390 px screen; the table still scrolls rather than clip if a very large AP needs more room.
 */
const ROW_GRID =
  "grid w-full items-center gap-x-2 sm:gap-x-4 " +
  "grid-cols-[2.75rem_minmax(5.5rem,1fr)_minmax(5.75rem,auto)_3rem_2.75rem] " +
  "sm:grid-cols-[3.75rem_minmax(7.5rem,1.4fr)_minmax(6.5rem,1fr)_minmax(3.5rem,0.55fr)_minmax(3.5rem,0.55fr)]";

const rowGlowClass = (rankAnimations: Map<string, "up" | "down">, agentId: string) => {
  const anim = rankAnimations.get(agentId);
  if (anim === "up") return "animate-rank-up-glow";
  if (anim === "down") return "animate-rank-down-glow";
  return "";
};

const LeaderboardRankingsTable: React.FC<LeaderboardRankingsTableProps> = ({
  agents,
  view,
  userId,
  rankAnimations,
  rankMovements,
  rankMotions,
  rankDeltas,
  spotlightAgentId,
  newLeaderId,
  onExportCsv,
}) => (
  <div className="bg-card rounded-xl border overflow-hidden">
    <div className="flex items-center justify-between px-4 py-3 border-b">
      <h3 className="font-semibold text-foreground">Full Rankings</h3>
      <button
        type="button"
        onClick={onExportCsv}
        className="text-xs text-primary flex items-center gap-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
      >
        <Download className="w-3 h-3" aria-hidden /> Export CSV
      </button>
    </div>
    <div className="overflow-x-auto">
      <div className="min-w-[21rem] w-full text-sm" role="table" aria-label={`Full rankings by ${ANNUAL_PREMIUM_LABEL}`}>
        <div className={`${ROW_GRID} text-muted-foreground border-b bg-accent/50`} role="row">
          <div className="py-3 pl-3 sm:pl-4 pr-1 font-medium text-left whitespace-nowrap" role="columnheader">
            Rank
          </div>
          <div className="py-3 pl-2 pr-2 font-medium text-left whitespace-nowrap" role="columnheader">
            Agent
          </div>
          {/* Wraps to two short lines wherever the column is narrower than the label; the column keeps its width. */}
          <div
            className="py-3 px-1 sm:px-2 font-semibold text-right leading-tight text-foreground"
            role="columnheader"
          >
            {ANNUAL_PREMIUM_LABEL}
          </div>
          <div className="py-3 px-0.5 sm:px-2 text-xs sm:text-sm font-medium text-right whitespace-nowrap" role="columnheader">
            Policies
          </div>
          <div className="py-3 pr-3 sm:pr-4 pl-0.5 sm:pl-2 text-xs sm:text-sm font-medium text-right whitespace-nowrap" role="columnheader">
            Calls
          </div>
        </div>

        <LayoutGroup id="leaderboard-table">
          <motion.div layout className="flex w-full flex-col" role="rowgroup">
            {agents.map((a) => {
              const initials = `${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`;
              const displayName = `${a.first_name} ${a.last_name?.[0] || ""}.`;
              const isMe = a.id === userId;
              const motionKind = rankMotions.get(a.id) ?? "none";
              const rankDelta = rankDeltas.get(a.id) ?? 0;

              return (
                <motion.div
                  key={a.id}
                  role="row"
                  aria-current={isMe ? "true" : undefined}
                  layout="position"
                  layoutId={`leaderboard-row-${a.id}`}
                  transition={{ layout: tableRowLayoutTransition(rankDelta) }}
                  className={cn(
                    ROW_GRID,
                    "shrink-0 border-b last:border-0 hover:bg-accent/30",
                    isMe && "bg-primary/[0.07] border-l-2 border-l-primary",
                    rowGlowClass(rankAnimations, a.id),
                    agentHighlightClass(a.id, { spotlightAgentId, newLeaderId }),
                  )}
                >
                  <div className="py-3 pl-3 sm:pl-4 pr-1 whitespace-nowrap" role="cell">
                    <div className="flex items-center gap-1">
                      <span
                        key={`${a.rank}-${motionKind}`}
                        className={cn("font-bold text-foreground", motionKind !== "none" && "animate-rank-pill-pop")}
                      >
                        {a.rank}
                      </span>
                      <LeaderboardRankMovement movement={rankMovements.get(a.id)} />
                    </div>
                  </div>
                  <div className="py-3 pl-1 sm:pl-2 pr-1 sm:pr-2 min-w-0" role="cell">
                    <div className="flex items-center gap-2">
                      <LeaderboardAgentAvatar
                        avatarUrl={a.avatar_url}
                        initials={initials}
                        alt={`${a.first_name} ${a.last_name}`.trim() || "Agent"}
                        className={cn("h-7 w-7 shrink-0", isMe && "ring-2 ring-primary/60")}
                        fallbackClassName="text-[10px]"
                      />
                      <div className="min-w-0 overflow-hidden">
                        {/* On a narrow row the YOU label wraps under the name instead of hiding it. */}
                        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span className="font-medium text-foreground truncate block" title={displayName}>
                            {displayName}
                          </span>
                          {isMe && (
                            <span className="shrink-0 rounded bg-primary/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-primary">
                              You
                            </span>
                          )}
                        </div>
                        {view === "group" && a.organizationName && (
                          <p className="text-[10px] text-muted-foreground truncate" title={a.organizationName}>
                            {a.organizationName}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="py-3 px-1 sm:px-2 text-right font-semibold text-foreground whitespace-nowrap tabular-nums" role="cell">
                    <LeaderboardApValue agent={a} />
                  </div>
                  <div className="py-3 px-0.5 sm:px-2 text-right text-foreground whitespace-nowrap tabular-nums" role="cell">
                    <OdometerValue value={a.policiesSold} format={formatCount} />
                  </div>
                  <div className="py-3 pr-3 sm:pr-4 pl-0.5 sm:pl-2 text-right text-foreground whitespace-nowrap tabular-nums" role="cell">
                    <OdometerValue value={a.callsMade} format={formatCount} />
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </LayoutGroup>
      </div>
    </div>
  </div>
);

export default LeaderboardRankingsTable;
