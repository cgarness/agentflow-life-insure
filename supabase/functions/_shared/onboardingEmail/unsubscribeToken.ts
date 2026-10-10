// Onboarding email series — signed unsubscribe tokens (HMAC-SHA256, WebCrypto).
//
// Format: v1.<base64url(JSON {u: userId, c: "onboarding"})>.<base64url(HMAC(secret, "v1.<payload>"))>
// The token is DETERMINISTIC per user and category. That keeps a retried send byte-identical, so the
// Resend Idempotency-Key never sees a different payload for the same delivery. Tokens do not expire:
// an unsubscribe link must keep working. Rotating EMAIL_UNSUBSCRIBE_SECRET invalidates old links; the
// Settings switch still works. The token grants exactly one action (opting that user out of onboarding
// tips) and carries no email address or name.

export const UNSUBSCRIBE_TOKEN_VERSION = "v1";
export const UNSUBSCRIBE_CATEGORY = "onboarding";
export const MIN_UNSUBSCRIBE_SECRET_LENGTH = 32;
export const MAX_UNSUBSCRIBE_TOKEN_LENGTH = 512;

/** Shape check shared with the frontend's Zod schema (src/lib/emailSubscriptions.ts). */
export const UNSUBSCRIBE_TOKEN_SHAPE = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type UnsubscribeTokenResult =
  | { ok: true; userId: string; category: typeof UNSUBSCRIBE_CATEGORY }
  | { ok: false; reason: "malformed" | "bad_signature" };

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodes into a plain ArrayBuffer (a BufferSource on every Deno/TypeScript version). */
function fromBase64Url(value: string): ArrayBuffer | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    const binary = atob(padded);
    const buffer = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
    return buffer;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (typeof secret !== "string" || secret.length < MIN_UNSUBSCRIBE_SECRET_LENGTH) {
    throw new Error("unsubscribeToken: secret must be at least 32 characters");
  }
  return await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createUnsubscribeToken(secret: string, userId: string): Promise<string> {
  const id = String(userId ?? "").toLowerCase();
  if (!UUID.test(id)) throw new Error("unsubscribeToken: userId must be a UUID");
  const payload = toBase64Url(encoder.encode(JSON.stringify({ u: id, c: UNSUBSCRIBE_CATEGORY })));
  const signed = `${UNSUBSCRIBE_TOKEN_VERSION}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(signed)));
  return `${signed}.${toBase64Url(signature)}`;
}

/** Verifies signature first (constant-time via WebCrypto), then the payload. Never throws for input. */
export async function verifyUnsubscribeToken(secret: string, token: unknown): Promise<UnsubscribeTokenResult> {
  const key = await hmacKey(secret);
  if (typeof token !== "string" || token.length > MAX_UNSUBSCRIBE_TOKEN_LENGTH || !UNSUBSCRIBE_TOKEN_SHAPE.test(token)) {
    return { ok: false, reason: "malformed" };
  }
  const [version, payload, signature] = token.split(".");
  const signatureBytes = fromBase64Url(signature);
  if (version !== UNSUBSCRIBE_TOKEN_VERSION || !signatureBytes) return { ok: false, reason: "malformed" };

  const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(`${version}.${payload}`));
  if (!valid) return { ok: false, reason: "bad_signature" };

  const payloadBytes = fromBase64Url(payload);
  if (!payloadBytes) return { ok: false, reason: "malformed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const record = parsed as { u?: unknown; c?: unknown };
  if (typeof record?.u !== "string" || !UUID.test(record.u) || record.c !== UNSUBSCRIBE_CATEGORY) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, userId: record.u, category: UNSUBSCRIBE_CATEGORY };
}
