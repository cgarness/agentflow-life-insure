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

  let accessToken: string | null = null;
  const { data: integration } = await authClient
    .from("calendar_integrations")
    .select("access_token")
    .eq("user_id", user.id)
    .eq("provider", "google")
    .maybeSingle();

  accessToken = integration?.access_token ?? null;

  if (!accessToken) {
    const { data: pref } = await authClient
      .from("user_preferences")
      .select("preference_value")
      .eq("user_id", user.id)
      .eq("preference_key", "google_calendar_integration")
      .maybeSingle();

    const value = (pref?.preference_value && typeof pref.preference_value === "object" && !Array.isArray(pref.preference_value))
      ? pref.preference_value as Record<string, unknown>
      : {};

    accessToken = typeof value.access_token === "string" ? value.access_token : null;
  }

  if (accessToken) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: accessToken }).toString(),
    });
  }

  await authClient
    .from("calendar_integrations")
    .update({
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      sync_enabled: false,
      calendar_id: "primary",
      oauth_state: null,
      oauth_state_expires_at: null,
    })
    .eq("user_id", user.id)
    .eq("provider", "google");

  await authClient
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        preference_key: "google_calendar_integration",
        preference_value: {
          access_token: null,
          refresh_token: null,
          token_expires_at: null,
          sync_enabled: false,
          calendar_id: "primary",
          sync_mode: "outbound_only",
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,preference_key" },
    );

  return json({ disconnected: true });
});
