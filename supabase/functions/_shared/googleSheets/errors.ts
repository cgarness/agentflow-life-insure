// Error redaction and Google failure classification for the Sheets integration.

/** Redacts credentials and personal data before anything is logged or stored (invariant #21 practice). */
export function sanitizeError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  return raw
    .replace(/ya29\.[\w.-]+/g, "[token]")
    .replace(/1\/\/[\w.-]+/g, "[token]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(refresh_token|access_token|client_secret|code|code_verifier|id_token)=[^&\s"]+/gi, "$1=[redacted]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 300) || "Unknown error";
}

export type GoogleFailure =
  | "quota"            // 429 / rate limit / RESOURCE_EXHAUSTED → back off
  | "api_not_enabled"  // accessNotConfigured / SERVICE_DISABLED → configuration error, not file access
  | "reconnect"        // invalid_grant / revoked / insufficient scopes → reconnect required
  | "access_lost"      // the specific file is gone or no longer shared with the app
  | "transient"        // 5xx / network / timeout → back off
  | "other";

export class GoogleApiError extends Error {
  constructor(public status: number, public reason: string, public failure: GoogleFailure, message: string) {
    super(message);
    this.name = "GoogleApiError";
  }
}

const QUOTA = new Set(["rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED", "RESOURCE_EXHAUSTED",
  "quotaExceeded", "dailyLimitExceeded"]);
const NOT_ENABLED = new Set(["accessNotConfigured", "SERVICE_DISABLED", "API_KEY_SERVICE_BLOCKED"]);
const SCOPE = new Set(["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "authError", "UNAUTHENTICATED"]);

/** Classifies a Google API error body. A 403 is NOT assumed to mean lost file permission. */
export function classifyGoogleError(status: number, body: unknown): { reason: string; failure: GoogleFailure } {
  const err = (body as { error?: Record<string, unknown> } | null)?.error ?? {};
  const reasons: string[] = [];
  if (typeof err.status === "string") reasons.push(err.status);
  for (const e of (Array.isArray(err.errors) ? err.errors : []) as Array<{ reason?: string }>) {
    if (e?.reason) reasons.push(e.reason);
  }
  for (const d of (Array.isArray(err.details) ? err.details : []) as Array<{ reason?: string }>) {
    if (d?.reason) reasons.push(d.reason);
  }
  const reason = reasons.find((r) => QUOTA.has(r) || NOT_ENABLED.has(r) || SCOPE.has(r)) ?? reasons[0] ?? String(status);
  if (status === 429 || reasons.some((r) => QUOTA.has(r))) return { reason, failure: "quota" };
  if (reasons.some((r) => NOT_ENABLED.has(r))) return { reason, failure: "api_not_enabled" };
  if (status === 401 || reasons.some((r) => SCOPE.has(r))) return { reason, failure: "reconnect" };
  if (status === 404) return { reason, failure: "access_lost" };
  if (status === 403 && reasons.some((r) => r === "PERMISSION_DENIED" || r === "forbidden" || r === "notFound")) {
    return { reason, failure: "access_lost" };
  }
  if (status >= 500 || status === 408) return { reason, failure: "transient" };
  return { reason, failure: "other" };
}
