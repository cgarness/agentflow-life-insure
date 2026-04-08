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
    const { to, body, lead_id } = await req.json();
    if (!to || !body) {
      return new Response(JSON.stringify({ success: false, error: "Missing required fields: to, body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get the user from the auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("No authorization header");
    
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !user) throw new Error("Invalid user token");

    // Get the user's organization_id from their profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.organization_id) {
      throw new Error("User has no associated organization");
    }

    const organizationId = profile.organization_id;

    // Read Telnyx settings (api_key, connection_id as optional messaging_profile_id)
    const { data: settings, error: settingsError } = await supabase
      .from("telnyx_settings")
      .select("api_key, connection_id")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (settingsError) throw new Error(`DB error fetching settings: ${settingsError.message}`);

    // Fallback to global settings if no organization-specific settings exist
    let finalSettings = settings;
    if (!finalSettings) {
      const { data: globalSettings } = await supabase
        .from("telnyx_settings")
        .select("api_key, connection_id")
        .eq("id", TELNYX_SETTINGS_ID)
        .maybeSingle();
      finalSettings = globalSettings;
    }

    // API key: prefer env var, fall back to DB
    const apiKey = Deno.env.get("TELNYX_API_KEY") || finalSettings?.api_key;
    if (!apiKey) throw new Error("No Telnyx API key configured.");

    // Sender number: read from phone_numbers table (first active number)
    // telnyx_settings has no phone_number column; purchased numbers live in phone_numbers
    const { data: phoneRow, error: phoneError } = await supabase
      .from("phone_numbers")
      .select("phone_number")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (phoneError) throw new Error(`DB error fetching phone number: ${phoneError.message}`);
    if (!phoneRow?.phone_number) throw new Error("No active phone number found. Purchase a number first.");

    const senderNumber = phoneRow.phone_number;

    // Build Telnyx Messages API payload
    const telnyxPayload: Record<string, string> = {
      from: senderNumber,
      to,
      text: body,
    };
    if (settings?.connection_id) {
      telnyxPayload.messaging_profile_id = settings.connection_id;
    }

    // Call Telnyx Messages API
    const telnyxRes = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(telnyxPayload),
    });

    const telnyxData = await telnyxRes.json();

    if (!telnyxRes.ok) {
      const errMsg = telnyxData?.errors?.[0]?.detail || telnyxData?.error || "Telnyx API error";
      return new Response(JSON.stringify({ success: false, error: errMsg }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const telnyxMessageId = telnyxData?.data?.id ?? null;

    // Insert into messages table using service role key
    const messageRow: Record<string, unknown> = {
      direction: "outbound",
      body,
      from_number: senderNumber,
      to_number: to,
      status: "sent",
      telnyx_message_id: telnyxMessageId,
    };
    if (lead_id) messageRow.lead_id = lead_id;

    const { data: inserted, error: insertError } = await supabase
      .from("messages")
      .insert(messageRow)
      .select("id")
      .single();

    if (insertError) throw new Error(`DB error inserting message: ${insertError.message}`);

    return new Response(
      JSON.stringify({ success: true, message_id: inserted.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
