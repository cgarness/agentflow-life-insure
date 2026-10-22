import React from "react";
import { motion, LayoutGroup } from "framer-motion";
import TVPodium from "./TVPodium";
import TVRankingsTable from "./TVRankingsTable";
import TVDeepRankPanel from "./TVDeepRankPanel";
import RecentWinsPanel from "./RecentWinsPanel";
import { useTVRankMotion } from "./useTVRankMotion";
import type { AgentStats, Period, Win } from "./leaderboardTypes";
import type { WinsStatus } from "@/lib/leaderboardStatusCopy";

/** Stacked panels keep their content height; wide panels share the remaining space. */
const TV_GRID_CLASS =
  "mx-auto flex w-full shrink-0 flex-col gap-4 xl:grid xl:min-h-[26rem] xl:flex-1 xl:grid-cols-[minmax(12rem,1fr)_minmax(0,3fr)_minmax(12rem,1fr)]";

/** The "New #1" banner for a leader change on the AP board. */
export const TVNewLeaderBanner: React.FC<{ leader?: AgentStats }> = ({ leader }) =>
  leader ? (
    <motion.div
      key={leader.id}
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      className="pointer-events-none flex shrink-0 justify-center"
    >
      <div className="rounded-full border border-yellow-400/40 bg-yellow-500/15 px-6 py-2 text-center shadow-[0_0_40px_-12px_rgba(234,179,8,0.45)] backdrop-blur-md md:px-8 md:py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.35em] text-yellow-300/90">New #1</p>
        <p className="text-lg font-black uppercase tracking-wide text-white md:text-xl">
          {leader.first_name} {leader.last_name?.[0]}.
        </p>
      </div>
    </motion.div>
  ) : null;

interface TVBoardProps {
  /** AP-ranked rows (rank 1…N). */
  rankedAgents: AgentStats[];
  agents: AgentStats[];
  period: Period;
  /** Motion never carries across organizations or periods. */
  selection: string;
  live: boolean;
  wins: Win[];
  winsStatus?: WinsStatus;
  flashingWinId: string | null;
  spotlightAgentId: string | null;
  newLeaderId: string | null;
}

/** Podium, ranks 4–10, ranks 11+ and Recent Wins — all in AP order. */
const TVBoard: React.FC<TVBoardProps> = ({
  rankedAgents, agents, period, selection, live, wins, winsStatus, flashingWinId, spotlightAgentId, newLeaderId,
}) => {
  const tableAgents = rankedAgents.filter((a) => a.rank >= 4 && a.rank <= 10);
  const deepRankAgents = rankedAgents.filter((a) => a.rank >= 11);
  const { tvRankMotions, tvRankDeltas, tvRankMovements, tvRankAnimations } = useTVRankMotion(rankedAgents, selection);

  return (
    <LayoutGroup id="tv-leaderboard">
      <TVPodium key={period} agents={rankedAgents}
        tvRankMotions={tvRankMotions} tvRankAnimations={tvRankAnimations}
        spotlightAgentId={spotlightAgentId} newLeaderId={newLeaderId} />
      <div className={TV_GRID_CLASS} data-testid="tv-lower-panels">
        <div className="order-2 flex min-h-[18rem] flex-col xl:order-none xl:col-start-1">
          <TVDeepRankPanel
            agents={deepRankAgents}
            rankDeltas={tvRankDeltas}
            spotlightAgentId={spotlightAgentId}
            newLeaderId={newLeaderId}
          />
        </div>

        <TVRankingsTable key={period} tableAgents={tableAgents} live={live}
          tvRankMotions={tvRankMotions} tvRankAnimations={tvRankAnimations} tvRankDeltas={tvRankDeltas}
          tvRankMovements={tvRankMovements} spotlightAgentId={spotlightAgentId} newLeaderId={newLeaderId} />

        <div className="order-3 flex min-h-[18rem] flex-col xl:order-none xl:col-start-3">
          <RecentWinsPanel
            wins={wins}
            agents={agents}
            flashingWinId={flashingWinId}
            variant="tv"
            status={winsStatus}
          />
        </div>
      </div>
    </LayoutGroup>
  );
};

export default TVBoard;
