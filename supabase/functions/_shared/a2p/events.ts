import { A2pError, type Credentials, type Db } from "./types.ts";
import { checked } from "./store.ts";
export async function validateEventSignature(
  url: string,
  body: string,
  signature: string | null,
  token: string,
): Promise<boolean> {
  if (!signature) return false;
  const u = new URL(url);
  const expected = u.searchParams.get("bodySHA256");
  if (!expected || u.searchParams.getAll("bodySHA256").length !== 1) return false;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  const hex = Array.from(hash, (x) => x.toString(16).padStart(2, "0")).join("");
  if (expected !== hex) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["verify"],
  );
  try {
    return await crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(atob(signature), (x) => x.charCodeAt(0)),
      new TextEncoder().encode(url),
    );
  } catch {
    return false;
  }
}
export type ProviderEvent = { id: string; type: string; time: string; data: Record<string, unknown> };
export function parseEvents(raw: string, accountSid: string): ProviderEvent[] {
  let events: unknown;
  try {
    events = JSON.parse(raw);
  } catch {
    throw new A2pError("INVALID_EVENTS", "Invalid event body.");
  }
  if (!Array.isArray(events) || events.length > 100) throw new A2pError("INVALID_EVENTS", "Invalid event batch.");
  return events.map((e: any) => {
    let d;
    try {
      d = typeof e?.data === "string" ? JSON.parse(e.data) : e?.data;
    } catch {
      throw new A2pError("INVALID_EVENTS", "Invalid event data.");
    }
    if (
      !e || typeof e.id !== "string" || !e.id || e.id.length > 200 || typeof e.type !== "string" ||
      !e.type.startsWith("com.twilio.messaging.compliance.") || !Number.isFinite(Date.parse(e.time)) || !d ||
      d.accountsid !== accountSid
    ) throw new A2pError("INVALID_EVENTS", "Event identity does not match its signed account.");
    // The provider's entity timestamp orders number transitions; receipt time never does.
    const timestamp = typeof d.updateddate === "number" ? d.updateddate : Date.parse(e.time);
    if (!Number.isFinite(timestamp) || timestamp > Date.now() + 300000) {
      throw new A2pError("INVALID_EVENTS", "Invalid event timestamp.");
    }
    return { id: e.id, type: e.type, time: new Date(timestamp).toISOString(), data: d };
  });
}
export async function enqueueEvent(db: Db, creds: Credentials, e: ProviderEvent): Promise<string | null> {
  let q = db.from("a2p_registrations").select("organization_id").eq("account_sid", creds.accountSid);
  const d = e.data;
  if (typeof d.messagingservicesid === "string" && /^MG[0-9a-fA-F]{32}$/.test(d.messagingservicesid)) {
    q = q.eq("messaging_service_sid", d.messagingservicesid);
  } else if (typeof d.brandsid === "string" && /^BN[0-9a-fA-F]{32}$/.test(d.brandsid)) {
    q = q.eq("brand_sid", d.brandsid);
  } else return null;
  const r = checked(await q.maybeSingle()) as { organization_id: string } | null;
  // A brand can arrive before BN association. Scheduled bundle-scoped refresh recovers it.
  if (!r) return null;
  const payload = Object.fromEntries(
    [
      "phonenumbersid",
      "messagingservicesid",
      "brandsid",
      "campaignsid",
      "externalstatus",
      "failureReason",
      "failurereason",
    ].filter((k) => typeof d[k] === "string").map((k) => [k, String(d[k]).slice(0, 1200)]),
  );
  checked(
    await db.from("a2p_event_inbox").upsert({
      account_sid: creds.accountSid,
      event_id: e.id,
      organization_id: r.organization_id,
      event_type: e.type,
      event_at: e.time,
      payload,
    }, { onConflict: "account_sid,event_id", ignoreDuplicates: true }),
  );
  return r.organization_id;
}
