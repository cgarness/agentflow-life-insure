import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Lead, Client } from "@/lib/types";
import { notifyRecordedSales, saleMonthlyPremium, type RecordedSaleResult } from "./policySaleRecording";
import { normalizePaymentFrequencyOrNull } from "@/lib/policyPaymentFields";

/**
 * Extra policies at conversion time (primary policy maps to `clients` columns). Stored on the client
 * row under `custom_fields.additional_policies`. Rows written before the Sold Date build carry
 * `issueDate` instead of `soldDate`; readers must tolerate both keys.
 */
export type AdditionalPolicyPayload = {
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
    const custom_fields = mergeCustomFieldsOnConversion(lead, policyInfo.additionalPolicies);
    const premium = saleMonthlyPremium(policyInfo.premiumAmount);
    const policyType = policyInfo.policyType || "Term";

    const p_client = {
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
      notes: policyInfo.notes || lead.notes || null,
      custom_fields,
    };

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
  }
};
