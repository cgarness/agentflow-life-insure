// Reports v3 exports (D6 §4.8–4.9): an exporter exists only while the viewer may export and the panel is current for
// this exact request; every file carries the v3 meta rows and its Note rows. Nothing is written for a stale panel.
import { useCallback } from "react";
import { toast } from "sonner";
import { buildReportCsv, csvFileName, downloadCsv, KPI_COVERAGE_HEADERS, type CsvCell, type ReportExportFn } from "@/lib/reports-export";
import type { PanelKey, Panels } from "@/lib/reports-panels";
import type { KpiEnvelope, ReportScopeV3 } from "@/lib/reports-v3-schemas";
import { REPORT_V3_KPI_IDS } from "@/lib/reports-v3-schemas";
import { agentCsv, agentRows, callNotes, kpiNotes, kpiRows, stateCsv, unattributed } from "@/lib/reports-v3-export";

const CALL_PANELS: PanelKey[] = ["volume", "dispositions", "campaigns", "leadSources", "states"];
const READER_NAMES: Record<PanelKey, string> = { summary: "summary", journey: "journey", salesAppointments: "sales_appointments", states: "state_breakdown",
  volume: "call_volume", dispositions: "disposition_breakdown", campaigns: "campaign_calls", leadSources: "lead_source_calls" };
const KPI_OWNERS = ["summary", "journey", "salesAppointments"] as const;
type KpiOwner = (typeof KPI_OWNERS)[number];
export type KpiFile = "summary" | "journey" | "salesAppointments";
export const KPI_FILE_NAMES: Record<KpiFile, string> = { summary: "Report summary", journey: "Journey", salesAppointments: "Sales appointments" };

interface Meta { scope: "own" | "team" | "organization"; window: never; as_of: string; contract_version: string; period_open: boolean }

export function useReportExports(scope: ReportScopeV3 | null, panels: Panels, exportable: (key: PanelKey) => boolean, agentId: string | null) {
  const agentLabel = useCallback((s: string) => (agentId ? scope?.agents.find(a => a.id === agentId)?.name ?? "Selected agent"
    : s === "own" ? "You" : s === "team" ? "Whole team" : "All agents"), [scope, agentId]);
  const current = useCallback((k: PanelKey) => exportable(k) && panels[k].status === "ready", [panels, exportable]);
  const meta = (k: PanelKey) => (panels[k] as unknown as { data: Meta }).data;

  /** Writes one file whose meta rows come from `primary`; refuses when it stopped being current mid-export. */
  const write = useCallback((primary: PanelKey, report: string, readers: PanelKey[], headers: string[], rows: CsvCell[][], notes: string[]) => {
    if (!current(primary)) { toast.error("This report changed while exporting. Export again once it has loaded."); return; }
    const d = meta(primary);
    downloadCsv(csvFileName(report, d.window), buildReportCsv({ report, scope: d.scope, agentLabel: agentLabel(d.scope), window: d.window,
      basisVersion: "reports_v3", contractVersion: d.contract_version, periodOpen: d.period_open,
      readerAsOf: readers.filter(current).map(k => [READER_NAMES[k], meta(k).as_of]), notes }, headers, rows));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, agentLabel, panels]);

  const allowed = (key: PanelKey) => !!scope?.can_export && current(key);

  const exportFor = useCallback((key: PanelKey): ReportExportFn | undefined => {
    if (!allowed(key)) return undefined;
    const unverified = (meta(key) as Meta & { call_population?: { unverified: number } }).call_population?.unverified ?? 0;
    return (report, headers, rows) => write(key, report, [key], headers, rows,
      CALL_PANELS.includes(key) ? callNotes(unverified, key === "campaigns" || key === "leadSources") : []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, current, write]);

  /** A KPI file (Report summary: the 23 KPIs from three readers; Journey; Sales appointments). Rows of a panel that is
   *  not current are panel_not_loaded. */
  const exportKpis = useCallback((file: KpiFile) => {
    if (!allowed(file)) return;
    const owners: KpiOwner[] = file === "summary" ? [...KPI_OWNERS] : [file];
    const envelopeOf = (id: number): KpiEnvelope | null => {
      for (const k of owners) {
        const p = panels[k];
        if (p.status === "ready" && current(k)) { const m = (p.data as { metrics: KpiEnvelope[] }).metrics.find(e => e.id === id); if (m) return m; }
      }
      return null;
    };
    const own = panels[file];
    const ids = file === "summary" ? [...REPORT_V3_KPI_IDS] : own.status === "ready" ? own.data.metrics.map(m => m.id) : [];
    write(file, KPI_FILE_NAMES[file], owners, KPI_COVERAGE_HEADERS, kpiRows(ids, envelopeOf), kpiNotes(ids, envelopeOf));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, panels, current, write]);
  const exportSummary = useCallback(() => exportKpis("summary"), [exportKpis]);

  /** Regional performance (D5 §4): the state file, with the call notes and the state basis and mode notices. */
  const exportRegional = allowed("states") ? () => {
    if (panels.states.status !== "ready") return;
    const f = stateCsv(panels.states.data);
    write("states", "Regional performance", ["states"], f.headers, f.rows, [...callNotes(panels.states.data.call_population.unverified), ...f.notes]);
  } : undefined;

  /** Agent performance: the summary's agents joined to journey and sales appointments; only current panels contribute. */
  const exportAgents = allowed("summary") ? () => {
    const f = agentCsv(agentRows(panels, current), scope?.scope === "organization" ? unattributed(panels) : null);
    write("summary", "Agent performance", [...KPI_OWNERS], f.headers, f.rows, f.notes);
  } : undefined;

  return { exportFor, exportSummary, exportKpis, exportRegional, exportAgents, kpiFileReady: (f: KpiFile) => allowed(f) };
}
