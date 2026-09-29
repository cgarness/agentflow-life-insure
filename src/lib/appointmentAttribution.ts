/**
 * "Appointments Set" credit — booking activity, attributed to the SCHEDULER (AGENT_RULES #23 / #38).
 *
 * - The person credited is `COALESCE(created_by, user_id)`: `created_by` (who set the appointment) is primary;
 *   `user_id` rescues only legacy / writer-gap rows whose `created_by IS NULL`. Exactly one person per row.
 * - Callers window on `appointments.created_at` (when it was booked), never on `start_time`.
 * - There is no status filter: the credit survives cancellation, no-show, reschedule and completion.
 *
 * Workload surfaces (the Dashboard schedule, reminders, the Follow-ups card) are different: they follow the
 * assignee, `user_id`, on the occurrence `start_time`.
 */
import { assertValidUserId } from "@/lib/dashboard-contact-identity";

/**
 * The PostgREST `.or()` expression for "appointments set by `userId`". `.or()` interpolates a RAW filter
 * string, so the id is UUID-validated first and an invalid id throws before any query is built — never a
 * silently dropped filter, which would widen the count to every row RLS exposes.
 */
export function appointmentSetterOrExpression(userId: unknown): string {
  const id = assertValidUserId(userId);
  return `created_by.eq.${id},and(created_by.is.null,user_id.eq.${id})`;
}
