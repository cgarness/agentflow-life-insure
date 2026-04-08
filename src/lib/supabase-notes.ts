import { supabase } from "@/integrations/supabase/client";
import { ContactNote, ContactType } from "@/lib/types";

export const notesSupabaseApi = {
    // Get all notes for a specific contact
    async getByContact(contactId: string): Promise<ContactNote[]> {
        const { data: notes, error: notesError } = await (supabase as any)
            .from("contact_notes")
            .select("*")
            .eq("contact_id", contactId)
            .order("pinned", { ascending: false })
            .order("created_at", { ascending: false });

        if (notesError) throw new Error(notesError.message);
        if (!notes || notes.length === 0) return [];

        const authorIds = [...new Set(notes.map((n: any) => n.author_id).filter(Boolean))] as string[];
        let profiles: any[] = [];

        if (authorIds.length > 0) {
            const { data, error: profilesError } = await supabase
                .from("profiles")
                .select("id, first_name, last_name, avatar_url")
                .in("id", authorIds);
            
            if (!profilesError && data) {
                profiles = data;
            }
        }

        return notes.map((note: any) => {
            const profile = profiles.find(p => p.id === note.author_id);
            return rowToNote(note, profile);
        });
    },

    // Add a new note
    async add(contactId: string, contactType: string, note: string, agentId: string, organizationId: string | null = null, pinned: boolean = false): Promise<ContactNote> {
        const { data: row, error } = await (supabase as any)
            .from("contact_notes")
            .insert({
                contact_id: contactId,
                contact_type: contactType,
                content: note,
                author_id: agentId,
                organization_id: organizationId,
                pinned: pinned
            } as any)
            .select("*")
            .single();

        if (error) throw new Error(error.message);

        // Fetch author profile separately
        const { data: profile } = await supabase
            .from("profiles")
            .select("id, first_name, last_name, avatar_url")
            .eq("id", agentId)
            .single();

        return rowToNote(row, profile);
    },

    // Toggle pinned status
    async togglePin(id: string, currentPinned: boolean): Promise<ContactNote> {
        const { data: row, error } = await (supabase as any)
            .from("contact_notes")
            .update({ pinned: !currentPinned })
            .eq("id", id)
            .select("*")
            .single();

        if (error) throw new Error(error.message);

        // Fetch profile
        const { data: profile } = await supabase
            .from("profiles")
            .select("id, first_name, last_name, avatar_url")
            .eq("id", row.author_id)
            .single();

        return rowToNote(row, profile);
    },

    // Delete a note
    async deleteNote(id: string): Promise<void> {
        const { error } = await (supabase as any)
            .from("contact_notes")
            .delete()
            .eq("id", id);

        if (error) throw new Error(error.message);
    }
};

function rowToNote(row: any, profile?: any): ContactNote {
    const authorName = profile ? `${profile.first_name} ${profile.last_name}` : "Unknown Agent";
    return {
        id: row.id,
        contactId: row.contact_id,
        contactType: row.contact_type as ContactType,
        note: row.content,
        pinned: row.pinned || false,
        agentId: row.author_id || "",
        agentName: authorName,
        createdAt: row.created_at,
    };
}
