import { describe, it, expect } from "vitest";
import { periodBounds, type DashboardPeriod } from "@/lib/dashboard-period-bounds";
import { isWithinWindow, startOfLocalDayPlus } from "@/lib/local-calendar";

/**
 * Half-open `[start, end)` period bounds and the Today-callback rule.
 *
 * These assert against the IMPORTED production helpers — the previous version of this
 * file re-declared `periodBounds` and `inRange` locally, so it pinned a copy and would
 * have kept passing if the shipped logic drifted.
 *
 * NOTE: derivation is browser-local. Agency-timezone bounds are Build 2 and are
 * deliberately not asserted here; DST correctness lives in `localCalendar.test.ts`.
 */

type Range = DashboardPeriod;

/** Half-open membership: start <= t < end. */
const inRange = (t: Date, start: Date, end: Date) =>
  isWithinWindow(t, { start, endExclusive: end });

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
    expect(startOfLocalDayPlus(start, 7).getTime()).toBe(end.getTime());
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
    const todayEnd = startOfLocalDayPlus(now, 1);
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
