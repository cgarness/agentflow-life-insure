/**
 * reportTableStyles — the one table style every Reports table uses: sentence-case headers, right-aligned
 * tabular numbers, py-2.5 rows and a first column that stays pinned while the rest scrolls. Every row's
 * first cell (thead, tbody and tfoot) is sticky with an opaque bg-card, so scrolled values never show
 * through it. Widths live on inner wrappers (TH_LABEL, ROW_LABEL): browsers ignore max-width on table cells.
 */
const HEAD = "h-10 border-b border-border/60 bg-card px-3 py-2 align-bottom text-xs font-medium text-muted-foreground";
const PIN = "sticky left-0 z-10 shadow-[inset_-1px_0_0_hsl(var(--border))]";

/** Column header (numeric, right-aligned). */
export const TH = `${HEAD} text-right`;
/** Header of the pinned first column. */
export const TH_FIRST = `${HEAD} ${PIN} text-left`;
/** Header text: wraps within 7.5rem below sm so the first important column fits beside the pinned label. */
export const TH_LABEL = "block max-w-[7.5rem] whitespace-normal sm:max-w-none sm:whitespace-nowrap";

const CELL = "border-b border-border/50 px-3 py-2.5 align-top";
/** Body cell; the row hover tints only these, never the opaque pinned cell. */
export const TD = `${CELL} whitespace-nowrap text-right tabular-nums text-foreground`;
/** Pinned row label (a th scope="row"). */
export const TD_FIRST = `${CELL} ${PIN} bg-card text-left font-medium text-foreground`;
/** Width of the pinned label's content: narrow on phones, capped everywhere so long names wrap. */
export const ROW_LABEL = "block min-w-[8.5rem] max-w-[13rem] break-words sm:min-w-[9rem] sm:max-w-[16rem]";
/** For a table that scrolls even on desktop (its label column never gets slack): campaign names wrap less. */
export const ROW_LABEL_WIDE = "block min-w-[8.5rem] max-w-[13rem] break-words sm:min-w-[12rem] sm:max-w-[16rem]";
/** A second line inside a cell ("Selected", "2/2 known", "Activity or policies without an agent"). */
export const TD_SUB = "mt-0.5 block text-[11px] font-normal text-muted-foreground";
export const TR = "[&:hover>td]:bg-muted/40";

/** tfoot cells: an opaque card tinted by a muted background image, so the pinned label stays opaque. */
const FOOT = "border-t border-border/60 bg-card bg-gradient-to-r from-muted/40 to-muted/40 px-3 py-2.5 align-top text-muted-foreground";
export const TF = `${FOOT} whitespace-nowrap text-right tabular-nums`;
export const TF_FIRST = `${FOOT} ${PIN} text-left font-medium`;
