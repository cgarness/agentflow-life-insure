/**
 * reports-format.ts — pure helpers for the Reports page: AGENCY-calendar date arithmetic, grouping of
 * the server's daily series, and display formatting.
 *
 * Reports use the AGENCY time zone resolved on the server (plan rev 2 §R2.1). The browser never
 * converts instants: it only does calendar arithmetic on `YYYY-MM-DD` strings, anchored to the
 * agency `today` returned by `get_report_scope()`. Arithmetic runs in UTC on date-only values, so the
 * viewer's own zone and DST can never shift a day.
 */

export type ReportPreset = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "custom";
export type Grouping = "daily" | "weekly" | "monthly";

export interface CalendarRange {
  startDate: string;
  endDate: string;
}

export const PRESET_LABELS: Record<ReportPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  month: "This Month",
  lastMonth: "Last Month",
  custom: "Custom",
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtc(date: string): Date {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`Invalid calendar date: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  return fromUtc(toUtc(value)) === value;
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function dayCount(range: CalendarRange): number {
  return Math.round((toUtc(range.endDate).getTime() - toUtc(range.startDate).getTime()) / 86_400_000) + 1;
}

/** A preset resolved against the AGENCY `today` (never the browser clock). */
export function presetRange(preset: Exclude<ReportPreset, "custom">, agencyToday: string): CalendarRange {
  const t = toUtc(agencyToday);
  switch (preset) {
    case "today":
      return { startDate: agencyToday, endDate: agencyToday };
    case "yesterday": {
      const y = addDays(agencyToday, -1);
      return { startDate: y, endDate: y };
    }
    case "7d":
      return { startDate: addDays(agencyToday, -6), endDate: agencyToday };
    case "30d":
      return { startDate: addDays(agencyToday, -29), endDate: agencyToday };
    case "month":
      return { startDate: fromUtc(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))), endDate: agencyToday };
    case "lastMonth": {
      const start = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
      return { startDate: fromUtc(start), endDate: fromUtc(end) };
    }
  }
}

/** A calendar day picked in the date picker (a local Date) → `YYYY-MM-DD` of that picked day. */
export function pickedDayToCalendarDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `YYYY-MM-DD` → a local Date for the date picker / display only. */
export function calendarDateToPickerDate(date: string): Date {
  const u = toUtc(date);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
}

export type RangeProblem = "order" | "too_long" | null;

export function validateRange(range: CalendarRange, maxDays: number): RangeProblem {
  if (!isCalendarDate(range.startDate) || !isCalendarDate(range.endDate)) return "order";
  if (range.endDate < range.startDate) return "order";
  if (dayCount(range) > maxDays) return "too_long";
  return null;
}

export function autoGrouping(range: CalendarRange): Grouping {
  const days = dayCount(range);
  if (days < 14) return "daily";
  if (days <= 60) return "weekly";
  return "monthly";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jul 04" style label for an agency calendar date (no zone conversion). */
export function shortDateLabel(date: string): string {
  const d = toUtc(date);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function longDateLabel(date: string): string {
  const d = toUtc(date);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** Bucket key for a calendar date: the day, the Monday that starts its week, or its month. */
export function bucketKey(date: string, grouping: Grouping): string {
  if (grouping === "daily") return date;
  const d = toUtc(date);
  if (grouping === "weekly") return addDays(date, -((d.getUTCDay() + 6) % 7));
  return date.slice(0, 7);
}

export function bucketLabel(key: string, grouping: Grouping): string {
  if (grouping === "daily") return shortDateLabel(key);
  if (grouping === "weekly") return `Week of ${shortDateLabel(key)}`;
  const d = toUtc(`${key}-01`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Regroup the server's zero-filled daily series. Sums of daily counts are exact at any grouping, and
 * buckets stay in chronological order (keys are ISO-ordered strings).
 */
/** Last calendar day of the month containing `date`. */
function monthEnd(date: string): string {
  const d = toUtc(date);
  return fromUtc(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/**
 * Label for a bucket from the days it ACTUALLY covers. A week or month clipped by the report window
 * is labelled with its real span ("Sep 23 – Sep 26"), never as the full period.
 */
export function coveredBucketLabel(key: string, grouping: Grouping, first: string, last: string): string {
  if (grouping === "daily") return shortDateLabel(key);
  if (grouping === "weekly") {
    return first === key && last === addDays(key, 6) ? bucketLabel(key, grouping) : `${shortDateLabel(first)} – ${shortDateLabel(last)}`;
  }
  const full = first === `${key}-01` && last === monthEnd(first);
  return full ? bucketLabel(key, grouping) : `${shortDateLabel(first)} – ${shortDateLabel(last)}`;
}

/**
 * Regroup the server's zero-filled daily series. Sums of daily counts are exact at any grouping,
 * buckets stay in chronological order (keys are ISO-ordered strings), and each bucket reports the
 * first/last day it covers so a partial week or month is never labelled as a whole one.
 */
export function groupDailySeries<T extends { date: string }, F extends Exclude<keyof T, "date"> & string>(
  rows: T[],
  grouping: Grouping,
  fields: F[],
): Array<{ key: string; label: string; first: string; last: string } & Record<F, number>> {
  const buckets = new Map<string, { first: string; last: string; sums: Record<string, number> }>();
  for (const row of rows) {
    const key = bucketKey(row.date, grouping);
    const b = buckets.get(key) ?? { first: row.date, last: row.date, sums: {} };
    if (row.date < b.first) b.first = row.date;
    if (row.date > b.last) b.last = row.date;
    for (const f of fields) {
      b.sums[f] = (b.sums[f] ?? 0) + Number(row[f] ?? 0);
    }
    buckets.set(key, b);
  }
  return Array.from(buckets.keys())
    .sort()
    .map((key) => {
      const b = buckets.get(key)!;
      return {
        key,
        label: coveredBucketLabel(key, grouping, b.first, b.last),
        first: b.first,
        last: b.last,
        ...b.sums,
      } as { key: string; label: string; first: string; last: string } & Record<F, number>;
    });
}

// ─── Display formatting ──────────────────────────────────────────────────────────────────────────

/** Duration as m:ss (or "—" when unknown). */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Duration as "Xh Ym Zs" (or "—" when unknown). */
export function formatHours(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}

/**
 * Exact elapsed time: "28h 4m 3s", "3m 21s", "45s" (the Leaderboard's format). `fractionDigits` 1
 * keeps a payload's 0.1 s instead of rounding it a second time: "2m 32.5s", "40.2s". "—" when unknown.
 */
export function formatElapsed(seconds: number | null | undefined, fractionDigits: 0 | 1 = 0): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—";
  const scale = fractionDigits === 1 ? 10 : 1;
  // Whole seconds (schema counts are integers) or tenths (the payload is already 0.1 s precise):
  // this only removes float noise (152.3 × 10 = 1523.0000000000002), it never re-rounds a value.
  const units = Math.round(seconds * scale);
  const whole = Math.floor(units / scale);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const sec = fractionDigits === 1 ? `${s}.${units % 10}s` : `${s}s`;
  return h > 0 ? `${h}h ${m}m ${sec}` : m > 0 ? `${m}m ${sec}` : sec;
}

/**
 * A server instant (for example the summary's `as_of`) as agency wall-clock time: "8:44 PM PDT", or
 * "Oct 8, 8:44 PM PDT" when its agency calendar date is not the agency `today`. It only formats the
 * instant; there is no window arithmetic. "—" when the instant or the zone cannot be read.
 */
export function formatAsOf(iso: string, timeZone: string, today: string): string {
  const instant = new Date(iso);
  if (!Number.isFinite(instant.getTime())) return "—";
  try {
    const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" })
      .format(instant)
      .replace(/[\u00a0\u202f]/g, " ");
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
    const month = Number(part("month"));
    const agencyDate = `${part("year")}-${part("month")}-${part("day")}`;
    return agencyDate === today ? time : `${MONTHS[month - 1]} ${Number(part("day"))}, ${time}`;
  } catch {
    return "—";
  }
}

/** A server rate (null when its denominator is zero) → "57.9%" or "—". Never a fabricated "0%". */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  return `${rate.toFixed(1)}%`;
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** A ratio computed from two canonical counts; `null` when the denominator is 0. */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}


export function formatPremium(amount: number | null | undefined): string {
  return amount == null || !Number.isFinite(amount) ? "—" : amount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
