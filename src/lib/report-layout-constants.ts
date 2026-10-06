import { STAT_DEFINITIONS, STAT_CATEGORIES as STAT_CATEGORY_META } from "@/lib/stat-computations";

export interface SectionConfig { id: string; visible: boolean }
export interface ReportLayoutConfig { version: 4; sections: SectionConfig[] }
export type ReportLayoutGroup = "stats" | "performance" | "diagnostics";
export interface ReportLayoutSection {
  id: string;
  label: string;
  group: ReportLayoutGroup;
  teamOnly: boolean;
}

export const STAT_CATEGORIES = STAT_CATEGORY_META;
export const MAX_VISIBLE_STATS = 6;
export const DEFAULT_VISIBLE_STATS = [
  "stat_total_dials", "stat_total_contacted", "stat_contact_rate",
  "stat_appointments_set", "stat_total_talk_time", "stat_session_time",
];
export const REPORT_LAYOUT_GROUPS: { id: ReportLayoutGroup; label: string }[] = [
  { id: "stats", label: "Key metrics" },
  { id: "performance", label: "Performance" },
  { id: "diagnostics", label: "Dialer intelligence" },
];

const fixedStats = new Set(["stat_policies_sold", "stat_annual_premium"]);
const teamStats = new Set([
  "stat_top_performer", "stat_top_dialer", "stat_best_contact_agent", "stat_avg_calls_agent", "stat_agents_active",
]);
export const REPORT_LAYOUT_SECTIONS: ReportLayoutSection[] = [
  ...STAT_DEFINITIONS.filter((s) => !s.unavailable && !fixedStats.has(s.id)).map((s) => ({
    id: s.id, label: s.label, group: "stats" as const, teamOnly: teamStats.has(s.id),
  })),
  { id: "agent_performance_cards", label: "Agent performance", group: "performance", teamOnly: true },
  { id: "agent_efficiency", label: "Agent efficiency", group: "performance", teamOnly: true },
  { id: "campaign_performance", label: "Campaign performance", group: "performance", teamOnly: false },
  { id: "lead_source_roi", label: "Lead sources", group: "performance", teamOnly: false },
  { id: "conversion_funnel", label: "Disposition breakdown", group: "diagnostics", teamOnly: false },
  { id: "communications_stats", label: "Call summary", group: "diagnostics", teamOnly: false },
  { id: "calling_heatmap", label: "Calling heatmap", group: "diagnostics", teamOnly: false },
  { id: "call_flow_analysis", label: "Call flow", group: "diagnostics", teamOnly: false },
  { id: "call_duration_analysis", label: "Call duration", group: "diagnostics", teamOnly: false },
  { id: "disposition_deep_dive", label: "Disposition deep dive", group: "diagnostics", teamOnly: false },
];
const sectionById = new Map(REPORT_LAYOUT_SECTIONS.map((s) => [s.id, s]));
const defaultVisible = new Set(DEFAULT_VISIBLE_STATS);
export const DEFAULT_LAYOUT: ReportLayoutConfig = {
  version: 4,
  sections: [
    ...DEFAULT_VISIBLE_STATS.map((id) => ({ id, visible: true })),
    ...REPORT_LAYOUT_SECTIONS.filter((s) => !defaultVisible.has(s.id)).map((s) => ({
      id: s.id, visible: s.group !== "stats",
    })),
  ],
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function freshDefault(): ReportLayoutConfig {
  return { version: 4, sections: DEFAULT_LAYOUT.sections.map((s) => ({ ...s })) };
}

/** Read-only migration of untrusted saved JSON. Heroes/trends never belong to this layout. */
export function normalizeReportLayout(saved: unknown): ReportLayoutConfig {
  if (!record(saved)) return freshDefault();
  let raw: unknown[];
  if (saved.version === 1 && record(saved.tabs)) {
    const tabs = saved.tabs;
    raw = ["overview", "calls", "pipeline", "team"].flatMap((tab) =>
      Array.isArray(tabs[tab]) ? tabs[tab] as unknown[] : []);
  } else if ([2, 3, 4].includes(saved.version as number) && Array.isArray(saved.sections)) {
    raw = saved.sections;
  } else return freshDefault();

  const seen = new Set<string>();
  const selected: SectionConfig[] = [];
  let visibleStats = 0;
  for (const item of raw) {
    if (!record(item) || typeof item.id !== "string" || typeof item.visible !== "boolean") continue;
    const definition = sectionById.get(item.id);
    if (!definition || seen.has(item.id)) continue;
    seen.add(item.id);
    let visible = item.visible;
    if (definition.group === "stats" && visible) visible = visibleStats++ < MAX_VISIBLE_STATS;
    selected.push({ id: item.id, visible });
  }
  // New metrics stay hidden; newly introduced panels remain available in their fixed group.
  for (const definition of REPORT_LAYOUT_SECTIONS) {
    if (!seen.has(definition.id)) selected.push({ id: definition.id, visible: definition.group !== "stats" });
  }
  return {
    version: 4,
    sections: REPORT_LAYOUT_GROUPS.flatMap((group) => selected.filter((s) => sectionById.get(s.id)?.group === group.id)),
  };
}

/** Compatibility name for callers that previously migrated only v3 sections. */
export const migrateLayout = normalizeReportLayout;
