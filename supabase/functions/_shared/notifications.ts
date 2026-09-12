
// Deno-free on purpose (no esm.sh import): the client is typed STRUCTURALLY so this module runs under
// vitest (src/lib/__tests__/missedRecipientTier0.test.ts) and under Deno with the real supabase-js client.
import {
  buildMissedCallNotificationRows,
  hasRecipientSnapshot,
  isV2EngineCall,
  resolveMissedCallRecipientsFromDb,
  type MissedCallDbCall,
} from "./notification-recipients.ts";

export type MissedCallData = MissedCallDbCall;

/**
 * Structural client shape (Deno-free): `from` for the legacy tiers and `rpc` for the v2 convergence.
 * The real supabase-js client satisfies both; tests inject a fake.
 */
export interface MissedCallNotificationDb {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  // deno-lint-ignore no-explicit-any
  rpc?(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }>;
}

/**
 * Inbound Calling v2 / D13 (safeguard 2): a row that carries the durable recipient snapshot is
 * converged by ONE rule — `converge_inbound_notifications` (M7): recipients = the snapshot's Active
 * members (else Active Admins), completion = a row for EVERY recipient (then `missed_notified_at` is
 * stamped), bounded per-record retries, and the pg_cron sweep owns anything left owed. The Edge
 * handlers never build a D13 row themselves, so twilio-voice-inbound, twilio-voice-status and the
 * sweep cannot disagree about who is notified.
 */
export async function convergeSnapshotNotifications(
  db: MissedCallNotificationDb,
  call: Pick<MissedCallData, "id">,
): Promise<MissedNotificationResult> {
  if (typeof db.rpc !== "function") {
    return { ok: false, retryable: true, reason: "converge_rpc_unavailable" };
  }
  let result: { data: unknown; error: { message: string } | null };
  try {
    result = await db.rpc("converge_inbound_notifications", { p_call_row_id: call.id });
  } catch (err) {
    console.error("[notifications] converge_inbound_notifications threw:", err);
    return { ok: false, retryable: true, reason: "converge_rpc_threw" };
  }
  if (result.error) {
    console.error("[notifications] converge_inbound_notifications failed:", result.error.message);
    return { ok: false, retryable: true, reason: "converge_rpc_failed" };
  }
  const d = (result.data && typeof result.data === "object" ? result.data : {}) as {
    missed_notified?: boolean | null; voicemails_owed?: number; voicemails_notified?: number;
  };
  if (d.missed_notified === false) {
    // Incomplete (a recipient row could not be inserted or nobody is Active): the SQL sweep retries with
    // backoff. Not a webhook-retryable condition — a redelivery would run the same rule.
    console.warn(`[notifications] missed-call convergence incomplete for call ${call.id} — sweep owns the retry`);
    return { ok: true, retryable: false, reason: "converge_incomplete_sweep_owned" };
  }
  console.log(`[notifications] D13 notifications converged for call ${call.id} (tier=snapshot)`);
  return { ok: true, retryable: false, reason: "converged" };
}

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
  supabase: MissedCallNotificationDb,
  call: MissedCallData,
): Promise<MissedNotificationResult> {
  if (!call.organization_id) {
    console.warn("[notifications] Cannot insert missed call notification: missing organization_id");
    return { ok: false, retryable: false, reason: "missing_organization_id" };
  }

  // D13 tier 0: snapshot rows never go through tiers 1–4 in TypeScript.
  // Corrective pass 7, finding 2: neither do rows the v2 engine routed. Their recipients are decided by
  // the SQL rule alone; an EMPTY snapshot on such a row means the intended recipient could not be resolved
  // yet, and resolving it is convergence's job (it retries from validated evidence and records owed work).
  // Reading an empty v2 snapshot as "no snapshot" is what notified the dialled number's owner instead.
  if (hasRecipientSnapshot(call) || isV2EngineCall(call)) {
    return await convergeSnapshotNotifications(supabase, call);
  }

  const resolution = await resolveMissedCallRecipientsFromDb(supabase, call);
  if (resolution.ok === false) {
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
    missedReason: call.missed_reason ?? null,
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
