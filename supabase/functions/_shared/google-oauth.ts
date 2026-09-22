import { encodeToken, decodeToken, tokenContext } from "./google-token.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
export type GoogleIntegrationKind = "email" | "calendar";
export const GMAIL_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"];
export const CALENDAR_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"];

export function settingsRedirect(kind: GoogleIntegrationKind, candidate?: unknown): string {
  const canonical = "https://www.fflagent.com";
  const configured = Deno.env.get("GOOGLE_OAUTH_APP_ORIGIN") || canonical;
  const origin = new URL(configured);
  const isLocal = ["localhost", "127.0.0.1"].includes(origin.hostname) && Deno.env.get("GOOGLE_OAUTH_ALLOW_LOCAL") === "true";
  if (origin.origin !== canonical && !isLocal) throw new Error("Invalid Google OAuth application origin");
  const target = new URL("/settings", origin.origin);
  target.searchParams.set("section", kind === "email" ? "email-settings" : "calendar-settings");
  if (candidate !== undefined && candidate !== null) {
    if (typeof candidate !== "string") throw new Error("Invalid return destination");
    const parsed = new URL(candidate);
    if (parsed.origin !== origin.origin || parsed.pathname !== "/settings" || parsed.username || parsed.password) throw new Error("Invalid return destination");
  }
  return target.toString(); // Caller query strings and fragments are discarded.
}
export function redirectGoogle(kind: GoogleIntegrationKind, params: Record<string, string>): Response {
  const url = new URL(settingsRedirect(kind));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return Response.redirect(url, 302);
}
export function hasGoogleScopes(scope: unknown, kind: GoogleIntegrationKind): boolean {
  const granted = new Set(typeof scope === "string" ? scope.split(/\s+/) : []);
  const prefix = "https://www.googleapis.com/auth/";
  return kind === "email"
    ? granted.has(`${prefix}gmail.send`) && granted.has(`${prefix}gmail.readonly`)
    : granted.has(`${prefix}calendar`) || (granted.has(`${prefix}calendar.events`) && granted.has(`${prefix}calendar.calendarlist.readonly`));
}
export async function exchangeGoogleCode(code: string, kind: GoogleIntegrationKind) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const secret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const redirect = Deno.env.get(kind === "email" ? "EMAIL_GOOGLE_CALLBACK_URL" : "GOOGLE_REDIRECT_URI");
  if (!clientId || !secret || !redirect) throw new Error("oauth_config_missing");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  const token = await res.json();
  if (!res.ok) throw new Error("token_exchange_failed");
  if (!hasGoogleScopes(token.scope, kind)) throw new Error("required_permissions_missing");
  if (typeof token.access_token !== "string" || !token.access_token || !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in) <= 0) throw new Error("invalid_token_response");
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } });
  const profile = await profileRes.json();
  if (!profileRes.ok || typeof profile.id !== "string" || !profile.id || typeof profile.email !== "string" || !profile.email || profile.verified_email !== true) throw new Error("google_account_not_verified");
  return {
    accessToken: token.access_token as string,
    refreshToken: typeof token.refresh_token === "string" && token.refresh_token ? token.refresh_token : null,
    expiresAt: new Date(Date.now() + Number(token.expires_in) * 1000).toISOString(),
    accountId: profile.id as string, accountEmail: profile.email.toLowerCase() as string,
    accountName: typeof profile.name === "string" ? profile.name : null, scope: token.scope as string,
  };
}
export async function claimGoogleState(admin: SupabaseClient, state: string, kind: GoogleIntegrationKind) {
  const { data, error } = await admin.from("email_oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("state", state).eq("provider", "google").eq("integration_kind", kind)
    .is("used_at", null).gt("expires_at", new Date().toISOString())
    .select("id, user_id, organization_id, redirect_to").maybeSingle();
  if (error || !data) throw new Error("invalid_or_expired_state");
  settingsRedirect(kind, data.redirect_to);
  return data;
}
export const safeOAuthError = (error: unknown): string => {
  const safe = ["oauth_config_missing", "token_exchange_failed", "required_permissions_missing", "invalid_token_response", "google_account_not_verified", "invalid_or_expired_state", "offline_access_required", "connection_changed", "organization_changed", "deletion_in_progress", "account_unavailable"];
  return error instanceof Error && safe.includes(error.message) ? error.message : "connection_failed";
};
export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
    // An invalid token does not prove that every remaining Google grant was revoked.
    // Be conservative and direct the owner to Google's controls unless confirmed.
    return res.ok;
  } catch { return false; }
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const serviceClient = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

export async function startGoogleOAuth(req: Request, kind: GoogleIntegrationKind): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);
    const admin = serviceClient();
    const { data: { user }, error } = await admin.auth.getUser(jwt);
    if (error || !user) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    if (kind === "email" && body.provider && body.provider !== "google") return json({ error: "Only Gmail is currently supported" }, 400);
    let redirect: string;
    try { redirect = settingsRedirect(kind, body.redirect_to); } catch { return json({ error: "Invalid return destination" }, 400); }
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const callback = Deno.env.get(kind === "email" ? "EMAIL_GOOGLE_CALLBACK_URL" : "GOOGLE_REDIRECT_URI");
    if (!clientId || !callback) return json({ error: "Google connection is not configured" }, 503);
    const state = crypto.randomUUID();
    const { error: stateError } = await admin.rpc("begin_google_oauth", { p_user_id: user.id, p_kind: kind, p_state: state, p_redirect: redirect });
    if (stateError) return json({ error: "Unable to start Google connection" }, 409);
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true", scope: (kind === "email" ? GMAIL_SCOPES : CALENDAR_SCOPES).join(" "), state });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    return json(kind === "email" ? { success: true, auth_url: authUrl } : { authUrl });
  } catch { return json({ error: "Unable to start Google connection" }, 500); }
}

export async function finishGoogleOAuth(req: Request, kind: GoogleIntegrationKind): Promise<Response> {
  const errorKey = kind === "email" ? "email_error" : "google_error";
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  try {
    const url = new URL(req.url);
    const state = url.searchParams.get("state");
    if (!state) throw new Error("invalid_or_expired_state");
    const admin = serviceClient();
    const claimed = await claimGoogleState(admin, state, kind);
    if (url.searchParams.has("error")) return redirectGoogle(kind, { [errorKey]: "consent_denied" });
    const code = url.searchParams.get("code");
    if (!code) throw new Error("invalid_or_expired_state");
    const token = await exchangeGoogleCode(code, kind);
    const { data: connectionId, error } = await admin.rpc("complete_google_oauth", {
      p_state_id: claimed.id, p_account_id: token.accountId, p_email: token.accountEmail,
      p_name: token.accountName, p_access: await encodeToken(token.accessToken, tokenContext(kind, claimed.user_id, "access")),
      p_refresh: await encodeToken(token.refreshToken, tokenContext(kind, claimed.user_id, "refresh")), p_expires: token.expiresAt, p_scope: token.scope,
    });
    if (error) throw new Error(error.message);
    // Audit metadata only. Logging failure never undoes a completed connection.
    try { await admin.from("activity_logs").insert({ action: kind === "email" ? "Gmail connected" : "Google Calendar connected", category: "settings", organization_id: claimed.organization_id, user_id: claimed.user_id, metadata: { provider: "google", connection_id: connectionId } }); } catch { /* Connection already saved; no secret-bearing exception logging. */ }
    return redirectGoogle(kind, kind === "email" ? { email_connected: "1", email_provider: "google" } : { google_connected: "1" });
  } catch (error) {
    try { return redirectGoogle(kind, { [errorKey]: safeOAuthError(error) }); }
    catch { return new Response("Google connection configuration is unavailable", { status: 503 }); }
  }
}

export async function disconnectGoogleOAuth(req: Request, kind: GoogleIntegrationKind): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  try {
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
    if (!jwt) return json({ success: false, error: "Unauthorized" }, 401);
    const admin = serviceClient();
    const { data: { user }, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !user) return json({ success: false, error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const removeAll = body.remove_all_google_access === true;
    if (kind === "email" && !removeAll && (typeof body.connection_id !== "string" || !/^[a-f0-9-]{36}$/i.test(body.connection_id))) return json({ success: false, error: "A valid connection is required" }, 400);
    const { data, error } = await admin.rpc("disconnect_google_oauth", { p_user_id: user.id, p_kind: removeAll ? "all" : kind, p_connection_id: removeAll || kind === "calendar" ? null : body.connection_id });
    if (error) return json({ success: false, error: "Connection not found or could not be disconnected" }, 409);
    let revoked = true;
    let attempted = 0;
    if (removeAll) {
      for (const credential of data ?? []) {
        if (!credential.access && !credential.refresh) continue;
        attempted += 1;
        try {
          const token = credential.refresh
            ? await decodeToken(credential.refresh, tokenContext(credential.kind, user.id, "refresh"))
            : await decodeToken(credential.access, tokenContext(credential.kind, user.id, "access"));
          if (token && !await revokeGoogleToken(token)) revoked = false;
        } catch { revoked = false; }
      }
    }
    revoked = revoked && attempted > 0;
    return json({ success: true, disconnected: true, removed_all: removeAll, google_access_revoked: removeAll ? revoked : false,
      ...(removeAll && !revoked ? { warning: "Connections stopped locally. Remove AgentFlow access in your Google Account to finish revocation." } : {}) });
  } catch { return json({ success: false, error: "Unable to disconnect Google" }, 500); }
}

export async function ownedCalendarIntegration(admin: SupabaseClient, userId: string) {
  const { data: profile, error: profileError } = await admin.from("profiles").select("organization_id").eq("id", userId).maybeSingle();
  if (profileError || !profile?.organization_id) throw new Error("organization_changed");
  const { data, error } = await admin.from("calendar_integrations")
    .select("id, user_id, organization_id, calendar_id, sync_mode, sync_enabled, access_token, refresh_token, token_expires_at, connection_generation")
    .eq("user_id", userId).eq("organization_id", profile.organization_id).eq("provider", "google").maybeSingle();
  if (error) throw new Error("Unable to load Google Calendar connection");
  return data;
}
