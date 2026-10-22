import type { PerformanceSnapshot } from "@/lib/performanceQueries";
import { performanceCaption } from "@/lib/leaderboardExport";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { useTvClock } from "./useTvClock";
import TVBoard, { TVNewLeaderBanner } from "./TVBoard";
import TVToolbar from "./TVToolbar";
import TVTicker from "./TVTicker";
import { useTvDisplaySettings } from "./useTvDisplaySettings";
import { useAuth } from "@/contexts/AuthContext";
import TVAgencyTotalsStrip from "@/components/leaderboard/TVAgencyTotalsStrip";
import TVStandingsNotice from "@/components/leaderboard/TVStandingsNotice";
import { useBranding } from "@/contexts/BrandingContext";
import {
  type Period,
  type AgentStats,
  type Win,
  rankAgents,
} from "@/components/leaderboard/leaderboardTypes";
import {
  type StandingsStatus,
  type WinsStatus,
  OFFLINE_HEADLINE,
  STANDINGS_STATUS_OK,
  standingsHeadline,
  standingsLive,
  tvTickerText,
} from "@/lib/leaderboardStatusCopy";

/** Stored by the removed metric selector and auto-rotation; TV now always ranks by AP. */
const OBSOLETE_TV_PREFS = ["leaderboardTvMetricIndex", "leaderboardTvAutoRotate"];

interface Props {
  performanceSnapshot?: PerformanceSnapshot | null;
  agents: AgentStats[];
  wins: Win[];
  period: Period;
  onPeriodChange: (period: Period) => void;
  flashingWinId?: string | null;
  spotlightAgentId?: string | null;
  newLeaderId?: string | null;
  onExit: () => void;
  /** Standings load state; anything but "ok" means the board is not live. */
  standingsStatus?: StandingsStatus;
  /** Headline for a non-live state (the hook's loadError). */
  statusHeadline?: string | null;
  winsStatus?: WinsStatus;
  /** The first standings for this selection are still loading. */
  loading?: boolean;
  /** A period switch is loading: the rows on screen belong to the previous period. */
  refreshing?: boolean;
  onRetry?: () => void;
}

const TVMode: React.FC<Props> = ({
  performanceSnapshot,
  agents,
  wins,
  period,
  onPeriodChange,
  flashingWinId = null,
  spotlightAgentId = null,
  newLeaderId = null,
  onExit,
  standingsStatus = STANDINGS_STATUS_OK,
  statusHeadline = null,
  winsStatus,
  loading = false,
  refreshing = false,
  onRetry,
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(false);

  const { profile } = useAuth();
  const { branding } = useBranding();
  const timezone = performanceSnapshot?.time_zone || branding.timezone || "UTC";
  const banner = useTvDisplaySettings();
  const { clockDisplay, tickerTimeDisplay, formatTvTime } = useTvClock(timezone);

  settingsOpenRef.current = settingsOpen;

  /** AP order (idempotent over the page's ranked rows; keeps TV correct for any caller). */
  const rankedAgents = useMemo(() => rankAgents(agents.map(agent => ({ ...agent }))), [agents]);
  const newLeader = newLeaderId && rankedAgents[0]?.id === newLeaderId ? rankedAgents[0] : undefined;

  // The metric selector and auto-rotation are gone: drop their stored preferences (best effort).
  useEffect(() => {
    try { OBSOLETE_TV_PREFS.forEach(key => localStorage.removeItem(key)); } catch { /* ignore */ }
  }, []);

  // Escape key handler
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== "Escape") return;
      if (settingsOpenRef.current) { setSettingsOpen(false); return; }
      onExit();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onExit]);

  const caption = performanceSnapshot ? performanceCaption(performanceSnapshot) : "";
  const winsTicker =
    wins.length > 0
      ? wins.map(w => `🏆 ${w.agent_name || "Agent"} closed ${w.contact_name || "a deal"}${w.campaign_name ? ` (${w.campaign_name})` : ""}`).join("  ·  ")
      : "🏆 No wins yet — get dialing!";
  const customBanner = banner.customBanner;

  /** Nothing on screen for this selection: show the notice, never an empty podium or zero totals. */
  const noSnapshot = agents.length === 0 && (loading || refreshing || !standingsLive(standingsStatus));
  const live = standingsLive(standingsStatus) && !noSnapshot && !refreshing;
  const headline =
    statusHeadline ??
    (standingsStatus.kind === "ok"
      ? standingsStatus.offline
        ? OFFLINE_HEADLINE
        : ""
      : standingsHeadline(standingsStatus.kind, !noSnapshot));
  const tickerText = winsStatus
    ? tvTickerText({ customBanner, winsStatus, winsTicker, standings: standingsStatus, format: formatTvTime })
    : customBanner?.trim()
      ? customBanner.trim()
      : winsTicker;

  return (
    <div className="fixed inset-0 z-[9999] bg-[#020617] text-slate-50 flex flex-col min-h-0 overflow-hidden font-sans">
      {/* Static radial background — no animation to keep GPU free */}
      <div className="absolute inset-0 z-0 pointer-events-none"
           style={{ background: "radial-gradient(ellipse at 50% 30%, #0f172a 0%, #020617 70%)" }} />

      <TVToolbar
        clockDisplay={clockDisplay}
        live={live}
        tvDisplayName={banner.tvDisplayName}
        onExit={onExit}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
        canEditBanner={banner.canEditBanner}
        customBanner={customBanner}
        bannerDraft={banner.bannerDraft}
        onBannerDraftChange={banner.setBannerDraft}
        savingBanner={banner.savingBanner}
        onSaveBanner={() => void banner.saveBanner()}
      />

      <main className="relative z-10 flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto px-6 py-4 md:gap-5 md:py-5">
        <TVNewLeaderBanner leader={newLeader} />

        {noSnapshot ? (
          <TVStandingsNotice
            variant="full"
            loading={(loading || refreshing) && standingsStatus.kind === "ok" && !standingsStatus.offline}
            headline={headline}
            status={standingsStatus}
            period={period}
            onPeriodChange={onPeriodChange}
            onRetry={onRetry}
            formatTime={formatTvTime}
          />
        ) : (
        <>
        {!live && (
          <TVStandingsNotice
            variant="strip"
            loading={refreshing && standingsStatus.kind === "ok" && !standingsStatus.offline}
            headline={headline}
            status={standingsStatus}
            period={period}
            onPeriodChange={onPeriodChange}
            formatTime={formatTvTime}
          />
        )}
        <div data-testid="tv-agency-totals" className="mx-auto w-full max-w-[72rem] shrink-0">
          {caption && <p className="text-xs text-slate-400 text-center">{caption}</p>}
          <TVAgencyTotalsStrip agents={agents} period={period} onPeriodChange={onPeriodChange} />
        </div>

        {/* Totals and podium share the page center; lower panels size independently. */}
        <TVBoard rankedAgents={rankedAgents} agents={agents} period={period}
          selection={`${profile?.organization_id}:${period}`} live={live} wins={wins} winsStatus={winsStatus}
          flashingWinId={flashingWinId} spotlightAgentId={spotlightAgentId} newLeaderId={newLeaderId} />
        </>
        )}
      </main>

      <TVTicker live={live} tickerText={tickerText} tickerTimeDisplay={tickerTimeDisplay} />
    </div>
  );
};

export default TVMode;
