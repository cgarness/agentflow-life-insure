export interface SectionConfig {
  id: string;
  visible: boolean;
}

export interface ReportLayoutConfig {
  version: 1;
  tabs: {
    overview: SectionConfig[];
    calls: SectionConfig[];
    pipeline: SectionConfig[];
    team: SectionConfig[];
  };
}

export type TabName = keyof ReportLayoutConfig["tabs"];

export const DEFAULT_LAYOUT: ReportLayoutConfig = {
  version: 1,
  tabs: {
    overview: [
      { id: "stat_total_dials", visible: true },
      { id: "stat_contact_rate", visible: true },
      { id: "stat_policies_sold", visible: true },
      { id: "stat_contacted_to_close", visible: true },
      { id: "stat_appointments_set", visible: true },
      { id: "stat_appt_to_close", visible: true },
      { id: "stat_dials_per_sale", visible: true },
      { id: "stat_calls_per_hour", visible: true },
      { id: "stat_call_to_close", visible: true },
      { id: "stat_total_talk_time", visible: true },
      { id: "stat_speed_to_contact", visible: true },
      { id: "stat_contacted_to_appt", visible: true },
      { id: "stat_avg_talk_time", visible: true },
      { id: "stat_dnc_rate", visible: true },
      { id: "stat_unique_leads", visible: true },
      { id: "stat_callback_rate", visible: true },
      { id: "stat_active_leads", visible: true },
      { id: "stat_first_dial_contact", visible: true },
      { id: "stat_calls_per_day", visible: true },
      { id: "stat_top_performer", visible: true },
      { id: "call_volume", visible: true },
      { id: "conversion_funnel", visible: true },
      { id: "communications_stats", visible: true },
      { id: "calling_heatmap", visible: true }
    ],
    calls: [
      { id: "call_flow_analysis", visible: true },
      { id: "call_duration_analysis", visible: true },
      { id: "disposition_deep_dive", visible: true }
    ],
    pipeline: [
      { id: "policies_sold", visible: true },
      { id: "campaign_performance", visible: true },
      { id: "lead_source_roi", visible: true }
    ],
    team: [
      { id: "agent_performance_cards", visible: true },
      { id: "agent_efficiency", visible: true },
      { id: "goal_tracking", visible: true }
    ]
  }
};
