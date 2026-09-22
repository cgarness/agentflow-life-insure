import { ownedCalendarIntegration } from "../_shared/google-oauth.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeToken, encodeToken, refreshGoogleAccessToken, tokenContext, GoogleOAuthError } from "../_shared/google-token.ts";

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
  user_id: string;
  connection_generation: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

// All token consumers use the same authenticated envelope.
const ensureFreshAccessToken = async (
  integration: GoogleIntegration,
  serviceClient: SupabaseClient,
): Promise<string | null> => {
  const accessToken = await decodeToken(integration.access_token, tokenContext("calendar", integration.user_id, "access"));
  const refreshToken = await decodeToken(integration.refresh_token, tokenContext("calendar", integration.user_id, "refresh"));
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

  const { data: updated, error: updateError } = await serviceClient
    .from("calendar_integrations")
    .update({
      access_token: await encodeToken(refreshed.accessToken, tokenContext("calendar", integration.user_id, "access")),
      token_expires_at: refreshed.expiresAt,
    })
    .eq("id", integration.id).eq("connection_generation", integration.connection_generation).eq("sync_enabled", true).select("id").maybeSingle();
  if (updateError || !updated) throw new Error("Google Calendar connection changed. Try again.");

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

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  let integration;
  try { integration = await ownedCalendarIntegration(serviceClient, user.id); }
  catch { return json({ error: "Unable to load Google Calendar connection" }, 409); }
  if (!integration?.access_token || !integration.sync_enabled) return json({ calendars: [] });

  let accessToken: string | null;
  try {
    accessToken = await ensureFreshAccessToken(integration as GoogleIntegration, serviceClient);
  } catch (refreshError) {
    if (refreshError instanceof GoogleOAuthError && refreshError.code === "invalid_grant") {
      await serviceClient.from("calendar_integrations").update({ access_token: null, refresh_token: null, sync_enabled: false, connection_generation: crypto.randomUUID() })
        .eq("id", integration.id).eq("connection_generation", integration.connection_generation);
    }
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
  if (!listRes.ok) {
    const permissionsChanged = listRes.status === 403 && (listJson.error?.errors ?? []).some((e: { reason?: string }) => e.reason === "insufficientPermissions" || e.reason === "forbidden");
    if (listRes.status === 401 || permissionsChanged) {
      await serviceClient.from("calendar_integrations").update({ access_token: null, refresh_token: null, sync_enabled: false, connection_generation: crypto.randomUUID() })
        .eq("id", integration.id).eq("connection_generation", integration.connection_generation);
      return json({ error: "Google access changed. Reconnect Google Calendar." }, 400);
    }
    return json({ error: "Google Calendar is temporarily unavailable. Please try again." }, 503);
  }

  const calendars = (listJson.items ?? []).map((item: { id: string; summary?: string }) => ({
    id: String(item.id),
    summary: String(item.summary ?? item.id),
  }));

  return json({ calendars });
});
