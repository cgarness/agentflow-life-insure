import { supabase } from "@/integrations/supabase/client";

export type UserEmailConnection = {
  id: string;
  provider: "google" | "microsoft";
  provider_account_email: string;
  provider_account_name: string | null;
  status: "connected" | "needs_reconnect" | "disconnected" | "sync_paused";
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export const emailSupabaseApi = {
  async getMyConnections(): Promise<UserEmailConnection[]> {
    const { data, error } = await (supabase as any)
      .from("user_email_connections")
      .select("id, provider, provider_account_email, provider_account_name, status, last_sync_at, last_error, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as UserEmailConnection[];
  },

  async disconnect(connectionId: string): Promise<void> {
    const { error } = await (supabase as any)
      .from("user_email_connections")
      .update({ status: "disconnected", updated_at: new Date().toISOString() })
      .eq("id", connectionId);
    if (error) throw new Error(error.message);
  },

  async getContactEmails(contactId: string): Promise<any[]> {
    const { data, error } = await (supabase as any)
      .from("contact_emails")
      .select("id, direction, subject, body_text, body_html, sent_at, received_at, created_at, from_email, to_emails, delivery_status, provider_error")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};

