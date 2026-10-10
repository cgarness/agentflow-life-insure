// =============================================================================
// email-unsubscribe — request handling (no remote imports; tested offline in handler.test.ts).
//
// NOT DEPLOYED. Deployed with verify_jwt=false (invariant #2): the signed token IS the authorization,
// and it can do exactly one thing — opt its own user out of onboarding tips. It never touches
// transactional or security email preferences.
//
//   OPTIONS -> CORS preflight (the /email/unsubscribe page posts here from the app origin)
//   GET     -> 303 to the app's confirm page. A GET NEVER changes state, so link scanners and
//              previews cannot unsubscribe anyone.
//   POST    -> RFC 8058 one-click (token in the query, body "List-Unsubscribe=One-Click") or the
//              confirm page (JSON {token}). Valid token -> opt-out recorded -> 200 {ok:true}, the same
//              answer whether or not the account still exists. Invalid -> 400. Never echoes identity.
// =============================================================================
import { resolveSiteUrl } from "../_shared/systemEmail.ts";
import { UNSUBSCRIBE_PAGE_PATH } from "../_shared/onboardingEmail/catalog.ts";
import {
  MAX_UNSUBSCRIBE_TOKEN_LENGTH,
  MIN_UNSUBSCRIBE_SECRET_LENGTH,
  UNSUBSCRIBE_TOKEN_SHAPE,
  verifyUnsubscribeToken,
} from "../_shared/onboardingEmail/unsubscribeToken.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface UnsubscribeDeps {
  getEnv: (name: string) => string | undefined;
  /** Records the opt-out for a verified user id (service-role RPC). */
  recordOptOut: (userId: string) => Promise<boolean>;
  logger: { log: (line: string) => void; error: (line: string) => void };
}

const MAX_BODY_BYTES = 4096;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function readToken(req: Request, url: URL): Promise<string | null> {
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery;
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return null;
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return null;
  try {
    const body = JSON.parse(raw) as { token?: unknown };
    return typeof body?.token === "string" ? body.token : null;
  } catch {
    return null;
  }
}

export function createUnsubscribeHandler(deps: UnsubscribeDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    const url = new URL(req.url);

    if (req.method === "GET") {
      const token = url.searchParams.get("token") ?? "";
      const page = `${resolveSiteUrl()}${UNSUBSCRIBE_PAGE_PATH}`;
      const target = token.length <= MAX_UNSUBSCRIBE_TOKEN_LENGTH && UNSUBSCRIBE_TOKEN_SHAPE.test(token)
        ? `${page}?token=${encodeURIComponent(token)}`
        : page;
      return new Response(null, { status: 303, headers: { Location: target } });
    }

    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

    const secret = deps.getEnv("EMAIL_UNSUBSCRIBE_SECRET") ?? "";
    if (secret.length < MIN_UNSUBSCRIBE_SECRET_LENGTH) {
      deps.logger.error("email-unsubscribe: EMAIL_UNSUBSCRIBE_SECRET is not configured");
      return json({ ok: false, error: "unavailable" }, 503);
    }

    try {
      const verified = await verifyUnsubscribeToken(secret, await readToken(req, url));
      if (!verified.ok) return json({ ok: false, error: "invalid_link" }, 400);
      await deps.recordOptOut(verified.userId);
      deps.logger.log("email-unsubscribe: onboarding opt-out recorded");
      return json({ ok: true }, 200);
    } catch (err) {
      deps.logger.error(`email-unsubscribe: failed: ${err instanceof Error ? err.name : "error"}`);
      return json({ ok: false, error: "unavailable" }, 500);
    }
  };
}
