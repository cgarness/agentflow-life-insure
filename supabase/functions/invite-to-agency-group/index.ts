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
    const logoUrl = `${siteUrl}/agentflow-logo-full.png`;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

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

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("organization_id, role, is_super_admin")
      .eq("id", caller.id)
      .maybeSingle();

    if (!callerProfile || !callerProfile.organization_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Caller profile not found" }),
        { status: 403, headers }
      );
    }

    if (callerProfile.role !== "Admin" && callerProfile.is_super_admin !== true) {
      return new Response(
        JSON.stringify({ success: false, error: "Only Admins can invite to a group" }),
        { status: 403, headers }
      );
    }

    const { group_id, invite_email, organization_name } = await req.json();

    if (!group_id || !invite_email) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: group_id, invite_email" }),
        { status: 400, headers }
      );
    }

    const { data: group } = await adminClient
      .from("agency_groups")
      .select("id, name, master_organization_id")
      .eq("id", group_id)
      .maybeSingle();

    if (!group) {
      return new Response(
        JSON.stringify({ success: false, error: "Group not found" }),
        { status: 404, headers }
      );
    }

    if (group.master_organization_id !== callerProfile.organization_id && callerProfile.is_super_admin !== true) {
      return new Response(
        JSON.stringify({ success: false, error: "Only the master organization can invite members" }),
        { status: 403, headers }
      );
    }

    const { data: invitedProfile } = await adminClient
      .from("profiles")
      .select("organization_id")
      .eq("email", invite_email)
      .maybeSingle();

    const invitedOrgId = invitedProfile?.organization_id ?? null;

    if (invitedOrgId) {
      const { data: existing } = await adminClient
        .from("agency_group_members")
        .select("id, status")
        .eq("organization_id", invitedOrgId)
        .in("status", ["active", "invited"])
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ success: false, error: "This organization is already a member or has a pending invite." }),
          { status: 409, headers }
        );
      }
    } else {
      const { data: existingByEmail } = await adminClient
        .from("agency_group_members")
        .select("id")
        .eq("agency_group_id", group_id)
        .eq("invite_email", invite_email)
        .in("status", ["active", "invited"])
        .maybeSingle();

      if (existingByEmail) {
        return new Response(
          JSON.stringify({ success: false, error: "This organization is already a member or has a pending invite." }),
          { status: 409, headers }
        );
      }
    }

    const { data: row, error: insertError } = await adminClient
      .from("agency_group_members")
      .insert({
        agency_group_id: group_id,
        organization_id: invitedOrgId,
        role: "member",
        status: "invited",
        invite_email,
        invited_by: caller.id,
      })
      .select("id, invite_token")
      .maybeSingle();

    if (insertError || !row) {
      return new Response(
        JSON.stringify({ success: false, error: `Failed to create invite: ${insertError?.message ?? "unknown"}` }),
        { status: 500, headers }
      );
    }

    const { data: masterOrg } = await adminClient
      .from("organizations")
      .select("name")
      .eq("id", group.master_organization_id)
      .maybeSingle();

    const masterOrgName = masterOrg?.name ?? "an AgentFlow agency";

    let emailSent = false;
    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        const inviteURL = `${siteUrl}/accept-group-invite?token=${row.invite_token}`;
        const html = buildEmailHtml(masterOrgName, group.name, organization_name, inviteURL);

        await resend.emails.send({
          from: "AgentFlow <team@fflagent.com>",
          to: [invite_email],
          subject: `You've been invited to join ${masterOrgName}'s Agency Group on AgentFlow`,
          html,
        });
        emailSent = true;
      } catch (emailErr) {
        console.error("Failed to send invite email:", emailErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        member_id: row.id,
        invite_token: row.invite_token,
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

function buildEmailHtml(masterOrgName: string, groupName: string, _invitedOrgName: string | undefined, inviteURL: string): string {
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agency Group Invitation</title>
    <style>
        body { margin: 0; padding: 0; background-color: #020408; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #F1F5F9; }
        .container { max-width: 600px; margin: 40px auto; background: rgba(13, 25, 48, 0.4); border: 1px solid rgba(99, 155, 255, 0.2); border-radius: 24px; overflow: hidden; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5); }
        .header { padding: 40px 40px 20px; text-align: center; }
        .logo { margin-bottom: 24px; }
        .hero { padding: 0 40px 40px; text-align: center; }
        h1 { font-size: 28px; font-weight: 700; margin: 0 0 16px; background: linear-gradient(90deg, #F1F5F9, #94A3B8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        p.subtitle { font-size: 16px; color: #94A3B8; line-height: 1.6; margin: 0 0 16px; }
        .inviter-badge { display: inline-block; padding: 8px 16px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 30px; color: #3B82F6; font-size: 14px; font-weight: 600; margin-bottom: 24px; }
        .cta-container { padding: 40px; text-align: center; }
        .btn { display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #1D4ED8, #3B82F6); color: #FFFFFF !important; text-decoration: none; font-weight: 700; border-radius: 12px; font-size: 16px; box-shadow: 0 10px 20px rgba(59, 130, 246, 0.3); }
        .footer { padding: 40px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.05); }
        .footer p { font-size: 12px; color: #475569; margin: 0 0 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><div class="logo"><img src="${logoUrl}" alt="AgentFlow" style="height: 40px; width: auto; display: inline-block;" /></div></div>
        <div class="hero">
            <div class="inviter-badge">Agency Group Invitation</div>
            <h1>Join ${masterOrgName}'s Agency Group</h1>
            <p class="subtitle">Hi, ${masterOrgName} has invited your agency to join their Agency Group "<strong>${groupName}</strong>" on AgentFlow.</p>
            <p class="subtitle">As a member, you'll appear on the shared leaderboard and get access to shared training resources. Your contacts, phone numbers, billing, and settings remain 100% independent.</p>
        </div>
        <div class="cta-container"><a href="${inviteURL}" class="btn">Accept Invitation</a></div>
        <div class="footer">
            <p>This invitation expires in 7 days.</p>
            <p>&copy; 2026 AgentFlow Inc. All Rights Reserved.</p>
        </div>
    </div>
</body>
</html>`;
}
