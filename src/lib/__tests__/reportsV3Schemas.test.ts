import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REASON_KIND, REPORT_V3_REASON_CODES, kpiEnvelopeSchema, reportCallVolumeV3Schema, reportCampaignCallsV3Schema,
  reportDispositionsV3Schema, reportJourneyV3Schema, reportLeadSourceCallsV3Schema, reportSalesAppointmentsV3Schema,
  reportScopeV3Schema, reportStateBreakdownV3Schema, reportSummaryV3Schema,
} from "@/lib/reports-v3-schemas";
import { REASON_NOTICES, SHORT_CUES } from "@/lib/reports-v3-text";
import { BC4_CASES, env } from "./reportsV3Fixtures";

const foundation = readFileSync("supabase/migrations/20261101000010_reports_v3_foundation.sql", "utf8");
const sqlCodes = [...foundation.match(/report_v3_reason_codes\(\)[\s\S]*?ARRAY\[([\s\S]*?)\]::text\[\]/)![1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

describe("reason registry (SQL = Zod = notices = cues)", () => {
  it("has the 29 SQL codes in registry order", () => {
    expect(sqlCodes).toHaveLength(29);
    expect([...REPORT_V3_REASON_CODES]).toEqual(sqlCodes);
    expect(Object.keys(REASON_NOTICES)).toEqual(sqlCodes);
    expect(Object.keys(SHORT_CUES)).toEqual(sqlCodes);
  });
  it("kinds follow the registry blocks (5 config, 9 zero, 14 coverage, 1 export)", () => {
    const counts = Object.values(REASON_KIND).reduce((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {} as Record<string, number>);
    expect(counts).toEqual({ config: 5, zero: 9, coverage: 14, export: 1 });
  });
});

describe("BC4 truth table (Zod)", () => {
  for (const c of BC4_CASES) {
    it(`case ${c.n}: ${c.scenario}`, () => {
      for (const e of c.envelopes) {
        const r = kpiEnvelopeSchema.safeParse(e);
        expect(r.success, JSON.stringify(!r.success && r.error.issues)).toBe(true);
        expect(e.status).toBe(c.expect[e.id].csvStatus);
      }
    });
  }
});

describe("fail closed", () => {
  const ok = env({ id: 2, value: 3 });
  it("accepts a plain available envelope", () => expect(kpiEnvelopeSchema.safeParse(ok).success).toBe(true));
  it.each([
    ["an unknown reason code", { ...ok, status: "unavailable", value: null, reason: "made_up_code" }],
    ["panel_not_loaded from SQL", { ...ok, status: "unavailable", value: null, reason: "panel_not_loaded" }],
    ["an unavailable envelope with a value", { ...ok, status: "unavailable", reason: "no_policies_sold" }],
    ["a ratio over a known denominator of 0", env({ id: 9, value: 1, numerator: 1, denominator: 0 })],
    ["a partial envelope without unassessable items", env({ id: 9, value: 1, status: "partial", reason: "attempt_unverified", numerator: 1, denominator: 1,
      coverage: { eligible: 1, assessable: 1, unassessable: 0, reasons: { attempt_unverified: 0 } } })],
    ["maturity on a KPI other than 12, 18 and 19", env({ id: 2, value: 1, maturity: { window_days: 30, state: "complete", members: 1, pending: 0,
      successes_to_date: 0, mature_members: 1, mature_successes: 0, fully_mature_on: null } })],
    ["an available KPI 19 without maturity", env({ id: 19, value: 0, numerator: 0, denominator: 4 })],
    ["an unknown detail key", env({ id: 5, value: 1, detail: { call_population: { attempts: 1, non_attempts: 0, unverified: 0, duplicates_excluded: 0 }, extra: 1 } })],
    ["coverage that does not add up", env({ id: 7, value: 1, status: "partial", reason: "unlinked_contacted_calls",
      coverage: { eligible: 5, assessable: 3, unassessable: 1, reasons: { unlinked_contacted_calls: 1 } } })],
  ])("refuses %s", (_label, e) => expect(kpiEnvelopeSchema.safeParse(e).success).toBe(false));
  it("refuses a v2-shaped payload and a wrong major version", () => {
    expect(reportSummaryV3Schema.safeParse({ totals: {}, window: {} }).success).toBe(false);
    expect(reportScopeV3Schema.safeParse({ basis_version: "reports_v3", contract_version: "4.0.0" }).success).toBe(false);
  });
});

const payloadPath = process.env.REPORTS_V3_PAYLOADS;
describe.runIf(!!payloadPath && existsSync(payloadPath))("real SQL payloads (REPORTS_V3_PAYLOADS)", () => {
  const schemas = { scopeV3: reportScopeV3Schema, summaryV3: reportSummaryV3Schema, journeyV3: reportJourneyV3Schema,
    salesAppointmentsV3: reportSalesAppointmentsV3Schema, statesV3: reportStateBreakdownV3Schema, volumeV3: reportCallVolumeV3Schema,
    dispositionsV3: reportDispositionsV3Schema, campaignsV3: reportCampaignCallsV3Schema, leadSourcesV3: reportLeadSourceCallsV3Schema };
  it("parses every reader at agency, team and personal scope", () => {
    const p = JSON.parse(readFileSync(payloadPath!, "utf8"));
    const failures: string[] = [];
    for (const scope of ["agency", "team", "personal"]) {
      const bundle = scope === "agency" ? p : p.scopes[scope];
      for (const [key, schema] of Object.entries(schemas)) if (!schema.safeParse(bundle[key]).success) failures.push(`${scope}/${key}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("the unit-test v3 bundle is contract-valid at every scope", () => {
  it.each(["agency", "team", "personal"] as const)("%s", async (requestedScope) => {
    const { buildV3Bundle } = await import("./reportsV3Fixtures");
    const b = buildV3Bundle({ requestedScope, startDate: "2026-06-16", endDate: "2026-07-15" });
    const schemas: Record<string, { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } }> = {
      scopeV3: reportScopeV3Schema, summaryV3: reportSummaryV3Schema, journeyV3: reportJourneyV3Schema, salesAppointmentsV3: reportSalesAppointmentsV3Schema,
      statesV3: reportStateBreakdownV3Schema, volumeV3: reportCallVolumeV3Schema, dispositionsV3: reportDispositionsV3Schema,
      campaignsV3: reportCampaignCallsV3Schema, leadSourcesV3: reportLeadSourceCallsV3Schema };
    const bad = Object.entries(schemas).flatMap(([k, s]) => { const r = s.safeParse(b[k]); return r.success ? [] : [`${k}: ${JSON.stringify(r.error?.issues.slice(0, 2))}`]; });
    expect(bad).toEqual([]);
  });
});
