/**
 * Appointment ownership — the ONE rule every appointment writer and reader applies.
 *
 *   appointments.user_id    = the person RESPONSIBLE for the appointment (and the personal-reminder recipient)
 *   appointments.created_by = the person who SCHEDULED it — stamped on insert, never rewritten afterwards
 *
 * `user_id` is authoritative whenever populated. `created_by` is a compatibility fallback only when
 * `user_id IS NULL` (FloatingDialer quick-call callbacks write `created_by` alone) — AGENT_RULES #22, the
 * same predicate `dashboard-callbacks.ts#ownershipOrExpression` sends to PostgREST. `created_by` must never
 * rescue a row whose `user_id` belongs to someone else.
 *
 * Pure: no React, no Supabase.
 */

/** Statuses in which an appointment is still pending — the modal's non-terminal set. */
export const OPEN_APPOINTMENT_STATUSES = ["Scheduled", "Confirmed"] as const;

const OPEN_STATUS_KEYS = new Set(OPEN_APPOINTMENT_STATUSES.map((s) => s.toLowerCase()));

/**
 * True only for an open status. Reads the RAW database value: `appointments.status` has no CHECK
 * constraint, and the calendar mapper coerces unknown values (e.g. a lowercase `cancelled`) to
 * "Scheduled" for display, so a check on the mapped value could treat a cancelled row as open.
 */
export function isOpenAppointmentStatus(status: unknown): boolean {
  if (typeof status !== "string") return false;
  return OPEN_STATUS_KEYS.has(status.trim().toLowerCase());
}

function nonEmptyId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** The responsible user: `user_id` when populated, else `created_by` (invariant #22), else null. */
export function appointmentResponsibleUserId(row: {
  user_id?: string | null;
  created_by?: string | null;
} | null | undefined): string | null {
  if (!row) return null;
  return nonEmptyId(row.user_id) ?? nonEmptyId(row.created_by);
}

/** Whether `uid` is the responsible user. Always false for an empty viewer id. */
export function isAppointmentResponsibleUser(
  row: { user_id?: string | null; created_by?: string | null } | null | undefined,
  uid: string | null | undefined,
): boolean {
  const viewer = nonEmptyId(uid);
  if (!viewer) return false;
  return appointmentResponsibleUserId(row) === viewer;
}

/** An explicit, non-empty assignee always wins; otherwise the fallback. Never rewrites an explicit value. */
export function resolveAppointmentAssignee(explicit: unknown, fallbackUserId: string): string {
  return nonEmptyId(explicit) ?? fallbackUserId;
}

/**
 * Insert-only ownership stamp. `created_by` is the authenticated creator by definition — RLS
 * `appointments_insert` admits a row for someone else precisely through `created_by = auth.uid()`,
 * which also keeps the row readable to its scheduler for `.select().single()`.
 */
export function buildAppointmentInsertOwnership(args: {
  explicitAssigneeId: unknown;
  creatorUserId: string;
  organizationId: string;
}): { user_id: string; created_by: string; organization_id: string } {
  return {
    user_id: resolveAppointmentAssignee(args.explicitAssigneeId, args.creatorUserId),
    created_by: args.creatorUserId,
    organization_id: args.organizationId,
  };
}
