// =============================================================================
// google-sheets-api — authenticated Settings → Google Sheets actions (verify_jwt=false; the JWT is
// validated in code and the organization comes from public.profiles — never from the request body).
// Actions: status, context, picker_token, inspect, headers, preview, save, activate, sync_now, pause,
// resume, remove, review_preview, review_apply, disconnect. Responses are no-store; no credential is
// ever returned except the short-lived, scope-inspected Picker access token.
// =============================================================================
import { readConfig } from "../_shared/googleSheets/config.ts";
import { DbError } from "../_shared/googleSheets/db.ts";
import { GoogleApiError, sanitizeError } from "../_shared/googleSheets/errors.ts";
import { corsHeaders, json } from "../_shared/googleSheets/http.ts";
import { authenticate, serviceClient } from "../_shared/googleSheets/auth.ts";
import * as A from "./actions.ts";

const DB_ERRORS: Record<string, [number, string]> = {
  not_permitted: [403, "not_permitted"], duplicate_source: [409, "duplicate_source"],
  version_conflict: [409, "version_conflict"], identity_change_requires_review: [409, "identity_change_requires_review"],
  not_connected: [409, "not_connected"], not_found: [404, "not_found"], invalid_state: [409, "invalid_state"],
  invalid_argument: [422, "invalid_argument"],
};

export function errorResponse(e: unknown, cors: Record<string, string>): Response {
  if (e instanceof A.ActionError) return json({ error: e.code }, e.status, cors);
  if (e instanceof DbError) {
    if (e.stale) return json({ error: "busy" }, 409, cors);
    const hit = Object.keys(DB_ERRORS).find((k) => e.message.startsWith(k));
    if (hit) return json({ error: DB_ERRORS[hit][1] }, DB_ERRORS[hit][0], cors);
  }
  if (e instanceof GoogleApiError) {
    const code = e.reason === "tab_missing" ? "tab_missing" : e.failure === "access_lost" ? "access_lost"
      : e.failure === "quota" ? "rate_limited" : e.failure === "api_not_enabled" ? "api_not_enabled"
      : e.failure === "reconnect" ? "reconnect_required" : e.reason === "not_a_spreadsheet" ? "not_a_spreadsheet" : "google_error";
    return json({ error: code }, code === "rate_limited" ? 429 : 409, cors);
  }
  console.error(`google-sheets-api: ${sanitizeError(e)}`);
  return json({ error: "failed" }, 500, cors);
}

export async function handle(req: Request): Promise<Response> {
  const cfg = readConfig();
  const cors = corsHeaders(req.headers.get("Origin"), cfg.allowedOrigins);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_request" }, 400, cors); }
  const action = typeof body?.action === "string" ? body.action : "";
  if (!cfg.enabled && action !== "status" && action !== "disconnect") return json({ error: "disabled" }, 503, cors);

  const svc = serviceClient();
  const actor = await authenticate(req, svc);
  if (!actor) return json({ error: "unauthorized" }, 401, cors);
  const c: A.Ctx = { svc, cfg, fetchFn: fetch, userId: actor.userId, orgId: actor.orgId };
  try {
    switch (action) {
      case "status": return json(await A.status(c), 200, cors);
      case "context": return json(await A.context(c), 200, cors);
      case "picker_token": return json(await A.pickerToken(c), 200, cors);
      case "inspect": return json(await A.inspect(c, body), 200, cors);
      case "headers": return json(await A.headers(c, body), 200, cors);
      case "preview": return json(await A.preview(c, body), 200, cors);
      case "save": return json(await A.save(c, body), 200, cors);
      case "activate": return json(await A.activate(c, body), 200, cors);
      case "sync_now": return json(await A.syncNow(c, body), 200, cors);
      case "pause": case "resume": case "remove": return json(await A.setState(c, body, action), 200, cors);
      case "review_preview": return json(await A.review(c, body, true), 200, cors);
      case "review_apply": return json(await A.review(c, body, false), 200, cors);
      case "disconnect": return json(await A.disconnect(c), 200, cors);
      default: return json({ error: "unknown_action" }, 400, cors);
    }
  } catch (e) {
    return errorResponse(e, cors);
  }
}

if (import.meta.main) Deno.serve(handle);
