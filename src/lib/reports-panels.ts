// The eight Reports v3 panels, each bound to its v3 reader (D6 §4.8). Scope is fetched separately and gates them all.
import type { ReportRequest, ReportsErrorKind } from "@/lib/reports-queries";
import {
  fetchReportCallVolumeV3, fetchReportCampaignCallsV3, fetchReportDispositionBreakdownV3, fetchReportJourneyV3,
  fetchReportLeadSourceCallsV3, fetchReportSalesAppointmentsV3, fetchReportStateBreakdownV3, fetchReportSummaryV3,
} from "@/lib/reports-v3-queries";
import type {
  ReportCallVolumeV3, ReportCampaignCallsV3, ReportDispositionsV3, ReportJourneyV3, ReportLeadSourceCallsV3,
  ReportSalesAppointmentsV3, ReportStateBreakdownV3, ReportSummaryV3,
} from "@/lib/reports-v3-schemas";

export const PANEL_KEYS = ["summary", "journey", "salesAppointments", "states", "volume", "dispositions", "campaigns", "leadSources"] as const;
export type PanelKey = (typeof PANEL_KEYS)[number];

export interface PanelData {
  summary: ReportSummaryV3; journey: ReportJourneyV3; salesAppointments: ReportSalesAppointmentsV3; states: ReportStateBreakdownV3;
  volume: ReportCallVolumeV3; dispositions: ReportDispositionsV3; campaigns: ReportCampaignCallsV3; leadSources: ReportLeadSourceCallsV3;
}

export const FETCHERS: { [K in PanelKey]: (req: ReportRequest, signal?: AbortSignal) => Promise<PanelData[K]> } = {
  summary: fetchReportSummaryV3, journey: fetchReportJourneyV3, salesAppointments: fetchReportSalesAppointmentsV3,
  states: fetchReportStateBreakdownV3, volume: fetchReportCallVolumeV3, dispositions: fetchReportDispositionBreakdownV3,
  campaigns: fetchReportCampaignCallsV3, leadSources: fetchReportLeadSourceCallsV3,
};

/** `drift`: the response did not match its request or the resolved scope (withheld, never shown as data). */
export type PanelState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; kind: ReportsErrorKind; drift?: boolean };
export type Panels = { [K in PanelKey]: PanelState<PanelData[K]> };
export const ALL_LOADING = Object.fromEntries(PANEL_KEYS.map(k => [k, { status: "loading" }])) as Panels;

/** A KPI's envelope from its panel: undefined while loading, null when the panel failed (never shown as 0). */
export function envelopeFor(panels: Panels, id: number) {
  const panel = [panels.summary, panels.journey, panels.salesAppointments].find(p => p.status === "ready" && p.data.metrics.some(m => m.id === id));
  if (panel?.status === "ready") return panel.data.metrics.find(m => m.id === id)!;
  const owner = [8, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 24, 25, 34].includes(id) ? panels.summary
    : [14, 19, 21, 38].includes(id) ? panels.journey : panels.salesAppointments;
  return owner.status === "error" ? null : undefined;
}
