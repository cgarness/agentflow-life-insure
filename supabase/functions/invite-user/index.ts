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
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { email, firstName, lastName, role, licensedStates, commissionLevel, uplineId } = await req.json();
    if (!email || !firstName || !lastName || !role) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: email, firstName, lastName, role" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Step 1: Invite the user via Supabase Auth (sends the invite email)
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: {
        first_name: firstName,
        last_name: lastName,
      },
      redirectTo: `${Deno.env.get("PUBLIC_SITE_URL") || "https://preview--life-agent-hub.lovable.app"}/login`,
    });
    if (inviteError) {
      return new Response(
        JSON.stringify({ error: inviteError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = inviteData.user?.id;
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Invite succeeded but no user ID returned" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Step 2: Upsert the profile row with all the extra fields
    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert({
        id: userId,
        email,
        first_name: firstName,
        last_name: lastName,
        role,
        status: "Pending",
        licensed_states: licensedStates || [],
        commission_level: commissionLevel || "0%",
        upline_id: uplineId || null,
        organization_id: "a0000000-0000-0000-0000-000000000001",
      }, { onConflict: "id" });
    if (profileError) {
      return new Response(
        JSON.stringify({ error: `Profile creation failed: ${profileError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ success: true, userId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
