import { supabase } from "@/integrations/supabase/client";
import { Client, PolicyType } from "@/lib/types";
import { normalizeUsState } from "@/utils/stateUtils";

export interface ClientFilters {
    search?: string;
    state?: string;
    policyType?: string;
    assignedAgentIds?: string[];
    /** Canonical sort key (CLIENT_SORT_COLUMNS); invalid/missing → created_at desc (server-validated). */
    sortColumn?: string | null;
    sortDirection?: string | null;
    page?: number;
    pageSize?: number;
}

/**
 * Build the RPC payload. Sorting (incl. Assigned Agent via a SQL LEFT JOIN that
 * keeps unassigned clients) and pagination happen server-side in
 * search_contacts_clients / contacts_client_ids_matching — never a PostgREST
 * embedded `!inner` order. sortColumn is the canonical key (re-validated in SQL).
 */
function buildClientPayload(filters?: ClientFilters) {
    return {
        assigned_agent_ids:
            filters?.assignedAgentIds && filters.assignedAgentIds.length > 0 ? filters.assignedAgentIds : null,
        search: filters?.search?.trim() || null,
        state: filters?.state || null,
        policy_type: filters?.policyType || null,
        sort_column: filters?.sortColumn ?? null,
        sort_direction: filters?.sortDirection ?? null,
        page: filters?.page ?? 0,
        page_size: filters?.pageSize ?? 50,
    };
}

export const clientsSupabaseApi = {
    async getAll(searchOrFilters?: string | ClientFilters): Promise<{ data: Client[]; totalCount: number }> {
        // Support both legacy string-only search and new filter object
        const filters = typeof searchOrFilters === "string"
            ? { search: searchOrFilters }
            : searchOrFilters;

        // Rows + exact total from ONE RPC; full-dataset sort (incl. Assigned Agent via
        // SQL LEFT JOIN, unassigned kept) happens server-side BEFORE pagination.
        const { data, error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
            .rpc("search_contacts_clients", { p_filters: buildClientPayload(filters) });
        if (error) throw new Error(error.message);
        const result = (data ?? {}) as { total_count?: number; rows?: any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
        return { data: (result.rows ?? []).map(rowToClient), totalCount: result.total_count ?? 0 };
    },

    /** ALL client ids matching the same filters, in the SAME canonical sort order. For select-all / bulk. */
    async getAllIdsMatching(filters?: ClientFilters): Promise<string[]> {
        const payload = buildClientPayload(filters);
        const chunkSize = 1000;
        const ids: string[] = [];
        let offset = 0;
        for (;;) {
            const { data, error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
                .rpc("contacts_client_ids_matching", { p_filters: payload })
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

    /** Delete every client matching the filters (chunked, errors surfaced). */
    async deleteAllMatching(filters?: ClientFilters): Promise<number> {
        const ids = await this.getAllIdsMatching(filters);
        if (ids.length === 0) return 0;
        const chunkSize = 1000;
        for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            const { error } = await (supabase as any).from("clients").delete().in("id", chunk);
            if (error) throw new Error(error.message);
        }
        return ids.length;
    },

    async getById(id: string): Promise<Client> {
        const { data, error } = await (supabase as any).from("clients").select("*").eq("id", id).maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error("Client not found");
        return rowToClient(data);
    },

    async create(data: Omit<Client, "id" | "createdAt" | "updatedAt">, organizationId: string | null = null): Promise<Client> {
        if (!organizationId) throw new Error("Cannot create client without an organization.");
        const { data: row, error } = await (supabase as any)
            .from("clients")
            .insert({ ...clientToRow(data), organization_id: organizationId })
            .select()
            .single();
        if (error) throw new Error(error.message);
        return rowToClient(row);
    },

    async update(id: string, data: Partial<Client>): Promise<Client> {
        const updateData: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (data.firstName !== undefined) updateData.first_name = data.firstName;
        if (data.lastName !== undefined) updateData.last_name = data.lastName;
        if (data.phone !== undefined) updateData.phone = data.phone;
        if (data.email !== undefined) updateData.email = data.email;
        if (data.state !== undefined) updateData.state = normalizeUsState(data.state);
        if (data.policyType !== undefined) updateData.policy_type = data.policyType;
        if (data.carrier !== undefined) updateData.carrier = data.carrier;
        if (data.policyNumber !== undefined) updateData.policy_number = data.policyNumber;
        // Canonical numeric policy columns: clients.premium and clients.face_amount.
        // Blank/unknown values persist as NULL (never a fabricated 0).
        if (data.premiumAmount !== undefined) updateData.premium = parseCurrencyToNumberOrNull(data.premiumAmount);
        if (data.faceAmount !== undefined) updateData.face_amount = parseCurrencyToNumberOrNull(data.faceAmount);
        // Policy dates are text columns; store valid values as YYYY-MM-DD, blanks as NULL.
        if (data.issueDate !== undefined) updateData.issue_date = normalizeDateOrNull(data.issueDate);
        if (data.effectiveDate !== undefined) updateData.effective_date = normalizeDateOrNull(data.effectiveDate);
        if (data.beneficiaryName !== undefined) updateData.beneficiary_name = data.beneficiaryName;
        if (data.beneficiaryRelationship !== undefined) updateData.beneficiary_relationship = data.beneficiaryRelationship;
        if (data.beneficiaryPhone !== undefined) updateData.beneficiary_phone = data.beneficiaryPhone;
        if (data.notes !== undefined) updateData.notes = data.notes;
        if (data.assignedAgentId !== undefined) updateData.assigned_agent_id = data.assignedAgentId;
        if (data.customFields !== undefined) updateData.custom_fields = data.customFields;
        updateData.updated_at = new Date().toISOString();

        const { data: row, error } = await (supabase as any)
            .from("clients")
            .update(updateData)
            .eq("id", id)
            .select()
            .single();
        if (error) throw new Error(error.message);
        return rowToClient(row);
    },

    /** Reassign the given clients to an agent. Batched UPDATE (no per-row round trip). Throws on DB error. */
    async bulkAssign(ids: string[], agentId: string): Promise<number> {
        if (ids.length === 0) return 0;
        const chunkSize = 1000;
        let updated = 0;
        for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            const { data, error } = await (supabase as any)
                .from("clients")
                .update({ assigned_agent_id: agentId, updated_at: new Date().toISOString() })
                .in("id", chunk)
                .select("id");
            if (error) throw new Error(error.message);
            updated += data?.length ?? 0;
        }
        return updated;
    },

    async delete(id: string): Promise<void> {
        // Contacts Build 5: permission-enforcing RPC (server-side org/ownership + contacts.clients.delete).
        // Typed against the generated RPC (CP3C migration live in prod).
        const { error } = await supabase.rpc("delete_contact", { p_contact_type: "client", p_contact_id: id });
        if (error) throw new Error(error.message);
    },
};

// ---- VALUE HELPERS (exported for unit tests) ----

/**
 * Format a numeric DB value (clients.premium / clients.face_amount) for display.
 * Missing OR zero values render blank ("") — never a fabricated "$0" policy value (Build 1 decision D1).
 */
export function formatCurrencyValue(n: unknown): string {
    if (n === null || n === undefined || n === "") return "";
    const num = typeof n === "number" ? n : Number(n);
    if (!Number.isFinite(num) || num === 0) return "";
    return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parse a user-entered currency string to a number, or null when blank/invalid. Never coerces blank to 0. */
export function parseCurrencyToNumberOrNull(s: unknown): number | null {
    if (s === null || s === undefined) return null;
    const cleaned = String(s).replace(/[^0-9.-]+/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : null;
}

/** Normalize a date value to YYYY-MM-DD text, or null when blank. Accepts an ISO timestamp and keeps the date part. */
export function normalizeDateOrNull(s: unknown): string | null {
    if (s === null || s === undefined) return null;
    const trimmed = String(s).trim();
    if (trimmed === "") return null;
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : trimmed;
}

// ---- ROW MAPPERS (exported for unit tests) ----
export function rowToClient(row: any): Client { // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone || "",
        email: row.email,
        state: row.state || "",
        policyType: (row.policy_type as PolicyType) || "Term",
        carrier: row.carrier || "Unknown",
        policyNumber: row.policy_number || "",
        // Canonical numeric columns; missing/zero → blank (never fabricated "$0").
        faceAmount: formatCurrencyValue(row.face_amount),
        premiumAmount: formatCurrencyValue(row.premium),
        // Canonical text date columns; missing → blank (never substitute created_at).
        issueDate: row.issue_date || "",
        effectiveDate: row.effective_date || "",
        beneficiaryName: row.beneficiary_name || "",
        beneficiaryRelationship: row.beneficiary_relationship || "",
        beneficiaryPhone: row.beneficiary_phone || "",
        notes: row.notes || "",
        assignedAgentId: row.assigned_agent_id || "",
        userId: row.user_id || "",
        customFields: row.custom_fields ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function clientToRow(data: Partial<Client>): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
        first_name: data.firstName,
        last_name: data.lastName,
        phone: data.phone,
        email: data.email,
        state: normalizeUsState(data.state),
        policy_type: data.policyType,
        carrier: data.carrier,
        policy_number: data.policyNumber || null,
        // Canonical numeric columns; blank → NULL (never a fabricated 0).
        premium: parseCurrencyToNumberOrNull(data.premiumAmount),
        face_amount: parseCurrencyToNumberOrNull(data.faceAmount),
        // Canonical text date columns; blank → NULL, valid → YYYY-MM-DD.
        issue_date: normalizeDateOrNull(data.issueDate),
        effective_date: normalizeDateOrNull(data.effectiveDate),
        beneficiary_name: data.beneficiaryName || null,
        beneficiary_relationship: data.beneficiaryRelationship || null,
        beneficiary_phone: data.beneficiaryPhone || null,
        notes: data.notes || null,
        assigned_agent_id: data.assignedAgentId,
        custom_fields: data.customFields ?? null,
    };
}
