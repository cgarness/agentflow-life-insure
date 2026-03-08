import "jsr:@supabase/functions-js/edge-runtime.d.ts";
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

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: config, error: fetchError } = await supabaseClient
      .from("phone_settings")
      .select("account_sid, auth_token")
      .eq("id", SINGLETON_ID)
      .maybeSingle();

    if (fetchError) throw fetchError;

    // Fallback to env vars if database is empty
    const sipUsername = config?.account_sid || Deno.env.get("TELNYX_SIP_USERNAME");
    const sipPassword = config?.auth_token || Deno.env.get("TELNYX_SIP_PASSWORD");

    if (!sipUsername || !sipPassword) {
      throw new Error("SIP credentials are not configured in Settings or Environment");
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
