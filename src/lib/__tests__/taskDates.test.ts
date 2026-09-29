/**
 * Task due dates are LOCAL calendar dates.
 *
 * The day-boundary cases only mean something in a negative-offset zone, so they are LA-gated like
 * `localCalendar.test.ts`: run them with `TZ=America/Los_Angeles`; elsewhere they are skipped rather
 * than passing vacuously (this container runs in UTC, where the old UTC-midnight bug is invisible).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  endOfLocalDueDay,
  getTaskDueStatus,
  isLocalDateInputTodayOrLater,
  localDateInputToIso,
  parseLocalDateInput,
  todayLocalDateInput,
} from "@/lib/taskDates";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const IS_LA = TZ === "America/Los_Angeles";
const laOnly = IS_LA ? it : it.skip;

afterEach(() => {
  vi.useRealTimers();
});

describe("environment", () => {
  it("reports the timezone the LA cases require", () => {
    expect(typeof TZ).toBe("string");
  });
});

describe("parseLocalDateInput / localDateInputToIso", () => {
  it("parses a date input as local midnight", () => {
    const d = parseLocalDateInput("2026-09-28")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 8, 28, 0, 0]);
    expect(localDateInputToIso("2026-09-28")).toBe(new Date(2026, 8, 28).toISOString());
  });

  it.each(["", "2026-9-28", "09/28/2026", "2026-02-31", "garbage"])("rejects %p", (value) => {
    expect(parseLocalDateInput(value)).toBeNull();
    expect(localDateInputToIso(value)).toBeNull();
  });

  laOnly("in Los Angeles the persisted instant is 07:00Z (PDT midnight), not UTC midnight", () => {
    expect(localDateInputToIso("2026-09-28")).toBe("2026-09-28T07:00:00.000Z");
  });
});

describe("today / validation", () => {
  laOnly("at noon PDT the default is the LOCAL date and today validates", () => {
    const noonPdt = new Date("2026-09-28T19:00:00.000Z");
    expect(todayLocalDateInput(noonPdt)).toBe("2026-09-28");
    expect(isLocalDateInputTodayOrLater("2026-09-28", noonPdt)).toBe(true);
    expect(isLocalDateInputTodayOrLater("2026-09-27", noonPdt)).toBe(false);
    expect(isLocalDateInputTodayOrLater("2026-09-29", noonPdt)).toBe(true);
  });

  laOnly("at 9:30 PM PDT the default is still today (the UTC date is already tomorrow)", () => {
    const eveningPdt = new Date("2026-09-29T04:30:00.000Z");
    expect(todayLocalDateInput(eveningPdt)).toBe("2026-09-28");
  });

  it("a malformed date never validates", () => {
    expect(isLocalDateInputTodayOrLater("nope", new Date())).toBe(false);
  });
});

describe("getTaskDueStatus — TasksPanel's rule on the local day", () => {
  const now = new Date(2026, 8, 28, 12, 0, 0);

  it("completed wins", () => {
    expect(getTaskDueStatus(new Date(2026, 0, 1), "2026-01-02T00:00:00Z", now)).toBe("completed");
  });

  it("a task due today is 'today' all day, never overdue", () => {
    expect(getTaskDueStatus(new Date(2026, 8, 28, 0, 0), null, now)).toBe("today");
    expect(getTaskDueStatus(new Date(2026, 8, 28, 23, 0), null, now)).toBe("today");
  });

  it("overdue only once the local due day has passed", () => {
    expect(getTaskDueStatus(new Date(2026, 8, 27, 23, 59), null, now)).toBe("overdue");
  });

  it("future days are upcoming", () => {
    expect(getTaskDueStatus(new Date(2026, 8, 29, 0, 0), null, now)).toBe("upcoming");
  });

  it("defaults to the real clock, matching date-fns isPast/isToday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(getTaskDueStatus(new Date(2026, 8, 27), null)).toBe("overdue");
    expect(getTaskDueStatus(new Date(2026, 8, 28), null)).toBe("today");
  });

  laOnly("a date picked for 9/28 and stored as local midnight is 'today' on 9/28 in LA", () => {
    const stored = localDateInputToIso("2026-09-28")!;
    expect(getTaskDueStatus(stored, null, new Date("2026-09-28T19:00:00.000Z"))).toBe("today");
  });
});

describe("endOfLocalDueDay", () => {
  it("is the last millisecond of the local due day", () => {
    const end = endOfLocalDueDay(new Date(2026, 8, 28, 9, 30));
    expect([end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([
      28, 23, 59, 59, 999,
    ]);
  });
});
