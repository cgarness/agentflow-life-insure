/**
 * reports-export + reports-format — CSV safety and labelling, agency-calendar arithmetic, grouping.
 */
import { describe, expect, it } from "vitest";
import { buildReportCsv, csvFileName, sanitizeCsvText } from "@/lib/reports-export";
import {
  addDays, autoGrouping, bucketKey, dayCount, formatHours, formatRate, groupDailySeries, presetRange, ratio, validateRange,
} from "@/lib/reports-format";
import { reportWindow } from "./reportsFixtures";

describe("CSV export", () => {
  it("neutralizes spreadsheet formula triggers in text cells", () => {
    for (const v of ["=HYPERLINK(1)", "+1", "-2+3", "@SUM(A1)", "\tx", "\rx"]) {
      expect(sanitizeCsvText(v).startsWith("'")).toBe(true);
    }
    expect(sanitizeCsvText("Facebook")).toBe("Facebook");
  });

  it("keeps numbers numeric (a negative number is data, not a formula) and quotes/escapes text", () => {
    const csv = buildReportCsv(
      { report: "Campaigns", scope: "team", agentLabel: "Whole team", window: reportWindow(), generatedAt: new Date("2026-07-20T12:00:00Z") },
      ["Campaign", "Calls", "Rate"],
      [['=cmd|"x"', 4, null], ["Spring Team", -1, 75]],
    );
    const lines = csv.split("\n");
    expect(lines).toContain(`"'=cmd|""x""",4,""`);
    expect(lines).toContain(`"Spring Team",-1,75`);
  });

  it("labels every file with report, scope, agent filter, agency period and time zone", () => {
    const csv = buildReportCsv(
      { report: "Report Summary", scope: "organization", agentLabel: "All agents", window: reportWindow({ time_zone: "America/Chicago" }) },
      ["Metric", "Value"],
      [["Calls made (outbound)", 19]],
    );
    expect(csv).toContain(`"Scope","Organization"`);
    expect(csv).toContain(`"Agent filter","All agents"`);
    expect(csv).toContain(`"Period","2026-07-01 to 2026-07-31"`);
    expect(csv).toContain(`"Time zone","America/Chicago"`);
    expect(csv).not.toMatch(/default/i);
    expect(csvFileName("Report Summary", reportWindow())).toBe("report-summary-2026-07-01-to-2026-07-31.csv");
  });
});

describe("agency calendar arithmetic", () => {
  it("resolves presets against the AGENCY today, never the browser clock", () => {
    expect(presetRange("today", "2026-03-08")).toEqual({ startDate: "2026-03-08", endDate: "2026-03-08" });
    expect(presetRange("yesterday", "2026-03-01")).toEqual({ startDate: "2026-02-28", endDate: "2026-02-28" });
    expect(presetRange("7d", "2026-03-08")).toEqual({ startDate: "2026-03-02", endDate: "2026-03-08" });
    expect(presetRange("30d", "2026-03-08")).toEqual({ startDate: "2026-02-07", endDate: "2026-03-08" });
    expect(presetRange("month", "2026-11-01")).toEqual({ startDate: "2026-11-01", endDate: "2026-11-01" });
    expect(presetRange("lastMonth", "2026-03-15")).toEqual({ startDate: "2026-02-01", endDate: "2026-02-28" });
    expect(presetRange("lastMonth", "2028-03-15")).toEqual({ startDate: "2028-02-01", endDate: "2028-02-29" });
    expect(presetRange("lastMonth", "2026-01-10")).toEqual({ startDate: "2025-12-01", endDate: "2025-12-31" });
  });

  it("is immune to DST: calendar days never shift", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(dayCount({ startDate: "2026-03-01", endDate: "2026-03-31" })).toBe(31);
  });

  it("validates ranges like the server (order, max days, real dates)", () => {
    expect(validateRange({ startDate: "2026-07-31", endDate: "2026-07-01" }, 366)).toBe("order");
    expect(validateRange({ startDate: "2025-07-31", endDate: "2026-07-31" }, 366)).toBeNull();
    expect(validateRange({ startDate: "2025-07-30", endDate: "2026-07-31" }, 366)).toBe("too_long");
    expect(validateRange({ startDate: "2026-02-30", endDate: "2026-03-01" }, 366)).toBe("order");
  });

  it("groups the server's daily series exactly and chronologically across months", () => {
    const rows = [
      { date: "2026-06-29", calls_made: 1 }, { date: "2026-06-30", calls_made: 2 },
      { date: "2026-07-01", calls_made: 3 }, { date: "2026-07-05", calls_made: 4 },
    ];
    const weekly = groupDailySeries(rows, "weekly", ["calls_made"]);
    expect(weekly.map((b) => b.key)).toEqual(["2026-06-28", "2026-07-05"]);
    expect(weekly.map((b) => b.calls_made)).toEqual([6, 4]);
    const monthly = groupDailySeries(rows, "monthly", ["calls_made"]);
    // Both months are clipped by the rows, so they are labelled with the days they really cover.
    expect(monthly.map((b) => [b.label, b.calls_made])).toEqual([["Jun 29 – Jun 30", 3], ["Jul 01 – Jul 05", 7]]);
    expect(weekly.map((b) => b.label)).toEqual(["Jun 29 – Jul 01", "Jul 05 – Jul 05"]);
    const fullJuly = Array.from({ length: 31 }, (_, i) => ({ date: `2026-07-${String(i + 1).padStart(2, "0")}`, calls_made: 1 }));
    expect(groupDailySeries(fullJuly, "monthly", ["calls_made"])[0].label).toBe("Jul 2026");
    expect(groupDailySeries(fullJuly, "weekly", ["calls_made"])[1].label).toBe("Week of Jul 05");
    expect(bucketKey("2026-07-04", "weekly")).toBe("2026-06-28"); // Saturday -> preceding Sunday
    expect(autoGrouping({ startDate: "2026-07-01", endDate: "2026-07-31" })).toBe("weekly");
  });

  it("renders an undefined rate as a dash, never 0%", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(57.9)).toBe("57.9%");
    expect(formatRate(0)).toBe("0.0%");
    expect(ratio(3, 0)).toBeNull();
  });

  it("formats hours without ever producing a 60-minute remainder", () => {
    expect(formatHours(3599)).toBe("1h 0m");
    expect(formatHours(7170)).toBe("2h 0m");
    expect(formatHours(7169)).toBe("1h 59m");
    expect(formatHours(0)).toBe("0h 0m");
    expect(formatHours(99_600)).toBe("27h 40m");
    expect(formatHours(null)).toBe("—");
  });
});
