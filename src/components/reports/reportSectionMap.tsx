/**
 * reportSectionMap — binds every Reports section to its panel state.
 *
 * Each chart/table renders ONLY for a `ready` panel of the current report key (ReportPanelState
 * handles loading / error / denied), so a component never has to decide whether an empty array is a
 * real empty period or a failure. Exports are bound here: present only when the server said the
 * viewer may export, and re-checked against the current key at click time.
 */
import React from "react";
import type { Grouping } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import type { PanelKey, PanelStates } from "@/hooks/useReportsData";
import { buildStatComponents } from "./StatsGrid";
import ReportPanelState from "./ReportPanelState";
import AgentEfficiency from "./AgentEfficiency";
import AgentPerformanceCards from "./AgentPerformanceCards";
import CallDurationAnalysis from "./CallDurationAnalysis";
import CallFlowAnalysis from "./CallFlowAnalysis";
import CallingHeatmap from "./CallingHeatmap";
import CallVolumeChart from "./CallVolumeChart";
import CampaignPerformance from "./CampaignPerformance";
import CommunicationsStats from "./CommunicationsStats";
import DispositionDeepDive from "./DispositionDeepDive";
import DispositionsPieChart from "./DispositionsPieChart";
import GoalTracking from "./GoalTracking";
import LeadSourceTable from "./LeadSourceTable";
import PoliciesSoldChart from "./PoliciesSoldChart";

export interface ReportSectionContext {
  panels: PanelStates;
  retry: (panel: PanelKey) => void;
  /** Export callback for a panel, or undefined when the viewer may not export. */
  exportFor: (panel: PanelKey) => ReportExportFn | undefined;
  grouping: Grouping;
  dayCount: number;
  agencyToday: string;
  selectedAgentId: string | null;
  selectableAgentIds: ReadonlySet<string>;
  onSelectAgent: (id: string | null) => void;
  currentUserId: string | null;
}

export function buildReportSections(ctx: ReportSectionContext): Record<string, React.ReactNode> {
  const { panels } = ctx;
  const panel = <K extends PanelKey>(
    title: string,
    key: K,
    render: (data: Extract<PanelStates[K], { status: "ready" }>["data"]) => React.ReactNode,
  ) => (
    <ReportPanelState title={title} state={panels[key]} onRetry={() => ctx.retry(key)}>
      {render}
    </ReportPanelState>
  );

  return {
    ...buildStatComponents({ summary: panels.summary, volume: panels.volume, dayCount: ctx.dayCount, agencyToday: ctx.agencyToday }),
    call_volume: panel("Calling trend", "volume", (v) => (
      <CallVolumeChart volume={v} grouping={ctx.grouping} onExport={ctx.exportFor("volume")} />
    )),
    conversion_funnel: panel("Disposition Breakdown", "dispositions", (d) => (
      <DispositionsPieChart dispositions={d} onExport={ctx.exportFor("dispositions")} />
    )),
    communications_stats: panel("Call Summary", "summary", (s) => (
      <CommunicationsStats summary={s} dayCount={ctx.dayCount} onExport={ctx.exportFor("summary")} />
    )),
    calling_heatmap: panel("Calling Heatmap", "volume", (v) => <CallingHeatmap volume={v} onExport={ctx.exportFor("volume")} />),
    call_flow_analysis: panel("Call Flow", "volume", (v) => <CallFlowAnalysis volume={v} onExport={ctx.exportFor("volume")} />),
    call_duration_analysis: panel("Call Duration", "dispositions", (d) => (
      <CallDurationAnalysis dispositions={d} onExport={ctx.exportFor("dispositions")} />
    )),
    disposition_deep_dive: panel("Disposition Deep Dive", "dispositions", (d) => (
      <DispositionDeepDive dispositions={d} onExport={ctx.exportFor("dispositions")} />
    )),
    policies_sold: panel("Production trend", "volume", (v) => (
      <PoliciesSoldChart volume={v} grouping={ctx.grouping} onExport={ctx.exportFor("volume")} />
    )),
    campaign_performance: panel("Campaign Performance", "campaigns", (c) => (
      <CampaignPerformance campaigns={c} onExport={ctx.exportFor("campaigns")} />
    )),
    lead_source_roi: panel("Lead Source Performance", "leadSources", (l) => (
      <LeadSourceTable leadSources={l} onExport={ctx.exportFor("leadSources")} />
    )),
    agent_performance_cards: panel("Agent Performance", "summary", (s) => (
      <AgentPerformanceCards
        summary={s}
        selectedAgentId={ctx.selectedAgentId}
        selectableAgentIds={ctx.selectableAgentIds}
        onSelectAgent={ctx.onSelectAgent}
        onExport={ctx.exportFor("summary")}
      />
    )),
    agent_efficiency: panel("Agent Efficiency", "summary", (s) => (
      <AgentEfficiency summary={s} currentUserId={ctx.currentUserId} onExport={ctx.exportFor("summary")} />
    )),
    goal_tracking: <GoalTracking />,
  };
}
