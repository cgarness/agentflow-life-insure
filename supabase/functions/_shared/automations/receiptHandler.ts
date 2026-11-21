import type { Db } from "../a2p/types.ts";
import { SmsError } from "../sms/wire.ts";
import { inboundCredential } from "../sms/webhook.ts";
import { validateTwilioSignature } from "../aiTestingTwilio.ts";
import { verifiedResendEvent } from "./resendReceipt.ts";
import { boundedBody, UUID } from "../sms/wire.ts";

const safeHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
};

export async function handleReceipt(req: Request, db: Db, secret: string | undefined) {
  const token = new URL(req.url).searchParams.get("unsubscribe");
  if (token && !UUID.test(token)) return new Response(null, { status: 400 });
  if (token && req.method === "GET") {
    return new Response(
      '<form method="post"><button>Unsubscribe from agency automation emails</button></form>',
      {
        headers: { ...safeHeaders, "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const smsId = new URL(req.url).searchParams.get("sms");
  if (smsId) {
    if (!UUID.test(smsId)) return new Response(null, { status: 400 });
    let params: Record<string, string>;
    try {
      params = Object.fromEntries(new URLSearchParams(await boundedBody(req)));
    } catch {
      return new Response(null, { status: 413 });
    }
    const scope = await db.rpc("automation_callback_scope", {
      p_message: smsId,
      p_sender: params.From,
      p_recipient: params.To,
    });
    if (scope.error) return new Response(null, { status: 503 });
    if (!scope.data) return new Response(null, { status: 403 });
    let auth: string | null;
    try {
      auth = await inboundCredential(db, scope.data, params);
    } catch (error) {
      return new Response(null, {
        status: error instanceof SmsError && error.status === 403 ? 403 : 503,
      });
    }
    if (!auth || !await validateTwilioSignature(req, auth, params, "automation-provider-receipt")) {
      return new Response(null, { status: 403 });
    }
    const status = params.MessageStatus;
    if (!["delivered", "read", "sent", "queued", "accepted", "failed", "undelivered"].includes(status)) {
      return new Response(null, { status: 204 });
    }
    const { error } = await db.rpc("automation_record_receipt", {
      p_message: smsId,
      p_org: scope.data,
      p_channel: "sms",
      p_provider: params.MessageSid,
      p_state: ["delivered", "read"].includes(status)
        ? "delivered"
        : ["failed", "undelivered"].includes(status)
        ? "failed"
        : "accepted",
      p_at: new Date().toISOString(),
    });
    return new Response(null, { status: error ? 503 : 204 });
  }
  if (token) {
    const { error } = await db.rpc("automation_unsubscribe", { p_token: token });
    return new Response(error ? "Please try again." : "Your unsubscribe request was recorded.", {
      headers: safeHeaders,
      status: error ? 503 : 200,
    });
  }
  if (!secret) return new Response(null, { status: 503 });
  // Resend uses the Svix Standard Webhooks v1 envelope over the unmodified request body.
  let raw: string;
  try {
    raw = await boundedBody(req);
  } catch {
    return new Response(null, { status: 413 });
  }
  const event = await verifiedResendEvent(raw, req.headers, secret);
  if (!event) return new Response(null, { status: 403 });
  const data = event.data as {
    email_id?: string;
    from?: string;
    to?: string[];
    tags?: Record<string, string> | { name: string; value: string }[];
  };
  const tag = Array.isArray(data?.tags)
    ? data.tags.find((tag) => tag.name === "automation_message")?.value
    : data?.tags?.automation_message;
  const states = {
    "email.sent": "accepted",
    "email.delivered": "delivered",
    "email.bounced": "failed",
    "email.complained": "delivered",
    "email.failed": "failed",
    "email.suppressed": "failed",
  } as const;
  const type = event.type as keyof typeof states;
  if (!Object.hasOwn(states, type)) return new Response(null, { status: 204 });
  if (
    !data.email_id || !UUID.test(data.email_id) || typeof event.created_at !== "string" ||
    !Number.isFinite(Date.parse(event.created_at))
  ) {
    return new Response(null, { status: 400 });
  }
  if (!data.from || data.to?.length !== 1 || (tag && !UUID.test(tag))) {
    return new Response(null, { status: 400 });
  }
  const from = data.from.match(/<([^<>]+)>$/)?.[1] ?? data.from.trim();
  const scope = await db.rpc("automation_email_receipt_scope", {
    p_message: tag ?? null,
    p_provider: data.email_id,
    p_sender: from.toLowerCase(),
    p_recipient: data.to[0].toLowerCase(),
  });
  if (scope.error) return new Response(null, { status: 503 });
  if (!scope.data) return new Response(null, { status: tag ? 403 : 204 });
  const { error } = await db.rpc("automation_record_receipt", {
    p_message: scope.data.id,
    p_org: scope.data.organization_id,
    p_channel: "email",
    p_provider: data.email_id,
    p_state: states[type],
    p_at: event.created_at,
    p_suppression: type === "email.bounced"
      ? "bounce"
      : type === "email.complained"
      ? "complaint"
      : type === "email.suppressed"
      ? "suppression"
      : null,
  });
  return new Response(null, { status: error ? 503 : 204 });
}
