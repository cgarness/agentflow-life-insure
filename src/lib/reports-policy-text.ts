/**
 * reports-policy-text.ts — the ONE wording for how Reports counts policies (plan §20 rev 2), shared by
 * the on-screen notes and the CSV metadata so the two can never describe different rules.
 *
 * Policies Sold = normalized STORED policies (evidence-based primary policies on client records plus
 * valid additional policies), counted on each policy's sale date. Never wins.
 */
import type { ReportPolicyQuality } from "@/lib/reports-schemas";
import { formatCount } from "@/lib/reports-format";

export const POLICY_SOURCE_NOTE =
  "Policies are stored client policies (primary and additional), counted on each policy's sale date.";

export const CURRENT_ASSIGNMENT_NOTE =
  "Agent policy counts and premiums use the client's current assigned agent, not the original seller; a reassigned client moves its policies.";

export const CAMPAIGN_LINEAGE_NOTE =
  "Campaign-attributed policies use conversion lineage only: not complete campaign sales attribution and not proof the campaign caused the sale.";

export const CAMPAIGN_VISIBILITY_NOTE =
  "Campaign breakdowns include only campaigns this viewer may read; unavailable attribution is non-identifying.";

/** The CSV note: exactly the two sentences above joined by one space (byte-identical to the original). */
export const CAMPAIGN_ATTRIBUTION_NOTE = `${CAMPAIGN_LINEAGE_NOTE} ${CAMPAIGN_VISIBILITY_NOTE}`;

// Data basis sentences (screen only; the CSV note builders below never use them).
export const POLICY_SEVERAL_PER_CLIENT_NOTE = "One client can hold several policies.";
export const POLICY_ISSUE_DATE_NOTE = "Older additional policies with no sold-date field are dated by their issue date.";
export const POLICY_UNDATED_NOTE = "A policy without a readable sale date is not counted in any period.";
export const LEADERBOARD_CREDIT_NOTE =
  "The Leaderboard instead credits each original sale event to its original seller on the event date, so its totals can differ.";

function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/**
 * The data-quality note, or null when there is nothing to report. The counts are SCOPE-WIDE and
 * ALL-TIME: an undated policy cannot be placed in any period, so it is never implied to belong to this one.
 */
export function policyQualityNote(q: ReportPolicyQuality): string | null {
  const parts: string[] = [];
  if (q.undated_policies > 0) {
    parts.push(`${plural(q.undated_policies, "policy has", "policies have")} no usable sale date and ${q.undated_policies === 1 ? "is" : "are"} not counted in any period`);
  }
  if (q.malformed_additional_policies > 0) {
    parts.push(`${plural(q.malformed_additional_policies, "additional-policy record", "additional-policy records")} could not be read`);
  }
  if (parts.length === 0) return null;
  return `Data quality across this scope, all dates (not only this period): ${parts.join("; ")}.`;
}

/**
 * CSV metadata notes for a panel's export: every export that carries policy numbers states how they
 * were counted and credited. Panels without policy fields get none.
 */
export function policyExportNotes(panel: string, data: object): string[] {
  const quality =
    "policy_quality" in data ? policyQualityNote((data as { policy_quality: ReportPolicyQuality }).policy_quality) : null;
  const withQuality = (notes: string[]) => (quality ? [...notes, quality] : notes);
  switch (panel) {
    case "summary":
      return withQuality([POLICY_SOURCE_NOTE, CURRENT_ASSIGNMENT_NOTE]);
    case "volume":
      return withQuality([POLICY_SOURCE_NOTE]);
    case "campaigns":
      return [POLICY_SOURCE_NOTE, CAMPAIGN_ATTRIBUTION_NOTE];
    default:
      return [];
  }
}
