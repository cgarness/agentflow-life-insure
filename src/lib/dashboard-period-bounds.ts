/**
 * dashboard-period-bounds — half-open `[start, end)` period boundaries for the Dashboard.
 *
 * Extracted so the tests can import the SHIPPED logic instead of re-declaring a copy.
 * `DashboardDetailModal` consumes it; `useDashboardStats` still carries its own copy and
 * is deliberately left untouched in this pass (it is outside the approved edit list) —
 * converging it is a disclosed follow-up.
 *
 * ⚠️ Browser-local, like the code it replaces. Agency-timezone derivation is Build 2 and
 * is NOT implemented or claimed here. Day arithmetic uses calendar construction via
 * `@/lib/local-calendar`, so boundaries stay at local midnight across DST.
 */

import { startOfLocalDay, startOfLocalDayPlus } from "@/lib/local-calendar";

export type DashboardPeriod = "day" | "week" | "month" | "year";

export interface PeriodBounds {
  /** Inclusive start. */
  start: Date;
  /** EXCLUSIVE end — the start of the next period. */
  end: Date;
  /** Inclusive start of the comparison period; its exclusive end is `start`. */
  prevStart: Date;
  /** Label for the comparison period. */
  prevLabel: string;
}

/** Monday-based offset for the week containing `now`, without mutating `now`. */
function mondayOffset(now: Date): number {
  const day = now.getDay();
  return now.getDate() - day + (day === 0 ? -6 : 1);
}

/**
 * Half-open bounds for a period.
 *
 * The previous period's exclusive end is exactly `start`, so no instant falls in two
 * periods and none falls in neither.
 */
export function periodBounds(now: Date, period: DashboardPeriod): PeriodBounds {
  switch (period) {
    case "day":
      return {
        start: startOfLocalDay(now),
        end: startOfLocalDayPlus(now, 1),
        prevStart: startOfLocalDayPlus(now, -1),
        prevLabel: "yesterday",
      };
    case "week": {
      const monday = mondayOffset(now);
      return {
        start: new Date(now.getFullYear(), now.getMonth(), monday),
        end: new Date(now.getFullYear(), now.getMonth(), monday + 7),
        prevStart: new Date(now.getFullYear(), now.getMonth(), monday - 7),
        prevLabel: "last week",
      };
    }
    case "year":
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end: new Date(now.getFullYear() + 1, 0, 1),
        prevStart: new Date(now.getFullYear() - 1, 0, 1),
        prevLabel: "last year",
      };
    case "month":
    default:
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
        prevStart: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        prevLabel: "last month",
      };
  }
}

/** ISO bounds for Supabase `gte` / `lt` filters. */
export function periodBoundsIso(
  now: Date,
  period: DashboardPeriod,
): { startIso: string; endIso: string; prevStartIso: string; prevEndIso: string; prevLabel: string } {
  const b = periodBounds(now, period);
  return {
    startIso: b.start.toISOString(),
    endIso: b.end.toISOString(),
    prevStartIso: b.prevStart.toISOString(),
    // The previous period ends exactly where the current one begins.
    prevEndIso: b.start.toISOString(),
    prevLabel: b.prevLabel,
  };
}
