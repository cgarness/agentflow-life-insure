import type { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  historyPageSchema, overviewSchema, parseDrawer, policiesPageSchema, scheduledPageSchema,
  type CommissionDrawerData, type CommissionOverview, type HistoryPage, type PoliciesPage, type ScheduledPage,
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

export const commissionCenterApi = {
  overview: (period: CommissionPeriod, signal?: AbortSignal): Promise<CommissionOverview> =>
    read("get_my_commission_overview", periodArgs(period), (raw) => overviewSchema.parse(raw), signal),
  scheduled: (f: ScheduledFilter, signal?: AbortSignal): Promise<ScheduledPage> =>
    read("get_my_commission_installments", {
      ...periodArgs(f.period), p_scope: f.scope === "period" ? "range" : f.scope, p_status: f.status, p_kind: f.kind, p_carrier: f.carrier,
      p_limit: PAGE_SIZE, p_offset: offset(f.page),
    }, (raw) => scheduledPageSchema.parse(raw), signal),
  history: (f: HistoryFilter, signal?: AbortSignal): Promise<HistoryPage> =>
    read("get_my_commission_receipts", { ...periodArgs(f.period), p_include_voided: f.includeVoided, p_limit: PAGE_SIZE, p_offset: offset(f.page) },
      (raw) => historyPageSchema.parse(raw), signal),
  policies: (f: PoliciesFilter, signal?: AbortSignal): Promise<PoliciesPage> =>
    read("get_my_commission_policies", { p_setup: f.setup, p_carrier: f.carrier, p_limit: PAGE_SIZE, p_offset: offset(f.page) },
      (raw) => policiesPageSchema.parse(raw), signal),
  policy: (policyId: string, signal?: AbortSignal): Promise<CommissionDrawerData> =>
    read("get_my_policy_commission", { p_policy_id: policyId }, parseDrawer, signal),
};
