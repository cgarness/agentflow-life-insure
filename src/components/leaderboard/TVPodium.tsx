import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy } from "lucide-react";
import LeaderboardAgentAvatar from "./LeaderboardAgentAvatar";
import OdometerValue from "./OdometerValue";
import { metalConfig } from "./tvPodiumMetal";
import { agentHighlightClass } from "./leaderboardHighlight";
import { type AgentStats, type Metric, metricKey, formatMetricValue } from "./leaderboardTypes";
import { type RankMotionKind, podiumEnterInitial, tvGlideTransition, tvPodiumEnterTransition, tvPodiumExitTransition } from "./leaderboardRankMotion";
interface Props {
  agents: AgentStats[]; metric: Metric;
  tvRankMotions: Map<string, RankMotionKind>;
  tvRankAnimations: Map<string, "up" | "down">;
  spotlightAgentId?: string | null; newLeaderId?: string | null;
}
export default function TVPodium({agents, metric, tvRankMotions, tvRankAnimations, spotlightAgentId, newLeaderId}: Props) {
  const key = metricKey(metric);
  return (
          <div data-testid="tv-podium" className={`mx-auto mt-8 flex h-[280px] w-full max-w-[72rem] shrink-0 items-end justify-center gap-4 pb-4 [@media(min-height:900px)]:h-[320px] md:gap-6`}>
            {([2, 1, 3] as const).map((slotRank) => {
              const a = agents.find((agent) => agent.rank === slotRank);
              if (!a && agents.length < 3) return <div key={`slot-${slotRank}`} className="flex-1" />;

              const mc = metalConfig(slotRank);
              const isFirst = slotRank === 1;
              const metricNumeric = a ? (a[key] as number) : 0;
              const motionKind = a ? tvRankMotions.get(a.id) ?? "none" : "none";
              const useLayoutGlide = motionKind === "glide";
              const rankGlow = a ? tvRankAnimations.get(a.id) : undefined;
              const pillPop = motionKind !== "none";

              return (
                <div key={`slot-${slotRank}`} className="relative isolate h-full min-w-0 flex-1">
                  <AnimatePresence mode="wait" initial={false}>
                    {a ? (
                      <motion.div
                        data-agent-id={a.id}
                        key={a.id}
                        layout={useLayoutGlide ? "position" : false}
                        initial={motionKind === "podium-enter" ? podiumEnterInitial : false}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.92 }}
                        transition={
                          useLayoutGlide
                            ? tvGlideTransition
                            : motionKind === "podium-enter"
                              ? tvPodiumEnterTransition
                              : tvPodiumExitTransition
                        }
                        className={`origin-bottom will-change-transform absolute bottom-0 left-0 right-0 w-full flex flex-col items-center ${
                          slotRank === 1 ? "scale-[1.02]" : slotRank === 2 ? "scale-[1.01]" : "scale-100"
                        }`}
                      >
                  {/* Card Body — trophy sits on the card lip so it cannot overlap the header */}
                  <div className="relative z-10 w-full">
                    <div
                      aria-hidden
                      className={`pointer-events-none absolute inset-0 z-0 ${mc.ambientClass}`}

                    />
                    <div
                      className={`relative z-10 w-full rounded-2xl border bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 pb-5 [@media(min-height:900px)]:p-6 text-center backdrop-blur-lg ${mc.border} ${mc.cardShadow} ${mc.cardRing} ${
                        rankGlow === "up" ? "animate-rank-up-glow" : ""
                      } ${rankGlow === "down" ? "animate-rank-down-glow" : ""} ${agentHighlightClass(a.id, {
                        spotlightAgentId,
                        newLeaderId,
                      })}`}
                    >
                      <div
                        className={`absolute left-1/2 z-20 -translate-x-1/2 rounded-full border-2 bg-white/[0.06] backdrop-blur-sm ${mc.trophyBorder} ${mc.trophyShadow} ${
                          isFirst ? "-top-8 p-3" : "-top-7 p-2.5"
                        } ${newLeaderId === a.id || (rankGlow === "up" && isFirst) ? "animate-tv-trophy-shimmer" : ""}`}
                      >
                        <Trophy className={`${isFirst ? "h-9 w-9" : "h-7 w-7"} ${mc.trophyColor} drop-shadow-lg`} />
                      </div>

                      <div className={`mx-auto flex w-full max-w-full flex-col items-center ${isFirst ? "pt-7" : "pt-6"}`}>
                      <LeaderboardAgentAvatar
                        avatarUrl={a.avatar_url}
                        initials={`${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}`}
                        alt={`${a.first_name} ${a.last_name}`}
                        className={`mx-auto mb-3 border-2 shadow-xl ${mc.border} ${isFirst ? "h-16 w-16 [@media(min-height:900px)]:h-24 [@media(min-height:900px)]:w-24" : "h-14 w-14 [@media(min-height:900px)]:h-20 [@media(min-height:900px)]:w-20"}`}
                        fallbackClassName={isFirst ? "text-3xl bg-blue-600/20" : "text-2xl"}
                      />

                      <h3 className={`w-full truncate px-2 text-center font-black leading-none tracking-tight text-white ${isFirst ? "text-2xl" : "text-xl"}`}>
                        {a.first_name} {a.last_name?.[0]}.
                      </h3>

                      <div className="mt-3 flex w-full flex-col items-center justify-center text-center">
                        <OdometerValue
                          value={metricNumeric}
                          format={(n) => formatMetricValue(metric, n)}
                          tv
                          className={`font-black tabular-nums text-white drop-shadow-lg leading-none ${isFirst ? "text-4xl [@media(min-height:900px)]:text-5xl" : "text-3xl [@media(min-height:900px)]:text-4xl"}`}
                        />
                        <span className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                          {metric}
                        </span>
                      </div>
                      </div>
                    </div>
                  </div>

                  {/* Rank Badge */}
                  <div
                    key={a ? `${a.rank}-${motionKind}` : slotRank}
                    className={`absolute -bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-full border px-4 py-1 text-xs font-black uppercase tracking-widest shadow-xl ${mc.rankBadge} ${
                      pillPop ? "animate-rank-pill-pop" : ""
                    }`}
                  >
                    #{slotRank}
                  </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

  );
}
