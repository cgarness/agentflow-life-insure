/** Versioned, body-bound server-to-server protocol. Keep identical in both repositories. */
export class SmsError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message);
  }
}
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function phone(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.startsWith("+") && !s.startsWith("+1")) {
    throw new SmsError("PHONE", "A US phone number is required.");
  }
  const d = s.replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(n)) {
    throw new SmsError("PHONE", "A valid US phone number is required.");
  }
  return `+1${n}`;
}
export function purpose(value: unknown): "informational" | "marketing" {
  if (value !== "informational" && value !== "marketing") {
    throw new SmsError(
      "PURPOSE",
      "Choose informational or marketing before sending.",
    );
  }
  return value;
}
export async function digest(value: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function signature(
  secret: string,
  path: string,
  body: string,
  time: string,
  nonce: string,
) {
  if (secret.length < 32) {
    throw new SmsError(
      "BRIDGE_CONFIG",
      "Consent connection is not configured.",
      503,
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `sms-v1\nPOST\n${path}\n${time}\n${nonce}\n${await digest(body)}`,
    ),
  );
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function signedHeaders(
  secret: string,
  path: string,
  body: string,
  now = Date.now(),
) {
  const time = String(Math.floor(now / 1000)), nonce = crypto.randomUUID();
  return {
    "Content-Type": "application/json",
    "x-sms-time": time,
    "x-sms-nonce": nonce,
    "x-sms-signature": await signature(secret, path, body, time, nonce),
  };
}
export async function verifyRequest(
  req: Request,
  body: string,
  secret: string,
  expectedPath: string,
  now = Date.now(),
) {
  const url = new URL(req.url),
    time = req.headers.get("x-sms-time") ?? "",
    nonce = req.headers.get("x-sms-nonce") ?? "";
  // Hosted Supabase removes /functions/v1 before invoking the Edge runtime.
  // Both exact transport forms bind to the same public path in the HMAC below.
  const runtimePath = expectedPath.startsWith("/functions/v1/")
    ? expectedPath.slice("/functions/v1".length)
    : expectedPath;
  if (
    req.method !== "POST" ||
    (url.pathname !== expectedPath && url.pathname !== runtimePath) ||
    url.search ||
    !/^\d{10}$/.test(time) || !UUID.test(nonce) ||
    Math.abs(now / 1000 - Number(time)) > 60
  ) {
    throw new SmsError("BRIDGE_AUTH", "Invalid consent request.", 403);
  }
  if (
    !equal(
      await signature(secret, expectedPath, body, time, nonce),
      req.headers.get("x-sms-signature") ?? "",
    )
  ) throw new SmsError("BRIDGE_AUTH", "Invalid consent request.", 403);
  return nonce;
}
export async function boundedBody(req: Request, max = 16384): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) throw new SmsError("BODY", "Missing request body.", 400);
  let result = "", size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new SmsError("BODY", "Request too large.", 413);
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
export function failure(error: unknown) {
  const e = error instanceof SmsError ? error : new SmsError(
    "SMS_UNAVAILABLE",
    "Texting is unavailable. Your message has not been retried.",
    503,
  );
  return json({ success: false, code: e.code, error: e.message }, e.status);
}
