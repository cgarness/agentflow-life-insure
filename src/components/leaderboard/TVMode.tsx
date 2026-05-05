import React, { useState, useEffect, useRef } from "react";
import { Trophy, X, Settings, TrendingUp, Clock, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import LeaderboardAgentAvatar from "./LeaderboardAgentAvatar";
import { Badge as BadgeType, AgentFireStatus } from "./useLeaderboardBadges";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

type Metric = "Policies Sold" | "Calls Made" | "Appointments Set" | "Talk Time" | "Conversion Rate";
const METRICS: Metric[] = ["Policies Sold", "Calls Made", "Appointments Set", "Talk Time", "Conversion Rate"];

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

interface AgentStats {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url?: string | null;
  callsMade: number;
  policiesSold: number;
  appointmentsSet: number;
  talkTime: number;
  conversionRate: number;
  recentWins7d: number;
  rank: number;
}

interface Win {
  id: string;
  agent_name: string;
  contact_name: string;
  campaign_name: string;
  created_at: string;
}

interface Props {
  agents: AgentStats[];
  wins: Win[];
  badges: Map<string, BadgeType[]>;
  fireStatus: Map<string, AgentFireStatus>;
  onExit: () => void;
}

const formatMetricValue = (m: Metric, val: number): string => {
  if (m === "Talk Time") return `${(val / 3600).toFixed(1)}h`;
  if (m === "Conversion Rate") return `${val.toFixed(1)}%`;
  return String(val);
};

const metricKey = (m: Metric): keyof AgentStats => {
  switch (m) {
    case "Policies Sold": return "policiesSold";
    case "Calls Made": return "callsMade";
    case "Appointments Set": return "appointmentsSet";
    case "Talk Time": return "talkTime";
    case "Conversion Rate": return "conversionRate";
  }
};

const TVMode: React.FC<Props> = ({ agents, wins, badges, fireStatus, onExit }) => {
  const [currentMetricIdx, setCurrentMetricIdx] = useState(() => readTvPrefs().metricIdx);
  const [autoRotate, setAutoRotate] = useState(() => readTvPrefs().autoRotate);
  const [clock, setClock] = useState(new Date());
  const [companyName, setCompanyName] = useState("AgentFlow");
  const [settingsRowId, setSettingsRowId] = useState<string | null>(null);
  const [customBanner, setCustomBanner] = useState<string | null>(null);
  const [bannerDraft, setBannerDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingBanner, setSavingBanner] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const settingsOpenRef = useRef(false);

  const { profile } = useAuth();
  const { organizationId } = useOrganization();

  const canEditBanner =
    profile?.role?.toLowerCase() === "admin" ||
    profile?.role?.toLowerCase() === "team leader" ||
    profile?.role === "Team Lead";

  settingsOpenRef.current = settingsOpen;

  const metric = METRICS[currentMetricIdx];
  const key = metricKey(metric);

  const sorted = [...agents].sort((a, b) => (b[key] as number) - (a[key] as number));
  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!autoRotate) return;
    const iv = setInterval(() => {
      setTransitioning(true);
      setTimeout(() => {
        setCurrentMetricIdx(i => {
          const next = (i + 1) % METRICS.length;
          try {
            localStorage.setItem(LS_METRIC, String(next));
          } catch {
            /* ignore */
          }
          return next;
        });
        setTransitioning(false);
      }, 400);
    }, 30000);
    return () => clearInterval(iv);
  }, [autoRotate]);

  useEffect(() => {
    if (!organizationId) return;
    void supabase
      .from("company_settings")
      .select("id, company_name, leaderboard_tv_banner_text")
      .eq("organization_id", organizationId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return;
        if (data?.company_name) setCompanyName(data.company_name);
        if (data?.id) setSettingsRowId(data.id);
        const b = data?.leaderboard_tv_banner_text ?? null;
        setCustomBanner(b?.trim() ? b : null);
        setBannerDraft(b ?? "");
      });
  }, [organizationId]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (settingsOpenRef.current) {
        setSettingsOpen(false);
        return;
      }
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
    if (error) {
      toast.error(error.message || "Save failed");
      return;
    }
    setCustomBanner(trimmed || null);
    toast.success(trimmed ? "Ticker message updated" : "Ticker reset to live wins");
  };

  const metalConfig = (rank: number) => {
    if (rank === 1) return {
      metal: "Gold",
      trophyColor: "text-yellow-400",
      gradient: "from-yellow-500/20 to-yellow-600/5",
      glow: "shadow-[0_0_50px_-12px_rgba(234,179,8,0.3)]",
      border: "border-yellow-500/30"
    };
    if (rank === 2) return {
      metal: "Silver",
      trophyColor: "text-slate-300",
      gradient: "from-slate-400/10 to-slate-500/5",
      glow: "shadow-[0_0_40px_-12px_rgba(148,163,184,0.2)]",
      border: "border-slate-400/20"
    };
    return {
      metal: "Bronze",
      trophyColor: "text-orange-400",
      gradient: "from-orange-500/10 to-orange-600/5",
      glow: "shadow-[0_0_30px_-12px_rgba(251,146,60,0.2)]",
      border: "border-orange-500/20"
    };
  };

  const renderFireIcon = (agentId: string) => {
    const fire = fireStatus.get(agentId);
    if (!fire || fire.level === "none") return null;
    return <span className={`inline-block ml-1 ${fire.level === "blazing" ? "animate-fire-flicker" : "animate-fire-pulse"}`}>{fire.level === "blazing" ? "🔥🔥" : "🔥"}</span>;
  };

  const renderBadgeIcons = (agentId: string, max = 3) => {
    const ab = badges.get(agentId) || [];
    return ab.slice(0, max).map(b => <span key={b.id} className="text-sm drop-shadow-sm">{b.icon}</span>);
  };

  const winsTicker =
    wins.length > 0
      ? wins
          .map(w => `🏆 ${w.agent_name || "Agent"} closed ${w.contact_name || "a deal"}${w.campaign_name ? ` (${w.campaign_name})` : ""}`)
          .join("  ·  ")
      : "🏆 No wins yet — get dialing!";

  const tickerText = customBanner?.trim() ? customBanner.trim() : winsTicker;

  return (
    <div className="fixed inset-0 z-[9999] bg-[#020617] text-slate-50 flex flex-col min-h-0 overflow-hidden font-sans">
      {/* Background Effect */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-20"
           style={{ background: "radial-gradient(circle at 50% 50%, #1e293b 0%, transparent 70%)" }} />
      <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.03] animate-reputation-grid"
           style={{ backgroundImage: "linear-gradient(to right, #64748b 1px, transparent 1px), linear-gradient(to bottom, #64748b 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

      {/* Toolbar */}
      <div className="shrink-0 relative z-[10001] flex h-14 items-center justify-between gap-3 border-b border-white/5 bg-black/40 px-6 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <Popover modal={false} open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 transition-all shadow-sm"
                aria-label="TV display options"
              >
                <Settings className="w-4 h-4" />
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
                      try {
                        localStorage.setItem(LS_METRIC, String(v));
                      } catch { /* ignore */ }
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
                      try {
                        localStorage.setItem(LS_AUTO, v ? "1" : "0");
                      } catch { /* ignore */ }
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
          <div className="hidden sm:flex items-center gap-4 text-slate-400 text-xs font-medium uppercase tracking-widest">
            <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-blue-400" /> {format(clock, "h:mm:ss a")}</div>
            <div className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-emerald-400" /> Live Feed</div>
          </div>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none">
           <h1 className="text-lg font-black tracking-tighter uppercase text-white drop-shadow-md">{companyName}</h1>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-lg border border-white/10 bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-slate-300 transition-all"
          onClick={onExit}
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Main Layout */}
      <main className="relative z-10 flex-1 flex flex-col min-h-0 px-6 py-6 gap-8 overflow-hidden">
        {/* Metric Header */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold uppercase tracking-widest mb-2 shadow-lg shadow-blue-900/20">
            <TrendingUp className="w-4 h-4" />
            Live Ranking: {metric}
          </div>
          <h2 className="text-4xl font-black text-white tracking-tight drop-shadow-2xl">
            TOP PERFORMERS
          </h2>
        </div>

        {/* Podium Area */}
        <div className="shrink-0 flex items-end justify-center w-full max-w-6xl mx-auto min-h-[340px] gap-4 md:gap-8">
           <AnimatePresence mode="popLayout">
            {[top3[1], top3[0], top3[2]].map((a, podiumIdx) => {
              if (!a) return <div key={`empty-${podiumIdx}`} className="flex-1" />;
              const rank = podiumIdx === 0 ? 2 : podiumIdx === 1 ? 1 : 3;
              const mc = metalConfig(rank);
              const isFirst = rank === 1;
              const val = formatMetricValue(metric, a[key] as number);

              return (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: 50, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  className={`relative flex-1 flex flex-col items-center group max-w-[320px]`}
                >
                  {/* Glow Background */}
                  <div className={`absolute -inset-4 z-0 rounded-[2rem] opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-2xl ${isFirst ? "bg-yellow-500/10" : "bg-white/5"}`} />

                  {/* Trophy & Rank Indicator */}
                  <div className={`relative z-10 mb-6 flex flex-col items-center ${isFirst ? "animate-floating" : ""}`}>
                    <div className={`p-4 rounded-full bg-white/5 border-2 ${mc.border} ${mc.glow} backdrop-blur-sm shadow-inner mb-[-1.5rem] relative z-20`}>
                      <Trophy className={`${isFirst ? "w-12 h-12" : "w-8 h-8"} ${mc.trophyColor} drop-shadow-lg`} />
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className={`w-full relative z-10 rounded-2xl border ${mc.border} bg-white/[0.03] backdrop-blur-xl p-6 text-center shadow-2xl overflow-hidden transition-all duration-300 group-hover:bg-white/[0.05] group-hover:scale-[1.02] ${isFirst ? "ring-2 ring-yellow-500/20" : ""}`}>
                    {/* Animated Shine Effect */}
                    <div className="absolute inset-0 pointer-events-none bg-gradient-to-tr from-white/0 via-white/[0.05] to-white/0 -translate-x-[100%] animate-shimmer" />

                    <div className="relative z-20">
                      <LeaderboardAgentAvatar
                        avatarUrl={a.avatar_url}
                        initials={`${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`}
                        alt={`${a.first_name} ${a.last_name}`}
                        className={`mx-auto mb-4 border-2 ${mc.border} shadow-xl ${isFirst ? "h-24 w-24" : "h-20 w-20"}`}
                        fallbackClassName={isFirst ? "text-3xl bg-blue-600/20" : "text-2xl"}
                      />

                      <h3 className={`font-black text-white leading-none tracking-tight truncate px-2 ${isFirst ? "text-2xl" : "text-xl"}`}>
                        {a.first_name} {a.last_name?.[0]}.
                        {renderFireIcon(a.id)}
                      </h3>

                      <div className="flex justify-center gap-1.5 mt-3 min-h-[1.5rem]">
                        {renderBadgeIcons(a.id, 4)}
                      </div>

                      <div className="mt-6 flex flex-col items-center">
                        <span className={`font-black tabular-nums text-white drop-shadow-lg leading-none ${isFirst ? "text-5xl" : "text-4xl"}`}>
                          {val}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mt-2">
                          {metric}
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Rank Badge */}
                   <div className={`absolute -bottom-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest shadow-xl border z-30 ${
                     rank === 1 ? "bg-yellow-500 border-yellow-400 text-black" :
                     rank === 2 ? "bg-slate-400 border-slate-300 text-black" :
                     "bg-orange-600 border-orange-500 text-white"
                   }`}>
                     #{rank}
                   </div>
                </motion.div>
              );
            })}
           </AnimatePresence>
        </div>

        {/* Table Area */}
        <div className="flex-1 min-h-0 overflow-hidden mt-4">
           <div className="mx-auto max-w-6xl h-full flex flex-col rounded-3xl border border-white/10 bg-white/[0.02] backdrop-blur-md shadow-2xl overflow-hidden">
             <div className="shrink-0 flex items-center justify-between px-8 py-5 border-b border-white/5 bg-white/5">
               <h3 className="text-lg font-bold text-white flex items-center gap-2">
                 <Activity className="w-5 h-5 text-blue-400" />
                 Full Leaderboard
               </h3>
               <div className="text-slate-400 text-sm font-medium">
                 Showing positions 4-{agents.length}
               </div>
             </div>

             <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
               <table className="w-full text-left border-collapse">
                 <thead className="sticky top-0 z-20 bg-[#0c1325] text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                   <tr className="border-b border-white/5">
                     <th className="py-4 pl-8 pr-4 w-20">Rank</th>
                     <th className="py-4 px-4">Agent</th>
                     <th className="py-4 px-4 text-right">Calls</th>
                     <th className="py-4 px-4 text-right">Policies</th>
                     <th className="py-4 px-4 text-right">Appts</th>
                     <th className="py-4 px-4 text-right">Talk Time</th>
                     <th className="py-4 px-4 text-right">Conv %</th>
                     <th className="py-4 pr-8 pl-4 text-right">7D Wins</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-white/[0.05]">
                   <AnimatePresence mode="popLayout">
                    {rest.map((a, i) => {
                      const rank = i + 4;
                      return (
                        <motion.tr
                          key={a.id}
                          layout
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                          className="group hover:bg-white/[0.05] transition-colors"
                        >
                          <td className="py-4 pl-8 pr-4 font-black text-slate-400 group-hover:text-white transition-colors">{rank}</td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-3">
                              <LeaderboardAgentAvatar
                                avatarUrl={a.avatar_url}
                                initials={`${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`}
                                alt={`${a.first_name} ${a.last_name}`}
                                className="h-10 w-10 border border-white/10"
                                fallbackClassName="text-sm bg-blue-500/10 text-blue-400"
                              />
                              <div className="flex flex-col">
                                <span className="font-bold text-white text-lg">
                                  {a.first_name} {a.last_name?.[0]}.
                                  {renderFireIcon(a.id)}
                                </span>
                                <div className="flex gap-1 items-center mt-0.5">
                                  {renderBadgeIcons(a.id, 3)}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-right tabular-nums text-slate-300 font-medium">{a.callsMade}</td>
                          <td className="py-4 px-4 text-right tabular-nums text-blue-400 font-bold">{a.policiesSold}</td>
                          <td className="py-4 px-4 text-right tabular-nums text-emerald-400 font-bold">{a.appointmentsSet}</td>
                          <td className="py-4 px-4 text-right tabular-nums text-slate-400">{(a.talkTime / 3600).toFixed(1)}h</td>
                          <td className="py-4 px-4 text-right tabular-nums text-orange-400 font-bold">{a.conversionRate.toFixed(1)}%</td>
                          <td className="py-4 pr-8 pl-4 text-right">
                             <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs font-black border border-blue-500/20">
                               {a.recentWins7d}
                             </span>
                          </td>
                        </motion.tr>
                      );
                    })}
                   </AnimatePresence>
                   {rest.length === 0 && (
                     <tr>
                       <td colSpan={8} className="py-20 text-center text-slate-500 font-medium tracking-wide">
                         ALL AGENTS COMPETING ON THE PODIUM
                       </td>
                     </tr>
                   )}
                 </tbody>
               </table>
             </div>
           </div>
        </div>
      </main>

      {/* Footer Ticker */}
      <footer className="shrink-0 h-14 border-t border-white/5 bg-black/60 backdrop-blur-xl flex items-center overflow-hidden">
        <div className="relative w-full h-full flex items-center overflow-hidden group">
          <div className="animate-ticker whitespace-nowrap px-4 flex items-center gap-12">
            {[1, 2].map((group) => (
              <div key={group} className="flex items-center gap-12">
                <span className="text-blue-400 font-black uppercase tracking-[0.3em] text-xs px-6 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 shrink-0">
                  LIVE NEWS FEED
                </span>
                <span className="text-sm font-bold text-slate-200 tracking-wide uppercase">
                  {tickerText}
                </span>
                <span className="text-blue-500 opacity-30">•</span>
                <span className="text-sm font-bold text-slate-400 tracking-wide uppercase">
                  {format(new Date(), "EEEE HH:mm")}
                </span>
                <span className="text-blue-500 opacity-30">•</span>
              </div>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
};

export default TVMode;
