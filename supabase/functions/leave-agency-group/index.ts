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
        JSON.stringify({ success: false, error: "Only Admins can leave a group" }),
        { status: 403, headers }
      );
    }

    const { group_id } = await req.json();
    if (!group_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing group_id" }),
        { status: 400, headers }
      );
    }

    const { data: member } = await adminClient
      .from("agency_group_members")
      .select("id, role")
      .eq("agency_group_id", group_id)
      .eq("organization_id", callerProfile.organization_id)
      .eq("status", "active")
      .maybeSingle();

    if (!member) {
      return new Response(
        JSON.stringify({ success: false, error: "Your organization is not an active member of this group." }),
        { status: 404, headers }
      );
    }

    if (member.role === "leader") {
      return new Response(
        JSON.stringify({ success: false, error: "The master agency cannot leave their own group. Delete the group instead." }),
        { status: 400, headers }
      );
    }

    const { error: updateError } = await adminClient
      .from("agency_group_members")
      .update({ status: "left" })
      .eq("id", member.id);

    if (updateError) {
      return new Response(
        JSON.stringify({ success: false, error: `Failed to leave: ${updateError.message}` }),
        { status: 500, headers }
      );
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers }
    );
  }
});
