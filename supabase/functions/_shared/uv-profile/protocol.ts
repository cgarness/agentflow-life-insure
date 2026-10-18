/** Profile sync v1. Keep this module byte-identical in the two repositories. */
export const SYNC_PATH = '/functions/v1/agentflow-profile-sync';
export const MAX_BODY_BYTES = 4_500_000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PUBLIC_PROFILE_URL = /^https:\/\/www\.underwriterverified\.com\/[a-z0-9][a-z0-9-]{0,79}\/[a-z0-9][a-z0-9-]{0,79}$/;
const encoder = new TextEncoder();
const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), b => b.toString(16).padStart(2, '0')).join('');

export type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function version(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}
export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
export async function readBoundedText(body: ReadableStream<Uint8Array> | null, limit = MAX_BODY_BYTES): Promise<string> {
  if (!body) throw new Error('invalid_body');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function key(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('profile_sync_not_configured');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signedBytes(body: string, timestamp: string, nonce: string): Promise<Uint8Array> {
  const digest = hex(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
  return encoder.encode(`agentflow-uv-profile-v1\nPOST\n${SYNC_PATH}\n${timestamp}\n${nonce}\n${digest}`);
}
export async function sign(body: string, secret: string, timestamp: string, nonce: string): Promise<string> {
  return hex(await crypto.subtle.sign('HMAC', await key(secret), await signedBytes(body, timestamp, nonce)));
}
export function validAuthHeaders(headers: Headers, now = Date.now()): boolean {
  const timestamp = headers.get('x-uv-timestamp') ?? '';
  return /^\d{10}$/.test(timestamp) && Math.abs(now / 1000 - Number(timestamp)) <= 60
    && UUID.test(headers.get('x-uv-nonce') ?? '') && /^[a-f0-9]{64}$/.test(headers.get('x-uv-signature') ?? '');
}
export async function verify(body: string, headers: Headers, secret: string, now = Date.now()): Promise<boolean> {
  if (!validAuthHeaders(headers, now)) return false;
  const signature = headers.get('x-uv-signature')!;
  const bytes = Uint8Array.from(signature.match(/../g)!, part => parseInt(part, 16));
  return crypto.subtle.verify('HMAC', await key(secret), bytes,
    await signedBytes(body, headers.get('x-uv-timestamp')!, headers.get('x-uv-nonce')!));
}
export async function equalSecret(left: string, right: string): Promise<boolean> {
  if (right.length < 32) return false;
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(left)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(right)));
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
