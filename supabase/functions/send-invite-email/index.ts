// send-invite-email — RESEND path for an existing pending team invitation.
//
// Contract: POST { "invitation_id": "<uuid>" } from an authenticated Org
// Admin. The recipient, name, role, and token come ONLY from the invitations
// row — never from the request body — and the email renders through the same
// shared template as the initial send (invite-user), so the two paths cannot
// diverge.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@3.2.0";
import { resolveSiteUrl, SYSTEM_EMAIL_FROM } from "../_shared/systemEmail.ts";
import { renderTeamInvitationEmail } from "../_shared/systemEmailTemplates.ts";
import {
  authenticateRequest,
  canManageOrganization,
  isOrgAdmin,
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

interface InvitationRow {
  id: string;
  email: string | null;
  first_name: string | null;
  role: string | null;
  organization_id: string | null;
  status: string | null;
  token: string | null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { success: false, error: "Method not allowed" });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // The supabase-js builder is a thenable rather than a Promise, so it is
    // not structurally assignable to the minimal SystemEmailAuthClient
    // interface; the shapes are await-compatible.
    const auth = await authenticateRequest(
      adminClient as unknown as SystemEmailAuthClient,
      req,
    );
    if (!auth.ok) {
      return jsonResponse(auth.status, { success: false, error: auth.error });
    }
    if (!isOrgAdmin(auth.profile)) {
      return jsonResponse(403, {
        success: false,
        error: "Only Admins can resend invitations",
      });
    }

    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    const invitationId =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).invitation_id
        : undefined;
    if (typeof invitationId !== "string" || invitationId.trim() === "") {
      return jsonResponse(400, {
        success: false,
        error: "invitation_id is required",
      });
    }

    const { data: invitationData, error: invitationError } = await adminClient
      .from("invitations")
      .select("id, email, first_name, role, organization_id, status, token")
      .eq("id", invitationId)
      .maybeSingle();

    if (invitationError) {
      console.error("Failed to load invitation:", invitationError);
      return jsonResponse(500, {
        success: false,
        error: "Failed to load invitation",
      });
    }
    if (!invitationData) {
      return jsonResponse(404, { success: false, error: "Invitation not found" });
    }
    const invitation = invitationData as InvitationRow;

    // Org scoping BEFORE any status detail: a caller outside the invitation's
    // organization gets the same 404 as a missing row so this endpoint never
    // reveals whether an invitation exists in another org.
    if (!canManageOrganization(auth.profile, invitation.organization_id)) {
      return jsonResponse(404, { success: false, error: "Invitation not found" });
    }

    if (invitation.status !== "Pending") {
      return jsonResponse(409, {
        success: false,
        error: "Invitation is no longer pending",
      });
    }

    if (!invitation.email || !invitation.token) {
      console.error("Invitation row missing email or token:", invitation.id);
      return jsonResponse(500, {
        success: false,
        error: "Invitation is not sendable",
      });
    }

    // Best-effort organization name for the email copy.
    let organizationName: string | null = null;
    if (invitation.organization_id) {
      const { data: orgData, error: orgError } = await adminClient
        .from("organizations")
        .select("name")
        .eq("id", invitation.organization_id)
        .maybeSingle();
      if (!orgError && orgData) {
        organizationName = (orgData as { name: string | null }).name ?? null;
      }
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not set.");
      return jsonResponse(500, {
        success: false,
        error: "Email service not configured",
      });
    }
    const resend = new Resend(RESEND_API_KEY);

    const inviteUrl = `${resolveSiteUrl()}/accept-invite?token=${
      encodeURIComponent(invitation.token)
    }`;
    const rendered = renderTeamInvitationEmail({
      firstName: invitation.first_name ?? "",
      role: invitation.role ?? "Agent",
      organizationName,
      inviteUrl,
    });

    const { error: sendError } = await resend.emails.send({
      from: SYSTEM_EMAIL_FROM,
      to: [invitation.email],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (sendError) {
      console.error("Resend error:", sendError);
      return jsonResponse(502, {
        success: false,
        email_sent: false,
        error: "Failed to send invitation email",
      });
    }

    return jsonResponse(200, { success: true, email_sent: true });
  } catch (error) {
    console.error("send-invite-email error:", error);
    return jsonResponse(500, { success: false, error: "Internal server error" });
  }
});
