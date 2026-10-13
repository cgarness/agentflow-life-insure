// =============================================================================
// google-sheets-oauth-start — begins the dedicated "AgentFlow Sheets" Google connection.
// verify_jwt=false (invariant #2): the caller's JWT is validated in code and the organization comes from
// public.profiles. Creates a 10-minute, single-use, generation-bound state (only its SHA-256 is stored)
// and an AES-256-GCM-encrypted PKCE verifier. Scopes: openid email drive.file; no incremental scopes.
// The client sends only its origin, which must be in GOOGLE_SHEETS_ALLOWED_RETURN_ORIGINS.
// =============================================================================
import { realDeps } from "./deps.ts";
import { readConfig, oauthConfigured } from "../_shared/googleSheets/config.ts";
import { encryptString, pkceChallenge, randomToken, sha256Hex } from "../_shared/googleSheets/crypto.ts";
import { corsHeaders, json } from "../_shared/googleSheets/http.ts";
import { buildAuthUrl } from "../_shared/googleSheets/oauth.ts";
import { sanitizeError } from "../_shared/googleSheets/errors.ts";

export interface StartDeps {
  authenticate(req: Request): Promise<{ userId: string; orgId: string } | null>;
  createState(userId: string, orgId: string, hash: string, verifierEnc: string, origin: string): Promise<{ error?: string }>;
  loginHint(userId: string, orgId: string): Promise<string | null>;
}

export async function handle(req: Request, deps?: StartDeps): Promise<Response> {
  const cfg = readConfig();
  const cors = corsHeaders(req.headers.get("Origin"), cfg.allowedOrigins);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
  if (!cfg.enabled) return json({ error: "disabled" }, 503, cors);
  if (!oauthConfigured(cfg)) return json({ error: "not_configured" }, 503, cors);

  let body: { return_origin?: unknown } = {};
  try { body = await req.json(); } catch { return json({ error: "invalid_request" }, 400, cors); }
  const origin = typeof body.return_origin === "string" ? body.return_origin.replace(/\/+$/, "") : "";
  if (!cfg.allowedOrigins.includes(origin)) return json({ error: "origin_not_allowed" }, 400, cors);

  const d = deps ?? realDeps();
  const actor = await d.authenticate(req);
  if (!actor) return json({ error: "unauthorized" }, 401, cors);

  try {
    const state = randomToken(32);
    const hash = await sha256Hex(state);
    const verifier = randomToken(48);
    const verifierEnc = await encryptString(cfg.stateKey, verifier, hash);
    const created = await d.createState(actor.userId, actor.orgId, hash, verifierEnc, origin);
    if (created.error) {
      return json({ error: created.error.includes("not_permitted") ? "not_permitted" : "failed" },
        created.error.includes("not_permitted") ? 403 : 500, cors);
    }
    const url = buildAuthUrl(cfg, state, await pkceChallenge(verifier), await d.loginHint(actor.userId, actor.orgId));
    return json({ url }, 200, cors);
  } catch (e) {
    console.error(`google-sheets-oauth-start: ${sanitizeError(e)}`);
    return json({ error: "failed" }, 500, cors);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req));
