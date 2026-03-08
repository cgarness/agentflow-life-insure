// Telnyx token edge function — serves SIP credentials for WebRTC dialer
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

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

    // Read SIP credentials from the phone_settings table
    // account_sid = SIP username, auth_token = SIP password (set by telnyx-buy-number)
    const { data: config, error: fetchError } = await supabaseClient
      .from("phone_settings")
      .select("account_sid, auth_token")
      .eq("id", SINGLETON_ID)
      .maybeSingle();

    if (fetchError) throw fetchError;

    const sipUsername = config?.account_sid;
    const sipPassword = config?.auth_token;

    if (!sipUsername || !sipPassword) {
      throw new Error("SIP credentials not found. Please buy a phone number first — it will auto-configure SIP.");
    }

    return new Response(
      JSON.stringify({
        username: sipUsername,
        password: sipPassword
      }),
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
