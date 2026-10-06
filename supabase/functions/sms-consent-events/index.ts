import { database } from "../_shared/a2p/auth.ts";
import { checked } from "../_shared/sms/consent.ts";
import {
  boundedBody,
  digest,
  failure,
  json,
  phone,
  SmsError,
  UUID,
  verifyRequest,
} from "../_shared/sms/wire.ts";
export async function handle(req: Request) {
  try {
    const raw = await boundedBody(req);
    const nonce = await verifyRequest(
      req,
      raw,
      Deno.env.get("SMS_BRIDGE_SECRET") ?? "",
      "/functions/v1/sms-consent-events",
    );
    const b = JSON.parse(raw);
    if (
      ![b.organization_id, b.profile_id, b.request_id].every((x) =>
        typeof x === "string" && UUID.test(x)
      ) || !Array.isArray(b.events) || b.events.length !== 2
    ) throw new SmsError("EVENT", "Invalid consent event.", 400);
    const db = database();
    checked(await db.from("sms_bridge_nonces").insert({ nonce }));
    checked(
      await db.rpc("sms_ingest_consent", {
        p_org: b.organization_id,
        p_profile: b.profile_id,
        p_request: b.request_id,
        p_phone: phone(b.phone),
        p_events: b.events,
        p_hash: await digest(raw),
      }),
    );
    return json({ received: true });
  } catch (e) {
    return failure(e);
  }
}
if (import.meta.main) Deno.serve(handle);
