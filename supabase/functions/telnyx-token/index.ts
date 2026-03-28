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
    const connectionId = finalSettings.connection_id;

    if (!apiKey) throw new Error("No API key configured.");
    if (!connectionId) throw new Error("No Connection ID configured.");

    // 1. If we have connection_id, prioritize generating a fresh token
    if (connectionId) {
      try {
        console.log("Generating on-demand Telnyx token for connection:", connectionId);
        
        // Create Telephony Credential
        const credRes = await fetch("https://api.telnyx.com/v2/telephony_credentials", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
        connection_id: connectionId,
        expires_at: new Date(Date.now() + 86400000).toISOString(), // 24 hours
        name: `AgentFlow-${user.id.substring(0, 8)}`,
      }),
        });

        if (!credRes.ok) {
          const errorText = await credRes.text();
          console.error("Failed to create telephony credential:", errorText);
          throw new Error(`Failed to create telephony credential: ${errorText}`);
        }

        const credData = await credRes.json();
        const credId = credData.data.id;

        // Generate Token
        const tokenRes = await fetch(`https://api.telnyx.com/v2/telephony_credentials/${credId}/token`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });

        if (!tokenRes.ok) {
          const errorText = await tokenRes.text();
          console.error("Failed to generate Telnyx token:", errorText);
          throw new Error(`Failed to generate Telnyx token: ${errorText}`);
        }

        const rawToken = await tokenRes.text();
        let token = rawToken;
        
        // Telnyx sometimes returns {"data": "token"} even if docs say raw string
        try {
          const json = JSON.parse(rawToken);
          if (json.data) token = json.data;
          else if (typeof json === 'string') token = json;
        } catch (e) {
          // It's a raw string, use as is
        }

        console.log("Successfully retrieved token (length:", token.length, ")");

        return new Response(
          JSON.stringify({
            token: token.trim(),
            connection_id: connectionId,
            auth_method: "token",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (tokenError: any) {
        console.warn("Token generation failed, checking for SIP credentials fallback:", tokenError.message);
        // Fall through to try SIP credentials if token fails
      }
    }

    // 2. Fallback: If we have explicit SIP credentials, use them
    if (finalSettings.sip_username && finalSettings.sip_password) {
      console.log("Using SIP credential fallback for user:", user.id);
      return new Response(
        JSON.stringify({
          sip_username: finalSettings.sip_username,
          sip_password: finalSettings.sip_password,
          connection_id: connectionId,
          auth_method: "sip_credentials",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error("Could not generate a login token and no SIP credentials are configured. Please verify your API Key and Connection ID in Phone Settings, or add SIP credentials as a fallback.");

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
