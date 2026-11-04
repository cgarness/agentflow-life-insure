// Reports v3 section map (D6 §4.1): each panel-backed section is built from the current panels only, through
// PanelSlot (skeleton while loading, a named error with Retry on failure, never stale or zero numbers).
import React from "react";
import { RefreshCw } from "lucide-react";
import type { Grouping } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import type { PanelKey, PanelState, Panels } from "@/lib/reports-panels";
import { CHIP_PARTIAL, REASON_NOTICES, fillNotice } from "@/lib/reports-v3-text";
import AgentPerformanceCards from "./AgentPerformanceCards";
import CallDurationAnalysis from "./CallDurationAnalysis";
import CallFlowAnalysis from "./CallFlowAnalysis";
import CallingHeatmap from "./CallingHeatmap";
import CallVolumeChart from "./CallVolumeChart";
import CampaignPerformance from "./CampaignPerformance";
import DispositionDeepDive from "./DispositionDeepDive";
import DispositionsPieChart from "./DispositionsPieChart";
import KpiStatusNote from "./KpiStatusNote";
import LeadSourceTable from "./LeadSourceTable";
import PoliciesSoldChart from "./PoliciesSoldChart";
import RegionalPerformance from "./regional/RegionalPerformance";

export interface V3SectionContext {
  panels: Panels;
  retry: (key: PanelKey) => void;
  exportFor: (key: PanelKey) => ReportExportFn | undefined;
  grouping: Grouping;
  viewerId: string | null;
  agencyScope: boolean;
  regionalExport?: () => void;
}

const ERROR_TEXT: Record<string, string> = {
  denied: "You don't have access to this part of the report.", timeout: "This part of the report took too long to load.",
  configuration: "The agency time zone isn't configured.", invalid: "This period can't be shown.",
};

/** One panel's frame: the content only for a current, ready panel; a dash is never shown as 0. */
export function PanelSlot<T>({ title, state, onRetry, children }: { title: string; state: PanelState<T>; onRetry: () => void; children: (data: T) => React.ReactNode }) {
  if (state.status === "ready") return <>{children(state.data)}</>;
  if (state.status === "loading") {
    return <div aria-label={`${title}: loading`} className="h-48 animate-pulse rounded-xl border border-border bg-card motion-reduce:animate-none" />;
  }
  return (
    <div role="alert" className="rounded-xl border border-border bg-card p-4 text-sm">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-muted-foreground">{ERROR_TEXT[state.kind] ?? "This part of the report is unavailable. This is not a zero."}</p>
      <button type="button" onClick={onRetry} className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <RefreshCw aria-hidden="true" className="h-4 w-4" />Retry
      </button>
    </div>
  );
}

/** The compact Partial cue on every call panel while its reader reports unverified attempts (D6 §4.1). */
export function CallPanelCue({ unverified }: { unverified: number }) {
  if (unverified <= 0) return null;
  return <KpiStatusNote label={CHIP_PARTIAL} tone="partial" lines={[fillNotice(REASON_NOTICES.attempt_unverified, { n: unverified })]} />;
}

const withCue = (unverified: number, node: React.ReactNode) => (
  <div className="relative">
    {unverified > 0 && <div className="absolute right-14 top-4 z-10"><CallPanelCue unverified={unverified} /></div>}
    {node}
  </div>
);

export function buildV3Sections(ctx: V3SectionContext): Record<string, React.ReactNode> {
  const { panels: p, retry, exportFor } = ctx;
  return {
    policies_sold: <PanelSlot title="Production trend" state={p.summary} onRetry={() => retry("summary")}>
      {d => <PoliciesSoldChart summary={d} grouping={ctx.grouping} onExport={exportFor("summary")} />}</PanelSlot>,
    call_volume: <PanelSlot title="Calling trend" state={p.volume} onRetry={() => retry("volume")}>
      {d => withCue(d.call_population.unverified, <CallVolumeChart volume={d} grouping={ctx.grouping} onExport={exportFor("volume")} />)}</PanelSlot>,
    call_outcomes: <PanelSlot title="Call outcomes" state={p.dispositions} onRetry={() => retry("dispositions")}>
      {d => withCue(d.call_population.unverified, <DispositionsPieChart dispositions={d} onExport={exportFor("dispositions")} />)}</PanelSlot>,
    agent_performance_cards: <PanelSlot title="Agent performance" state={p.summary} onRetry={() => retry("summary")}>
      {() => <AgentPerformanceCards panels={p} viewerId={ctx.viewerId} agencyScope={ctx.agencyScope} />}</PanelSlot>,
    regional_performance: <PanelSlot title="Regional performance" state={p.states} onRetry={() => retry("states")}>
      {d => <RegionalPerformance data={d} onExport={ctx.regionalExport} />}</PanelSlot>,
    calling_heatmap: <PanelSlot title="Calling heatmap" state={p.volume} onRetry={() => retry("volume")}>
      {d => withCue(d.call_population.unverified, <CallingHeatmap volume={d} onExport={exportFor("volume")} />)}</PanelSlot>,
    campaign_performance: <PanelSlot title="Campaign performance" state={p.campaigns} onRetry={() => retry("campaigns")}>
      {d => withCue(d.call_population.unverified, <CampaignPerformance campaigns={d} onExport={exportFor("campaigns")} />)}</PanelSlot>,
    lead_source_roi: <PanelSlot title="Lead sources" state={p.leadSources} onRetry={() => retry("leadSources")}>
      {d => withCue(d.call_population.unverified, <LeadSourceTable leadSources={d} onExport={exportFor("leadSources")} />)}</PanelSlot>,
    call_flow_analysis: <PanelSlot title="Call flow" state={p.volume} onRetry={() => retry("volume")}>
      {d => withCue(d.call_population.unverified, <CallFlowAnalysis volume={d} onExport={exportFor("volume")} />)}</PanelSlot>,
    call_duration_analysis: <PanelSlot title="Call duration" state={p.dispositions} onRetry={() => retry("dispositions")}>
      {d => withCue(d.call_population.unverified, <CallDurationAnalysis dispositions={d} onExport={exportFor("dispositions")} />)}</PanelSlot>,
    disposition_deep_dive: <PanelSlot title="Disposition deep dive" state={p.dispositions} onRetry={() => retry("dispositions")}>
      {d => withCue(d.call_population.unverified, <DispositionDeepDive dispositions={d} onExport={exportFor("dispositions")} />)}</PanelSlot>,
  };
}
