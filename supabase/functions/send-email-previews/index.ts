// Internal design-QA harness: renders EVERY system email template via the
// shared renderer and sends them to an allowlisted inbox so visual changes
// can be reviewed in real email clients. Super-admin only; recipients are
// hardcoded — this endpoint must never be usable for production user flows.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@3.2.0";
import { resolveSiteUrl, SYSTEM_EMAIL_FROM } from "../_shared/systemEmail.ts";
import {
  renderAgencyGroupInviteEmail,
  renderConfirmationEmail,
  renderTeamInvitationEmail,
  renderWelcomeEmail,
} from "../_shared/systemEmailTemplates.ts";
import {
  authenticateRequest,
  isSuperAdmin,
  SystemEmailAuthClient,
} from "../_shared/systemEmailAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Hardcoded allowlist — preview sends only; not for production user flows. */
const ALLOWED_TO = new Set(["cgarness.ffl@gmail.com"]);

function jsonResponse(body: Record<string, unknown>, status: number): Response {
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
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      console.error("[send-email-previews] Missing Supabase env vars");
      return jsonResponse({ success: false, error: "Server configuration error" }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // This endpoint previously had NO caller auth — super admin only now.
    // Cast: supabase-js query builders are thenables rather than literal
    // Promises, so the client doesn't structurally match the minimal
    // SystemEmailAuthClient interface even though it behaves identically.
    const auth = await authenticateRequest(
      adminClient as unknown as SystemEmailAuthClient,
      req,
    );
    if (!auth.ok) {
      return jsonResponse({ success: false, error: auth.error }, auth.status);
    }
    if (!isSuperAdmin(auth.profile)) {
      return jsonResponse({ success: false, error: "Super admin only" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const to = String(body?.to || "").trim().toLowerCase();
    if (!ALLOWED_TO.has(to)) {
      return jsonResponse({ success: false, error: "Recipient not allowlisted" }, 403);
    }
    const firstName = String(body?.firstName || "Chris").trim() || "Chris";

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("[send-email-previews] RESEND_API_KEY not set");
      return jsonResponse({ success: false, error: "RESEND_API_KEY not set" }, 500);
    }
    const resend = new Resend(resendKey);

    const siteUrl = resolveSiteUrl();

    // Clearly-fake data: tokens are literally "PREVIEW-TOKEN" so every link
    // is visibly non-functional in the received email.
    const previews = [
      renderConfirmationEmail({
        firstName,
        actionLink: `${siteUrl}/dashboard?preview=1`,
      }),
      renderTeamInvitationEmail({
        firstName,
        role: "Agent",
        organizationName: "Family First Life (Preview)",
        inviteUrl: `${siteUrl}/accept-invite?token=PREVIEW-TOKEN`,
      }),
      renderWelcomeEmail({ firstName }),
      renderAgencyGroupInviteEmail({
        masterOrgName: "Family First Life (Preview)",
        groupName: "Preview Agency Group",
        inviteUrl: `${siteUrl}/accept-group-invite?token=PREVIEW-TOKEN`,
      }),
    ];

    const results: { subject: string; id?: string; error?: string }[] = [];
    for (const preview of previews) {
      const subject = `[Preview] ${preview.subject}`;
      try {
        const { data, error } = await resend.emails.send({
          from: SYSTEM_EMAIL_FROM,
          to: [to],
          subject,
          html: preview.html,
          text: preview.text,
        });
        if (error) {
          results.push({ subject, error: error.message });
        } else {
          results.push({ subject, id: data?.id });
        }
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : "Send failed";
        results.push({ subject, error: message });
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    // Honest status: only report success when every send actually succeeded.
    const ok = results.every((r) => !r.error);
    return jsonResponse({ success: ok, results }, ok ? 200 : 502);
  } catch (error) {
    console.error("[send-email-previews] Unexpected error:", error);
    return jsonResponse({ success: false, error: "Internal server error" }, 500);
  }
});
