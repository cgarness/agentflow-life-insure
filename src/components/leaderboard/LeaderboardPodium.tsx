import React from "react";
import { Trophy } from "lucide-react";
import LeaderboardAgentAvatar from "@/components/leaderboard/LeaderboardAgentAvatar";
import { BadgeIcons, FireIcon } from "@/components/leaderboard/LeaderboardBadgeIcons";
import { cn } from "@/lib/utils";
import type { Badge as BadgeType, AgentFireStatus } from "@/components/leaderboard/useLeaderboardBadges";
import type { AgentStats, Metric, LeaderboardView } from "@/components/leaderboard/leaderboardTypes";
import { metricKey, formatMetricValue, metricLabel } from "@/components/leaderboard/leaderboardTypes";

interface LeaderboardPodiumProps {
  agents: AgentStats[];
  metric: Metric;
  view: LeaderboardView;
  userId?: string;
  badgesMap: Map<string, BadgeType[]>;
  fireMap: Map<string, AgentFireStatus>;
  rankAnimations: Map<string, "up" | "down">;
  onOpenScorecard: (agent: AgentStats) => void;
  getRowAnimation: (agentId: string) => string;
}

const podiumOrder = (rank: number) => {
  if (rank === 1) return "md:order-2 md:z-[1] md:scale-[1.04]";
  if (rank === 2) return "md:order-1";
  return "md:order-3";
};

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
  badgesMap,
  fireMap,
  rankAnimations,
  onOpenScorecard,
  getRowAnimation,
}) => {
  const topAgents = agents.filter((a) => a.rank <= 3 && (a[metricKey(metric)] as number) > 0);
  if (topAgents.length === 0) return null;

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 md:gap-4 items-end mx-auto w-full justify-items-stretch",
        topAgents.length >= 3 && "sm:grid-cols-3 max-w-3xl lg:max-w-4xl",
        topAgents.length === 2 && "sm:grid-cols-2 max-w-2xl",
        topAgents.length === 1 && "max-w-sm",
      )}
    >
      {topAgents.map((a) => {
        const mc = metalConfig(a.rank);
        const initials = `${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`;
        const displayName = `${a.first_name} ${a.last_name?.[0] || ""}.`;
        const val = formatMetricValue(metric, a[metricKey(metric)] as number);
        const agentBadges = badgesMap.get(a.id) || [];
        const fire = fireMap.get(a.id);
        const isFirst = a.rank === 1;

        return (
          <div
            key={a.id}
            onClick={() => onOpenScorecard(a)}
            className={`rounded-xl p-4 text-center transition-all duration-300 cursor-pointer hover:brightness-[1.02] hover:shadow-xl ${mc.card} ${podiumOrder(a.rank)} ${a.id === userId ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""} ${getRowAnimation(a.id)}`}
          >
            <div
              className={`inline-flex items-center justify-center w-9 h-9 rounded-full mb-2 ${mc.trophyWrap} ${mc.animate} ${rankAnimations.get(a.id) === "up" && isFirst ? "animate-tv-trophy-shimmer" : ""}`}
            >
              <Trophy className={`${isFirst ? "w-5 h-5" : "w-4 h-4"} ${mc.trophyColor}`} />
            </div>
            <LeaderboardAgentAvatar
              avatarUrl={a.avatar_url}
              initials={initials}
              alt={`${a.first_name} ${a.last_name}`.trim() || "Agent"}
              className={`mx-auto mb-2 ${isFirst ? "h-11 w-11" : "h-9 w-9"}`}
              fallbackClassName={isFirst ? "text-sm" : "text-xs"}
            />
            <h3 className={`font-bold text-foreground ${isFirst ? "text-base" : "text-sm"} leading-tight`}>
              {displayName}
              <FireIcon fire={fire} agentName={displayName} />
            </h3>
            {view === "group" && a.organizationName && (
              <p className="text-[10px] text-muted-foreground truncate mt-0.5">{a.organizationName}</p>
            )}
            {agentBadges.length > 0 && (
              <div className="flex justify-center mt-0.5">
                <BadgeIcons badges={agentBadges} max={3} />
              </div>
            )}
            <span
              className={`inline-block text-[10px] uppercase tracking-wide px-2.5 py-0.5 rounded-full font-semibold mt-1.5 ${mc.rankPill}`}
            >
              #{a.rank} {mc.metal}
            </span>
            <p
              className={`font-extrabold text-foreground tabular-nums tracking-tight mt-2 ${isFirst ? "text-3xl" : "text-2xl"}`}
            >
              {val}
            </p>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mt-0.5">
              {metricLabel(metric)}
            </p>
          </div>
        );
      })}
    </div>
  );
};

export default LeaderboardPodium;
