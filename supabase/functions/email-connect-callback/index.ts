import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeToken } from "../_shared/google-token.ts";

function redirectWithParams(baseUrl: string, params: Record<string, string>) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return Response.redirect(url.toString(), 302);
}

async function exchangeGoogleCode(code: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const redirectUri = Deno.env.get("EMAIL_GOOGLE_CALLBACK_URL");
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Google OAuth env vars missing");

  const tokenBody = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokenJson.error_description ?? tokenJson.error ?? "Google token exchange failed");

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const profileJson = await profileRes.json();
  if (!profileRes.ok) throw new Error(profileJson.error?.message ?? "Failed to fetch Google profile");

  return {
    accessToken: tokenJson.access_token as string,
    refreshToken: (tokenJson.refresh_token as string | undefined) ?? null,
    expiresIn: Number(tokenJson.expires_in ?? 3600),
    accountEmail: (profileJson.email as string) ?? "",
    accountName: (profileJson.name as string) ?? null,
    scope: (tokenJson.scope as string | undefined) ?? null,
  };
}

async function exchangeMicrosoftCode(code: string) {
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");
  const redirectUri = Deno.env.get("EMAIL_MICROSOFT_CALLBACK_URL");
  const tenantId = Deno.env.get("MICROSOFT_TENANT_ID") || "common";
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Microsoft OAuth env vars missing");

  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: "openid profile email offline_access Mail.Read Mail.Send User.Read",
  });
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokenJson.error_description ?? tokenJson.error ?? "Microsoft token exchange failed");

  const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const profileJson = await profileRes.json();
  if (!profileRes.ok) throw new Error(profileJson.error?.message ?? "Failed to fetch Microsoft profile");

  return {
    accessToken: tokenJson.access_token as string,
    refreshToken: (tokenJson.refresh_token as string | undefined) ?? null,
    expiresIn: Number(tokenJson.expires_in ?? 3600),
    accountEmail: (profileJson.mail as string) || (profileJson.userPrincipalName as string) || "",
    accountName: (profileJson.displayName as string) ?? null,
    scope: (tokenJson.scope as string | undefined) ?? null,
  };
}

Deno.serve(async (req) => {
  const appBaseUrl = Deno.env.get("APP_BASE_URL") ?? "http://localhost:5173";
  const defaultRedirect = `${appBaseUrl}/settings?section=email-settings`;

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    if (oauthError) return redirectWithParams(defaultRedirect, { email_error: oauthError });
    if (!code || !state) return redirectWithParams(defaultRedirect, { email_error: "missing_code_or_state" });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: stateRow, error: stateError } = await admin
      .from("email_oauth_states")
      .select("id, user_id, organization_id, provider, expires_at, used_at, redirect_to")
      .eq("state", state)
      .maybeSingle();
    if (stateError || !stateRow) return redirectWithParams(defaultRedirect, { email_error: "invalid_state" });
    if (stateRow.used_at) return redirectWithParams(defaultRedirect, { email_error: "state_already_used" });
    if (new Date(stateRow.expires_at).getTime() < Date.now()) {
      return redirectWithParams(defaultRedirect, { email_error: "state_expired" });
    }

    const provider = stateRow.provider as "google" | "microsoft";
    const tokenPack = provider === "google" ? await exchangeGoogleCode(code) : await exchangeMicrosoftCode(code);
    if (!tokenPack.accountEmail) {
      return redirectWithParams(defaultRedirect, { email_error: "provider_email_missing" });
    }

    const tokenExpiresAt = new Date(Date.now() + tokenPack.expiresIn * 1000).toISOString();
    const { error: upsertError } = await admin.from("user_email_connections").upsert(
      {
        organization_id: stateRow.organization_id,
        user_id: stateRow.user_id,
        provider,
        provider_account_email: tokenPack.accountEmail,
        provider_account_name: tokenPack.accountName,
        access_token_encrypted: encodeToken(tokenPack.accessToken),
        refresh_token_encrypted: encodeToken(tokenPack.refreshToken),
        access_token_expires_at: tokenExpiresAt,
        scope: tokenPack.scope,
        status: "connected",
        last_error: null,
      },
      { onConflict: "user_id,provider" }
    );
    if (upsertError) return redirectWithParams(defaultRedirect, { email_error: "save_failed" });

    await admin.from("email_oauth_states").update({ used_at: new Date().toISOString() }).eq("id", stateRow.id);
    return redirectWithParams(stateRow.redirect_to || defaultRedirect, { email_connected: "1", email_provider: provider });
  } catch (err) {
    return redirectWithParams(defaultRedirect, {
      email_error: err instanceof Error ? err.message.slice(0, 120) : "callback_failed",
    });
  }
});

