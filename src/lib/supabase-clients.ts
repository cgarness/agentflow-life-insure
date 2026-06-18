import { supabase } from "@/integrations/supabase/client";
import { Client, PolicyType } from "@/lib/types";
import { normalizeUsState } from "@/utils/stateUtils";

export const clientsSupabaseApi = {
    async getAll(searchOrFilters?: string | {
        search?: string;
        state?: string;
        policyType?: string;
        assignedAgentIds?: string[];
        page?: number;
        pageSize?: number;
    }): Promise<{ data: Client[]; totalCount: number }> {
        // Support both legacy string-only search and new filter object
        const filters = typeof searchOrFilters === "string"
            ? { search: searchOrFilters }
            : searchOrFilters;

        const page = filters?.page ?? 0;
        const pageSize = filters?.pageSize ?? 50;

        const applyFilters = (q: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            if (filters?.search) {
                const s = filters.search;
                q = q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`);
            }
            if (filters?.state) q = q.eq("state", filters.state);
            if (filters?.policyType) q = q.eq("policy_type", filters.policyType);
            if (filters?.assignedAgentIds && filters.assignedAgentIds.length > 0) {
                q = filters.assignedAgentIds.length === 1
                    ? q.eq("assigned_agent_id", filters.assignedAgentIds[0])
                    : q.in("assigned_agent_id", filters.assignedAgentIds);
            }
            return q;
        };

        const from = page * pageSize;
        const to = from + pageSize - 1;
        const countPromise = applyFilters(
            (supabase as any).from("clients").select("id", { count: "exact", head: true })
        );
        let dataQuery = applyFilters(
            (supabase as any).from("clients").select("*").order("created_at", { ascending: false })
        );
        dataQuery = dataQuery.range(from, to);

        const [
            { count: totalCount, error: countError },
            { data, error },
        ] = await Promise.all([countPromise, dataQuery]);
        if (countError) throw new Error(countError.message);
        if (error) throw new Error(error.message);
        return { data: (data ?? []).map(rowToClient), totalCount: totalCount ?? 0 };
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
        const { error } = await (supabase as any).from("clients").delete().eq("id", id);
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
