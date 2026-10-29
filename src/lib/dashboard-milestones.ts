/**
 * dashboard-milestones — the ONE definition of a Client Milestone (plan §6, rev 1).
 *
 * Pure: no React, no Supabase, no clock. `today` and `now` are arguments, so every
 * rule is testable in any time zone.
 *
 *  - CLIENT BIRTHDAYS: `clients.date_of_birth` only (leads are never read), annual,
 *    shown today … +14 days.
 *  - POLICY ANNIVERSARIES: every policy of the existing normalized model (primary +
 *    additional) with an Effective Date, annual from the 1-year anniversary on, shown
 *    today … +30 days (Dashboard) or +90 days (detail). Never called a renewal or an
 *    expiration.
 *  - FIRST PAYMENT REMINDERS: the client Draft Date, one-time, shown from 3 days before
 *    and pending until reviewed. Never inferred as paid, missed or failed, never
 *    created for a historical Draft Date, and never derived for additional policies.
 *
 * A review row is per user + organization + event + occurrence year. It only matches
 * the occurrence whose date it recorded, so an edited date makes the item pending again.
 */
import {
  addCalendarDays,
  daysBetween,
  formatCalendarDate,
  observedDate,
  parseCalendarDate,
  type CalendarDate,
} from "@/lib/calendar-date";
import { getClientPolicyDisplay } from "@/lib/client-policy-display";
import type { Client } from "@/lib/types";
import { parseDOB } from "@/utils/dobUtils";

export type MilestoneKind = "client_birthday" | "policy_anniversary" | "first_payment";
export type MilestoneStatus = "pending" | "snoozed" | "reviewed";

export const BIRTHDAY_WINDOW_DAYS = 14;
export const ANNIVERSARY_WIDGET_WINDOW_DAYS = 30;
export const ANNIVERSARY_DETAIL_WINDOW_DAYS = 90;
export const FIRST_PAYMENT_LEAD_DAYS = 3;
/** A reviewed first payment stays listed under "Reviewed" in the detail view this long. */
export const REVIEWED_FIRST_PAYMENT_LISTING_DAYS = 30;

export const BIRTHDAY_EVENT_KEY = "birthday";
export const FIRST_PAYMENT_EVENT_KEY = "first_payment";
export const PRIMARY_POLICY_EVENT_KEY = "primary";

/** The `clients` columns milestones read. */
export interface MilestoneClientRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string | null;
  date_of_birth: string | null;
  effective_date: string | null;
  draft_date: string | null;
  primary_policy_id: string | null;
  policy_type: string | null;
  carrier: string | null;
  policy_number: string | null;
  premium: number | string | null;
  face_amount: number | string | null;
  sold_date: string | null;
  custom_fields: unknown;
  /** The client's assigned agent (Team-mode label only; scope is decided by the read). */
  assigned_agent_id?: string | null;
}

/** One `dashboard_milestone_reviews` row (the viewer's own). */
export interface MilestoneReviewRow {
  id: string;
  milestone_kind: MilestoneKind;
  client_id: string;
  event_key: string;
  occurrence_year: number;
  occurrence_date: CalendarDate;
  state: "reviewed" | "snoozed";
  remind_at: string | null;
  updated_at: string;
}

export interface Milestone {
  /** Render identity: kind, client, event and occurrence. */
  key: string;
  kind: MilestoneKind;
  clientId: string;
  clientName: string;
  phone: string;
  /** `null` when this event has no stored identity, so it cannot be reviewed. */
  eventKey: string | null;
  occurrenceDate: CalendarDate;
  occurrenceYear: number;
  /** Calendar days from today; negative once the date has passed. */
  daysUntil: number;
  status: MilestoneStatus;
  /** A past birthday/anniversary brought back by Remind Later (R3). */
  followUp: boolean;
  reviewId: string | null;
  reviewUpdatedAt: string | null;
  remindAt: string | null;
  /** Birthday: the age reached on this birthday, when the birth year is known. */
  age: number | null;
  /** Anniversary: whole policy years reached. */
  policyYears: number | null;
  policyType: string | null;
  carrier: string | null;
  /** Why review actions are unavailable, or `null`. */
  actionBlockedReason: string | null;
  /** The client's assigned agent, for the Team-mode label (presentation only). */
  assignedAgentId?: string | null;
}

export interface MilestoneOptions {
  today: CalendarDate;
  now: Date;
  anniversaryWindowDays: number;
  /** `null`: reviews are off (G2 not live) — no review state, no First Payment Reminders. */
  reviews: MilestoneReviewRow[] | null;
  /** Go-live date for First Payment Reminders; `null` turns the category off. */
  firstPaymentStart: CalendarDate | null;
  /** Local calendar date of a stored timestamp (the client's creation). */
  localDateOf: (timestamp: string) => CalendarDate | null;
}

export interface MilestoneResult {
  items: Milestone[];
  /** Clients whose additional-policy data could not be read as policies. */
  malformedPolicyClients: number;
}

const NO_IDENTITY_REASON = "This policy has no saved identity yet, so it can't be marked reviewed here.";
const KIND_ORDER: Record<MilestoneKind, number> = { first_payment: 0, policy_anniversary: 1, client_birthday: 2 };

function clientName(row: MilestoneClientRow): string {
  return [row.first_name, row.last_name].map((part) => (part ?? "").trim()).filter(Boolean).join(" ") || "Unnamed client";
}

/** The first observed occurrence on or after `today`, never earlier than `minYear`. */
function nextOccurrence(month: number, day: number, today: CalendarDate, minYear: number): CalendarDate {
  const todayYear = parseCalendarDate(today)!.year;
  let year = Math.max(todayYear, minYear);
  let candidate = observedDate(year, month, day);
  if (candidate < today) {
    year += 1;
    candidate = observedDate(year, month, day);
  }
  return candidate;
}

interface AnnualEvent {
  kind: Exclude<MilestoneKind, "first_payment">;
  client: MilestoneClientRow;
  eventKey: string | null;
  month: number;
  day: number;
  /** Birth year or policy effective year. */
  originYear: number;
  /** The earliest year that is an occurrence (a birthday: the year after birth; an anniversary: year 1). */
  minYear: number;
  windowDays: number;
  policyType: string | null;
  carrier: string | null;
}

function annualEvents(row: MilestoneClientRow, opts: MilestoneOptions): { events: AnnualEvent[]; malformed: boolean } {
  const events: AnnualEvent[] = [];
  const dob = parseCalendarDate(parseDOB(row.date_of_birth));
  if (dob && formatCalendarDate(dob) <= opts.today) {
    events.push({
      kind: "client_birthday", client: row, eventKey: BIRTHDAY_EVENT_KEY, month: dob.month, day: dob.day,
      originYear: dob.year, minYear: dob.year + 1, windowDays: BIRTHDAY_WINDOW_DAYS, policyType: null, carrier: null,
    });
  }

  // The existing normalized policy model: primary only with policy evidence, plus every additional entry.
  const display = getClientPolicyDisplay({
    id: row.id,
    primaryPolicyId: row.primary_policy_id,
    policyType: (row.policy_type ?? undefined) as Client["policyType"],
    carrier: row.carrier ?? undefined,
    policyNumber: row.policy_number ?? undefined,
    premiumAmount: row.premium === null || row.premium === undefined ? undefined : String(row.premium),
    faceAmount: row.face_amount === null || row.face_amount === undefined ? undefined : String(row.face_amount),
    soldDate: row.sold_date ?? undefined,
    effectiveDate: row.effective_date ?? undefined,
    customFields: (row.custom_fields ?? undefined) as Record<string, unknown> | undefined,
  });
  for (const policy of display.policies) {
    const effective = parseCalendarDate(policy.effectiveDate);
    if (!effective) continue;
    const eventKey = policy.policyId ?? (policy.source === "primary" ? PRIMARY_POLICY_EVENT_KEY : null);
    events.push({
      kind: "policy_anniversary", client: row, eventKey, month: effective.month, day: effective.day,
      originYear: effective.year, minYear: effective.year + 1, windowDays: opts.anniversaryWindowDays,
      policyType: policy.policyType, carrier: policy.carrier,
    });
  }
  return { events, malformed: display.malformedAdditionalPolicies > 0 };
}

function reviewIndex(reviews: MilestoneReviewRow[] | null) {
  const annual = new Map<string, MilestoneReviewRow>();
  const firstPayment = new Map<string, MilestoneReviewRow>();
  /** Snoozed annual reviews per client: the candidates for a follow-up. */
  const snoozedByClient = new Map<string, MilestoneReviewRow[]>();
  for (const review of reviews ?? []) {
    if (review.milestone_kind === "first_payment") {
      firstPayment.set(review.client_id, review);
      continue;
    }
    annual.set(`${review.milestone_kind}|${review.client_id}|${review.event_key}|${review.occurrence_year}`, review);
    if (review.state === "snoozed") {
      const list = snoozedByClient.get(review.client_id) ?? [];
      list.push(review);
      snoozedByClient.set(review.client_id, list);
    }
  }
  return { annual, firstPayment, snoozedByClient };
}

function statusOf(review: MilestoneReviewRow | undefined, now: Date): MilestoneStatus {
  if (!review) return "pending";
  if (review.state === "reviewed") return "reviewed";
  const remindAt = review.remind_at ? new Date(review.remind_at) : null;
  // A snooze whose time has come (or cannot be read) is pending again.
  return remindAt && !Number.isNaN(remindAt.getTime()) && remindAt > now ? "snoozed" : "pending";
}

function annualMilestone(
  event: AnnualEvent,
  occurrenceDate: CalendarDate,
  review: MilestoneReviewRow | undefined,
  opts: MilestoneOptions,
  followUp: boolean,
): Milestone {
  const occurrenceYear = parseCalendarDate(occurrenceDate)!.year;
  const status = opts.reviews === null ? "pending" : statusOf(review, opts.now);
  return {
    key: `${event.kind}:${event.client.id}:${event.eventKey ?? "unidentified"}:${occurrenceDate}`,
    kind: event.kind,
    clientId: event.client.id,
    clientName: clientName(event.client),
    phone: event.client.phone ?? "",
    eventKey: event.eventKey,
    occurrenceDate,
    occurrenceYear,
    daysUntil: daysBetween(opts.today, occurrenceDate),
    status,
    followUp,
    reviewId: review?.id ?? null,
    reviewUpdatedAt: review?.updated_at ?? null,
    remindAt: review?.state === "snoozed" ? review.remind_at : null,
    age: event.kind === "client_birthday" ? occurrenceYear - event.originYear : null,
    policyYears: event.kind === "policy_anniversary" ? occurrenceYear - event.originYear : null,
    policyType: event.policyType,
    carrier: event.carrier,
    actionBlockedReason: event.eventKey === null ? NO_IDENTITY_REASON : null,
    assignedAgentId: event.client.assigned_agent_id ?? null,
  };
}

function firstPaymentMilestone(row: MilestoneClientRow, opts: MilestoneOptions, review: MilestoneReviewRow | undefined): Milestone | null {
  if (opts.reviews === null || opts.firstPaymentStart === null) return null;
  const draft = row.draft_date?.trim() ?? "";
  if (!parseCalendarDate(draft)) return null;
  // Historical at go-live: a Draft Date before the reminders start date never becomes a reminder.
  if (draft < opts.firstPaymentStart) return null;
  // Historical at entry: the Draft Date had already passed when the client was recorded.
  const created = row.created_at ? opts.localDateOf(row.created_at) : null;
  if (!created || draft < created) return null;
  // Shown from 3 days before the Draft Date; afterwards pending until reviewed.
  if (opts.today < addCalendarDays(draft, -FIRST_PAYMENT_LEAD_DAYS)) return null;

  const status = statusOf(review, opts.now);
  if (status === "reviewed") {
    const reviewedOn = opts.localDateOf(review!.updated_at);
    if (!reviewedOn || daysBetween(reviewedOn, opts.today) > REVIEWED_FIRST_PAYMENT_LISTING_DAYS) return null;
  }
  return {
    key: `first_payment:${row.id}`,
    kind: "first_payment",
    clientId: row.id,
    clientName: clientName(row),
    phone: row.phone ?? "",
    eventKey: FIRST_PAYMENT_EVENT_KEY,
    occurrenceDate: draft,
    occurrenceYear: parseCalendarDate(draft)!.year,
    daysUntil: daysBetween(opts.today, draft),
    status,
    followUp: false,
    reviewId: review?.id ?? null,
    reviewUpdatedAt: review?.updated_at ?? null,
    remindAt: review?.state === "snoozed" ? review.remind_at : null,
    age: null,
    policyYears: null,
    policyType: null,
    carrier: null,
    actionBlockedReason: null,
    assignedAgentId: row.assigned_agent_id ?? null,
  };
}

/** Pending first (by date, overdue-style past dates first), then snoozed, then reviewed. */
export function compareMilestones(a: Milestone, b: Milestone): number {
  const rank = (m: Milestone) => (m.status === "pending" ? 0 : m.status === "snoozed" ? 1 : 2);
  return (
    rank(a) - rank(b) ||
    a.daysUntil - b.daysUntil ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    a.clientName.localeCompare(b.clientName) ||
    a.key.localeCompare(b.key)
  );
}

export function computeMilestones(rows: MilestoneClientRow[], opts: MilestoneOptions): MilestoneResult {
  const { annual, firstPayment, snoozedByClient } = reviewIndex(opts.reviews);
  const items: Milestone[] = [];
  const seen = new Set<string>();
  let malformedPolicyClients = 0;
  const push = (item: Milestone) => {
    if (seen.has(item.key)) return;
    seen.add(item.key);
    items.push(item);
  };

  for (const row of rows) {
    const { events, malformed } = annualEvents(row, opts);
    if (malformed) malformedPolicyClients += 1;

    for (const event of events) {
      // Upcoming occurrence inside the category window.
      const upcoming = nextOccurrence(event.month, event.day, opts.today, event.minYear);
      if (daysBetween(opts.today, upcoming) <= event.windowDays) {
        const year = parseCalendarDate(upcoming)!.year;
        const review = annual.get(`${event.kind}|${row.id}|${event.eventKey}|${year}`);
        push(annualMilestone(event, upcoming, review?.occurrence_date === upcoming ? review : undefined, opts, false));
      }
    }
    // Follow-ups (R3): a snoozed past occurrence comes back at its reminder time, until reviewed.
    const snoozed = snoozedByClient.get(row.id) ?? [];
    if (snoozed.length > 0) {
      for (const event of events) {
        if (event.eventKey === null) continue;
        for (const review of snoozed) {
          if (review.milestone_kind !== event.kind || review.event_key !== event.eventKey) continue;
          if (review.occurrence_date >= opts.today || review.occurrence_year < event.minYear) continue;
          // Only the occurrence this event really has in that year (an edited date does not follow).
          if (observedDate(review.occurrence_year, event.month, event.day) !== review.occurrence_date) continue;
          push(annualMilestone(event, review.occurrence_date, review, opts, true));
        }
      }
    }

    const payment = firstPaymentMilestone(row, opts, firstPayment.get(row.id));
    if (payment) push(payment);
  }

  items.sort(compareMilestones);
  return { items, malformedPolicyClients };
}

/** Category counts of the given items. */
export function countByKind(items: Milestone[]): Record<MilestoneKind, number> {
  const counts: Record<MilestoneKind, number> = { client_birthday: 0, policy_anniversary: 0, first_payment: 0 };
  for (const item of items) counts[item.kind] += 1;
  return counts;
}
