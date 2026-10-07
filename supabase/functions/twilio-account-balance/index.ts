import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleTwilioAccountBalance } from "./balance.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("[twilio-account-balance] missing required Supabase server configuration");
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return handleTwilioAccountBalance(req, {
    authClient,
    adminClient,
    masterAccountSid: Deno.env.get("TWILIO_MASTER_ACCOUNT_SID") ?? "",
    masterAuthToken: Deno.env.get("TWILIO_MASTER_AUTH_TOKEN") ?? "",
    logger: console,
  });
});
