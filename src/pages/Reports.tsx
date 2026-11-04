import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useReportsPage } from "@/hooks/useReportsPage";
import ReportsToolbar from "@/components/reports/ReportsToolbar";
import ReportsNotices from "@/components/reports/ReportsNotices";
import ReportsProduction from "@/components/reports/ReportsProduction";
import ReportsEffortSection from "@/components/reports/ReportsEffortSection";
import ReportTrends from "@/components/reports/ReportTrends";
import ReportBreakdowns from "@/components/reports/ReportBreakdowns";
import { buildV3Sections } from "@/components/reports/reportSectionMap";
import { autoGrouping, type Grouping } from "@/lib/reports-format";

const BREAKDOWNS = ["campaign_performance", "lead_source_roi", "call_flow_analysis", "call_duration_analysis", "disposition_deep_dive"] as const;
const Section = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <section data-report-group={id} data-report-section={id} className="min-w-0">{children}</section>
);

/**
 * Reports v3: one continuous Example 2 page (D6 §4.1). The v3 scope gates the page: when it is denied or v3 is off,
 * the page says "Reports unavailable" and requests no panel (R23). Every panel fails closed on its own; there is
 * no v2 fallback and the browser computes no KPI.
 */
const Reports: React.FC = () => {
  const { profile, isImpersonating } = useAuth();
  const viewerId = isImpersonating ? null : profile?.id ?? null;
  const orgId = profile?.organization_id ?? null;
  const page = useReportsPage(viewerId && orgId ? `${viewerId}|${orgId}` : null);
  const { scope, scopeData, panels } = page;
  const scopeError = scope.status === "error" ? scope.kind : null;
  const zoneRequired = scopeError === "configuration";
  const scopeStatusText = scope.status === "loading" ? "Loading your report scope…"
    : scopeError === "denied" ? "No report access" : zoneRequired ? "Agency time zone not configured" : "Reports unavailable";
  const showSections = !!scopeData && !!page.request && !page.scopeDrift;
  const [groupingSel, setGroupingSel] = useState<Grouping | null>(null);
  const grouping = groupingSel ?? (page.range ? autoGrouping(page.range) : "daily");
  const sections = buildV3Sections({ panels, retry: page.retryPanel, exportFor: () => undefined, grouping, viewerId,
    agencyScope: scopeData?.scope === "organization" });
  return (
    <div className="mx-auto min-w-0 max-w-[1600px] space-y-5 pb-10 md:space-y-7" data-reports-workspace data-reports-contract="v3">
      <ReportsToolbar
        scope={scopeData} scopeLoading={scope.status === "loading"} scopeStatusText={scopeStatusText}
        preset={page.preset} onPreset={page.setPreset} customStart={page.customStart} customEnd={page.customEnd}
        onCustomStart={page.setCustomStart} onCustomEnd={page.setCustomEnd} range={page.range} rangeProblem={page.rangeProblem}
        agentId={page.agentId} onAgent={page.setAgentId} onScope={page.onScope} panelRendered={showSections}
        editMode={false} customizationReady={false} onToggleEdit={() => undefined} onRefresh={page.refresh}
        canExport={!!scopeData?.can_export} exportReady={page.exportable("summary")} onExport={() => undefined}
        asOf={panels.summary.status === "ready" ? panels.summary.data.as_of : null}
      />
      <ReportsNotices scopeLoading={scope.status === "loading"} scopeError={scopeError} zoneRequired={zoneRequired}
        onRetryScope={page.refresh} onDefaultScope={scopeError ? page.resetScope : undefined} scopeDrift={page.scopeDrift} customRangeIncomplete={!!scopeData && !page.range && page.preset === "custom"} />
      {showSections && (
        <div id="reports-scope-panel" role="tabpanel" aria-labelledby={`report-scope-${scopeData.requested_scope}`} className="min-w-0 space-y-6 md:space-y-8">
          <ReportsProduction panels={panels} />
          <ReportsEffortSection panels={panels} />
          <ReportTrends sections={sections} grouping={grouping} onGroupingChange={setGroupingSel} />
          {scopeData.scope !== "own" && <Section id="agent_performance_cards">{sections.agent_performance_cards}</Section>}
          <Section id="regional_performance">{sections.regional_performance}</Section>
          <Section id="calling_heatmap">{sections.calling_heatmap}</Section>
          <ReportBreakdowns>{BREAKDOWNS.map(id => <div key={id} data-report-section={id}>{sections[id]}</div>)}</ReportBreakdowns>
        </div>
      )}
    </div>
  );
};

export default Reports;
