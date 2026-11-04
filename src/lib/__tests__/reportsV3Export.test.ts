import { describe, expect, it } from "vitest";
import { buildReportCsv, KPI_COVERAGE_HEADERS } from "@/lib/reports-export";
import { kpiNotes, kpiRows } from "@/lib/reports-v3-export";
import { BC4_CASES, env } from "./reportsV3Fixtures";

const window = { time_zone: "America/Chicago", time_zone_source: "agency_settings" as const, start_date: "2026-07-01", end_date: "2026-07-14", start_at: "", end_at: "" };

describe("KPI coverage CSV (D6 §4.9)", () => {
  it("has the 21 columns", () => {
    expect(KPI_COVERAGE_HEADERS).toHaveLength(21);
    expect(KPI_COVERAGE_HEADERS.slice(0, 5)).toEqual(["Metric ID", "Metric", "Status", "In progress", "Value"]);
  });
  for (const c of BC4_CASES) {
    it(`BC4 case ${c.n}: ${c.scenario}`, () => {
      for (const e of c.envelopes) {
        const [row] = kpiRows([e.id], id => (id === e.id ? e : null));
        const want = c.expect[e.id];
        expect(row[2]).toBe(want.csvStatus);
        expect(row[4] ?? "").toBe(want.csvValue);
        expect(row[11] ?? "").toBe(want.csvReason);
        if (want.inProgress) expect(row[3]).toBe(want.inProgress);
      }
    });
  }
  it("marks a KPI whose panel is not current panel_not_loaded with every value blank", () => {
    const [row] = kpiRows([38], () => null);
    expect(row.slice(0, 3)).toEqual([38, "1 Call Close", "panel_not_loaded"]);
    expect(row.slice(3).every(v => v === null)).toBe(true);
  });
  it("fills the maturity columns only for the 30-day groups (RL-5) and keeps them on an unavailable cohort KPI (BC4)", () => {
    const rows = kpiRows([2, 12], id => (id === 2 ? env({ id: 2, value: 3 }) : BC4_CASES[9].envelopes[0]));
    const byId = Object.fromEntries(rows.map(r => [r[0], r]));
    expect(byId[2].slice(15)).toEqual([null, null, null, null, null, null]);
    expect(byId[2][12]).toBe("period");
    expect(byId[12][12]).toBe("observed_to_date");
    expect(byId[12][16]).toBe(6);
    expect(byId[12][4]).toBeNull();
  });
  it("writes money in dollars and cents, rounded once, including large amounts", () => {
    const [ap, avg] = kpiRows([1, 4], id => (id === 1 ? env({ id: 1, value: 123456789.01 }) : env({ id: 4, value: 41152263, numerator: 123456789.01, denominator: 3 })));
    expect(ap[4]).toBe("123456789.01");
    expect(avg[4]).toBe("41152263.00");
  });
  it("adds the v3 meta rows and the KPI notes; v2 callers without them are unchanged", () => {
    const e = env({ id: 9, value: 2.5, status: "partial", reason: "attempt_unverified", numerator: 5, denominator: 2, coverage: { eligible: 8, assessable: 5, unassessable: 3, reasons: { attempt_unverified: 3 } } });
    const csv = buildReportCsv({ report: "Report summary", scope: "organization", agentLabel: "All agents", window, generatedAt: new Date(0),
      contractVersion: "3.0.0", periodOpen: true, readerAsOf: [["summary", "2026-07-15T20:00:00Z"]], notes: kpiNotes([9], () => e) }, KPI_COVERAGE_HEADERS, kpiRows([9], () => e));
    expect(csv).toContain('"Contract version","3.0.0"');
    expect(csv).toContain('"As of (summary)","2026-07-15T20:00:00Z"');
    expect(csv).toContain("Calls per policy: 3 calls not verified as dialed");
    const v2 = buildReportCsv({ report: "X", scope: "organization", agentLabel: "All agents", window, generatedAt: new Date(0) }, ["A"], [[1]]);
    expect(v2).not.toMatch(/Contract version|Period open|As of \(/);
  });
});
