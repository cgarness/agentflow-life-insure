/**
 * Task due dates — day-granular, in the viewer's LOCAL calendar.
 *
 * `tasks.due_date` is `timestamptz`, and the database session TimeZone is UTC. A bare `YYYY-MM-DD`
 * written into it is stored as UTC midnight, which is the previous evening in US time zones. The task
 * form therefore sends the picked date as the instant of LOCAL midnight on that date, and every
 * due-status decision compares LOCAL calendar days (the user-local-day convention, never UTC).
 */
import { format, isSameDay } from "date-fns";

export type TaskDueStatus = "completed" | "overdue" | "today" | "upcoming";

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A `YYYY-MM-DD` date-input value as local midnight, or null when malformed. */
export function parseLocalDateInput(value: string): Date | null {
  const match = DATE_INPUT.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  // Reject rollovers such as 2026-02-31.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/** The ISO instant of local midnight on the picked date — what the task form persists. */
export function localDateInputToIso(value: string): string | null {
  return parseLocalDateInput(value)?.toISOString() ?? null;
}

/** Today's local date in date-input form. */
export function todayLocalDateInput(now: Date = new Date()): string {
  return format(now, "yyyy-MM-dd");
}

/** True when the picked local date is today or later. */
export function isLocalDateInputTodayOrLater(value: string, now: Date = new Date()): boolean {
  const date = parseLocalDateInput(value);
  if (!date) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date.getTime() >= today.getTime();
}

/**
 * TasksPanel's due-status rule, unchanged: completed wins; otherwise overdue only once the due LOCAL
 * day has passed; a task due today stays "today" all day.
 */
export function getTaskDueStatus(
  dueDate: string | Date,
  completedAt: string | null | undefined,
  now: Date = new Date(),
): TaskDueStatus {
  if (completedAt) return "completed";
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  // Identical to date-fns `isPast(due) && !isToday(due)` / `isToday(due)` evaluated at `now`.
  const sameDay = isSameDay(due, now);
  if (due.getTime() < now.getTime() && !sameDay) return "overdue";
  if (sameDay) return "today";
  return "upcoming";
}

/** End of the task's local due day — its sort key among timed follow-ups. */
export function endOfLocalDueDay(dueDate: string | Date): Date {
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  return new Date(due.getFullYear(), due.getMonth(), due.getDate(), 23, 59, 59, 999);
}
