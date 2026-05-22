import React from "react";
import { motion, LayoutGroup } from "framer-motion";
import { ArrowUp, ArrowDown, Download } from "lucide-react";
import LeaderboardAgentAvatar from "@/components/leaderboard/LeaderboardAgentAvatar";
import OdometerValue from "@/components/leaderboard/OdometerValue";
import type { AgentStats, LeaderboardView, RankMovement } from "@/components/leaderboard/leaderboardTypes";
import { formatPremiumSold } from "@/components/leaderboard/leaderboardTypes";
import {
  type RankMotionKind,
  tableRowLayoutTransition,
} from "@/components/leaderboard/leaderboardRankMotion";
import { agentHighlightClass } from "@/components/leaderboard/leaderboardHighlight";

interface LeaderboardRankingsTableProps {
  restAgents: AgentStats[];
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

/** Rank + agent + stat columns — grid column count must match visible cells at each breakpoint */
const ROW_GRID =
  "grid w-full items-center gap-x-3 sm:gap-x-4 " +
  "grid-cols-[4rem_minmax(5.5rem,1fr)_minmax(2.75rem,0.75fr)_minmax(2.75rem,0.75fr)] " +
  "md:grid-cols-[4rem_minmax(6.5rem,1.15fr)_repeat(4,minmax(2.5rem,0.6fr))] " +
  "lg:grid-cols-[4.25rem_minmax(6rem,1.05fr)_repeat(5,minmax(2.25rem,0.52fr))] " +
  "xl:grid-cols-[4.25rem_minmax(6.5rem,1fr)_repeat(6,minmax(2.5rem,0.48fr))]";

const rankMovementDisplay = (movement: RankMovement | undefined) => {
  if (!movement) return null;
  if (movement.direction === "up") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-success text-xs font-medium whitespace-nowrap"
        title={`Moved up ${movement.spots} spot${movement.spots === 1 ? "" : "s"} since the last leaderboard update`}
      >
        <ArrowUp className="w-3 h-3" aria-hidden />
        {movement.spots}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 text-destructive text-xs font-medium whitespace-nowrap"
      title={`Moved down ${movement.spots} spot${movement.spots === 1 ? "" : "s"} since the last leaderboard update`}
    >
      <ArrowDown className="w-3 h-3" aria-hidden />
      {movement.spots}
    </span>
  );
};

const rowGlowClass = (rankAnimations: Map<string, "up" | "down">, agentId: string) => {
  const anim = rankAnimations.get(agentId);
  if (anim === "up") return "animate-rank-up-glow";
  if (anim === "down") return "animate-rank-down-glow";
  return "";
};

const LeaderboardRankingsTable: React.FC<LeaderboardRankingsTableProps> = ({
  restAgents,
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
        className="text-xs text-primary flex items-center gap-1 hover:underline"
      >
        <Download className="w-3 h-3" /> Export CSV
      </button>
    </div>
    <div className="overflow-x-auto">
      <div className="min-w-[32rem] md:min-w-[40rem] lg:min-w-[44rem] xl:min-w-0 w-full text-sm" role="table">
        <div className={`${ROW_GRID} text-muted-foreground border-b bg-accent/50`} role="row">
          <div className="py-3 pl-4 pr-1 font-medium text-left whitespace-nowrap" role="columnheader">
            Rank
          </div>
          <div className="py-3 pl-2 pr-2 font-medium text-left whitespace-nowrap" role="columnheader">
            Agent
          </div>
          <div className="py-3 px-2 font-medium text-right whitespace-nowrap" role="columnheader">
            Calls
          </div>
          <div className="py-3 px-2 font-medium text-right whitespace-nowrap" role="columnheader">
            Policies
          </div>
          <div className="py-3 px-2 font-medium text-right whitespace-nowrap hidden md:block" role="columnheader">
            Premium
          </div>
          <div className="py-3 px-2 font-medium text-right whitespace-nowrap hidden md:block" role="columnheader">
            Appts
          </div>
          <div className="py-3 px-2 font-medium text-right whitespace-nowrap hidden xl:block" role="columnheader">
            Talk Time
          </div>
          <div className="py-3 pr-4 pl-2 font-medium text-right whitespace-nowrap hidden lg:block" role="columnheader">
            Conv %
          </div>
        </div>

        <LayoutGroup id="leaderboard-table">
          <motion.div layout className="flex w-full flex-col" role="rowgroup">
            {restAgents.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                All agents shown in podium above
              </div>
            ) : (
              restAgents.map((a) => {
                const initials = `${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`;
                const displayName = `${a.first_name} ${a.last_name?.[0] || ""}.`;
                const isMe = a.id === userId;
                const motionKind = rankMotions.get(a.id) ?? "none";
                const rankDelta = rankDeltas.get(a.id) ?? 0;

                return (
                  <motion.div
                    key={a.id}
                    role="row"
                    layout="position"
                    layoutId={`leaderboard-row-${a.id}`}
                    transition={{ layout: tableRowLayoutTransition(rankDelta) }}
                    className={`${ROW_GRID} shrink-0 border-b last:border-0 hover:bg-accent/30 ${isMe ? "bg-primary/5 border-l-2 border-primary" : ""} ${rowGlowClass(rankAnimations, a.id)} ${agentHighlightClass(a.id, { spotlightAgentId, newLeaderId })}`}
                  >
                    <div className="py-3 pl-4 pr-1 whitespace-nowrap" role="cell">
                      <div className="flex items-center gap-1">
                        <span
                          key={`${a.rank}-${motionKind}`}
                          className={`font-bold text-foreground ${motionKind !== "none" ? "animate-rank-pill-pop" : ""}`}
                        >
                          {a.rank}
                        </span>
                        {rankMovementDisplay(rankMovements.get(a.id))}
                      </div>
                    </div>
                    <div className="py-3 pl-2 pr-2 min-w-0" role="cell">
                      <div className="flex items-center gap-2">
                        <LeaderboardAgentAvatar
                          avatarUrl={a.avatar_url}
                          initials={initials}
                          alt={`${a.first_name} ${a.last_name}`.trim() || "Agent"}
                          className="h-7 w-7 shrink-0"
                          fallbackClassName="text-[10px]"
                        />
                        <div className="min-w-0 overflow-hidden">
                          <span className="font-medium text-foreground truncate block" title={displayName}>
                            {displayName}
                          </span>
                          {view === "group" && a.organizationName && (
                            <p className="text-[10px] text-muted-foreground truncate" title={a.organizationName}>
                              {a.organizationName}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="py-3 px-2 text-right text-foreground whitespace-nowrap tabular-nums" role="cell">
                      <OdometerValue value={a.callsMade} format={(n) => String(Math.round(n))} />
                    </div>
                    <div className="py-3 px-2 text-right text-foreground font-medium whitespace-nowrap tabular-nums" role="cell">
                      <OdometerValue value={a.policiesSold} format={(n) => String(Math.round(n))} />
                    </div>
                    <div className="py-3 px-2 text-right text-foreground whitespace-nowrap tabular-nums hidden md:block" role="cell">
                      <OdometerValue value={a.premiumSold} format={formatPremiumSold} />
                    </div>
                    <div className="py-3 px-2 text-right text-foreground whitespace-nowrap tabular-nums hidden md:block" role="cell">
                      <OdometerValue value={a.appointmentsSet} format={(n) => String(Math.round(n))} />
                    </div>
                    <div className="py-3 px-2 text-right text-foreground whitespace-nowrap tabular-nums hidden xl:block" role="cell">
                      <OdometerValue
                        value={a.talkTime / 3600}
                        format={(n) => `${n.toFixed(1)} hrs`}
                      />
                    </div>
                    <div className="py-3 pr-4 pl-2 text-right text-foreground whitespace-nowrap tabular-nums hidden lg:block" role="cell">
                      <OdometerValue
                        value={a.conversionRate}
                        format={(n) => `${n.toFixed(1)}%`}
                      />
                    </div>
                  </motion.div>
                );
              })
            )}
          </motion.div>
        </LayoutGroup>
      </div>
    </div>
  </div>
);

export default LeaderboardRankingsTable;
