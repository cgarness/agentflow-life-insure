import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, DEFAULT_VISIBLE_STATS, MAX_VISIBLE_STATS, REPORT_LAYOUT_SECTIONS, normalizeReportLayout } from "@/lib/report-layout-constants";

describe("personal Reports layout normalization", () => {
  it("has six approved default metrics and excludes fixed or unavailable sections", () => {
    const normalized = normalizeReportLayout(null);
    expect(normalized.version).toBe(4);
    expect(normalized.sections.filter((s) => s.id.startsWith("stat_") && s.visible).map((s) => s.id)).toEqual(DEFAULT_VISIBLE_STATS);
    expect(DEFAULT_VISIBLE_STATS).toHaveLength(MAX_VISIBLE_STATS);
    for (const id of ["call_volume", "policies_sold", "stat_policies_sold", "stat_annual_premium", "goal_tracking", "stat_unique_leads"]) {
      expect(normalized.sections.some((s) => s.id === id)).toBe(false);
    }
    normalized.sections[0].visible = false;
    expect(DEFAULT_LAYOUT.sections[0].visible).toBe(true);
    expect(normalizeReportLayout(null).sections[0].visible).toBe(true);
  });

  it.each([2, 3, 4])("preserves valid v%i choices and within-group order without mutating input", (version) => {
    const sections = [
      { id: "campaign_performance", visible: false }, { id: "stat_inbound", visible: true },
      { id: "lead_source_roi", visible: true }, { id: "stat_total_dials", visible: false },
      { id: "disposition_deep_dive", visible: false }, { id: "calling_heatmap", visible: true },
    ];
    sections.forEach(Object.freeze);
    const saved = Object.freeze({ version, sections: Object.freeze(sections) });
    const result = normalizeReportLayout(saved);
    expect(result.sections.slice(0, 2)).toEqual([{ id: "stat_inbound", visible: true }, { id: "stat_total_dials", visible: false }]);
    expect(result.sections.filter((s) => ["campaign_performance", "lead_source_roi"].includes(s.id))).toEqual(sections.filter((s) => ["campaign_performance", "lead_source_roi"].includes(s.id)));
    expect(result.sections.find((s) => s.id === "stat_total_contacted")?.visible).toBe(false);
    expect(result.sections.find((s) => s.id === "disposition_deep_dive")?.visible).toBe(false);
    expect(result.sections.find((s) => s.id === "stat_inbound")).not.toBe(sections[1]);
    expect(normalizeReportLayout(result)).toEqual(result);
  });

  it("migrates v1 tabs in their saved order, validates fields and deduplicates first valid entry", () => {
    const result = normalizeReportLayout({ version: 1, tabs: {
      overview: [null, { id: "stat_inbound", visible: "yes" }, { id: "stat_inbound", visible: false }],
      calls: [{ id: "stat_inbound", visible: true }, { id: "stat_total_dials", visible: true }, { id: "call_volume", visible: false }],
      pipeline: [42, { id: "unknown", visible: true }], team: "invalid",
    } });
    expect(result.sections.slice(0, 2)).toEqual([{ id: "stat_inbound", visible: false }, { id: "stat_total_dials", visible: true }]);
    expect(new Set(result.sections.map((s) => s.id)).size).toBe(result.sections.length);
    expect(result.sections.every((s) => typeof s.visible === "boolean")).toBe(true);
  });

  it("caps legacy visible metrics at six and does not mutate frozen objects", () => {
    const sections = REPORT_LAYOUT_SECTIONS.filter((s) => s.group === "stats").map((s) => Object.freeze({ id: s.id, visible: true }));
    const result = normalizeReportLayout({ version: 3, sections: Object.freeze(sections) });
    expect(result.sections.filter((s) => s.id.startsWith("stat_") && s.visible)).toHaveLength(6);
    expect(sections.every((s) => s.visible)).toBe(true);
  });

  it.each([null, undefined, [], 2, { version: 99, sections: [] }, { version: 3, sections: null }])("returns a fresh default for unsupported input %j", (saved) => {
    const result = normalizeReportLayout(saved);
    expect(result).toEqual(DEFAULT_LAYOUT);
    expect(result).not.toBe(DEFAULT_LAYOUT);
    expect(result.sections[0]).not.toBe(DEFAULT_LAYOUT.sections[0]);
  });
});
