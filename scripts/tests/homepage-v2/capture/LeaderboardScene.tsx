import React, { useEffect, useState } from "react";
import LeaderboardPodium from "@/components/leaderboard/LeaderboardPodium";
import LeaderboardRankingsTable from "@/components/leaderboard/LeaderboardRankingsTable";
import { rankAgents, type AgentStats } from "@/components/leaderboard/leaderboardTypes";
import { buildRankDeltaMap, buildRankMotionMap, computeRankMovements } from "@/components/leaderboard/leaderboardRankMotion";

const BASE: AgentStats[] = ["Avery", "Jordan", "Riley"].map((name, index) => ({ id: `demo-${index}`, first_name: name, last_name: "Demo",
  callsMade: 210 - index * 23, policiesSold: 16 - index * 3, appointmentsSet: 15 - index, talkTime: 6000,
  conversionRate: 5, premiumSold: 25200 - index * 3600, recentWins7d: 2, rank: index + 1 }));
const PREVIOUS = new Map(BASE.map(agent => [agent.id, agent.rank]));

export default function LeaderboardScene({ epoch }: { epoch: number }) {
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    setUpdated(false); if (!epoch) return;
    const a = setTimeout(() => setUpdated(true), 1450);
    return () => { clearTimeout(a); };
  }, [epoch]);
  const agents = rankAgents(BASE.map(agent => ({ ...agent, ...(updated && agent.id === "demo-1" ? { premiumSold: 26400, policiesSold: 17 } : {}) })));
  const motions = buildRankMotionMap(agents, PREVIOUS), movements = computeRankMovements(agents, PREVIOUS);
  const animations = new Map<string, "up" | "down">([...movements].map(([id, movement]) => [id, movement.direction]));
  const common = { agents, view: "org" as const, rankAnimations: animations, rankMotions: motions,
    rankDeltas: buildRankDeltaMap(agents, PREVIOUS), newLeaderId: updated ? "demo-1" : null };
  return <div className="space-y-4 px-6 pb-6 pt-1">
    <LeaderboardPodium {...common} />
    <LeaderboardRankingsTable {...common} rankMovements={movements} onExportCsv={() => {}} />
  </div>;
}
