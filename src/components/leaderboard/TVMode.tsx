import React, { useState, useEffect, useCallback, useRef } from "react";
import { Trophy, X, Settings } from "lucide-react";
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
  if (m === "Talk Time") return `${(val / 3600).toFixed(1)} hrs`;
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
  const [showChrome, setShowChrome] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingBanner, setSavingBanner] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const mouseTimer = useRef<ReturnType<typeof setTimeout>>();
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

  const handleMouseMove = useCallback(() => {
    setShowChrome(true);
    if (mouseTimer.current) clearTimeout(mouseTimer.current);
    mouseTimer.current = setTimeout(() => {
      if (!settingsOpenRef.current) setShowChrome(false);
    }, 3000);
  }, []);

  useEffect(() => {
    if (settingsOpen) {
      if (mouseTimer.current) clearTimeout(mouseTimer.current);
      setShowChrome(true);
    }
  }, [settingsOpen]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousemove", handleMouseMove);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousemove", handleMouseMove);
    };
  }, [onExit, handleMouseMove]);

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
    if (rank === 1) return { metal: "Gold", trophyColor: "text-yellow-500", gradient: "from-yellow-500/20 to-yellow-600/5" };
    if (rank === 2) return { metal: "Silver", trophyColor: "text-gray-400", gradient: "from-gray-300/20 to-gray-400/5" };
    return { metal: "Bronze", trophyColor: "text-orange-400", gradient: "from-orange-400/20 to-orange-500/5" };
  };

  const renderFireIcon = (agentId: string) => {
    const fire = fireStatus.get(agentId);
    if (!fire || fire.level === "none") return null;
    return <span className={`inline-block ${fire.level === "blazing" ? "animate-fire-flicker" : "animate-fire-pulse"}`}>{fire.level === "blazing" ? "🔥🔥" : "🔥"}</span>;
  };

  const renderBadgeIcons = (agentId: string, max = 3) => {
    const ab = badges.get(agentId) || [];
    return ab.slice(0, max).map(b => <span key={b.id} className="text-sm">{b.icon}</span>);
  };

  const winsTicker =
    wins.length > 0
      ? wins
          .map(w => `🏆 ${w.agent_name || "Agent"} closed ${w.contact_name || "a deal"}${w.campaign_name ? ` (${w.campaign_name})` : ""}`)
          .join("  ·  ")
      : "🏆 No wins yet — get dialing!";

  const tickerText = customBanner?.trim() ? customBanner.trim() : winsTicker;

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col min-h-0 overflow-hidden" onMouseMove={handleMouseMove}>
      <div
        className={`absolute top-3 left-3 right-3 z-50 flex items-center justify-between gap-2 pointer-events-none transition-opacity duration-300 ${showChrome || settingsOpen ? "opacity-100" : "opacity-0"}`}
      >
        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="pointer-events-auto h-9 w-9 rounded-lg shadow-md bg-card/90 backdrop-blur border border-border"
              aria-label="TV display options"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 sm:w-96 p-4" align="start" sideOffset={8} onCloseAutoFocus={e => e.preventDefault()}>
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Viewing metric</Label>
                <select
                  className="mt-1.5 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={currentMetricIdx}
                  disabled={autoRotate}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    setCurrentMetricIdx(v);
                    try {
                      localStorage.setItem(LS_METRIC, String(v));
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {METRICS.map((m, i) => (
                    <option key={m} value={i}>
                      {m}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">Pick one stat to rank by, or turn on auto-rotate below.</p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/80 bg-muted/30 px-3 py-2">
                <div>
                  <Label htmlFor="tv-auto-rotate" className="text-sm font-medium">
                    Auto-rotate stats
                  </Label>
                  <p className="text-[11px] text-muted-foreground">Cycles metrics every 30s (not a timeline view).</p>
                </div>
                <Switch
                  id="tv-auto-rotate"
                  checked={autoRotate}
                  onCheckedChange={v => {
                    setAutoRotate(v);
                    try {
                      localStorage.setItem(LS_AUTO, v ? "1" : "0");
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              </div>
              {canEditBanner && (
                <div className="border-t border-border pt-3 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scrolling ticker (org-wide)</Label>
                  <Textarea
                    value={bannerDraft}
                    onChange={e => setBannerDraft(e.target.value)}
                    placeholder="Leave empty to show live wins from your team…"
                    rows={3}
                    className="text-sm resize-y min-h-[72px]"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setBannerDraft(customBanner ?? "")} disabled={savingBanner}>
                      Reset
                    </Button>
                    <Button type="button" size="sm" onClick={() => void saveBanner()} disabled={savingBanner || bannerDraft === (customBanner ?? "")}>
                      {savingBanner ? "Saving…" : "Save ticker"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Admins and team leaders only. Empty saves use automatic win feed.</p>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="pointer-events-auto h-9 w-9 rounded-lg shadow-md bg-card/90 backdrop-blur border border-border"
          onClick={onExit}
          aria-label="Exit TV mode"
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      <header className="text-center shrink-0 border-b border-border/40 px-4 py-2.5 pt-14 sm:pt-12">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">{companyName}</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          {format(clock, "EEEE, MMMM d, yyyy")} · {format(clock, "h:mm:ss a")}
        </p>
        <p className={`text-xs font-medium text-primary mt-1 transition-opacity duration-400 ${transitioning ? "opacity-0" : "opacity-100"}`}>
          Ranked by: {metric}
        </p>
      </header>

      <div
        className={`shrink-0 flex items-end justify-center px-4 md:px-6 pt-2 pb-2 max-h-[min(260px,30vh)] min-h-0 transition-opacity duration-400 ${transitioning ? "opacity-0" : "opacity-100"}`}
      >
        <div className="grid grid-cols-3 gap-3 md:gap-5 w-full max-w-4xl items-end">
          {[top3[1], top3[0], top3[2]].filter(Boolean).map((a, idx) => {
            if (!a) return <div key={idx} />;
            const rank = idx === 0 ? 2 : idx === 1 ? 1 : 3;
            const mc = metalConfig(rank);
            const initials = `${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`;
            const val = formatMetricValue(metric, a[key] as number);
            const isMid = rank === 1;
            return (
              <div
                key={a.id}
                className={`bg-gradient-to-b ${mc.gradient} rounded-xl border border-border/40 px-3 py-4 md:px-4 md:py-5 text-center ${isMid ? "md:scale-[1.03] z-[1] shadow-md" : ""}`}
              >
                <div className={`inline-flex items-center justify-center mb-2 ${isMid ? "animate-tv-trophy-shimmer" : ""}`}>
                  <Trophy className={`${isMid ? "w-10 h-10 md:w-11 md:h-11" : "w-8 h-8"} ${mc.trophyColor}`} />
                </div>
                <LeaderboardAgentAvatar
                  avatarUrl={a.avatar_url}
                  initials={initials}
                  alt={`${a.first_name} ${a.last_name}`.trim() || "Agent"}
                  className={`mx-auto mb-2 ${isMid ? "h-16 w-16 md:h-[4.25rem] md:w-[4.25rem]" : "h-12 w-12"}`}
                  fallbackClassName={isMid ? "text-xl" : "text-lg"}
                />
                <h3 className={`font-bold text-foreground ${isMid ? "text-lg md:text-xl" : "text-base md:text-lg"} leading-tight`}>
                  {a.first_name} {a.last_name?.[0]}.
                  {renderFireIcon(a.id)}
                </h3>
                <div className="flex justify-center gap-0.5 mt-0.5 min-h-[1.25rem]">{renderBadgeIcons(a.id)}</div>
                <p className={`font-bold text-foreground mt-2 tabular-nums ${isMid ? "text-3xl md:text-4xl" : "text-2xl md:text-3xl"}`}>{val}</p>
                <p className="text-[11px] md:text-xs text-muted-foreground font-medium uppercase tracking-wide mt-0.5">{metric.toLowerCase()}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`flex-1 min-h-0 overflow-auto px-4 md:px-6 pb-14 transition-opacity duration-400 ${transitioning ? "opacity-0" : "opacity-100"}`}>
        <table className="w-full text-sm md:text-base border-collapse">
          <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border shadow-sm">
            <tr className="text-muted-foreground">
              <th className="text-left py-2.5 px-2 md:px-3 font-medium w-12 md:w-14">Rank</th>
              <th className="text-left py-2.5 font-medium">Agent</th>
              <th className="text-right py-2.5 font-medium whitespace-nowrap">Calls</th>
              <th className="text-right py-2.5 font-medium whitespace-nowrap">Policies</th>
              <th
                className="text-right py-2.5 font-medium whitespace-nowrap hidden sm:table-cell"
                title="Policies closed (wins) in the last 7 days"
              >
                Recent wins
              </th>
              <th className="text-right py-2.5 font-medium whitespace-nowrap">Appts</th>
              <th className="text-right py-2.5 font-medium whitespace-nowrap hidden md:table-cell">Talk</th>
              <th className="text-right py-2.5 pr-2 md:pr-3 font-medium whitespace-nowrap hidden lg:table-cell">Conv %</th>
            </tr>
          </thead>
          <tbody>
            {rest.map((a, i) => {
              const initials = `${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`;
              return (
                <tr key={a.id} className="border-b border-border/50 last:border-0">
                  <td className="py-2.5 px-2 md:px-3 font-bold text-foreground">{i + 4}</td>
                  <td className="py-2.5 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <LeaderboardAgentAvatar
                        avatarUrl={a.avatar_url}
                        initials={initials}
                        alt={`${a.first_name} ${a.last_name}`.trim() || "Agent"}
                        className="h-8 w-8 shrink-0"
                        fallbackClassName="text-xs"
                      />
                      <span className="font-medium text-foreground truncate">
                        {a.first_name} {a.last_name?.[0]}.
                        {renderFireIcon(a.id)}
                      </span>
                      <span className="flex gap-0.5 shrink-0">{renderBadgeIcons(a.id, 2)}</span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right text-foreground tabular-nums">{a.callsMade}</td>
                  <td className="py-2.5 text-right text-foreground font-medium tabular-nums">{a.policiesSold}</td>
                  <td className="py-2.5 text-right text-foreground tabular-nums hidden sm:table-cell">{a.recentWins7d}</td>
                  <td className="py-2.5 text-right text-foreground tabular-nums">{a.appointmentsSet}</td>
                  <td className="py-2.5 text-right text-foreground tabular-nums hidden md:table-cell">{(a.talkTime / 3600).toFixed(1)}h</td>
                  <td className="py-2.5 text-right text-foreground tabular-nums hidden lg:table-cell pr-2 md:pr-3">{a.conversionRate.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 h-11 border-t border-border/40 bg-card/95 backdrop-blur flex items-center overflow-hidden">
        <div className="animate-ticker whitespace-nowrap text-sm text-foreground px-2">
          <span className="inline-block">
            {tickerText} &nbsp;·&nbsp; {tickerText}
          </span>
        </div>
      </div>
    </div>
  );
};

export default TVMode;
