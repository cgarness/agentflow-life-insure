// Onboarding email series — delivery. Used only by the onboarding-email-worker Edge function, which
// pg_cron would invoke with a dedicated Vault token (NOT scheduled; supabase/ops/onboarding_emails_schedule.sql
// is not run). The database enqueues and decides; this module renders and sends.
//
// Safety properties:
//   * Enrollment and claiming are gated in SQL by onboarding_email_program.enabled (default false).
//   * Every send re-reads the recipient's current facts and runs evaluateEligibility first.
//   * The recipient is the current confirmed auth email; nothing is read from a request.
//   * Each delivery has a stable Resend Idempotency-Key (onboarding-<delivery id>) and a deterministic
//     body, so a retry after an unrecorded success can never send a second, different email.
//   * Sends are spaced and capped per run so transactional mail (confirmation, invitation, welcome)
//     keeps the shared Resend rate limit.
//   * Logs carry delivery ids, step keys and outcomes only — never addresses, names, bodies or tokens.
// Mirrors the reviewed platform-admin notification worker without importing it, so that live system
// stays untouched.

import { SYSTEM_EMAIL_FROM } from "../systemEmail.ts";
import { UNSUBSCRIBE_PAGE_PATH } from "./catalog.ts";
import { type DeliveryContext, evaluateEligibility, type SkipReason, type CancelReason } from "./eligibility.ts";
import { renderOnboardingEmail } from "./templates.ts";
import { createUnsubscribeToken } from "./unsubscribeToken.ts";

export const ENROLL_BATCH_SIZE = 25;
export const CLAIM_BATCH_SIZE = 5;
export const SEND_SPACING_MS = 600;
const RESEND_TIMEOUT_MS = 15_000;

// ── Gates and auth ───────────────────────────────────────────────────────────

/** The Edge kill switch: anything but the exact string "true" means OFF. */
export function isSendingEnabled(value: string | undefined): boolean {
  return value === "true";
}

/** Constant-time string comparison for the worker Bearer token. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True only for `Authorization: Bearer <token>` matching a configured token of >= 32 chars. */
export function isAuthorizedWorkerRequest(authorization: string | null, token: string | undefined): boolean {
  const expected = (token ?? "").trim();
  if (expected.length < 32) return false;
  return timingSafeEqual(authorization ?? "", `Bearer ${expected}`);
}

// Credentials and personal data that must never reach a log line or a stored error, whatever
// produced the message (provider responses, PostgREST errors, the shared renderer's URL check,
// which quotes the whole link including its unsubscribe token). Applied before truncation so a
// value cut at the length limit cannot slip past its pattern.
const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/([?&#](?:[a-z_]*token|api_?key|key|secret)=)[^&\s"'<>]+/gi, "$1[redacted]"],
  [/\bv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]"],
  [/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[redacted-jwt]"],
  [/\bBearer\s+[^\s"',;]+/gi, "Bearer [redacted]"],
  [/\bre_[A-Za-z0-9_]{6,}/g, "[redacted-key]"],
  [/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+(?:@|%40)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/gi, "[redacted-email]"],
];

/** Single-line, bounded error text safe for last_error and logs, with credentials and addresses redacted. */
export function sanitizeError(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value ?? "");
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 300) || "Unknown error";
}

/** Resend error names are short snake_case codes; anything else is dropped rather than recorded. */
const RESEND_ERROR_NAME = /^[a-z][a-z0-9_]{0,63}$/;

// ── Store (narrow interface so tests can inject a fake) ─────────────────────

export interface ClaimedDelivery {
  id: string;
  user_id: string;
  organization_id: string;
  step_key: string;
  attempts: number;
}

export type CompleteOutcome = "sent" | "skipped" | "cancelled" | "retry" | "failed";

export interface OnboardingStore {
  enrollDue(limit: number): Promise<number>;
  claim(limit: number): Promise<ClaimedDelivery[]>;
  loadContext(deliveryId: string): Promise<DeliveryContext | null>;
  complete(
    deliveryId: string,
    outcome: CompleteOutcome,
    providerMessageId?: string | null,
    error?: string | null,
    reason?: SkipReason | CancelReason | null,
  ): Promise<string | null>;
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

/** Unwraps a PostgREST result; a returned error is a failure, never an empty result. */
// deno-lint-ignore no-explicit-any
function check(result: { data: any; error: { message: string } | null }, what: string): any {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

/** Service-role implementation over the five worker RPCs (no direct table access). */
export function createSupabaseStore(db: SupabaseLike): OnboardingStore {
  return {
    async enrollDue(limit) {
      return Number(check(await db.rpc("onboarding_email_enroll_due", { p_limit: limit }), "enroll") ?? 0);
    },
    async claim(limit) {
      return (check(await db.rpc("claim_onboarding_email_deliveries", { p_limit: limit }), "claim") ?? []) as ClaimedDelivery[];
    },
    async loadContext(deliveryId) {
      return (check(
        await db.rpc("get_onboarding_email_context", { p_delivery_id: deliveryId }).maybeSingle(),
        "context",
      ) ?? null) as DeliveryContext | null;
    },
    async complete(deliveryId, outcome, providerMessageId = null, error = null, reason = null) {
      return check(
        await db.rpc("complete_onboarding_email_delivery", {
          p_id: deliveryId,
          p_outcome: outcome,
          p_provider_message_id: providerMessageId,
          p_error: error,
          p_skip_reason: reason,
        }),
        "complete",
      ) as string | null;
    },
  };
}

// ── Mailer ───────────────────────────────────────────────────────────────────

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  headers: Record<string, string>;
  tags: { name: string; value: string }[];
}

export type MailResult = { ok: true; id: string | null } | { ok: false; retryable: boolean; error: string };
export type Mailer = (message: MailMessage) => Promise<MailResult>;

/**
 * Resend over fetch (injectable for tests). 2xx -> sent. 409 invalid_idempotent_request and 400/422
 * validation errors can never succeed on retry -> failed for review. 429, 5xx, 401/403 (a key fixed
 * within the retry window recovers) and network errors -> retry.
 */
export function createResendMailer(apiKey: string, fetchImpl: typeof fetch = fetch): Mailer {
  return async (message) => {
    try {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: SYSTEM_EMAIL_FROM,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: message.headers,
          tags: message.tags,
        }),
      });
      let body: Record<string, unknown> | null = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (res.ok) return { ok: true, id: typeof body?.id === "string" ? body.id : null };
      const name = typeof body?.name === "string" && RESEND_ERROR_NAME.test(body.name) ? body.name : "";
      const permanent = (res.status === 409 && name === "invalid_idempotent_request") ||
        res.status === 400 || res.status === 422;
      return { ok: false, retryable: !permanent, error: sanitizeError(`Resend HTTP ${res.status}${name ? ` ${name}` : ""}`) };
    } catch (err) {
      return { ok: false, retryable: true, error: sanitizeError(`Resend request failed: ${sanitizeError(err)}`) };
    }
  };
}

// ── Processing ───────────────────────────────────────────────────────────────

export interface ProcessOptions {
  /** e.g. https://www.fflagent.com — the footer link's confirm page. */
  siteUrl: string;
  /** e.g. https://<ref>.supabase.co/functions/v1 — the RFC 8058 one-click endpoint. */
  functionsBaseUrl: string;
  unsubscribeSecret: string;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  logger: { log: (line: string) => void; error: (line: string) => void };
  enrollLimit?: number;
  claimLimit?: number;
  spacingMs?: number;
}

export interface ProcessSummary {
  enrolled: number;
  claimed: number;
  sent: number;
  skipped: number;
  cancelled: number;
  retried: number;
  failed: number;
  errors: number;
}

export function buildUnsubscribeUrls(siteUrl: string, functionsBaseUrl: string, token: string) {
  const encoded = encodeURIComponent(token);
  return {
    pageUrl: `${siteUrl.replace(/\/+$/, "")}${UNSUBSCRIBE_PAGE_PATH}?token=${encoded}`,
    oneClickUrl: `${functionsBaseUrl.replace(/\/+$/, "")}/email-unsubscribe?token=${encoded}`,
  };
}

/**
 * One worker run: enroll due users, claim due deliveries, and handle each one. Never throws for a
 * single delivery: every outcome is recorded through store.complete; a failed bookkeeping call is
 * counted and logged, and the row's lease then expires so it is reclaimed safely.
 */
export async function processQueue(store: OnboardingStore, mailer: Mailer, options: ProcessOptions): Promise<ProcessSummary> {
  const summary: ProcessSummary = { enrolled: 0, claimed: 0, sent: 0, skipped: 0, cancelled: 0, retried: 0, failed: 0, errors: 0 };
  summary.enrolled = await store.enrollDue(options.enrollLimit ?? ENROLL_BATCH_SIZE);
  const rows = await store.claim(options.claimLimit ?? CLAIM_BATCH_SIZE);
  summary.claimed = rows.length;
  let sentThisRun = 0;

  for (const row of rows) {
    const tag = `delivery=${row.id} step=${row.step_key} attempt=${row.attempts}`;
    let outcome: CompleteOutcome;
    let providerId: string | null = null;
    let error: string | null = null;
    let reason: SkipReason | CancelReason | null = null;

    try {
      const decision = evaluateEligibility(await store.loadContext(row.id), options.now());
      if (decision.action === "cancel") {
        outcome = "cancelled";
        reason = decision.reason;
      } else if (decision.action === "skip") {
        outcome = "skipped";
        reason = decision.reason;
      } else {
        if (sentThisRun > 0) await options.sleep(options.spacingMs ?? SEND_SPACING_MS);
        const token = await createUnsubscribeToken(options.unsubscribeSecret, row.user_id);
        const urls = buildUnsubscribeUrls(options.siteUrl, options.functionsBaseUrl, token);
        const rendered = renderOnboardingEmail({
          stepKey: row.step_key,
          firstName: decision.firstName,
          unsubscribeUrl: urls.pageUrl,
        });
        sentThisRun++;
        const result = await mailer({
          to: decision.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: `onboarding-${row.id}`,
          headers: {
            "List-Unsubscribe": `<${urls.oneClickUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          tags: [
            { name: "category", value: "onboarding" },
            { name: "step", value: row.step_key },
          ],
        });
        if (result.ok) {
          outcome = "sent";
          providerId = result.id;
        } else {
          outcome = result.retryable ? "retry" : "failed";
          error = result.error;
        }
      }
    } catch (err) {
      outcome = "retry";
      error = sanitizeError(err);
    }

    try {
      const status = await store.complete(row.id, outcome, providerId, error, reason);
      if (status === "sent") summary.sent++;
      else if (status === "skipped") summary.skipped++;
      else if (status === "cancelled") summary.cancelled++;
      else if (status === "scheduled") summary.retried++;
      else if (status === "failed") summary.failed++;
      const line = `onboarding-email-worker: ${tag} outcome=${outcome}${reason ? ` reason=${reason}` : ""} ` +
        `status=${status ?? "not-applied"}${error ? ` error="${error}"` : ""}`;
      if (outcome === "retry" || outcome === "failed" || status === "failed") options.logger.error(line);
      else options.logger.log(line);
    } catch (completeErr) {
      summary.errors++;
      options.logger.error(`onboarding-email-worker: ${tag} could not record outcome=${outcome}: ${sanitizeError(completeErr)}`);
    }
  }

  return summary;
}
