// Telnyx token edge function — generates a WebRTC credential token via the Telnyx API
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
    const body = await req.json().catch(() => ({}));
    const connectionId = body.connection_id;

    // Resolve API key: env var first, then DB fallback
    let apiKey = Deno.env.get("TELNYX_API_KEY") || "";

    if (!apiKey) {
      const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );

      const { data: settings, error: fetchError } = await supabaseClient
        .from("telnyx_settings")
        .select("api_key")
        .eq("id", TELNYX_SETTINGS_ID)
        .maybeSingle();

      if (fetchError) throw fetchError;
      apiKey = settings?.api_key || "";
    }

    if (!apiKey) {
      throw new Error("Telnyx API key not configured. Set it in Settings → Telnyx & Phone Numbers.");
    }

    if (!connectionId) {
      throw new Error("connection_id is required in the request body.");
    }

    // Call Telnyx API to create a telephony credential (WebRTC token)
    const telnyxRes = await fetch("https://api.telnyx.com/v2/telephony_credentials", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ connection_id: connectionId }),
    });

    if (!telnyxRes.ok) {
      const errorBody = await telnyxRes.text();
      throw new Error(`Telnyx API error (${telnyxRes.status}): ${errorBody}`);
    }

    const telnyxData = await telnyxRes.json();
    const token = telnyxData?.data?.token;

    if (!token) {
      throw new Error("No token returned from Telnyx API. Check your Connection ID and API Key.");
    }

    return new Response(
      JSON.stringify({ token }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
