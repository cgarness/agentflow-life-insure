import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Period } from "@/components/leaderboard/leaderboardTypes";

/** Agency calendar construction, independent of the browser's timezone. */
export function performancePeriodStart(period: Period, zone: string, now = new Date()): Date {
  const local = formatInTimeZone(now, zone, "yyyy-MM-dd");
  const day = new Date(`${local}T12:00:00Z`);
  if (period === "This Month") day.setUTCDate(1);
  if (period === "This Week") day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return fromZonedTime(`${day.toISOString().slice(0, 10)}T00:00:00`, zone);
}

export function performancePeriodKey(period: Period, zone: string | null, now = new Date()): string {
  return zone ? `${zone}|${performancePeriodStart(period, zone, now).toISOString()}` : "unresolved";
}
