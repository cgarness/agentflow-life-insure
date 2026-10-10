/**
 * Reports durations and the summary as-of time. `formatElapsed` is the one on-screen duration format
 * (the Leaderboard's "28h 4m 3s"); precision 1 shows a payload's 0.1 s as sent, never rounded again.
 */
import { describe, expect, it } from "vitest";
import { formatAsOf, formatDuration, formatElapsed, formatHours } from "@/lib/reports-format";
import { formatTalkTime } from "@/components/leaderboard/leaderboardTypes";

describe("formatElapsed (whole seconds)", () => {
  it.each([
    [0, "0s"],
    [45, "45s"],
    [59, "59s"],
    [60, "1m 0s"],
    [201, "3m 21s"],
    [740, "12m 20s"],
    [1800, "30m 0s"],
    [3600, "1h 0m 0s"],
    [7200, "2h 0m 0s"],
    [9600, "2h 40m 0s"],
    [101_043, "28h 4m 3s"],
    [412_671, "114h 37m 51s"],
  ])("%s s → %s", (seconds, expected) => {
    expect(formatElapsed(seconds)).toBe(expected);
  });

  it("never uses the m:ss clock form that read as a time of day", () => {
    for (const seconds of [61, 740, 3599]) expect(formatElapsed(seconds)).not.toMatch(/^\d+:\d\d$/);
  });

  it("matches the Leaderboard talk-time format for every whole number of seconds", () => {
    for (const seconds of [0, 1, 45, 59, 60, 61, 201, 599, 740, 3599, 3600, 3661, 86_399, 86_400, 101_043, 412_671]) {
      expect(formatElapsed(seconds), String(seconds)).toBe(formatTalkTime(seconds));
    }
  });

  it("an unknown or impossible duration is a dash, never 0s", () => {
    for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -0.01]) {
      expect(formatElapsed(bad as number | null | undefined)).toBe("—");
    }
    expect(formatElapsed("12" as unknown as number)).toBe("—");
    expect(formatElapsed(-0)).toBe("0s");
  });
});

describe("formatElapsed (0.1 s payload fields)", () => {
  it.each([
    [152.5, "2m 32.5s"],
    [38.9, "38.9s"],
    [40.2, "40.2s"],
    [81.4, "1m 21.4s"],
    [25.3, "25.3s"],
    [100, "1m 40.0s"],
    [0, "0.0s"],
    [152.3, "2m 32.3s"],
    [3600.1, "1h 0m 0.1s"],
  ])("%s s → %s", (seconds, expected) => {
    expect(formatElapsed(seconds, 1)).toBe(expected);
  });

  it("keeps the server's rounded average instead of rounding it a second time (R-5)", () => {
    // Live: exact mean 152.487 s → payload round(avg, 1) = 152.5 → previously shown as "2:33".
    expect(formatElapsed(152.5, 1)).toBe("2m 32.5s");
    expect(formatElapsed(152.5, 1)).not.toMatch(/2:33|2m 33s/);
    expect(formatDuration(152.5)).toBe("2:33"); // the old double-rounded display, kept only as an export helper
  });

  it("carries a tenth that rounds up into the next second or minute", () => {
    expect(formatElapsed(59.96, 1)).toBe("1m 0.0s");
    expect(formatElapsed(9.99, 1)).toBe("10.0s");
  });

  it("an unknown or impossible value is a dash at either precision", () => {
    for (const bad of [null, undefined, Number.NaN, -0.1]) expect(formatElapsed(bad as number | null | undefined, 1)).toBe("—");
  });
});

describe("existing duration helpers stay exported and unchanged", () => {
  it("formatHours and formatDuration", () => {
    expect(formatHours(36_305)).toBe("10h 5m 5s");
    expect(formatHours(264)).toBe("0h 4m 24s");
    expect(formatDuration(38.9)).toBe("0:39");
    expect(formatHours(null)).toBe("—");
  });
});

describe("formatAsOf", () => {
  const ZONE = "America/Los_Angeles";
  const AS_OF = "2026-10-09T03:44:11.98730+00:00"; // 8:44 PM PDT on the agency date Oct 8

  it("shows the agency wall-clock time when the instant falls on the agency today", () => {
    expect(formatAsOf(AS_OF, ZONE, "2026-10-08")).toBe("8:44 PM PDT");
  });

  it("prefixes the agency date when the instant is not on the agency today", () => {
    expect(formatAsOf(AS_OF, ZONE, "2026-10-09")).toBe("Oct 8, 8:44 PM PDT");
    expect(formatAsOf("2026-01-02T17:05:00Z", ZONE, "2026-01-03")).toBe("Jan 2, 9:05 AM PST");
  });

  it("uses the agency zone, not UTC or the browser zone", () => {
    expect(formatAsOf(AS_OF, "UTC", "2026-10-09")).toBe("3:44 AM UTC");
    expect(formatAsOf(AS_OF, "America/New_York", "2026-10-08")).toBe("11:44 PM EDT");
  });

  it("uses plain spaces, so the text is stable across ICU versions", () => {
    expect(formatAsOf(AS_OF, ZONE, "2026-10-08")).not.toMatch(/[\u00a0\u202f]/);
  });

  it("an unreadable instant or zone is a dash, never a guessed time", () => {
    expect(formatAsOf("not a date", ZONE, "2026-10-08")).toBe("—");
    expect(formatAsOf("", ZONE, "2026-10-08")).toBe("—");
    expect(formatAsOf(AS_OF, "Not/AZone", "2026-10-08")).toBe("—");
  });
});
