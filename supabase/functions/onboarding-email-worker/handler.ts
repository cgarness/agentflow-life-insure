// =============================================================================
// onboarding-email-worker — request handling (no remote imports; tested offline in handler.test.ts).
//
// NOT DEPLOYED and NOT SCHEDULED. When activated it is invoked only by pg_cron
// (supabase/ops/onboarding_emails_schedule.sql) with `Authorization: Bearer <Vault
// onboarding_email_worker_token>`. Deployed with verify_jwt=false (AGENT_RULES invariant #2);
// authorization is enforced here by a constant-time comparison against ONBOARDING_EMAIL_WORKER_TOKEN
// (>= 32 chars). The request body is ignored: no recipient, HTML, ids or URLs are ever accepted.
//
// Order of gates, each failing closed BEFORE any database client exists:
//   1. POST only                              -> 405
//   2. Bearer token                           -> 403
//   3. ONBOARDING_EMAILS_SEND_ENABLED !== "true" -> 200 {disabled:true}, nothing read or written
//   4. RESEND_API_KEY, EMAIL_UNSUBSCRIBE_SECRET (>= 32), SUPABASE_URL (https) -> 503, nothing claimed
// The database flag onboarding_email_program.enabled is a second, independent off switch.
// =============================================================================
import { assertHttpsUrl, resolveSiteUrl } from "../_shared/systemEmail.ts";
import {
  isAuthorizedWorkerRequest,
  isSendingEnabled,
  type Mailer,
  type OnboardingStore,
  processQueue,
  sanitizeError,
} from "../_shared/onboardingEmail/delivery.ts";
import { MIN_UNSUBSCRIBE_SECRET_LENGTH } from "../_shared/onboardingEmail/unsubscribeToken.ts";

export interface WorkerDeps {
  getEnv: (name: string) => string | undefined;
  /** Called only after every gate passes. */
  createStore: () => OnboardingStore;
  createMailer: (apiKey: string) => Mailer;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  logger: { log: (line: string) => void; error: (line: string) => void };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function createOnboardingWorkerHandler(deps: WorkerDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    if (!isAuthorizedWorkerRequest(req.headers.get("Authorization"), deps.getEnv("ONBOARDING_EMAIL_WORKER_TOKEN"))) {
      return json({ error: "Unauthorized" }, 403);
    }

    if (!isSendingEnabled(deps.getEnv("ONBOARDING_EMAILS_SEND_ENABLED"))) {
      return json({ ok: true, disabled: true }, 200);
    }

    const resendApiKey = (deps.getEnv("RESEND_API_KEY") ?? "").trim();
    const unsubscribeSecret = deps.getEnv("EMAIL_UNSUBSCRIBE_SECRET") ?? "";
    const supabaseUrl = (deps.getEnv("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
    if (!resendApiKey || unsubscribeSecret.length < MIN_UNSUBSCRIBE_SECRET_LENGTH || !supabaseUrl) {
      deps.logger.error("onboarding-email-worker: provider or unsubscribe configuration missing; queue left untouched");
      return json({ error: "Email configuration incomplete" }, 503);
    }

    let functionsBaseUrl: string;
    let siteUrl: string;
    try {
      functionsBaseUrl = assertHttpsUrl(`${supabaseUrl}/functions/v1`);
      siteUrl = assertHttpsUrl(resolveSiteUrl());
    } catch (err) {
      deps.logger.error(`onboarding-email-worker: invalid URL configuration: ${sanitizeError(err)}`);
      return json({ error: "Email configuration incomplete" }, 503);
    }

    try {
      const summary = await processQueue(deps.createStore(), deps.createMailer(resendApiKey), {
        siteUrl,
        functionsBaseUrl,
        unsubscribeSecret,
        now: deps.now,
        sleep: deps.sleep,
        logger: deps.logger,
      });
      if (summary.enrolled > 0 || summary.claimed > 0) {
        deps.logger.log(`onboarding-email-worker: run summary ${JSON.stringify(summary)}`);
      }
      return json({ ok: true, ...summary }, 200);
    } catch (err) {
      deps.logger.error(`onboarding-email-worker: run failed: ${sanitizeError(err)}`);
      return json({ error: "Run failed" }, 500);
    }
  };
}
