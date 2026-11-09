/** Pure gate (D4 §4): Held / No show are offered only for an originally open slot whose start has passed. */
const OPEN = new Set(["scheduled", "confirmed"]);
export function canRecordAppointmentOutcome(appointment: { status: string | null | undefined; startTime: string | null | undefined },
                                            now: Date = new Date()): boolean {
  if (!appointment.startTime) return false;
  const start = Date.parse(appointment.startTime);
  return Number.isFinite(start) && start <= now.getTime() && OPEN.has((appointment.status ?? "").trim().toLowerCase());
}
/** A past-due open slot that is being moved: nudge (never block) to record its outcome first. */
export function isPastDueOpenSlotMove(original: { status: string | null | undefined; startTime: string | null | undefined },
                                      nextStart: string | null | undefined, now: Date = new Date()): boolean {
  return canRecordAppointmentOutcome(original, now) && !!nextStart && nextStart !== original.startTime;
}
