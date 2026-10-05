import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { reportCampaignsSchema, reportDispositionsSchema, reportLeadSourcesSchema, reportScopeSchema, reportSummarySchema, reportVolumeSchema } from "@/lib/reports-schemas";
import { computeAllStats } from "@/lib/stat-computations";
import { formatHours, formatPremium, groupDailySeries } from "@/lib/reports-format";
import { integrityExportNotes } from "@/lib/reports-integrity-text";
import { premium, reportCampaigns, reportLeadSources, reportSummary, reportVolume } from "./reportsFixtures";

const schemas = { scope: reportScopeSchema, summary: reportSummarySchema, volume: reportVolumeSchema, dispositions: reportDispositionsSchema, campaigns: reportCampaignsSchema, leadSources: reportLeadSourcesSchema };
const payloadPath = process.env.REPORTS_SQL_PAYLOADS;
describe("Reports v2 integrity", () => {
  it.runIf(!!payloadPath)("accepts all six actual PostgreSQL responses through runtime contracts", () => {
    const data = JSON.parse(readFileSync(payloadPath!, "utf8"));
    for (const [key, schema] of Object.entries(schemas)) expect(schema.safeParse(data[key]).success, key).toBe(true);
  });
  it("fails closed for a v1, unversioned or incomplete summary", () => {
    for (const field of ["as_of", "basis_version", "quality", "requested_scope"]) {
      const old = { ...reportSummary() }; delete old[field];
      expect(reportSummarySchema.safeParse(old).success, field).toBe(false);
    }
    const old = reportSummary(); delete old.totals.session_matched_calls;
    expect(reportSummarySchema.safeParse(old).success).toBe(false);
  });
  it("distinguishes empty zero, genuine zero and unknown premiums while retaining cents", () => {
    expect(formatPremium(premium().annual_premium)).toBe("$0.00");
    expect(formatPremium(premium(1, 1, 0).annual_premium)).toBe("$0.00");
    expect(formatPremium(premium(1, 0).annual_premium)).toBe("—");
    expect(formatPremium(premium(2, 1, 10.01).annual_premium)).toBe("$120.12");
  });
  it("unmatched calls never inflate either session rate", () => {
    const summary = reportSummary({ calls_made: 999, talk_time_seconds: 99999, session_matched_calls: 3, session_matched_talk_seconds: 90, session_seconds: 3600 });
    const stats = computeAllStats({ summary: { status: "ready", data: summary }, volume: { status: "ready", data: reportVolume() }, agencyToday: "2026-07-20", dayCount: 31 });
    expect(stats.get("stat_total_dials")!.value).toBe("999");
    expect(stats.get("stat_calls_per_hour")!.value).toBe("3.0");
    expect(stats.get("stat_talk_time_ratio")!.value).toBe("2.5%");
  });
  it("retains hour seconds and groups Sunday into its preceding Monday", () => {
    expect(formatHours(3661)).toBe("1h 1m 1s");
    const grouped = groupDailySeries([{ date: "2026-07-05", calls: 1 }, { date: "2026-07-06", calls: 2 }], "weekly", ["calls"]);
    expect(grouped.map((b) => [b.key, b.calls])).toEqual([["2026-06-29", 1], ["2026-07-06", 2]]);
  });
  it("exports provenance, coverage and non-identifying unavailable subsets", () => {
    const notes = integrityExportNotes(reportSummary()).join(" ");
    expect(notes).toContain("calculated independently");
    expect(notes).toContain("Only reviewed mappings excluded");
    expect(notes).toContain("4/5 policies known, 1 unknown");
    expect(notes).toContain("6 unmatched calls retained");
    expect(integrityExportNotes(reportCampaigns()).join(" ")).toContain("Campaign attribution unavailable");
    expect(integrityExportNotes(reportLeadSources()).join(" ")).toContain("Source policies, premium and conversions are unavailable");
  });
});
