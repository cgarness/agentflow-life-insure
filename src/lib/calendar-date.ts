/**
 * calendar-date — pure `YYYY-MM-DD` calendar arithmetic for date-only values
 * (birthdays, policy effective dates, Draft Dates).
 *
 * Date-only text must never go through `new Date("YYYY-MM-DD")`: that parses as
 * UTC midnight, which is the PREVIOUS local day in every US zone. Everything here
 * works on the three numbers instead, and day differences use `Date.UTC`, so the
 * result is an exact whole number of calendar days whatever the browser zone or a
 * DST change in between.
 */

export type CalendarDate = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export interface CalendarParts {
  year: number;
  month: number;
  day: number;
}

/** Strict `YYYY-MM-DD` that names a real day, else `null` (2026-02-31 is not a date). */
export function parseCalendarDate(raw: unknown): CalendarParts | null {
  if (typeof raw !== "string") return null;
  const match = ISO_DATE_RE.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

export function formatCalendarDate({ year, month, day }: CalendarParts): CalendarDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * The day an annual event dated `month`/`day` is observed in `year`.
 * February 29 is observed on February 28 in a non-leap year (decision D4).
 */
export function observedDate(year: number, month: number, day: number): CalendarDate {
  if (month === 2 && day === 29 && !isLeapYear(year)) return formatCalendarDate({ year, month: 2, day: 28 });
  return formatCalendarDate({ year, month, day });
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const a = parseCalendarDate(from);
  const b = parseCalendarDate(to);
  if (!a || !b) throw new Error("daysBetween requires two calendar dates");
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS,
  );
}

/** `date` shifted by `n` calendar days. */
export function addCalendarDays(date: CalendarDate, n: number): CalendarDate {
  const parts = parseCalendarDate(date);
  if (!parts) throw new Error("addCalendarDays requires a calendar date");
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + n));
  return formatCalendarDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** The browser-local calendar date of an instant (decision D5: the Dashboard's "today" is browser-local). */
export function localCalendarDate(instant: Date): CalendarDate {
  return formatCalendarDate({
    year: instant.getFullYear(),
    month: instant.getMonth() + 1,
    day: instant.getDate(),
  });
}

/** Local calendar date of a stored timestamp, or `null` when it does not parse. */
export function localCalendarDateOfTimestamp(raw: unknown): CalendarDate | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const instant = new Date(raw);
  return Number.isNaN(instant.getTime()) ? null : localCalendarDate(instant);
}

/** "Nov 5" for a calendar date, built from its own parts (never shifted through UTC). */
export function shortCalendarLabel(date: CalendarDate): string {
  const parts = parseCalendarDate(date);
  if (!parts) return "";
  // Noon local: the label only needs the month/day the parts already name.
  return new Date(parts.year, parts.month - 1, parts.day, 12).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
