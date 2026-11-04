import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, V4_DEFAULT_VISIBLE_STATS, normalizeReportLayout } from "@/lib/report-layout-constants";

const strip = (l: ReturnType<typeof normalizeReportLayout>) => l.sections.filter(s => s.visible && s.id.startsWith("kpi_")).map(s => s.id);
const v4Default = () => ({ version: 4, sections: [...V4_DEFAULT_VISIBLE_STATS.map(id => ({ id, visible: true })),
  ...["stat_inbound", "stat_dnc_count"].map(id => ({ id, visible: false })),
  ...["agent_performance_cards", "campaign_performance", "lead_source_roi", "calling_heatmap", "call_flow_analysis", "call_duration_analysis", "disposition_deep_dive"].map(id => ({ id, visible: true }))] });

describe("layout v5 normalization (read-only)", () => {
  it("returns the v5 default for nothing, junk or an unknown version", () => {
    for (const saved of [null, undefined, 3, "x", [], { version: 9, sections: [] }, { version: 4 }]) expect(normalizeReportLayout(saved)).toEqual(DEFAULT_LAYOUT);
  });
  it("R23: an untouched v4 default deep-equals the v5 default", () => {
    expect(normalizeReportLayout(v4Default())).toEqual(DEFAULT_LAYOUT);
  });
  it("R23 applies only to the untouched v4 default: a reordered default or one more visible stat is mapped through V4_TO_V5", () => {
    const reordered = v4Default();
    reordered.sections.unshift(...reordered.sections.splice(2, 1));
    expect(strip(normalizeReportLayout(reordered))).toEqual(["kpi_8", "kpi_5", "kpi_6", "kpi_24", "kpi_25"]);
    const extra = v4Default();
    extra.sections.find(s => s.id === "stat_inbound")!.visible = true;
    expect(normalizeReportLayout(extra)).not.toEqual(DEFAULT_LAYOUT);
    expect(strip(normalizeReportLayout(extra))).toEqual(["kpi_5", "kpi_6", "kpi_8", "kpi_24", "kpi_25"]);
  });
  it("maps customized v4 stats in saved order; stat_total_dials before stat_outbound (first wins); fixed and retired ids drop", () => {
    const l = normalizeReportLayout({ version: 4, sections: [
      { id: "stat_total_talk_time", visible: true }, { id: "stat_total_dials", visible: true }, { id: "stat_outbound", visible: false },
      { id: "stat_avg_premium", visible: true }, { id: "stat_top_performer", visible: true }, { id: "agent_efficiency", visible: true }] });
    expect(strip(l)).toEqual(["kpi_24", "kpi_5"]);
    expect(l.sections.some(s => ["stat_avg_premium", "stat_top_performer", "agent_efficiency"].includes(s.id))).toBe(false);
  });
  it("migrates v1 tabs in saved order, validates fields and keeps the first valid entry", () => {
    const l = normalizeReportLayout({ version: 1, tabs: { overview: [{ id: "stat_contact_rate", visible: true }, { id: 3, visible: true }, { id: "stat_contact_rate", visible: false }],
      calls: [{ id: "stat_total_contacted", visible: true }] } });
    expect(strip(l)).toEqual(["kpi_8", "kpi_6"]);
  });
  it("keeps valid v5 choices and order, caps the activity strip at six, forces the section order and appends missing ids", () => {
    const ids = ["kpi_34", "kpi_25", "kpi_24", "kpi_21", "kpi_19", "kpi_18", "kpi_17"];
    const saved = Object.freeze({ version: 5, sections: Object.freeze([...ids.map(id => Object.freeze({ id, visible: true })),
      Object.freeze({ id: "calling_heatmap", visible: false }), Object.freeze({ id: "agent_performance_cards", visible: true }),
      Object.freeze({ id: "disposition_deep_dive", visible: true }), Object.freeze({ id: "campaign_performance", visible: false })]) });
    const l = normalizeReportLayout(saved);
    expect(strip(l)).toEqual(ids.slice(0, 6));
    expect(l.sections.filter(s => ["agent_performance_cards", "regional_performance", "calling_heatmap"].includes(s.id)).map(s => `${s.id}:${s.visible}`))
      .toEqual(["agent_performance_cards:true", "regional_performance:true", "calling_heatmap:false"]);
    const breakdowns = l.sections.slice(-5).map(s => s.id);
    expect(breakdowns.slice(0, 2)).toEqual(["disposition_deep_dive", "campaign_performance"]);
    expect(l.sections).toHaveLength(DEFAULT_LAYOUT.sections.length);
  });
  it("never mutates its input", () => {
    const input = { version: 5, sections: [{ id: "kpi_5", visible: true }, { id: "kpi_5", visible: false }] };
    const copy = JSON.parse(JSON.stringify(input));
    normalizeReportLayout(input);
    expect(input).toEqual(copy);
  });
});
