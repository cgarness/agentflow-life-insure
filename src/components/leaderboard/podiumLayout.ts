/** Podium layout tokens — same across every period and org/group view */

export const PODIUM_SLOT_RANKS = [2, 1, 3] as const;
export type PodiumSlotRank = (typeof PODIUM_SLOT_RANKS)[number];

/** Fixed card heights (bottom-aligned): 1st tallest → 3rd shortest. Room for AP plus the Policies · Calls row. */
export const PODIUM_TIER_HEIGHT: Record<PodiumSlotRank, string> = {
  1: "h-[300px]",
  2: "h-[284px]",
  3: "h-[268px]",
};

/** Grid shell below the filter row — must fit tallest card */
export const PODIUM_SECTION_CLASS = "pt-6 sm:pt-8";

/**
 * Stacked (one column, phones): every slot is as tall as its card, so cards never overlap. From `sm` the three
 * columns share one bottom-aligned row tall enough for the gold card.
 */
export const PODIUM_GRID_CLASS =
  "grid grid-cols-1 gap-3 md:gap-4 items-end mx-auto w-full justify-items-stretch sm:h-[304px] sm:grid-cols-3 max-w-3xl lg:max-w-4xl";

/** A stacked slot takes its card's height; side by side it fills the shared row. */
export const PODIUM_SLOT_HEIGHT: Record<PodiumSlotRank, string> = {
  1: "h-[300px] sm:h-full",
  2: "h-[284px] sm:h-full",
  3: "h-[268px] sm:h-full",
};

/** Loading skeleton heights match tier 2 / 1 / 3 in DOM order */
export const PODIUM_SKELETON_HEIGHTS = ["h-[284px]", "h-[300px]", "h-[268px]"] as const;
