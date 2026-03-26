import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TELNYX_SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get the user from the auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("No authorization header");
    
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !user) throw new Error("Invalid user token");

    // Get the user's organization_id from their profile
    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.organization_id) {
      throw new Error("User has no associated organization");
    }

    const organizationId = profile.organization_id;

    // Fetch settings for this organization
    const { data: settings, error: fetchError } = await supabaseClient
      .from("telnyx_settings")
      .select("api_key, connection_id, sip_username, sip_password")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (fetchError) throw new Error(`DB error: ${fetchError.message}`);
    
    // Fallback to global settings if no organization-specific settings exist
    let finalSettings = settings;
    if (!finalSettings) {
      const { data: globalSettings } = await supabaseClient
        .from("telnyx_settings")
        .select("api_key, connection_id, sip_username, sip_password")
        .eq("id", TELNYX_SETTINGS_ID)
        .maybeSingle();
      finalSettings = globalSettings;
    }

    if (!finalSettings) throw new Error("No Telnyx credentials found. Save them in Settings first.");

    const apiKey = Deno.env.get("TELNYX_API_KEY") || finalSettings.api_key;
    const sipUsername = finalSettings.sip_username;
    const sipPassword = finalSettings.sip_password;
    const connectionId = finalSettings.connection_id;

    if (!apiKey) throw new Error("No API key configured.");
    if (!sipUsername || !sipPassword) throw new Error("No SIP credentials configured. Enter SIP Username and Password in Settings.");
    if (!connectionId) throw new Error("No Connection ID configured.");

    return new Response(
      JSON.stringify({
        sip_username: sipUsername,
        sip_password: sipPassword,
        connection_id: connectionId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
