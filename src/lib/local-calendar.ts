/**
 * local-calendar — DST-safe **browser-local** calendar-day arithmetic.
 *
 * ⚠️ This is NOT the agency-timezone module. Agency-timezone reporting boundaries
 * (contract §4) are Build 2 and are deliberately not implemented here. Everything in
 * this file derives from the browser's local zone, exactly as the Dashboard already
 * did — the only thing being corrected is *how* the day arithmetic is performed.
 *
 * Why it exists: adding a fixed multiple of 86_400_000 ms to a local-midnight `Date`
 * is wrong across a DST transition, because a local calendar day is 23 or 25 hours
 * then, not 24. `CallbacksWidget` had four such sites (+4d window, −30d lookback,
 * +1d today-end, +2d soon-end), so on 2026-03-08 (spring forward) its "midnight"
 * boundaries silently became 01:00, and on 2026-11-01 (fall back) 23:00 the day
 * before. Constructing the date instead — `new Date(y, m, d + n)` — makes the JS
 * engine re-resolve the local offset for the target calendar date, so local midnight
 * stays local midnight.
 */

/** Local midnight at the start of `d`'s calendar day. */
export function startOfLocalDay(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * `d` shifted by `n` whole local calendar days, preserving the local wall-clock time.
 *
 * DST-safe: the `Date` constructor normalizes an out-of-range day field and resolves
 * the offset for the resulting calendar date. Never use `getTime() + n * 86400000`,
 * which preserves elapsed time rather than wall-clock.
 */
export function addLocalDays(d: Date, n: number): Date {
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + n,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  );
}

/** Local midnight `n` calendar days from the start of `d`'s day. */
export function startOfLocalDayPlus(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export interface LocalDayWindow {
  /** Inclusive lower bound — local midnight. */
  start: Date;
  /** EXCLUSIVE upper bound — local midnight. A row at exactly this instant is out. */
  endExclusive: Date;
}

/**
 * Half-open local-calendar window `[start, endExclusive)`.
 *
 * `daysBack` extends the lower bound backwards from today's midnight; `daysForward`
 * extends the exclusive end forwards. Both ends are always exactly local midnight,
 * including across a DST transition inside the window.
 */
export function localCalendarWindow(
  reference: Date,
  daysBack: number,
  daysForward: number,
): LocalDayWindow {
  return {
    start: startOfLocalDayPlus(reference, -daysBack),
    endExclusive: startOfLocalDayPlus(reference, daysForward),
  };
}

/** Half-open membership: `start <= t < endExclusive`. */
export function isWithinWindow(t: Date, window: LocalDayWindow): boolean {
  return t >= window.start && t < window.endExclusive;
}

/** ISO strings for a window, for Supabase `gte` / `lt` filters. */
export function windowToIso(window: LocalDayWindow): { startIso: string; endIso: string } {
  return {
    startIso: window.start.toISOString(),
    endIso: window.endExclusive.toISOString(),
  };
}
