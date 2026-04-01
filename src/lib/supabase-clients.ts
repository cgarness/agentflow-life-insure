import { supabase } from "@/integrations/supabase/client";
import { Client, PolicyType } from "@/lib/types";

export const clientsSupabaseApi = {
    async getAll(search?: string): Promise<Client[]> {
        let query = (supabase as any)
            .from("clients")
            .select("*")
            .order("created_at", { ascending: false });

        if (search) {
            const q = search;
            query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return (data ?? []).map(rowToClient);
    },

    async create(data: Omit<Client, "id" | "createdAt" | "updatedAt">, organizationId: string | null = null): Promise<Client> {
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
        if (data.state !== undefined) updateData.state = data.state;
        if (data.policyType !== undefined) updateData.policy_type = data.policyType;
        if (data.carrier !== undefined) updateData.carrier = data.carrier;
        if (data.policyNumber !== undefined) updateData.policy_number = data.policyNumber;
        // faceAmount & premiumAmount are currently strings in Client mostly, but premium is numeric in DB
        if (data.premiumAmount !== undefined) {
            updateData.premium = parseFloat(data.premiumAmount.replace(/[^0-9.-]+/g, "")) || 0;
        }
        // faceAmount might just be stored in customFields or notes for now, or added to schema later
        // For simplicity, we'll stuff it in notes if needed, or just ignore if not in schema.
        if (data.beneficiaryName !== undefined) updateData.beneficiary_name = data.beneficiaryName;
        if (data.beneficiaryRelationship !== undefined) updateData.beneficiary_relationship = data.beneficiaryRelationship;
        if (data.beneficiaryPhone !== undefined) updateData.beneficiary_phone = data.beneficiaryPhone;
        if (data.notes !== undefined) updateData.notes = data.notes;
        if (data.assignedAgentId !== undefined) updateData.assigned_agent_id = data.assignedAgentId;
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

    async delete(id: string): Promise<void> {
        const { error } = await (supabase as any).from("clients").delete().eq("id", id);
        if (error) throw new Error(error.message);
    },
};

// ---- HELPERS ----
function rowToClient(row: any): Client { // eslint-disable-line @typescript-eslint/no-explicit-any
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
        faceAmount: "$0", // Not in schema, mocked
        premiumAmount: row.premium ? `$${Number(row.premium).toFixed(2)}` : "$0",
        issueDate: row.created_at, // Mocking issueDate with created_at for now
        effectiveDate: row.created_at,
        beneficiaryName: row.beneficiary_name || "",
        beneficiaryRelationship: row.beneficiary_relationship || "",
        beneficiaryPhone: row.beneficiary_phone || "",
        notes: row.notes || "",
        assignedAgentId: row.assigned_agent_id || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function clientToRow(data: Omit<Client, "id" | "createdAt" | "updatedAt">): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
        first_name: data.firstName,
        last_name: data.lastName,
        phone: data.phone,
        email: data.email,
        state: data.state,
        policy_type: data.policyType,
        carrier: data.carrier,
        policy_number: data.policyNumber,
        premium: parseFloat(data.premiumAmount.replace(/[^0-9.-]+/g, "")) || 0,
        beneficiary_name: data.beneficiaryName,
        beneficiary_relationship: data.beneficiaryRelationship,
        beneficiary_phone: data.beneficiaryPhone,
        notes: data.notes,
        assigned_agent_id: data.assignedAgentId,
    };
}
