import { describe, expect, it } from "vitest";
import { buildReportCsv, KPI_COVERAGE_HEADERS } from "@/lib/reports-export";
import { agentCsv, agentRows, kpiNotes, kpiRows, stateCsv, STATE_CSV_HEADERS, unattributed } from "@/lib/reports-v3-export";
import type { Panels } from "@/lib/reports-panels";
import { reportStateBreakdownV3Schema } from "@/lib/reports-v3-schemas";
import { STATE_BASIS_NOTE } from "@/lib/reports-v3-text";
import { BC4_CASES, buildV3Bundle, env, T_PEER, T_SELF } from "./reportsV3Fixtures";

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

const bundle = () => buildV3Bundle({ requestedScope: "agency", startDate: "2026-06-16", endDate: "2026-07-15", agentId: null });

describe("Regional performance CSV (D5 §4)", () => {
  const states = () => reportStateBreakdownV3Schema.parse(bundle().statesV3);
  it("writes 51 states, Mapped total, 6 Unmapped rows, Unmapped total and Total, in that order", () => {
    const f = stateCsv(states());
    expect(f.headers).toEqual(STATE_CSV_HEADERS);
    expect(f.headers).toHaveLength(15);
    expect(f.rows).toHaveLength(51 + 1 + 6 + 1 + 1);
    expect(f.rows.slice(51).map(r => r[0])).toEqual(["Mapped total", "Unmapped", "Unmapped", "Unmapped", "Unmapped", "Unmapped", "Unmapped", "Unmapped total", "Total"]);
    expect(f.rows[52][1]).toBe("No state recorded");
    expect(f.rows.every(r => r.length === 15)).toBe(true);
  });
  it("rounds AP once from exact cents at 2 dp and reconciles rows to the totals", () => {
    const f = stateCsv(states());
    const ca = f.rows.find(r => r[0] === "CA")!;
    expect(ca.slice(1, 6)).toEqual(["California", 150, 40, 4, "4000.50"]);
    const mapped = f.rows[51], unmapped = f.rows[58], total = f.rows[59];
    expect([mapped[2], unmapped[2], total[2]]).toEqual([150, 50, 200]);
    expect(mapped[5]).toBe("4000.50");
    expect(total[5]).toBe("4000.50");
  });
  it("leaves AP blank and adds the mode's notice when AP is unavailable; always writes the state basis note", () => {
    const raw = bundle().statesV3;
    raw.modes.ap = { metric_id: 1, status: "unavailable", reason: "no_policies_sold" };
    const f = stateCsv(reportStateBreakdownV3Schema.parse(raw));
    expect(f.rows.every(r => r[5] === null)).toBe(true);
    expect(f.notes[0]).toBe(STATE_BASIS_NOTE);
    expect(f.notes).toContain("AP: No policies sold in this period");
  });
  it("does not repeat the unverified-attempt notice the call notes already carry", () => {
    const raw = bundle().statesV3;
    raw.modes.calls_made = { metric_id: 5, status: "partial", reason: "attempt_unverified" };
    expect(stateCsv(reportStateBreakdownV3Schema.parse(raw)).notes).toEqual([STATE_BASIS_NOTE]);
  });
});

describe("Agent performance CSV (D6 §4.6, §4.9)", () => {
  const ready = (data: unknown) => ({ status: "ready", data }) as never;
  const panels = (over: Partial<Panels> = {}): Panels => {
    const b = bundle();
    const loading = { status: "loading" } as const;
    return { states: loading, volume: loading, dispositions: loading, campaigns: loading, leadSources: loading, summary: ready(b.summaryV3), journey: ready(b.journeyV3), salesAppointments: ready(b.salesAppointmentsV3), ...over };
  };
  it("joins each agent's columns on agent_id in server order", () => {
    const rows = agentRows(panels());
    expect(rows.map(r => r.id)).toEqual([T_SELF, T_PEER]);
    expect(rows[0].cells.every(Boolean)).toBe(true);
    const f = agentCsv(rows, null);
    expect(f.headers[0]).toBe("Agent");
    expect(f.headers).toHaveLength(10);
    expect(f.rows[0][0]).toBe("Avery Self");
  });
  it("a panel that is not current contributes blank cells and a not-loaded Note, never a value", () => {
    const rows = agentRows(panels(), k => k !== "journey");
    const at = rows[0].cells.findIndex(c => c === null);
    expect(at).toBeGreaterThan(0);
    const f = agentCsv(rows, null);
    expect(f.rows.every(r => r[at + 1] === null)).toBe(true);
    expect(f.notes).toContain("1 Call Close: not loaded");
  });
  it("writes nothing when the summary is not current", () => {
    expect(agentRows(panels(), k => k !== "summary")).toEqual([]);
    expect(agentRows(panels({ summary: { status: "error", kind: "timeout" } as never }))).toEqual([]);
  });
  it("adds the agency Unattributed row only when above 0", () => {
    const f = agentCsv(agentRows(panels()), { policies: 2, ap: 1000.125 });
    expect(f.rows.at(-1)!.slice(0, 3)).toEqual(["Unattributed", 2, "1000.13"]);
    expect(agentCsv(agentRows(panels()), { policies: 0, ap: null }).rows).toHaveLength(2);
    expect(unattributed(panels({ summary: { status: "loading" } as never }))).toEqual({ policies: null, ap: null });
  });
});
