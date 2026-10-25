// Notification channel credentials and the two Drive calls (files.watch, channels.stop). Both accept the
// drive.file scope (Drive v3 discovery document), so no broader permission is ever requested.
// channel id = "gs1" + 24 random base64url chars + a 16-char HMAC tag over that prefix (43 chars ≤ Google's 64):
// the receiver rejects forged or random ids with no database call. The token (43 chars ≤ 256) is random and only
// its SHA-256 digest is stored.
import { base64url, randomToken, sha256Hex, timingSafeEqual } from "../crypto.ts";
import { classifyGoogleError, GoogleApiError } from "../errors.ts";
import { PUSH } from "./config.ts";

type FetchFn = typeof fetch;
const enc = new TextEncoder();
const PREFIX_LEN = 27;

async function tag(key: string, prefix: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(`gs-push-channel:${prefix}`)));
  return base64url(mac.slice(0, 12));
}

/** Short, non-reversible identifier of the key that minted a channel (detects rotation). */
export async function keyId(key: string): Promise<string> {
  return (await sha256Hex(`gs-push-key-id:${key}`)).slice(0, 8);
}

export interface MintedChannel { channelId: string; token: string; tokenDigest: string; keyId: string }

export async function mintChannel(key: string): Promise<MintedChannel> {
  if (key.length < 32) throw new Error("push key too short");
  const prefix = "gs1" + base64url(crypto.getRandomValues(new Uint8Array(18)));
  const token = randomToken(32);
  return { channelId: prefix + await tag(key, prefix), token, tokenDigest: await sha256Hex(token), keyId: await keyId(key) };
}

export async function verifyChannelId(key: string, channelId: string): Promise<boolean> {
  if (key.length < 32 || !/^gs1[A-Za-z0-9_-]{40}$/.test(channelId)) return false;
  return timingSafeEqual(await tag(key, channelId.slice(0, PREFIX_LEN)), channelId.slice(PREFIX_LEN));
}

async function post(fetchFn: FetchFn, url: string, token: string, body: unknown): Promise<{ status: number; json: any }> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PUSH.googleTimeoutMs),
    });
  } catch (e) {
    throw new GoogleApiError(0, "network", "transient", `network: ${e instanceof Error ? e.name : "error"}`);
  }
  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json };
}

export interface WatchedChannel { resourceId: string; expiration: Date }

/** files.watch on one spreadsheet. The returned expiration (Google's, possibly capped) is authoritative. */
export async function watchFile(fetchFn: FetchFn, accessToken: string, spreadsheetId: string,
  ch: { id: string; token: string; address: string; expirationMs: number }): Promise<WatchedChannel> {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(spreadsheetId)) throw new GoogleApiError(400, "bad_id", "other", "invalid spreadsheet id");
  const { status, json } = await post(fetchFn,
    `https://www.googleapis.com/drive/v3/files/${spreadsheetId}/watch?supportsAllDrives=true`, accessToken,
    { id: ch.id, type: "web_hook", address: ch.address, token: ch.token, expiration: String(Math.trunc(ch.expirationMs)) });
  if (status < 200 || status >= 300) {
    const c = classifyGoogleError(status, json);
    throw new GoogleApiError(status, c.reason, c.failure, `watch ${status} ${c.reason}`);
  }
  const resourceId = typeof json?.resourceId === "string" ? json.resourceId : "";
  if (json?.id !== ch.id || !/^[\x21-\x7e]{1,256}$/.test(resourceId)) {
    throw new GoogleApiError(502, "bad_watch_response", "transient", "unexpected watch response");
  }
  const ms = Number(json?.expiration);
  return { resourceId, expiration: new Date(Number.isFinite(ms) && ms > Date.now() ? ms : Date.now() + 3_600_000) };
}

/** channels.stop. 404 means the channel is already gone (expired or stopped). */
export async function stopChannel(fetchFn: FetchFn, accessToken: string, ch: { id: string; resourceId: string }): Promise<"stopped" | "gone"> {
  const { status, json } = await post(fetchFn, "https://www.googleapis.com/drive/v3/channels/stop", accessToken,
    { id: ch.id, resourceId: ch.resourceId });
  if (status >= 200 && status < 300) return "stopped";
  if (status === 404) return "gone";
  const c = classifyGoogleError(status, json);
  throw new GoogleApiError(status, c.reason, c.failure, `stop ${status} ${c.reason}`);
}

/** Short failure code stored on the channel / target (never raw Google text). */
export function watchErrorCode(e: unknown): string {
  if (!(e instanceof GoogleApiError)) return "watch_failed";
  if (/^push\.|webhook/i.test(e.reason)) return "address_rejected";
  switch (e.failure) {
    case "quota": return "rate_limited";
    case "access_lost": return "access_lost";
    case "reconnect": return "reconnect_required";
    case "api_not_enabled": return "api_not_enabled";
    case "transient": return "google_unavailable";
    default: return e.status === 400 ? "watch_rejected" : "watch_failed";
  }
}
