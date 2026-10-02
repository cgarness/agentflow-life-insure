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
  "Agent policy counts use the client's current assigned agent, not the original seller; a reassigned client moves its policies.";

export const CAMPAIGN_ATTRIBUTION_NOTE =
  "Campaign-attributed policies use conversion lineage only: not complete campaign sales attribution and not proof the campaign caused the sale. Campaign breakdowns include only campaigns this viewer may read; unavailable attribution is non-identifying.";

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
