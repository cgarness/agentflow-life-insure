export function supabasePublicOrigin(): string {
  return (Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
}

export function edgeFunctionUrl(slug: string, query = ""): string {
  const origin = supabasePublicOrigin();
  const qs = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return `${origin}/functions/v1/${slug}${qs}`;
}

export function edgeFunctionAbsoluteUrl(req: Request, slug: string): string {
  const origin = supabasePublicOrigin();
  const search = new URL(req.url).search;
  return `${origin}/functions/v1/${slug}${search}`;
}

export function toE164Plus(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d ? `+${d}` : "";
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type TwilioSignatureDebug = {
  valid: boolean;
  receivedSignature: string | null;
  expectedSignature: string;
  signingUrl: string;
  paramKeys: string[];
  reason?: string;
};

export async function validateTwilioSignatureDebug(
  req: Request,
  authToken: string,
  params: Record<string, string>,
  slug: string,
): Promise<TwilioSignatureDebug> {
  const receivedSignature = req.headers.get("x-twilio-signature");
  const fullUrl = edgeFunctionAbsoluteUrl(req, slug);
  const sortedKeys = Object.keys(params).sort();
  let signingString = fullUrl;
  for (const k of sortedKeys) signingString += k + params[k];

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingString),
  );
  const expected = bytesToBase64(new Uint8Array(sig));

  if (!receivedSignature) {
    return {
      valid: false,
      receivedSignature: null,
      expectedSignature: expected,
      signingUrl: fullUrl,
      paramKeys: sortedKeys,
      reason: "missing x-twilio-signature header",
    };
  }
  const valid = timingSafeEqual(expected, receivedSignature);
  return {
    valid,
    receivedSignature,
    expectedSignature: expected,
    signingUrl: fullUrl,
    paramKeys: sortedKeys,
    reason: valid ? undefined : "HMAC mismatch — URL or params do not match what Twilio signed",
  };
}

export async function validateTwilioSignature(
  req: Request,
  authToken: string,
  params: Record<string, string>,
  slug: string,
): Promise<boolean> {
  return (await validateTwilioSignatureDebug(req, authToken, params, slug)).valid;
}

export function parseFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const k = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
    const v = decodeURIComponent(eq >= 0 ? part.slice(eq + 1).replace(/\+/g, " ") : "");
    out[k] = v;
  }
  return out;
}

export async function twilioFormParams(req: Request): Promise<Record<string, string>> {
  const text = await req.text();
  return parseFormBody(text);
}
