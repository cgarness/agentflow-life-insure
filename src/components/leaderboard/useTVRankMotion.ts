import { useEffect, useRef, useState } from "react";
import { type AgentStats, type Metric, type RankMovement, hasMeaningfulStandings, metricValueMapsEqual, snapshotMetricValues } from "./leaderboardTypes";
import { type RankMotionKind, buildRankDeltaMap, buildRankMotionMap, computeRankMovements } from "./leaderboardRankMotion";

const empty = () => ({
  tvRankMotions: new Map<string, RankMotionKind>(),
  tvRankDeltas: new Map<string, number>(),
  tvRankMovements: new Map<string, RankMovement>(),
  tvRankAnimations: new Map<string, "up" | "down">(),
});

/** A selection change never borrows motion from another metric/period. */
export function useTVRankMotion(agents: AgentStats[], metric: Metric, selection: string) {
  const previous = useRef({ selection: "", ranks: new Map<string, number>(), values: new Map<string, number>() });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [state, setState] = useState(() => ({ selection, ...empty() }));
  useEffect(() => {
    const prev = previous.current;
    const changed = prev.selection !== selection;
    previous.current = { selection, ranks: new Map(agents.map(a => [a.id, a.rank])), values: snapshotMetricValues(agents, metric) };
    if (!changed && metricValueMapsEqual(agents, prev.values, metric)) return;
    clearTimeout(timer.current);
    if (changed || !hasMeaningfulStandings(agents, metric)) {
      setState({ selection, ...empty() });
      return;
    }
    const motions = buildRankMotionMap(agents, prev.ranks);
    const animations = new Map<string, "up" | "down">();
    for (const a of agents) {
      const old = prev.ranks.get(a.id);
      if (old !== undefined && old !== a.rank) animations.set(a.id, a.rank < old ? "up" : "down");
    }
    setState({ selection, tvRankMotions: motions, tvRankDeltas: buildRankDeltaMap(agents, prev.ranks),
      tvRankMovements: computeRankMovements(agents, prev.ranks), tvRankAnimations: animations });
    timer.current = setTimeout(() => setState({ selection, ...empty() }), 2600);
  }, [agents, metric, selection]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return state.selection === selection ? state : empty();
}
