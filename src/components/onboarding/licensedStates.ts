import { US_STATE_NAMES } from "@/constants/us-geo";

/**
 * Pure helpers behind `LicensedStatesMultiSelect`.
 *
 * Kept out of the component module so the selection/summary logic is testable
 * without a DOM (Radix popovers + cmdk are portal-based) and so exporting them
 * never trips `react-refresh/only-export-components`.
 *
 * The stored shape is unchanged from the original checkbox list: a `string[]` of
 * full US state names drawn from `US_STATE_NAMES`.
 */

export const ALL_LICENSED_STATES: string[] = [...US_STATE_NAMES];

/** Add or remove one state, preserving the order of the remaining entries. */
export function toggleState(selected: string[], state: string): string[] {
  return selected.includes(state) ? selected.filter((s) => s !== state) : [...selected, state];
}

/** Case-insensitive match on the full state name. */
export function filterStates(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_LICENSED_STATES;
  return ALL_LICENSED_STATES.filter((s) => s.toLowerCase().includes(q));
}

/** Collapsed trigger summary. */
export function summarizeLicensedStates(selected: string[]): string {
  const count = selected.length;
  if (count === 0) return "No states selected";
  if (count >= ALL_LICENSED_STATES.length) return "All states selected";
  if (count === 1) return "1 state selected";
  return `${count} states selected`;
}

/** Chips shown under the trigger: at most `max`, with the overflow reported separately. */
export function visibleChips(selected: string[], max = 4): { chips: string[]; overflow: number } {
  return { chips: selected.slice(0, max), overflow: Math.max(0, selected.length - max) };
}
