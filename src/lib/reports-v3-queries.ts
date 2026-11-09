// The nine Reports v3 readers (D1 §4, RL-1). This module never names a v2 reader; there is no v2 fallback.
import type { z } from "zod";
import { callReportRpc, windowArgs, type ReportRequest } from "@/lib/reports-queries";
import type { ReportRequestedScope } from "@/lib/reports-schemas";
import {
  reportCallVolumeV3Schema, reportCampaignCallsV3Schema, reportDispositionsV3Schema, reportJourneyV3Schema,
  reportLeadSourceCallsV3Schema, reportSalesAppointmentsV3Schema, reportScopeV3Schema, reportStateBreakdownV3Schema,
  reportSummaryV3Schema, type ReportCallVolumeV3, type ReportCampaignCallsV3, type ReportDispositionsV3,
  type ReportJourneyV3, type ReportLeadSourceCallsV3, type ReportSalesAppointmentsV3, type ReportScopeV3,
  type ReportStateBreakdownV3, type ReportSummaryV3,
} from "@/lib/reports-v3-schemas";

/** The refined v3 schemas parse unknown input; this states that output type for the shared caller (type only). */
const out = <T,>(schema: z.ZodType<T, z.ZodTypeDef, unknown>) => schema as unknown as z.ZodType<T>;

export const REPORT_RPC_V3 = {
  scope: "get_report_scope_v3",
  summary: "get_report_summary_v3",
  journey: "get_report_journey_v3",
  salesAppointments: "get_report_sales_appointments_v3",
  states: "get_report_state_breakdown_v3",
  volume: "get_report_call_volume_v3",
  dispositions: "get_report_disposition_breakdown_v3",
  campaigns: "get_report_campaign_calls_v3",
  leadSources: "get_report_lead_source_calls_v3",
} as const;

export function fetchReportScopeV3(signal?: AbortSignal, requestedScope: ReportRequestedScope | null = null): Promise<ReportScopeV3> {
  return callReportRpc(REPORT_RPC_V3.scope, { p_requested_scope: requestedScope }, out(reportScopeV3Schema), signal);
}
export const fetchReportSummaryV3 = (req: ReportRequest, signal?: AbortSignal): Promise<ReportSummaryV3> =>
  callReportRpc(REPORT_RPC_V3.summary, windowArgs(req), out(reportSummaryV3Schema), signal);
export const fetchReportJourneyV3 = (req: ReportRequest, signal?: AbortSignal): Promise<ReportJourneyV3> =>
  callReportRpc(REPORT_RPC_V3.journey, windowArgs(req), out(reportJourneyV3Schema), signal);
export const fetchReportSalesAppointmentsV3 = (req: ReportRequest, signal?: AbortSignal): Promise<ReportSalesAppointmentsV3> =>
  callReportRpc(REPORT_RPC_V3.salesAppointments, windowArgs(req), out(reportSalesAppointmentsV3Schema), signal);
export const fetchReportStateBreakdownV3 = (req: ReportRequest, signal?: AbortSignal): Promise<ReportStateBreakdownV3> =>
  callReportRpc(REPORT_RPC_V3.states, windowArgs(req), out(reportStateBreakdownV3Schema), signal);
export const fetchReportCallVolumeV3 = (req: ReportRequest, signal?: AbortSignal): Promise<ReportCallVolumeV3> =>
  callReportRpc(REPORT_RPC_V3.volume, windowArgs(req), out(reportCallVolumeV3Schema), signal);
export const fetchReportDispositionBreakdownV3 = (req: ReportRequest, signal?: AbortSignal): Promise<ReportDispositionsV3> =>
  callReportRpc(REPORT_RPC_V3.dispositions, windowArgs(req), out(reportDispositionsV3Schema), signal);
export const fetchReportCampaignCallsV3 = (req: ReportRequest, signal?: AbortSignal): Promise<ReportCampaignCallsV3> =>
  callReportRpc(REPORT_RPC_V3.campaigns, windowArgs(req), out(reportCampaignCallsV3Schema), signal);
export const fetchReportLeadSourceCallsV3 = (req: ReportRequest, signal?: AbortSignal): Promise<ReportLeadSourceCallsV3> =>
  callReportRpc(REPORT_RPC_V3.leadSources, windowArgs(req), out(reportLeadSourceCallsV3Schema), signal);
