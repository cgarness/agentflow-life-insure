import React from "react";
import { ArrowUp, ArrowDown, Minus, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import LeaderboardAgentAvatar from "@/components/leaderboard/LeaderboardAgentAvatar";
import { BadgeIcons, FireIcon } from "@/components/leaderboard/LeaderboardBadgeIcons";
import type { Badge as BadgeType, AgentFireStatus } from "@/components/leaderboard/useLeaderboardBadges";
import type { AgentStats, LeaderboardView } from "@/components/leaderboard/leaderboardTypes";

interface LeaderboardRankingsTableProps {
  restAgents: AgentStats[];
  view: LeaderboardView;
  userId?: string;
  orgId?: string | null;
  isAdmin: boolean;
  badgesMap: Map<string, BadgeType[]>;
  fireMap: Map<string, AgentFireStatus>;
  rankAnimations: Map<string, "up" | "down">;
  getRowAnimation: (agentId: string) => string;
  onExportCsv: () => void;
  onOpenScorecard: (agent: AgentStats) => void;
}

const rankChangeDisplay = (a: AgentStats) => {
  if (a.prevRank === null) return <Minus className="w-3 h-3 text-muted-foreground" />;
  const diff = a.prevRank - a.rank;
  if (diff > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-success text-xs font-medium">
        <ArrowUp className="w-3 h-3" />
        {diff}
      </span>
    );
  }
  if (diff < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-destructive text-xs font-medium">
        <ArrowDown className="w-3 h-3" />
        {Math.abs(diff)}
      </span>
    );
  }
  return <Minus className="w-3 h-3 text-muted-foreground" />;
};

const LeaderboardRankingsTable: React.FC<LeaderboardRankingsTableProps> = ({
  restAgents,
  view,
  userId,
  orgId,
  isAdmin,
  badgesMap,
  fireMap,
  getRowAnimation,
  onExportCsv,
  onOpenScorecard,
}) => (
  <div className="bg-card rounded-xl border overflow-hidden">
    <div className="flex items-center justify-between px-4 py-3 border-b">
      <h3 className="font-semibold text-foreground">Full Rankings</h3>
      <button
        type="button"
        onClick={onExportCsv}
        className="text-xs text-primary flex items-center gap-1 hover:underline"
      >
        <Download className="w-3 h-3" /> Export CSV
      </button>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b bg-accent/50">
            <th className="text-left py-3 px-4 font-medium w-16">Rank</th>
            <th className="text-left py-3 font-medium">Agent</th>
            <th className="text-right py-3 font-medium">Calls</th>
            <th className="text-right py-3 font-medium">Policies</th>
            <th className="text-right py-3 font-medium hidden lg:table-cell">Appts</th>
            <th className="text-right py-3 font-medium hidden xl:table-cell">Talk Time</th>
            <th className="text-right py-3 font-medium hidden lg:table-cell">Conv %</th>
            <th className="text-right py-3 px-4 font-medium w-20" />
          </tr>
        </thead>
        <tbody>
          {restAgents.map((a) => {
            const initials = `${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`;
            const displayName = `${a.first_name} ${a.last_name?.[0] || ""}.`;
            const isMe = a.id === userId;
            const agentBadges = badgesMap.get(a.id) || [];
            const fire = fireMap.get(a.id);
            const crossOrg =
              view === "group" && a.organizationId && a.organizationId !== orgId && !isMe;

            return (
              <tr
                key={a.id}
                className={`border-b last:border-0 hover:bg-accent/30 transition-all duration-600 ${isMe ? "bg-primary/5 border-l-2 border-primary" : ""} ${getRowAnimation(a.id)}`}
              >
                <td className="py-3 px-4">
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-foreground">{a.rank}</span>
                    {rankChangeDisplay(a)}
                  </div>
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <LeaderboardAgentAvatar
                      avatarUrl={a.avatar_url}
                      initials={initials}
                      alt={`${a.first_name} ${a.last_name}`.trim() || "Agent"}
                      className="h-7 w-7"
                      fallbackClassName="text-[10px]"
                    />
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">
                        {displayName}
                        <FireIcon fire={fire} agentName={displayName} />
                      </span>
                      {view === "group" && a.organizationName && (
                        <span className="text-[10px] text-muted-foreground">{a.organizationName}</span>
                      )}
                    </div>
                    <BadgeIcons badges={agentBadges} max={3} />
                  </div>
                </td>
                <td className="py-3 text-right text-foreground">{a.callsMade}</td>
                <td className="py-3 text-right text-foreground font-medium">{a.policiesSold}</td>
                <td className="py-3 text-right text-foreground hidden lg:table-cell">{a.appointmentsSet}</td>
                <td className="py-3 text-right text-foreground hidden xl:table-cell">
                  {(a.talkTime / 3600).toFixed(1)} hrs
                </td>
                <td className="py-3 text-right text-foreground hidden lg:table-cell">
                  {a.conversionRate.toFixed(1)}%
                </td>
                <td className="py-3 px-4 text-right">
                  {!crossOrg && (isAdmin || isMe) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => onOpenScorecard(a)}
                    >
                      Scorecard
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {restAgents.length === 0 && (
            <tr>
              <td colSpan={8} className="py-8 text-center text-muted-foreground">
                All agents shown in podium above
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

export default LeaderboardRankingsTable;
