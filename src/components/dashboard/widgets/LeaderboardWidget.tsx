import React, { useState, useEffect } from "react";
import { Trophy, Medal, Star, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useAgencyGroup } from "@/hooks/useAgencyGroup";

interface LeaderboardWidgetProps {
  userId: string;
}

interface RankedAgent {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  wins: number;
  organizationName?: string | null;
}

const RANK_STYLES: Record<number, { gradient: string; icon: any; shadow: string }> = {
  1: { gradient: "premium-gradient-amber", icon: Trophy, shadow: "shadow-amber-500/20" },
  2: { gradient: "bg-slate-300", icon: Medal, shadow: "shadow-slate-500/10" },
  3: { gradient: "bg-amber-700", icon: Medal, shadow: "shadow-amber-900/10" },
};

const LeaderboardWidget: React.FC<LeaderboardWidgetProps> = ({ userId }) => {
  const navigate = useNavigate();
  const { agencyGroup } = useAgencyGroup();
  const [widgetView, setWidgetView] = useState<"org" | "group">("org");
  const [ranked, setRanked] = useState<RankedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Org standings come from the canonical aggregate RPC — the same metric
    // definitions as the Leaderboard page. Never rebuilt from raw tables:
    // Agent RLS hides other agents' rows, and clients-created is not "wins".
    const fetchOrgLeaderboard = async (): Promise<RankedAgent[] | null> => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const { data, error } = await supabase.rpc("get_org_leaderboard_stats", {
        p_start: startOfMonth.toISOString(),
        p_end: now.toISOString(),
      });
      if (error || !data) {
        console.error("[LeaderboardWidget] get_org_leaderboard_stats failed:", error);
        return null;
      }
      return data
        .map((r) => ({
          id: r.agent_id,
          firstName: r.first_name,
          lastName: r.last_name,
          avatarUrl: r.avatar_url || null,
          wins: Number(r.policies_sold) || 0,
        }))
        .sort((a, b) => {
          const diff = b.wins - a.wins;
          if (diff !== 0) return diff;
          const nameA = `${a.lastName} ${a.firstName}`.toLowerCase();
          const nameB = `${b.lastName} ${b.firstName}`.toLowerCase();
          if (nameA !== nameB) return nameA.localeCompare(nameB);
          return a.id.localeCompare(b.id);
        });
    };

    const fetchGroupLeaderboard = async (groupId: string): Promise<RankedAgent[] | null> => {
      const { data, error } = await supabase.rpc("get_agency_group_leaderboard", {
        p_group_id: groupId,
        p_period: "month",
      });
      if (error || !data) return null;
      return (data as any[])
        .map((r) => ({
          id: r.agent_id,
          firstName: r.agent_first_name,
          lastName: r.agent_last_name,
          avatarUrl: r.agent_avatar_url,
          wins: Number(r.policies_sold) || 0,
          organizationName: r.organization_name,
        }))
        .sort((a, b) => {
          const diff = b.wins - a.wins;
          if (diff !== 0) return diff;
          const nameA = `${a.lastName} ${a.firstName}`.toLowerCase();
          const nameB = `${b.lastName} ${b.firstName}`.toLowerCase();
          if (nameA !== nameB) return nameA.localeCompare(nameB);
          return a.id.localeCompare(b.id);
        });
    };

    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        if (widgetView === "group" && agencyGroup) {
          const groupRanked = await fetchGroupLeaderboard(agencyGroup.groupId);
          if (cancelled) return;
          if (groupRanked) {
            setRanked(groupRanked);
            return;
          }
          setWidgetView("org");
        }
        const orgRanked = await fetchOrgLeaderboard();
        if (cancelled) return;
        if (orgRanked) {
          setRanked(orgRanked);
        } else {
          // A failed load is an error, never a fake empty/zero board; any
          // previously loaded snapshot is kept behind the error notice.
          setLoadError(true);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, widgetView, agencyGroup, reloadNonce]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-muted/20 rounded-2xl animate-pulse" />
          ))}
        </div>
        <div className="h-12 bg-muted/20 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (loadError && ranked.length === 0) {
    return (
      <div className="text-center py-10 flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
          <AlertTriangle className="w-8 h-8 text-muted-foreground opacity-50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium mb-3">Couldn't load standings</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setReloadNonce((n) => n + 1)}
          className="text-xs"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (ranked.length === 0) {
    return (
      <div className="text-center py-10 flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
          <Trophy className="w-8 h-8 text-muted-foreground opacity-50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">No sales data yet</p>
      </div>
    );
  }

  const top3 = ranked.slice(0, 3);
  const currentUserRank = ranked.findIndex((p) => p.id === userId) + 1;
  const currentUserData = ranked.find((p) => p.id === userId);

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
          <AlertTriangle className="w-3 h-3" />
          <span>Refresh failed — standings may be out of date.</span>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="underline font-semibold"
          >
            Retry
          </button>
        </div>
      )}
      {agencyGroup && (
        <div className="flex bg-accent/40 rounded-lg p-0.5 w-fit mx-auto text-[10px]">
          <button
            onClick={() => setWidgetView("org")}
            className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${widgetView === "org" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            My Agency
          </button>
          <button
            onClick={() => setWidgetView("group")}
            className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${widgetView === "group" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            Group
          </button>
        </div>
      )}
      {/* Trophy podium */}
      <div className="grid grid-cols-3 gap-3 items-end">
        {top3.map((agent, idx) => {
          const rank = idx + 1;
          const style = RANK_STYLES[rank];
          const isWinner = rank === 1;
          
          return (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.1 }}
              className={`relative flex flex-col items-center p-3 rounded-2xl glass-card border border-white/5 ${style.shadow} ${isWinner ? "pb-6 -mb-2 z-10 scale-110" : "opacity-80 scale-95"}`}
            >
              <div className={`w-10 h-10 rounded-full ${style.gradient} flex items-center justify-center mb-2 shadow-lg`}>
                <style.icon className="w-5 h-5 text-white" />
              </div>
              <p className="text-[10px] font-bold text-foreground text-center truncate w-full px-1">
                {agent.firstName}
              </p>
              {widgetView === "group" && agent.organizationName && (
                <p className="text-[8px] text-muted-foreground text-center truncate w-full px-1">{agent.organizationName}</p>
              )}
              <div className="mt-1 flex items-center gap-1">
                <span className="text-xs font-bold text-primary">{agent.wins}</span>
                <span className="text-[8px] text-muted-foreground uppercase font-bold tracking-tighter">pts</span>
              </div>
              
              {isWinner && (
                <div className="absolute -top-1 -right-1">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500 animate-pulse" />
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Current user rank bar */}
      {currentUserData && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between p-4 rounded-xl bg-primary/5 border border-primary/10"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-xs text-primary">
              #{currentUserRank}
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">Your Standing</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
                {currentUserRank <= 3 ? "On the podium!" : "Keep pushing!"}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-primary">{currentUserData.wins} Wins</p>
          </div>
        </motion.div>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/leaderboard")}
        className="w-full text-primary hover:text-primary/80 hover:bg-primary/5 rounded-xl text-xs font-bold uppercase tracking-widest"
      >
        View Full Standings
      </Button>
    </div>
  );
};

export default LeaderboardWidget;
