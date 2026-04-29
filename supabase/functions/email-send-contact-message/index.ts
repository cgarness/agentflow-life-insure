import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "Missing authorization" }), { status: 401, headers });
    }

    const jwt = authHeader.replace("Bearer ", "");
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(jwt);

    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: "Invalid token" }), { status: 401, headers });
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile?.organization_id) {
      return new Response(JSON.stringify({ success: false, error: "Profile organization not found" }), { status: 400, headers });
    }

    const payload = await req.json();
    const contactId = String(payload?.contact_id || "").trim();
    const toEmail = String(payload?.to_email || "").trim();
    const subject = String(payload?.subject || "").trim();
    const bodyText = String(payload?.body_text || "").trim();

    if (!contactId || !toEmail || !subject || !bodyText) {
      return new Response(JSON.stringify({ success: false, error: "contact_id, to_email, subject, and body_text are required" }), {
        status: 400,
        headers,
      });
    }

    const requestedConnectionId = typeof payload?.connection_id === "string" ? payload.connection_id.trim() : "";
    const requestedFromEmail = typeof payload?.from_email === "string" ? payload.from_email.trim().toLowerCase() : "";

    let connectionQuery = admin
      .from("user_email_connections")
      .select("id, provider, provider_account_email, status")
      .eq("user_id", user.id)
      .eq("organization_id", profile.organization_id)
      .eq("status", "connected");

    if (requestedConnectionId) {
      connectionQuery = connectionQuery.eq("id", requestedConnectionId);
    } else {
      connectionQuery = connectionQuery.order("updated_at", { ascending: false }).limit(1);
    }

    const { data: connection } = await connectionQuery.maybeSingle();

    if (!connection) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Inbox not connected. Open Settings > Email Setup and connect Google or Microsoft first.",
        }),
        { status: 400, headers }
      );
    }

    const fromEmail = requestedFromEmail || String(connection.provider_account_email || "").toLowerCase();
    if (!fromEmail) {
      return new Response(JSON.stringify({ success: false, error: "No from address available for this connection." }), { status: 400, headers });
    }

    if (fromEmail !== String(connection.provider_account_email || "").toLowerCase()) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Selected from address is not available on the connected inbox.",
        }),
        { status: 400, headers }
      );
    }

    const externalMessageId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error: insertError } = await admin.from("contact_emails").insert({
      organization_id: profile.organization_id,
      contact_id: contactId,
      owner_user_id: user.id,
      connection_id: connection.id,
      provider: connection.provider,
      direction: "outbound",
      external_message_id: externalMessageId,
      thread_id: null,
      from_email: fromEmail,
      to_emails: [toEmail],
      subject,
      body_text: bodyText,
      sent_at: now,
      delivery_status: "queued",
    });

    if (insertError) {
      return new Response(JSON.stringify({ success: false, error: insertError.message }), { status: 500, headers });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message_id: externalMessageId,
        note: "Queued in conversation history. Provider send dispatch is the next implementation step.",
      }),
      { status: 200, headers }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), { status: 500, headers });
  }
});
