/**
 * T-4 (layout v5): the Reports layout registry is frozen. Saved rows store only section ids and visibility, so ids,
 * groups, team-only flags, order, the default layout and the six-item activity cap may not change; labels may.
 * The frozen V4_TO_V5 map covers every one of the 38 v4 ids (D6 §4.5).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT, DEFAULT_STRIP, MAX_VISIBLE_ACTIVITY, REPORT_LAYOUT_GROUPS, REPORT_LAYOUT_SECTIONS, V4_DEFAULT_VISIBLE_STATS,
  V4_PANEL_IDS, V4_STAT_IDS, V4_TO_V5,
} from "@/lib/report-layout-constants";

const FROZEN = [
  ...["kpi_5", "kpi_6", "kpi_7", "kpi_8", "kpi_11", "kpi_14", "kpi_15", "kpi_16", "kpi_17", "kpi_18", "kpi_19", "kpi_21", "kpi_24", "kpi_25", "kpi_34"]
    .map(id => ({ id, group: "activity", teamOnly: false })),
  { id: "agent_performance_cards", group: "sections", teamOnly: true },
  { id: "regional_performance", group: "sections", teamOnly: false },
  { id: "calling_heatmap", group: "sections", teamOnly: false },
  ...["campaign_performance", "lead_source_roi", "call_flow_analysis", "call_duration_analysis", "disposition_deep_dive"].map(id => ({ id, group: "breakdowns", teamOnly: false })),
];

describe("Reports layout v5 registry snapshot (T-4)", () => {
  it("keeps the registered ids, their groups, team-only flags and order", () => {
    expect(REPORT_LAYOUT_SECTIONS.map(({ id, group, teamOnly }) => ({ id, group, teamOnly }))).toEqual(FROZEN);
  });
  it("keeps the three groups and their order", () => {
    expect(REPORT_LAYOUT_GROUPS.map(g => g.id)).toEqual(["activity", "sections", "breakdowns"]);
    expect(REPORT_LAYOUT_GROUPS.map(g => g.label)).toEqual(["Activity", "Sections", "Breakdowns"]);
  });
  it("keeps the six-item cap and the default layout exactly (strip 5, 6, 7, 8, 15; everything else visible)", () => {
    expect(MAX_VISIBLE_ACTIVITY).toBe(6);
    expect(DEFAULT_STRIP).toEqual(["kpi_5", "kpi_6", "kpi_7", "kpi_8", "kpi_15"]);
    expect(DEFAULT_LAYOUT.version).toBe(5);
    expect(DEFAULT_LAYOUT.sections.filter(s => s.visible).map(s => s.id)).toEqual([...DEFAULT_STRIP, ...FROZEN.filter(f => f.group !== "activity").map(f => f.id)]);
  });
  it("maps all 38 v4 ids, frozen: the six carried stats, the kept panels, and null for fixed or retired ids", () => {
    const v4 = [...V4_STAT_IDS, ...V4_PANEL_IDS];
    expect(v4).toHaveLength(38);
    expect(Object.keys(V4_TO_V5).sort()).toEqual([...v4].sort());
    expect(Object.isFrozen(V4_TO_V5)).toBe(true);
    expect(Object.fromEntries(Object.entries(V4_TO_V5).filter(([, v]) => v !== null && v.startsWith("kpi")))).toEqual({
      stat_total_dials: "kpi_5", stat_outbound: "kpi_5", stat_total_contacted: "kpi_6", stat_contact_rate: "kpi_8", stat_total_talk_time: "kpi_24", stat_session_time: "kpi_25" });
    for (const fixedOrRetired of ["stat_avg_premium", "stat_dials_per_sale", "conversion_funnel", "stat_appointments_set", "stat_leads_converted", "stat_top_performer", "agent_efficiency", "communications_stats"]) {
      expect(V4_TO_V5[fixedOrRetired]).toBeNull();
    }
    expect(V4_DEFAULT_VISIBLE_STATS).toEqual(["stat_total_dials", "stat_total_contacted", "stat_contact_rate", "stat_appointments_set", "stat_total_talk_time", "stat_session_time"]);
  });
});
