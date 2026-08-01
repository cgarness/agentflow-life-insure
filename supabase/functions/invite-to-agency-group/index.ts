import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@3.2.0";
import { resolveSiteUrl, SYSTEM_EMAIL_FROM } from "../_shared/systemEmail.ts";
import { renderAgencyGroupInviteEmail } from "../_shared/systemEmailTemplates.ts";

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

    const { group_id, invite_email } = await req.json();

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
      // Log the DB detail; return a generic message so table/constraint names
      // are not echoed to the browser (matches invite-user).
      console.error("Failed to create agency group invite:", insertError?.message ?? "no row returned");
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create invite" }),
        { status: 500, headers }
      );
    }

    const { data: masterOrg } = await adminClient
      .from("organizations")
      .select("name")
      .eq("id", group.master_organization_id)
      .maybeSingle();

    const masterOrgName = masterOrg?.name ?? null;

    let emailSent = false;
    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        const siteUrl = resolveSiteUrl();
        const inviteUrl = `${siteUrl}/accept-group-invite?token=${row.invite_token}`;
        const { subject, html, text } = renderAgencyGroupInviteEmail({
          masterOrgName,
          groupName: group.name,
          inviteUrl,
        });

        // Resend reports API-level failures via the returned { error }
        // rather than throwing, so email_sent must reflect it.
        const { error: sendError } = await resend.emails.send({
          from: SYSTEM_EMAIL_FROM,
          to: [invite_email],
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
    console.error("invite-to-agency-group error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers }
    );
  }
});
