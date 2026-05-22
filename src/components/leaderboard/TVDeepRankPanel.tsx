import React from "react";
import { motion } from "framer-motion";
import { Hash } from "lucide-react";
import LeaderboardAgentAvatar from "@/components/leaderboard/LeaderboardAgentAvatar";
import OdometerValue from "@/components/leaderboard/OdometerValue";
import { agentHighlightClass } from "@/components/leaderboard/leaderboardHighlight";
import { tvTableRowLayoutTransition } from "@/components/leaderboard/leaderboardRankMotion";
import { TV_PANEL_CLASS, TV_PANEL_HEADER_CLASS } from "@/components/leaderboard/tvPanelLayout";
import type { AgentStats, Metric } from "@/components/leaderboard/leaderboardTypes";
import { formatMetricValue, metricKey } from "@/components/leaderboard/leaderboardTypes";

interface TVDeepRankPanelProps {
  agents: AgentStats[];
  metric: Metric;
  rankDeltas?: Map<string, number>;
  spotlightAgentId?: string | null;
  newLeaderId?: string | null;
}

const TVDeepRankPanel: React.FC<TVDeepRankPanelProps> = ({
  agents,
  metric,
  rankDeltas = new Map(),
  spotlightAgentId,
  newLeaderId,
}) => {
  const key = metricKey(metric);

  return (
    <div className={TV_PANEL_CLASS}>
      <div className={`${TV_PANEL_HEADER_CLASS} justify-between gap-2`}>
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <Hash className="h-4 w-4 text-slate-400" />
            Ranks 11+
          </h3>
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">{metric}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 py-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        {agents.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-slate-500">No agents ranked 11+ yet</p>
        ) : (
          <motion.ul layout className="space-y-1">
            {agents.map((a) => {
              const metricNumeric = a[key] as number;
              const rankDelta = rankDeltas.get(a.id) ?? 0;

              return (
                <motion.li
                  key={a.id}
                  layout="position"
                  layoutId={`tv-leaderboard-row-${a.id}`}
                  transition={{ layout: tvTableRowLayoutTransition(rankDelta) }}
                  className={`flex items-center gap-2 rounded-lg border border-transparent px-2 py-2.5 ${agentHighlightClass(a.id, {
                    spotlightAgentId,
                    newLeaderId,
                  })}`}
                >
                  <span className="w-6 shrink-0 text-center text-xs font-black tabular-nums text-slate-500">
                    {a.rank}
                  </span>
                  <LeaderboardAgentAvatar
                    avatarUrl={a.avatar_url}
                    initials={`${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`}
                    alt={`${a.first_name} ${a.last_name}`}
                    className="h-8 w-8 shrink-0 border border-white/10"
                    fallbackClassName="text-[10px] bg-blue-500/10 text-blue-400"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">
                      {a.first_name} {a.last_name?.[0]}.
                    </p>
                  </div>
                  <OdometerValue
                    value={metricNumeric}
                    format={(n) => formatMetricValue(metric, n)}
                    tv
                    className="shrink-0 text-sm font-bold tabular-nums text-blue-300"
                  />
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </div>
    </div>
  );
};

export default TVDeepRankPanel;
