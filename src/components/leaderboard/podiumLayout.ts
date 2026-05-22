/** Podium layout tokens — same across every metric, period, and org/group view */

export const PODIUM_SLOT_RANKS = [2, 1, 3] as const;
export type PodiumSlotRank = (typeof PODIUM_SLOT_RANKS)[number];

/** Fixed card heights (bottom-aligned): 1st tallest → 3rd shortest */
export const PODIUM_TIER_HEIGHT: Record<PodiumSlotRank, string> = {
  1: "h-[264px]",
  2: "h-[248px]",
  3: "h-[232px]",
};

/** Grid shell below the filter row — must fit tallest card */
export const PODIUM_SECTION_CLASS = "pt-6 sm:pt-8";

export const PODIUM_GRID_CLASS =
  "grid grid-cols-1 gap-3 md:gap-4 items-end mx-auto w-full justify-items-stretch h-[268px] sm:grid-cols-3 max-w-3xl lg:max-w-4xl";

/** Loading skeleton heights match tier 2 / 1 / 3 in DOM order */
export const PODIUM_SKELETON_HEIGHTS = ["h-[248px]", "h-[264px]", "h-[232px]"] as const;
