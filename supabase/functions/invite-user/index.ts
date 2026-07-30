import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@3.2.0";
import { resolveSiteUrl, SYSTEM_EMAIL_FROM } from "../_shared/systemEmail.ts";
import { renderTeamInvitationEmail } from "../_shared/systemEmailTemplates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const siteUrl = resolveSiteUrl();

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Authenticate caller via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing Authorization header" }),
        { status: 401, headers }
      );
    }

    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await adminClient.auth.getUser(jwt);
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired token" }),
        { status: 401, headers }
      );
    }

    // 2. Look up caller's profile to get organization_id and verify role
    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("organization_id, role, is_super_admin")
      .eq("id", caller.id)
      .maybeSingle();

    if (profileError || !callerProfile) {
      return new Response(
        JSON.stringify({ success: false, error: "Caller profile not found" }),
        { status: 403, headers }
      );
    }

    const isSuperAdmin = callerProfile.is_super_admin === true;
    const isAdmin = callerProfile.role === "Admin" || callerProfile.role === "Super Admin";

    if (!isSuperAdmin && !isAdmin) {
      return new Response(
        JSON.stringify({ success: false, error: "Only Admins can send invitations" }),
        { status: 403, headers }
      );
    }

    if (!callerProfile.organization_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Caller has no organization" }),
        { status: 400, headers }
      );
    }

    // 3. Parse request body
    const { email, firstName, lastName, role, licensedStates, commissionLevel, uplineId, teamId } = await req.json();

    if (!email || !firstName || !lastName || !role) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: email, firstName, lastName, role" }),
        { status: 400, headers }
      );
    }

    // The invited role flows to profiles.role on acceptance, which is now
    // constrained by profiles_role_check. Validating here means a bad role is
    // rejected at invite time instead of producing an invitation that can
    // never be redeemed (signup would fail with 23514 on every attempt).
    // Only a platform super admin may pre-assign the 'Super Admin' role.
    const ALLOWED_INVITE_ROLES = ["Agent", "Team Leader", "Admin", "Super Admin"];
    if (!ALLOWED_INVITE_ROLES.includes(role)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid role" }),
        { status: 400, headers }
      );
    }
    if (role === "Super Admin" && !isSuperAdmin) {
      return new Response(
        JSON.stringify({ success: false, error: "Only a platform super admin may invite a Super Admin" }),
        { status: 403, headers }
      );
    }

    // 4. Insert invitation into the invitations table
    const { data: invitation, error: insertError } = await adminClient
      .from("invitations")
      .insert({
        organization_id: callerProfile.organization_id,
        email,
        first_name: firstName,
        last_name: lastName,
        role,
        licensed_states: licensedStates || [],
        commission_level: commissionLevel || "0%",
        upline_id: uplineId || null,
        team_id: teamId || null,
        invited_by: caller.id,
      })
      .select("id, token")
      .single();

    if (insertError) {
      console.error("Failed to create invitation:", insertError.message);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create invitation" }),
        { status: 500, headers }
      );
    }

    // 5. Best-effort org name lookup for the email copy
    let organizationName: string | null = null;
    try {
      const { data: org, error: orgError } = await adminClient
        .from("organizations")
        .select("name")
        .eq("id", callerProfile.organization_id)
        .maybeSingle();
      if (!orgError && org?.name) {
        organizationName = org.name;
      }
    } catch (orgErr) {
      console.error("Failed to look up organization name:", orgErr);
    }

    // 6. Send invite email via Resend (best-effort — don't fail the invitation if email fails)
    const inviteURL = `${siteUrl}/accept-invite?token=${invitation.token}`;
    let emailSent = false;

    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        const { subject, html, text } = renderTeamInvitationEmail({
          firstName,
          role,
          organizationName,
          inviteUrl: inviteURL,
        });

        // Resend resolves with { error } for API-level failures (unverified
        // domain, suppressed recipient, rate limit) instead of throwing, so
        // the return value must be inspected — otherwise email_sent reports
        // true for a message that was never delivered and the UI lies.
        const { error: sendError } = await resend.emails.send({
          from: SYSTEM_EMAIL_FROM,
          to: [email],
          subject,
          html,
          text,
        });
        if (sendError) {
          console.error("Failed to send invite email:", sendError);
        } else {
          emailSent = true;
        }
      } catch (emailErr) {
        console.error("Failed to send invite email:", emailErr);
      }
    } else {
      console.warn("RESEND_API_KEY not set — skipping email send");
    }

    return new Response(
      JSON.stringify({
        success: true,
        invitation_id: invitation.id,
        token: invitation.token,
        email_sent: emailSent,
      }),
      { status: 200, headers }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers }
    );
  }
});
