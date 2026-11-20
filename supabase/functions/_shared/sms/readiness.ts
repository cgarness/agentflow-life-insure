import type { Db } from "../a2p/types.ts";
import { registeredSender } from "../a2p/sending.ts";
import { checked } from "./consent.ts";
import { phone, SmsError } from "./wire.ts";
export interface SenderScope { org: string; actor: string; contactId: string; contactType: string; overrideId?: string }
/** Pure database description: no provider calls, registration, affinity or usage writes. */
export async function describeSender(db: Db, input: SenderScope) {
  return checked(await db.rpc("sms_describe_contact_sender", {
    p_org: input.org, p_actor: input.actor, p_contact: input.contactId,
    p_type: input.contactType, p_override: input.overrideId ?? null,
  }));
}
/** Authorize the definitive reservation, never the earlier default/candidate. */
export async function authorizeSender(db: Db, org: string, key: string, row: Record<string, string>, actor?: string) {
  if (!row.affinity_number_id || !row.from_number) throw new SmsError("SEND_REVIEW", "The selected number needs review.");
  const registered = await registeredSender(db, org, row.from_number, actor ?? row.affinity_actor_id);
  if (!registered || registered.accountSid !== row.affinity_account_sid || registered.messagingServiceSid !== row.affinity_service_sid) {
    throw new SmsError("SENDER_CHANGED", "Texting setup changed. Review this message before sending.");
  }
  checked(await db.rpc("sms_authorize_bound_dispatch", {
    p_org: org, p_key: key, p_number: row.affinity_number_id, p_from: phone(row.from_number),
    p_account: registered.accountSid, p_service: registered.messagingServiceSid,
  }));
  return registered;
}
