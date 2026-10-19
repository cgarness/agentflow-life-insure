import type { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { CommissionSlotInputs } from "./capture";
import { parseClientPolicyCommissions, trackingResultSchemas, type ClientPolicyCommissions, type TimingPrecision } from "./trackingSchemas";

/**
 * Phase 2A tracking calls. Every write carries a request id (one per dialog open) so a retry of an unknown
 * outcome returns the stored result instead of writing twice; revision-checked writes fail with a conflict
 * when the estimate changed elsewhere. The server authorizes every call for the real signed-in user.
 */
export type TrackingErrorKind = "stale" | "denied" | "invalid" | "not_found" | "unknown";

export class CommissionTrackingError extends Error {
  readonly kind: TrackingErrorKind;
  readonly code: string | null;
  constructor(message: string, kind: TrackingErrorKind, code: string | null) {
    super(message);
    this.name = "CommissionTrackingError";
    this.kind = kind;
    this.code = code;
  }
}

const KIND_BY_CODE: Record<string, TrackingErrorKind> = { PT409: "stale", "42501": "denied", "22023": "invalid", PT404: "not_found" };
const MESSAGES: Record<Exclude<TrackingErrorKind, "invalid">, string> = {
  stale: "This commission changed elsewhere. Refresh and try again.",
  denied: "You don't have permission to change this commission.",
  not_found: "This commission record is no longer available. Refresh the contact.",
  unknown: "We couldn't confirm this change. Retry sends exactly the same change.",
};

function trackingError(error: { message?: string; code?: string } | null): CommissionTrackingError {
  const code = error?.code || null;
  const kind = (code && KIND_BY_CODE[code]) || "unknown";
  // 22023 messages are written by the commission functions for people; others get a fixed explanation.
  const message = kind === "invalid" ? error?.message || "Check the entries and try again." : MESSAGES[kind];
  return new CommissionTrackingError(message, kind, code);
}

async function call<T extends z.ZodTypeAny>(fn: string, args: Record<string, unknown>, schema: T): Promise<z.infer<T>> {
  let response: { data: unknown; error: { message?: string; code?: string } | null };
  try {
    response = await (supabase as any).rpc(fn, args);
  } catch {
    throw new CommissionTrackingError(MESSAGES.unknown, "unknown", null);
  }
  if (response.error) throw trackingError(response.error);
  const parsed = schema.safeParse(response.data);
  if (!parsed.success) throw new CommissionTrackingError(MESSAGES.unknown, "unknown", null);
  return parsed.data;
}

export async function fetchClientPolicyCommissions(clientId: string, signal?: AbortSignal): Promise<ClientPolicyCommissions> {
  let request = (supabase as any).rpc("get_client_policy_commissions", { p_client_id: clientId });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw trackingError(error);
  return parseClientPolicyCommissions(data);
}

export const commissionTrackingApi = {
  confirmCapture: (a: { requestId: string; captureId: string }) =>
    call("confirm_policy_commission_capture", { p_request_id: a.requestId, p_capture_id: a.captureId }, trackingResultSchemas.confirm),
  dismissCapture: (a: { requestId: string; captureId: string; reason: string }) =>
    call("dismiss_policy_commission_capture", { p_request_id: a.requestId, p_capture_id: a.captureId, p_reason: a.reason },
      trackingResultSchemas.dismiss),
  recordEstimateLater: (a: { requestId: string; policyId: string; inputs: CommissionSlotInputs; replaceEstimateId?: string | null;
    expectedRevision?: number | null; reason?: string | null }) =>
    call("record_policy_commission_estimate_later", {
      p_request_id: a.requestId, p_policy_id: a.policyId, p_inputs: a.inputs, p_replace_estimate_id: a.replaceEstimateId ?? null,
      p_expected_revision: a.expectedRevision ?? null, p_reason: a.reason ?? null,
    }, trackingResultSchemas.later),
  setScheduleBasis: (a: { requestId: string; estimateId: string; expectedRevision: number; startOn: string | null;
    source: "effective_date" | "manual" | null }) =>
    call("set_policy_commission_schedule_basis", {
      p_request_id: a.requestId, p_estimate_id: a.estimateId, p_expected_revision: a.expectedRevision, p_start_on: a.startOn, p_source: a.source,
    }, trackingResultSchemas.state),
  setInstallmentTiming: (a: { requestId: string; installmentId: string; expectedRevision: number; precision: TimingPrecision;
    expectedOn: string | null }) =>
    call("set_policy_commission_installment_timing", {
      p_request_id: a.requestId, p_installment_id: a.installmentId, p_expected_revision: a.expectedRevision, p_precision: a.precision,
      p_expected_on: a.expectedOn,
    }, trackingResultSchemas.state),
  setHold: (a: { requestId: string; estimateId: string; expectedRevision: number; onHold: boolean; reason: string | null }) =>
    call("set_policy_commission_hold", {
      p_request_id: a.requestId, p_estimate_id: a.estimateId, p_expected_revision: a.expectedRevision, p_on_hold: a.onHold, p_reason: a.reason,
    }, trackingResultSchemas.state),
  recordReceipt: (a: { requestId: string; installmentId: string; amountCents: number; receivedOn: string; reference: string | null }) =>
    call("record_policy_commission_receipt", {
      p_request_id: a.requestId, p_installment_id: a.installmentId, p_amount_cents: a.amountCents, p_received_on: a.receivedOn,
      p_reference: a.reference,
    }, trackingResultSchemas.receipt),
  voidReceipt: (a: { requestId: string; receiptId: string; expectedRevision: number; reason: string;
    replacement: { installmentId: string; amountCents: number; receivedOn: string; reference: string | null } | null }) =>
    call("void_policy_commission_receipt", {
      p_request_id: a.requestId, p_receipt_id: a.receiptId, p_expected_revision: a.expectedRevision, p_reason: a.reason,
      p_replacement: a.replacement && {
        installment_id: a.replacement.installmentId, amount_cents: a.replacement.amountCents, received_on: a.replacement.receivedOn,
        reference: a.replacement.reference,
      },
    }, trackingResultSchemas.void),
};
