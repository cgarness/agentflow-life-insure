import { supabase } from "@/integrations/supabase/client";
import { ContactActivity, ContactType } from "@/lib/types";
import { getAgentName } from "@/lib/mock-data";

export const activitiesSupabaseApi = {
    // Get all activities for a specific contact
    async getByContact(contactId: string): Promise<ContactActivity[]> {
        const { data, error } = await (supabase as any)
            .from("contact_activities")
            .select("*, agent:profiles(first_name, last_name)")
            .eq("contact_id", contactId)
            .order("created_at", { ascending: false });

        if (error) throw new Error(error.message);
        return (data ?? []).map(rowToActivity);
    },

    // Log a new activity
    async add(data: {
        contactId: string;
        contactType: string;
        type: string;
        description: string;
        agentId?: string;
        metadata?: Record<string, unknown>;
    }): Promise<ContactActivity> {
        const { data: row, error } = await supabase
            .from("contact_activities")
            .insert({
                contact_id: data.contactId,
                contact_type: data.contactType,
                activity_type: data.type,
                description: data.description,
                agent_id: data.agentId || null,
                metadata: data.metadata || null,
            })
            .select("*, agent:profiles(first_name, last_name)")
            .single();

        if (error) throw new Error(error.message);
        return rowToActivity(row);
    },
};

function rowToActivity(row: any): ContactActivity { // eslint-disable-line @typescript-eslint/no-explicit-any
    const agentName = row.agent ? `${row.agent.first_name} ${row.agent.last_name}` : (row.agent_id ? getAgentName(row.agent_id) : "System");

    return {
        id: row.id,
        contactId: row.contact_id,
        contactType: row.contact_type as ContactType,
        type: row.activity_type,
        description: row.description,
        agentId: row.agent_id || "system",
        agentName,
        metadata: (row.metadata as Record<string, unknown>) || undefined,
        createdAt: row.created_at,
    };
}
