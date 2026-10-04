import { formatTalkTime } from "@/components/leaderboard/leaderboardTypes";
import React from "react";
import { motion, LayoutGroup } from "framer-motion";
import { ArrowUp, ArrowDown, TrendingUp } from "lucide-react";
import LeaderboardAgentAvatar from "./LeaderboardAgentAvatar";
import OdometerValue from "./OdometerValue";
import { TV_PANEL_CLASS, TV_PANEL_HEADER_CLASS } from "./tvPanelLayout";
import { agentHighlightClass } from "./leaderboardHighlight";
import { type AgentStats, type Metric, type RankMovement, formatPremiumSold } from "./leaderboardTypes";
import { type RankMotionKind, tvTableRowLayoutTransition } from "./leaderboardRankMotion";
const TV_TABLE_ROW = "grid w-full grid-cols-[2.5rem_minmax(6rem,1.4fr)_repeat(6,minmax(2.5rem,1fr))] items-center gap-x-1 px-3";
const rankMovementDisplay = (movement: RankMovement | undefined) => {
  if (!movement) return null;
  if (movement.direction === "up") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-emerald-400 text-xs font-semibold whitespace-nowrap"
        title={`Moved up ${movement.spots} spot${movement.spots === 1 ? "" : "s"} since the last leaderboard update`}
      >
        <ArrowUp className="w-3 h-3" aria-hidden />
        {movement.spots}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 text-red-400 text-xs font-semibold whitespace-nowrap"
      title={`Moved down ${movement.spots} spot${movement.spots === 1 ? "" : "s"} since the last leaderboard update`}
    >
      <ArrowDown className="w-3 h-3" aria-hidden />
      {movement.spots}
    </span>
  );
};

interface Props {
 tableAgents: AgentStats[]; metric: Metric; live: boolean;
 tvRankMotions: Map<string, RankMotionKind>; tvRankAnimations: Map<string, "up" | "down">;
 tvRankDeltas: Map<string, number>; tvRankMovements: Map<string, RankMovement>;
 spotlightAgentId?: string | null; newLeaderId?: string | null;
}
export default function TVRankingsTable({ tableAgents, metric, live, tvRankMotions, tvRankAnimations, tvRankDeltas, tvRankMovements, spotlightAgentId, newLeaderId }: Props) {
 return (
          <div className="order-1 xl:order-none min-w-0 flex min-h-[26rem] flex-col overflow-hidden xl:col-start-2" data-testid="tv-rankings">
          <div className={TV_PANEL_CLASS}>
            <div className={`${TV_PANEL_HEADER_CLASS} justify-center`}>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-blue-400">
                <TrendingUp className="h-4 w-4" />
                {live ? "Live Ranking" : "Ranking"}: {metric}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                className={`${TV_TABLE_ROW} shrink-0 border-b border-white/5 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500`}
              >
                <span className="text-left">Rank</span>
                <span className="text-center">Agent</span>
                <span className="text-center">Calls</span>
                <span className="text-center">Policies</span>
                <span className="text-center">Annual Premium</span>
                <span className="text-center">Appts</span>
                <span className="text-center">Talk</span>
                <span className="text-center">Policies / 100 Calls</span>
              </div>

              <LayoutGroup id="tv-table">
                <motion.div layout className="grid min-h-[21rem] flex-1 auto-rows-[minmax(3rem,1fr)] divide-y divide-white/[0.05]">
                  {tableAgents.length === 0 ? (
                    <div className="col-span-full flex flex-1 items-center justify-center py-8 text-center text-sm font-medium tracking-wide text-slate-500">
                      ALL AGENTS COMPETING ON THE PODIUM
                    </div>
                  ) : (
                    tableAgents.map((a) => {
                      const rank = a.rank;
                      const motionKind = tvRankMotions.get(a.id) ?? "none";
                      const rankGlow = tvRankAnimations.get(a.id);
                      const rankDelta = tvRankDeltas.get(a.id) ?? 0;

                      return (
                        <motion.div
                          key={a.id}
                          layout="position"
                          transition={{ layout: tvTableRowLayoutTransition(rankDelta) }}
                          className={`${TV_TABLE_ROW} min-h-12 ${rankGlow === "up" ? "animate-rank-up-glow" : ""} ${rankGlow === "down" ? "animate-rank-down-glow" : ""} ${agentHighlightClass(a.id, { spotlightAgentId, newLeaderId })}`}
                        >
                          <div className="flex items-center gap-0.5 font-black text-sm text-slate-400">
                            <span key={`${rank}-${motionKind}`} className={motionKind !== "none" ? "animate-rank-pill-pop" : ""}>
                              {rank}
                            </span>
                            {rankMovementDisplay(tvRankMovements.get(a.id))}
                          </div>
                          <div className="flex min-w-0 items-center justify-center gap-2">
                            <LeaderboardAgentAvatar
                              avatarUrl={a.avatar_url}
                              initials={`${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`}
                              alt={`${a.first_name} ${a.last_name}`}
                              className="h-8 w-8 shrink-0 border border-white/10"
                              fallbackClassName="text-xs bg-blue-500/10 text-blue-400"
                            />
                            <span className="truncate text-sm font-bold text-white">
                              {a.first_name} {a.last_name?.[0]}.
                            </span>
                          </div>
                          <div className="text-center text-sm tabular-nums font-medium text-slate-300">
                            <OdometerValue value={a.callsMade} format={(n) => String(Math.round(n))} tv />
                          </div>
                          <div className="text-center text-sm tabular-nums font-bold text-blue-400">
                            <OdometerValue value={a.policiesSold} format={(n) => String(Math.round(n))} tv />
                          </div>
                          <div className="text-center text-sm tabular-nums font-bold text-amber-300">
                            <OdometerValue value={a.premiumSold} format={formatPremiumSold} tv />{Boolean(a.unknownPremiums) && <span title={`${a.unknownPremiums} policies have unknown premium`}>*</span>}
                          </div>
                          <div className="text-center text-sm tabular-nums font-bold text-emerald-400">
                            <OdometerValue value={a.appointmentsSet} format={(n) => String(Math.round(n))} tv />
                          </div>
                          <div className="text-center text-sm tabular-nums text-slate-400">
                            <OdometerValue value={a.talkTime} format={formatTalkTime} tv />
                          </div>
                          <div className="text-center text-sm tabular-nums font-bold text-orange-400">
                            <OdometerValue value={a.conversionRate} format={(n) => n.toFixed(1)} tv />
                          </div>
                        </motion.div>
                      );
                    })
                  )}
                </motion.div>
              </LayoutGroup>
            </div>
          </div>
          </div>

 );
}
