// =============================================================================
// platform-admin-notify — delivers queued Super Admin registration emails
// ("[AGENTFLOW ADMIN] New User Registered" / "New Agency Created").
//
// Invoked ONLY by pg_cron (job platform-admin-notify-every-minute) with
// `Authorization: Bearer <Vault platform_admin_notify_token>`. Deployed with
// verify_jwt=false (AGENT_RULES invariant #2); authorization is enforced here
// by a constant-time comparison against PLATFORM_ADMIN_NOTIFY_TOKEN (>= 32
// chars). The request body is ignored: no recipient, HTML, ids or URLs are
// ever accepted from a caller.
//
// Rows are enqueued by AFTER INSERT triggers (migration 20261010200000), so
// this function never runs inside a signup request and cannot block one.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  CLAIM_BATCH_SIZE,
  createResendMailer,
  createSupabaseStore,
  isAuthorizedWorkerRequest,
  processQueue,
  resolvePlatformAdminRecipient,
  sanitizeError,
} from "../_shared/platformAdminNotifications.ts";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!isAuthorizedWorkerRequest(req.headers.get("Authorization"), Deno.env.get("PLATFORM_ADMIN_NOTIFY_TOKEN"))) {
    return json({ error: "Unauthorized" }, 403);
  }

  // Missing provider configuration: leave every row queued (no attempt is
  // spent) so delivery resumes once the secret is restored.
  const resendApiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  if (!resendApiKey) {
    console.error("platform-admin-notify: RESEND_API_KEY is not configured; queue left untouched");
    return json({ error: "Email provider not configured" }, 503);
  }

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const summary = await processQueue(
      createSupabaseStore(db),
      createResendMailer(resendApiKey),
      resolvePlatformAdminRecipient(),
      CLAIM_BATCH_SIZE,
    );
    if (summary.claimed > 0) console.log(`platform-admin-notify: run summary ${JSON.stringify(summary)}`);
    return json({ ok: true, ...summary }, 200);
  } catch (err) {
    console.error(`platform-admin-notify: run failed: ${sanitizeError(err)}`);
    return json({ error: "Run failed" }, 500);
  }
}

if (import.meta.main) {
  Deno.serve(handle);
}
