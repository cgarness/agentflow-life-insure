// Server-only authenticated token envelope. See docs/google-oauth-production.md.
// Never log keys, credentials or provider response bodies.
type EnvReader = (name: string) => string | undefined;
const env: EnvReader = (name) => Deno.env.get(name);
const encoder = new TextEncoder();
const PREFIX = "gct.v1.";
export const tokenContext = (kind: "email" | "calendar", userId: string, token: "access" | "refresh") => `${kind}:${userId}:${token}`;

function pack(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unpack(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid Google credential envelope");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}
async function keyFor(id: string, readEnv: EnvReader): Promise<CryptoKey> {
  try {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error();
    const keys = JSON.parse(readEnv("GOOGLE_TOKEN_KEYS") || "{}");
    if (typeof keys[id] !== "string") throw new Error();
    const bytes = Uint8Array.from(atob(keys[id]), c => c.charCodeAt(0));
    if (bytes.length !== 32) throw new Error();
    return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch { throw new Error("Google credential encryption key is unavailable"); }
}
export async function encodeToken(plain: string | null | undefined, context: string, readEnv: EnvReader = env): Promise<string | null> {
  if (!plain) return null;
  if (!context) throw new Error("Google credential context is required");
  // Explicit compatibility window; encrypted writes are the default.
  if (readEnv("GOOGLE_TOKEN_WRITE_FORMAT") === "legacy") {
    if (readEnv("GOOGLE_TOKEN_ALLOW_LEGACY_READ") !== "true") throw new Error("Invalid token transition configuration");
    return btoa(plain);
  }
  const id = readEnv("GOOGLE_TOKEN_KEY_ID") || "primary";
  const key = await keyFor(id, readEnv);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: encoder.encode(context) }, key, encoder.encode(plain));
  return `${PREFIX}${id}.${pack(nonce)}.${pack(new Uint8Array(encrypted))}`;
}
export async function decodeToken(stored: string | null | undefined, context: string, readEnv: EnvReader = env): Promise<string | null> {
  if (!stored) return null;
  if (!context) throw new Error("Google credential context is required");
  if (stored.startsWith("gct.")) {
    // Unsupported versions, missing keys and tampering must never fall back to plaintext.
    const parts = stored.split(".");
    if (!stored.startsWith(PREFIX) || parts.length !== 5) throw new Error("Invalid Google credential envelope");
    const key = await keyFor(parts[2], readEnv);
    try {
      const nonce = unpack(parts[3]);
      if (nonce.length !== 12) throw new Error();
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: encoder.encode(context) }, key, unpack(parts[4]));
      return new TextDecoder("utf-8", { fatal: true }).decode(plain);
    } catch { throw new Error("Google credential could not be authenticated"); }
  }
  if (readEnv("GOOGLE_TOKEN_ALLOW_LEGACY_READ") !== "true") throw new Error("Legacy Google credential requires migration");
  try {
    const decoded = atob(stored);
    if (/^[\x20-\x7E]+$/.test(decoded)) return decoded;
  } catch { /* Raw tokens allowed only during the explicit migration window. */ }
  if (!/^[\x20-\x7E]+$/.test(stored)) throw new Error("Invalid legacy Google credential");
  return stored;
}
export class GoogleOAuthError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code === "invalid_grant" ? "Google access expired or was revoked. Reconnect your account." : "Google authorization is temporarily unavailable.");
  }
}
export type GoogleRefreshResult = { accessToken: string; expiresIn: number; expiresAt: string };
export async function refreshGoogleAccessToken(params: { refreshToken: string; clientId: string; clientSecret: string }): Promise<GoogleRefreshResult> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: params.clientId, client_secret: params.clientSecret, grant_type: "refresh_token", refresh_token: params.refreshToken }),
  });
  const payload = await response.json();
  if (!response.ok) throw new GoogleOAuthError(payload?.error === "invalid_grant" ? "invalid_grant" : "provider_error", response.status);
  const expiresIn = Number(payload?.expires_in);
  if (typeof payload?.access_token !== "string" || !payload.access_token || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("Google refresh response is incomplete");
  return { accessToken: payload.access_token, expiresIn, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}
