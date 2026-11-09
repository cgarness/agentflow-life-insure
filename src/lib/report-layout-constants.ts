// Report layout v5 (D6 §4.5). Groups: activity (order and visibility, at most 6 shown in the strip), sections
// (visibility only, fixed order) and breakdowns (visibility and order). Reads v1–v5; returns v5; never writes on read.

export interface SectionConfig { id: string; visible: boolean }
export interface ReportLayoutConfig { version: 5; sections: SectionConfig[] }
export type ReportLayoutGroup = "activity" | "sections" | "breakdowns";
export interface ReportLayoutSection { id: string; label: string; group: ReportLayoutGroup; teamOnly: boolean }

export const MAX_VISIBLE_ACTIVITY = 6;
export const REPORT_LAYOUT_GROUPS: { id: ReportLayoutGroup; label: string }[] = [
  { id: "activity", label: "Activity" }, { id: "sections", label: "Sections" }, { id: "breakdowns", label: "Breakdowns" },
];

const ACTIVITY: [string, string][] = [
  ["kpi_5", "Calls"], ["kpi_6", "Contacted calls"], ["kpi_7", "Unique prospects reached"], ["kpi_8", "Call contact rate"],
  ["kpi_11", "Prospects reached per policy"], ["kpi_14", "Days to first sale"], ["kpi_15", "Sales appointments booked"],
  ["kpi_16", "Sales appointments completed"], ["kpi_17", "Appointment show rate"], ["kpi_18", "Appointment close rate"],
  ["kpi_19", "Contact-to-sale rate"], ["kpi_21", "Calls to first contact"], ["kpi_24", "Total talk time"], ["kpi_25", "Time in dialer"],
  ["kpi_34", "Calls per lead"],
];
export const REPORT_LAYOUT_SECTIONS: ReportLayoutSection[] = [
  ...ACTIVITY.map(([id, label]) => ({ id, label, group: "activity" as const, teamOnly: false })),
  { id: "agent_performance_cards", label: "Agent performance", group: "sections", teamOnly: true },
  { id: "regional_performance", label: "Regional performance", group: "sections", teamOnly: false },
  { id: "calling_heatmap", label: "Calling heatmap", group: "sections", teamOnly: false },
  { id: "campaign_performance", label: "Campaign performance", group: "breakdowns", teamOnly: false },
  { id: "lead_source_roi", label: "Lead sources", group: "breakdowns", teamOnly: false },
  { id: "call_flow_analysis", label: "Call flow", group: "breakdowns", teamOnly: false },
  { id: "call_duration_analysis", label: "Call duration", group: "breakdowns", teamOnly: false },
  { id: "disposition_deep_dive", label: "Disposition deep dive", group: "breakdowns", teamOnly: false },
];
const sectionById = new Map(REPORT_LAYOUT_SECTIONS.map(s => [s.id, s]));
export const DEFAULT_STRIP = ["kpi_5", "kpi_6", "kpi_7", "kpi_8", "kpi_15"];

export const DEFAULT_LAYOUT: ReportLayoutConfig = {
  version: 5,
  sections: [
    ...DEFAULT_STRIP.map(id => ({ id, visible: true })),
    ...REPORT_LAYOUT_SECTIONS.filter(s => !DEFAULT_STRIP.includes(s.id)).map(s => ({ id: s.id, visible: s.group !== "activity" })),
  ],
};

/** The v4 registry, frozen (it replaces the retired stat-computations import): 38 ids and the v4 default strip. */
export const V4_STAT_IDS = [
  "stat_total_dials", "stat_outbound", "stat_inbound", "stat_calls_today", "stat_calls_this_week", "stat_calls_per_day", "stat_calls_per_hour",
  "stat_session_time", "stat_total_contacted", "stat_contact_rate", "stat_total_talk_time", "stat_avg_duration_all", "stat_talk_time_ratio",
  "stat_dnc_count", "stat_dnc_rate", "stat_avg_premium", "stat_dials_per_sale", "stat_appointments_set", "stat_leads_converted", "stat_callback_rate",
  "stat_top_performer", "stat_top_dialer", "stat_best_contact_agent", "stat_avg_calls_agent", "stat_agents_active", "stat_dials_per_contact",
  "stat_dials_per_appt", "stat_talk_mins_per_sale",
] as const;
export const V4_PANEL_IDS = ["agent_performance_cards", "agent_efficiency", "campaign_performance", "lead_source_roi", "conversion_funnel",
  "communications_stats", "calling_heatmap", "call_flow_analysis", "call_duration_analysis", "disposition_deep_dive"] as const;
export const V4_DEFAULT_VISIBLE_STATS = ["stat_total_dials", "stat_total_contacted", "stat_contact_rate", "stat_appointments_set",
  "stat_total_talk_time", "stat_session_time"] as const;
/** Every v4 id → its v5 id, or null when it is fixed on the page or retired. Frozen (D6 §4.5). */
export const V4_TO_V5: Readonly<Record<string, string | null>> = Object.freeze({
  ...Object.fromEntries(V4_STAT_IDS.map(id => [id, null])),
  stat_total_dials: "kpi_5", stat_outbound: "kpi_5", stat_total_contacted: "kpi_6", stat_contact_rate: "kpi_8",
  stat_total_talk_time: "kpi_24", stat_session_time: "kpi_25",
  agent_performance_cards: "agent_performance_cards", campaign_performance: "campaign_performance", lead_source_roi: "lead_source_roi",
  calling_heatmap: "calling_heatmap", call_flow_analysis: "call_flow_analysis", call_duration_analysis: "call_duration_analysis",
  disposition_deep_dive: "disposition_deep_dive", agent_efficiency: null, conversion_funnel: null, communications_stats: null,
});

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const items = (raw: unknown[]) => raw.filter((i): i is SectionConfig => record(i) && typeof i.id === "string" && typeof i.visible === "boolean");
const freshDefault = (): ReportLayoutConfig => ({ version: 5, sections: DEFAULT_LAYOUT.sections.map(s => ({ ...s })) });

/** R23: exactly the v4 default stats visible, in order, with every other stat hidden. */
function isUntouchedV4Default(sections: SectionConfig[]): boolean {
  const visibleStats = sections.filter(s => (V4_STAT_IDS as readonly string[]).includes(s.id) && s.visible).map(s => s.id);
  return visibleStats.length === V4_DEFAULT_VISIBLE_STATS.length && visibleStats.every((id, i) => id === V4_DEFAULT_VISIBLE_STATS[i]);
}

/** Read-only migration of untrusted saved JSON to v5. */
export function normalizeReportLayout(saved: unknown): ReportLayoutConfig {
  if (!record(saved)) return freshDefault();
  let v5: SectionConfig[];
  if (saved.version === 5 && Array.isArray(saved.sections)) {
    v5 = items(saved.sections);
  } else {
    let raw: unknown[];
    if (saved.version === 1 && record(saved.tabs)) {
      const tabs = saved.tabs;
      raw = ["overview", "calls", "pipeline", "team"].flatMap(t => (Array.isArray(tabs[t]) ? (tabs[t] as unknown[]) : []));
    } else if ([2, 3, 4].includes(saved.version as number) && Array.isArray(saved.sections)) raw = saved.sections;
    else return freshDefault();
    const v4 = items(raw);
    const untouched = isUntouchedV4Default(v4);
    v5 = v4.flatMap(s => {
      const id = V4_TO_V5[s.id];
      if (!id) return [];
      if (untouched && sectionById.get(id)?.group === "activity") return []; // the strip becomes the v5 default
      return [{ id, visible: s.visible }];
    });
    if (untouched) v5 = [...DEFAULT_STRIP.map(id => ({ id, visible: true })), ...v5];
  }
  const seen = new Set<string>();
  const kept: SectionConfig[] = [];
  let visibleActivity = 0;
  for (const s of v5) {
    const def = sectionById.get(s.id);
    if (!def || seen.has(s.id)) continue; // first wins (stat_total_dials before stat_outbound)
    seen.add(s.id);
    const visible = def.group === "activity" && s.visible ? visibleActivity++ < MAX_VISIBLE_ACTIVITY : s.visible;
    kept.push({ id: s.id, visible });
  }
  for (const def of REPORT_LAYOUT_SECTIONS) if (!seen.has(def.id)) kept.push({ id: def.id, visible: def.group !== "activity" });
  const byGroup = (g: ReportLayoutGroup) => kept.filter(s => sectionById.get(s.id)?.group === g);
  // Sections have a fixed order; activity and breakdowns keep the saved order.
  const sections = REPORT_LAYOUT_SECTIONS.filter(s => s.group === "sections").map(d => kept.find(s => s.id === d.id)!);
  return { version: 5, sections: [...byGroup("activity"), ...sections, ...byGroup("breakdowns")] };
}

export const migrateLayout = normalizeReportLayout;
export const layoutSection = (id: string) => sectionById.get(id);
