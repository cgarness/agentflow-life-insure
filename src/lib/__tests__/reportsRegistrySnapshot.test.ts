/**
 * T-4: the Reports layout registry is frozen.
 *
 * Saved `report_layouts` rows store only section ids and visibility, and normalization drops any id it no
 * longer knows, appends unknown-to-the-row ids in registry order and caps visible metrics. Renaming,
 * regrouping or reordering an id here would therefore silently lose or reset every saved layout, and a
 * change to the default changes every user's page. Labels may change wording; ids, groups, team-only
 * flags, order, the default layout and the six-metric cap may not.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT, DEFAULT_VISIBLE_STATS, MAX_VISIBLE_STATS, REPORT_LAYOUT_GROUPS, REPORT_LAYOUT_SECTIONS,
} from "@/lib/report-layout-constants";

const STATS: [id: string, teamOnly: boolean][] = [
  ["stat_total_dials", false], ["stat_outbound", false], ["stat_inbound", false], ["stat_calls_today", false],
  ["stat_calls_this_week", false], ["stat_calls_per_day", false], ["stat_calls_per_hour", false], ["stat_session_time", false],
  ["stat_total_contacted", false], ["stat_contact_rate", false], ["stat_total_talk_time", false], ["stat_avg_duration_all", false],
  ["stat_talk_time_ratio", false], ["stat_dnc_count", false], ["stat_dnc_rate", false], ["stat_avg_premium", false],
  ["stat_dials_per_sale", false], ["stat_appointments_set", false], ["stat_leads_converted", false], ["stat_callback_rate", false],
  ["stat_top_performer", true], ["stat_top_dialer", true], ["stat_best_contact_agent", true], ["stat_avg_calls_agent", true],
  ["stat_agents_active", true], ["stat_dials_per_contact", false], ["stat_dials_per_appt", false], ["stat_talk_mins_per_sale", false],
];
const PERFORMANCE: [id: string, teamOnly: boolean][] = [
  ["agent_performance_cards", true], ["agent_efficiency", true], ["campaign_performance", false], ["lead_source_roi", false],
];
const DIAGNOSTICS = [
  "conversion_funnel", "communications_stats", "calling_heatmap", "call_flow_analysis", "call_duration_analysis", "disposition_deep_dive",
];
const FROZEN_REGISTRY = [
  ...STATS.map(([id, teamOnly]) => ({ id, group: "stats", teamOnly })),
  ...PERFORMANCE.map(([id, teamOnly]) => ({ id, group: "performance", teamOnly })),
  ...DIAGNOSTICS.map((id) => ({ id, group: "diagnostics", teamOnly: false })),
];
const FROZEN_DEFAULT_VISIBLE_STATS = [
  "stat_total_dials", "stat_total_contacted", "stat_contact_rate", "stat_appointments_set", "stat_total_talk_time", "stat_session_time",
];

describe("Reports layout registry snapshot (T-4)", () => {
  it("keeps the 38 registered ids, their groups, team-only flags and registry order", () => {
    expect(REPORT_LAYOUT_SECTIONS.map(({ id, group, teamOnly }) => ({ id, group, teamOnly }))).toEqual(FROZEN_REGISTRY);
    expect(REPORT_LAYOUT_SECTIONS).toHaveLength(38);
    expect(new Set(REPORT_LAYOUT_SECTIONS.map((section) => section.id)).size).toBe(38);
  });

  it("keeps the three groups and their order", () => {
    expect(REPORT_LAYOUT_GROUPS.map((group) => group.id)).toEqual(["stats", "performance", "diagnostics"]);
  });

  it("keeps the six-metric cap and the default layout exactly", () => {
    expect(MAX_VISIBLE_STATS).toBe(6);
    expect(DEFAULT_VISIBLE_STATS).toEqual(FROZEN_DEFAULT_VISIBLE_STATS);
    const hiddenStats = STATS.map(([id]) => id).filter((id) => !FROZEN_DEFAULT_VISIBLE_STATS.includes(id));
    expect(DEFAULT_LAYOUT).toEqual({
      version: 4,
      sections: [
        ...FROZEN_DEFAULT_VISIBLE_STATS.map((id) => ({ id, visible: true })),
        ...hiddenStats.map((id) => ({ id, visible: false })),
        ...PERFORMANCE.map(([id]) => ({ id, visible: true })),
        ...DIAGNOSTICS.map((id) => ({ id, visible: true })),
      ],
    });
  });

  it("names the per-booking ratio 'Dials per booking' under its unchanged id", () => {
    const labelOf = (id: string) => REPORT_LAYOUT_SECTIONS.find((section) => section.id === id)?.label;
    expect(labelOf("stat_dials_per_appt")).toBe("Dials per booking");
    expect(REPORT_LAYOUT_SECTIONS.some((section) => /dials per appointment/i.test(section.label))).toBe(false);
    // Contract wording that the registry carries into the editor.
    expect(labelOf("stat_contact_rate")).toBe("Call contact rate");
    expect(labelOf("stat_top_performer")).toBe("Most policies — current assignments");
    expect(labelOf("stat_appointments_set")).toBe("Bookings created (all types)");
    expect(labelOf("stat_dials_per_sale")).toBe("Dials per policy sold");
  });
});
