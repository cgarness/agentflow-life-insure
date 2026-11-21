import { A2pError, campaignReady, type Db } from "./types.ts";
import { account, checked, registration } from "./store.ts";
import { credentials } from "./auth.ts";
import { TwilioA2p } from "./provider.ts";
/** Explicit rollout only. No missing-table/error fallback after rollout. */
export async function registeredSender(
  db: Db,
  org: string,
  from: string,
  actorId?: string,
  route?: "legacy-direct",
) {
  // Toll-free verification is separate from 10DLC and Trust Hub. This voice-only
  // release has no verified toll-free senders, including in legacy SMS agencies.
  const normalized = from.replace(/[\s().-]/g, "");
  if (/^(?:\+?1)?(?:800|833|844|855|866|877|888)\d{7}$/.test(normalized)) {
    throw new A2pError(
      "TOLL_FREE_SMS_DISABLED",
      "Texting is unavailable for toll-free numbers until toll-free verification is supported and approved.",
      409,
    );
  }
  let canonical = normalized;
  if (/^\d{10}$/.test(normalized)) canonical = `+1${normalized}`;
  if (/^1\d{10}$/.test(normalized)) canonical = `+${normalized}`;
  if (!/^\+[1-9]\d{6,14}$/.test(canonical)) {
    throw new A2pError("SENDER_NOT_ALLOWED", "This sender is unavailable.", 403);
  }
  // The purchase receipt remains authoritative even if a phone is deleted or the agency has no A2P setup.
  // Look up by number before allowing the historical fallback on a shared master account.
  const [a, receipt] = await Promise.all([
    account(db, org),
    db.rpc("phone_number_setup_managed", { p_org: org, p_number: canonical }).then(checked),
  ]);
  if (typeof receipt?.managed !== "boolean") {
    throw new A2pError("DATABASE_ERROR", "Could not verify the sender's purchase.", 503);
  }
  if (receipt.managed && receipt.owned !== true) {
    throw new A2pError("SENDER_NOT_ALLOWED", "This sender is unavailable.", 403);
  }
  // A legacy endpoint may have read its agency policy before activation. Only dispatch
  // enforces recipient consent and suppression, even when the policy is active by this read.
  if (receipt.managed && receipt.policy_enforced !== true) {
    throw new A2pError("SMS_PAUSED", "Agency texting must be activated before this number can send. Contact AgentFlow support.", 409);
  }
  if (receipt.managed && receipt.policy_enabled !== true) {
    throw new A2pError("SMS_PAUSED", "Agency texting is paused.", 409);
  }
  if (receipt.managed && route === "legacy-direct") {
    throw new A2pError("SMS_POLICY", "Texting settings changed. Refresh before sending.", 503);
  }
  if (receipt.managed && receipt.agency_active !== true) {
    throw new A2pError("A2P_NOT_READY", "Agency texting is unavailable.", 409);
  }
  if (!a?.sms_enforced) {
    if (!receipt.managed) return null;
    throw new A2pError("A2P_NOT_READY", "This number is waiting for agency texting approval.", 409);
  }
  const r = await registration(db, org);
  if (
    !a.enabled || !r || !campaignReady(r) || r.account_sid !== a.account_sid || !r.messaging_service_sid ||
    r.sync_error || !r.last_synced_at || !Number.isFinite(Date.parse(r.last_synced_at)) ||
    Date.now() - Date.parse(r.last_synced_at) > 86400000 ||
    (receipt.managed && (receipt.account_sid !== a.account_sid || !a.resources_reconciled_at || !r.brand_sid || !r.campaign_sid))
  ) {
    throw new A2pError(
      "A2P_NOT_READY",
      "This sender is not ready for texting. Ask an administrator to check A2P Registration.",
      409,
    );
  }
  const n = checked(
    await db.from("phone_numbers").select("id,twilio_sid,assignment_type,assigned_to,status,inbounds_only").eq("organization_id", org)
      .eq("phone_number", canonical).maybeSingle(),
  ) as Record<string, any> | null;
  if (
    !n || !["active", "Active"].includes(n.status) || n.inbounds_only === true ||
    (receipt.managed && (n.id !== receipt.phone_number_id || n.twilio_sid !== receipt.phone_sid)) ||
    (n.assignment_type === "personal" && n.assigned_to !== actorId)
  ) throw new A2pError("SENDER_NOT_ALLOWED", "This sender is unavailable.", 403);
  const state = checked(
    await db.from("a2p_numbers").select("status,messaging_service_sid,event_at,pool_member,checked_at").eq("organization_id", org).eq(
      "phone_number_id",
      n.id,
    ).eq("phone_sid", n.twilio_sid).maybeSingle(),
  ) as Record<string, any> | null;
  if (
    state?.status !== "registered" || state.messaging_service_sid !== r.messaging_service_sid ||
    (receipt.managed && (
      state.pool_member !== true || !Number.isFinite(Date.parse(state.event_at)) ||
      !Number.isFinite(Date.parse(state.checked_at)) || Date.now() - Date.parse(state.checked_at) > 86400000
    ))
  ) {
    throw new A2pError("NUMBER_NOT_REGISTERED", "This phone number has not completed A2P registration.", 409);
  }
  if (receipt.managed && receipt.policy_selected !== true) {
    throw new A2pError("SENDER_NOT_SELECTED", "This number is not selected for agency texting.", 409);
  }
  const creds = await credentials(db, a);
  const t = new TwilioA2p(creds);
  const providerNumber = await t.number(n.twilio_sid);
  if (receipt.managed && providerNumber.phone_number !== canonical) {
    throw new A2pError("SENDER_NOT_ALLOWED", "This sender is unavailable.", 403);
  }
  // Check current membership immediately before sending, including silent Console removals.
  const member = await t.call(
    `https://messaging.twilio.com/v1/Services/${r.messaging_service_sid}/PhoneNumbers/${n.twilio_sid}`,
  );
  if (
    member.sid !== n.twilio_sid || member.service_sid !== r.messaging_service_sid ||
    member.account_sid !== a.account_sid
  ) throw new A2pError("SENDER_REMOVED", "This sender is no longer in its registered messaging service.", 409);
  return { ...creds, messagingServiceSid: r.messaging_service_sid };
}

/** Find a registered agency sender or a previously eligible sender for a legacy agency. */
export async function registeredWorkflowNumber(db: Db, org: string): Promise<string> {
  const a = await account(db, org);
  if (!a?.sms_enforced) {
    const legacy = checked(await db.rpc("phone_number_setup_legacy_workflow_sender", { p_org: org }));
    if (typeof legacy !== "string" || !legacy) {
      throw new A2pError("SENDER_NOT_ALLOWED", "No active agency texting number is available.", 409);
    }
    return legacy;
  }
  const r = await registration(db, org);
  if (!r?.messaging_service_sid) throw new A2pError("A2P_NOT_READY", "Agency A2P registration is incomplete.", 409);
  const mappings = checked(
    await db.from("a2p_numbers").select("phone_number_id").eq("organization_id", org)
      .eq("messaging_service_sid", r.messaging_service_sid).eq("status", "registered"),
  ) as { phone_number_id: string }[];
  if (!mappings.length) throw new A2pError("NUMBER_NOT_REGISTERED", "No registered agency sender is available.", 409);
  const n = checked(
    await db.from("phone_numbers").select("phone_number").eq("organization_id", org)
      .eq("assignment_type", "agency").eq("inbounds_only", false).in("status", ["active", "Active"]).in(
        "id",
        mappings.map((n) => n.phone_number_id),
      )
      .order("is_default", { ascending: false }).order("id").limit(1).maybeSingle(),
  ) as { phone_number: string } | null;
  if (!n) throw new A2pError("SENDER_NOT_ALLOWED", "No active registered agency sender is available.", 409);
  return n.phone_number;
}
