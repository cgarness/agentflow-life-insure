import React from "react";
import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import LeaderboardAgentAvatar from "@/components/leaderboard/LeaderboardAgentAvatar";
import OdometerValue from "@/components/leaderboard/OdometerValue";
import { cn } from "@/lib/utils";
import LeaderboardApValue from "@/components/leaderboard/LeaderboardApValue";
import type { AgentStats, LeaderboardView } from "@/components/leaderboard/leaderboardTypes";
import { AP_FULL_LABEL, AP_LABEL, formatCount } from "@/components/leaderboard/leaderboardTypes";
import {
  type RankMotionKind,
  leaderboardGlideTransition,
  leaderboardPodiumEnterTransition,
  leaderboardPodiumExitTransition,
  podiumEnterInitial,
} from "@/components/leaderboard/leaderboardRankMotion";
import { PODIUM_TIER_HEIGHT, type PodiumSlotRank } from "@/components/leaderboard/podiumLayout";
import { agentHighlightClass } from "@/components/leaderboard/leaderboardHighlight";

export type PodiumMetalConfig = {
  metal: string;
  card: string;
  trophyWrap: string;
  trophyColor: string;
  rankPill: string;
  animate: string;
};

interface LeaderboardPodiumCardProps {
  agent: AgentStats;
  view: LeaderboardView;
  userId?: string;
  metal: PodiumMetalConfig;
  slotRank: PodiumSlotRank;
  motionKind: RankMotionKind;
  rankGlow?: "up" | "down";
  spotlightAgentId?: string | null;
  newLeaderId?: string | null;
}

const LeaderboardPodiumCard: React.FC<LeaderboardPodiumCardProps> = ({
  agent,
  view,
  userId,
  metal,
  slotRank,
  motionKind,
  rankGlow,
  spotlightAgentId,
  newLeaderId,
}) => {
  const isGold = slotRank === 1;
  const initials = `${agent.first_name?.[0] || ""}${agent.last_name?.[0] || ""}`;
  const displayName = `${agent.first_name} ${agent.last_name?.[0] || ""}.`;
  const useLayoutGlide = motionKind === "glide";
  const pillPop = motionKind !== "none";

  return (
    <motion.div
      layout={useLayoutGlide ? "position" : false}
      layoutId={useLayoutGlide ? `podium-agent-${agent.id}` : undefined}
      initial={motionKind === "podium-enter" ? podiumEnterInitial : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={
        useLayoutGlide
          ? leaderboardGlideTransition
          : motionKind === "podium-enter"
            ? leaderboardPodiumEnterTransition
            : leaderboardPodiumExitTransition
      }
      className={cn(
        "absolute bottom-0 left-0 right-0 w-full rounded-xl p-3 sm:p-4 text-center flex flex-col items-center",
        PODIUM_TIER_HEIGHT[slotRank],
        metal.card,
        agent.id === userId && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        rankGlow === "up" && "animate-rank-up-glow",
        rankGlow === "down" && "animate-rank-down-glow",
        agentHighlightClass(agent.id, { spotlightAgentId, newLeaderId }),
      )}
    >
      <div
        className={cn(
          "inline-flex shrink-0 items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-full mb-1.5",
          metal.trophyWrap,
          metal.animate,
          rankGlow === "up" && isGold && "animate-tv-trophy-shimmer",
          newLeaderId === agent.id && "animate-tv-trophy-shimmer",
        )}
      >
        <Trophy className={cn(isGold ? "w-4 h-4 sm:w-5 sm:h-5" : "w-3.5 h-3.5 sm:w-4 sm:h-4", metal.trophyColor)} />
      </div>
      <LeaderboardAgentAvatar
        avatarUrl={agent.avatar_url}
        initials={initials}
        alt={`${agent.first_name} ${agent.last_name}`.trim() || "Agent"}
        className={cn("mx-auto mb-1.5 shrink-0", isGold ? "h-10 w-10 sm:h-11 sm:w-11" : "h-8 w-8 sm:h-9 sm:w-9")}
        fallbackClassName={isGold ? "text-sm" : "text-xs"}
      />
      <h3
        className={cn(
          "font-bold text-foreground leading-tight shrink-0",
          isGold ? "text-sm sm:text-base" : "text-xs sm:text-sm",
        )}
      >
        {displayName}
      </h3>
      {view === "group" && agent.organizationName ? (
        <p className="text-[10px] text-muted-foreground truncate mt-0.5 min-h-[14px] w-full shrink-0">
          {agent.organizationName}
        </p>
      ) : null}
      <span
        key={`${agent.rank}-${motionKind}`}
        className={cn(
          "inline-block shrink-0 text-[10px] uppercase tracking-wide px-2.5 py-0.5 rounded-full font-semibold mt-1",
          metal.rankPill,
          pillPop && "animate-rank-pill-pop",
        )}
      >
        #{agent.rank} {metal.metal}
      </span>
      <div className="mt-auto pt-1 w-full shrink-0">
        <div className="whitespace-nowrap font-extrabold text-foreground">
          <LeaderboardApValue
            agent={agent}
            className={cn(
              "tracking-tight leading-none",
              isGold ? "text-2xl sm:text-[1.75rem]" : "text-xl sm:text-[1.4rem]",
            )}
          />
        </div>
        <p
          className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mt-0.5 truncate"
          title={AP_FULL_LABEL}
        >
          {AP_LABEL}
        </p>
        <dl className="mt-1.5 grid grid-cols-2 border-t border-foreground/10 pt-1.5 pb-0.5">
          {([["Policies", agent.policiesSold], ["Calls", agent.callsMade]] as const).map(([label, value]) => (
            // Label first for screen readers; the figure sits above it on screen.
            <div key={label} className="flex min-w-0 flex-col-reverse">
              <dt className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="text-xs sm:text-sm font-bold text-foreground leading-tight">
                <OdometerValue value={value} format={formatCount} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </motion.div>
  );
};

export default LeaderboardPodiumCard;
