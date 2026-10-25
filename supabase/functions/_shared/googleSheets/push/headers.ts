// Shape validation of a Google Drive change notification (headers only; file notifications carry no body).
// Nothing here authenticates: the HMAC-tagged channel id, the channel token digest and the stored resource id are
// verified by the receiver and in SQL. Values are never logged.

export interface Notice {
  channelId: string;
  token: string;
  resourceId: string;
  state: string;
  messageNumber: number;
  changed: string;
}

const CHANNEL_ID = /^gs1[A-Za-z0-9_-]{40}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PRINTABLE = /^[\x21-\x7e]{1,256}$/;

export function parseNotice(h: Headers): { ok: true; notice: Notice } | { ok: false; reason: string } {
  const channelId = h.get("x-goog-channel-id") ?? "";
  const token = h.get("x-goog-channel-token") ?? "";
  const resourceId = h.get("x-goog-resource-id") ?? "";
  const state = (h.get("x-goog-resource-state") ?? "").trim().toLowerCase();
  const number = (h.get("x-goog-message-number") ?? "").trim();
  if (!CHANNEL_ID.test(channelId)) return { ok: false, reason: "channel_id" };
  if (!TOKEN.test(token)) return { ok: false, reason: "token" };
  if (!PRINTABLE.test(resourceId)) return { ok: false, reason: "resource_id" };
  if (!/^[a-z_]{1,32}$/.test(state)) return { ok: false, reason: "state" };
  if (!/^\d{1,15}$/.test(number)) return { ok: false, reason: "message_number" };
  const changed = (h.get("x-goog-changed") ?? "").toLowerCase().replace(/[^a-z,]/g, "").slice(0, 100);
  return { ok: true, notice: { channelId, token, resourceId, state, messageNumber: Number(number), changed } };
}
