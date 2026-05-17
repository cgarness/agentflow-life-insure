import React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Badge as BadgeType, AgentFireStatus } from "@/components/leaderboard/useLeaderboardBadges";

export const BadgeIcons: React.FC<{ badges: BadgeType[]; max?: number }> = ({ badges, max = 3 }) => {
  if (badges.length === 0) return null;
  const shown = badges.slice(0, max);
  const extra = badges.length - max;
  return (
    <TooltipProvider delayDuration={200}>
      <span className="inline-flex items-center gap-0.5 ml-1">
        {shown.map((b) => (
          <Tooltip key={b.id}>
            <TooltipTrigger asChild>
              <span className="text-sm cursor-default">{b.icon}</span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs font-medium">{b.label}</p>
              <p className="text-xs text-muted-foreground">{b.description}</p>
            </TooltipContent>
          </Tooltip>
        ))}
        {extra > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[10px] text-muted-foreground cursor-default">+{extra}</span>
            </TooltipTrigger>
            <TooltipContent>
              {badges.slice(max).map((b) => (
                <p key={b.id} className="text-xs">
                  {b.icon} {b.label}
                </p>
              ))}
            </TooltipContent>
          </Tooltip>
        )}
      </span>
    </TooltipProvider>
  );
};

export const FireIcon: React.FC<{ fire: AgentFireStatus | undefined; agentName?: string }> = ({
  fire,
  agentName,
}) => {
  if (!fire || fire.level === "none") return null;
  const text = fire.level === "blazing" ? "🔥🔥" : "🔥";
  const cls = fire.level === "blazing" ? "animate-fire-flicker" : "animate-fire-pulse";
  const tip = `${agentName || "Agent"} is ${fire.level === "blazing" ? "blazing" : "on fire"} today! ${fire.todayCalls} calls vs their ${fire.avgCalls}/day average`;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-block ml-1 ${cls}`}>{text}</span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{tip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
