import { supabase } from "@/integrations/supabase/client";
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

export const conversionSupabaseApi = {
  /**
   * Converts a lead to a client by:
   * 1. Creating a new client record with the provided policy info.
   * 2. Updating related notes and activities to point to the new client ID and change contact_type to 'client'.
   * 3. Deleting the original lead record.
   */
  async convertLeadToClient(lead: Lead, policyInfo: LeadConversionPayload, organizationId: string | null = null): Promise<string> {
    const custom_fields = mergeCustomFieldsOnConversion(lead, policyInfo.additionalPolicies);

    // 1. Create the client record
    const clientData = {
      first_name: lead.firstName,
      last_name: lead.lastName,
      phone: lead.phone,
      email: lead.email,
      policy_type: policyInfo.policyType || "Term",
      carrier: policyInfo.carrier || "",
      policy_number: policyInfo.policyNumber || "",
      premium: parseFloat(policyInfo.premiumAmount?.replace(/[^0-9.-]+/g, "") || "0") || 0,
      face_amount: parseFloat(policyInfo.faceAmount?.replace(/[^0-9.-]+/g, "") || "0") || 0,
      issue_date: policyInfo.issueDate || null,
      effective_date: policyInfo.effectiveDate || null,
      beneficiary_name: policyInfo.beneficiaryName || null,
      beneficiary_relationship: policyInfo.beneficiaryRelationship || null,
      beneficiary_phone: policyInfo.beneficiaryPhone || null,
      notes: policyInfo.notes || lead.notes || null,
      assigned_agent_id: lead.assignedAgentId,
      organization_id: organizationId,
      custom_fields,
    };

    const { data: client, error: clientError } = await (supabase as any)
      .from("clients")
      .insert(clientData)
      .select()
      .single();

    if (clientError) {
      console.error("Error creating client:", clientError);
      throw new Error(`Failed to create client record: ${clientError.message}`);
    }

    const clientId = client.id;

    // 1.5 Trigger win celebration
    try {
      await triggerWin({
        agentId: lead.assignedAgentId,
        agentName: "Agent", // Standard fallback, though triggerWin could handle better
        contactName: `${client.first_name} ${client.last_name}`,
        contactId: clientId,
        policyType: client.policy_type,
        premiumAmount: client.premium,
      });
    } catch (e) {
      console.warn("Error triggering win celebration:", e);
    }

    // 2. Update related activities
    const { error: activityError } = await (supabase as any)
      .from("contact_activities")
      .update({ contact_id: clientId, contact_type: "client" })
      .eq("contact_id", lead.id)
      .eq("contact_type", "lead");

    if (activityError) {
      console.warn("Error updating activities during conversion:", activityError);
      // Non-fatal, but logged
    }

    // 3. Update related notes
    const { error: noteError } = await (supabase as any)
      .from("contact_notes")
      .update({ contact_id: clientId, contact_type: "client" })
      .eq("contact_id", lead.id)
      .eq("contact_type", "lead");

    if (noteError) {
      console.warn("Error updating notes during conversion:", noteError);
      // Non-fatal, but logged
    }

    // 4. Update related appointments
    const { error: apptError } = await (supabase as any)
      .from("appointments")
      .update({ contact_id: clientId, contact_type: "client" })
      .eq("contact_id", lead.id)
      .eq("contact_type", "lead");

    if (apptError) {
      console.warn("Error updating appointments during conversion:", apptError);
      // Non-fatal, but logged
    }

    // 5. Delete the lead
    const { error: deleteError } = await supabase
      .from("leads")
      .delete()
      .eq("id", lead.id);

    if (deleteError) {
      console.error("Error deleting lead after conversion:", deleteError);
      // This is more serious as we now have a duplicate in clients, but we'll still return the clientId
    }

    return clientId;
  }
};
