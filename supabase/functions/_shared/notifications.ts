
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildMissedCallNotificationRows,
  resolveMissedCallRecipientsFromDb,
  type MissedCallDbCall,
} from "./notification-recipients.ts";

export type MissedCallData = MissedCallDbCall;

/**
 * Rev 7 C9 — the caller must be able to tell a CONVERGED attempt from one that aborted, so a
 * webhook can answer 5xx and have Twilio redeliver. `ok:false, retryable:true` means nothing was
 * inserted for a transient reason (recipient resolution error, notifications upsert error) and the
 * caller SHOULD retry; `retryable:false` marks a permanent, non-retryable condition.
 */
export type MissedNotificationResult = {
  ok: boolean;
  retryable: boolean;
  reason?: string;
  recipients?: number;
};

/**
 * Exactly-once missed-call notifications.
 *
 * Recipient priority (see notification-recipients.ts for the documented scenarios):
 *   routed agents → dialed-number owner → contact's assigned agent → Active Admin/Team Leader
 *   fallback. Resolution is FAIL-CLOSED: any lookup/validation error aborts this attempt
 *   entirely (logged, nothing inserted) rather than being read as an empty tier — a transient
 *   DB error must never turn into a manager blast. The webhooks retry and the other missed-call
 *   writer covers the same call, so an aborted attempt converges on the next invocation.
 *
 * Idempotency is DB-enforced: every row carries event_key `missed_call:<call_id>` and the
 * UNIQUE (user_id, event_key) index arbitrates via an ignore-duplicates upsert. Concurrent
 * webhooks (twilio-voice-inbound × twilio-voice-status) converge to one row per recipient,
 * and a partially-delivered earlier attempt fills in only the missing recipients. There is
 * deliberately NO read-before-insert check (the old `.maybeSingle()` pre-check was both racy
 * and broken for multi-recipient fan-outs). A user-dismissed row (dismissed_at set) keeps its
 * event_key until the 30-day retention cron deletes it, so retries cannot resurrect it.
 */
export async function insertMissedCallNotifications(
  supabase: SupabaseClient,
  call: MissedCallData,
): Promise<MissedNotificationResult> {
  if (!call.organization_id) {
    console.warn("[notifications] Cannot insert missed call notification: missing organization_id");
    return { ok: false, retryable: false, reason: "missing_organization_id" };
  }

  const resolution = await resolveMissedCallRecipientsFromDb(supabase, call);
  if (!resolution.ok) {
    // Fail closed: no insert, no tier fall-through. The retrying webhook / other writer
    // re-attempts against the same idempotent event key.
    console.error(
      `[notifications] Missed-call recipient resolution failed at tier=${resolution.failedTier} for call ${call.id}: ${resolution.message} — aborting this attempt (no fallback blast)`,
    );
    return { ok: false, retryable: true, reason: `recipient_resolution_failed:${resolution.failedTier}` };
  }

  if (resolution.recipients.length === 0) {
    console.warn("[notifications] No recipients found for missed call notification", {
      orgId: call.organization_id,
    });
    // Not a failure: resolution succeeded and legitimately produced nobody to notify. Retrying
    // would produce the same empty result.
    return { ok: true, retryable: false, reason: "no_recipients", recipients: 0 };
  }

  const rows = buildMissedCallNotificationRows({
    recipients: resolution.recipients,
    callId: call.id,
    organizationId: call.organization_id,
    contactId: call.contact_id,
    contactName: call.contact_name,
    contactPhone: call.contact_phone,
  });

  const { error } = await supabase
    .from("notifications")
    .upsert(rows, { onConflict: "user_id,event_key", ignoreDuplicates: true });
  if (error) {
    console.error("[notifications] notifications upsert failed:", error.message);
    return { ok: false, retryable: true, reason: "notifications_upsert_failed" };
  }
  console.log(
    `[notifications] Missed-call notifications ensured for call ${call.id} (tier=${resolution.tier}, recipients=${resolution.recipients.length})`,
  );
  return { ok: true, retryable: false, recipients: resolution.recipients.length };
}
