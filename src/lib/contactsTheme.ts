/**
 * Contacts QA Fix Pass 1 (Fix 6) — ONE shared selected-state vocabulary for the
 * Contacts page controls (main tabs, scope pills, Kanban/List toggle), so the
 * "selected" state reads strongly and identically everywhere instead of the prior
 * ad-hoc weak recipes. Built on the brand `--primary` token (identical in light +
 * dark per src/index.css), Tailwind-only. Apply with `cn(base, segmentClass(active))`.
 */

/** Segmented-control track shell (scope pills + view toggle). */
export const SEGMENT_TRACK =
  "inline-flex items-center gap-1 rounded-lg bg-muted p-1 border border-border";

/** Active pill in a segmented control — strong brand fill, unambiguous in light + dark. */
export const SEGMENT_ACTIVE = "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/60";

/** Inactive pill — muted with a hover affordance. */
export const SEGMENT_INACTIVE = "text-muted-foreground hover:text-foreground hover:bg-foreground/5";

/** Active main tab — strengthened underline (brand color + bolder weight). */
export const TAB_ACTIVE = "text-primary border-b-2 border-primary font-semibold";

/** Inactive main tab — transparent border keeps height parity with the active tab. */
export const TAB_INACTIVE = "text-muted-foreground hover:text-foreground border-b-2 border-transparent";

export function segmentClass(active: boolean): string {
  return active ? SEGMENT_ACTIVE : SEGMENT_INACTIVE;
}

export function tabClass(active: boolean): string {
  return active ? TAB_ACTIVE : TAB_INACTIVE;
}
