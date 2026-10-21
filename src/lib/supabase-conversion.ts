import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Lead, Client } from "@/lib/types";
import { notifyRecordedSales, runPreparedSale, saleMonthlyPremium, type RecordedSaleResult } from "./policySaleRecording";
import { normalizePaymentFrequencyOrNull } from "@/lib/policyPaymentFields";
import type { CommissionPayload } from "@/lib/commission/capture";
import { notSentError, type PreparedSale, type SaleAttempt, type SaleHandoffResult } from "@/lib/policySaleOutcome";

/**
 * Extra policies at conversion time (primary policy maps to `clients` columns). Stored on the client
 * row under `custom_fields.additional_policies`. Rows written before the Sold Date build carry
 * `issueDate` instead of `soldDate`; readers must tolerate both keys.
 */
export type AdditionalPolicyPayload = {
  /**
   * Phase 2A: the row's own UUID, kept as the stored policy identity so a commission estimate shown for this row
   * binds to exactly this policy. Optional for legacy callers (the server then assigns one).
   */
  policyId?: string;
  policyType: string;
  carrier: string;
  policyNumber: string;
  faceAmount: string;
  premiumAmount: string;
  soldDate: string | null;
  effectiveDate: string | null;
};

export type LeadConversionPayload = Partial<Client> & {
  additionalPolicies?: AdditionalPolicyPayload[];
};

const ADDITIONAL_POLICIES_KEY = "additional_policies";

function mergeCustomFieldsOnConversion(
  lead: Lead,
  additionalPolicies: AdditionalPolicyPayload[] | undefined
): Record<string, unknown> | null {
  const base =
    lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
      ? { ...(lead.customFields as Record<string, unknown>) }
      : {};

  if (additionalPolicies && additionalPolicies.length > 0) {
    base[ADDITIONAL_POLICIES_KEY] = additionalPolicies;
  } else {
    delete base[ADDITIONAL_POLICIES_KEY];
  }

  return Object.keys(base).length > 0 ? base : null;
}

function parseCurrencyToNumber(raw: string | null | undefined): number {
  return parseFloat((raw ?? "").replace(/[^0-9.-]+/g, "") || "0") || 0;
}

/** The writer's `p_client` for a conversion; shared by the legacy writer and the companion. */
function conversionClient(lead: Lead, policyInfo: LeadConversionPayload) {
  const custom_fields = mergeCustomFieldsOnConversion(lead, policyInfo.additionalPolicies);
  const premium = saleMonthlyPremium(policyInfo.premiumAmount);
  const policyType = policyInfo.policyType || "Term";
  return {
    policy_type: policyType,
    carrier: policyInfo.carrier || "",
    policy_number: policyInfo.policyNumber || "",
    premium,
    face_amount: parseCurrencyToNumber(policyInfo.faceAmount),
    // issue_date stays in the contract as legacy storage (the modal no longer collects it).
    issue_date: policyInfo.issueDate || null,
    effective_date: policyInfo.effectiveDate || null,
    sold_date: policyInfo.soldDate || null,
    draft_date: policyInfo.draftDate || null,
    payment_frequency: normalizePaymentFrequencyOrNull(policyInfo.paymentFrequency),
    beneficiary_name: policyInfo.beneficiaryName || null,
    beneficiary_relationship: policyInfo.beneficiaryRelationship || null,
    beneficiary_phone: policyInfo.beneficiaryPhone || null,
    // Only the agent's conversion note. The server keeps the locked lead row's notes (and, if this note replaces
    // them, preserves them verbatim in the client's read-only conversion history); never send this tab's copy.
    notes: policyInfo.notes?.trim() ? policyInfo.notes : null,
    // The server reads every other custom field (and state, DOB, age, best time, spouse, source, status) from the
    // locked lead row; only `additional_policies` is taken from here (20261021200000).
    custom_fields,
  };
}

/** The conversion companion submission (built once, then frozen by the caller's attempt). */
export function prepareConversion(lead: Lead, policyInfo: LeadConversionPayload, organizationId: string | null,
  campaignId: string | null, requestId: string, commission: CommissionPayload): PreparedSale {
  if (!organizationId) throw notSentError("Cannot convert a lead without an organization.");
  return {
    kind: "convert",
    requestId,
    leadId: lead.id,
    expectedClientId: null,
    saleArgs: { p_lead_id: lead.id, p_expected_org: organizationId, p_client: conversionClient(lead, policyInfo), p_campaign_id: campaignId },
    commission,
    notify: true,
  };
}

export const conversionSupabaseApi = {
  /**
   * Converts a lead and records its policy sales in ONE transaction. The wrapper delegates to the
   * unchanged `convert_lead_to_client_atomic`:
   * locks + authorizes the lead, creates the client with canonical Build 1 columns (never premium_amount),
   * moves the approved contact graph (notes/activities/appointments/tasks/calls/messages/contact_emails/
   * workflow_executions), preserves call + campaign-queue telemetry, and deletes the lead only after every
   * transfer succeeds. Any failure rolls everything back (lead + records intact).
   *
   * Idempotent: a retry returns the existing client (`clients.lead_id` lineage) without creating a second
   * client or policy events. Primary retains `wins.idempotency_key='conversion:<lead>'`.
   * Only celebrations run after commit. Signature unchanged so the Dialer
   * (`ConvertLeadModal` → `handleConversionSuccess`) sequence is unaffected.
   */
  async convertLeadToClient(lead: Lead, policyInfo: LeadConversionPayload, organizationId: string | null = null, campaignId: string | null = null): Promise<string> {
    if (!organizationId) throw new Error("Cannot convert a lead without an organization.");
    const p_client = conversionClient(lead, policyInfo);

    const { data, error } = await supabase.rpc("convert_lead_to_client_with_sales", {
      p_lead_id: lead.id,
      p_expected_org: organizationId,
      p_campaign_id: campaignId,
      p_client: p_client as unknown as Json,
    });
    if (error) {
      console.error("Error converting lead to client:", error);
      throw new Error(`Failed to convert lead to client: ${error.message}`);
    }

    const result = data as unknown as RecordedSaleResult;
    if (!result?.client_id || !Array.isArray(result.win_ids)) throw new Error("Conversion returned an invalid receipt; retry this save.");
    const clientId = result.client_id;
    await notifyRecordedSales(result.win_ids);

    return clientId;
  },

  /**
   * Phase 2A: the same conversion through `convert_lead_to_client_with_sales_handoff`, which delegates to the
   * unchanged writer and records, in the same transaction, which request created the sale and the commission
   * inputs that were displayed. A retry of an unknown outcome replays the frozen submission exactly.
   */
  convertLeadToClientHandoff(attempt: SaleAttempt, lead: Lead, policyInfo: LeadConversionPayload, organizationId: string | null,
    campaignId: string | null, requestId: string, commission: CommissionPayload): Promise<SaleHandoffResult> {
    return runPreparedSale(attempt, () => prepareConversion(lead, policyInfo, organizationId, campaignId, requestId, commission));
  },
};
