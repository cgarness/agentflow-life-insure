// =============================================================================
// google-sheets-oauth-callback — Google redirect target (verify_jwt=false; no session is involved).
// 1. Atomically consumes the single-use state (by SHA-256); expired/used/unknown → "expired".
// 2. Exchanges the code with the decrypted PKCE verifier and the client secret.
// 3. Validates the ID token (iss/aud/exp/sub/email_verified; received directly from Google over TLS),
//    cross-checks userinfo `sub`, and requires drive.file with nothing broader than openid/email/drive.file.
// 4. Stores the refresh token in Vault and the connection state in ONE transaction, conditioned on the
//    generation captured at start (a late callback after a disconnect cannot reconnect).
// Redirects ONLY to an allowlisted origin with a status code — never tokens or raw error text.
// =============================================================================
import { realDeps } from "./deps.ts";
import { readConfig, oauthConfigured, type SheetsConfig } from "../_shared/googleSheets/config.ts";
import { decryptString, sha256Hex } from "../_shared/googleSheets/crypto.ts";
import { sanitizeError } from "../_shared/googleSheets/errors.ts";
import { redirect } from "../_shared/googleSheets/http.ts";
import { checkScopes, exchangeCode, fetchUserinfoSub, normalizeScopes, validateIdToken } from "../_shared/googleSheets/oauth.ts";

export interface ConsumedState { user_id: string; organization_id: string; auth_generation: number; return_origin: string; verifier_enc: string }
export interface CallbackDeps {
  consume(hash: string): Promise<ConsumedState | null>;
  store(s: ConsumedState, sub: string, email: string, scopes: string[], refreshToken: string | null): Promise<string>;
  fetchFn: typeof fetch;
}

const back = (origin: string, status: string) => redirect(`${origin}/settings?section=google-sheets&sheets=${status}`);

export async function handle(req: Request, deps?: CallbackDeps): Promise<Response> {
  const cfg: SheetsConfig = readConfig();
  const fallback = cfg.allowedOrigins[0] ?? "https://www.fflagent.com";
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (!cfg.enabled || !oauthConfigured(cfg)) return back(fallback, "error");

  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || state.length > 200) return back(fallback, "expired");

  const d = deps ?? realDeps();
  try {
    const consumed = await d.consume(await sha256Hex(state));
    if (!consumed) return back(fallback, "expired");
    const origin = cfg.allowedOrigins.includes(consumed.return_origin) ? consumed.return_origin : fallback;
    if (url.searchParams.get("error") || !code) return back(origin, "denied");

    const verifier = await decryptString(cfg.stateKey, consumed.verifier_enc, await sha256Hex(state));
    const tok = await exchangeCode(d.fetchFn, cfg, code, verifier);
    const claims = validateIdToken(tok.id_token, cfg.clientId);
    const scopes = normalizeScopes(tok.scope);
    if (!checkScopes(scopes).ok) return back(origin, "scope_denied");
    if ((await fetchUserinfoSub(d.fetchFn, tok.access_token)) !== claims.sub) return back(origin, "error");

    const outcome = await d.store(consumed, claims.sub, claims.email, scopes, tok.refresh_token ?? null);
    const map: Record<string, string> = {
      connected: "connected", superseded: "expired", account_mismatch: "account_mismatch",
      no_refresh_token: "no_offline_access", not_permitted: "not_permitted",
    };
    return back(origin, map[outcome] ?? "error");
  } catch (e) {
    console.error(`google-sheets-oauth-callback: ${sanitizeError(e)}`);
    return back(fallback, "error");
  }
}

if (import.meta.main) Deno.serve((req) => handle(req));
