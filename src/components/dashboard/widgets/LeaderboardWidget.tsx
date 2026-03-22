import React, { useState, useEffect } from "react";
import { Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

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

const RANK_STYLES: Record<number, { border: string; emoji: string }> = {
  1: { border: "#FACC15", emoji: "🥇" },
  2: { border: "#D1D5DB", emoji: "🥈" },
  3: { border: "#B45309", emoji: "🥉" },
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
            .in("role", ["Agent", "Team Leader"]),
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
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-muted rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (ranked.length === 0) {
    return (
      <div className="text-center py-6">
        <Trophy className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No sales data yet this month</p>
      </div>
    );
  }

  const top3 = ranked.slice(0, 3);
  const currentUserRank = ranked.findIndex((p) => p.id === userId) + 1;
  const currentUserData = ranked.find((p) => p.id === userId);

  return (
    <div>
      {/* Trophy cards */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {top3.map((agent, idx) => {
          const rank = idx + 1;
          const style = RANK_STYLES[rank];
          return (
            <div
              key={agent.id}
              className="rounded-lg p-3 text-center"
              style={{ border: `2px solid ${style.border}` }}
            >
              <span className="text-2xl">{style.emoji}</span>
              <p className="text-sm font-medium text-foreground mt-1 truncate">
                {agent.firstName} {agent.lastName.charAt(0)}.
              </p>
              <p className="text-xs text-muted-foreground">
                {agent.wins} {agent.wins === 1 ? "policy" : "policies"}
              </p>
            </div>
          );
        })}
      </div>

      {/* Divider */}
      <div className="border-t border-border my-3" />

      {/* Current user rank */}
      {currentUserData && (
        <div>
          {currentUserRank <= 3 ? (
            <p className="text-sm text-center text-foreground font-medium">
              You're on the podium! 🎉
            </p>
          ) : (
            <div className="bg-primary/10 border border-primary rounded-lg px-3 py-2 text-sm text-foreground">
              You — Rank #{currentUserRank} — {currentUserData.wins}{" "}
              {currentUserData.wins === 1 ? "policy" : "policies"} this month
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => navigate("/leaderboard")}
        className="text-sm text-primary hover:underline mt-3 block"
      >
        View Full Leaderboard →
      </button>
    </div>
  );
};

export default LeaderboardWidget;
