import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import LeaderboardErrorBanner from "@/components/leaderboard/LeaderboardErrorBanner";
import LeaderboardPodium from "@/components/leaderboard/LeaderboardPodium";
import LeaderboardRankingsTable from "@/components/leaderboard/LeaderboardRankingsTable";
import LeaderboardYourPerformance from "@/components/leaderboard/LeaderboardYourPerformance";
import RecentWinsPanel from "@/components/leaderboard/RecentWinsPanel";
import { PODIUM_GRID_CLASS, PODIUM_SECTION_CLASS, PODIUM_SKELETON_HEIGHTS } from "@/components/leaderboard/podiumLayout";
import type { RankMotionKind } from "@/components/leaderboard/leaderboardRankMotion";
import type { AgentStats, LeaderboardView, Period, RankMovement, Win } from "@/components/leaderboard/leaderboardTypes";
import { OFFLINE_HEADLINE, type StandingsStatus, type WinsStatus } from "@/lib/leaderboardStatusCopy";

interface LeaderboardBoardProps {
  agents: AgentStats[];
  wins: Win[];
  view: LeaderboardView;
  period: Period;
  groupName?: string | null;
  userId?: string;
  /** Not live: the stale strip shows above the board. */
  live: boolean;
  status: StandingsStatus;
  loadError: string | null;
  winsStatus: WinsStatus;
  /** No meaningful standings: live motion is suppressed (the order cannot move). */
  standingsFrozen: boolean;
  rankAnimations: Map<string, "up" | "down">;
  rankMovements: Map<string, RankMovement>;
  rankMotions: Map<string, RankMotionKind>;
  rankDeltas: Map<string, number>;
  flashingWinId: string | null;
  spotlightAgentId: string | null;
  newLeaderId: string | null;
  onRetry: () => void;
  onExportCsv: () => void;
  formatStatusTime: (ms: number) => string;
}

const EMPTY = new Map();

/** The podium's loading shape (tier 2 / 1 / 3), used while the first or a switched selection loads. */
export const LeaderboardPodiumSkeleton: React.FC = () => (
  <div className={PODIUM_GRID_CLASS}>
    {PODIUM_SKELETON_HEIGHTS.map((h, i) => (
      <Skeleton key={i} className={`${h} rounded-xl self-end`} />
    ))}
  </div>
);

/** The board on screen once standings exist: podium + Your Performance, then Full Rankings + Recent Wins. */
const LeaderboardBoard: React.FC<LeaderboardBoardProps> = ({
  agents,
  wins,
  view,
  period,
  groupName,
  userId,
  live,
  status,
  loadError,
  winsStatus,
  standingsFrozen,
  rankAnimations,
  rankMovements,
  rankMotions,
  rankDeltas,
  flashingWinId,
  spotlightAgentId,
  newLeaderId,
  onRetry,
  onExportCsv,
  formatStatusTime,
}) => {
  const animations = standingsFrozen ? EMPTY : rankAnimations;
  const movements: Map<string, RankMovement> = standingsFrozen ? EMPTY : rankMovements;
  const motions = standingsFrozen ? EMPTY : rankMotions;
  const deltas = standingsFrozen ? EMPTY : rankDeltas;
  const leader = standingsFrozen ? null : newLeaderId;

  return (
    <>
      {!live && (
        <LeaderboardErrorBanner
          message={loadError ?? (status.offline ? OFFLINE_HEADLINE : "Couldn't refresh standings.")}
          variant="stale"
          onRetry={onRetry}
          status={status}
          formatTime={formatStatusTime}
        />
      )}

      <section className={`${PODIUM_SECTION_CLASS} grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-end`}>
        <LeaderboardPodium
          agents={agents}
          view={view}
          userId={userId}
          rankAnimations={animations}
          rankMotions={motions}
          rankDeltas={deltas}
          spotlightAgentId={spotlightAgentId}
          newLeaderId={leader}
        />
        <LeaderboardYourPerformance
          agents={agents}
          userId={userId}
          movement={userId ? movements.get(userId) : undefined}
          period={period}
          view={view}
          groupName={groupName}
          className="xl:min-h-[300px]"
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LeaderboardRankingsTable
            agents={agents}
            view={view}
            userId={userId}
            rankAnimations={animations}
            rankMovements={movements}
            rankMotions={motions}
            rankDeltas={deltas}
            spotlightAgentId={spotlightAgentId}
            newLeaderId={leader}
            onExportCsv={onExportCsv}
          />
        </div>

        <RecentWinsPanel
          wins={wins}
          agents={agents}
          flashingWinId={flashingWinId}
          title={view === "group" ? "🏆 Group Recent Wins" : undefined}
          status={winsStatus}
        />
      </div>
    </>
  );
};

export default LeaderboardBoard;
