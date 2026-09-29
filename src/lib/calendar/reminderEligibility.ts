/**
 * Personal appointment reminders — pure selection logic for ReminderPopup.
 *
 * Recipient: the RESPONSIBLE user only (`appointmentOwnership.isAppointmentResponsibleUser`): `user_id`
 * when set, `created_by` only when `user_id IS NULL` (AGENT_RULES #22). The CalendarContext list is
 * org-scoped for Admins and also carries rows a user scheduled for someone else, so this gate is what
 * keeps a scheduler from receiving the assignee's reminder.
 *
 * Status: open appointments only (Scheduled / Confirmed), judged on the RAW database status.
 *
 * Timing is unchanged from the original inline ReminderPopup logic: fire from `start - leadTime` until
 * `start + 30 min`, once per appointment id per session, again after a snooze expires.
 */
import { isAppointmentResponsibleUser, isOpenAppointmentStatus } from "@/lib/calendar/appointmentOwnership";

export interface ReminderStateEntry {
  shown: boolean;
  snoozeUntil: number | null;
}

export type ReminderState = Record<string, ReminderStateEntry>;

export interface ReminderCandidate {
  id: string;
  start_time?: string;
  user_id?: string | null;
  created_by?: string | null;
  raw_status?: string | null;
}

const PAST_START_GRACE_MS = 30 * 60 * 1000;
export const DEFAULT_SNOOZE_MINUTES = 5;

/** Recipient + open-status gate, shared by selection and queue revalidation. */
export function isReminderRecipient(appt: ReminderCandidate, userId: string | null | undefined): boolean {
  return isAppointmentResponsibleUser(appt, userId) && isOpenAppointmentStatus(appt.raw_status);
}

export function selectDueReminders<T extends ReminderCandidate>(
  appointments: readonly T[],
  opts: { userId: string | null | undefined; now: number; leadTimeMinutes: number; state: ReminderState },
): { due: T[]; nextState: ReminderState } {
  const nextState: ReminderState = { ...opts.state };
  const due: T[] = [];
  const leadTimeMs = opts.leadTimeMinutes * 60 * 1000;

  for (const appt of appointments) {
    if (!appt.start_time) continue;
    if (!isReminderRecipient(appt, opts.userId)) continue;

    const startTime = new Date(appt.start_time).getTime();
    const triggerTime = startTime - leadTimeMs;
    const entry = nextState[appt.id] || { shown: false, snoozeUntil: null };

    const isPastTrigger = opts.now >= triggerTime;
    const isTooOld = opts.now > startTime + PAST_START_GRACE_MS;
    const readyForShow = !entry.shown || (entry.snoozeUntil && opts.now >= entry.snoozeUntil);

    if (isPastTrigger && !isTooOld && readyForShow) {
      due.push(appt);
      // Marked at queue time so a second check before the dialog opens cannot queue it twice.
      nextState[appt.id] = { ...entry, shown: true, snoozeUntil: null };
    }
  }

  return { due, nextState };
}

export function applySnooze(
  state: ReminderState,
  id: string,
  now: number,
  minutes: number = DEFAULT_SNOOZE_MINUTES,
): ReminderState {
  return { ...state, [id]: { shown: true, snoozeUntil: now + minutes * 60 * 1000 } };
}

/**
 * Whether a queued or on-screen reminder still applies against the latest appointment list — it is
 * dropped once the row was reassigned away, cancelled/completed, or is no longer visible at all.
 */
export function isReminderStillEligible(
  id: string,
  appointments: readonly ReminderCandidate[],
  userId: string | null | undefined,
): boolean {
  const current = appointments.find((a) => a.id === id);
  return !!current && isReminderRecipient(current, userId);
}
