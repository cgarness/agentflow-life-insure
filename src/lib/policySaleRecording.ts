import { supabase } from "@/integrations/supabase/client";
import type { CommissionPayload } from "@/lib/commission/capture";
import {
  classifySaleError,
  freezeSale,
  isRecord,
  notSentError,
  parseCommissionOutcome,
  parseSaleResult,
  SaleRequestError,
  type PreparedSale,
  type SaleAttempt,
  type SaleHandoffResult,
  type SaleKind,
  type SaleOperationState,
} from "@/lib/policySaleOutcome";

/**
 * `attempt` + `commission` route the save through the Phase 2A companion (exactly-once retries, server-recorded
 * commission evidence). Without them the unchanged sale writer is called, as before.
 */
export type ClientSaleOptions = {
  requestId: string;
  recordSale: boolean;
  historical?: boolean;
  commission?: CommissionPayload;
  attempt?: SaleAttempt;
};
export type RecordedSaleResult = { client_id: string; win_ids: string[]; idempotent: boolean };

export type PolicyEntry = {
  policy_type: string; carrier: string; policy_number?: string; premium: number | null;
  face_amount?: string; sold_date: string; effective_date?: string; sale_mode: "new" | "historical";
};

const COMPANION: Record<SaleKind, string> = {
  record: "record_client_policy_handoff",
  create: "create_client_with_sale_handoff",
  convert: "convert_lead_to_client_with_sales_handoff",
  edit: "update_client_with_policy_sale_handoff",
};

const UNREADABLE_RESPONSE = "The save response couldn't be read, so it may or may not have saved.";

/**
 * Sends one submission to its companion. The attempt records that the request started. A conflict also reads the
 * operation's server status (for the modal's message) before it is reported.
 */
export async function sendPreparedSale(prepared: PreparedSale, attempt: SaleAttempt): Promise<SaleHandoffResult> {
  attempt.prepared = prepared;
  const args = { ...prepared.saleArgs, p_request_id: prepared.requestId, p_commission: prepared.commission };
  attempt.sent = true;
  let response: { data: unknown; error: { message?: string; code?: string } | null; status?: number };
  try {
    response = await (supabase as any).rpc(COMPANION[prepared.kind], args);
  } catch (error) {
    throw new SaleRequestError(error instanceof Error ? error.message : UNREADABLE_RESPONSE, "unknown");
  }
  const { data, error, status } = response;
  if (error) {
    const code = typeof error.code === "string" && error.code ? error.code : null;
    const errorClass = classifySaleError(code, true);
    const operation = errorClass === "conflict" ? await readSaleOperationStatus(prepared) : null;
    throw new SaleRequestError(error.message || "Save failed", errorClass, code, status ?? null, operation);
  }
  const sale = parseSaleResult(data, prepared.expectedClientId);
  if (!sale) throw new SaleRequestError(UNREADABLE_RESPONSE, "unknown", null, status ?? null);
  const result = { ...sale, commission: parseCommissionOutcome((data as Record<string, unknown>).commission) };
  attempt.result = result;
  if (prepared.notify) await notifyRecordedSales(result.winIds);
  return result;
}

/** Retry replays the frozen submission; a fresh attempt builds (and freezes) a new one. */
export async function runPreparedSale(attempt: SaleAttempt, prepare: () => PreparedSale): Promise<SaleHandoffResult> {
  let prepared: PreparedSale;
  try {
    prepared = attempt.frozen ?? freezeSale(prepare());
  } catch (error) {
    if (error instanceof SaleRequestError) throw error;
    throw notSentError(error instanceof Error ? error.message : "This save couldn't be prepared.");
  }
  return sendPreparedSale(prepared, attempt);
}

/** Caller-scoped server truth for a submission. "Not found" is never proof of rollback (it may be in flight). */
export async function readSaleOperationStatus(prepared: PreparedSale): Promise<SaleOperationState> {
  try {
    const { data, error } = await (supabase as any).rpc("get_policy_sale_operation_status", {
      p_kind: prepared.kind, p_request_id: prepared.requestId, p_lead_id: prepared.leadId, p_sale_args: prepared.saleArgs,
    });
    if (error || !isRecord(data)) return { state: "unreadable" };
    if (data.state === "committed") {
      return { state: "committed", samePayload: data.same_payload === true, thisRequest: typeof data.this_request === "boolean" ? data.this_request : null };
    }
    if (data.state === "committed_by_another_user" || data.state === "committed_without_receipt" || data.state === "not_found") {
      return { state: data.state };
    }
    return { state: "unreadable" };
  } catch {
    return { state: "unreadable" };
  }
}

/** Existing-client policy and sale persistence is one server transaction. */
export async function recordClientPolicy(requestId: string, clientId: string, policy: PolicyEntry, primary = false): Promise<RecordedSaleResult> {
  const { data, error } = await (supabase as any).rpc("record_client_policy", {
    p_request_id: requestId, p_client_id: clientId, p_policy: policy, p_primary: primary,
  });
  if (error) throw new Error(error.message);
  const result = data as RecordedSaleResult;
  if (result?.client_id !== clientId || !Array.isArray(result.win_ids)) throw new Error("Policy save returned an invalid receipt; retry this save.");
  if (policy.sale_mode !== "historical") await notifyRecordedSales(result.win_ids);
  return result;
}

/** The Record Policy companion submission (built once, then frozen by the caller's attempt). */
export function prepareRecordPolicy(requestId: string, clientId: string, policy: PolicyEntry, primary: boolean,
  commission: CommissionPayload): PreparedSale {
  return {
    kind: "record",
    requestId,
    leadId: null,
    expectedClientId: clientId,
    saleArgs: { p_client_id: clientId, p_policy: policy, p_primary: primary },
    commission,
    notify: policy.sale_mode !== "historical",
  };
}

/** Existing-client policy and sale in one server transaction, through the commission companion. */
export function recordClientPolicyHandoff(attempt: SaleAttempt, requestId: string, clientId: string, policy: PolicyEntry,
  primary: boolean, commission: CommissionPayload): Promise<SaleHandoffResult> {
  return runPreparedSale(attempt, () => prepareRecordPolicy(requestId, clientId, policy, primary, commission));
}

/** Never turn malformed or negative premium input into a plausible sale amount. */
export function saleMonthlyPremium(raw: string | null | undefined): number | null {
  const value = (raw ?? "").replace(/[,$\s]/g, "");
  if (!value) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value))) {
    throw new Error("Enter a nonnegative monthly premium with at most two decimal places");
  }
  return Number(value);
}

/** Only delivery happens here. The transaction already persisted each canonical policy event. */
export async function notifyRecordedSales(winIds: string[]): Promise<void> {
  await Promise.all(winIds.map(async (id) => {
    try {
      const { error } = await supabase.rpc("notify_win", { p_win_id: id });
      if (error) throw error;
    } catch (error) {
      // Retrying the original save returns the same IDs; notify_win deduplicates its recipients.
      console.warn("Sale saved; celebration delivery failed:", error);
    }
  }));
}
