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
  connectionErrorMessage(code: string): string {
    const messages: Record<string, string> = {
      consent_denied: "Google access was not granted. Connect again when you are ready.",
      required_permissions_missing: "Google did not grant every required permission. Connect again and select the permissions shown.",
      offline_access_required: "Google did not provide ongoing access. Remove AgentFlow in your Google Account connections, then reconnect.",
      invalid_or_expired_state: "This connection request expired or was already used. Start a new connection.",
      connection_changed: "Your connection changed during setup. Start a new connection.",
      organization_changed: "Your agency membership changed during setup. Reload AgentFlow and reconnect.",
    };
    return messages[code] ?? "Google could not finish connecting. Start a new connection or contact support.";
  },

  async getMyConnections(): Promise<UserEmailConnection[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("No authenticated user");

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();

    let query = supabase
      .from("user_email_connections")
      .select("id, provider, provider_account_email, provider_account_name, status, last_sync_at, last_error, created_at, updated_at")
      .eq("user_id", user.id);

    if (!profile?.organization_id) throw new Error("Organization not found");
    query = query.eq("organization_id", profile.organization_id);

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as UserEmailConnection[];
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

  async removeGoogleAccess(): Promise<{ google_access_revoked: boolean; warning?: string }> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("You must be logged in");
    const base = import.meta.env.VITE_SUPABASE_URL as string;
    const res = await fetch(`${base}/functions/v1/email-disconnect`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ remove_all_google_access: true }),
    });
    const result = await res.json();
    if (!res.ok || result.success !== true) throw new Error(result.error || "Unable to remove Google access");
    return result;
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
    const { data, error } = await supabase
      .from("contact_emails")
      .select("id, direction, subject, body_text, body_html, sent_at, received_at, created_at, from_email, to_emails, cc_emails, bcc_emails, delivery_status, provider_error")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw new Error(error.message);
    return data ?? [];
  },

  async sendContactEmail(payload: {
    contact_id: string;
    to_email: string;
    subject: string;
    body_text: string;
    connection_id?: string;
    from_email?: string;
    contact_type?: "lead" | "client" | "recruit";
  }): Promise<{ success: boolean; message_id?: string; error?: string }> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("You must be logged in");
    const base = import.meta.env.VITE_SUPABASE_URL as string;
    const res = await fetch(`${base}/functions/v1/email-send-contact-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
    return await res.json();
  },
};
