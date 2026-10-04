import type { PerformanceSnapshot } from "@/lib/performanceQueries";
import { performanceCaption } from "@/lib/leaderboardExport";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { X, Settings, Clock, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import TVPodium from "./TVPodium";
import { useTVRankMotion } from "./useTVRankMotion";
import TVRankingsTable from "./TVRankingsTable";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { motion, LayoutGroup } from "framer-motion";
import {
  type RankMotionKind,
} from "@/components/leaderboard/leaderboardRankMotion";
import TVAgencyTotalsStrip from "@/components/leaderboard/TVAgencyTotalsStrip";
import RecentWinsPanel from "@/components/leaderboard/RecentWinsPanel";
import TVDeepRankPanel from "@/components/leaderboard/TVDeepRankPanel";
import TVStandingsNotice from "@/components/leaderboard/TVStandingsNotice";
import { useBranding } from "@/contexts/BrandingContext";
import {
  type Metric,
  type Period,
  type AgentStats,
  type RankMovement,
  type Win,
  LEADERBOARD_METRICS,
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

const METRICS = LEADERBOARD_METRICS;

/** Lower panels never determine the independently centered totals/podium width. */
const TV_GRID_CLASS =
  "mx-auto grid w-full min-h-[26rem] flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(12rem,1fr)_minmax(0,3fr)_minmax(12rem,1fr)]";

const LS_AUTO = "leaderboardTvAutoRotate";
const LS_METRIC = "leaderboardTvMetricIndex";

function readTvPrefs(): { autoRotate: boolean; metricIdx: number } {
  try {
    const auto = localStorage.getItem(LS_AUTO);
    const raw = localStorage.getItem(LS_METRIC);
    const idx = raw == null ? 0 : parseInt(raw, 10);
    const metricIdx = Number.isFinite(idx) && idx >= 0 && idx < METRICS.length ? idx : 0;
    return { autoRotate: auto !== "0", metricIdx };
  } catch {
    return { autoRotate: true, metricIdx: 0 };
  }
}

/** Format a Date using the agency's IANA timezone */
function formatInTz(date: Date, timezone: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", opts).format(date);
  }
}

interface AgentStatsRow extends AgentStats {
  recentWins7d: number;
}

interface Props {
  performanceSnapshot?: PerformanceSnapshot | null;
  agents: AgentStatsRow[];
  wins: Win[];
  period: Period;
  onPeriodChange: (period: Period) => void;
  flashingWinId?: string | null;
  rankAnimations?: Map<string, "up" | "down">;
  rankMovements?: Map<string, RankMovement>;
  rankMotions?: Map<string, RankMotionKind>;
  rankDeltas?: Map<string, number>;
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
  rankAnimations = new Map(),
  rankMovements = new Map(),
  rankMotions = new Map(),
  rankDeltas = new Map(),
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
  const [currentMetricIdx, setCurrentMetricIdx] = useState(() => readTvPrefs().metricIdx);
  const [autoRotate, setAutoRotate] = useState(() => readTvPrefs().autoRotate);
  const [clock, setClock] = useState(new Date());
  const [settingsRowId, setSettingsRowId] = useState<string | null>(null);
  const [customBanner, setCustomBanner] = useState<string | null>(null);
  const [bannerDraft, setBannerDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingBanner, setSavingBanner] = useState(false);
  const settingsOpenRef = useRef(false);

  const { profile } = useAuth();
  const { branding } = useBranding();
  const timezone = performanceSnapshot?.time_zone || branding.timezone || "UTC";
  const [organizationName, setOrganizationName] = useState<string | null>(null);

  useEffect(() => {
    const orgId = profile?.organization_id;
    if (!orgId) return;
    void supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle()
      .then(({ data }) => setOrganizationName(data?.name?.trim() || null));
  }, [profile?.organization_id]);

  const tvDisplayName = useMemo(() => {
    const branded = branding.companyName?.trim();
    if (branded && branded.toLowerCase() !== "agentflow") return branded;
    return organizationName || branded || "AgentFlow";
  }, [branding.companyName, organizationName]);

  const canEditBanner =
    profile?.role?.toLowerCase() === "admin" ||
    profile?.role?.toLowerCase() === "team leader";

  settingsOpenRef.current = settingsOpen;

  const metric = METRICS[currentMetricIdx];

  /** Ranks must follow the TV metric — parent `agents[].rank` uses the main page filter metric. */
  const rankedAgents = useMemo(
    () => rankAgents(agents.map(agent => ({ ...agent })), metric),
    [agents, metric],
  );
  const tableAgents = rankedAgents.filter((a) => a.rank >= 4 && a.rank <= 10);
  const deepRankAgents = rankedAgents.filter((a) => a.rank >= 11);
  const newLeader = newLeaderId && rankedAgents[0]?.id === newLeaderId ? rankedAgents[0] : undefined;

  const { tvRankMotions, tvRankDeltas, tvRankMovements, tvRankAnimations } =
    useTVRankMotion(rankedAgents, metric, `${profile?.organization_id}:${period}:${metric}`);

  // Clock — tick every second
  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Auto-rotate metric
  useEffect(() => {
    if (!autoRotate) return;
    const iv = setInterval(() => {
      setCurrentMetricIdx(i => {
        const next = (i + 1) % METRICS.length;
        try { localStorage.setItem(LS_METRIC, String(next)); } catch { /* ignore */ }
        return next;
      });
    }, 30000);
    return () => clearInterval(iv);
  }, [autoRotate]);

  // Fetch banner text (only the banner — branding context handles name/timezone)
  useEffect(() => {
    void supabase
      .from("company_settings")
      .select("id, leaderboard_tv_banner_text")
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return;
        if (data?.id) setSettingsRowId(data.id);
        const b = (data as any)?.leaderboard_tv_banner_text ?? null;
        setCustomBanner(b?.trim() ? b : null);
        setBannerDraft(b ?? "");
      });
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

  const saveBanner = async () => {
    if (!canEditBanner || !settingsRowId) {
      toast.error("Unable to save (missing settings row or permission).");
      return;
    }
    setSavingBanner(true);
    const trimmed = bannerDraft.trim();
    const { error } = await supabase
      .from("company_settings")
      .update({ leaderboard_tv_banner_text: trimmed || null })
      .eq("id", settingsRowId);
    setSavingBanner(false);
    if (error) { toast.error(error.message || "Save failed"); return; }
    setCustomBanner(trimmed || null);
    toast.success(trimmed ? "Ticker message updated" : "Ticker reset to live wins");
  };


  const winsTicker =
    wins.length > 0
      ? wins.map(w => `🏆 ${w.agent_name || "Agent"} closed ${w.contact_name || "a deal"}${w.campaign_name ? ` (${w.campaign_name})` : ""}`).join("  ·  ")
      : "🏆 No wins yet — get dialing!";

  const formatTvTime = (ms: number) =>
    formatInTz(new Date(ms), timezone, { hour: "numeric", minute: "2-digit", hour12: true });
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

  // Timezone-aware formatted strings
  const clockDisplay = formatInTz(clock, timezone, { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  const tickerTimeDisplay = formatInTz(clock, timezone, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <div className="fixed inset-0 z-[9999] bg-[#020617] text-slate-50 flex flex-col min-h-0 overflow-hidden font-sans">
      {/* Static radial background — no animation to keep GPU free */}
      <div className="absolute inset-0 z-0 pointer-events-none"
           style={{ background: "radial-gradient(ellipse at 50% 30%, #0f172a 0%, #020617 70%)" }} />

      {/* Toolbar — 3-column grid; side clusters sit above center title for reliable clicks */}
      <div className="relative z-[10001] grid h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-white/5 bg-black/40 px-4 md:px-6 backdrop-blur-md">
        <div className="relative z-20 flex min-w-0 items-center gap-2 md:gap-4">
          <Popover modal={false} open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative z-30 h-10 w-10 shrink-0 touch-manipulation rounded-lg border border-white/10 bg-white/5 text-slate-300 shadow-sm transition-all hover:bg-white/10"
                aria-label="TV display options"
                aria-expanded={settingsOpen}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              onEscapeKeyDown={event => {
                event.preventDefault();
                setSettingsOpen(false);
              }}
              className="z-[10020] w-80 max-h-[min(85vh,32rem)] overflow-y-auto p-4 sm:w-96 bg-slate-900 border-slate-800 text-slate-200 shadow-2xl"
              align="start"
              side="bottom"
              sideOffset={8}
            >
              <div className="space-y-4">
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Viewing metric</Label>
                  <select
                    aria-label="Viewing metric"
                    className="mt-1.5 w-full h-10 rounded-md border border-slate-700 bg-slate-800 px-3 text-sm text-white focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                    value={currentMetricIdx}
                    disabled={autoRotate}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      setCurrentMetricIdx(v);
                      try { localStorage.setItem(LS_METRIC, String(v)); } catch { /* ignore */ }
                    }}
                  >
                    {METRICS.map((m, i) => (
                      <option key={m} value={i}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 py-3">
                  <div>
                    <Label htmlFor="tv-auto-rotate" className="text-sm font-medium">Auto-rotate stats</Label>
                    <p className="text-[11px] text-slate-400">Cycles metrics every 30s.</p>
                  </div>
                  <Switch
                    id="tv-auto-rotate"
                    checked={autoRotate}
                    onCheckedChange={v => {
                      setAutoRotate(v);
                      try { localStorage.setItem(LS_AUTO, v ? "1" : "0"); } catch { /* ignore */ }
                    }}
                  />
                </div>
                {canEditBanner && (
                  <div className="border-t border-slate-800 pt-4 space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Scrolling ticker (org-wide)</Label>
                    <Textarea
                      value={bannerDraft}
                      onChange={e => setBannerDraft(e.target.value)}
                      placeholder="Custom message or win feed…"
                      rows={3}
                      className="text-sm bg-slate-800 border-slate-700 focus:ring-blue-500"
                    />
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" className="border-slate-700 text-slate-300" onClick={() => setBannerDraft(customBanner ?? "")} disabled={savingBanner}>
                        Reset
                      </Button>
                      <Button type="button" size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => void saveBanner()} disabled={savingBanner || bannerDraft === (customBanner ?? "")}>
                        {savingBanner ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
          <div className="h-6 w-[1px] bg-white/10 hidden sm:block" />
          {/* Bigger clock and live feed */}
          <div className="flex items-center gap-5 text-white">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-400 shrink-0" />
              <span className="text-base font-bold tabular-nums tracking-wide">{clockDisplay}</span>
            </div>
            {live && (
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 shrink-0 text-emerald-400" />
                <span className="hidden text-base font-bold uppercase tracking-widest text-emerald-400 md:inline">
                  Live Feed
                </span>
              </div>
            )}
          </div>
        </div>

        <h1
          className="pointer-events-none relative z-10 max-w-[9rem] select-none truncate text-center text-base font-black tracking-tight text-white drop-shadow-md sm:max-w-xs sm:text-lg md:max-w-md md:text-xl"
          title={tvDisplayName}
        >
          {tvDisplayName}
        </h1>

        <div className="relative z-20 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 touch-manipulation rounded-lg border border-white/10 bg-white/5 text-slate-300 transition-all hover:bg-red-500/20 hover:text-red-400"
          onClick={onExit}
          aria-label="Exit TV mode"
        >
          <X className="h-5 w-5" />
        </Button>
        </div>
      </div>

      <main className="relative z-10 flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto px-6 py-4 md:gap-5 md:py-5">
        {newLeader ? (
          <motion.div
            key={newLeader.id}
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            className="pointer-events-none flex shrink-0 justify-center"
          >
            <div className="rounded-full border border-yellow-400/40 bg-yellow-500/15 px-6 py-2 text-center shadow-[0_0_40px_-12px_rgba(234,179,8,0.45)] backdrop-blur-md md:px-8 md:py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-yellow-300/90">New #1</p>
              <p className="text-lg font-black uppercase tracking-wide text-white md:text-xl">
                {newLeader.first_name} {newLeader.last_name?.[0]}.
              </p>
            </div>
          </motion.div>
        ) : null}

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
          {performanceSnapshot && <p className="text-xs text-slate-400 text-center">{performanceCaption(performanceSnapshot)}</p>}
      <TVAgencyTotalsStrip
            agents={agents}
            period={period}
            onPeriodChange={onPeriodChange}
            highlightMetric={metric}
          />
        </div>

        {/* Totals and podium share the page center; lower panels size independently. */}
        <LayoutGroup id="tv-leaderboard">
          <TVPodium key={`${period}:${metric}`} agents={rankedAgents} metric={metric}
            tvRankMotions={tvRankMotions} tvRankAnimations={tvRankAnimations}
            spotlightAgentId={spotlightAgentId} newLeaderId={newLeaderId} />
          <div className={TV_GRID_CLASS}>

          <div className="order-2 flex min-h-[18rem] flex-col xl:order-none xl:col-start-1">
            <TVDeepRankPanel
              agents={deepRankAgents}
              metric={metric}
              rankDeltas={tvRankDeltas}
              spotlightAgentId={spotlightAgentId}
              newLeaderId={newLeaderId}
            />
          </div>

          <TVRankingsTable key={`${period}:${metric}`} tableAgents={tableAgents} metric={metric} live={live}
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
        </>
        )}
      </main>

      {/* Footer Ticker */}
      <footer className="shrink-0 h-12 border-t border-white/5 bg-black/70 backdrop-blur-xl flex items-center overflow-hidden">
        <div className="relative w-full h-full flex items-center overflow-hidden">
          <div className="animate-ticker whitespace-nowrap flex items-center min-w-max">
            {[1, 2, 3, 4].map((group) => (
              <div key={group} className="flex items-center gap-10 px-10">
                <span className="text-blue-400 font-black uppercase tracking-[0.25em] text-xs px-5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 shrink-0">
                  {live ? "LIVE NEWS FEED" : "NEWS FEED"}
                </span>
                <span className="text-sm font-bold text-slate-200 tracking-wide uppercase">
                  {tickerText}
                </span>
                <span className="text-blue-500 opacity-40 text-lg">•</span>
                <span className="text-sm font-bold text-slate-400 tracking-wide uppercase">
                  {tickerTimeDisplay}
                </span>
                <span className="text-blue-500 opacity-40 text-lg">•</span>
              </div>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
};

export default TVMode;
