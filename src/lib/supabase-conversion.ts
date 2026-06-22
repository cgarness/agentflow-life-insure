import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Lead, Client } from "@/lib/types";
import { triggerWin } from "./win-trigger";

/** Extra policies at conversion time (primary policy maps to `clients` columns). Stored on the client row under `custom_fields.additional_policies`. */
export type AdditionalPolicyPayload = {
  policyType: string;
  carrier: string;
  policyNumber: string;
  faceAmount: string;
  premiumAmount: string;
  issueDate: string | null;
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

/** Resolve the assigned agent's display name (for the win) without a hardcoded "Agent" fallback. */
async function resolveAgentName(agentId: string | null | undefined): Promise<string> {
  if (!agentId) return "";
  const { data } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", agentId)
    .maybeSingle();
  return data ? `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() : "";
}

export const conversionSupabaseApi = {
  /**
   * Converts a lead to a client in ONE atomic database transaction via `convert_lead_to_client_atomic`:
   * locks + authorizes the lead, creates the client with canonical Build 1 columns (never premium_amount),
   * moves the approved contact graph (notes/activities/appointments/tasks/calls/messages/contact_emails/
   * workflow_executions), preserves call + campaign-queue telemetry, and deletes the lead only after every
   * transfer succeeds. Any failure rolls everything back (lead + records intact).
   *
   * Idempotent: a retry returns the existing client (`clients.lead_id` lineage) without creating a second
   * client. The win is created AFTER the commit, DB-idempotent on `wins.idempotency_key='conversion:<lead>'`,
   * and a celebration failure never rolls back the committed conversion. Signature unchanged so the Dialer
   * (`ConvertLeadModal` → `handleConversionSuccess`) sequence is unaffected.
   */
  async convertLeadToClient(lead: Lead, policyInfo: LeadConversionPayload, organizationId: string | null = null, campaignId: string | null = null): Promise<string> {
    const custom_fields = mergeCustomFieldsOnConversion(lead, policyInfo.additionalPolicies);
    const premium = parseCurrencyToNumber(policyInfo.premiumAmount);
    const policyType = policyInfo.policyType || "Term";

    const p_client = {
      policy_type: policyType,
      carrier: policyInfo.carrier || "",
      policy_number: policyInfo.policyNumber || "",
      premium,
      face_amount: parseCurrencyToNumber(policyInfo.faceAmount),
      issue_date: policyInfo.issueDate || null,
      effective_date: policyInfo.effectiveDate || null,
      beneficiary_name: policyInfo.beneficiaryName || null,
      beneficiary_relationship: policyInfo.beneficiaryRelationship || null,
      beneficiary_phone: policyInfo.beneficiaryPhone || null,
      notes: policyInfo.notes || lead.notes || null,
      custom_fields,
    };

    const { data, error } = await supabase.rpc("convert_lead_to_client_atomic", {
      p_lead_id: lead.id,
      p_client: p_client as unknown as Json,
    });
    if (error) {
      console.error("Error converting lead to client:", error);
      throw new Error(`Failed to convert lead to client: ${error.message}`);
    }

    const result = data as unknown as { client_id: string; idempotent: boolean };
    const clientId = result.client_id;

    // After-commit win celebration — only on a fresh conversion (not a retry), DB-idempotent, never
    // rolls back the committed client. organization scope is the lead's org (derived server-side).
    if (!result.idempotent) {
      try {
        const agentName = await resolveAgentName(lead.assignedAgentId);
        await triggerWin({
          agentId: lead.assignedAgentId,
          agentName,
          contactName: `${lead.firstName} ${lead.lastName}`,
          contactId: clientId,
          campaignId: campaignId ?? undefined,
          policyType,
          premiumAmount: premium,
          organizationId,
          idempotencyKey: `conversion:${lead.id}`,
        });
      } catch (e) {
        console.warn("Win celebration failed (conversion already committed):", e);
      }
    }

    return clientId;
  }
};
