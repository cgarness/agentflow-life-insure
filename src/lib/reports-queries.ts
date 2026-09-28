/**
 * reports-queries.ts — the ONE data layer for the Reports page.
 *
 * Every report number comes from the secured, scope-enforcing `get_report_*` RPCs
 * (supabase/migrations/20260928120000_reports_secure_scoped_rpcs.sql). The server derives the caller,
 * organization, permitted scope and the agency time zone; the browser only sends local AGENCY
 * calendar dates and an optional agent id, which the server may only use to NARROW the scope.
 *
 * Failure contract (AGENT_RULES #22/#23/#34): every fetcher THROWS a `ReportsQueryError` — it never
 * returns a zero-shaped object. A failed or mis-shaped response is an error state in the UI, never 0.
 * The RPCs are absent from the generated types, so they are called through a narrow cast, as with the
 * other aggregate RPCs (AGENT_RULES #14/#16/#17).
 */
import type { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  reportCampaignsSchema,
  reportDispositionsSchema,
  reportLeadSourcesSchema,
  reportScopeSchema,
  reportSummarySchema,
  reportVolumeSchema,
  type ReportCampaigns,
  type ReportDispositions,
  type ReportLeadSources,
  type ReportScope,
  type ReportSummary,
  type ReportVolume,
} from "@/lib/reports-schemas";

export type ReportsErrorKind = "denied" | "invalid" | "timeout" | "aborted" | "unavailable";

const USER_MESSAGES: Record<ReportsErrorKind, string> = {
  denied: "You don't have access to this report.",
  invalid: "That date range can't be reported. Choose up to 366 days with the end on or after the start.",
  timeout: "The report took too long to load.",
  aborted: "The request was cancelled.",
  unavailable: "Reports are temporarily unavailable.",
};

export class ReportsQueryError extends Error {
  readonly kind: ReportsErrorKind;
  /** The raw provider error, for console diagnostics only — never rendered. */
  readonly cause: unknown;
  constructor(kind: ReportsErrorKind, cause?: unknown) {
    super(USER_MESSAGES[kind]);
    this.name = "ReportsQueryError";
    this.kind = kind;
    this.cause = cause;
  }
}

export function isReportsQueryError(e: unknown): e is ReportsQueryError {
  return e instanceof ReportsQueryError;
}

/** Bound on a single report request; afterwards it is reported as `timeout`, never left spinning. */
export const REPORT_REQUEST_TIMEOUT_MS = 25_000;

export const REPORT_RPC = {
  scope: "get_report_scope",
  summary: "get_report_call_summary",
  volume: "get_report_call_volume",
  dispositions: "get_report_disposition_breakdown",
  campaigns: "get_report_campaign_performance",
  leadSources: "get_report_lead_source_performance",
} as const;

type ReportRpcName = (typeof REPORT_RPC)[keyof typeof REPORT_RPC];

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
}

function kindForProviderError(error: PostgrestLikeError): ReportsErrorKind {
  const code = error.code ?? "";
  if (code === "42501") return "denied";
  if (code === "22023") return "invalid";
  return "unavailable";
}

/** Local AGENCY calendar date, `YYYY-MM-DD`. Validated so a malformed value never reaches the server. */
export type ReportDate = string;
const REPORT_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportRequest {
  startDate: ReportDate;
  endDate: ReportDate;
  /** Narrows to one agent inside the caller's scope. `null` = the caller's whole permitted scope. */
  agentId: string | null;
}

async function callReportRpc<T>(
  fn: ReportRpcName,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REPORT_REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    if (controller.signal.aborted) throw new ReportsQueryError(timedOut ? "timeout" : "aborted");
    let response: { data: unknown; error: PostgrestLikeError | null };
    try {
      response = await (supabase as any).rpc(fn, args).abortSignal(controller.signal);
    } catch (thrown) {
      if (signal?.aborted) throw new ReportsQueryError("aborted", thrown);
      if (timedOut) throw new ReportsQueryError("timeout", thrown);
      throw new ReportsQueryError("unavailable", thrown);
    }
    // postgrest-js reports an abort as an ordinary error with an empty code, so the cause is decided
    // by which signal fired, never by the error's shape.
    if (signal?.aborted) throw new ReportsQueryError("aborted", response?.error);
    if (timedOut) throw new ReportsQueryError("timeout", response?.error);
    if (!response) throw new ReportsQueryError("unavailable");
    if (response.error) {
      const kind = kindForProviderError(response.error);
      console.error(`[Reports] ${fn} failed (${kind}):`, response.error);
      throw new ReportsQueryError(kind, response.error);
    }
    if (response.data === null || response.data === undefined) {
      console.error(`[Reports] ${fn} returned no data`);
      throw new ReportsQueryError("unavailable");
    }
    const parsed = schema.safeParse(response.data);
    if (!parsed.success) {
      console.error(`[Reports] ${fn} returned an unexpected shape:`, parsed.error.issues.slice(0, 5));
      throw new ReportsQueryError("unavailable", parsed.error);
    }
    return parsed.data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

function windowArgs(req: ReportRequest): Record<string, unknown> {
  if (!REPORT_DATE.test(req.startDate) || !REPORT_DATE.test(req.endDate)) {
    throw new ReportsQueryError("invalid");
  }
  return { p_start_date: req.startDate, p_end_date: req.endDate, p_agent_id: req.agentId ?? null };
}

export function fetchReportScope(signal?: AbortSignal): Promise<ReportScope> {
  return callReportRpc(REPORT_RPC.scope, {}, reportScopeSchema, signal);
}

export async function fetchReportSummary(req: ReportRequest, signal?: AbortSignal): Promise<ReportSummary> {
  return callReportRpc(REPORT_RPC.summary, windowArgs(req), reportSummarySchema, signal);
}

export async function fetchReportVolume(req: ReportRequest, signal?: AbortSignal): Promise<ReportVolume> {
  return callReportRpc(REPORT_RPC.volume, windowArgs(req), reportVolumeSchema, signal);
}

export async function fetchReportDispositions(req: ReportRequest, signal?: AbortSignal): Promise<ReportDispositions> {
  return callReportRpc(REPORT_RPC.dispositions, windowArgs(req), reportDispositionsSchema, signal);
}

export async function fetchReportCampaigns(req: ReportRequest, signal?: AbortSignal): Promise<ReportCampaigns> {
  return callReportRpc(REPORT_RPC.campaigns, windowArgs(req), reportCampaignsSchema, signal);
}

export async function fetchReportLeadSources(req: ReportRequest, signal?: AbortSignal): Promise<ReportLeadSources> {
  return callReportRpc(REPORT_RPC.leadSources, windowArgs(req), reportLeadSourcesSchema, signal);
}

// ─── Legacy saved / scheduled report CRUD ─────────────────────────────────────────────────────────
// Kept ONLY so the unmounted CustomReportBuilder / ScheduledReportsModal files still compile. The
// Reports page no longer mounts either feature (plan D-8: saved reports cannot be run, scheduled
// reports are never delivered). Do not wire these back without a separately approved design.

export interface AgentProfile {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  email: string;
}

export async function fetchSavedReports(orgId?: string | null) {
  let q = supabase.from("saved_reports").select("*").order("created_at", { ascending: false });
  if (orgId) q = q.eq("organization_id", orgId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createSavedReport(name: string, config: any, userId: string, organizationId: string | null = null) {
  const { error } = await supabase.from("saved_reports").insert({ name, config, created_by: userId, organization_id: organizationId } as any);
  if (error) throw error;
}

export async function deleteSavedReport(id: string) {
  const { error } = await supabase.from("saved_reports").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchScheduledReports(orgId?: string | null) {
  let q = supabase.from("scheduled_reports").select("*").order("created_at", { ascending: false });
  if (orgId) q = q.eq("organization_id", orgId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createScheduledReport(report: any, organizationId: string | null = null) {
  const { error } = await supabase.from("scheduled_reports").insert({ ...report, organization_id: organizationId } as any);
  if (error) throw error;
}

export async function updateScheduledReport(id: string, updates: any) {
  const { error } = await supabase.from("scheduled_reports").update(updates).eq("id", id);
  if (error) throw error;
}

export async function deleteScheduledReport(id: string) {
  const { error } = await supabase.from("scheduled_reports").delete().eq("id", id);
  if (error) throw error;
}
