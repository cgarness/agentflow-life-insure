// Reports v3 exports (D6 §4.8–4.9): an exporter exists only while the viewer may export and the panel is current for
// this exact request; every file carries the v3 meta rows and its Note rows. Nothing is written for a stale panel.
import { useCallback } from "react";
import { toast } from "sonner";
import { buildReportCsv, csvFileName, downloadCsv, KPI_COVERAGE_HEADERS, type ReportExportFn } from "@/lib/reports-export";
import type { PanelKey, Panels } from "@/lib/reports-panels";
import type { KpiEnvelope, ReportScopeV3 } from "@/lib/reports-v3-schemas";
import { REPORT_V3_KPI_IDS } from "@/lib/reports-v3-schemas";
import { callNotes, kpiNotes, kpiRows } from "@/lib/reports-v3-export";

const CALL_PANELS: PanelKey[] = ["volume", "dispositions", "campaigns", "leadSources", "states"];
const READER_NAMES: Record<PanelKey, string> = { summary: "summary", journey: "journey", salesAppointments: "sales_appointments", states: "state_breakdown",
  volume: "call_volume", dispositions: "disposition_breakdown", campaigns: "campaign_calls", leadSources: "lead_source_calls" };

export function useReportExports(scope: ReportScopeV3 | null, panels: Panels, exportable: (key: PanelKey) => boolean, agentId: string | null) {
  const agentLabel = useCallback((s: string) => (agentId ? scope?.agents.find(a => a.id === agentId)?.name ?? "Selected agent"
    : s === "own" ? "You" : s === "team" ? "Whole team" : "All agents"), [scope, agentId]);

  const exportFor = useCallback((key: PanelKey): ReportExportFn | undefined => {
    if (!scope?.can_export || !exportable(key)) return undefined;
    const state = panels[key];
    if (state.status !== "ready") return undefined;
    const data = state.data as { scope: "own" | "team" | "organization"; window: never; as_of: string; contract_version: string; period_open: boolean; call_population?: { unverified: number } };
    return (report, headers, rows) => {
      if (!exportable(key)) { toast.error("This report changed while exporting. Export again once it has loaded."); return; }
      const notes = CALL_PANELS.includes(key) ? callNotes(data.call_population?.unverified ?? 0, key === "campaigns" || key === "leadSources") : [];
      downloadCsv(csvFileName(report, data.window), buildReportCsv({ report, scope: data.scope, agentLabel: agentLabel(data.scope), window: data.window,
        basisVersion: "reports_v3", contractVersion: data.contract_version, periodOpen: data.period_open, readerAsOf: [[READER_NAMES[key], data.as_of]], notes }, headers, rows));
    };
  }, [scope, panels, exportable, agentLabel]);

  /** Report summary: the 23 KPIs from three readers; rows of a panel that is not current are panel_not_loaded. */
  const exportSummary = useCallback(() => {
    if (!scope?.can_export || !exportable("summary") || panels.summary.status !== "ready") return;
    const summary = panels.summary.data;
    const owners: PanelKey[] = ["summary", "journey", "salesAppointments"];
    const current = (k: PanelKey) => exportable(k) && panels[k].status === "ready";
    const envelopeOf = (id: number): KpiEnvelope | null => {
      for (const k of owners) {
        const p = panels[k];
        if (p.status === "ready" && current(k)) { const m = (p.data as { metrics: KpiEnvelope[] }).metrics.find(e => e.id === id); if (m) return m; }
      }
      return null;
    };
    const ids = [...REPORT_V3_KPI_IDS];
    downloadCsv(csvFileName("Report summary", summary.window), buildReportCsv({
      report: "Report summary", scope: summary.scope, agentLabel: agentLabel(summary.scope), window: summary.window, basisVersion: "reports_v3",
      contractVersion: summary.contract_version, periodOpen: summary.period_open,
      readerAsOf: owners.filter(current).map(k => [READER_NAMES[k], (panels[k] as { data: { as_of: string } }).data.as_of]),
      notes: kpiNotes(ids, envelopeOf),
    }, KPI_COVERAGE_HEADERS, kpiRows(ids, envelopeOf)));
  }, [scope, panels, exportable, agentLabel]);

  return { exportFor, exportSummary };
}
