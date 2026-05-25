import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeToken, encodeToken, refreshGoogleAccessToken } from "../_shared/google-token.ts";

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

// Calendar Pass 3 (B3): use the shared refreshGoogleAccessToken + encodeToken/decodeToken
// so this function agrees with inbound-sync, sync-appointment, and oauth-callback on the
// token envelope (base64 with raw fallback). Previously this function had its own private
// refresh path that wrote raw tokens, which broke the next sync-appointment call.
const ensureFreshAccessToken = async (
  integration: GoogleIntegration,
  serviceClient: ReturnType<typeof createClient>,
): Promise<string | null> => {
  const accessToken = decodeToken(integration.access_token);
  const refreshToken = decodeToken(integration.refresh_token);
  const expiresAtMs = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  const isFresh = !!accessToken && !!expiresAtMs && expiresAtMs - Date.now() > 60_000;

  if (isFresh) return accessToken;
  if (!refreshToken) return accessToken;

  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!googleClientId || !googleClientSecret) return accessToken;

  const refreshed = await refreshGoogleAccessToken({
    refreshToken,
    clientId: googleClientId,
    clientSecret: googleClientSecret,
  });

  await serviceClient
    .from("calendar_integrations")
    .update({
      access_token: encodeToken(refreshed.accessToken),
      token_expires_at: refreshed.expiresAt,
    })
    .eq("id", integration.id);

  return refreshed.accessToken;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  // SELECT goes through the user-scoped client (RLS: auth.uid() = user_id). The token
  // refresh UPDATE uses service_role since the access_token column is sensitive — keeping
  // that off the user JWT path avoids any future RLS shape change surprising us.
  const { data: integration, error } = await authClient
    .from("calendar_integrations")
    .select("id, access_token, refresh_token, token_expires_at")
    .eq("user_id", user.id)
    .eq("provider", "google")
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!integration?.access_token) return json({ calendars: [] });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  let accessToken: string | null;
  try {
    accessToken = await ensureFreshAccessToken(integration as GoogleIntegration, serviceClient);
  } catch (refreshError) {
    return json(
      { error: refreshError instanceof Error ? refreshError.message : "Failed to refresh Google token" },
      400,
    );
  }

  if (!accessToken) return json({ error: "Google access token is missing or invalid" }, 400);

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
