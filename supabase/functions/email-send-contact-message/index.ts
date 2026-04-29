import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Missing Google OAuth env vars");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || "Failed to refresh Google token");
  }
  return { accessToken: data.access_token as string, expiresIn: Number(data.expires_in ?? 3600) };
}

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
      .select("id, provider, provider_account_email, status, access_token_encrypted, refresh_token_encrypted, access_token_expires_at")
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
    let deliveryStatus: "queued" | "sent" | "failed" = "queued";
    let providerError: string | null = null;
    let providerThreadId: string | null = null;
    let internetMessageId: string | null = null;

    if (connection.provider === "google") {
      try {
        let accessToken = String((connection as any).access_token_encrypted || "");
        const refreshToken = String((connection as any).refresh_token_encrypted || "");
        const expiresAt = (connection as any).access_token_expires_at as string | null;
        const isExpired = !expiresAt || new Date(expiresAt).getTime() < Date.now() + 60_000;

        if ((!accessToken || isExpired) && refreshToken) {
          const refreshed = await refreshGoogleAccessToken(refreshToken);
          accessToken = refreshed.accessToken;
          await admin.from("user_email_connections").update({
            access_token_encrypted: refreshed.accessToken,
            access_token_expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
            status: "connected",
            last_error: null,
          }).eq("id", connection.id);
        }

        if (!accessToken) throw new Error("No Google access token available");

        const rawMessage = [
          `From: ${fromEmail}`,
          `To: ${toEmail}`,
          `Subject: ${subject}`,
          "Content-Type: text/plain; charset=UTF-8",
          "",
          bodyText,
        ].join("\r\n");

        const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw: toBase64Url(rawMessage) }),
        });
        const sendJson = await sendRes.json();
        if (!sendRes.ok) {
          const providerMessage = sendJson?.error?.message || "Gmail send failed";
          const providerCode = Number(sendJson?.error?.code || sendRes.status || 0);
          if (providerCode === 401 || providerCode === 403) {
            await admin.from("user_email_connections").update({
              status: "needs_reconnect",
              last_error: providerMessage,
            }).eq("id", connection.id);
          } else {
            await admin.from("user_email_connections").update({ last_error: providerMessage }).eq("id", connection.id);
          }
          throw new Error(providerMessage);
        }
        deliveryStatus = "sent";
        providerThreadId = sendJson?.threadId || null;
        internetMessageId = sendJson?.id || null;
        await admin.from("user_email_connections").update({
          status: "connected",
          last_error: null,
          last_sync_at: now,
        }).eq("id", connection.id);
      } catch (error) {
        deliveryStatus = "failed";
        providerError = error instanceof Error ? error.message : "Google send failed";
      }
    } else {
      deliveryStatus = "failed";
      providerError = "Microsoft send is not implemented yet in this environment.";
    }

    const { error: insertError } = await admin.from("contact_emails").insert({
      organization_id: profile.organization_id,
      contact_id: contactId,
      owner_user_id: user.id,
      connection_id: connection.id,
      provider: connection.provider,
      direction: "outbound",
      external_message_id: externalMessageId,
      thread_id: providerThreadId,
      internet_message_id: internetMessageId,
      from_email: fromEmail,
      to_emails: [toEmail],
      subject,
      body_text: bodyText,
      sent_at: now,
      delivery_status: deliveryStatus,
      provider_error: providerError,
    });

    if (insertError) {
      return new Response(JSON.stringify({ success: false, error: insertError.message }), { status: 500, headers });
    }

    return new Response(
      JSON.stringify({
        success: deliveryStatus === "sent",
        message_id: externalMessageId,
        note: deliveryStatus === "sent" ? "Email sent via provider and recorded in history." : "Email was recorded but provider send failed.",
      }),
      { status: deliveryStatus === "sent" ? 200 : 502, headers }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), { status: 500, headers });
  }
});
