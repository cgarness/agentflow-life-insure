// Small WebCrypto helpers: random tokens, SHA-256, PKCE S256, AES-256-GCM, constant-time compare.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64url(v: string): Uint8Array {
  const b = atob(v.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((v.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(value: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Key material: the Edge secret, stretched to 256 bits with SHA-256 (secret must be ≥ 32 chars). */
async function aesKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("state key too short");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM with additional authenticated data; output is base64url(iv || ciphertext+tag). */
export async function encryptString(secret: string, plaintext: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(aad) }, await aesKey(secret), enc.encode(plaintext)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return base64url(out);
}

export async function decryptString(secret: string, payload: string, aad: string): Promise<string> {
  const all = fromBase64url(payload);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: all.slice(0, 12), additionalData: enc.encode(aad) }, await aesKey(secret), all.slice(12));
  return dec.decode(pt);
}
