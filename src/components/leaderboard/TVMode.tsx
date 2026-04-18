import React, { useState, useEffect, useCallback, useRef } from "react";
import { Trophy, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import LeaderboardAgentAvatar from "./LeaderboardAgentAvatar";
import { Badge as BadgeType, AgentFireStatus } from "./useLeaderboardBadges";
import { format } from "date-fns";

type Metric = "Policies Sold" | "Calls Made" | "Appointments Set" | "Talk Time";
const METRICS: Metric[] = ["Policies Sold", "Calls Made", "Appointments Set", "Talk Time"];

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
  return String(val);
};

const metricKey = (m: Metric): keyof AgentStats => {
  switch (m) {
    case "Policies Sold": return "policiesSold";
    case "Calls Made": return "callsMade";
    case "Appointments Set": return "appointmentsSet";
    case "Talk Time": return "talkTime";
  }
};

const TVMode: React.FC<Props> = ({ agents, wins, badges, fireStatus, onExit }) => {
  const [currentMetricIdx, setCurrentMetricIdx] = useState(0);
  const [clock, setClock] = useState(new Date());
  const [companyName, setCompanyName] = useState("AgentFlow");
  const [showExit, setShowExit] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const mouseTimer = useRef<ReturnType<typeof setTimeout>>();

  const metric = METRICS[currentMetricIdx];
  const key = metricKey(metric);

  // Sort agents by current metric
  const sorted = [...agents].sort((a, b) => (b[key] as number) - (a[key] as number));
  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  // Clock
  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Auto-cycle metrics every 30s
  useEffect(() => {
    const iv = setInterval(() => {
      setTransitioning(true);
      setTimeout(() => {
        setCurrentMetricIdx(i => (i + 1) % METRICS.length);
        setTransitioning(false);
      }, 400);
    }, 30000);
    return () => clearInterval(iv);
  }, []);

  // Fetch company name
  useEffect(() => {
    supabase.from("company_settings").select("company_name").limit(1).single().then(({ data }) => {
      if (data?.company_name) setCompanyName(data.company_name);
    });
  }, []);

  // Mouse movement shows exit button
  const handleMouseMove = useCallback(() => {
    setShowExit(true);
    if (mouseTimer.current) clearTimeout(mouseTimer.current);
    mouseTimer.current = setTimeout(() => setShowExit(false), 3000);
  }, []);

  // Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onExit(); };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousemove", handleMouseMove);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousemove", handleMouseMove);
    };
  }, [onExit, handleMouseMove]);

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

  // Win ticker text
  const tickerText = wins.length > 0
    ? wins.map(w => `🏆 ${w.agent_name || "Agent"} closed ${w.contact_name || "a deal"}${w.campaign_name ? ` (${w.campaign_name})` : ""}`).join("  ·  ")
    : "🏆 No wins yet — get dialing!";

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col overflow-hidden" onMouseMove={handleMouseMove}>
      {/* Exit button */}
      <button
        onClick={onExit}
        className={`absolute top-4 right-4 z-50 p-2 rounded-lg bg-card/80 backdrop-blur text-foreground hover:bg-card transition-opacity duration-500 ${showExit ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <X className="w-5 h-5" />
      </button>

      {/* Header */}
      <div className="text-center py-4 border-b border-border/30 shrink-0">
        <h1 className="text-2xl font-bold text-foreground">{companyName}</h1>
        <p className="text-sm text-muted-foreground">
          {format(clock, "EEEE, MMMM d, yyyy")} · {format(clock, "h:mm:ss a")}
        </p>
        <p className={`text-xs font-medium text-primary mt-1 transition-opacity duration-400 ${transitioning ? "opacity-0" : "opacity-100"}`}>
          Ranked by: {metric}
        </p>
      </div>

      {/* Podium - top 40% */}
      <div className={`flex-1 flex items-center justify-center px-8 transition-opacity duration-400 ${transitioning ? "opacity-0" : "opacity-100"}`} style={{ maxHeight: "42%" }}>
        <div className="grid grid-cols-3 gap-8 w-full max-w-5xl items-end">
          {[top3[1], top3[0], top3[2]].filter(Boolean).map((a, idx) => {
            if (!a) return <div key={idx} />;
            const rank = idx === 0 ? 2 : idx === 1 ? 1 : 3;
            const mc = metalConfig(rank);
            const initials = `${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`;
            const val = formatMetricValue(metric, a[key] as number);
            return (
              <div key={a.id} className={`bg-gradient-to-b ${mc.gradient} rounded-2xl border border-border/30 p-8 text-center ${rank === 1 ? "pb-12 -mb-4" : ""}`}>
                <div className={`inline-flex items-center justify-center mb-3 ${rank === 1 ? "animate-tv-trophy-shimmer" : ""}`}>
                  <Trophy className={`${rank === 1 ? "w-14 h-14" : "w-10 h-10"} ${mc.trophyColor}`} />
                </div>
                <LeaderboardAgentAvatar
                  avatarUrl={a.avatar_url}
                  initials={initials}
                  alt={`${a.first_name} ${a.last_name}`.trim() || "Agent"}
                  className={`mx-auto mb-3 ${rank === 1 ? "h-24 w-24" : "h-16 w-16"}`}
                  fallbackClassName={rank === 1 ? "text-3xl" : "text-2xl"}
                />
                <h3 className={`font-bold text-foreground ${rank === 1 ? "text-2xl" : "text-xl"}`}>
                  {a.first_name} {a.last_name?.[0]}.
                  {renderFireIcon(a.id)}
                </h3>
                <div className="flex justify-center gap-1 mt-1">{renderBadgeIcons(a.id)}</div>
                <p className={`font-bold text-foreground mt-3 ${rank === 1 ? "text-5xl" : "text-3xl"}`}>{val}</p>
                <p className="text-sm text-muted-foreground mt-1">{metric.toLowerCase()}</p>
                <p className="text-xs text-muted-foreground mt-2">{a.callsMade} calls · {a.appointmentsSet} appts</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rankings - remaining space */}
      <div className={`flex-1 overflow-auto px-8 pb-16 transition-opacity duration-400 ${transitioning ? "opacity-0" : "opacity-100"}`}>
        <table className="w-full text-base">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th className="text-left py-3 px-4 font-medium w-16">Rank</th>
              <th className="text-left py-3 font-medium">Agent</th>
              <th className="text-right py-3 font-medium">Calls</th>
              <th className="text-right py-3 font-medium">Policies</th>
              <th className="text-right py-3 font-medium">Appts</th>
              <th className="text-right py-3 font-medium">Talk Time</th>
            </tr>
          </thead>
          <tbody>
            {rest.map((a, i) => {
              const initials = `${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`;
              return (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="py-4 px-4 font-bold text-foreground text-lg">{i + 4}</td>
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <LeaderboardAgentAvatar
                        avatarUrl={a.avatar_url}
                        initials={initials}
                        alt={`${a.first_name} ${a.last_name}`.trim() || "Agent"}
                        className="h-9 w-9"
                        fallbackClassName="text-sm"
                      />
                      <span className="font-medium text-foreground text-lg">
                        {a.first_name} {a.last_name?.[0]}.
                        {renderFireIcon(a.id)}
                      </span>
                      <span className="flex gap-1">{renderBadgeIcons(a.id, 2)}</span>
                    </div>
                  </td>
                  <td className="py-4 text-right text-foreground text-lg">{a.callsMade}</td>
                  <td className="py-4 text-right text-foreground text-lg font-medium">{a.policiesSold}</td>
                  <td className="py-4 text-right text-foreground text-lg">{a.appointmentsSet}</td>
                  <td className="py-4 text-right text-foreground text-lg">{(a.talkTime / 3600).toFixed(1)} hrs</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Win ticker */}
      <div className="absolute bottom-0 left-0 right-0 bg-card/90 backdrop-blur border-t border-border/30 py-2 overflow-hidden">
        <div className="animate-ticker whitespace-nowrap text-sm text-foreground">
          <span className="inline-block">{tickerText}  ·  {tickerText}</span>
        </div>
      </div>
    </div>
  );
};

export default TVMode;
