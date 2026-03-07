import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const decodeBase64 = (value: string) => {
  try {
    return atob(value);
  } catch {
    return null;
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const googleRedirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");

    if (!supabaseUrl || !supabaseAnonKey) {
      return json({ error: "SUPABASE_URL or SUPABASE_ANON_KEY is not configured" }, 500);
    }

    if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
      return json(
        { error: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URI is not configured" },
        500,
      );
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const providerError = url.searchParams.get("error");
    const providerErrorDescription = url.searchParams.get("error_description");

    if (providerError) {
      return json(
        {
          error: `Google authorization failed: ${providerError}`,
          details: providerErrorDescription,
          provider: "google",
        },
        400,
      );
    }

    if (!code || !state) {
      return json({ error: "Missing required code or state query parameters", provider: "google" }, 400);
    }

    const decodedState = decodeBase64(state);
    if (!decodedState) {
      return json({ error: "Invalid state parameter", provider: "google" }, 400);
    }

    let statePayload: { accessToken?: string; userId?: string; provider?: string };
    try {
      statePayload = JSON.parse(decodedState);
    } catch {
      return json({ error: "Invalid state payload", provider: "google" }, 400);
    }

    if (statePayload.provider !== "google" || !statePayload.accessToken || !statePayload.userId) {
      return json({ error: "Malformed state payload", provider: "google" }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${statePayload.accessToken}`,
        },
      },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Unable to verify user from OAuth state", provider: "google" }, 401);
    }

    if (userData.user.id !== statePayload.userId) {
      return json({ error: "State user does not match authenticated user", provider: "google" }, 401);
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: googleRedirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenPayload = await tokenResponse.json();

    if (!tokenResponse.ok) {
      const googleError = tokenPayload?.error ?? "token_exchange_failed";
      const googleDescription = tokenPayload?.error_description ?? "Unable to exchange Google authorization code";
      const isGrantError = googleError === "invalid_grant";

      return json(
        {
          error: isGrantError
            ? "Google grant is invalid or expired. Please reconnect your Google Calendar integration."
            : `Google token exchange failed: ${googleError}`,
          details: googleDescription,
          provider: "google",
        },
        isGrantError ? 400 : 502,
      );
    }

    const accessToken = tokenPayload.access_token as string | undefined;
    const refreshToken = tokenPayload.refresh_token as string | undefined;
    const expiresIn = tokenPayload.expires_in as number | undefined;

    if (!accessToken || !expiresIn) {
      return json(
        {
          error: "Google token response did not include access token expiry metadata",
          provider: "google",
        },
        502,
      );
    }

    const { data: existingIntegration } = await supabase
      .from("calendar_integrations")
      .select("refresh_token")
      .eq("user_id", userData.user.id)
      .eq("provider", "google")
      .maybeSingle();

    const effectiveRefreshToken = refreshToken
      ? btoa(refreshToken)
      : existingIntegration?.refresh_token ?? null;

    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const { error: upsertError } = await supabase.from("calendar_integrations").upsert(
      {
        user_id: userData.user.id,
        provider: "google",
        calendar_id: "primary",
        sync_mode: "two_way",
        sync_enabled: true,
        access_token: btoa(accessToken),
        refresh_token: effectiveRefreshToken,
        token_expires_at: tokenExpiresAt,
      },
      { onConflict: "user_id,provider" },
    );

    if (upsertError) {
      return json(
        {
          error: "Failed to persist Google calendar integration",
          details: upsertError.message,
          provider: "google",
        },
        500,
      );
    }

    return json({
      success: true,
      provider: "google",
      message: "Google Calendar connected successfully",
      token_expires_at: tokenExpiresAt,
    });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
        provider: "google",
      },
      500,
    );
  }
});
