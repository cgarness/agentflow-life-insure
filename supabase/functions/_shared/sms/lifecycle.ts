import type { Db } from "../a2p/types.ts";
import { account, registration } from "../a2p/store.ts";
import { credentials } from "../a2p/auth.ts";
import { TwilioA2p } from "../a2p/provider.ts";
import { bridge, checked, policy } from "./consent.ts";
import { isStop } from "./webhook.ts";
import { phone, SmsError } from "./wire.ts";

export interface KeywordJob {
  organization_id: string;
  message_sid: string;
  phone_e164: string;
  keyword: "STOP" | "START";
  attempts: number;
}

/** Only a provider GET supplies event time; webhook arrival and caller dates do not. */
export function verifiedKeyword(
  job: KeywordJob,
  message: Record<string, unknown>,
  accountSid: string,
  serviceSid: string,
  selectedNumbers: string[],
  now = Date.now(),
) {
  const body = typeof message.body === "string" ? message.body : "";
  const at = typeof message.date_sent === "string"
    ? Date.parse(message.date_sent)
    : NaN;
  const expected = job.keyword === "START"
    ? body.trim().toUpperCase() === "START"
    : isStop({ Body: body });
  if (
    message.sid !== job.message_sid || message.account_sid !== accountSid ||
    message.messaging_service_sid !== serviceSid ||
    message.direction !== "inbound" || message.status !== "received" ||
    message.from !== job.phone_e164 || typeof message.to !== "string" ||
    !selectedNumbers.includes(message.to) || !expected ||
    !Number.isFinite(at) || at > now + 60000
  ) {
    throw new SmsError(
      "KEYWORD_PROOF",
      "Keyword evidence requires review.",
      503,
    );
  }
  return { to: message.to, at: new Date(at).toISOString() };
}

export async function processLifecycle(db: Db, transport = fetch) {
  const jobs = checked<KeywordJob[]>(
    await db.from("sms_keyword_jobs").select("*").is("verified_at", null)
      .lt("attempts", 16).lte("retry_at", new Date().toISOString()).limit(5),
  );
  for (const job of jobs ?? []) {
    try {
      const p = await policy(db, job.organization_id);
      const a = await account(db, job.organization_id);
      const r = await registration(db, job.organization_id);
      if (
        !p?.enforced || !a || r?.account_sid !== a.account_sid ||
        !r.messaging_service_sid
      ) throw new Error("keyword_scope");
      const numbers = checked<{ phone_number: string }[]>(
        await db.from("phone_numbers").select("phone_number")
          .eq("organization_id", job.organization_id)
          .eq("assignment_type", "agency").in("id", p.selected_phone_ids)
          .in("status", ["active", "Active"]),
      );
      const provider = new TwilioA2p(
        await credentials(db, a),
        transport,
        AbortSignal.timeout(10000),
      );
      const message = await provider.call(
        `https://api.twilio.com/2010-04-01/Accounts/${a.account_sid}/Messages/${job.message_sid}.json`,
      );
      const proof = verifiedKeyword(
        job,
        message,
        a.account_sid,
        r.messaging_service_sid,
        numbers.map((n) => n.phone_number),
      );
      checked(
        await db.rpc("sms_verify_keyword", {
          p_org: job.organization_id,
          p_sid: job.message_sid,
          p_phone: job.phone_e164,
          p_to: proof.to,
          p_keyword: job.keyword,
          p_at: proof.at,
        }),
      );
    } catch {
      // No consent changes on unavailable, conflicting, malformed or historical proof.
      checked(
        await db.from("sms_keyword_jobs").update({
          attempts: job.attempts + 1,
          retry_at: new Date(Date.now() + 60000).toISOString(),
        }).eq("organization_id", job.organization_id)
          .eq("message_sid", job.message_sid).is("verified_at", null),
      );
    }
  }
  const pending = checked(
    await db.from("sms_recipient_lifecycle").select("*").is("synced_at", null)
      .lte("retry_at", new Date().toISOString()).limit(5),
  );
  for (const s of pending ?? []) {
    try {
      const p = await policy(db, s.organization_id);
      if (!p?.enforced) throw new Error("policy_missing");
      const result = await bridge(p, {
        action: "lifecycle",
        phone: s.phone_e164,
        revision: s.revision,
        restored: s.informational_restored,
        start_event: s.start_event_id,
        prior_event: s.prior_consent_event,
        first_stop_at: s.first_stop_at,
        start_at: s.start_at,
      }, transport);
      if (
        result.organization_id !== s.organization_id ||
        result.profile_id !== p.uv_profile_id ||
        result.phone !== phone(s.phone_e164) ||
        result.revision !== s.revision ||
        result.restored !== s.informational_restored ||
        (s.informational_restored && result.informational_allowed !== true)
      ) throw new Error("lifecycle_ack_mismatch");
      checked(
        await db.rpc("sms_ack_lifecycle", {
          p_org: s.organization_id,
          p_phone: s.phone_e164,
          p_revision: s.revision,
          p_restored: s.informational_restored,
        }),
      );
    } catch {
      checked(
        await db.from("sms_recipient_lifecycle").update({
          retry_at: new Date(Date.now() + 60000).toISOString(),
        }).eq("organization_id", s.organization_id).eq(
          "phone_e164",
          s.phone_e164,
        )
          .eq("revision", s.revision).is("synced_at", null),
      );
    }
  }
  return { keywords: jobs?.length ?? 0, lifecycle: pending?.length ?? 0 };
}
