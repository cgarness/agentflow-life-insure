import type { Db } from "../a2p/types.ts";
import { account, registration } from "../a2p/store.ts";
import { credentials } from "../a2p/auth.ts";
import { checked, policy, suppress } from "./consent.ts";
import { phone, SmsError } from "./wire.ts";
export function isStop(params: Record<string, string>) {
  return params.OptOutType?.toUpperCase() === "STOP" ||
    /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPTOUT)$/i.test(
      (params.Body ?? "").trim(),
    );
}
/** Untrusted destination only selects a candidate credential. Signature + account/service bind it. */
export async function inboundCredential(
  db: Db,
  org: string,
  params: Record<string, string>,
) {
  if (!(await policy(db, org))?.enforced) return null;
  const a = await account(db, org), r = await registration(db, org);
  if (
    !a || !r?.messaging_service_sid || params.AccountSid !== a.account_sid ||
    r.account_sid !== a.account_sid ||
    params.MessagingServiceSid !== r.messaging_service_sid ||
    !/^SM[0-9a-f]{32}$/i.test(params.MessageSid ?? "")
  ) throw new SmsError("WEBHOOK_SCOPE", "Invalid SMS callback.", 403);
  return (await credentials(db, a)).authToken;
}
export async function recordInboundStop(
  db: Db,
  org: string,
  params: Record<string, string>,
) {
  if (isStop(params)) {
    await suppress(
      db,
      org,
      params.From,
      "stop",
      `inbound:${params.MessageSid}`,
    );
  } else if ((params.Body ?? "").trim().toUpperCase() === "START") {
    const p = await policy(db, org);
    if (!p?.start_enabled) return;
    const sender = checked(
      await db.from("phone_numbers").select("id,assignment_type,status")
        .eq("organization_id", org).eq("phone_number", phone(params.To))
        .maybeSingle(),
    );
    if (
      !sender || sender.assignment_type !== "agency" ||
      !["active", "Active"].includes(sender.status) ||
      !p.selected_phone_ids.includes(sender.id)
    ) {
      throw new SmsError("START_SENDER", "Invalid re-enrollment sender.", 403);
    }
    checked(
      await db.rpc("sms_receive_start", {
        p_org: org,
        p_phone: phone(params.From),
        p_sid: params.MessageSid,
      }),
    );
  }
  // HELP never changes permission. Twilio remains the sole automatic keyword responder.
}
