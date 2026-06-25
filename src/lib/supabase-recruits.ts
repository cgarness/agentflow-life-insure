import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Recruit } from "@/lib/types";
import { normalizeUsState } from "@/utils/stateUtils";
import { type KanbanResult, parseKanbanResult } from "@/lib/contactsFilters";

export interface RecruitFilters {
    search?: string;
    state?: string;
    assignedAgentIds?: string[];
    /** Canonical sort key (RECRUIT_SORT_COLUMNS); invalid/missing → created_at desc (server-validated). */
    sortColumn?: string | null;
    sortDirection?: string | null;
    page?: number;
    pageSize?: number;
}

/**
 * Build the RPC payload. Sorting (incl. Assigned Agent via a SQL LEFT JOIN that
 * keeps unassigned recruits) and pagination happen server-side in
 * search_contacts_recruits / contacts_recruit_ids_matching — never a PostgREST
 * embedded `!inner` order. sortColumn is the canonical key (re-validated in SQL).
 */
function buildRecruitPayload(filters?: RecruitFilters) {
    return {
        assigned_agent_ids:
            filters?.assignedAgentIds && filters.assignedAgentIds.length > 0 ? filters.assignedAgentIds : null,
        search: filters?.search?.trim() || null,
        state: filters?.state || null,
        sort_column: filters?.sortColumn ?? null,
        sort_direction: filters?.sortDirection ?? null,
        page: filters?.page ?? 0,
        page_size: filters?.pageSize ?? 50,
    };
}

export const recruitsSupabaseApi = {
    async getAll(searchOrFilters?: string | RecruitFilters): Promise<{ data: Recruit[]; totalCount: number }> {
        // Support both legacy string-only search and new filter object
        const filters = typeof searchOrFilters === "string"
            ? { search: searchOrFilters }
            : searchOrFilters;

        // Rows + exact total from ONE RPC; full-dataset sort (incl. Assigned Agent via
        // SQL LEFT JOIN, unassigned kept) happens server-side BEFORE pagination.
        const { data, error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
            .rpc("search_contacts_recruits", { p_filters: buildRecruitPayload(filters) });
        if (error) throw new Error(error.message);
        const result = (data ?? {}) as { total_count?: number; rows?: any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
        return { data: (result.rows ?? []).map(rowToRecruit), totalCount: result.total_count ?? 0 };
    },

    /** ALL recruit ids matching the same filters, in the SAME canonical sort order. For select-all / bulk. */
    async getAllIdsMatching(filters?: RecruitFilters): Promise<string[]> {
        const payload = buildRecruitPayload(filters);
        const chunkSize = 1000;
        const ids: string[] = [];
        let offset = 0;
        for (;;) {
            const { data, error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
                .rpc("contacts_recruit_ids_matching", { p_filters: payload })
                .order("ord", { ascending: true })
                .range(offset, offset + chunkSize - 1);
            if (error) throw new Error(error.message);
            const rows = (data ?? []) as Array<{ id?: string } | string>;
            if (rows.length === 0) break;
            for (const r of rows) {
                const id = typeof r === "string" ? r : r?.id;
                if (typeof id === "string" && id.length > 0) ids.push(id);
            }
            if (rows.length < chunkSize) break;
            offset += chunkSize;
        }
        return ids;
    },

    /** Delete every recruit matching the filters (chunked, errors surfaced). */
    async deleteAllMatching(filters?: RecruitFilters): Promise<number> {
        const ids = await this.getAllIdsMatching(filters);
        if (ids.length === 0) return 0;
        const chunkSize = 1000;
        for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            const { error } = await (supabase as any).from("recruits").delete().in("id", chunk);
            if (error) throw new Error(error.message);
        }
        return ids.length;
    },

    /**
     * Kanban read path (Contacts Build 4). Exact per-status full counts + bounded
     * per-column card slices for the SAME canonical recruit filter/scope as the
     * table — never the page slice. Recruits have no status filter by design, so
     * there is none to drop; pagination is ignored by the RPC. The payload is cast
     * to Json (the typed RPC arg) because the filter object isn't structurally Json.
     */
    async getKanban(filters?: RecruitFilters, perColumn = 50): Promise<KanbanResult<Recruit>> {
        const payload = buildRecruitPayload(filters);
        const { data, error } = await supabase.rpc("get_contacts_recruit_kanban", {
            p_filters: payload as unknown as Json,
            p_per_column: perColumn,
        });
        if (error) throw new Error(error.message);
        return parseKanbanResult(data, rowToRecruit);
    },

    async getById(id: string): Promise<Recruit> {
        const { data, error } = await (supabase as any).from("recruits").select("*").eq("id", id).maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error("Recruit not found");
        return rowToRecruit(data);
    },

    async create(data: Omit<Recruit, "id" | "createdAt" | "updatedAt">, organizationId: string | null = null): Promise<Recruit> {
        if (!organizationId) throw new Error("Cannot create recruit without an organization.");
        const { data: row, error } = await (supabase as any)
            .from("recruits")
            .insert({
                first_name: data.firstName,
                last_name: data.lastName,
                phone: data.phone,
                email: data.email,
                state: normalizeUsState(data.state),
                status: data.status,
                notes: data.notes,
                assigned_agent_id: data.assignedAgentId,
                organization_id: organizationId,
                custom_fields: data.customFields ?? null,
            } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
            .select()
            .single();
        if (error) throw new Error(error.message);
        return rowToRecruit(row);
    },

    async update(id: string, data: Partial<Recruit>): Promise<Recruit> {
        const updateData: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (data.firstName !== undefined) updateData.first_name = data.firstName;
        if (data.lastName !== undefined) updateData.last_name = data.lastName;
        if (data.phone !== undefined) updateData.phone = data.phone;
        if (data.email !== undefined) updateData.email = data.email;
        if (data.state !== undefined) updateData.state = normalizeUsState(data.state);
        if (data.status !== undefined) updateData.status = data.status;
        if (data.notes !== undefined) updateData.notes = data.notes;
        if (data.assignedAgentId !== undefined) updateData.assigned_agent_id = data.assignedAgentId;
        if (data.customFields !== undefined) updateData.custom_fields = data.customFields;
        updateData.updated_at = new Date().toISOString();

        const { data: row, error } = await (supabase as any)
            .from("recruits")
            .update(updateData)
            .eq("id", id)
            .select()
            .single();
        if (error) throw new Error(error.message);
        return rowToRecruit(row);
    },

    /** Reassign the given recruits to an agent. Batched UPDATE (no per-row round trip). Throws on DB error. */
    async bulkAssign(ids: string[], agentId: string): Promise<number> {
        if (ids.length === 0) return 0;
        const chunkSize = 1000;
        let updated = 0;
        for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            const { data, error } = await (supabase as any)
                .from("recruits")
                .update({ assigned_agent_id: agentId, updated_at: new Date().toISOString() })
                .in("id", chunk)
                .select("id");
            if (error) throw new Error(error.message);
            updated += data?.length ?? 0;
        }
        return updated;
    },

    async delete(id: string): Promise<void> {
        // Contacts Build 5: permission-enforcing RPC (server-side org/ownership + contacts.recruits.delete).
        // Typed against the generated RPC (CP3C migration live in prod).
        const { error } = await supabase.rpc("delete_contact", { p_contact_type: "recruit", p_contact_id: id });
        if (error) throw new Error(error.message);
    },
};

// ---- HELPERS ----
function rowToRecruit(row: any): Recruit { // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone || "",
        email: row.email,
        state: row.state || "",
        status: row.status || "New",
        notes: row.notes || "",
        assignedAgentId: row.assigned_agent_id || "",
        customFields: row.custom_fields ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
