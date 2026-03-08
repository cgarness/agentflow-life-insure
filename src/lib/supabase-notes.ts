import { supabase } from "@/integrations/supabase/client";
import { ContactNote, ContactType } from "@/lib/types";

export const notesSupabaseApi = {
    // Get all notes for a specific contact
    async getByContact(contactId: string): Promise<ContactNote[]> {
        const { data, error } = await supabase
            .from("contact_notes")
            .select("*, author:profiles(first_name, last_name)")
            .eq("contact_id", contactId)
            .order("created_at", { ascending: false });

        if (error) throw new Error(error.message);
        return (data ?? []).map(rowToNote);
    },

    // Add a new note
    async add(contactId: string, contactType: string, note: string, agentId: string): Promise<ContactNote> {
        const { data: row, error } = await supabase
            .from("contact_notes")
            .insert({
                contact_id: contactId,
                contact_type: contactType,
                content: note,
                author_id: agentId,
            })
            .select("*, author:profiles(first_name, last_name)")
            .single();

        if (error) throw new Error(error.message);
        return rowToNote(row);
    },

    // Toggle pinned status (requires adding a `pinned` boolean column to contact_notes in a future migration, but for now we just return the note unpinned)
    async togglePin(id: string): Promise<ContactNote> {
        throw new Error("Pinning is not yet supported in the Supabase schema");
    },
};

function rowToNote(row: any): ContactNote { // eslint-disable-line @typescript-eslint/no-explicit-any
    const authorName = row.author ? `${row.author.first_name} ${row.author.last_name}` : "Unknown Agent";
    return {
        id: row.id,
        contactId: row.contact_id,
        contactType: row.contact_type as ContactType,
        note: row.content,
        pinned: false,
        agentId: row.author_id || "",
        agentName: authorName,
        createdAt: row.created_at,
    };
}
