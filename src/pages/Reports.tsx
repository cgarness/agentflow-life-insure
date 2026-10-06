import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useReportPanels, useReportScope, type PanelKey } from "@/hooks/useReportsData";
import {
  autoGrouping, dayCount, presetRange, validateRange,
  type CalendarRange, type Grouping, type ReportPreset,
} from "@/lib/reports-format";
import { buildReportCsv, csvFileName, downloadCsv, type ReportExportFn } from "@/lib/reports-export";
import ReportDataQuality from "@/components/reports/ReportDataQuality";
import { integrityExportNotes } from "@/lib/reports-integrity-text";
import { policyExportNotes } from "@/lib/reports-policy-text";
import { fetchUserLayout, getDefaultLayout, resetUserLayout, saveOrgDefaultLayout, saveUserLayout } from "@/lib/report-layout";
import type { ReportLayoutConfig, SectionConfig } from "@/lib/report-layout-constants";
import ReportsToolbar from "@/components/reports/ReportsToolbar";
import ReportCustomizer from "@/components/reports/ReportCustomizer";
import SectionRenderer from "@/components/reports/SectionRenderer";
import { ReportNotice, ReportPanelSkeleton } from "@/components/reports/ReportPanelState";
import { buildReportSections } from "@/components/reports/reportSectionMap";
const Reports: React.FC = () => {
  const { profile, isImpersonating } = useAuth();
  const viewerId = isImpersonating ? null : profile?.id ?? null;
  const orgId = profile?.organization_id ?? null;
  const canSetOrgDefault = profile?.role === "Admin" || profile?.is_super_admin === true;
  const scope = useReportScope(viewerId, orgId);
  const scopeData = scope.state.status === "ready" ? scope.state.data : null;
  const [preset, setPreset] = useState<ReportPreset>("30d");
  const [customStart, setCustomStart] = useState<string | null>(null);
  const [customEnd, setCustomEnd] = useState<string | null>(null);
  const [agentSel, setAgentSel] = useState<{ key: string | null; id: string | null }>({ key: null, id: null });
  const [groupingSel, setGroupingSel] = useState<Grouping | null>(null);
  const [layout, setLayout] = useState<ReportLayoutConfig>(getDefaultLayout());
  const [editMode, setEditMode] = useState(false);
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
  useEffect(() => {
    if (!orgId || !viewerId) return;
    let live = true;
    fetchUserLayout(orgId).then((l) => live && setLayout(l), (e) => console.error("[Reports] layout load failed:", e));
    return () => { live = false; };
  }, [orgId, viewerId]);
  const scopeDrift = !!scopeData && Object.values(reports.panels).some((p) =>
    p.status === "ready" &&
    (p.data.scope !== scopeData.scope || p.data.window.time_zone !== scopeData.time_zone || p.data.filter_agent_id !== agentId || p.data.requested_scope !== scopeData.requested_scope || p.data.window.start_date !== range?.startDate || p.data.window.end_date !== range?.endDate));
  const panelZoneMissing = Object.values(reports.panels).some((p) => p.status === "error" && p.error.kind === "configuration");
  const withheld = scopeDrift || panelZoneMissing;
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
  const onSections = (next: SectionConfig[]) => setLayout((prev) => ({ ...prev, sections: next }));
  const saveLayout = async () => { if (orgId) { await saveUserLayout(orgId, layout); setEditMode(false); } };
  const resetLayout = async () => { if (orgId) { await resetUserLayout(orgId); setLayout(await fetchUserLayout(orgId)); setEditMode(false); } };
  const saveDefault = async () => { if (orgId && canSetOrgDefault) { await saveOrgDefaultLayout(orgId, layout); setEditMode(false); } };
  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-10">
      <ReportsToolbar
        scope={scopeData} scopeStatusText={scopeStatusText} preset={preset} onPreset={setPreset}
        customStart={customStart} customEnd={customEnd} onCustomStart={setCustomStart} onCustomEnd={setCustomEnd}
        range={range} rangeProblem={rangeProblem} agentId={agentId} onAgent={onAgent}
        editMode={editMode} onToggleEdit={() => setEditMode((v) => !v)} onRefresh={scope.reload}
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
      {scopeDrift && !panelZoneMissing && (
        <ReportNotice title="Reports" tone="unavailable" message="Your report access changed while this page was open."
          detail="Reload to see reports for your current access." onRetry={scope.reload} />
      )}
      {scopeData && !range && preset === "custom" && (
        <ReportNotice title="Custom range" tone="unavailable" message="Pick a start and end date to run the report." />
      )}
      {sections && (
        <>
          {reports.panels.summary.status === "ready" && <ReportDataQuality summary={reports.panels.summary.data} />}
          <ReportCustomizer editMode={editMode} canSetOrgDefault={canSetOrgDefault} onSave={saveLayout} onReset={resetLayout} onSaveAsDefault={saveDefault} />
          <SectionRenderer
            sections={layout.sections} editMode={editMode} showTeamSections={scopeData?.scope !== "own"}
            onSectionsChange={onSections} components={sections}
          />
        </>
      )}
    </div>
  );
};
export default Reports;
