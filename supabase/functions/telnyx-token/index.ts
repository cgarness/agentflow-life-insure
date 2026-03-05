import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
    const apiKey = Deno.env.get("TELNYX_API_KEY");
    if (!apiKey) {
      throw new Error("TELNYX_API_KEY is not configured");
    }

    const connectionId = Deno.env.get("TELNYX_SIP_CONNECTION_ID");
    if (!connectionId) {
      throw new Error("TELNYX_SIP_CONNECTION_ID is not configured");
    }

    const response = await fetch(
      "https://api.telnyx.com/v2/telephony_credentials",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ connection_id: connectionId }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Telnyx API returned ${response.status}: ${errorBody}`
      );
    }

    const data = await response.json();
    const token = data.data?.token ?? data.data?.id;

    return new Response(JSON.stringify({ token }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message ?? "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
