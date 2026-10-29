import { Cake, CalendarHeart, Wallet } from "lucide-react";
import { shortCalendarLabel } from "@/lib/calendar-date";
import type { Milestone, MilestoneKind } from "@/lib/dashboard-milestones";

/**
 * Client Milestone wording (plan §6.1). An anniversary is never called a renewal or
 * an expiration; a first payment reminder never says paid, missed, failed or late.
 */
export const MILESTONE_KINDS: Record<MilestoneKind, { label: string; plural: string; icon: React.ElementType }> = {
  client_birthday: { label: "Birthday", plural: "Birthdays", icon: Cake },
  policy_anniversary: { label: "Policy anniversary", plural: "Anniversaries", icon: CalendarHeart },
  first_payment: { label: "First payment", plural: "First payments", icon: Wallet },
};

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** "Today", "Tomorrow", "In 5 days", "2 days ago". */
export function relativeDayLabel(daysUntil: number): string {
  if (daysUntil === 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  if (daysUntil > 1) return `In ${days(daysUntil)}`;
  return `${days(-daysUntil)} ago`;
}

/** The line under the client's name. */
export function milestoneDescription(item: Milestone): string {
  const date = shortCalendarLabel(item.occurrenceDate);
  const policy = [item.policyType, item.carrier].filter(Boolean).join(" · ");
  switch (item.kind) {
    case "client_birthday": {
      const age = item.age && item.age > 0 ? ` · turns ${item.age}` : "";
      return item.followUp ? `Follow-up · birthday was ${date}` : `Birthday · ${date}${age}`;
    }
    case "policy_anniversary": {
      const what = `${item.policyYears}-year policy anniversary`;
      const base = item.followUp ? `Follow-up · ${what} was ${date}` : `${what} · ${date}`;
      return policy ? `${base} · ${policy}` : base;
    }
    case "first_payment":
      if (item.daysUntil > 0) return `First draft in ${days(item.daysUntil)} · ${date}`;
      if (item.daysUntil === 0) return `First draft today · ${date}`;
      return `Draft date was ${date} · not yet reviewed`;
  }
}

/** The status pill text. "Dismissed" is the stored `reviewed` state (Polish V2 plan §3.2). */
export function milestoneStatusLabel(item: Milestone): string {
  if (item.status === "reviewed") {
    const at = item.reviewUpdatedAt ? new Date(item.reviewUpdatedAt) : null;
    return at && !Number.isNaN(at.getTime())
      ? `Dismissed ${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : "Dismissed";
  }
  if (item.status === "snoozed") {
    const at = item.remindAt ? new Date(item.remindAt) : null;
    return at && !Number.isNaN(at.getTime())
      ? `Reminds you ${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : "Snoozed";
  }
  if (item.followUp) return "Follow-up";
  if (item.kind === "first_payment" && item.daysUntil < 0) return "Needs review";
  return relativeDayLabel(item.daysUntil);
}

/** The incomplete-read disclosure (R4); `null` when every scoped client was read. */
export function milestoneCompletenessNote(load: { complete: boolean; clientsLoaded: number; clientsTotal: number | null }): string | null {
  if (load.complete) return null;
  const of = load.clientsTotal !== null ? ` of ${load.clientsTotal.toLocaleString()}` : "";
  return `Milestones from the first ${load.clientsLoaded.toLocaleString()}${of} clients. Some milestones may be missing.`;
}
