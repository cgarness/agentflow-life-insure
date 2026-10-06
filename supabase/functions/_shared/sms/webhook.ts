import type { Db } from "../a2p/types.ts";
import { account, registration } from "../a2p/store.ts";
import { credentials } from "../a2p/auth.ts";
import { policy, suppress } from "./consent.ts";
import { SmsError } from "./wire.ts";
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
  }
  // HELP and START never change consent/suppression. Twilio handles its own opt-out reply.
}
