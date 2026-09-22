import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeToken, encodeToken, refreshGoogleAccessToken, tokenContext, GoogleOAuthError } from "../_shared/google-token.ts";

import { checkGoogleMailbox } from "../_shared/google-data-lifecycle.ts";

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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  if (req.method !== "POST") return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), { status: 405, headers });

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
      .select("organization_id, first_name, last_name")
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

    if (!contactId || !toEmail || !subject || !bodyText || /[\r\n]/.test(toEmail + subject)) {
      return new Response(JSON.stringify({ success: false, error: "contact_id, to_email, subject, and body_text are required" }), {
        status: 400,
        headers,
      });
    }

    const contactType = typeof payload?.contact_type === "string" ? payload.contact_type.trim() : "";
    let contactTable = "leads";
    
    if (contactType === "client") {
      contactTable = "clients";
    } else if (contactType === "recruit") {
      contactTable = "recruits";
    } else if (!contactType) {
      const leadCheck = await admin.from("leads").select("id").eq("id", contactId).maybeSingle();
      if (leadCheck.data) {
        contactTable = "leads";
      } else {
        const clientCheck = await admin.from("clients").select("id").eq("id", contactId).maybeSingle();
        if (clientCheck.data) {
          contactTable = "clients";
        } else {
          const recruitCheck = await admin.from("recruits").select("id").eq("id", contactId).maybeSingle();
          if (recruitCheck.data) {
            contactTable = "recruits";
          } else {
            return new Response(JSON.stringify({ success: false, error: "Contact not found." }), { status: 400, headers });
          }
        }
      }
    }

    const { data: contact, error: contactError } = await admin
      .from(contactTable)
      .select("organization_id")
      .eq("id", contactId)
      .maybeSingle();

    if (contactError || !contact) {
      return new Response(JSON.stringify({ success: false, error: "Contact not found." }), { status: 400, headers });
    }

    if (contact.organization_id !== profile.organization_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "This contact does not belong to your organization.",
        }),
        { status: 400, headers }
      );
    }

    const requestedConnectionId = typeof payload?.connection_id === "string" ? payload.connection_id.trim() : "";
    const requestedFromEmail = typeof payload?.from_email === "string" ? payload.from_email.trim().toLowerCase() : "";

    let connectionQuery = admin
      .from("user_email_connections")
      .select("id, user_id, connection_generation, provider, provider_account_email, status, access_token_encrypted, refresh_token_encrypted, access_token_expires_at")
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
          error: "Inbox not connected. Open Settings > Email Setup and connect Gmail first.",
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
        await checkGoogleMailbox(admin, connection.id, connection.connection_generation);
        let accessToken = await decodeToken(connection.access_token_encrypted, tokenContext("email", connection.user_id, "access")) ?? "";
        const refreshToken = await decodeToken(connection.refresh_token_encrypted, tokenContext("email", connection.user_id, "refresh")) ?? "";
        const expiresAt = connection.access_token_expires_at;
        const isExpired = !expiresAt || new Date(expiresAt).getTime() < Date.now() + 60_000;

        if ((!accessToken || isExpired) && !refreshToken) throw new GoogleOAuthError("invalid_grant", 401);
        if ((!accessToken || isExpired) && refreshToken) {
          const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
          const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
          if (!clientId || !clientSecret) throw new Error("Missing Google OAuth env vars");
          const refreshed = await refreshGoogleAccessToken({ refreshToken, clientId, clientSecret });
          accessToken = refreshed.accessToken;
          const { data: refreshRow, error: refreshError } = await admin.from("user_email_connections").update({
            access_token_encrypted: await encodeToken(refreshed.accessToken, tokenContext("email", connection.user_id, "access")),
            access_token_expires_at: refreshed.expiresAt,
            status: "connected",
            last_error: null,
          }).eq("id", connection.id).eq("connection_generation", connection.connection_generation).eq("status", "connected").select("id").maybeSingle();
          if (refreshError || !refreshRow) throw new Error("Connection changed. Reconnect or try again.");
        }

        if (!accessToken) throw new Error("No Google access token available");

        await checkGoogleMailbox(admin, connection.id, connection.connection_generation);
        const rawMessage = [
          `From: ${fromEmail}`,
          `To: ${toEmail}`,
          `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
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
          const permissionDenied = providerCode === 403 && (sendJson?.error?.errors ?? []).some((e: { reason?: string }) => e.reason === "insufficientPermissions" || e.reason === "forbidden");
          if (providerCode === 401 || permissionDenied) {
            await admin.from("user_email_connections").update({
              status: "needs_reconnect",
              last_error: providerMessage,
            }).eq("id", connection.id).eq("connection_generation", connection.connection_generation).eq("status", "connected");
          } else {
            await admin.from("user_email_connections").update({ last_error: providerMessage }).eq("id", connection.id).eq("connection_generation", connection.connection_generation).eq("status", "connected");
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
        }).eq("id", connection.id).eq("connection_generation", connection.connection_generation).eq("status", "connected");
      } catch (error) {
        deliveryStatus = "failed";
        providerError = error instanceof Error ? error.message : "Google send failed";
        if (error instanceof GoogleOAuthError && error.code === "invalid_grant") {
          await admin.from("user_email_connections").update({ status: "needs_reconnect", last_error: providerError })
            .eq("id", connection.id).eq("connection_generation", connection.connection_generation).eq("status", "connected");
        }
      }
    } else {
      deliveryStatus = "failed";
      providerError = "Microsoft send is not implemented yet in this environment.";
    }

    const message = {
      contact_id: contactId, external_message_id: externalMessageId,
      thread_id: providerThreadId, internet_message_id: internetMessageId,
      to_emails: [toEmail], subject, body_text: bodyText, sent_at: now,
      delivery_status: deliveryStatus, provider_error: providerError,
    };
    const userName = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
    const { error: insertError } = connection.provider === "google"
      ? await admin.rpc("persist_google_outbound_email", {
          p_connection: connection.id, p_generation: connection.connection_generation,
          p_message: message, p_user_name: userName || null,
        })
      : await admin.from("contact_emails").insert({
          ...message, organization_id: profile.organization_id, owner_user_id: user.id,
          connection_id: connection.id, provider: connection.provider, direction: "outbound",
          from_email: fromEmail, source_account_email: fromEmail,
        });
    if (insertError) {
      // A successful external send stays successful even if erasure intentionally
      // prevents recording it locally. Do not encourage an automatic duplicate send.
      return new Response(JSON.stringify({
        success: deliveryStatus === "sent", history_saved: false,
        message_id: externalMessageId,
        note: deliveryStatus === "sent"
          ? "Google accepted the email, but AgentFlow did not save its history because the connection or data state changed. Do not resend automatically."
          : "Email was not sent or saved. Check your connection or deletion request before retrying.",
      }), { status: deliveryStatus === "sent" ? 200 : 502, headers });
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
