/**
 * Verify OpenAI webhook signatures (Standard Webhooks spec).
 * https://platform.openai.com/docs/guides/webhooks
 */

const WEBHOOK_TOLERANCE_SEC = 300;

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function decodeWebhookSecret(secret: string): Uint8Array | null {
  const trimmed = secret.trim();
  const raw = trimmed.startsWith("whsec_") ? trimmed.slice(6) : trimmed;
  try {
    return base64ToBytes(raw);
  } catch {
    return null;
  }
}

async function hmacSha256Base64(
  keyBytes: Uint8Array,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  let binary = "";
  for (const b of new Uint8Array(sig)) binary += String.fromCharCode(b);
  return btoa(binary);
}

export type OpenAIWebhookVerifyResult =
  | { ok: true; event: Record<string, unknown> }
  | { ok: false; reason: string };

export async function verifyOpenAIWebhook(
  rawBody: string,
  headers: Headers,
  webhookSecret: string,
): Promise<OpenAIWebhookVerifyResult> {
  const msgId = headers.get("webhook-id")?.trim();
  const timestamp = headers.get("webhook-timestamp")?.trim();
  const signatureHeader = headers.get("webhook-signature")?.trim();

  if (!msgId || !timestamp || !signatureHeader) {
    return { ok: false, reason: "missing webhook-id, webhook-timestamp, or webhook-signature" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "invalid webhook-timestamp" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > WEBHOOK_TOLERANCE_SEC) {
    return { ok: false, reason: "webhook-timestamp outside tolerance" };
  }

  const keyBytes = decodeWebhookSecret(webhookSecret);
  if (!keyBytes) {
    return { ok: false, reason: "invalid OPENAI_WEBHOOK_SECRET format" };
  }

  const signedContent = `${msgId}.${timestamp}.${rawBody}`;
  const expected = await hmacSha256Base64(keyBytes, signedContent);

  const signatures = signatureHeader.split(/\s+/).map((part) => {
    const comma = part.indexOf(",");
    return comma >= 0 ? part.slice(comma + 1) : part;
  });

  const matched = signatures.some((sig) => timingSafeEqual(sig, expected));
  if (!matched) {
    return { ok: false, reason: "webhook-signature mismatch" };
  }

  try {
    const event = JSON.parse(rawBody) as Record<string, unknown>;
    return { ok: true, event };
  } catch {
    return { ok: false, reason: "invalid JSON body" };
  }
}
