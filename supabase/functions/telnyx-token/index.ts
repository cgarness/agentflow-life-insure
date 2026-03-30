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

    // 3. Auto-Provision SIP Username if missing
    let sipUsername = profile.sip_username;
    if (!sipUsername) {
      sipUsername = `agent_${user.id.substring(0, 8)}`;
      console.log(`[telnyx-token] Auto-generating sip_username for user ${user.id}: ${sipUsername}`);
      
      const { error: updateError } = await supabaseClient
        .from("profiles")
        .update({ sip_username: sipUsername })
        .eq("id", user.id);
        
      if (updateError) {
        console.error("[telnyx-token] Failed to save auto-generated sip_username:", updateError);
        throw new Error("Failed to provision agent identity. Check database permissions.");
      }
    }

    // 4. Resolve/Provision Telnyx Telephony Credential
    let credId: string | null = null;
    try {
      console.log(`[telnyx-token] Resolving Telephony Credential for: ${sipUsername}`);
      
      // A. Search for existing credential by name within this connection
      const listRes = await fetch(`https://api.telnyx.com/v2/telephony_credentials?filter[connection_id]=${connectionId}`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      
      if (!listRes.ok) throw new Error("Failed to list Telnyx credentials");
      
      const listData = await listRes.json();
      const existing = listData.data.find((c: any) => c.name === sipUsername);
      
      if (existing) {
        credId = existing.id;
        console.log(`[telnyx-token] Found existing credential: ${credId}`);
      } else {
        // B. Create new credential if not found
        console.log(`[telnyx-token] No existing credential found. Creating new one for: ${sipUsername}`);
        const createRes = await fetch("https://api.telnyx.com/v2/telephony_credentials", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            connection_id: connectionId,
            name: sipUsername,
            expires_at: new Date(Date.now() + 86400000).toISOString(), // 24 hours
          }),
        });
        
        if (!createRes.ok) {
          const errorText = await createRes.text();
          throw new Error(`Failed to create telephony credential: ${errorText}`);
        }
        
        const createData = await createRes.json();
        credId = createData.data.id;
        console.log(`[telnyx-token] Created new credential: ${credId}`);
      }
    } catch (err: any) {
      console.error("[telnyx-token] Credential resolution failed:", err.message);
      throw err;
    }

    if (!credId) throw new Error("Failed to resolve or create telephony credential ID.");

    // 5. Generate WebRTC Token bound to this specific Credential ID
    console.log(`[telnyx-token] Generating WebRTC token for Credential ID: ${credId}`);
    const tokenRes = await fetch(`https://api.telnyx.com/v2/telephony_credentials/${credId}/token`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error("[telnyx-token] Token generation failed:", errorText);
      throw new Error("Failed to generate secure WebRTC token.");
    }

    let token = await tokenRes.text();
    try {
      const json = JSON.parse(token);
      if (json.data) token = json.data;
    } catch (e) { /* use raw string */ }

    return new Response(
      JSON.stringify({
        token: token.trim(),
        sip_username: sipUsername,
        connection_id: connectionId,
        auth_method: "token",
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
