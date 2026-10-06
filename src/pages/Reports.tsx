import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useReportPanels, useReportScope, type PanelKey } from "@/hooks/useReportsData";
import { useReportLayout } from "@/hooks/useReportLayout";
import type { ReportRequestedScope } from "@/lib/reports-schemas";
import {
  autoGrouping, dayCount, presetRange, validateRange,
  type CalendarRange, type Grouping, type ReportPreset,
} from "@/lib/reports-format";
import { buildReportCsv, csvFileName, downloadCsv, type ReportExportFn } from "@/lib/reports-export";
import ReportDataQuality from "@/components/reports/ReportDataQuality";
import { integrityExportNotes } from "@/lib/reports-integrity-text";
import { policyExportNotes } from "@/lib/reports-policy-text";
import ReportsToolbar from "@/components/reports/ReportsToolbar";
import ReportCustomizer from "@/components/reports/ReportCustomizer";
import SectionRenderer from "@/components/reports/SectionRenderer";
import { ReportNotice, ReportPanelSkeleton } from "@/components/reports/ReportPanelState";
import { buildReportSections } from "@/components/reports/reportSectionMap";
import ReportsOverview from "@/components/reports/ReportsOverview";
import ReportsActivityFlow from "@/components/reports/ReportsActivityFlow";
const Reports: React.FC = () => {
  const { profile, isImpersonating } = useAuth();
  const viewerId = isImpersonating ? null : profile?.id ?? null;
  const orgId = profile?.organization_id ?? null;
  const viewerKey = viewerId && orgId ? `${viewerId}|${orgId}` : null;
  const [scopeSelection, setScopeSelection] = useState<{ key: string | null; value: ReportRequestedScope | null }>({ key: null, value: null });
  const requestedScope = scopeSelection.key === viewerKey ? scopeSelection.value : null;
  const scope = useReportScope(viewerId, orgId, requestedScope);
  const scopeData = scope.state.status === "ready" ? scope.state.data : null;
  const [preset, setPreset] = useState<ReportPreset>("30d");
  const [customStart, setCustomStart] = useState<string | null>(null);
  const [customEnd, setCustomEnd] = useState<string | null>(null);
  const [agentSel, setAgentSel] = useState<{ key: string | null; id: string | null }>({ key: null, id: null });
  const [groupingSel, setGroupingSel] = useState<Grouping | null>(null);
  useEffect(() => { setScopeSelection({ key: viewerKey, value: null }); setAgentSel({ key: null, id: null }); }, [viewerKey]);
  const onScope = (value: ReportRequestedScope) => {
    if (!scopeData?.available_scopes.includes(value) || scopeData.requested_scope === value) return;
    setScopeSelection({ key: viewerKey, value });
    setAgentSel({ key: null, id: null });
  };
  const range: CalendarRange | null = useMemo(() => {
    if (!scopeData) return null;
    if (preset !== "custom") return presetRange(preset, scopeData.today);
    return customStart && customEnd ? { startDate: customStart, endDate: customEnd } : null;
  }, [scopeData, preset, customStart, customEnd]);
  const rangeProblem = range && scopeData ? validateRange(range, scopeData.max_range_days) : null;
  const selectableAgentIds = useMemo(
    () => new Set(scopeData && scopeData.scope !== "own" ? scopeData.agents.map((a) => a.id) : []),
    [scopeData],
  );
  const agentId = agentSel.key === scope.key && agentSel.id && selectableAgentIds.has(agentSel.id) ? agentSel.id : null;
  const onAgent = useCallback((id: string | null) => setAgentSel({ key: scope.key, id }), [scope.key]);
  const request = useMemo(
    () => (range && !rangeProblem ? { startDate: range.startDate, endDate: range.endDate, agentId, requestedScope: scopeData?.requested_scope } : null),
    [range, rangeProblem, agentId, scopeData?.requested_scope],
  );
  const resolvedScope = scope.key && scopeData ? `${scope.key}|${scopeData.scope}|${scopeData.time_zone}|${scopeData.today}` : null;
  const reports = useReportPanels(resolvedScope, request);
  const grouping = groupingSel ?? (range ? autoGrouping(range) : "daily");
  const scopeDrift = !!scopeData && Object.values(reports.panels).some((p) =>
    p.status === "ready" &&
    (p.data.scope !== scopeData.scope || p.data.window.time_zone !== scopeData.time_zone || p.data.filter_agent_id !== agentId || p.data.requested_scope !== scopeData.requested_scope || p.data.window.start_date !== range?.startDate || p.data.window.end_date !== range?.endDate));
  const panelZoneMissing = Object.values(reports.panels).some((p) => p.status === "error" && p.error.kind === "configuration");
  const withheld = scopeDrift || panelZoneMissing;
  const preferences = useReportLayout(viewerId, orgId, !!scopeData && !withheld);
  const layout = preferences.editMode ? preferences.draft : preferences.layout;
  const scopeError = scope.state.status === "error" ? scope.state.error.kind : null;
  const zoneRequired = scopeError === "configuration" || panelZoneMissing;
  const scopeStatusText = scope.state.status === "loading" ? "Loading your report scope…"
    : scopeError === "denied" ? "No report access" : zoneRequired ? "Agency time zone not configured" : "Reports unavailable";
  const exportFor = useCallback(
    (panel: PanelKey): ReportExportFn | undefined => {
      if (!scopeData?.can_export || withheld) return undefined;
      const state = reports.panels[panel];
      const panelKey = reports.key;
      return (report, headers, rows) => {
        if (state.status !== "ready" || !reports.isCurrent(panelKey, panel, state.data)) {
          toast.error("This report changed while exporting. Export again once it has loaded.");
          return;
        }
        const { scope: rowsScope, filter_agent_id: filterId, window: win } = state.data;
        const agentLabel = filterId
          ? scopeData.agents.find((a) => a.id === filterId)?.name ?? "Selected agent"
          : rowsScope === "own" ? scopeData.agents[0]?.name ?? "You" : rowsScope === "team" ? "Whole team" : "All agents";
        const csv = buildReportCsv({ report, scope: rowsScope, agentLabel, window: win, asOf: state.data.as_of, basisVersion: state.data.basis_version, notes: [...policyExportNotes(panel, state.data), ...integrityExportNotes(state.data)] }, headers, rows);
        downloadCsv(csvFileName(report, win), csv);
      };
    },
    [scopeData, withheld, reports],
  );
  const exportSummary = useCallback(() => {
    const s = reports.panels.summary;
    if (s.status !== "ready") return;
    const t = s.data.totals;
    exportFor("summary")?.("Report Summary", ["Metric", "Value"], [
      ["Calls made (outbound)", t.calls_made], ["Inbound calls", t.inbound_calls], ["Contacted", t.contacted],
      ["Call contact rate %", t.contact_rate_pct], ["Talk time (seconds)", t.talk_time_seconds],
      ["Converted leads/clients", t.converted], ["Policies sold (stored, by sale date)", t.policies_sold],
      ["Bookings created (all types)", t.appointments_set], ["Dialer session time (seconds)", t.session_seconds],
      ["Known monthly premium", t.premium.monthly_premium], ["Known annual premium", t.premium.annual_premium], ["Average annual premium per known policy", t.premium.average_annual_premium],
      ["Policies with known premium", t.premium.known_count], ["Policies with unknown premium", t.premium.unknown_count], ["Session matched calls", t.session_matched_calls], ["Session unmatched calls", t.session_unmatched_calls],
    ]);
  }, [reports.panels.summary, exportFor]);
  const sections = scopeData && range && !rangeProblem && !withheld
    ? buildReportSections({
        panels: reports.panels, retry: reports.retryPanel, exportFor, grouping, onGroupingChange: setGroupingSel,
        dayCount: dayCount(range), agencyToday: scopeData.today, selectedAgentId: agentId, selectableAgentIds,
        onSelectAgent: onAgent, currentUserId: viewerId,
      })
    : null;
  return (
    <div className="max-w-[1600px] min-w-0 mx-auto space-y-8 pb-10" data-reports-workspace>
      <ReportsToolbar
        scope={scopeData} scopeStatusText={scopeStatusText} preset={preset} onPreset={setPreset}
        customStart={customStart} customEnd={customEnd} onCustomStart={setCustomStart} onCustomEnd={setCustomEnd}
        range={range} rangeProblem={rangeProblem} agentId={agentId} onAgent={onAgent}
        onScope={onScope} editMode={preferences.editMode} customizationReady={preferences.status === "ready" && !preferences.busy && !withheld}
        onToggleEdit={preferences.editMode ? preferences.cancel : preferences.beginEdit} onRefresh={scope.reload}
        canExport={!!scopeData?.can_export} exportReady={reports.panels.summary.status === "ready" && !withheld} onExport={exportSummary}
      />
      {scope.state.status === "loading" && <ReportPanelSkeleton title="Loading your reports" />}
      {scopeError === "denied" && (
        <ReportNotice title="Reports" tone="denied" message="You don't have access to Reports."
          detail="Your role's report permissions don't allow viewing reports. Ask an admin if you need access." />
      )}
      {zoneRequired && (
        <ReportNotice title="Reports" tone="unavailable" message="The agency time zone must be configured before official Reports can be calculated."
          detail="An admin must choose and save the agency time zone in Settings → Company Branding. Report periods, day and hour buckets, the heatmap and exports are never calculated in a guessed time zone."
          onRetry={scope.reload} />
      )}
      {scopeError !== null && scopeError !== "denied" && scopeError !== "configuration" && (
        <ReportNotice title="Reports" tone="error" message="Reports are temporarily unavailable."
          detail="Nothing is shown rather than numbers we can't stand behind." onRetry={scope.reload} />
      )}
      {scopeError && requestedScope && <button type="button" className="text-sm text-primary underline underline-offset-4" onClick={() => { setScopeSelection({ key: viewerKey, value: null }); setAgentSel({ key: null, id: null }); }}>Use default report scope</button>}
      {scopeDrift && !panelZoneMissing && (
        <ReportNotice title="Reports" tone="unavailable" message="Your report access changed while this page was open."
          detail="Reload to see reports for your current access." onRetry={scope.reload} />
      )}
      {scopeData && !range && preset === "custom" && (
        <ReportNotice title="Custom range" tone="unavailable" message="Pick a start and end date to run the report." />
      )}
      {sections && (
        <div id="reports-scope-panel" role="tabpanel" aria-labelledby={`report-scope-${scopeData?.requested_scope}`} className="min-w-0 space-y-8">
          {preferences.status === "error" && <ReportNotice title="Your layout" tone="error" message="Your saved layout couldn't be loaded." detail="Reports are using the standard layout. Retry before customizing." onRetry={preferences.reload} />}
          <ReportCustomizer editMode={preferences.editMode} sections={preferences.draft.sections} onSectionsChange={preferences.setSections}
            showTeamSections={scopeData?.scope !== "own"} busy={preferences.busy} error={preferences.error}
            onSave={preferences.save} onCancel={preferences.cancel} onReset={preferences.reset} />
          <ReportsOverview summary={reports.panels.summary} onRetry={() => reports.retryPanel("summary")} />
          <SectionRenderer group="stats" sections={layout.sections} showTeamSections={scopeData?.scope !== "own"} components={sections} />
          <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2" data-report-group="trends">
            <div className="min-w-0" data-report-section="policies_sold">{sections.policies_sold}</div>
            <div className="min-w-0" data-report-section="call_volume">{sections.call_volume}</div>
          </div>
          <ReportsActivityFlow summary={reports.panels.summary} onRetry={() => reports.retryPanel("summary")} />
          <SectionRenderer group="performance" sections={layout.sections} showTeamSections={scopeData?.scope !== "own"} components={sections} />
          <SectionRenderer group="diagnostics" sections={layout.sections} showTeamSections={scopeData?.scope !== "own"} components={sections} />
          {reports.panels.summary.status === "ready" && <ReportDataQuality summary={reports.panels.summary.data} />}
        </div>
      )}
    </div>
  );
};
export default Reports;
