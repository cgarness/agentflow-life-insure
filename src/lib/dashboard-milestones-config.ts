import { parseCalendarDate, type CalendarDate } from "@/lib/calendar-date";

/**
 * Client Milestones release switches (plan rev 1, §10).
 *
 * - `VITE_DASHBOARD_MILESTONE_REVIEWS=true` turns on Mark Reviewed / Remind Later / Undo.
 *   It may only be set once the `dashboard_milestone_reviews` migration (G2) is applied
 *   and read back; until then no review table is read and no action is rendered.
 * - `VITE_FIRST_PAYMENT_REMINDERS_START=YYYY-MM-DD` is the production go-live date.
 *   A Draft Date before it is historical and never becomes a reminder (R1).
 *
 * Both fail closed: First Payment Reminders exist only when reviews are on AND the
 * start date is a real calendar date, so a reminder that stays pending until reviewed
 * can never be shown without a way to review it.
 */
export interface MilestoneConfig {
  reviewsEnabled: boolean;
  /** `null` when First Payment Reminders are off. */
  firstPaymentStart: CalendarDate | null;
}

interface MilestoneEnv {
  VITE_DASHBOARD_MILESTONE_REVIEWS?: string;
  VITE_FIRST_PAYMENT_REMINDERS_START?: string;
}

export function parseMilestoneConfig(env: MilestoneEnv): MilestoneConfig {
  const reviewsEnabled = env.VITE_DASHBOARD_MILESTONE_REVIEWS === "true";
  const start = env.VITE_FIRST_PAYMENT_REMINDERS_START?.trim() ?? "";
  const firstPaymentStart = reviewsEnabled && parseCalendarDate(start) ? start : null;
  return { reviewsEnabled, firstPaymentStart };
}

export const MILESTONE_CONFIG: MilestoneConfig = parseMilestoneConfig(import.meta.env as MilestoneEnv);
