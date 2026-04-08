import { supabase } from "@/integrations/supabase/client";
import { ContactActivity, ContactType } from "@/lib/types";

export const activitiesSupabaseApi = {
    // Get all activities for a specific contact
    async getByContact(contactId: string): Promise<ContactActivity[]> {
        const { data: activities, error: activitiesError } = await (supabase as any)
            .from("contact_activities")
            .select("*")
            .eq("contact_id", contactId)
            .order("created_at", { ascending: false });

        if (activitiesError) throw new Error(activitiesError.message);
        if (!activities || activities.length === 0) return [];

        const agentIds = [...new Set(activities.map((a: any) => a.agent_id).filter(Boolean))] as string[];
        let profiles: any[] = [];

        if (agentIds.length > 0) {
            const { data, error: profilesError } = await supabase
                .from("profiles")
                .select("id, first_name, last_name, avatar_url")
                .in("id", agentIds);
            
            if (!profilesError && data) {
                profiles = data;
            }
        }

        return activities.map((activity: any) => {
            const profile = profiles.find(p => p.id === activity.agent_id);
            return rowToActivity(activity, profile);
        });
    },

    // Log a new activity
    async add(data: {
        contactId: string;
        contactType: string;
        type: string;
        description: string;
        agentId?: string;
        metadata?: Record<string, unknown>;
    }, organizationId: string | null = null): Promise<ContactActivity> {
        const { data: row, error } = await (supabase as any)
            .from("contact_activities")
            .insert({
                contact_id: data.contactId,
                contact_type: data.contactType,
                activity_type: data.type,
                description: data.description,
                agent_id: data.agentId || null,
                metadata: data.metadata || null,
                organization_id: organizationId,
            } as any)
            .select("*")
            .single();

        if (error) throw new Error(error.message);

        // Fetch agent profile separately
        let profile = null;
        if (data.agentId) {
            const { data: p } = await supabase
                .from("profiles")
                .select("id, first_name, last_name, avatar_url")
                .eq("id", data.agentId)
                .single();
            profile = p;
        }

        return rowToActivity(row, profile);
    },
};

function rowToActivity(row: any, profile?: any): ContactActivity {
    const agentName = profile ? `${profile.first_name} ${profile.last_name}` : (row.agent_id ? row.agent_id : "System");

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
