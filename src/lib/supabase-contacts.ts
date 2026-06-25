import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Lead, LeadStatus } from "@/lib/types";
import { normalizeUsState } from "@/utils/stateUtils";
import {
  type LeadFilterPayload,
  type KanbanResult,
  toLeadKanbanPayload,
  parseKanbanResult,
} from "@/lib/contactsFilters";

// ---- LEADS ----
export const leadsSupabaseApi = {
  /**
   * Canonical server-side filtered list. Rows AND exact total come from the SAME
   * RPC (`search_contacts_leads`) which shares ONE WHERE with the matching-ids RPC
   * — no client-side over-fetch / count / selection drift. (Contacts Build 2.)
   */
  async getAll(payload: LeadFilterPayload): Promise<{ data: Lead[]; totalCount: number }> {
    const { data, error } = await (supabase as any).rpc("search_contacts_leads", { p_filters: payload }); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (error) throw new Error(error.message);
    const result = (data ?? {}) as { total_count?: number; rows?: any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const rows = result.rows ?? [];
    return {
      data: rows.map(rowToLeadWithAggregates),
      totalCount: result.total_count ?? 0,
    };
  },

  /**
   * ALL lead IDs matching the EXACT same canonical filter payload as `getAll`,
   * in the SAME canonical sort order. Retrieved in bounded `.range()` chunks —
   * never one potentially capped RPC response. The RPC returns (id, ord); we
   * `.order("ord")` so PostgREST slices the identical order across ranges (no
   * gaps/dupes), matching the visible result set.
   */
  async getAllLeadIdsMatching(payload: LeadFilterPayload): Promise<string[]> {
    const chunkSize = 1000;
    const ids: string[] = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .rpc("contacts_lead_ids_matching", { p_filters: payload })
        .order("ord", { ascending: true })
        .range(offset, offset + chunkSize - 1);
      if (error) throw new Error(error.message);
      const arr = (data ?? []) as unknown[];
      if (arr.length === 0) break;
      for (const row of arr) {
        const id =
          typeof row === "string"
            ? row
            : (row as { id?: string })?.id;
        if (typeof id === "string" && id.length > 0) ids.push(id);
      }
      if (arr.length < chunkSize) break;
      offset += chunkSize;
    }
    return ids;
  },

  /**
   * Kanban read path (Contacts Build 4). Returns EXACT per-status full counts +
   * a bounded per-column card slice for the SAME canonical filter/scope as the
   * table — never the page slice. The single-status filter is dropped (Kanban
   * columns ARE the statuses, D1) and pagination is ignored. The payload is cast
   * to Json (the typed RPC arg) because LeadFilterPayload isn't structurally Json.
   */
  async getKanban(payload: LeadFilterPayload, perColumn = 50): Promise<KanbanResult<Lead>> {
    const kanbanPayload = toLeadKanbanPayload(payload);
    const { data, error } = await supabase.rpc("get_contacts_lead_kanban", {
      p_filters: kanbanPayload as unknown as Json,
      p_per_column: perColumn,
    });
    if (error) throw new Error(error.message);
    return parseKanbanResult(data, rowToLeadWithAggregates);
  },

  async getById(id: string): Promise<{ lead: Lead; notes: any[]; activities: any[]; calls: any[] }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Lead not found");
    return { lead: rowToLead(data), notes: [], activities: [], calls: [] };
  },

  async create(data: Omit<Lead, "id" | "createdAt" | "updatedAt">, organizationId: string | null = null): Promise<Lead> {
    // Fetch settings for duplicate detection
    let settings: any = null;
    if (organizationId) {
      const { data: s } = await (supabase
        .from("contact_management_settings" as any)
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle() as any);
      settings = s;
    }

    const rule = settings?.duplicate_detection_rule || "phone_or_email";
    const scope = settings?.duplicate_detection_scope || "all_agents";
    const action = settings?.manual_action || "warn";

    if (action !== "allow") {
      let query = supabase.from("leads").select("id, first_name, last_name, phone");
      
      if (rule === "phone_only") query = query.eq("phone", data.phone);
      else if (rule === "email_only") query = query.eq("email", data.email);
      else if (rule === "phone_and_email") query = query.eq("phone", data.phone).eq("email", data.email);
      else query = query.or(`phone.eq.${data.phone},email.eq.${data.email}`);

      if (scope === "assigned_only" && data.assignedAgentId) {
        query = query.eq("assigned_agent_id", data.assignedAgentId);
      }

      const { data: existing } = await query.maybeSingle();
      
      if (existing) {
        const msg = `Duplicate detected: ${existing.first_name} ${existing.last_name} (${existing.phone})`;
        if (action === "block") throw new Error(msg);
        // If "warn", we still proceed but could return a warning (though the current interface doesn't support it well)
        // For now, only block if explicitly set to block
      }
    }

    const { data: row, error } = await supabase
      .from("leads")
      .insert({ ...leadToRow(data), organization_id: organizationId } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
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
    if (data.state !== undefined) updateData.state = normalizeUsState(data.state);
    if (data.status !== undefined) updateData.status = data.status;
    if (data.leadSource !== undefined) updateData.lead_source = data.leadSource;
    if (data.leadScore !== undefined) updateData.lead_score = data.leadScore;
    if (data.age !== undefined) updateData.age = data.age;
    if (data.dateOfBirth !== undefined) updateData.date_of_birth = data.dateOfBirth;
    if (data.bestTimeToCall !== undefined) updateData.best_time_to_call = data.bestTimeToCall;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.assignedAgentId !== undefined) {
      updateData.assigned_agent_id = data.assignedAgentId;
      updateData.user_id = data.assignedAgentId; // Sync user_id for RLS consistency
    }
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
    // Contacts Build 5: route through the permission-enforcing RPC. delete_contact handles the
    // campaign_leads cleanup + org/ownership/permission checks server-side (parity with the prior
    // two-step delete). Typed against the generated RPC (CP3C migration live in prod).
    const { error } = await supabase.rpc("delete_contact", { p_contact_type: "lead", p_contact_id: id });
    if (error) throw new Error(error.message);
  },

  /** Delete every lead matching the canonical filter payload (chunked, errors surfaced). Keeps campaign_leads cleanup. */
  async deleteAllMatching(payload: LeadFilterPayload): Promise<number> {
    const ids = await this.getAllLeadIdsMatching(payload);
    if (ids.length === 0) return 0;

    const chunkSize = 1000;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { error: clErr } = await supabase.from("campaign_leads").delete().in("lead_id", chunk);
      if (clErr) throw new Error(clErr.message);
      const { error: lErr } = await supabase.from("leads").delete().in("id", chunk);
      if (lErr) throw new Error(lErr.message);
    }
    return ids.length;
  },

  /** Set status on every lead matching the canonical filter payload (chunked). Returns ACTUAL affected rows. */
  async updateStatusAllMatching(status: string, payload: LeadFilterPayload): Promise<number> {
    const ids = await this.getAllLeadIdsMatching(payload);
    if (ids.length === 0) return 0;

    const chunkSize = 1000;
    let updated = 0;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from("leads")
        .update({ status, updated_at: new Date().toISOString() })
        .in("id", chunk)
        .select("id");
      if (error) throw new Error(error.message);
      updated += data?.length ?? 0;
    }
    return updated;
  },

  async import(data: Partial<Lead>[], organizationId: string | null = null): Promise<{ imported: number; duplicates: number; errors: number }> {
    let imported = 0, duplicates = 0, errors = 0;
    const batchSize = 50;

    // Fetch settings for duplicate detection
    let settings: any = null;
    if (organizationId) {
      const { data: s } = await (supabase
        .from("contact_management_settings" as any)
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle() as any);
      settings = s;
    }

    const rule = settings?.duplicate_detection_rule || "phone_or_email";
    const scope = settings?.duplicate_detection_scope || "all_agents";
    const action = settings?.csv_action || "flag";

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      for (const row of batch) {
        try {
          if (action !== "overwrite") { // If overwrite, we don't skip or flag as dupe in the same way (impl not fully here)
            let query = supabase.from("leads").select("id");
            
            if (rule === "phone_only") query = query.eq("phone", row.phone || "");
            else if (rule === "email_only") query = query.eq("email", row.email || "");
            else if (rule === "phone_and_email") query = query.eq("phone", row.phone || "").eq("email", row.email || "");
            else query = query.or(`phone.eq.${row.phone || ""},email.eq.${row.email || ""}`);

            if (scope === "assigned_only" && row.assignedAgentId) {
              query = query.eq("assigned_agent_id", row.assignedAgentId);
            }

            const { data: existing } = await query.maybeSingle();
            if (existing) {
              duplicates++;
              if (action === "skip") continue;
              // If "flag", we might still import but mark it? 
              // Currently the import logic just skips if duplicate is found.
              continue; 
            }
          }

          const { error } = await supabase.from("leads").insert({ ...leadToRow({
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
            bestTimeToCall: row.bestTimeToCall,
            notes: row.notes,
            userId: row.userId || row.assignedAgentId || null,
          }), organization_id: organizationId } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
          if (error) { errors++; } else { imported++; }
        } catch { errors++; }
      }
    }
    return { imported, duplicates, errors };
  },

  async getSourceStats() {
    const { data, error } = await supabase.from("leads").select("lead_source, status");
    if (error) throw new Error(error.message);
    const sources = Array.from(new Set((data ?? []).map((l: any) => l.lead_source).filter(Boolean)));
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

  async reassignAllContacts(fromUserId: string, toUserId: string): Promise<{ leads: number; clients: number; recruits: number }> {
    const [leadsRes, clientsRes, recruitsRes] = await Promise.all([
      // user_id must be kept in sync with assigned_agent_id so RLS policy (user_id = auth.uid()) stays valid
      supabase.from("leads").update({ assigned_agent_id: toUserId, user_id: toUserId }).eq("assigned_agent_id", fromUserId).select("id"),
      supabase.from("clients").update({ assigned_agent_id: toUserId }).eq("assigned_agent_id", fromUserId).select("id"),
      supabase.from("recruits").update({ assigned_agent_id: toUserId }).eq("assigned_agent_id", fromUserId).select("id"),
    ]);

    if (leadsRes.error) throw new Error(`Leads transfer failed: ${leadsRes.error.message}`);
    if (clientsRes.error) throw new Error(`Clients transfer failed: ${clientsRes.error.message}`);
    if (recruitsRes.error) throw new Error(`Recruits transfer failed: ${recruitsRes.error.message}`);

    return {
      leads: leadsRes.data?.length || 0,
      clients: clientsRes.data?.length || 0,
      recruits: recruitsRes.data?.length || 0,
    };
  },

  /**
   * Reassign the given leads to an agent. Updates BOTH assigned_agent_id and user_id
   * (user_id = auth.uid() drives the Agent RLS policy). Batched UPDATE; throws on DB error.
   */
  async bulkAssign(ids: string[], agentId: string): Promise<number> {
    if (ids.length === 0) return 0;
    const chunkSize = 1000;
    let updated = 0;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from("leads")
        .update({ assigned_agent_id: agentId, user_id: agentId, updated_at: new Date().toISOString() })
        .in("id", chunk)
        .select("id");
      if (error) throw new Error(error.message);
      updated += data?.length ?? 0;
    }
    return updated;
  },
};

// ---- DISPOSITION DERIVATION (exported for unit tests) ----

/** Normalize a disposition value for matching/comparison: trim + lowercase. */
export function normalizeDispositionValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

type CallDispositionRow = { disposition_id?: string | null; disposition_name?: string | null; created_at?: string | null };

/**
 * Derive a lead's Last Disposition from its calls — NEVER from calls.status.
 * Prefers ID-backed rows (a call counts when it has disposition_id OR a non-blank disposition_name),
 * picks the newest such call by created_at, and returns the trimmed disposition_name as the label.
 * A call with neither field is not a disposition; no dispositioned call → undefined.
 */
export function deriveLastDisposition(calls: CallDispositionRow[] | null | undefined): string | undefined {
  const dispositioned = (calls ?? []).filter(
    (c) => (c.disposition_id != null && c.disposition_id !== "") || (c.disposition_name ?? "").trim() !== "",
  );
  if (dispositioned.length === 0) return undefined;
  const newest = [...dispositioned].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
  )[0];
  const name = (newest.disposition_name ?? "").trim();
  return name === "" ? undefined : name;
}

// ---- HELPERS ----
export function rowToLead(row: any): Lead { // eslint-disable-line @typescript-eslint/no-explicit-any
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
    bestTimeToCall: row.best_time_to_call ?? undefined,
    spouseInfo: row.spouse_info ?? undefined,
    notes: row.notes ?? undefined,
    assignedAgentId: row.assigned_agent_id,
    userId: row.user_id,
    lastContactedAt: row.last_contacted_at ?? undefined,
    attemptCount: (row.calls || []).length,
    // Derived from disposition_id / disposition_name — NEVER calls.status.
    lastDisposition: deriveLastDisposition(row.calls),
    customFields: row.custom_fields ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map a row from `search_contacts_leads` (a lead jsonb + scalar `attempt_count`
 * / `last_disposition` computed server-side from calls.lead_id). The aggregates
 * override the nested-calls path so the table reads the SAME definition the
 * server filtered on (attempt count = COUNT(calls.lead_id), last disposition =
 * newest dispositioned call — Build 2 D2 / Build 1 derivation).
 */
export function rowToLeadWithAggregates(row: any): Lead { // eslint-disable-line @typescript-eslint/no-explicit-any
  const base = rowToLead(row);
  const rawCount = row.attempt_count;
  const attemptCount =
    typeof rawCount === "number" ? rawCount : rawCount != null ? Number(rawCount) || 0 : base.attemptCount;
  const rawDispo = row.last_disposition;
  const lastDisposition =
    rawDispo != null && String(rawDispo).trim() !== "" ? String(rawDispo).trim() : undefined;
  return { ...base, attemptCount, lastDisposition };
}

function leadToRow(data: Omit<Lead, "id" | "createdAt" | "updatedAt">): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  const aidRaw = data.assignedAgentId as string | undefined | null;
  const assigned_agent_id =
    aidRaw === "" || aidRaw === undefined ? null : aidRaw;
  const uidRaw = data.userId as string | undefined | null;
  const user_id =
    uidRaw !== undefined && uidRaw !== ""
      ? uidRaw
      : assigned_agent_id;
  return {
    first_name: data.firstName,
    last_name: data.lastName,
    phone: data.phone,
    email: data.email,
    state: normalizeUsState(data.state),
    status: data.status,
    lead_source: data.leadSource,
    lead_score: data.leadScore,
    age: data.age ?? null,
    date_of_birth: data.dateOfBirth ?? null,
    best_time_to_call: data.bestTimeToCall ?? null,
    notes: data.notes ?? null,
    assigned_agent_id,
    user_id,
    last_contacted_at: data.lastContactedAt ?? null,
    custom_fields: data.customFields ?? null,
  };
}
