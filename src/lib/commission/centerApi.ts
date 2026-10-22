import type { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  breakdownSchema, goalClearSchema, goalSchema, goalSetSchema, overviewSchema, parseDrawer, policyListSchema, receiptListSchema,
  scheduledPageSchema, type CommissionBreakdown, type CommissionDrawerData, type CommissionGoal, type CommissionOverview,
  type PolicyListPage, type ReceiptListPage, type ScheduledPage,
} from "./centerSchemas";
import {
  PAGE_SIZE, periodArgs, type CommissionPeriod, type HistoryFilter, type PoliciesFilter, type ScheduledFilter,
} from "./centerFilters";

/**
 * Commissions center reads. The server scopes every read to the signed-in seller (My commissions) and resolves the
 * period against the agency date; nothing sent here is authority. Errors keep their kind so the page can explain
 * them: no access (42501), agency time zone not set (55000), invalid filter (22023), not found (PT404).
 */
export type CenterErrorKind = "denied" | "time_zone" | "invalid" | "not_found" | "unknown";

export class CommissionCenterError extends Error {
  readonly kind: CenterErrorKind;
  readonly code: string | null;
  constructor(message: string, kind: CenterErrorKind, code: string | null) {
    super(message);
    this.name = "CommissionCenterError";
    this.kind = kind;
    this.code = code;
  }
}

const KIND_BY_CODE: Record<string, CenterErrorKind> = { "42501": "denied", "55000": "time_zone", "22023": "invalid", PT404: "not_found" };
const MESSAGES: Record<CenterErrorKind, string> = {
  denied: "Commissions aren't available for your account.",
  time_zone: "An admin needs to set the agency time zone in Settings › Company Branding.",
  invalid: "Check the filters and try again.",
  not_found: "This commission is no longer available.",
  unknown: "Commissions couldn't load. Try again.",
};

async function read<T extends z.ZodTypeAny>(fn: string, args: Record<string, unknown>, parse: (raw: unknown) => z.infer<T>,
  signal?: AbortSignal): Promise<z.infer<T>> {
  let response: { data: unknown; error: { message?: string; code?: string } | null };
  try {
    let request = (supabase as any).rpc(fn, args);
    if (signal) request = request.abortSignal(signal);
    response = await request;
  } catch {
    throw new CommissionCenterError(MESSAGES.unknown, "unknown", null);
  }
  if (response.error) {
    const code = response.error.code || null;
    const kind = (code && KIND_BY_CODE[code]) || "unknown";
    // 22023 messages are written by the read functions for people; the rest get a fixed explanation.
    throw new CommissionCenterError(kind === "invalid" ? response.error.message || MESSAGES.invalid : MESSAGES[kind], kind, code);
  }
  try {
    return parse(response.data);
  } catch {
    throw new CommissionCenterError(MESSAGES.unknown, "unknown", null);
  }
}

const offset = (page: number) => (page - 1) * PAGE_SIZE;
const carrierArgs = (f: { carrier: string | null; carrierUnknown: boolean }) =>
  ({ p_carrier: f.carrierUnknown ? null : f.carrier, p_carrier_unknown: f.carrierUnknown });

export const commissionCenterApi = {
  overview: (period: CommissionPeriod, signal?: AbortSignal): Promise<CommissionOverview> =>
    read("get_my_commission_overview", periodArgs(period), (raw) => overviewSchema.parse(raw), signal),
  scheduled: (f: ScheduledFilter, signal?: AbortSignal): Promise<ScheduledPage> =>
    read("get_my_commission_installments", {
      ...periodArgs(f.period), p_scope: f.scope === "period" ? "range" : f.scope, p_status: f.status, p_kind: f.kind, p_carrier: f.carrier,
      p_limit: PAGE_SIZE, p_offset: offset(f.page),
    }, (raw) => scheduledPageSchema.parse(raw), signal),
  history: (f: HistoryFilter, signal?: AbortSignal): Promise<ReceiptListPage> =>
    read("get_my_commission_receipt_list", { ...periodArgs(f.period), p_include_voided: f.includeVoided, ...carrierArgs(f),
      p_limit: PAGE_SIZE, p_offset: offset(f.page) }, (raw) => receiptListSchema.parse(raw), signal),
  policies: (f: PoliciesFilter, signal?: AbortSignal): Promise<PolicyListPage> =>
    read("get_my_commission_policy_list", { p_setup: f.setup, ...carrierArgs(f), p_category: f.category, ...periodArgs(f.period),
      p_limit: PAGE_SIZE, p_offset: offset(f.page) }, (raw) => policyListSchema.parse(raw), signal),
  breakdown: (period: CommissionPeriod, signal?: AbortSignal): Promise<CommissionBreakdown> =>
    read("get_my_commission_breakdown", periodArgs(period), (raw) => breakdownSchema.parse(raw), signal),
  /** The signed-in seller's goal for one calendar month (`month` is its first day); never creates one. */
  goal: (month: string, signal?: AbortSignal): Promise<CommissionGoal> =>
    read("get_my_commission_goal", { p_month: month }, (raw) => goalSchema.parse(raw), signal),
  setGoal: (month: string, targetCents: number) =>
    read("set_my_commission_goal", { p_month: month, p_target_cents: targetCents }, (raw) => goalSetSchema.parse(raw)),
  clearGoal: (month: string) => read("clear_my_commission_goal", { p_month: month }, (raw) => goalClearSchema.parse(raw)),
  policy: (policyId: string, signal?: AbortSignal): Promise<CommissionDrawerData> =>
    read("get_my_policy_commission", { p_policy_id: policyId }, parseDrawer, signal),
};
