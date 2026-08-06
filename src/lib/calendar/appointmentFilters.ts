/**
 * Classification of dialer-generated callback records, which live in the
 * shared `appointments` table alongside real appointments.
 *
 * Confirmed writer signatures (do not broaden without approval):
 * - Main Dialer (`DialerPage` → `saveAppointment`): literal title "Callback".
 * - FloatingDialer quick-call: title `Callback: <first> <last>` and notes
 *   `Callback scheduled from dialer. Disposition: <name>`.
 *
 * Deliberately never reads `type` or `status`: a legitimate appointment may
 * use the "Follow Up" type (FloatingDialer callbacks also use it), and
 * historical Completed/Cancelled real appointments must survive.
 */

const DIALER_CALLBACK_NOTE_MARKER = "callback scheduled from dialer";

export function isDialerCallbackAppointment(appt: {
  title?: string | null;
  notes?: string | null;
}): boolean {
  const title = (appt.title ?? "").trim().toLowerCase();
  if (title === "callback") return true;
  if (title.startsWith("callback:")) return true;
  const notes = (appt.notes ?? "").toLowerCase();
  return notes.includes(DIALER_CALLBACK_NOTE_MARKER);
}

/** Returns a new array; the input is never mutated. */
export function excludeDialerCallbacks<
  T extends { title?: string | null; notes?: string | null }
>(appointments: readonly T[]): T[] {
  return appointments.filter((appt) => !isDialerCallbackAppointment(appt));
}
