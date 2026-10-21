import { leaderboardCsv, performanceCaption } from "@/lib/leaderboardExport";
import React, { useState, useEffect, useCallback } from "react";
import { Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import TVMode from "@/components/leaderboard/TVMode";
import LeaderboardFilters from "@/components/leaderboard/LeaderboardFilters";
import LeaderboardBoard, { LeaderboardPodiumSkeleton } from "@/components/leaderboard/LeaderboardBoard";
import LeaderboardErrorBanner from "@/components/leaderboard/LeaderboardErrorBanner";
import { useLeaderboardData } from "@/hooks/useLeaderboardData";
import { useBranding } from "@/contexts/BrandingContext";
import { OFFLINE_HEADLINE, standingsLive } from "@/lib/leaderboardStatusCopy";
import { PODIUM_SECTION_CLASS } from "@/components/leaderboard/podiumLayout";

const Leaderboard: React.FC = () => {
  const { user } = useAuth();

  const {
    performanceSnapshot,
    view,
    setView,
    period,
    setPeriod,
    agents,
    wins,
    initialLoading,
    filterRefreshing,
    rankAnimations,
    rankMovements,
    rankMotions,
    rankDeltas,
    flashingWinId,
    spotlightAgentId,
    newLeaderId,
    standingsFrozen,
    agencyGroup,
    loadError,
    standingsStatus,
    winsStatus,
    retry,
  } = useLeaderboardData();
  const { formatTime } = useBranding();
  const formatStatusTime = useCallback((ms: number) => formatTime(new Date(ms)), [formatTime]);

  const [tvMode, setTvMode] = useState(false);

  const exportCSV = () => {
    if (!performanceSnapshot || initialLoading || filterRefreshing) return;
    const csv = leaderboardCsv(agents, performanceSnapshot, standingsStatus.kind !== "ok" || standingsStatus.offline);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `leaderboard-${period.toLowerCase().replace(" ", "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const enterTvMode = useCallback(() => {
    setTvMode(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  const exitTvMode = useCallback(() => {
    setTvMode(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    if (tvMode) document.body.dataset.tvMode = "true";
    else delete document.body.dataset.tvMode;
    return () => {
      delete document.body.dataset.tvMode;
    };
  }, [tvMode]);

  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement && tvMode) setTvMode(false);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, [tvMode]);

  const hasAgents = agents.length > 0;
  const showBoard = hasAgents;
  // An error string without a status (older callers) still reads as an error.
  const status =
    loadError && standingsStatus.kind === "ok" ? { ...standingsStatus, kind: "error" as const } : standingsStatus;
  const live = standingsLive(status);
  const caption = performanceSnapshot ? performanceCaption(performanceSnapshot) : "";

  if (tvMode) {
    return (
      <TVMode
        performanceSnapshot={performanceSnapshot}
        agents={agents}
        wins={wins}
        period={period}
        onPeriodChange={setPeriod}
        flashingWinId={flashingWinId}
        spotlightAgentId={spotlightAgentId}
        newLeaderId={newLeaderId}
        onExit={exitTvMode}
        standingsStatus={status}
        statusHeadline={loadError}
        winsStatus={winsStatus}
        loading={initialLoading}
        refreshing={filterRefreshing}
        onRetry={retry}
      />
    );
  }

  // Offline with nothing loaded: the offline banner below, never an endless skeleton.
  if (initialLoading && !status.offline) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className={PODIUM_SECTION_CLASS}>
          <LeaderboardPodiumSkeleton />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <LeaderboardFilters
        view={view}
        setView={setView}
        period={period}
        setPeriod={setPeriod}
        agencyGroup={agencyGroup}
        // Offline, nothing is in flight: no spinner next to the offline banner.
        filterRefreshing={filterRefreshing && !status.offline}
        onEnterTvMode={enterTvMode}
      />

      {caption && <p className="px-1 text-xs text-muted-foreground">{caption}</p>}
      {!live && !hasAgents ? (
        <LeaderboardErrorBanner
          message={loadError ?? (status.offline ? OFFLINE_HEADLINE : "Couldn't load the leaderboard.")}
          variant="full"
          onRetry={retry}
          status={status}
          formatTime={formatStatusTime}
        />
      ) : !showBoard && filterRefreshing ? (
        // A switch still loading: never "No agents on the board" before a read says so.
        <div role="status" aria-busy="true" className={PODIUM_SECTION_CLASS}>
          <span className="sr-only">Loading standings…</span>
          <LeaderboardPodiumSkeleton />
        </div>
      ) : !showBoard ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Trophy className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">No agents on the board</h2>
          <p className="text-muted-foreground mb-6">Add active agents to your organization to start tracking standings.</p>
        </div>
      ) : (
        <LeaderboardBoard
          agents={agents}
          wins={wins}
          view={view}
          period={period}
          groupName={agencyGroup?.groupName ?? null}
          userId={user?.id}
          live={live}
          status={status}
          loadError={loadError}
          winsStatus={winsStatus}
          standingsFrozen={standingsFrozen}
          rankAnimations={rankAnimations}
          rankMovements={rankMovements}
          rankMotions={rankMotions}
          rankDeltas={rankDeltas}
          flashingWinId={flashingWinId}
          spotlightAgentId={spotlightAgentId}
          newLeaderId={newLeaderId}
          onRetry={retry}
          onExportCsv={exportCSV}
          formatStatusTime={formatStatusTime}
        />
      )}
    </div>
  );
};

export default Leaderboard;
