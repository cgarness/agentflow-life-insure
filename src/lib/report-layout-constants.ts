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
      { id: "kpi_cards", visible: true },
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
