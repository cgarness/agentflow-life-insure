import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
      .select("organization_id, sip_username")
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
    
    // Fallback to global settings
    let finalSettings = settings;
    if (!finalSettings) {
      const { data: globalSettings } = await supabaseClient
        .from("telnyx_settings")
        .select("api_key, connection_id, sip_username, sip_password")
        .eq("id", "00000000-0000-0000-0000-000000000001")
        .maybeSingle();
      finalSettings = globalSettings;
    }

    if (!finalSettings) throw new Error("No Telnyx credentials found. Save them in Settings first.");

    const apiKey = Deno.env.get("TELNYX_API_KEY") || finalSettings.api_key;
    const connectionId = finalSettings.connection_id;

    if (!apiKey) throw new Error("No API key configured.");
    if (!connectionId) throw new Error("No Connection ID configured.");

    // Derive a stable credential name from user ID (used for Telnyx lookup only).
    // profile.sip_username will be overwritten with the real Telnyx-assigned sip_username
    // (e.g., "gencredXXXXX") so that webhook transfers reach the registered WebRTC client.
    const credentialName = `agent_${user.id.substring(0, 8)}`;

    // --- Resolve or create a Telephony Credential for this agent ---
    let credId: string | null = null;
    let credSipUsername: string | null = null;

    // Step A: List existing credentials on this connection
    const listUrl = `https://api.telnyx.com/v2/telephony_credentials?filter[connection_id]=${connectionId}&page[size]=250`;
    console.log(`[telnyx-token] Listing credentials for connection: ${connectionId} (looking for name=${credentialName})`);
    
    const listRes = await fetch(listUrl, {
      method: "GET",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });

    if (!listRes.ok) {
      const errBody = await listRes.text();
      console.error(`[telnyx-token] List credentials failed (${listRes.status}): ${errBody}`);
    } else {
      const listData = await listRes.json();
      const existing = listData.data?.find((c: any) => c.name === credentialName);
      if (existing) {
        credId = existing.id;
        credSipUsername = existing.sip_username || null;
        console.log(`[telnyx-token] Found existing credential: ${credId}, sip_username: ${credSipUsername}`);
      }
    }

    // Step B: Create credential if not found
    if (!credId) {
      console.log(`[telnyx-token] Creating new credential for: ${credentialName}`);
      const createRes = await fetch("https://api.telnyx.com/v2/telephony_credentials", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          connection_id: connectionId,
          name: credentialName,
        }),
      });
      
      if (!createRes.ok) {
        const errBody = await createRes.text();
        console.error(`[telnyx-token] Create credential failed (${createRes.status}): ${errBody}`);
        
        // Final fallback: return org-wide SIP credentials for credential-based auth
        console.log("[telnyx-token] Falling back to SIP credential auth");
        if (finalSettings.sip_username) {
          await supabaseClient
            .from("profiles")
            .update({ sip_username: finalSettings.sip_username, updated_at: new Date().toISOString() })
            .eq("id", user.id);
        }
        return new Response(
          JSON.stringify({
            sip_username: finalSettings.sip_username,
            sip_password: finalSettings.sip_password,
            connection_id: connectionId,
            auth_method: "credentials",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      const createData = await createRes.json();
      credId = createData.data.id;
      credSipUsername = createData.data.sip_username || null;
      console.log(`[telnyx-token] Created credential: ${credId}, sip_username: ${credSipUsername}`);
    }

    // Step B2: Persist the Telnyx-assigned sip_username to the agent's profile.
    // The telnyx-webhook reads profiles.sip_username when transferring the call to
    // the agent's WebRTC client — it MUST be the real Telnyx sip_username (e.g.,
    // "gencredXXXXX"), NOT the friendly credential name (e.g., "agent_abc12345").
    if (credSipUsername && credSipUsername !== profile.sip_username) {
      console.log(`[telnyx-token] Updating profile.sip_username: ${profile.sip_username} → ${credSipUsername}`);
      await supabaseClient
        .from("profiles")
        .update({ sip_username: credSipUsername, updated_at: new Date().toISOString() })
        .eq("id", user.id);
    }

    // Step C: Generate WebRTC token for this credential
    console.log(`[telnyx-token] Generating token for credential: ${credId}`);
    const tokenRes = await fetch(`https://api.telnyx.com/v2/telephony_credentials/${credId}/token`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error(`[telnyx-token] Token generation failed (${tokenRes.status}): ${errBody}`);
      
      // Fallback to SIP credentials
      console.log("[telnyx-token] Falling back to SIP credential auth");
      if (finalSettings.sip_username) {
        await supabaseClient
          .from("profiles")
          .update({ sip_username: finalSettings.sip_username, updated_at: new Date().toISOString() })
          .eq("id", user.id);
      }
      return new Response(
        JSON.stringify({
          sip_username: finalSettings.sip_username,
          sip_password: finalSettings.sip_password,
          connection_id: connectionId,
          auth_method: "credentials",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let token = await tokenRes.text();
    try {
      const json = JSON.parse(token);
      if (json.data) token = json.data;
    } catch { /* use raw string */ }

    // Inbound bridge picks WebRTC SIP target by profiles.updated_at when multiple agents
    // share an org — bump even if sip_username unchanged so "last opened dialer" wins.
    await supabaseClient
      .from("profiles")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", user.id);

    return new Response(
      JSON.stringify({
        token: token.trim(),
        sip_username: credSipUsername || credentialName,
        connection_id: connectionId,
        auth_method: "token",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[telnyx-token] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
