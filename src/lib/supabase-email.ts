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

  async startConnect(provider: "google" | "microsoft", redirectTo?: string): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("You must be logged in");
    const base = import.meta.env.VITE_SUPABASE_URL as string;
    const res = await fetch(`${base}/functions/v1/email-connect-start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        provider,
        redirect_to: redirectTo || `${window.location.origin}/settings?section=email-settings`,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json?.success || !json?.auth_url) {
      throw new Error(json?.error || "Failed to start OAuth connect");
    }
    return json.auth_url as string;
  },

  async disconnect(connectionId: string): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("You must be logged in");
    const base = import.meta.env.VITE_SUPABASE_URL as string;
    const res = await fetch(`${base}/functions/v1/email-disconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ connection_id: connectionId }),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) throw new Error(json?.error || "Disconnect failed");
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

