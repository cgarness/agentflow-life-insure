import { supabase } from "@/integrations/supabase/client";
import { ContactNote, ContactType } from "@/lib/types";

export const notesSupabaseApi = {
    // Get all notes for a specific contact
    async getByContact(contactId: string): Promise<ContactNote[]> {
        const { data, error } = await (supabase as any)
            .from("contact_notes")
            .select("*, author:profiles(first_name, last_name, avatar_url)")
            .eq("contact_id", contactId)
            .order("pinned", { ascending: false })
            .order("created_at", { ascending: false });

        if (error) throw new Error(error.message);
        return (data ?? []).map(rowToNote);
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
            .select("*, author:profiles(first_name, last_name, avatar_url)")
            .single();

        if (error) throw new Error(error.message);
        return rowToNote(row);
    },

    // Toggle pinned status
    async togglePin(id: string, currentPinned: boolean): Promise<ContactNote> {
        const { data: row, error } = await (supabase as any)
            .from("contact_notes")
            .update({ pinned: !currentPinned })
            .eq("id", id)
            .select("*, author:profiles(first_name, last_name, avatar_url)")
            .single();

        if (error) throw new Error(error.message);
        return rowToNote(row);
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

function rowToNote(row: any): ContactNote {
    const authorName = row.author ? `${row.author.first_name} ${row.author.last_name}` : "Unknown Agent";
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
