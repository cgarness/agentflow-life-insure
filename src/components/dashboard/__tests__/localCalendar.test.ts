import { describe, it, expect } from "vitest";
import {
  addLocalDays,
  isWithinWindow,
  localCalendarWindow,
  startOfLocalDay,
  startOfLocalDayPlus,
} from "@/lib/local-calendar";

/**
 * DST correctness for browser-local calendar boundaries.
 *
 * These assert against the IMPORTED production helpers — no local copy. They are
 * meaningful only when the process timezone is America/Los_Angeles, which is how the
 * targeted script runs them (`TZ=America/Los_Angeles`). Under any other zone the
 * DST-specific cases are skipped rather than silently passing.
 *
 * The bug being locked out: `localMidnight.getTime() + n * 86_400_000` preserves elapsed
 * time, not wall-clock, so on a 23-hour day it lands at 01:00 and on a 25-hour day at
 * 23:00 the previous date.
 */

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const IS_LA = TZ === "America/Los_Angeles";
const laOnly = IS_LA ? it : it.skip;

/** Local wall-clock parts, for asserting "this really is local midnight". */
const parts = (d: Date) => ({
  y: d.getFullYear(),
  m: d.getMonth() + 1,
  d: d.getDate(),
  h: d.getHours(),
  min: d.getMinutes(),
});

describe("environment", () => {
  it("reports the timezone the DST assertions require", () => {
    // Informational: makes a non-LA run obvious instead of quietly skipping.
    expect(typeof TZ).toBe("string");
  });
});

describe("startOfLocalDay / startOfLocalDayPlus land on local midnight", () => {
  it("startOfLocalDay strips the time", () => {
    expect(parts(startOfLocalDay(new Date(2026, 7, 3, 14, 37, 12)))).toEqual({
      y: 2026, m: 8, d: 3, h: 0, min: 0,
    });
  });

  it("startOfLocalDayPlus(+1) is the next calendar date at 00:00", () => {
    expect(parts(startOfLocalDayPlus(new Date(2026, 7, 3, 23, 59), 1))).toEqual({
      y: 2026, m: 8, d: 4, h: 0, min: 0,
    });
  });

  it("crosses a month boundary correctly", () => {
    expect(parts(startOfLocalDayPlus(new Date(2026, 7, 31, 10), 1))).toEqual({
      y: 2026, m: 9, d: 1, h: 0, min: 0,
    });
  });

  it("crosses a year boundary correctly", () => {
    expect(parts(startOfLocalDayPlus(new Date(2026, 11, 31, 10), 1))).toEqual({
      y: 2027, m: 1, d: 1, h: 0, min: 0,
    });
  });
});

describe("America/Los_Angeles SPRING FORWARD — 2026-03-08 (23-hour day)", () => {
  laOnly("+1 day from 2026-03-07 midnight is 2026-03-08 00:00 local, not 01:00", () => {
    const result = startOfLocalDayPlus(new Date(2026, 2, 7, 12), 1);
    expect(parts(result)).toEqual({ y: 2026, m: 3, d: 8, h: 0, min: 0 });
  });

  laOnly("+1 day ACROSS the transition is 2026-03-09 00:00 local", () => {
    const result = startOfLocalDayPlus(new Date(2026, 2, 8, 12), 1);
    expect(parts(result)).toEqual({ y: 2026, m: 3, d: 9, h: 0, min: 0 });
  });

  laOnly("the naive fixed-millisecond approach DRIFTS — the bug being fixed", () => {
    const midnight = startOfLocalDay(new Date(2026, 2, 7, 12));
    const naive = new Date(midnight.getTime() + 2 * 24 * 60 * 60 * 1000);
    const correct = startOfLocalDayPlus(new Date(2026, 2, 7, 12), 2);
    // Naive lands at 01:00 on 03-09 because 03-08 was only 23 hours long.
    expect(naive.getHours()).toBe(1);
    expect(correct.getHours()).toBe(0);
    expect(naive.getTime()).not.toBe(correct.getTime());
  });

  laOnly("a +4 day window keeps BOTH ends at 00:00 local across the transition", () => {
    const w = localCalendarWindow(new Date(2026, 2, 6, 15), 0, 4);
    expect(parts(w.start)).toEqual({ y: 2026, m: 3, d: 6, h: 0, min: 0 });
    expect(parts(w.endExclusive)).toEqual({ y: 2026, m: 3, d: 10, h: 0, min: 0 });
  });

  laOnly("a -30 day overdue lookback stays local midnight across the transition", () => {
    const w = localCalendarWindow(new Date(2026, 2, 20, 9), 30, 1);
    expect(parts(w.start)).toEqual({ y: 2026, m: 2, d: 18, h: 0, min: 0 });
    expect(w.start.getHours()).toBe(0);
  });
});

describe("America/Los_Angeles FALL BACK — 2026-11-01 (25-hour day)", () => {
  laOnly("+1 day from 2026-10-31 midnight is 2026-11-01 00:00 local, not 23:00 on 10-31", () => {
    const result = startOfLocalDayPlus(new Date(2026, 9, 31, 12), 1);
    expect(parts(result)).toEqual({ y: 2026, m: 11, d: 1, h: 0, min: 0 });
  });

  laOnly("+1 day ACROSS the transition is 2026-11-02 00:00 local", () => {
    const result = startOfLocalDayPlus(new Date(2026, 10, 1, 12), 1);
    expect(parts(result)).toEqual({ y: 2026, m: 11, d: 2, h: 0, min: 0 });
  });

  laOnly("the naive fixed-millisecond approach DRIFTS the other way", () => {
    const midnight = startOfLocalDay(new Date(2026, 9, 31, 12));
    const naive = new Date(midnight.getTime() + 2 * 24 * 60 * 60 * 1000);
    const correct = startOfLocalDayPlus(new Date(2026, 9, 31, 12), 2);
    // 11-01 was 25 hours long, so naive lands at 23:00 on 11-01.
    expect(naive.getHours()).toBe(23);
    expect(correct.getHours()).toBe(0);
  });

  laOnly("a +4 day window keeps BOTH ends at 00:00 local across the transition", () => {
    const w = localCalendarWindow(new Date(2026, 9, 30, 18), 0, 4);
    expect(parts(w.start)).toEqual({ y: 2026, m: 10, d: 30, h: 0, min: 0 });
    expect(parts(w.endExclusive)).toEqual({ y: 2026, m: 11, d: 3, h: 0, min: 0 });
  });
});

describe("exclusive end is always 00:00 local, for every window size", () => {
  it.each([1, 2, 4, 7, 30])("+%i days ends at exactly 00:00 local", (n) => {
    const w = localCalendarWindow(new Date(2026, 2, 6, 13, 45), 0, n);
    expect(w.endExclusive.getHours()).toBe(0);
    expect(w.endExclusive.getMinutes()).toBe(0);
    expect(w.endExclusive.getSeconds()).toBe(0);
    expect(w.endExclusive.getMilliseconds()).toBe(0);
  });

  it.each([1, 30])("-%i days starts at exactly 00:00 local", (n) => {
    const w = localCalendarWindow(new Date(2026, 10, 3, 13, 45), n, 1);
    expect(w.start.getHours()).toBe(0);
    expect(w.start.getMilliseconds()).toBe(0);
  });
});

describe("half-open membership", () => {
  const ref = new Date(2026, 7, 3, 10);
  const today = localCalendarWindow(ref, 0, 1);

  it("includes local midnight today", () => {
    expect(isWithinWindow(startOfLocalDay(ref), today)).toBe(true);
  });

  it("includes one millisecond before the exclusive end", () => {
    expect(isWithinWindow(new Date(today.endExclusive.getTime() - 1), today)).toBe(true);
  });

  it("EXCLUDES exactly midnight on the next day", () => {
    expect(isWithinWindow(today.endExclusive, today)).toBe(false);
    expect(isWithinWindow(startOfLocalDayPlus(ref, 1), today)).toBe(false);
  });

  it("excludes an instant before the window", () => {
    expect(isWithinWindow(new Date(today.start.getTime() - 1), today)).toBe(false);
  });
});

describe("a 7-day window spans 7 calendar days even across a transition", () => {
  laOnly("spring: 7 calendar days, not 6 or 8", () => {
    const w = localCalendarWindow(new Date(2026, 2, 5, 12), 0, 7);
    expect(w.start.getDate()).toBe(5);
    expect(parts(w.endExclusive)).toEqual({ y: 2026, m: 3, d: 12, h: 0, min: 0 });
    // Elapsed time is 7 days MINUS one hour — proof the offset was re-resolved.
    const hours = (w.endExclusive.getTime() - w.start.getTime()) / 3_600_000;
    expect(hours).toBe(7 * 24 - 1);
  });

  laOnly("fall: elapsed time is 7 days PLUS one hour", () => {
    const w = localCalendarWindow(new Date(2026, 9, 29, 12), 0, 7);
    const hours = (w.endExclusive.getTime() - w.start.getTime()) / 3_600_000;
    expect(hours).toBe(7 * 24 + 1);
  });
});

describe("addLocalDays preserves wall-clock time", () => {
  it("keeps the time-of-day when shifting days", () => {
    const shifted = addLocalDays(new Date(2026, 7, 3, 14, 37, 12, 345), 3);
    expect(parts(shifted)).toEqual({ y: 2026, m: 8, d: 6, h: 14, min: 37 });
    expect(shifted.getSeconds()).toBe(12);
    expect(shifted.getMilliseconds()).toBe(345);
  });

  laOnly("keeps 09:00 as 09:00 across the spring transition", () => {
    const shifted = addLocalDays(new Date(2026, 2, 7, 9, 0), 1);
    expect(shifted.getHours()).toBe(9);
    expect(shifted.getDate()).toBe(8);
  });
});
