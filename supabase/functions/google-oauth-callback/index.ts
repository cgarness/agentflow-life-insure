import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const redirectWithParams = (baseUrl: string, params: Record<string, string>) => {
  const url = new URL("/settings", baseUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return Response.redirect(url.toString(), 302);
};

const fromBase64Url = (input: string) => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const base64 = pad ? normalized + "=".repeat(4 - pad) : normalized;
  return atob(base64);
};

const verifyStateAndGetUserId = async (state: string, secret: string): Promise<string | null> => {
  const [payloadB64, sigB64] = state.split(".");
  if (!payloadB64 || !sigB64) return null;

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signatureBytes = Uint8Array.from(fromBase64Url(sigB64), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(payloadB64));
  if (!valid) return null;

  const payload = JSON.parse(fromBase64Url(payloadB64)) as { u?: string; t?: number };
  if (!payload.u || !payload.t) return null;

  if (Date.now() - payload.t > 15 * 60 * 1000) return null;
  return payload.u;
};

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    const appBaseUrl = Deno.env.get("APP_BASE_URL") ?? "http://localhost:5173";
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
    const oauthStateSecret = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET") || googleClientSecret || "dev-google-state-secret";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!googleClientId || !googleClientSecret || !redirectUri) {
      return redirectWithParams(appBaseUrl, { section: "calendar-settings", google_error: "oauth_config_missing" });
    }

    if (oauthError) {
      return redirectWithParams(appBaseUrl, { section: "calendar-settings", google_error: oauthError });
    }

    if (!code || !state) {
      return redirectWithParams(appBaseUrl, { section: "calendar-settings", google_error: "missing_code_or_state" });
    }

    const userId = await verifyStateAndGetUserId(state, oauthStateSecret);
    if (!userId) {
      return redirectWithParams(appBaseUrl, { section: "calendar-settings", google_error: "invalid_or_expired_state" });
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      return redirectWithParams(appBaseUrl, {
        section: "calendar-settings",
        google_error: tokenJson.error_description ?? tokenJson.error ?? "token_exchange_failed",
      });
    }

    const expiresIn = Number(tokenJson.expires_in ?? 3600);
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const integrationRecord = {
      user_id: userId,
      provider: "google",
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token,
      token_expires_at: tokenExpiresAt,
      sync_enabled: true,
      oauth_state: null,
      oauth_state_expires_at: null,
    };

    const { error: tableError } = await adminClient
      .from("calendar_integrations")
      .upsert(integrationRecord, { onConflict: "user_id,provider" });

    if (tableError) {
      const { error: prefError } = await adminClient.from("user_preferences").upsert(
        {
          user_id: userId,
          preference_key: "google_calendar_integration",
          preference_value: {
            access_token: tokenJson.access_token,
            refresh_token: tokenJson.refresh_token,
            token_expires_at: tokenExpiresAt,
            sync_enabled: true,
            calendar_id: "primary",
            sync_mode: "outbound_only",
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,preference_key" },
      );

      if (prefError) {
        return redirectWithParams(appBaseUrl, { section: "calendar-settings", google_error: "save_failed" });
      }
    }

    return redirectWithParams(appBaseUrl, { section: "calendar-settings", google_connected: "1" });
  } catch {
    const appBaseUrl = Deno.env.get("APP_BASE_URL") ?? "http://localhost:5173";
    return redirectWithParams(appBaseUrl, { section: "calendar-settings", google_error: "callback_failed" });
  }
});
