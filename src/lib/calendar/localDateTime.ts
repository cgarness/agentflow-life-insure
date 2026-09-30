/**
 * Local wall-clock → absolute instant — the ONE rule for turning a picked date + time into a stored
 * `timestamptz`.
 *
 * A date and wall-clock time a user picks mean the BROWSER's local calendar time. The stored value is
 * that instant, serialised with `toISOString()`. The construction is `new Date(y, m, d, h, min)` — the
 * same one DialerPage uses for the canonical campaign callback (`callbackDueAtISO`), so a Main-Dialer
 * callback shadow and `campaign_leads.callback_due_at` are the same instant (AGENT_RULES #22).
 *
 * Never `new Date("YYYY-MM-DD")` (UTC semantics), never an appended "Z", never a fixed offset, and never a
 * bare `YYYY-MM-DDTHH:mm:ss` string (Postgres `timestamptz` reads it as UTC — 7 h early in PDT). DST
 * follows JavaScript's local-time rules: a non-existent spring-forward time rolls forward, an ambiguous
 * fall-back time resolves to its first occurrence — identically to the canonical callback computation.
 *
 * Pure: no React, no Supabase.
 */
import { parseLocalDateInput } from "@/lib/taskDates";

/** "h:mm AM/PM" (TimeSelect) or 24-hour "HH:mm". */
const WALL_CLOCK = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i;

/** Hours (0–23) and minutes of a wall-clock string, or null when malformed or out of range. */
export function parseWallClockTime(time: string): { hours: number; minutes: number } | null {
  const match = WALL_CLOCK.exec(String(time ?? "").trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  const period = match[3]?.toUpperCase();
  if (period) {
    if (hours < 1 || hours > 12) return null;
    if (period === "PM" && hours < 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }
  return { hours, minutes };
}

/**
 * The local Date for a `YYYY-MM-DD` date and a wall-clock time, or null when either is malformed.
 * The date is parsed strictly (rollovers such as 2026-02-31 and two-digit years are rejected).
 */
export function localDateTimeToDate(dateYmd: string, time: string): Date | null {
  const day = parseLocalDateInput(String(dateYmd ?? ""));
  const clock = parseWallClockTime(time);
  if (!day || !clock) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), clock.hours, clock.minutes);
}

/** The absolute ISO instant (`toISOString()`) of a local date + wall-clock time, or null when malformed. */
export function localDateTimeToIso(dateYmd: string, time: string): string | null {
  return localDateTimeToDate(dateYmd, time)?.toISOString() ?? null;
}
