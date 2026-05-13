import { STAT_DEFINITIONS, STAT_CATEGORIES as STAT_CATEGORY_META } from "@/lib/stat-computations";

export interface SectionConfig {
  id: string;
  visible: boolean;
}

export interface ReportLayoutConfig {
  version: 3;
  sections: SectionConfig[];
}

/** Category color map (re-exported for convenience). */
export const STAT_CATEGORIES = STAT_CATEGORY_META;

/** First 20 stat IDs that ship visible by default — ordered by category. */
export const DEFAULT_VISIBLE_STATS: string[] = [
  // Volume
  "stat_total_dials",
  "stat_calls_per_hour",
  "stat_calls_per_day",
  // Contact
  "stat_contact_rate",
  "stat_total_talk_time",
  "stat_avg_talk_contacted",
  "stat_dnc_rate",
  "stat_callback_rate",
  // Conversion
  "stat_policies_sold",
  "stat_contacted_to_close",
  "stat_call_to_close",
  "stat_dials_per_sale",
  "stat_appt_to_close",
  // Appointments
  "stat_appointments_set",
  "stat_contacted_to_appt",
  // Pipeline
  "stat_active_leads",
  // Agent
  "stat_top_performer",
  // Coming soon (visible but muted)
  "stat_speed_to_contact",
  "stat_unique_leads",
  "stat_first_dial_contact",
];

const ALL_STAT_IDS = STAT_DEFINITIONS.map((d) => d.id);

const buildDefaultStatSections = (): SectionConfig[] => {
  const visibleSet = new Set(DEFAULT_VISIBLE_STATS);
  const visibleOrdered: SectionConfig[] = DEFAULT_VISIBLE_STATS.map((id) => ({ id, visible: true }));
  const hiddenOrdered: SectionConfig[] = ALL_STAT_IDS
    .filter((id) => !visibleSet.has(id))
    .map((id) => ({ id, visible: false }));
  return [...visibleOrdered, ...hiddenOrdered];
};

export const DEFAULT_LAYOUT: ReportLayoutConfig = {
  version: 3,
  sections: [
    ...buildDefaultStatSections(),

    // Paired sections
    { id: "call_volume", visible: true },
    { id: "conversion_funnel", visible: true },
    { id: "communications_stats", visible: true },
    { id: "calling_heatmap", visible: true },
    { id: "call_flow_analysis", visible: true },
    { id: "call_duration_analysis", visible: true },
    { id: "disposition_deep_dive", visible: true },
    { id: "policies_sold", visible: true },
    { id: "campaign_performance", visible: true },
    { id: "lead_source_roi", visible: true },

    // Team sections (Admin/Team Leader only)
    { id: "agent_performance_cards", visible: true },
    { id: "agent_efficiency", visible: true },
    { id: "goal_tracking", visible: true },
  ],
};

/**
 * Migrate a saved layout to the latest version, appending any newly registered
 * stat IDs as hidden so the user doesn't lose access to them.
 */
export function migrateLayout(saved: { version?: number; sections?: SectionConfig[] } | null | undefined): ReportLayoutConfig {
  if (!saved || !saved.sections) return DEFAULT_LAYOUT;
  const known = new Set(saved.sections.map((s) => s.id));
  const appended: SectionConfig[] = [];
  for (const id of ALL_STAT_IDS) {
    if (!known.has(id)) appended.push({ id, visible: false });
  }
  return {
    version: 3,
    sections: [...saved.sections, ...appended],
  };
}
