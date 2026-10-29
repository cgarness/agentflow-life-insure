/**
 * Client Milestones data access (plan §6.5–§6.6, rev 1).
 *
 * Reads: the viewer's scoped `clients` (never `leads`) and, once reviews are live (G2),
 * the viewer's own `dashboard_milestone_reviews` rows. Both read completely or say they
 * did not (`paged-exact-read`), and run under one cancellation that settles only after
 * every read has (invariant #22: no bare `Promise.all` inside a section lane).
 *
 * Writes: only the two review RPCs. They derive the user and organization server-side
 * and never touch a client, policy, payment, task or notification record.
 */
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { addCalendarDays, localCalendarDate, localCalendarDateOfTimestamp, type CalendarDate } from "@/lib/calendar-date";
import { assertValidUserId, DashboardQueryError } from "@/lib/dashboard-contact-identity";
import {
  computeMilestones,
  type Milestone,
  type MilestoneClientRow,
  type MilestoneKind,
  type MilestoneReviewRow,
} from "@/lib/dashboard-milestones";
import type { MilestoneConfig } from "@/lib/dashboard-milestones-config";
import { startOfLocalDayPlus } from "@/lib/local-calendar";
import { assertPageActive } from "@/lib/pageActivity";
import { readAllExact, type ExactReadResult } from "@/lib/paged-exact-read";
import { linkedAbort, settleAll } from "@/lib/requestLifetime";

/** Most clients one milestone load reads (D14). Beyond this the result says it is incomplete. */
export const MILESTONE_CLIENT_CAP = 5000;

export const MILESTONE_CLIENT_COLUMNS =
  "id, first_name, last_name, phone, created_at, date_of_birth, effective_date, draft_date, primary_policy_id, " +
  "policy_type, carrier, policy_number, premium, face_amount, sold_date, custom_fields, assigned_agent_id";

const REVIEW_COLUMNS = "id, milestone_kind, client_id, event_key, occurrence_year, occurrence_date, state, remind_at, updated_at";

const KINDS = ["client_birthday", "policy_anniversary", "first_payment"] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), "timestamp");

const reviewRowSchema = z.object({
  id: z.string().uuid(),
  milestone_kind: z.enum(KINDS),
  client_id: z.string().uuid(),
  event_key: z.string().min(1),
  occurrence_year: z.number().int(),
  occurrence_date: isoDate,
  state: z.enum(["reviewed", "snoozed"]),
  remind_at: timestamp.nullable(),
  updated_at: timestamp,
});

export interface MilestoneScope {
  userId: string;
  organizationId: string | null;
  /** Own clients only (`assigned_agent_id = userId`); the list rule in `dashboard-scope`. */
  isFiltered: boolean;
}

export interface MilestoneLoad {
  items: Milestone[];
  malformedPolicyClients: number;
  /** False when not every scoped client could be read (cap or unknown count). */
  complete: boolean;
  clientsLoaded: number;
  /** The server's exact count of scoped clients, when known. */
  clientsTotal: number | null;
}

async function readClients(scope: MilestoneScope, organizationId: string, signal: AbortSignal) {
  return readAllExact<MilestoneClientRow>(
    (afterId, limit, withCount) => {
      let q = supabase
        .from("clients")
        .select(MILESTONE_CLIENT_COLUMNS, withCount ? { count: "exact" } : undefined)
        .eq("organization_id", organizationId);
      if (scope.isFiltered) q = q.eq("assigned_agent_id", scope.userId);
      if (afterId) q = q.gt("id", afterId);
      return q.order("id", { ascending: true }).limit(limit).abortSignal(signal) as unknown as PromiseLike<{
        data: MilestoneClientRow[] | null;
        error: unknown;
        count?: number | null;
      }>;
    },
    { context: "milestone-clients", cap: MILESTONE_CLIENT_CAP, beforeFollowOn: assertPageActive },
  );
}

async function readReviews(scope: MilestoneScope, organizationId: string, today: CalendarDate, signal: AbortSignal) {
  // Annual rows from the last year (follow-ups included) and every one-time first-payment row.
  const since = addCalendarDays(today, -366);
  const result = await readAllExact<MilestoneReviewRow>(
    (afterId, limit, withCount) => {
      let q = supabase
        .from("dashboard_milestone_reviews")
        .select(REVIEW_COLUMNS, withCount ? { count: "exact" } : undefined)
        .eq("user_id", scope.userId)
        .eq("organization_id", organizationId)
        .or(`milestone_kind.eq.first_payment,occurrence_date.gte.${since}`);
      if (afterId) q = q.gt("id", afterId);
      return q.order("id", { ascending: true }).limit(limit).abortSignal(signal) as unknown as PromiseLike<{
        data: MilestoneReviewRow[] | null;
        error: unknown;
        count?: number | null;
      }>;
    },
    { context: "milestone-reviews", beforeFollowOn: assertPageActive },
  );
  const rows = z.array(reviewRowSchema).safeParse(result.rows);
  if (!rows.success) throw new DashboardQueryError("milestone-reviews-shape", rows.error);
  return { ...result, rows: rows.data as MilestoneReviewRow[] };
}

/**
 * One complete milestone load for a scope; throws on any failed read.
 * `anniversaryWindowDays` is 30 for the widget and 90 for the detail view.
 */
export async function loadClientMilestones(
  scope: MilestoneScope,
  config: MilestoneConfig,
  anniversaryWindowDays: number,
  signal: AbortSignal,
  now: Date = new Date(),
): Promise<MilestoneLoad> {
  const userId = assertValidUserId(scope.userId);
  // Fail closed: without the viewer's organization there is no tenant to read.
  if (!scope.organizationId) throw new DashboardQueryError("milestone-organization", new Error("No organization"));
  const organizationId = scope.organizationId;
  const today = localCalendarDate(now);

  const cancel = linkedAbort(signal);
  try {
    const reads = [
      readClients({ ...scope, userId }, organizationId, cancel.signal),
      config.reviewsEnabled
        ? readReviews({ ...scope, userId }, organizationId, today, cancel.signal)
        : Promise.resolve<ExactReadResult<MilestoneReviewRow> | null>(null),
    ] as const;
    const [clients, reviews] = await settleAll(reads, cancel.abort);

    const { items, malformedPolicyClients } = computeMilestones(clients.rows, {
      today,
      now,
      anniversaryWindowDays,
      reviews: reviews ? reviews.rows : null,
      firstPaymentStart: config.firstPaymentStart,
      localDateOf: localCalendarDateOfTimestamp,
    });
    return {
      items,
      malformedPolicyClients,
      // An incomplete review read could show a reviewed reminder as pending: also incomplete.
      complete: clients.complete && (reviews === null || reviews.complete),
      clientsLoaded: clients.rows.length,
      clientsTotal: clients.total,
    };
  } finally {
    cancel.dispose();
  }
}

// ---- review actions -------------------------------------------------------------------

export const REMIND_LATER_OPTIONS = [
  { id: "tomorrow", label: "Tomorrow", days: 1 },
  { id: "three_days", label: "In 3 days", days: 3 },
  { id: "next_week", label: "Next week", days: 7 },
] as const;
export type RemindLaterOption = (typeof REMIND_LATER_OPTIONS)[number]["id"];

/** Local start of the day 1, 3 or 7 calendar days ahead (DST-safe). */
export function remindAtFor(option: RemindLaterOption, now: Date = new Date()): Date {
  const choice = REMIND_LATER_OPTIONS.find((item) => item.id === option);
  if (!choice) throw new Error(`Unknown reminder option: ${option}`);
  return startOfLocalDayPlus(now, choice.days);
}

/** A user-safe action failure; the raw cause is for the console only. */
export class MilestoneActionError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "MilestoneActionError";
    this.cause = cause;
  }
}

const setReviewSchema = z
  .object({
    kind: z.enum(KINDS),
    clientId: z.string().uuid(),
    eventKey: z.string().min(1).max(64),
    occurrenceDate: isoDate,
    state: z.enum(["reviewed", "snoozed"]),
    remindAt: z.string().datetime({ offset: true }).nullable(),
  })
  .refine((v) => (v.state === "snoozed") === (v.remindAt !== null), "A reminder time is required only for Remind Later");

export type SetMilestoneReviewInput = z.infer<typeof setReviewSchema>;

/** The review input for one milestone and action, or `null` when it cannot be reviewed. */
export function reviewInputFor(item: Milestone, action: { state: "reviewed" } | { state: "snoozed"; remindAt: Date }) {
  if (item.eventKey === null) return null;
  return {
    kind: item.kind as MilestoneKind,
    clientId: item.clientId,
    eventKey: item.eventKey,
    occurrenceDate: item.occurrenceDate,
    state: action.state,
    remindAt: action.state === "snoozed" ? action.remindAt.toISOString() : null,
  } satisfies SetMilestoneReviewInput;
}

/** Mark Reviewed / Remind Later. Resolves only with the row the server stored. */
export async function setMilestoneReview(input: SetMilestoneReviewInput): Promise<MilestoneReviewRow> {
  const parsed = setReviewSchema.safeParse(input);
  if (!parsed.success) throw new MilestoneActionError("This reminder can't be updated.", parsed.error);
  const v = parsed.data;
  const { data, error } = await supabase.rpc("set_dashboard_milestone_review", {
    p_kind: v.kind,
    p_client_id: v.clientId,
    p_event_key: v.eventKey,
    p_occurrence_date: v.occurrenceDate,
    p_state: v.state,
    p_remind_at: v.remindAt ?? undefined,
  });
  if (error) {
    console.error("[ClientMilestones] Review update failed:", error);
    throw new MilestoneActionError("Couldn't update this reminder. Please try again.", error);
  }
  const row = reviewRowSchema.safeParse(Array.isArray(data) ? data[0] : data);
  // Nothing stored is a failure, never a reported success.
  if (!row.success) throw new MilestoneActionError("Couldn't update this reminder. Please try again.", row.error);
  return row.data as MilestoneReviewRow;
}

/** Undo / Restore: removes the viewer's row only if it is still exactly what the action stored. */
export async function clearMilestoneReview(review: { id: string; updatedAt: string }): Promise<void> {
  const parsed = z.object({ id: z.string().uuid(), updatedAt: timestamp }).safeParse(review);
  if (!parsed.success) throw new MilestoneActionError("This reminder can't be restored.", parsed.error);
  const { data, error } = await supabase.rpc("clear_dashboard_milestone_review", {
    p_id: parsed.data.id,
    p_expected_updated_at: parsed.data.updatedAt,
  });
  if (error) {
    console.error("[ClientMilestones] Review restore failed:", error);
    throw new MilestoneActionError("Couldn't restore this reminder. Please try again.", error);
  }
  if (data !== true) {
    throw new MilestoneActionError("This reminder changed since then. Refresh to see its current state.");
  }
}
