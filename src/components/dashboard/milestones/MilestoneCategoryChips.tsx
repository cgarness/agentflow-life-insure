import React from "react";
import { countByKind, type Milestone, type MilestoneKind } from "@/lib/dashboard-milestones";
import { DashboardFilterChips, type FilterChip } from "@/components/dashboard/ui/DashboardFilterChips";
import { MILESTONE_KINDS } from "@/components/dashboard/milestones/milestoneCopy";

export type MilestoneCategoryFilter = "all" | MilestoneKind;

/**
 * All · Birthdays · Anniversaries · First payments, with counts of `items`. When the
 * client read was incomplete the counts are lower bounds and read "N+" (R4).
 * First payments are listed only when that category is on.
 */
export const MilestoneCategoryChips: React.FC<{
  items: Milestone[];
  value: MilestoneCategoryFilter;
  onChange: (value: MilestoneCategoryFilter) => void;
  complete: boolean;
  firstPaymentsOn: boolean;
}> = ({ items, value, onChange, complete, firstPaymentsOn }) => {
  const counts = countByKind(items);
  const show = (n: number) => (complete ? n : `${n}+`);
  const kinds: MilestoneKind[] = ["client_birthday", "policy_anniversary", ...(firstPaymentsOn ? ["first_payment" as const] : [])];
  const chips: FilterChip<MilestoneCategoryFilter>[] = [
    { id: "all", label: "All", count: show(items.length) },
    ...kinds.map((kind) => ({ id: kind, label: MILESTONE_KINDS[kind].plural, icon: MILESTONE_KINDS[kind].icon, count: show(counts[kind]) })),
  ];
  return <DashboardFilterChips<MilestoneCategoryFilter> label="Milestone category" chips={chips} value={value} onChange={onChange} />;
};
