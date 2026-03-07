import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data, error } = await authClient
    .from("calendar_integrations")
    .select("calendar_id, sync_mode, sync_enabled, access_token")
    .eq("user_id", user.id)
    .eq("provider", "google")
    .maybeSingle();

  if (!error) {
    return json({
      connected: !!data?.access_token,
      calendarId: data?.calendar_id ?? "",
      syncMode: data?.sync_mode === "two_way" ? "two_way" : "outbound_only",
      syncEnabled: !!data?.sync_enabled,
    });
  }

  // Fallback for environments that haven't run calendar_integrations migration yet.
  const { data: pref, error: prefError } = await authClient
    .from("user_preferences")
    .select("preference_value")
    .eq("user_id", user.id)
    .eq("preference_key", "google_calendar_integration")
    .maybeSingle();

  if (prefError) return json({ error: prefError.message }, 500);

  const value = (pref?.preference_value && typeof pref.preference_value === "object" && !Array.isArray(pref.preference_value))
    ? pref.preference_value as Record<string, unknown>
    : {};

  return json({
    connected: !!value.access_token,
    calendarId: typeof value.calendar_id === "string" ? value.calendar_id : "",
    syncMode: value.sync_mode === "two_way" ? "two_way" : "outbound_only",
    syncEnabled: !!value.sync_enabled,
    warning: "using_user_preferences_fallback",
  });
});
