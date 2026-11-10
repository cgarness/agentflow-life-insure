// Regional performance pure logic (D5 §4). Values come from the state reader; each is rounded once for display.
import { STATE_ABBR_TO_NAME } from "@/utils/stateUtils";
import { formatPremium } from "@/lib/reports-format";
import { toCents } from "@/lib/reports-kpi-format";
import type { ReportStateBreakdownV3 } from "@/lib/reports-v3-schemas";

export const US_STATE_CODES = Object.keys(STATE_ABBR_TO_NAME).filter(c => c.length === 2).sort();
export const SMALL_STATE_CODES = ["VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD", "DC"] as const;
export const REGIONAL_MODES = ["calls_made", "contacted_calls", "policies_sold", "ap"] as const;
export type RegionalMode = (typeof REGIONAL_MODES)[number];
export const REGIONAL_MODE_LABELS: Record<RegionalMode, string> = {
  calls_made: "Calls", contacted_calls: "Contacted calls", policies_sold: "Policies sold", ap: "AP",
};
export type StateRow = ReportStateBreakdownV3["jurisdictions"][number];
export const stateName = (code: string) => STATE_ABBR_TO_NAME[code] ?? code;

/** The mode's value: AP in exact cents (null when no premium is known), counts as integers. */
export function modeValue(row: Pick<StateRow, "calls_made" | "contacted_calls" | "policies_sold" | "premium">, mode: RegionalMode): number | null {
  if (mode !== "ap") return row[mode];
  return row.premium.known_count > 0 && row.premium.annual_premium !== null ? Number(toCents(row.premium.annual_premium)) : row.premium.policy_count > 0 ? null : 0;
}
export function formatModeValue(value: number | null, mode: RegionalMode): string {
  if (value === null) return "—";
  return mode === "ap" ? formatPremium(value / 100) : value.toLocaleString("en-US");
}
export const modeUnit = (mode: RegionalMode, n: number) =>
  mode === "calls_made" ? (n === 1 ? "call made" : "calls made") : mode === "contacted_calls" ? (n === 1 ? "contacted call" : "contacted calls")
    : mode === "policies_sold" ? (n === 1 ? "policy sold" : "policies sold") : "AP";
