// Google OAuth for the dedicated "AgentFlow Sheets" client: auth URL (PKCE S256, no incremental scopes),
// code exchange, identity and scope validation, refresh, and actual-token scope inspection.
import { DRIVE_FILE_SCOPE, SHEETS_SCOPES, type SheetsConfig } from "./config.ts";
import { classifyGoogleError, GoogleApiError } from "./errors.ts";

type FetchFn = typeof fetch;

const EMAIL_ALIASES = new Set(["email", "https://www.googleapis.com/auth/userinfo.email"]);
const ALLOWED = new Set(["openid", "email", DRIVE_FILE_SCOPE]);

export function buildAuthUrl(cfg: SheetsConfig, state: string, challenge: string, loginHint?: string | null): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SHEETS_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

/** Normalises recognised equivalent names ("email" ≡ ".../userinfo.email") to canonical scope names. */
export function normalizeScopes(scope: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const s of (scope ?? "").split(/\s+/).filter(Boolean)) out.add(EMAIL_ALIASES.has(s) ? "email" : s);
  return [...out].sort();
}

/** drive.file must be granted; anything broader than {openid, email, drive.file} is rejected. */
export function checkScopes(scopes: string[]): { ok: true } | { ok: false; reason: "missing_drive_file" | "excess_scope" } {
  if (!scopes.includes(DRIVE_FILE_SCOPE)) return { ok: false, reason: "missing_drive_file" };
  if (scopes.some((s) => !ALLOWED.has(s))) return { ok: false, reason: "excess_scope" };
  return { ok: true };
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

async function postForm(fetchFn: FetchFn, url: string, form: Record<string, string>): Promise<{ status: number; body: any }> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

export async function exchangeCode(fetchFn: FetchFn, cfg: SheetsConfig, code: string, verifier: string): Promise<TokenResponse> {
  const { status, body } = await postForm(fetchFn, "https://oauth2.googleapis.com/token", {
    grant_type: "authorization_code", code, code_verifier: verifier,
    client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri,
  });
  if (status !== 200 || typeof body?.access_token !== "string") {
    throw new GoogleApiError(status, String(body?.error ?? status), "other", "token exchange failed");
  }
  return body as TokenResponse;
}

/** Refresh. invalid_grant (revoked, expired Testing grant, token cap, password change) → "reconnect". */
export async function refreshAccessToken(fetchFn: FetchFn, cfg: SheetsConfig, refreshToken: string): Promise<TokenResponse> {
  const { status, body } = await postForm(fetchFn, "https://oauth2.googleapis.com/token", {
    grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret,
  });
  if (status === 200 && typeof body?.access_token === "string") return body as TokenResponse;
  const error = String(body?.error ?? "");
  if (error === "invalid_grant" || error === "unauthorized_client" || error === "invalid_client") {
    throw new GoogleApiError(status, error, error === "invalid_grant" ? "reconnect" : "api_not_enabled", "refresh failed");
  }
  if (status === 429) throw new GoogleApiError(status, "rate_limited", "quota", "refresh rate limited");
  throw new GoogleApiError(status, error || String(status), status >= 500 ? "transient" : "other", "refresh failed");
}

export interface IdClaims { sub: string; email: string; email_verified: boolean }

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1] ?? "";
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
}

/**
 * Validates an ID token received DIRECTLY from Google's token endpoint over TLS (OpenID Connect Core
 * §3.1.3.7: TLS server validation may replace signature checking for this flow). Issuer, audience, expiry,
 * subject and verified email are still checked; the caller also cross-checks userinfo `sub`.
 */
export function validateIdToken(idToken: string | undefined, clientId: string, nowSec = Math.floor(Date.now() / 1000)): IdClaims {
  if (!idToken) throw new Error("id_token missing");
  const c = decodeJwtPayload(idToken);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!["accounts.google.com", "https://accounts.google.com"].includes(String(c.iss))) throw new Error("bad issuer");
  if (!aud.includes(clientId)) throw new Error("bad audience");
  if (Array.isArray(c.aud) && c.aud.length > 1 && c.azp !== clientId) throw new Error("bad azp");
  if (typeof c.exp !== "number" || c.exp < nowSec - 60) throw new Error("expired id_token");
  if (typeof c.sub !== "string" || !c.sub) throw new Error("missing sub");
  if (c.email_verified !== true && c.email_verified !== "true") throw new Error("email not verified");
  return { sub: c.sub, email: String(c.email ?? ""), email_verified: true };
}

export async function fetchUserinfoSub(fetchFn: FetchFn, accessToken: string): Promise<string> {
  const res = await fetchFn("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 200 || typeof body?.sub !== "string") {
    const c = classifyGoogleError(res.status, body);
    throw new GoogleApiError(res.status, c.reason, c.failure, "userinfo failed");
  }
  return body.sub;
}

/** Inspects the ACTUAL scopes and remaining lifetime of an access token (not stored metadata). */
export async function inspectAccessToken(fetchFn: FetchFn, accessToken: string): Promise<{ scopes: string[]; expiresIn: number; aud: string }> {
  const res = await fetchFn(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  const body = await res.json().catch(() => null);
  if (res.status !== 200 || !body) throw new GoogleApiError(res.status, "tokeninfo", "reconnect", "tokeninfo failed");
  return { scopes: normalizeScopes(body.scope), expiresIn: Number(body.expires_in ?? 0), aud: String(body.aud ?? body.azp ?? "") };
}
