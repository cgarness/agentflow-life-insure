import { supabase } from "@/integrations/supabase/client";
import { Lead, Client } from "@/lib/types";

export const conversionSupabaseApi = {
  /**
   * Converts a lead to a client by:
   * 1. Creating a new client record with the provided policy info.
   * 2. Updating related notes and activities to point to the new client ID and change contact_type to 'client'.
   * 3. Deleting the original lead record.
   */
  async convertLeadToClient(lead: Lead, policyInfo: Partial<Client>): Promise<string> {
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
