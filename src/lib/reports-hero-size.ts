/**
 * Font sizes for the production band's two values. A value never wraps mid-number (`whitespace-nowrap`), so its size
 * comes from the formatted length and must fit the narrowest cell it can get. Widths measured in the browser fixture
 * (Inter 600, tracking-tight, tabular-nums), with the 240px app sidebar from md:
 * - split 2fr | 3fr: count 98px, premium 163px at 360px; 150px / 247px at 768px; 348px / 545px at 1280px (xl);
 * - stacked: each value gets the full width (294px at 360px, 446px at 768px). Below 360px (320px phones) the
 *   split band also stacks (ReportsOverview), so these split tiers never meet a cell narrower than at 360px.
 * Each tier keeps at least 5% to spare at its narrowest width. Today's sizes are kept wherever they fit.
 */

/** A formatted premium longer than this stacks the band instead of shrinking the number. */
export const LONG_PREMIUM = 12;

type Tier = readonly [maxLength: number, className: string];

const FULL_COUNT = "text-4xl md:text-5xl xl:text-[3.5rem]";
const FULL_PREMIUM = "text-3xl md:text-4xl xl:text-[3.5rem]";

const COUNT_SPLIT: readonly Tier[] = [
  [3, FULL_COUNT], // "999"
  [5, "text-3xl md:text-5xl xl:text-[3.5rem]"], // "9,999"
  [6, "text-2xl md:text-4xl xl:text-[3.5rem]"], // "99,999"
  [7, "text-xl md:text-3xl xl:text-[3.5rem]"], // "999,999"
  [Infinity, "text-lg md:text-2xl xl:text-[3.5rem]"], // "9,999,999"
];
const PREMIUM_SPLIT: readonly Tier[] = [
  [9, FULL_PREMIUM], // "$9,999.99"
  [10, "text-[1.75rem] md:text-4xl xl:text-[3.5rem]"], // "$99,999.99"
  [Infinity, "text-2xl md:text-4xl xl:text-[3.5rem]"], // "$999,999.99"
];
const PREMIUM_STACKED: readonly Tier[] = [
  [17, FULL_PREMIUM], // "$9,999,999,999.99"
  [Infinity, "text-2xl md:text-4xl xl:text-[3.5rem]"], // "$999,999,999,999.99"
];

/** Whether this formatted annual premium stacks the band (one column at every width). */
export function isLongPremium(text: string): boolean {
  return text.length > LONG_PREMIUM;
}

/** Responsive font-size classes for a formatted band value; a stacked count has the full width. */
export function heroValueSize(kind: "count" | "premium", text: string, stacked: boolean): string {
  if (kind === "count" && stacked) return FULL_COUNT;
  const tiers = kind === "count" ? COUNT_SPLIT : stacked ? PREMIUM_STACKED : PREMIUM_SPLIT;
  return (tiers.find(([max]) => text.length <= max) ?? tiers[tiers.length - 1])[1];
}
