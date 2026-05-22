import React from "react";
import { LayoutGroup, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import LeaderboardPodiumCard from "@/components/leaderboard/LeaderboardPodiumCard";
import type { AgentStats, Metric, LeaderboardView } from "@/components/leaderboard/leaderboardTypes";
import { metricKey } from "@/components/leaderboard/leaderboardTypes";
import type { RankMotionKind } from "@/components/leaderboard/leaderboardRankMotion";
import { PODIUM_GRID_CLASS, PODIUM_SLOT_RANKS } from "@/components/leaderboard/podiumLayout";

interface LeaderboardPodiumProps {
  agents: AgentStats[];
  metric: Metric;
  view: LeaderboardView;
  userId?: string;
  rankAnimations: Map<string, "up" | "down">;
  rankMotions: Map<string, RankMotionKind>;
  rankDeltas?: Map<string, number>;
  spotlightAgentId?: string | null;
  newLeaderId?: string | null;
}

const metalConfig = (rank: number) => {
  if (rank === 1) {
    return {
      metal: "Gold",
      card: "bg-gradient-to-b from-amber-100/95 via-yellow-50 to-amber-200/80 border-2 border-amber-400/90 shadow-lg shadow-amber-500/30 ring-1 ring-amber-300/50 dark:from-amber-950/60 dark:via-amber-900/40 dark:to-amber-950/70 dark:border-amber-500/60 dark:shadow-amber-900/40 dark:ring-amber-600/30",
      trophyWrap: "bg-amber-400/25 ring-2 ring-amber-500/35 shadow-inner",
      trophyColor: "text-amber-600 dark:text-amber-400",
      rankPill: "bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 shadow-sm border border-amber-600/20",
      animate: "animate-trophy-shine",
    };
  }
  if (rank === 2) {
    return {
      metal: "Silver",
      card: "bg-gradient-to-b from-slate-100 via-zinc-50 to-slate-200/90 border-2 border-slate-300 shadow-md shadow-slate-400/25 ring-1 ring-slate-200/80 dark:from-slate-900/55 dark:via-zinc-900/45 dark:to-slate-800/70 dark:border-slate-500/70 dark:shadow-slate-950/50 dark:ring-slate-600/30",
      trophyWrap: "bg-slate-300/40 ring-2 ring-slate-400/40 shadow-inner dark:bg-slate-600/30 dark:ring-slate-500/40",
      trophyColor: "text-slate-500 dark:text-slate-300",
      rankPill: "bg-gradient-to-r from-slate-300 to-zinc-400 text-slate-900 shadow-sm border border-slate-500/25 dark:from-slate-600 dark:to-zinc-600 dark:text-white",
      animate: "",
    };
  }
  return {
    metal: "Bronze",
    card: "bg-gradient-to-b from-orange-100/90 via-amber-50 to-orange-200/85 border-2 border-orange-400/85 shadow-lg shadow-orange-500/20 ring-1 ring-orange-300/50 dark:from-orange-950/50 dark:via-amber-950/35 dark:to-orange-900/55 dark:border-orange-600/55 dark:shadow-orange-950/40 dark:ring-orange-800/30",
    trophyWrap: "bg-orange-400/25 ring-2 ring-orange-500/35 shadow-inner dark:bg-orange-900/40 dark:ring-orange-600/40",
    trophyColor: "text-orange-600 dark:text-orange-400",
    rankPill: "bg-gradient-to-r from-orange-400 to-amber-600 text-amber-950 shadow-sm border border-orange-700/20 dark:from-orange-600 dark:to-amber-700 dark:text-white",
    animate: "",
  };
};

const LeaderboardPodium: React.FC<LeaderboardPodiumProps> = ({
  agents,
  metric,
  view,
  userId,
  rankAnimations,
  rankMotions,
  rankDeltas,
  spotlightAgentId,
  newLeaderId,
}) => {
  const topAgents = agents.filter((a) => a.rank <= 3);
  const showThreeColumns = agents.length >= 3;

  if (topAgents.length === 0) return null;

  return (
    <LayoutGroup id="leaderboard-podium">
      <div
        className={cn(
          PODIUM_GRID_CLASS,
          !showThreeColumns && topAgents.length === 2 && "sm:grid-cols-2 max-w-2xl",
          !showThreeColumns && topAgents.length === 1 && "sm:grid-cols-1 max-w-sm",
        )}
      >
        {PODIUM_SLOT_RANKS.map((slotRank) => {
          if (!showThreeColumns && !topAgents.some((a) => a.rank === slotRank)) {
            return null;
          }

          const agent = topAgents.find((a) => a.rank === slotRank);
          const mc = metalConfig(slotRank);

          return (
            <div
              key={`slot-${slotRank}`}
              className={cn(
                "relative h-full w-full min-w-0",
                slotRank === 1 && showThreeColumns && "md:z-[1]",
              )}
            >
              <AnimatePresence mode="sync" initial={false}>
                {agent ? (
                  <LeaderboardPodiumCard
                    key={agent.id}
                    agent={agent}
                    metric={metric}
                    metricNumeric={agent[metricKey(metric)] as number}
                    view={view}
                    userId={userId}
                    metal={mc}
                    slotRank={slotRank}
                    motionKind={rankMotions.get(agent.id) ?? "none"}
                    rankGlow={rankAnimations.get(agent.id)}
                    spotlightAgentId={spotlightAgentId}
                    newLeaderId={newLeaderId}
                  />
                ) : null}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </LayoutGroup>
  );
};

export default LeaderboardPodium;
