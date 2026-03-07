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

type IntegrationShape = {
  id?: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  source: "table" | "preference";
};

const getIntegration = async (authClient: ReturnType<typeof createClient>, userId: string): Promise<IntegrationShape> => {
  const { data } = await authClient
    .from("calendar_integrations")
    .select("id, access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle();

  if (data) {
    return {
      id: data.id as string,
      access_token: data.access_token as string | null,
      refresh_token: data.refresh_token as string | null,
      token_expires_at: data.token_expires_at as string | null,
      source: "table",
    };
  }

  const { data: pref } = await authClient
    .from("user_preferences")
    .select("preference_value")
    .eq("user_id", userId)
    .eq("preference_key", "google_calendar_integration")
    .maybeSingle();

  const value = (pref?.preference_value && typeof pref.preference_value === "object" && !Array.isArray(pref.preference_value))
    ? pref.preference_value as Record<string, unknown>
    : {};

  return {
    access_token: typeof value.access_token === "string" ? value.access_token : null,
    refresh_token: typeof value.refresh_token === "string" ? value.refresh_token : null,
    token_expires_at: typeof value.token_expires_at === "string" ? value.token_expires_at : null,
    source: "preference",
  };
};

const persistTokens = async (
  authClient: ReturnType<typeof createClient>,
  userId: string,
  integration: IntegrationShape,
  accessToken: string,
  tokenExpiresAt: string,
) => {
  if (integration.source === "table" && integration.id) {
    await authClient
      .from("calendar_integrations")
      .update({ access_token: accessToken, token_expires_at: tokenExpiresAt })
      .eq("id", integration.id);
    return;
  }

  const { data: pref } = await authClient
    .from("user_preferences")
    .select("preference_value")
    .eq("user_id", userId)
    .eq("preference_key", "google_calendar_integration")
    .maybeSingle();

  const value = (pref?.preference_value && typeof pref.preference_value === "object" && !Array.isArray(pref.preference_value))
    ? pref.preference_value as Record<string, unknown>
    : {};

  await authClient
    .from("user_preferences")
    .upsert(
      {
        user_id: userId,
        preference_key: "google_calendar_integration",
        preference_value: { ...value, access_token: accessToken, token_expires_at: tokenExpiresAt },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,preference_key" },
    );
};

const refreshGoogleAccessToken = async (
  authClient: ReturnType<typeof createClient>,
  userId: string,
  integration: IntegrationShape,
) => {
  if (!integration.refresh_token) return integration.access_token;

  const expiresAt = integration.token_expires_at ? new Date(integration.token_expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return integration.access_token;

  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!googleClientId || !googleClientSecret) return integration.access_token;

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      refresh_token: integration.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });

  const refreshJson = await refreshRes.json();
  if (!refreshRes.ok || !refreshJson.access_token) return integration.access_token;

  const expiresIn = Number(refreshJson.expires_in ?? 3600);
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  await persistTokens(authClient, userId, integration, refreshJson.access_token as string, tokenExpiresAt);

  return refreshJson.access_token as string;
};

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

  const integration = await getIntegration(authClient, user.id);
  if (!integration.access_token) return json({ calendars: [] });

  const accessToken = await refreshGoogleAccessToken(authClient, user.id, integration);

  const listRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const listJson = await listRes.json();
  if (!listRes.ok) return json({ error: listJson.error?.message ?? "Failed to load calendars" }, 400);

  const calendars = (listJson.items ?? []).map((item: { id: string; summary?: string }) => ({
    id: String(item.id),
    summary: String(item.summary ?? item.id),
  }));

  return json({ calendars });
});
