import React from "react";
import { useBranding } from "@/contexts/BrandingContext";
import type { AgentFireStatus } from "@/components/leaderboard/useLeaderboardBadges";
import type { Win } from "@/components/leaderboard/leaderboardTypes";

interface RecentWinsPanelProps {
  wins: Win[];
  fireMap: Map<string, AgentFireStatus>;
  agents: { id: string; first_name: string; last_name: string }[];
  flashingWinId: string | null;
  title?: string;
}

const RecentWinsPanel: React.FC<RecentWinsPanelProps> = ({
  wins,
  fireMap,
  agents,
  flashingWinId,
  title = "🏆 Recent Wins",
}) => {
  const { formatDateTime } = useBranding();

  return (
    <div className="bg-card rounded-xl border p-5">
      <h3 className="font-semibold text-foreground mb-4">{title}</h3>
      {wins.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No wins yet. Get dialing and close some deals! 🦈
        </p>
      ) : (
        <div className="space-y-3">
          {wins.map((w) => {
            const winInitials = (w.agent_name || "??")
              .split(" ")
              .map((c) => c[0])
              .join("")
              .slice(0, 2);
            const agentId = agents.find(
              (a) =>
                `${a.first_name} ${a.last_name?.[0]}.` === w.agent_name ||
                `${a.first_name} ${a.last_name}` === w.agent_name,
            )?.id;
            const fire = agentId ? fireMap.get(agentId) : undefined;

            return (
              <div
                key={w.id}
                className={`flex items-start gap-3 pb-3 border-b last:border-0 rounded-md transition-colors ${
                  flashingWinId === w.id ? "animate-leaderboard-flash" : ""
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-success/10 text-success text-xs font-bold flex items-center justify-center shrink-0">
                  {winInitials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{w.agent_name || "Agent"}</span>
                    {fire && fire.level !== "none" && (
                      <span
                        className={`inline-block ml-1 ${
                          fire.level === "blazing" ? "animate-fire-flicker" : "animate-fire-pulse"
                        }`}
                      >
                        {fire.level === "blazing" ? "🔥🔥" : "🔥"}
                      </span>
                    )}{" "}
                    closed {w.contact_name || "a deal"}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {w.campaign_name && (
                      <span className="text-xs bg-accent text-accent-foreground px-1.5 py-0.5 rounded">
                        {w.campaign_name}
                      </span>
                    )}
                    {w.policy_type && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                        {w.policy_type}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDateTime(new Date(w.created_at))}
                  </p>
                </div>
                <span className="text-lg shrink-0">🎉</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RecentWinsPanel;
