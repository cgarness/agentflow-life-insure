import { affinityGuard, cancelPrepared, isGuarded } from "./affinity.ts";
import { authorizeSender } from "./readiness.ts";
import type { Db } from "../a2p/types.ts";
import { registeredSender } from "../a2p/sending.ts";
import { checked, eligibility, policy, suppress } from "./consent.ts";
import { digest, phone, purpose, SmsError, UUID } from "./wire.ts";
export interface FirstContactSender {
  senderId: string;
  generation: number;
}
export interface Dispatch {
  /** Internal entry-point choice; never copied from a request body or workflow config. */
  manual?: boolean;
  /** Worker-only transaction authorizes the workflow, calls sms_start_dispatch and returns its signed callback URL. */
  authorizeHandoff?: (from: string) => Promise<string>;
  expectedSenderId?: string;
  overrideSenderId?: string;
  firstContact?: FirstContactSender;
  verifyRecipient?: () => Promise<void>;
  org: string;
  key: string;
  to: string;
  from: string;
  body: string;
  purpose?: unknown;
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
function rejectRecordedFirstContact(row: Record<string, unknown>) {
  if (row.affinity_role !== "first_contact" || row.state !== "failed" || row.provider_sid !== null ||
      typeof row.error_code !== "string") return;
  const rejection = /^first_contact_4xx:(\d+)$/.exec(row.error_code);
  if (rejection) throw new SmsError("FIRST_CONTACT_REJECTED", rejection[1] === "21610"
    ? "This recipient has opted out of agency texts." : "The provider did not accept this message.", 409);
}
/** Returns null ONLY for agencies not enrolled in the independent SMS policy. */
export async function dispatch(
  db: Db,
  input: Dispatch,
  transport = fetch,
): Promise<Receipt | null> {
  const guard = await affinityGuard(db, input.org);
  const sticky = isGuarded(guard.sms);
  const p = await policy(db, input.org);
  const first = input.firstContact;
  if (!first && sticky && !p?.enforced) throw new SmsError("SMS_POLICY", "Agency texting needs review.", 503);
  if (!first && !p?.enforced) return null;
  const manual = input.manual === true;
  if (first && (!manual || input.overrideSenderId || input.authorizeHandoff || input.confirmation ||
      !UUID.test(first.senderId) || first.senderId !== input.expectedSenderId ||
      !Number.isSafeInteger(first.generation) || first.generation < 0)) {
    throw new SmsError("SMS_INPUT", "Review the selected sending number before sending.", 400);
  }
  if (
    manual && (
      !UUID.test(input.actor ?? "") || !UUID.test(input.contactId ?? "") ||
      !["lead", "client", "recruit"].includes(input.contactType ?? "") ||
      input.confirmation || typeof input.verifyRecipient !== "function" ||
      !input.key.startsWith(`manual:${input.actor}:`) ||
      !UUID.test(input.key.slice(`manual:${input.actor}:`.length))
    )
  ) {
    throw new SmsError("SEND_SCOPE", "Reload the contact before sending.", 403);
  }
  const to = phone(input.to);
  let from = phone(input.from);
  const category = manual ? "manual" : purpose(input.purpose);
  if (
    !input.key || input.key.length > 160 || !input.body.trim() ||
    input.body.length > 1600
  ) throw new SmsError("SMS_INPUT", "Message or request ID is invalid.", 400);
  const intentFields = [to, from, input.body, category, input.actor ?? null, input.contactId ?? null, input.contactType ?? null, input.confirmation?.id ?? null];
  const hash = await digest(JSON.stringify(first ? [...intentFields, "first_contact", first.senderId, first.generation] : intentFields));
  const prepare = async (evidence: string[]) => {
    const args = { p_org: input.org, p_key: input.key, p_phone: to, p_from: from, p_body: input.body, p_purpose: category,
      p_hash: hash, p_evidence: evidence, p_actor: input.actor ?? null, p_contact: input.contactId ?? null,
      p_type: input.contactType ?? null, p_confirmation: input.confirmation?.id ?? null };
    if (first) {
      const result = await db.rpc("sms_prepare_first_contact_dispatch", { ...args, p_expected: first.senderId, p_generation: first.generation });
      if (result.error?.message === "affinity_first_contact_changed" || result.error?.message === "affinity_sender_unready") {
        throw new SmsError("SENDER_NOT_SELECTED", "This contact’s sending number changed. Refresh and review the From number.");
      }
      return checked(result);
    }
    return checked(sticky
      ? await db.rpc("sms_prepare_bound_dispatch", { ...args, p_expected: input.expectedSenderId ?? null, p_override: input.overrideSenderId ?? null })
      : await db.rpc("sms_prepare_dispatch", args));
  };
  if (sticky || first) {
    // Inspect only an already-existing intent here. Never reserve a new automated
    // send before its consent checks, and never hide a receipt behind new readiness.
    const prior = checked(await db.from("sms_dispatches").select("request_key")
      .eq("organization_id", input.org).eq("request_key", input.key).maybeSingle());
    if (prior) {
      await input.verifyRecipient?.();
      if (input.actor) {
        const actor = checked(await db.from("profiles").select("status,organization_id").eq("id", input.actor).maybeSingle());
        if (actor?.status !== "Active" || actor.organization_id !== input.org) throw new SmsError("ACTOR", "Your account cannot access this message.", 403);
      }
      const replay = await prepare(input.confirmation?.evidence ?? []);
      if (replay.state === "accepted") return {success:true,message_id:replay.message_id,provider_message_id:replay.provider_sid,status:replay.provider_status,replayed:true};
      if (first) rejectRecordedFirstContact(replay);
      if (replay.state !== "prepared") throw new SmsError("SEND_REVIEW", "This send already has an attempt. Check its recorded status.");
    }
  }
  if (first && (guard.sms !== "enforced" || guard.voice === "guard_only" || !p?.enforced)) {
    throw new SmsError("SMS_POLICY", "Texting settings changed. Refresh the contact before sending.", 503);
  }
  if (!p?.enforced) return null;
  if (!p.send_enabled) throw new SmsError("SMS_PAUSED", "Agency texting is not activated.");
  if (!sticky) {
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
  }
  let registered = sticky ? null : await registeredSender(db, input.org, from, input.actor);
  if (!sticky && !registered) {
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
  if (!manual) {
    for (const item of input.confirmation?.purposes ?? [category]) {
      evidence.push(...await eligibility(p, to, item, transport));
    }
  }
  if (input.confirmation) evidence = input.confirmation.evidence; // Job's immutable enrollment references; current decisions still checked above.
  const row = await prepare(evidence);
  if (row.blocked) throw new SmsError("NUMBER_REVIEW", "Call evidence is still being reconciled. Refresh before sending.");
  const receipt = (r: Record<string, string>, replayed: boolean): Receipt => ({
    success: true,
    message_id: r.message_id,
    provider_message_id: r.provider_sid,
    status: r.provider_status,
    replayed,
  });
  if (row.state === "accepted") return receipt(row, true);
  if (row.state !== "prepared") {
    if (first) rejectRecordedFirstContact(row);
    throw new SmsError(
      "SEND_REVIEW",
      "This send already has an attempt. Check its status before trying again.",
    );
  }
  let callbackUrl: string | undefined;
  try {
  if (first && (row.affinity_number_id !== first.senderId || phone(row.from_number) !== from ||
      row.affinity_override !== false)) throw new SmsError("SENDER_CHANGED", "Review the selected sending number.");
  if (sticky) { from = phone(row.from_number); registered = await authorizeSender(db, input.org, input.key, row, input.actor); }
  // Automated consent stays purpose-specific. Manual sends make no consent claim.
  // Both paths retain the final serialized local suppression/DNC check.
  if (!manual) {
    for (const item of input.confirmation?.purposes ?? [category]) {
      await eligibility(p, to, item, transport);
    }
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
  if (input.authorizeHandoff) {
    callbackUrl = await input.authorizeHandoff(from);
  } else if (
    !checked(
      await db.rpc(first ? "sms_start_first_contact_dispatch" : "sms_start_dispatch", {
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
  } catch (error) {
    if (sticky) await cancelPrepared(db, input.org, input.key);
    throw error;
  }
  if (!registered) throw new SmsError("A2P_NOT_READY", "Texting setup needs review.");
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
          ...(callbackUrl ? { StatusCallback: callbackUrl } : {}),
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
    // Only an explicit Twilio 4xx rejection without a SID proves that this first text
    // was not accepted. Keep other first-use failures unresolved and preserve older receipts.
    const definiteFirst = first && response.status >= 400 && response.status < 500 &&
      !payload.sid && typeof payload.code === "number" && Number.isSafeInteger(payload.code) && payload.code > 0;
    const uncertainFirst = first && !definiteFirst;
    const outcome = await finish(
      response.status >= 500 || uncertainFirst ? "uncertain" : "failed",
      uncertainFirst && payload.sid && /^SM[0-9a-f]{32}$/i.test(payload.sid) ? payload.sid : null,
      uncertainFirst && typeof payload.status === "string" ? payload.status : null,
      definiteFirst ? `first_contact_4xx:${payload.code}` : String(payload.code ?? response.status),
    );
    if (definiteFirst) rejectRecordedFirstContact(outcome);
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
    const saved = await finish("accepted", payload.sid, payload.status);
    if (saved.state !== "accepted" || !saved.message_id) throw new SmsError("SEND_ACCEPTED_REVIEW", "Provider accepted this text; its history needs review. Do not resend.", 503);
    return receipt(saved, false);
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
