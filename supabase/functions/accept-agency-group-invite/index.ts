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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const url = new URL(req.url);
    let token = url.searchParams.get("token");
    let action: string | null = null;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        token = body.token ?? token;
        action = body.action ?? null;
      } catch (_) {
        // empty body OK
      }
    }

    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing token" }),
        { status: 400, headers }
      );
    }

    const { data: invite } = await adminClient
      .from("agency_group_members")
      .select("id, agency_group_id, organization_id, invite_email, invite_expires_at, status")
      .eq("invite_token", token)
      .eq("status", "invited")
      .gt("invite_expires_at", new Date().toISOString())
      .maybeSingle();

    if (!invite) {
      return new Response(
        JSON.stringify({ success: false, error: "Invitation not found or expired." }),
        { status: 404, headers }
      );
    }

    const { data: group } = await adminClient
      .from("agency_groups")
      .select("id, name, master_organization_id")
      .eq("id", invite.agency_group_id)
      .maybeSingle();

    const { data: masterOrg } = group
      ? await adminClient
          .from("organizations")
          .select("name")
          .eq("id", group.master_organization_id)
          .maybeSingle()
      : { data: null };

    if (action !== "accept" && action !== "decline") {
      return new Response(
        JSON.stringify({
          success: true,
          group_name: group?.name ?? null,
          master_org_name: masterOrg?.name ?? null,
          invite_email: invite.invite_email,
          expires_at: invite.invite_expires_at,
        }),
        { status: 200, headers }
      );
    }

    // action === 'accept' or 'decline' — require auth
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
        JSON.stringify({ success: false, error: "Only Admins can accept group invitations" }),
        { status: 403, headers }
      );
    }

    if (invite.organization_id && invite.organization_id !== callerProfile.organization_id) {
      return new Response(
        JSON.stringify({ success: false, error: "This invitation belongs to a different organization." }),
        { status: 403, headers }
      );
    }

    if (action === "decline") {
      const { error: declineErr } = await adminClient
        .from("agency_group_members")
        .update({ status: "removed", invite_token: null })
        .eq("id", invite.id);

      if (declineErr) {
        return new Response(
          JSON.stringify({ success: false, error: `Failed to decline: ${declineErr.message}` }),
          { status: 500, headers }
        );
      }

      return new Response(
        JSON.stringify({ success: true, action: "declined" }),
        { status: 200, headers }
      );
    }

    const targetOrgId = invite.organization_id ?? callerProfile.organization_id;

    // Guard: caller's org cannot already be in another active/invited group via a different row.
    const { data: conflicting } = await adminClient
      .from("agency_group_members")
      .select("id")
      .eq("organization_id", targetOrgId)
      .in("status", ["active", "invited"])
      .neq("id", invite.id)
      .maybeSingle();

    if (conflicting) {
      return new Response(
        JSON.stringify({ success: false, error: "Your organization is already in another Agency Group." }),
        { status: 409, headers }
      );
    }

    const { error: updateError } = await adminClient
      .from("agency_group_members")
      .update({
        organization_id: targetOrgId,
        status: "active",
        joined_at: new Date().toISOString(),
        invite_token: null,
      })
      .eq("id", invite.id);

    if (updateError) {
      return new Response(
        JSON.stringify({ success: false, error: `Failed to accept: ${updateError.message}` }),
        { status: 500, headers }
      );
    }

    return new Response(
      JSON.stringify({ success: true, group_id: invite.agency_group_id }),
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
