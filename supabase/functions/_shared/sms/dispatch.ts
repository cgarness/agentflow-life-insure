import type { Db } from "../a2p/types.ts";
import { registeredSender } from "../a2p/sending.ts";
import { checked, eligibility, policy, suppress } from "./consent.ts";
import { digest, phone, purpose, SmsError } from "./wire.ts";
export interface Dispatch {
  verifyRecipient?: () => Promise<void>;
  org: string;
  key: string;
  to: string;
  from: string;
  body: string;
  purpose: unknown;
  actor?: string;
  contactId?: string;
  contactType?: string;
  confirmation?: { id: string; purposes: string[]; evidence: string[] };
}
export interface Receipt {
  success: true;
  message_id: string;
  provider_message_id: string;
  status: string;
  replayed: boolean;
}
/** Returns null ONLY for agencies not enrolled in the independent SMS policy. */
export async function dispatch(
  db: Db,
  input: Dispatch,
  transport = fetch,
): Promise<Receipt | null> {
  const p = await policy(db, input.org);
  if (!p?.enforced) return null;
  if (!p.send_enabled) {
    throw new SmsError("SMS_PAUSED", "Agency texting is not activated.");
  }
  const to = phone(input.to),
    from = phone(input.from),
    category = purpose(input.purpose);
  if (
    !input.key || input.key.length > 160 || !input.body.trim() ||
    input.body.length > 1600
  ) throw new SmsError("SMS_INPUT", "Message or request ID is invalid.", 400);
  const sender = checked(
    await db.from("phone_numbers").select("id,assignment_type").eq(
      "organization_id",
      input.org,
    )
      .eq("phone_number", from).maybeSingle(),
  );
  if (
    !sender || sender.assignment_type !== "agency" ||
    !p.selected_phone_ids.includes(sender.id)
  ) {
    throw new SmsError(
      "SENDER_NOT_SELECTED",
      "Select one of the agency's approved texting numbers.",
    );
  }
  const registered = await registeredSender(db, input.org, from, input.actor);
  if (!registered) {
    throw new SmsError(
      "A2P_NOT_READY",
      "Agency A2P registration is incomplete.",
    );
  }
  if (input.actor) {
    const actor = checked(
      await db.from("profiles").select("status,organization_id").eq(
        "id",
        input.actor,
      ).maybeSingle(),
    );
    if (actor?.status !== "Active" || actor.organization_id !== input.org) {
      throw new SmsError(
        "ACTOR",
        "Your account cannot send this message.",
        403,
      );
    }
  }
  let evidence: string[] = [];
  for (const item of input.confirmation?.purposes ?? [category]) {
    evidence.push(...await eligibility(p, to, item, transport));
  }
  if (input.confirmation) evidence = input.confirmation.evidence; // Job's immutable enrollment references; current decisions still checked above.
  const hash = await digest(
    JSON.stringify([
      to,
      from,
      input.body,
      category,
      input.actor ?? null,
      input.contactId ?? null,
      input.contactType ?? null,
      input.confirmation?.id ?? null,
    ]),
  );
  const row = checked(
    await db.rpc("sms_prepare_dispatch", {
      p_org: input.org,
      p_key: input.key,
      p_phone: to,
      p_from: from,
      p_body: input.body,
      p_purpose: category,
      p_hash: hash,
      p_evidence: evidence,
      p_actor: input.actor ?? null,
      p_contact: input.contactId ?? null,
      p_type: input.contactType ?? null,
      p_confirmation: input.confirmation?.id ?? null,
    }),
  );
  const receipt = (r: Record<string, string>, replayed: boolean): Receipt => ({
    success: true,
    message_id: r.message_id,
    provider_message_id: r.provider_sid,
    status: r.provider_status,
    replayed,
  });
  if (row.state === "accepted") return receipt(row, true);
  if (row.state !== "prepared") {
    throw new SmsError(
      "SEND_REVIEW",
      "This send already has an attempt. Check its status before trying again.",
    );
  }
  // Fresh remote check after receipt preparation, then final serialized local suppression/DNC check.
  for (const item of input.confirmation?.purposes ?? [category]) {
    await eligibility(p, to, item, transport);
  }
  await input.verifyRecipient?.();
  if (input.contactType === "lead" && input.contactId) {
    const converted = checked(
      await db.from("clients").select("id").eq("organization_id", input.org).eq(
        "lead_id",
        input.contactId,
      ).limit(1).maybeSingle(),
    );
    if (converted) {
      throw new SmsError(
        "CONTACT_CONVERTED",
        "Open the converted client and review the message before sending.",
      );
    }
  }
  if (
    !checked(
      await db.rpc("sms_start_dispatch", {
        p_org: input.org,
        p_key: input.key,
      }),
    )
  ) {
    throw new SmsError(
      "SEND_IN_PROGRESS",
      "This send is already being processed.",
    );
  }
  const finish = async (
    state: string,
    sid: string | null,
    status: string | null,
    code: string | null = null,
  ) =>
    checked(
      await db.rpc("sms_finish_dispatch", {
        p_org: input.org,
        p_key: input.key,
        p_state: state,
        p_sid: sid,
        p_status: status,
        p_error: code,
      }),
    );
  let response: Response,
    payload: { sid?: string; status?: string; code?: number };
  try {
    response = await transport(
      `https://api.twilio.com/2010-04-01/Accounts/${registered.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " +
            btoa(`${registered.accountSid}:${registered.authToken}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: to,
          From: from,
          Body: input.body,
          MessagingServiceSid: registered.messagingServiceSid,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    payload = await response.json();
  } catch {
    await finish("uncertain", null, null, "transport_unknown");
    throw new SmsError(
      "SEND_UNCERTAIN",
      "Delivery could not be confirmed. This message will not be sent again automatically.",
      503,
    );
  }
  if (!response.ok) {
    if (payload.code === 21610) {
      await suppress(
        db,
        input.org,
        to,
        "provider_block",
        `dispatch:${input.key}`,
      );
    }
    // A provider 5xx may have an uncertain side effect. Never automatically retry it.
    await finish(
      response.status >= 500 ? "uncertain" : "failed",
      null,
      null,
      String(payload.code ?? response.status),
    );
    throw new SmsError(
      payload.code === 21610 ? "SMS_SUPPRESSED" : "PROVIDER_REJECTED",
      payload.code === 21610
        ? "This recipient has opted out of agency texts."
        : "The provider did not accept this message.",
    );
  }
  if (
    !payload.sid || !/^SM[0-9a-f]{32}$/i.test(payload.sid) || !payload.status
  ) {
    await finish("uncertain", null, null, "invalid_provider_receipt");
    throw new SmsError(
      "SEND_UNCERTAIN",
      "Provider result needs review; do not resend.",
      503,
    );
  }
  try {
    return receipt(
      await finish("accepted", payload.sid, payload.status),
      false,
    );
  } catch {
    // Preserve provider truth separately if message/history persistence failed. No automatic resend.
    await db.from("sms_dispatches").update({
      state: "uncertain",
      provider_sid: payload.sid,
      provider_status: payload.status,
      error_code: "receipt_persistence",
    }).eq("organization_id", input.org).eq("request_key", input.key).eq(
      "state",
      "attempting",
    );
    throw new SmsError(
      "SEND_ACCEPTED_REVIEW",
      "Provider accepted the message; saving its history needs review. Do not resend.",
      503,
    );
  }
}
