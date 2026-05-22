import React, { useState, useEffect, useCallback } from "react";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import TVMode from "@/components/leaderboard/TVMode";
import LeaderboardFilters from "@/components/leaderboard/LeaderboardFilters";
import LeaderboardPodium from "@/components/leaderboard/LeaderboardPodium";
import LeaderboardRankingsTable from "@/components/leaderboard/LeaderboardRankingsTable";
import RecentWinsPanel from "@/components/leaderboard/RecentWinsPanel";
import { useLeaderboardData } from "@/hooks/useLeaderboardData";
import { metricKey } from "@/components/leaderboard/leaderboardTypes";
import {
  PODIUM_GRID_CLASS,
  PODIUM_SECTION_CLASS,
  PODIUM_SKELETON_HEIGHTS,
} from "@/components/leaderboard/podiumLayout";

const Leaderboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const {
    view,
    setView,
    period,
    setPeriod,
    metric,
    setMetric,
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
    agencyGroup,
  } = useLeaderboardData();

  const [tvMode, setTvMode] = useState(false);

  const exportCSV = () => {
    const groupMode = view === "group";
    const headers = [
      "Rank",
      "Agent Name",
      ...(groupMode ? ["Organization"] : []),
      "Calls Made",
      "Policies Sold",
      "Premium Sold (Annual)",
      "Appointments Set",
      "Talk Time (minutes)",
      "Conversion Rate",
    ];
    const rows = agents.map((a) => [
      a.rank,
      `${a.first_name} ${a.last_name}`,
      ...(groupMode ? [a.organizationName ?? ""] : []),
      a.callsMade,
      a.policiesSold,
      Math.round(a.premiumSold),
      a.appointmentsSet,
      Math.round(a.talkTime / 60),
      `${a.conversionRate.toFixed(1)}%`,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
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

  const restAgents = agents.filter((a) => a.rank > 3);
  const hasData = agents.some((a) => (a[metricKey(metric)] as number) > 0);

  if (tvMode) {
    return (
      <TVMode
        agents={agents}
        wins={wins}
        period={period}
        onPeriodChange={setPeriod}
        flashingWinId={flashingWinId}
        rankAnimations={rankAnimations}
        rankMovements={rankMovements}
        rankMotions={rankMotions}
        rankDeltas={rankDeltas}
        spotlightAgentId={spotlightAgentId}
        newLeaderId={newLeaderId}
        onExit={exitTvMode}
      />
    );
  }

  if (initialLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className={PODIUM_SECTION_CLASS}>
          <div className={PODIUM_GRID_CLASS}>
            {PODIUM_SKELETON_HEIGHTS.map((h, i) => (
              <Skeleton key={i} className={`${h} rounded-xl self-end`} />
            ))}
          </div>
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
        metric={metric}
        setMetric={setMetric}
        agencyGroup={agencyGroup}
        filterRefreshing={filterRefreshing}
        onEnterTvMode={enterTvMode}
      />

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Trophy className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">
            No activity for {period.toLowerCase()}
          </h2>
          <p className="text-muted-foreground mb-6">Start making calls to climb the leaderboard!</p>
          <Button onClick={() => navigate("/dialer")}>Go to Dialer</Button>
        </div>
      ) : (
        <>
          <section className={PODIUM_SECTION_CLASS}>
            <LeaderboardPodium
              agents={agents}
              metric={metric}
              view={view}
              userId={user?.id}
              rankAnimations={rankAnimations}
              rankMotions={rankMotions}
              rankDeltas={rankDeltas}
              spotlightAgentId={spotlightAgentId}
              newLeaderId={newLeaderId}
            />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <LeaderboardRankingsTable
                restAgents={restAgents}
                view={view}
                userId={user?.id}
                rankAnimations={rankAnimations}
                rankMovements={rankMovements}
                rankMotions={rankMotions}
                rankDeltas={rankDeltas}
                spotlightAgentId={spotlightAgentId}
                newLeaderId={newLeaderId}
                onExportCsv={exportCSV}
              />
            </div>

            <RecentWinsPanel
              wins={wins}
              agents={agents}
              flashingWinId={flashingWinId}
              title={view === "group" ? "🏆 Group Recent Wins" : undefined}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default Leaderboard;
