import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const redirectWithParams = (baseUrl: string, params: Record<string, string>) => {
  const url = new URL("/settings", baseUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return Response.redirect(url.toString(), 302);
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!googleClientId || !googleClientSecret || !redirectUri) {
      return redirectWithParams(appBaseUrl, {
        section: "calendar-settings",
        google_error: "oauth_config_missing",
      });
    }

    if (oauthError) {
      return redirectWithParams(appBaseUrl, {
        section: "calendar-settings",
        google_error: oauthError,
      });
    }

    if (!code || !state) {
      return redirectWithParams(appBaseUrl, {
        section: "calendar-settings",
        google_error: "missing_code_or_state",
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: integration, error: integrationError } = await adminClient
      .from("calendar_integrations")
      .select("id, user_id, oauth_state_expires_at")
      .eq("provider", "google")
      .eq("oauth_state", state)
      .maybeSingle();

    if (integrationError || !integration) {
      return redirectWithParams(appBaseUrl, {
        section: "calendar-settings",
        google_error: "invalid_state",
      });
    }

    if (integration.oauth_state_expires_at && new Date(integration.oauth_state_expires_at).getTime() < Date.now()) {
      return redirectWithParams(appBaseUrl, {
        section: "calendar-settings",
        google_error: "state_expired",
      });
    }

    const tokenBody = new URLSearchParams({
      code,
      client_id: googleClientId,
      client_secret: googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
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

    const { error: updateError } = await adminClient
      .from("calendar_integrations")
      .update({
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token,
        token_expires_at: tokenExpiresAt,
        sync_enabled: true,
        oauth_state: null,
        oauth_state_expires_at: null,
      })
      .eq("id", integration.id)
      .eq("user_id", integration.user_id);

    if (updateError) {
      return redirectWithParams(appBaseUrl, {
        section: "calendar-settings",
        google_error: "save_failed",
      });
    }

    return redirectWithParams(appBaseUrl, {
      section: "calendar-settings",
      google_connected: "1",
    });
  } catch {
    const appBaseUrl = Deno.env.get("APP_BASE_URL") ?? "http://localhost:5173";
    return redirectWithParams(appBaseUrl, {
      section: "calendar-settings",
      google_error: "callback_failed",
    });
  }
});
