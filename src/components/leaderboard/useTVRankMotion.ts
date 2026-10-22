import { useEffect, useRef, useState } from "react";
import { type AgentStats, type RankMovement, hasMeaningfulStandings, rankingValuesEqual, snapshotRankingValues } from "./leaderboardTypes";
import { type RankMotionKind, buildRankDeltaMap, buildRankMotionMap, computeRankMovements } from "./leaderboardRankMotion";

const empty = () => ({
  tvRankMotions: new Map<string, RankMotionKind>(),
  tvRankDeltas: new Map<string, number>(),
  tvRankMovements: new Map<string, RankMovement>(),
  tvRankAnimations: new Map<string, "up" | "down">(),
});

/**
 * A selection change never borrows motion from another organization or period. Change detection covers the whole AP
 * sort key, so a tie-break reorder (equal AP, different Policies or Calls) moves like any other rank change.
 */
export function useTVRankMotion(agents: AgentStats[], selection: string) {
  const previous = useRef({ selection: "", ranks: new Map<string, number>(), values: new Map<string, string>() });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [state, setState] = useState(() => ({ selection, ...empty() }));
  useEffect(() => {
    const prev = previous.current;
    const changed = prev.selection !== selection;
    previous.current = { selection, ranks: new Map(agents.map(a => [a.id, a.rank])), values: snapshotRankingValues(agents) };
    if (!changed && rankingValuesEqual(agents, prev.values)) return;
    clearTimeout(timer.current);
    if (changed || !hasMeaningfulStandings(agents)) {
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
  }, [agents, selection]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return state.selection === selection ? state : empty();
}
