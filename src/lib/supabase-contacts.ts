import { supabase } from "@/integrations/supabase/client";
import { Lead, LeadStatus } from "@/lib/types";

// ---- LEADS ----
export const leadsSupabaseApi = {
  async getAll(filters?: { status?: string; source?: string; search?: string }): Promise<Lead[]> {
    let query = supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.source) query = query.eq("lead_source", filters.source);
    if (filters?.search) {
      const q = filters.search;
      query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(rowToLead);
  },

  async getById(id: string): Promise<{ lead: Lead; notes: any[]; activities: any[]; calls: any[] }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from("leads").select("*").eq("id", id).single();
    if (error) throw new Error(error.message);
    return { lead: rowToLead(data), notes: [], activities: [], calls: [] };
  },

  async create(data: Omit<Lead, "id" | "createdAt" | "updatedAt">): Promise<Lead> {
    const { data: existing } = await supabase
      .from("leads")
      .select("id, first_name, last_name, phone")
      .or(`phone.eq.${data.phone},email.eq.${data.email}`)
      .maybeSingle();
    if (existing) throw new Error(`Duplicate detected: ${existing.first_name} ${existing.last_name} (${existing.phone})`);

    const { data: row, error } = await supabase
      .from("leads")
      .insert(leadToRow(data))
      .select()
      .single();
    if (error) throw new Error(error.message);
    return rowToLead(row);
  },

  async update(id: string, data: Partial<Lead>): Promise<Lead> {
    const updateData: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (data.firstName !== undefined) updateData.first_name = data.firstName;
    if (data.lastName !== undefined) updateData.last_name = data.lastName;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.leadSource !== undefined) updateData.lead_source = data.leadSource;
    if (data.leadScore !== undefined) updateData.lead_score = data.leadScore;
    if (data.age !== undefined) updateData.age = data.age;
    if (data.dateOfBirth !== undefined) updateData.date_of_birth = data.dateOfBirth;
    if (data.healthStatus !== undefined) updateData.health_status = data.healthStatus;
    if (data.bestTimeToCall !== undefined) updateData.best_time_to_call = data.bestTimeToCall;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.assignedAgentId !== undefined) updateData.assigned_agent_id = data.assignedAgentId;
    if (data.spouseInfo !== undefined) updateData.spouse_info = data.spouseInfo;
    if (data.customFields !== undefined) updateData.custom_fields = data.customFields;
    if (data.lastContactedAt !== undefined) updateData.last_contacted_at = data.lastContactedAt;
    updateData.updated_at = new Date().toISOString();

    const { data: row, error } = await supabase
      .from("leads")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return rowToLead(row);
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from("leads").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  async import(data: Partial<Lead>[]): Promise<{ imported: number; duplicates: number; errors: number }> {
    let imported = 0, duplicates = 0, errors = 0;
    const batchSize = 50;

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      for (const row of batch) {
        try {
          const { data: existing } = await supabase
            .from("leads")
            .select("id")
            .or(`phone.eq.${row.phone},email.eq.${row.email}`)
            .maybeSingle();
          if (existing) { duplicates++; continue; }

          const { error } = await supabase.from("leads").insert(leadToRow({
            firstName: row.firstName || "",
            lastName: row.lastName || "",
            phone: row.phone || "",
            email: row.email || "",
            state: row.state || "",
            status: (row.status as LeadStatus) || "New",
            leadSource: row.leadSource || "",
            leadScore: row.leadScore ?? 5,
            assignedAgentId: row.assignedAgentId || "",
            age: row.age,
            dateOfBirth: row.dateOfBirth,
            healthStatus: row.healthStatus,
            bestTimeToCall: row.bestTimeToCall,
            notes: row.notes,
          }));
          if (error) { errors++; } else { imported++; }
        } catch { errors++; }
      }
    }
    return { imported, duplicates, errors };
  },

  async getSourceStats() {
    const { data, error } = await supabase.from("leads").select("lead_source, status");
    if (error) throw new Error(error.message);
    const sources = ["Facebook Ads", "Google Ads", "Direct Mail", "Referral", "Webinar"];
    return sources.map(source => {
      const srcLeads = (data ?? []).filter((l: any) => l.lead_source === source); // eslint-disable-line @typescript-eslint/no-explicit-any
      const contacted = srcLeads.filter((l: any) => l.status !== "New").length; // eslint-disable-line @typescript-eslint/no-explicit-any
      const won = srcLeads.filter((l: any) => l.status === "Closed Won").length; // eslint-disable-line @typescript-eslint/no-explicit-any
      return {
        source,
        leads: srcLeads.length,
        contacted: srcLeads.length ? `${Math.round(contacted / srcLeads.length * 100)}%` : "0%",
        conversion: srcLeads.length ? `${Math.round(won / srcLeads.length * 100)}%` : "0%",
        sold: won,
      };
    });
  },
};

// ---- HELPERS ----
function rowToLead(row: any): Lead { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    email: row.email,
    state: row.state,
    status: row.status,
    leadSource: row.lead_source,
    leadScore: row.lead_score,
    age: row.age ?? undefined,
    dateOfBirth: row.date_of_birth ?? undefined,
    healthStatus: row.health_status ?? undefined,
    bestTimeToCall: row.best_time_to_call ?? undefined,
    spouseInfo: row.spouse_info ?? undefined,
    notes: row.notes ?? undefined,
    assignedAgentId: row.assigned_agent_id,
    lastContactedAt: row.last_contacted_at ?? undefined,
    customFields: row.custom_fields ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function leadToRow(data: Omit<Lead, "id" | "createdAt" | "updatedAt">): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    first_name: data.firstName,
    last_name: data.lastName,
    phone: data.phone,
    email: data.email,
    state: data.state,
    status: data.status,
    lead_source: data.leadSource,
    lead_score: data.leadScore,
    age: data.age ?? null,
    date_of_birth: data.dateOfBirth ?? null,
    health_status: data.healthStatus ?? null,
    best_time_to_call: data.bestTimeToCall ?? null,
    notes: data.notes ?? null,
    assigned_agent_id: data.assignedAgentId,
    last_contacted_at: data.lastContactedAt ?? null,
  };
}
