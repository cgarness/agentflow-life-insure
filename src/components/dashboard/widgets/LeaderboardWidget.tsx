import React, { useState, useEffect } from "react";
import { Trophy, Medal, Star, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";

interface LeaderboardWidgetProps {
  userId: string;
}

interface RankedAgent {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  wins: number;
}

const RANK_STYLES: Record<number, { gradient: string; icon: any; shadow: string }> = {
  1: { gradient: "premium-gradient-amber", icon: Trophy, shadow: "shadow-amber-500/20" },
  2: { gradient: "bg-slate-300", icon: Medal, shadow: "shadow-slate-500/10" },
  3: { gradient: "bg-amber-700", icon: Medal, shadow: "shadow-amber-900/10" },
};

const LeaderboardWidget: React.FC<LeaderboardWidgetProps> = ({ userId }) => {
  const navigate = useNavigate();
  const [ranked, setRanked] = useState<RankedAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const [profilesRes, winsRes] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, first_name, last_name, avatar_url")
            .in("role", ["Agent", "Team Leader"])
            .neq("status", "Deleted"),
          supabase.from("wins").select("agent_id").gte("created_at", startOfMonth),
        ]);

        const profiles = profilesRes.data ?? [];
        const wins = winsRes.data ?? [];

        const winCounts = wins.reduce(
          (acc, w) => {
            if (w.agent_id) {
              acc[w.agent_id] = (acc[w.agent_id] ?? 0) + 1;
            }
            return acc;
          },
          {} as Record<string, number>
        );

        const rankedList = profiles
          .map((p) => ({
            id: p.id,
            firstName: p.first_name,
            lastName: p.last_name,
            avatarUrl: p.avatar_url,
            wins: winCounts[p.id] ?? 0,
          }))
          .sort((a, b) => b.wins - a.wins);

        setRanked(rankedList);
      } catch {
        setRanked([]);
      } finally {
        setLoading(false);
      }
    };
    fetchLeaderboard();
  }, [userId]);

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
