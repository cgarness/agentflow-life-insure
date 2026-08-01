// send-welcome-email — one-time welcome email, JWT self-service (Option B).
//
// The authenticated user triggers their OWN welcome email after confirming
// their address (no trusted body fields — the request body is ignored, and
// the recipient is always the authenticated user's email). Idempotency is an
// atomic claim on profiles.welcome_email_sent_at so concurrent requests send
// at most one email. Deploys with verify_jwt=false, so the caller is
// validated in code via authenticateRequest.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@3.2.0";
import { SYSTEM_EMAIL_FROM } from "../_shared/systemEmail.ts";
import { renderWelcomeEmail } from "../_shared/systemEmailTemplates.ts";
import {
  authenticateRequest,
  SystemEmailAuthClient,
} from "../_shared/systemEmailAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { success: false, error: "Method not allowed" });
  }

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Any valid user JWT may call this — but only for themselves.
    // Cast: supabase-js query builders are thenables rather than literal
    // Promises, so the client doesn't structurally match the minimal
    // SystemEmailAuthClient interface even though it behaves identically.
    const auth = await authenticateRequest(
      adminClient as unknown as SystemEmailAuthClient,
      req,
    );
    if (!auth.ok) {
      return jsonResponse(auth.status, { success: false, error: auth.error });
    }
    const { user } = auth;

    if (!user.emailConfirmed) {
      return jsonResponse(403, { success: false, error: "Email not confirmed" });
    }
    if (!user.email) {
      return jsonResponse(400, {
        success: false,
        error: "Authenticated user has no email address",
      });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("first_name, welcome_email_sent_at")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("send-welcome-email: failed to load profile:", profileError);
      return jsonResponse(500, { success: false, error: "Failed to load profile" });
    }
    if (!profile) {
      return jsonResponse(404, { success: false, error: "Profile not found" });
    }

    if (profile.welcome_email_sent_at) {
      return jsonResponse(200, {
        success: true,
        already_sent: true,
        email_sent: false,
      });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("send-welcome-email: RESEND_API_KEY is not set.");
      return jsonResponse(500, {
        success: false,
        error: "Email service not configured",
      });
    }

    // Atomic idempotency claim: only the request that flips NULL -> timestamp
    // proceeds to send; every concurrent loser sees zero rows returned.
    const { data: claimedRows, error: claimError } = await adminClient
      .from("profiles")
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq("id", user.id)
      .is("welcome_email_sent_at", null)
      .select("id");

    if (claimError) {
      console.error("send-welcome-email: failed to claim send:", claimError);
      return jsonResponse(500, {
        success: false,
        error: "Failed to record welcome email state",
      });
    }
    if (!claimedRows || claimedRows.length === 0) {
      return jsonResponse(200, {
        success: true,
        already_sent: true,
        email_sent: false,
      });
    }

    // Everything after the claim runs inside this try: ANY failure — a thrown
    // render error (assertHttpsUrl on a bad PUBLIC_SITE_URL), a transport
    // throw from the Resend SDK, or a returned {error} — must release the
    // claim. Otherwise the row stays stamped and the user can never receive a
    // welcome email, with no recovery path.
    let sendFailure: unknown = null;
    try {
      const rendered = renderWelcomeEmail({
        firstName: (profile.first_name as string | null) ?? "",
      });

      const resend = new Resend(resendApiKey);
      const { error: sendError } = await resend.emails.send({
        from: SYSTEM_EMAIL_FROM,
        to: [user.email],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      if (sendError) sendFailure = sendError;
    } catch (thrown) {
      sendFailure = thrown;
    }

    if (sendFailure) {
      console.error("send-welcome-email: send failed:", sendFailure);
      // Best-effort: release the claim so the user can retry.
      const { error: resetError } = await adminClient
        .from("profiles")
        .update({ welcome_email_sent_at: null })
        .eq("id", user.id);
      if (resetError) {
        console.error(
          "send-welcome-email: failed to reset welcome_email_sent_at after send failure:",
          resetError,
        );
      }
      return jsonResponse(502, {
        success: false,
        email_sent: false,
        error: "Failed to send welcome email",
      });
    }

    return jsonResponse(200, { success: true, email_sent: true });
  } catch (error) {
    console.error("send-welcome-email: unexpected error:", error);
    return jsonResponse(500, { success: false, error: "Internal server error" });
  }
});
