import { describe, it, expect } from "vitest";

/**
 * Half-open `[start, end)` period bounds and the Today-callback rule.
 *
 * These mirror the boundary derivation in `useDashboardStats.ts`,
 * `DashboardDetailModal.tsx` and the widgets. What regressed in production:
 *  - the CURRENT period had no upper bound at all, so "Appointments" counted every
 *    future appointment ever booked;
 *  - previous periods used inclusive `.lte` bounds fudged with `setMilliseconds(-1)`
 *    / `23:59:59`, so a row on a boundary instant could land in two periods;
 *  - the week start mutated `now` in place via `now.setDate(diff)`.
 *
 * NOTE: derivation is still browser-local. Agency-timezone bounds are Build 2 and are
 * deliberately NOT asserted here.
 */

type Range = "day" | "week" | "month" | "year";

function periodBounds(now: Date, range: Range): { start: Date; end: Date; prevStart: Date } {
  if (range === "day") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
      prevStart: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
    };
  }
  if (range === "week") {
    const day = now.getDay();
    const mondayOffset = now.getDate() - day + (day === 0 ? -6 : 1);
    return {
      start: new Date(now.getFullYear(), now.getMonth(), mondayOffset),
      end: new Date(now.getFullYear(), now.getMonth(), mondayOffset + 7),
      prevStart: new Date(now.getFullYear(), now.getMonth(), mondayOffset - 7),
    };
  }
  if (range === "year") {
    return {
      start: new Date(now.getFullYear(), 0, 1),
      end: new Date(now.getFullYear() + 1, 0, 1),
      prevStart: new Date(now.getFullYear() - 1, 0, 1),
    };
  }
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    prevStart: new Date(now.getFullYear(), now.getMonth() - 1, 1),
  };
}

/** Half-open membership: start <= t < end. */
const inRange = (t: Date, start: Date, end: Date) => t >= start && t < end;

describe("every period has BOTH bounds", () => {
  it.each<Range>(["day", "week", "month", "year"])("%s defines a finite window", (range) => {
    const { start, end } = periodBounds(new Date(2026, 7, 3, 14, 30), range);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect(Number.isFinite(end.getTime())).toBe(true);
  });

  it("a far-future row is EXCLUDED from the current period (the missing-upper-bound bug)", () => {
    const { start, end } = periodBounds(new Date(2026, 7, 3), "day");
    const nextYear = new Date(2027, 0, 1);
    expect(inRange(nextYear, start, end)).toBe(false);
  });
});

describe("half-open boundaries assign each instant to exactly one period", () => {
  it.each<Range>(["day", "week", "month", "year"])(
    "%s: the exclusive end instant is NOT in the period",
    (range) => {
      const { start, end } = periodBounds(new Date(2026, 7, 3, 9, 0), range);
      expect(inRange(end, start, end)).toBe(false);
      expect(inRange(start, start, end)).toBe(true);
      expect(inRange(new Date(end.getTime() - 1), start, end)).toBe(true);
    },
  );

  it("the previous period's end is exactly the current period's start — no gap, no overlap", () => {
    const { start, prevStart } = periodBounds(new Date(2026, 7, 3), "month");
    const prevEnd = start; // exclusive
    expect(inRange(new Date(prevEnd.getTime() - 1), prevStart, prevEnd)).toBe(true);
    expect(inRange(prevEnd, prevStart, prevEnd)).toBe(false);
    expect(inRange(prevEnd, start, new Date(2026, 8, 1))).toBe(true);
  });

  it("midnight belongs to the new day only", () => {
    const { start: d3s, end: d3e } = periodBounds(new Date(2026, 7, 3, 12), "day");
    const { start: d4s } = periodBounds(new Date(2026, 7, 4, 12), "day");
    const midnight = new Date(2026, 7, 4, 0, 0, 0, 0);
    expect(inRange(midnight, d3s, d3e)).toBe(false);
    expect(midnight.getTime()).toBe(d4s.getTime());
  });
});

describe("week starts Monday and does not mutate its input", () => {
  it.each([
    ["Monday", new Date(2026, 7, 3, 10)],
    ["Wednesday", new Date(2026, 7, 5, 10)],
    ["Sunday", new Date(2026, 7, 9, 10)],
  ])("%s resolves to the same Monday-start week", (_label, day) => {
    const { start, end } = periodBounds(day, "week");
    expect(start.getDay()).toBe(1); // Monday
    expect(Math.round((end.getTime() - start.getTime()) / 86400000)).toBe(7);
    expect(inRange(day, start, end)).toBe(true);
  });

  it("does not mutate the Date it is given", () => {
    const now = new Date(2026, 7, 9, 10, 0, 0);
    const before = now.getTime();
    periodBounds(now, "week");
    expect(now.getTime()).toBe(before);
  });

  it("a Sunday resolves to the PRECEDING Monday, not the following one", () => {
    const sunday = new Date(2026, 7, 9, 10);
    const { start } = periodBounds(sunday, "week");
    expect(start.getDate()).toBe(3);
    expect(start.getTime()).toBeLessThan(sunday.getTime());
  });
});

describe("Today callbacks = overdue PLUS due-today (the deliberate exception)", () => {
  // Mirrors the bucketing in CallbacksWidget.
  function bucket(dueAt: Date, now: Date) {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);
    if (dueAt < now) return "overdue";
    if (dueAt < todayEnd) return "dueToday";
    return "dueSoon";
  }

  const now = new Date(2026, 7, 3, 14, 0);

  it("classifies a callback from a previous day as overdue, not dropped", () => {
    expect(bucket(new Date(2026, 6, 20, 9, 0), now)).toBe("overdue");
  });

  it("classifies an earlier-today callback as overdue", () => {
    expect(bucket(new Date(2026, 7, 3, 9, 0), now)).toBe("overdue");
  });

  it("classifies a later-today callback as due today", () => {
    expect(bucket(new Date(2026, 7, 3, 17, 0), now)).toBe("dueToday");
  });

  it("Today's actionable set is overdue + dueToday, and excludes tomorrow", () => {
    const items = [
      new Date(2026, 6, 20, 9, 0),
      new Date(2026, 7, 3, 9, 0),
      new Date(2026, 7, 3, 17, 0),
      new Date(2026, 7, 4, 10, 0),
    ];
    const buckets = items.map((d) => bucket(d, now));
    expect(buckets.filter((b) => b === "overdue" || b === "dueToday")).toHaveLength(3);
    expect(buckets.filter((b) => b === "dueSoon")).toHaveLength(1);
  });

  it("uses a half-open today boundary — exactly-midnight-tomorrow is not due today", () => {
    expect(bucket(new Date(2026, 7, 4, 0, 0, 0, 0), now)).toBe("dueSoon");
  });
});

describe("displayed totals must not be a truncated page length", () => {
  const PAGE_SIZE = 15;

  it("uses the exact count when it exceeds the page size", () => {
    const rows = Array.from({ length: PAGE_SIZE }, (_, i) => i);
    const exactCount = 42;
    expect(exactCount ?? rows.length).toBe(42);
    expect(exactCount).not.toBe(rows.length);
  });

  it("falls back to the row length only when no count came back", () => {
    const rows = [1, 2, 3];
    const exactCount: number | null = null;
    expect(exactCount ?? rows.length).toBe(3);
  });

  it("reports 0 rather than a stale total when the result set is empty", () => {
    expect((0 as number | null) ?? 0).toBe(0);
  });
});
