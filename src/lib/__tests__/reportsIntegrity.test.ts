import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { reportCampaignsSchema, reportDispositionsSchema, reportLeadSourcesSchema, reportScopeSchema, reportSummarySchema, reportVolumeSchema } from "@/lib/reports-schemas";
import { computeAllStats } from "@/lib/stat-computations";
import { formatHours, formatPremium, groupDailySeries } from "@/lib/reports-format";
import { integrityExportNotes, qualityNotes } from "@/lib/reports-integrity-text";
import type { ReportQuality } from "@/lib/reports-schemas";
import { premium, quality, reportCampaigns, reportLeadSources, reportSummary, reportVolume } from "./reportsFixtures";

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

const withQuality = (over: { duration?: Partial<ReportQuality["duration"]>; sessions?: Partial<ReportQuality["sessions"]>; duplicates?: Partial<ReportQuality["duplicates"]>; bookings?: Partial<ReportQuality["bookings"]> }): ReportQuality => {
  const q = quality();
  return { ...q, duration: { ...q.duration, ...over.duration }, sessions: { ...q.sessions, ...over.sessions }, duplicates: { ...q.duplicates, ...over.duplicates }, bookings: { ...q.bookings, ...over.bookings } };
};
const SESSIONS = (rows: string) => `Sessions assessed for this window: 2 stale open sessions capped at heartbeat, 0 with missing/invalid end evidence, ${rows}`;

describe("session duplicate seconds (R-3 frontend guard)", () => {
  it("prints 0 duplicate seconds when no session rows overlap; the sentence shape is unchanged", () => {
    const q = withQuality({ sessions: { stale_capped: 2, overlapping_rows: 0, overlap_seconds_removed: 3 } });
    expect(qualityNotes(q)[3]).toBe(SESSIONS("0 overlapping rows; 0 duplicate seconds removed."));
  });

  it("keeps real overlaps exactly as reported", () => {
    const q = withQuality({ sessions: { stale_capped: 2, overlapping_rows: 2, overlap_seconds_removed: 1800 } });
    expect(qualityNotes(q)[3]).toBe(SESSIONS("2 overlapping rows; 1800 duplicate seconds removed."));
  });

  it("the CSV notes carry the same corrected sentence as the screen", () => {
    const notes = integrityExportNotes({ ...reportSummary(), quality: withQuality({ sessions: { stale_capped: 2, overlapping_rows: 0, overlap_seconds_removed: 3 } }) });
    expect(notes).toContain(SESSIONS("0 overlapping rows; 0 duplicate seconds removed."));
    expect(notes.join(" ")).not.toContain("3 duplicate seconds");
  });
});

describe("data-quality nouns (R-6)", () => {
  it("uses the singular only for exactly 1 estimate or 1 conflict, the approved R-6 change", () => {
    const q = withQuality({ duration: { estimated_calls: 1, conflicting_calls: 1, outbound_calls: 1, unknown_calls: 0 }, sessions: { stale_capped: 2, overlapping_rows: 1, overlap_seconds_removed: 1 } });
    const [duration, , , sessions] = qualityNotes(q);
    expect(duration).toBe("Stored outbound duration: 1 estimate, 0 unknown provenance or amount, 1 conflict across 1 calls. Counts can overlap.");
    expect(sessions).toBe(SESSIONS("1 overlapping rows; 1 duplicate seconds removed."));
  });

  it("every other count noun keeps its base CSV bytes at 1 (data-basis-wording: only R-3 and R-6 may change a Note)", () => {
    // Base (8d53531) sentences with every count at 1, except that R-6 makes "estimates"/"conflicts" singular.
    const q = withQuality({
      duration: { outbound_calls: 1, estimated_calls: 1, unknown_calls: 1, conflicting_calls: 1 },
      duplicates: { excluded_outbound_calls: 1, excluded_bookings: 1 },
      bookings: { all_types: 1, appointment_kind: 1, callback_kind: 1, unknown_kind: 1 },
      sessions: { stale_capped: 1, missing_evidence: 1, overlapping_rows: 1, overlap_seconds_removed: 1 },
    });
    expect(qualityNotes(q)).toEqual([
      "Stored outbound duration: 1 estimate, 1 unknown provenance or amount, 1 conflict across 1 calls. Counts can overlap.",
      "Only reviewed mappings excluded: 1 outbound calls and 1 bookings. Unreviewed historical candidates remain included.",
      "Bookings created (all types): 1; recorded kind: 1 appointment, 1 callback, 1 unknown. Callback dispositions count calls, not callback bookings.",
      "Sessions assessed for this window: 1 stale open sessions capped at heartbeat, 1 with missing/invalid end evidence, 1 overlapping rows; 1 duplicate seconds removed.",
    ]);
  });

  it("keeps the plural for 0 and for more than 1", () => {
    const q = withQuality({ duration: { estimated_calls: 2, conflicting_calls: 0 } });
    expect(qualityNotes(q)[0]).toBe("Stored outbound duration: 2 estimates, 19 unknown provenance or amount, 0 conflicts across 19 calls. Counts can overlap.");
  });

  it("leaves the synthetic browser-fixture notes byte-identical (agency 2 rows / 1800 s; team and personal all zero)", () => {
    const agency = withQuality({
      duration: { outbound_calls: 5, estimated_calls: 0, unknown_calls: 5, conflicting_calls: 0 },
      duplicates: { excluded_outbound_calls: 1, excluded_bookings: 1 },
      bookings: { all_types: 2, appointment_kind: 1, callback_kind: 1, unknown_kind: 0 },
      sessions: { stale_capped: 1, missing_evidence: 0, overlapping_rows: 2, overlap_seconds_removed: 1800 },
    });
    expect(qualityNotes(agency)).toEqual([
      "Stored outbound duration: 0 estimates, 5 unknown provenance or amount, 0 conflicts across 5 calls. Counts can overlap.",
      "Only reviewed mappings excluded: 1 outbound calls and 1 bookings. Unreviewed historical candidates remain included.",
      "Bookings created (all types): 2; recorded kind: 1 appointment, 1 callback, 0 unknown. Callback dispositions count calls, not callback bookings.",
      "Sessions assessed for this window: 1 stale open sessions capped at heartbeat, 0 with missing/invalid end evidence, 2 overlapping rows; 1800 duplicate seconds removed.",
    ]);
    const zero = withQuality({
      duration: { outbound_calls: 0, estimated_calls: 0, unknown_calls: 0, conflicting_calls: 0 },
      bookings: { all_types: 0, appointment_kind: 0, callback_kind: 0, unknown_kind: 0 },
    });
    expect(qualityNotes(zero)).toEqual([
      "Stored outbound duration: 0 estimates, 0 unknown provenance or amount, 0 conflicts across 0 calls. Counts can overlap.",
      "Only reviewed mappings excluded: 0 outbound calls and 0 bookings. Unreviewed historical candidates remain included.",
      "Bookings created (all types): 0; recorded kind: 0 appointment, 0 callback, 0 unknown. Callback dispositions count calls, not callback bookings.",
      "Sessions assessed for this window: 0 stale open sessions capped at heartbeat, 0 with missing/invalid end evidence, 0 overlapping rows; 0 duplicate seconds removed.",
    ]);
  });
});
