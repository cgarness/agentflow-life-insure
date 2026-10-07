import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleTwilioAccountBalance } from "./balance.ts";

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("[twilio-account-balance] missing required Supabase server configuration");
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Content-Type": "application/json",
      },
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
