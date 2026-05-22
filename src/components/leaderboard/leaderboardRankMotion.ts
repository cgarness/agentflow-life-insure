import type { RankMovement } from "@/components/leaderboard/leaderboardTypes";

export type RankMotionKind = "none" | "glide" | "podium-enter" | "podium-exit";

const PODIUM_CUTOFF = 3;

/** Podium boundary cross = pop in/out; same zone reorder = layout glide */
export function classifyRankMotion(
  prevRank: number | undefined,
  newRank: number,
): RankMotionKind {
  if (prevRank === undefined || prevRank === newRank) return "none";

  const wasPodium = prevRank <= PODIUM_CUTOFF;
  const isPodium = newRank <= PODIUM_CUTOFF;

  if (!wasPodium && isPodium) return "podium-enter";
  if (wasPodium && !isPodium) return "podium-exit";
  return "glide";
}

/** Premium glide — slightly slower/heavier spring */
export const leaderboardGlideTransition = {
  type: "spring" as const,
  stiffness: 280,
  damping: 38,
  mass: 0.95,
};

export const leaderboardPodiumEnterTransition = {
  duration: 0.55,
  ease: [0.22, 1, 0.36, 1] as const,
};

export const leaderboardPodiumExitTransition = {
  duration: 0.38,
  ease: [0.4, 0, 0.2, 1] as const,
};

export const podiumEnterInitial = { opacity: 0, y: 32, scale: 0.94 };

export function buildRankMotionMap(
  agents: { id: string; rank: number }[],
  prevRanks: Map<string, number>,
): Map<string, RankMotionKind> {
  const motions = new Map<string, RankMotionKind>();
  for (const a of agents) {
    const prev = prevRanks.get(a.id);
    if (prev === undefined || prev === a.rank) continue;
    motions.set(a.id, classifyRankMotion(prev, a.rank));
  }
  return motions;
}

/** Rank positions moved — used for staggered table row glides */
export function buildRankDeltaMap(
  agents: { id: string; rank: number }[],
  prevRanks: Map<string, number>,
): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const a of agents) {
    const prev = prevRanks.get(a.id);
    if (prev === undefined || prev === a.rank) continue;
    deltas.set(a.id, Math.abs(prev - a.rank));
  }
  return deltas;
}

export function glideStaggerDelay(delta: number): number {
  return Math.min(delta, 6) * 0.055;
}

/** TV stagger — longer delay between rows for dramatic cascade */
export function tvGlideStaggerDelay(delta: number): number {
  return Math.min(delta, 6) * 0.095;
}

/** Compare current snapshot ranks to the previous displayed snapshot for live arrows. */
export function computeRankMovements(
  agents: { id: string; rank: number }[],
  previousDisplayedRanks: Map<string, number>,
): Map<string, RankMovement> {
  const movements = new Map<string, RankMovement>();
  for (const agent of agents) {
    const previousRank = previousDisplayedRanks.get(agent.id);
    if (previousRank === undefined || previousRank === agent.rank) continue;
    if (agent.rank < previousRank) {
      movements.set(agent.id, { direction: "up", spots: previousRank - agent.rank });
    } else {
      movements.set(agent.id, { direction: "down", spots: agent.rank - previousRank });
    }
  }
  return movements;
}

/** Table row slide — tuned for visible vertical travel */
export function tableRowLayoutTransition(delta = 0) {
  return {
    type: "spring" as const,
    stiffness: 240,
    damping: 32,
    mass: 1.05,
    delay: delta > 0 ? glideStaggerDelay(delta) : 0,
  };
}

/** TV board — slower, heavier springs for dramatic fullscreen rank slides */
export const tvGlideTransition = {
  type: "spring" as const,
  stiffness: 155,
  damping: 26,
  mass: 1.4,
};

export const tvPodiumEnterTransition = {
  duration: 0.78,
  ease: [0.22, 1, 0.36, 1] as const,
};

export const tvPodiumExitTransition = {
  duration: 0.52,
  ease: [0.4, 0, 0.2, 1] as const,
};

export function tvTableRowLayoutTransition(delta = 0) {
  return {
    type: "spring" as const,
    stiffness: 125,
    damping: 24,
    mass: 1.45,
    delay: delta > 0 ? tvGlideStaggerDelay(delta) : 0,
  };
}
