import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@3.2.0";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const siteUrl = Deno.env.get("PUBLIC_SITE_URL") || "https://agentflow-life-insure.vercel.app";

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
      .single();

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
      return new Response(
        JSON.stringify({ success: false, error: `Failed to create invitation: ${insertError.message}` }),
        { status: 500, headers }
      );
    }

    // 5. Send invite email via Resend (best-effort — don't fail the invitation if email fails)
    const inviteURL = `${siteUrl}/accept-invite?token=${invitation.token}`;
    let emailSent = false;

    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        const personalizedHtml = buildEmailHtml(firstName, role, inviteURL);

        await resend.emails.send({
          from: "AgentFlow <team@fflagent.com>",
          to: [email],
          subject: "Invitation to join AgentFlow",
          html: personalizedHtml,
        });
        emailSent = true;
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

function buildEmailHtml(firstName: string, role: string, inviteURL: string): string {
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>You're Invited to AgentFlow</title>
    <style>
        body { margin: 0; padding: 0; background-color: #020408; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #F1F5F9; }
        .container { max-width: 600px; margin: 40px auto; background: rgba(13, 25, 48, 0.4); border: 1px solid rgba(99, 155, 255, 0.2); border-radius: 24px; overflow: hidden; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5); }
        .header { padding: 40px 40px 20px; text-align: center; }
        .logo { font-size: 32px; font-weight: 800; margin-bottom: 24px; }
        .logo-agent { color: #F1F5F9; } .logo-flow { color: #3B82F6; }
        .hero { padding: 0 40px 40px; text-align: center; }
        h1 { font-size: 32px; font-weight: 700; margin: 0 0 16px; background: linear-gradient(90deg, #F1F5F9, #94A3B8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        p.subtitle { font-size: 16px; color: #94A3B8; line-height: 1.6; margin: 0; }
        .inviter-badge { display: inline-block; padding: 8px 16px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 30px; color: #3B82F6; font-size: 14px; font-weight: 600; margin-bottom: 24px; }
        .cta-container { padding: 40px; text-align: center; }
        .btn { display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #1D4ED8, #3B82F6); color: #FFFFFF !important; text-decoration: none; font-weight: 700; border-radius: 12px; font-size: 16px; box-shadow: 0 10px 20px rgba(59, 130, 246, 0.3); }
        .footer { padding: 40px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.05); }
        .footer p { font-size: 12px; color: #475569; margin: 0 0 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><div class="logo"><span class="logo-agent">Agent</span><span class="logo-flow">Flow</span></div></div>
        <div class="hero">
            <div class="inviter-badge">New Team Invitation</div>
            <h1>Join Our Agency</h1>
            <p class="subtitle">Hi ${firstName}, you've been invited to join the AgentFlow team as a <strong>${role}</strong>. Click the button below to complete your registration.</p>
        </div>
        <div class="cta-container"><a href="${inviteURL}" class="btn">Accept Invitation</a></div>
        <div class="footer">
            <p>Transform your insurance business with AgentFlow.</p>
            <p>&copy; 2026 AgentFlow Inc. All Rights Reserved.</p>
        </div>
    </div>
</body>
</html>`;
}
