/**
 * policy-type-slices — the DETERMINISTIC grouping behind the policy-type donut.
 *
 * The rule, stated once and testable on its own:
 *
 *   1. Order by policy count descending, then monthly premium, then label. Total ordering, so the
 *      same book always produces the same chart.
 *   2. Show the top `POLICY_TYPE_TOP_N` individually.
 *   3. Sum everything beyond them into ONE "Other" slice, and report how many types that is.
 *   4. Add any SERVER-SIDE overflow into that same "Other" slice, so the legend always sums to the
 *      policy total and truncation is never silent.
 *   5. A stored value that was BLANK becomes its own "Not specified" slice. That is a different
 *      fact from "Other" — it means the policy type was left empty on those records — and hiding it
 *      inside "Other" would erase a real data-quality signal.
 *
 * Policy types are NEVER hardcoded. Whatever the organization stores is what is displayed.
 */

import type { PolicyTypeRow } from "@/lib/profile/profile-queries";

/** How many types are shown individually before the remainder rolls into "Other". */
export const POLICY_TYPE_TOP_N = 6;
export const NOT_SPECIFIED_LABEL = "Not specified";
export const OTHER_LABEL = "Other";

/**
 * The only fully tokenized categorical palette in the repo (CampaignDetail.tsx:1110-1114), minus
 * its `--accent` entry, which is near-invisible as a fill in both themes. Every value resolves per
 * theme, so the donut is legible in light and dark with no second palette to maintain.
 */
export const SLICE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--info))",
  "hsl(var(--destructive))",
  "hsl(var(--muted-foreground))",
  "hsl(var(--secondary-foreground))",
];

export interface PolicyTypeSlice {
  label: string;
  policies: number;
  premiumMonthly: number;
  color: string;
  /** True for the derived "Other" and "Not specified" slices, which render in a muted italic. */
  isSynthetic: boolean;
}

export interface PolicyTypeSlices {
  slices: PolicyTypeSlice[];
  /** How many distinct types were folded into "Other". 0 when nothing was folded. */
  groupedTypeCount: number;
}

export function buildPolicyTypeSlices(
  rows: PolicyTypeRow[],
  overflowPolicies: number,
): PolicyTypeSlices {
  const sorted = [...rows].sort(
    (a, b) =>
      b.policies - a.policies ||
      b.premiumMonthly - a.premiumMonthly ||
      (a.policyType ?? "").localeCompare(b.policyType ?? ""),
  );

  const head = sorted.slice(0, POLICY_TYPE_TOP_N);
  const tail = sorted.slice(POLICY_TYPE_TOP_N);

  const slices: PolicyTypeSlice[] = head.map((row, i) => ({
    label: row.policyType ?? NOT_SPECIFIED_LABEL,
    policies: row.policies,
    premiumMonthly: row.premiumMonthly,
    color: SLICE_COLORS[i % SLICE_COLORS.length],
    isSynthetic: row.policyType === null,
  }));

  const tailPolicies = tail.reduce((sum, r) => sum + r.policies, 0) + overflowPolicies;
  const tailPremium = tail.reduce((sum, r) => sum + r.premiumMonthly, 0);

  if (tailPolicies > 0) {
    slices.push({
      label: OTHER_LABEL,
      policies: tailPolicies,
      premiumMonthly: tailPremium,
      color: SLICE_COLORS[POLICY_TYPE_TOP_N % SLICE_COLORS.length],
      isSynthetic: true,
    });
  }

  return { slices, groupedTypeCount: tail.length };
}
