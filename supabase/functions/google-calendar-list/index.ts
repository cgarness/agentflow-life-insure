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

type GoogleIntegration = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

const refreshGoogleAccessToken = async (integration: GoogleIntegration) => {
  if (!integration?.refresh_token) return integration?.access_token;

  const expiresAt = integration?.token_expires_at ? new Date(integration.token_expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return integration.access_token;

  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  await adminClient
    .from("calendar_integrations")
    .update({ access_token: refreshJson.access_token, token_expires_at: tokenExpiresAt })
    .eq("id", integration.id);

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

  const { data: integration, error } = await authClient
    .from("calendar_integrations")
    .select("id, access_token, refresh_token, token_expires_at")
    .eq("user_id", user.id)
    .eq("provider", "google")
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!integration?.access_token) return json({ calendars: [] });

  const accessToken = await refreshGoogleAccessToken(integration);

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
