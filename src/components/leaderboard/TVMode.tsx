import React, { useState, useEffect, useRef, useMemo } from "react";
import { Trophy, X, Settings, TrendingUp, Clock, Activity, ArrowUp, ArrowDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import LeaderboardAgentAvatar from "./LeaderboardAgentAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import {
  type RankMotionKind,
  buildRankDeltaMap,
  buildRankMotionMap,
  computeRankMovements,
  podiumEnterInitial,
  tvGlideTransition,
  tvPodiumEnterTransition,
  tvPodiumExitTransition,
  tvTableRowLayoutTransition,
} from "@/components/leaderboard/leaderboardRankMotion";
import OdometerValue from "@/components/leaderboard/OdometerValue";
import TVAgencyTotalsStrip from "@/components/leaderboard/TVAgencyTotalsStrip";
import RecentWinsPanel from "@/components/leaderboard/RecentWinsPanel";
import TVDeepRankPanel from "@/components/leaderboard/TVDeepRankPanel";
import { TV_PANEL_CLASS, TV_PANEL_HEADER_CLASS } from "@/components/leaderboard/tvPanelLayout";
import { agentHighlightClass } from "@/components/leaderboard/leaderboardHighlight";
import { useBranding } from "@/contexts/BrandingContext";
import {
  type Metric,
  type Period,
  type AgentStats,
  type RankMovement,
  type Win,
  LEADERBOARD_METRICS,
  formatMetricValue,
  metricKey,
  formatPremiumSold,
} from "@/components/leaderboard/leaderboardTypes";

const METRICS = LEADERBOARD_METRICS;

/** Center column = podium (72rem); side columns outside; grid shrink-wraps so mx-auto centers */
const TV_GRID_CLASS =
  "mx-auto grid w-max max-w-full min-h-0 flex-1 grid-cols-[18rem_72rem_22rem] grid-rows-[auto_minmax(0,1fr)] gap-x-4 gap-y-4";
const TV_CENTER_COL = "col-start-2 min-w-0 w-full max-w-[72rem]";

/** Fixed 7-row TV table (ranks 4–10) — equal-height rows, no scroll */
const TV_TABLE_ROW =
  "grid w-full grid-cols-[3rem_minmax(7rem,1.1fr)_repeat(6,minmax(2.75rem,1fr))] items-center gap-x-1.5 px-4 sm:gap-x-2 sm:px-5";

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

const rankMovementDisplay = (movement: RankMovement | undefined) => {
  if (!movement) return null;
  if (movement.direction === "up") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-emerald-400 text-xs font-semibold whitespace-nowrap"
        title={`Moved up ${movement.spots} spot${movement.spots === 1 ? "" : "s"} since the last leaderboard update`}
      >
        <ArrowUp className="w-3 h-3" aria-hidden />
        {movement.spots}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 text-red-400 text-xs font-semibold whitespace-nowrap"
      title={`Moved down ${movement.spots} spot${movement.spots === 1 ? "" : "s"} since the last leaderboard update`}
    >
      <ArrowDown className="w-3 h-3" aria-hidden />
      {movement.spots}
    </span>
  );
};

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
}

const TVMode: React.FC<Props> = ({
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
  const timezone = branding.timezone || "America/Chicago";
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
  const key = metricKey(metric);

  /** Ranks must follow the TV metric — parent `agents[].rank` uses the main page filter metric. */
  const rankedAgents = useMemo(
    () =>
      [...agents]
        .sort((a, b) => (b[key] as number) - (a[key] as number))
        .map((agent, index) => ({ ...agent, rank: index + 1 })),
    [agents, key],
  );
  const top3 = rankedAgents.slice(0, 3);
  const tableAgents = rankedAgents.filter((a) => a.rank >= 4 && a.rank <= 10);
  const deepRankAgents = rankedAgents.filter((a) => a.rank >= 11);
  const newLeader = newLeaderId ? agents.find((a) => a.id === newLeaderId) : undefined;

  /** TV metric re-sorts locally — track motions against displayed ranks, not the page filter metric. */
  const previousTvRanksRef = useRef<Map<string, number>>(new Map());
  const [tvRankMotions, setTvRankMotions] = useState<Map<string, RankMotionKind>>(new Map());
  const [tvRankDeltas, setTvRankDeltas] = useState<Map<string, number>>(new Map());
  const [tvRankMovements, setTvRankMovements] = useState<Map<string, RankMovement>>(new Map());
  const [tvRankAnimations, setTvRankAnimations] = useState<Map<string, "up" | "down">>(new Map());

  useEffect(() => {
    previousTvRanksRef.current = new Map();
    setTvRankMotions(new Map());
    setTvRankDeltas(new Map());
    setTvRankMovements(new Map());
    setTvRankAnimations(new Map());
  }, [metric]);

  useEffect(() => {
    const prev = previousTvRanksRef.current;
    if (prev.size === 0) {
      rankedAgents.forEach((a) => prev.set(a.id, a.rank));
      return;
    }

    const motions = buildRankMotionMap(rankedAgents, prev);
    const deltas = buildRankDeltaMap(rankedAgents, prev);
    const movements = computeRankMovements(rankedAgents, prev);
    const anims = new Map<string, "up" | "down">();

    motions.forEach((_kind, id) => {
      const previousRank = prev.get(id);
      const agent = rankedAgents.find((x) => x.id === id);
      if (previousRank === undefined || !agent) return;
      if (agent.rank < previousRank) anims.set(id, "up");
      else if (agent.rank > previousRank) anims.set(id, "down");
    });

    if (motions.size > 0) {
      setTvRankMotions(motions);
      setTvRankDeltas(deltas);
      window.setTimeout(() => {
        setTvRankMotions(new Map());
        setTvRankDeltas(new Map());
      }, 2400);
    }
    if (movements.size > 0) {
      setTvRankMovements(movements);
      window.setTimeout(() => setTvRankMovements(new Map()), 2400);
    }
    if (anims.size > 0) {
      setTvRankAnimations(anims);
      window.setTimeout(() => setTvRankAnimations(new Map()), 2600);
    }

    rankedAgents.forEach((a) => prev.set(a.id, a.rank));
  }, [rankedAgents]);

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
      if (e.key !== "Escape") return;
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

  const metalConfig = (rank: number) => {
    if (rank === 1) {
      return {
        trophyColor: "text-yellow-400",
        border: "border-yellow-500/40",
        trophyBorder: "border-yellow-500/45",
        trophyShadow: "shadow-[0_0_28px_-2px_rgba(234,179,8,0.55)]",
        cardShadow:
          "shadow-[0_16px_48px_-16px_rgba(0,0,0,0.65),0_0_56px_-14px_rgba(234,179,8,0.38)]",
        cardRing: "ring-1 ring-yellow-500/35",
        ambientGradient:
          "radial-gradient(ellipse 90% 70% at 50% 88%, rgba(234,179,8,0.28) 0%, rgba(234,179,8,0.08) 42%, transparent 72%)",
        rankBadge: "bg-yellow-500 border-yellow-400 text-black",
      };
    }
    if (rank === 2) {
      return {
        trophyColor: "text-slate-300",
        border: "border-slate-400/35",
        trophyBorder: "border-slate-300/40",
        trophyShadow: "shadow-[0_0_22px_-2px_rgba(148,163,184,0.45)]",
        cardShadow:
          "shadow-[0_14px_40px_-16px_rgba(0,0,0,0.6),0_0_44px_-14px_rgba(148,163,184,0.28)]",
        cardRing: "ring-1 ring-slate-400/25",
        ambientGradient:
          "radial-gradient(ellipse 90% 70% at 50% 88%, rgba(148,163,184,0.22) 0%, rgba(148,163,184,0.06) 42%, transparent 72%)",
        rankBadge: "bg-slate-400 border-slate-300 text-black",
      };
    }
    return {
      trophyColor: "text-orange-400",
      border: "border-orange-500/35",
      trophyBorder: "border-orange-500/40",
      trophyShadow: "shadow-[0_0_22px_-2px_rgba(251,146,60,0.45)]",
      cardShadow:
        "shadow-[0_14px_40px_-16px_rgba(0,0,0,0.6),0_0_44px_-14px_rgba(251,146,60,0.28)]",
      cardRing: "ring-1 ring-orange-500/25",
      ambientGradient:
        "radial-gradient(ellipse 90% 70% at 50% 88%, rgba(251,146,60,0.24) 0%, rgba(251,146,60,0.07) 42%, transparent 72%)",
      rankBadge: "bg-orange-600 border-orange-500 text-white",
    };
  };

  const winsTicker =
    wins.length > 0
      ? wins.map(w => `🏆 ${w.agent_name || "Agent"} closed ${w.contact_name || "a deal"}${w.campaign_name ? ` (${w.campaign_name})` : ""}`).join("  ·  ")
      : "🏆 No wins yet — get dialing!";

  const tickerText = customBanner?.trim() ? customBanner.trim() : winsTicker;

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
              className="z-[10020] w-80 max-h-[min(85vh,32rem)] overflow-y-auto p-4 sm:w-96 bg-slate-900 border-slate-800 text-slate-200 shadow-2xl"
              align="start"
              side="bottom"
              sideOffset={8}
            >
              <div className="space-y-4">
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Viewing metric</Label>
                  <select
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
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 shrink-0 text-emerald-400" />
              <span className="hidden text-base font-bold uppercase tracking-widest text-emerald-400 md:inline">
                Live Feed
              </span>
            </div>
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
        >
          <X className="h-5 w-5" />
        </Button>
        </div>
      </div>

      <main className="relative z-10 flex flex-1 min-h-0 flex-col gap-4 overflow-hidden px-6 py-4 md:gap-5 md:py-5">
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

        <div className="mx-auto w-full max-w-[72rem] shrink-0">
          <TVAgencyTotalsStrip
            agents={agents}
            period={period}
            onPeriodChange={onPeriodChange}
            highlightMetric={metric}
          />
        </div>

        {/* Podium + bottom panels share a 3-col grid: sides outside, center = podium width */}
        <LayoutGroup id="tv-leaderboard">
        <div className={TV_GRID_CLASS}>
          <div className={`${TV_CENTER_COL} mt-3 flex h-[300px] shrink-0 items-end justify-center gap-4 md:mt-5 md:h-[320px] md:gap-6`}>
            {([2, 1, 3] as const).map((slotRank) => {
              const a = rankedAgents.find((agent) => agent.rank === slotRank);
              if (!a && top3.length < 3) return <div key={`slot-${slotRank}`} className="flex-1" />;

              const mc = metalConfig(slotRank);
              const isFirst = slotRank === 1;
              const metricNumeric = a ? (a[key] as number) : 0;
              const motionKind = a ? tvRankMotions.get(a.id) ?? "none" : "none";
              const useLayoutGlide = motionKind === "glide";
              const rankGlow = a ? tvRankAnimations.get(a.id) : undefined;
              const pillPop = motionKind !== "none";

              return (
                <div key={`slot-${slotRank}`} className="relative isolate h-full min-w-0 flex-1">
                  <AnimatePresence mode="sync" initial={false}>
                    {a ? (
                      <motion.div
                        key={a.id}
                        layout={useLayoutGlide ? "position" : false}
                        layoutId={useLayoutGlide ? `tv-podium-agent-${a.id}` : undefined}
                        initial={motionKind === "podium-enter" ? podiumEnterInitial : false}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.92 }}
                        transition={
                          useLayoutGlide
                            ? tvGlideTransition
                            : motionKind === "podium-enter"
                              ? tvPodiumEnterTransition
                              : tvPodiumExitTransition
                        }
                        style={{ transformOrigin: "bottom center", willChange: "transform, opacity" }}
                        className={`absolute bottom-0 left-0 right-0 w-full flex flex-col items-center ${
                          slotRank === 1 ? "scale-[1.02]" : slotRank === 2 ? "scale-[1.01]" : "scale-100"
                        }`}
                      >
                  {/* Card Body — trophy sits on the card lip so it cannot overlap the header */}
                  <div className="relative z-10 w-full">
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 top-[-12%] z-0 [mask-image:linear-gradient(to_top,black_55%,transparent_100%)]"
                      style={{ background: mc.ambientGradient }}
                    />
                    <div
                      className={`relative z-10 w-full rounded-2xl border bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-6 pb-5 text-center backdrop-blur-lg ${mc.border} ${mc.cardShadow} ${mc.cardRing} ${
                        rankGlow === "up" ? "animate-rank-up-glow" : ""
                      } ${rankGlow === "down" ? "animate-rank-down-glow" : ""} ${agentHighlightClass(a.id, {
                        spotlightAgentId,
                        newLeaderId,
                      })}`}
                    >
                      <div
                        className={`absolute left-1/2 z-20 -translate-x-1/2 rounded-full border-2 bg-white/[0.06] backdrop-blur-sm ${mc.trophyBorder} ${mc.trophyShadow} ${
                          isFirst ? "-top-8 p-3" : "-top-7 p-2.5"
                        } ${newLeaderId === a.id || (rankGlow === "up" && isFirst) ? "animate-tv-trophy-shimmer" : ""}`}
                      >
                        <Trophy className={`${isFirst ? "h-9 w-9" : "h-7 w-7"} ${mc.trophyColor} drop-shadow-lg`} />
                      </div>

                      <div className={`mx-auto flex w-full max-w-full flex-col items-center ${isFirst ? "pt-7" : "pt-6"}`}>
                      <LeaderboardAgentAvatar
                        avatarUrl={a.avatar_url}
                        initials={`${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`}
                        alt={`${a.first_name} ${a.last_name}`}
                        className={`mx-auto mb-4 border-2 shadow-xl ${mc.border} ${isFirst ? "h-24 w-24" : "h-20 w-20"}`}
                        fallbackClassName={isFirst ? "text-3xl bg-blue-600/20" : "text-2xl"}
                      />

                      <h3 className={`w-full truncate px-2 text-center font-black leading-none tracking-tight text-white ${isFirst ? "text-2xl" : "text-xl"}`}>
                        {a.first_name} {a.last_name?.[0]}.
                      </h3>

                      <div className="mt-5 flex w-full flex-col items-center justify-center text-center">
                        <OdometerValue
                          value={metricNumeric}
                          format={(n) => formatMetricValue(metric, n)}
                          tv
                          className={`font-black tabular-nums text-white drop-shadow-lg leading-none ${isFirst ? "text-5xl" : "text-4xl"}`}
                        />
                        <span className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                          {metric}
                        </span>
                      </div>
                      </div>
                    </div>
                  </div>

                  {/* Rank Badge */}
                  <div
                    key={a ? `${a.rank}-${motionKind}` : slotRank}
                    className={`absolute -bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-full border px-4 py-1 text-xs font-black uppercase tracking-widest shadow-xl ${mc.rankBadge} ${
                      pillPop ? "animate-rank-pill-pop" : ""
                    }`}
                  >
                    #{slotRank}
                  </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

          <div className="col-start-1 row-start-2 flex min-h-0 flex-col">
            <TVDeepRankPanel
              agents={deepRankAgents}
              metric={metric}
              rankDeltas={tvRankDeltas}
              spotlightAgentId={spotlightAgentId}
              newLeaderId={newLeaderId}
            />
          </div>

          <div className={`${TV_CENTER_COL} row-start-2 flex min-h-0 flex-col overflow-hidden`}>
          <div className={TV_PANEL_CLASS}>
            <div className={`${TV_PANEL_HEADER_CLASS} justify-center`}>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-blue-400">
                <TrendingUp className="h-4 w-4" />
                Live Ranking: {metric}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                className={`${TV_TABLE_ROW} shrink-0 border-b border-white/5 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500`}
              >
                <span className="text-left">Rank</span>
                <span className="text-center">Agent</span>
                <span className="text-center">Calls</span>
                <span className="text-center">Policies</span>
                <span className="text-center">Premium</span>
                <span className="text-center">Appts</span>
                <span className="text-center">Talk</span>
                <span className="text-center">Conv</span>
              </div>

              <LayoutGroup id="tv-table">
                <motion.div layout className="grid min-h-0 flex-1 grid-rows-7 divide-y divide-white/[0.05]">
                  {tableAgents.length === 0 ? (
                    <div className="col-span-full flex flex-1 items-center justify-center py-8 text-center text-sm font-medium tracking-wide text-slate-500">
                      ALL AGENTS COMPETING ON THE PODIUM
                    </div>
                  ) : (
                    tableAgents.map((a) => {
                      const rank = a.rank;
                      const motionKind = tvRankMotions.get(a.id) ?? "none";
                      const rankGlow = tvRankAnimations.get(a.id);
                      const rankDelta = tvRankDeltas.get(a.id) ?? 0;

                      return (
                        <motion.div
                          key={a.id}
                          layout="position"
                          layoutId={`tv-leaderboard-row-${a.id}`}
                          transition={{ layout: tvTableRowLayoutTransition(rankDelta) }}
                          className={`${TV_TABLE_ROW} min-h-0 ${rankGlow === "up" ? "animate-rank-up-glow" : ""} ${rankGlow === "down" ? "animate-rank-down-glow" : ""} ${agentHighlightClass(a.id, { spotlightAgentId, newLeaderId })}`}
                        >
                          <div className="flex items-center gap-0.5 font-black text-sm text-slate-400">
                            <span key={`${rank}-${motionKind}`} className={motionKind !== "none" ? "animate-rank-pill-pop" : ""}>
                              {rank}
                            </span>
                            {rankMovementDisplay(tvRankMovements.get(a.id))}
                          </div>
                          <div className="flex min-w-0 items-center justify-center gap-2">
                            <LeaderboardAgentAvatar
                              avatarUrl={a.avatar_url}
                              initials={`${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`}
                              alt={`${a.first_name} ${a.last_name}`}
                              className="h-8 w-8 shrink-0 border border-white/10"
                              fallbackClassName="text-xs bg-blue-500/10 text-blue-400"
                            />
                            <span className="truncate text-sm font-bold text-white">
                              {a.first_name} {a.last_name?.[0]}.
                            </span>
                          </div>
                          <div className="text-center text-sm tabular-nums font-medium text-slate-300">
                            <OdometerValue value={a.callsMade} format={(n) => String(Math.round(n))} tv />
                          </div>
                          <div className="text-center text-sm tabular-nums font-bold text-blue-400">
                            <OdometerValue value={a.policiesSold} format={(n) => String(Math.round(n))} tv />
                          </div>
                          <div className="text-center text-sm tabular-nums font-bold text-amber-300">
                            <OdometerValue value={a.premiumSold} format={formatPremiumSold} tv />
                          </div>
                          <div className="text-center text-sm tabular-nums font-bold text-emerald-400">
                            <OdometerValue value={a.appointmentsSet} format={(n) => String(Math.round(n))} tv />
                          </div>
                          <div className="text-center text-sm tabular-nums text-slate-400">
                            <OdometerValue value={a.talkTime / 3600} format={(n) => `${n.toFixed(1)}h`} tv />
                          </div>
                          <div className="text-center text-sm tabular-nums font-bold text-orange-400">
                            <OdometerValue value={a.conversionRate} format={(n) => `${n.toFixed(1)}%`} tv />
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

          <div className="col-start-3 row-start-2 flex min-h-0 flex-col">
            <RecentWinsPanel
              wins={wins}
              agents={agents}
              flashingWinId={flashingWinId}
              variant="tv"
            />
          </div>
        </div>
        </LayoutGroup>
      </main>

      {/* Footer Ticker */}
      <footer className="shrink-0 h-12 border-t border-white/5 bg-black/70 backdrop-blur-xl flex items-center overflow-hidden">
        <div className="relative w-full h-full flex items-center overflow-hidden">
          <div className="animate-ticker whitespace-nowrap flex items-center min-w-max">
            {[1, 2, 3, 4].map((group) => (
              <div key={group} className="flex items-center gap-10 px-10">
                <span className="text-blue-400 font-black uppercase tracking-[0.25em] text-xs px-5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 shrink-0">
                  LIVE NEWS FEED
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
