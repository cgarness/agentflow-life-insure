import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";
import LeaderboardAgentAvatar from "@/components/leaderboard/LeaderboardAgentAvatar";
import { TV_PANEL_CLASS, TV_PANEL_HEADER_CLASS } from "@/components/leaderboard/tvPanelLayout";
import type { Win } from "@/components/leaderboard/leaderboardTypes";
import { formatPremiumSold } from "@/components/leaderboard/leaderboardTypes";

interface RecentWinsAgent {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url?: string | null;
}

interface RecentWinsPanelProps {
  wins: Win[];
  agents: RecentWinsAgent[];
  flashingWinId: string | null;
  title?: string;
  variant?: "default" | "tv";
}

const WIN_FLASH_MS = 3200;

const resolveAgent = (win: Win, agents: RecentWinsAgent[]) => {
  if (win.agent_id) {
    const byId = agents.find((a) => a.id === win.agent_id);
    if (byId) return byId;
  }
  return agents.find(
    (a) =>
      `${a.first_name} ${a.last_name?.[0]}.` === win.agent_name ||
      `${a.first_name} ${a.last_name}` === win.agent_name,
  );
};

const RecentWinsPanel: React.FC<RecentWinsPanelProps> = ({
  wins,
  agents,
  flashingWinId,
  title = "Recent Wins",
  variant = "default",
}) => {
  const isTv = variant === "tv";
  const { formatDate, formatTime } = useBranding();
  const listRef = useRef<HTMLDivElement>(null);
  const prevTopWinIdRef = useRef<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const [localFlashWinId, setLocalFlashWinId] = useState<string | null>(null);

  useEffect(() => {
    const topId = wins[0]?.id ?? null;
    if (!topId) {
      prevTopWinIdRef.current = null;
      return;
    }

    const prevTop = prevTopWinIdRef.current;
    prevTopWinIdRef.current = topId;

    if (prevTop === null || prevTop === topId) return;

    setLocalFlashWinId(topId);
    if (flashTimerRef.current != null) {
      window.clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = window.setTimeout(() => {
      setLocalFlashWinId(null);
      flashTimerRef.current = null;
    }, WIN_FLASH_MS);

    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [wins]);

  useEffect(
    () => () => {
      if (flashTimerRef.current != null) {
        window.clearTimeout(flashTimerRef.current);
      }
    },
    [],
  );

  return (
    <div
      className={cn(
        "min-w-0",
        isTv ? TV_PANEL_CLASS : "rounded-xl border bg-card p-4",
      )}
    >
      <h3
        className={cn(
          isTv
            ? `${TV_PANEL_HEADER_CLASS} gap-2 text-sm font-bold text-white`
            : "border-b border-border pb-3 font-semibold text-foreground",
        )}
      >
        {isTv ? (
          <>
            <Trophy className="h-4 w-4 shrink-0 text-amber-400" />
            {title}
          </>
        ) : (
          `🏆 ${title}`
        )}
      </h3>
      {wins.length === 0 ? (
        <p className={cn("py-8 text-center text-sm", isTv ? "text-slate-400" : "text-muted-foreground")}>
          No wins yet. Get dialing and close some deals! 🦈
        </p>
      ) : (
        <div
          ref={listRef}
          className={cn(
            "space-y-2.5 overflow-y-auto overscroll-y-contain scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent",
            isTv
              ? "min-h-0 flex-1 px-2 py-2"
              : "max-h-[calc(4.75rem*6+0.625rem*5+0.25rem)] px-1 pt-4 pb-2",
          )}
        >
          {wins.map((w, index) => {
            const agent = resolveAgent(w, agents);
            const initials = (agent
              ? `${agent.first_name?.[0] || ""}${agent.last_name?.[0] || ""}`
              : (w.agent_name || "??")
                  .split(" ")
                  .map((c) => c[0])
                  .join("")
                  .slice(0, 2)
            ).toUpperCase();
            const isFlashing =
              index === 0 &&
              (flashingWinId === w.id || localFlashWinId === w.id);
            const when = new Date(w.created_at);
            const premiumSold = w.premiumSold ?? 0;
            const showPremiumBadge = premiumSold > 0;

            const rowClassName = cn(
              "relative flex items-center gap-x-3 rounded-lg border-b px-2 py-2.5 last:border-0",
              isTv ? "border-white/[0.06]" : "border-border/60",
              isFlashing &&
                "animate-leaderboard-flash z-[1] ring-2 ring-yellow-500/55 bg-amber-400/20 shadow-[inset_0_0_0_1px_rgba(250,204,21,0.35),0_0_20px_-4px_rgba(234,179,8,0.55)]",
            );

            const content = (
              <>
                <LeaderboardAgentAvatar
                  avatarUrl={agent?.avatar_url}
                  initials={initials}
                  alt={w.agent_name || "Agent"}
                  className={cn(
                    "h-8 w-8 shrink-0",
                    isFlashing && "ring-2 ring-yellow-400/90 shadow-[0_0_12px_rgba(234,179,8,0.5)]",
                  )}
                  fallbackClassName="text-[10px]"
                />
                <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-x-2">
                    <span
                      className={cn(
                        "text-sm font-medium leading-snug truncate",
                        isFlashing ? "text-amber-950 dark:text-amber-50" : isTv ? "text-white" : "text-foreground",
                      )}
                      title={w.agent_name || "Agent"}
                    >
                      {w.agent_name || "Agent"}
                    </span>
                    {w.policy_type ? (
                      <span
                        className={cn(
                          "text-[11px] px-1.5 py-px rounded-full font-medium shrink-0 whitespace-nowrap",
                          isFlashing
                            ? "bg-yellow-500/25 text-amber-900 dark:text-yellow-100"
                            : isTv
                              ? "border border-blue-500/20 bg-blue-500/10 text-blue-300"
                              : "bg-primary/10 text-primary",
                        )}
                      >
                        {w.policy_type}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className={cn(
                      "flex items-center justify-between gap-x-2 text-xs tabular-nums leading-snug",
                      isTv ? "text-slate-400" : "text-muted-foreground",
                    )}
                  >
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span>{formatDate(when)}</span>
                      <span className={isTv ? "text-slate-500" : "text-muted-foreground/40"}>·</span>
                      <span>{formatTime(when)}</span>
                    </div>
                    {showPremiumBadge ? (
                      <span
                        className={cn(
                          "text-[11px] px-1.5 py-px rounded-full font-semibold whitespace-nowrap tabular-nums shrink-0",
                          isFlashing
                            ? "bg-emerald-500/25 text-emerald-950 dark:text-emerald-100 ring-1 ring-emerald-500/40"
                            : isTv
                              ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                              : "bg-success/15 text-success ring-1 ring-success/30",
                        )}
                        title="Premium sold"
                      >
                        {formatPremiumSold(premiumSold)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </>
            );

            if (isFlashing) {
              return (
                <motion.div
                  key={`${w.id}-flash`}
                  initial={{ opacity: 0, y: -10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className={rowClassName}
                >
                  {content}
                </motion.div>
              );
            }

            return (
              <div key={w.id} className={rowClassName}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RecentWinsPanel;
