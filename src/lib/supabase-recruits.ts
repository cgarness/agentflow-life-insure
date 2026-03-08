import { supabase } from "@/integrations/supabase/client";
import { Recruit } from "@/lib/types";

export const recruitsSupabaseApi = {
    async getAll(search?: string): Promise<Recruit[]> {
        let query = (supabase as any)
            .from("recruits")
            .select("*")
            .order("created_at", { ascending: false });

        if (search) {
            const q = search;
            query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return (data ?? []).map(rowToRecruit);
    },

    async create(data: Omit<Recruit, "id" | "createdAt" | "updatedAt">): Promise<Recruit> {
        const { data: row, error } = await (supabase as any)
            .from("recruits")
            .insert({
                first_name: data.firstName,
                last_name: data.lastName,
                phone: data.phone,
                email: data.email,
                status: data.status,
                notes: data.notes,
                assigned_agent_id: data.assignedAgentId,
            })
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
        if (data.status !== undefined) updateData.status = data.status;
        if (data.notes !== undefined) updateData.notes = data.notes;
        if (data.assignedAgentId !== undefined) updateData.assigned_agent_id = data.assignedAgentId;
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

    async delete(id: string): Promise<void> {
        const { error } = await (supabase as any).from("recruits").delete().eq("id", id);
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
        status: row.status || "New",
        notes: row.notes || "",
        assignedAgentId: row.assigned_agent_id || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
