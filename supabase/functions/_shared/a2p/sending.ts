import { A2pError, campaignReady, type Db } from "./types.ts";
import { account, checked, registration } from "./store.ts";
import { credentials } from "./auth.ts";
import { TwilioA2p } from "./provider.ts";
/** Explicit rollout only. No missing-table/error fallback after rollout. */
export async function registeredSender(db: Db, org: string, from: string, actorId?: string) {
  const a = await account(db, org);
  if (!a?.sms_enforced) return null;
  const r = await registration(db, org);
  if (
    !a.enabled || !r || !campaignReady(r) || r.account_sid !== a.account_sid || !r.messaging_service_sid ||
    r.sync_error || !r.last_synced_at || Date.now() - Date.parse(r.last_synced_at) > 86400000
  ) {
    throw new A2pError(
      "A2P_NOT_READY",
      "This sender is not ready for texting. Ask an administrator to check A2P Registration.",
      409,
    );
  }
  const n = checked(
    await db.from("phone_numbers").select("id,twilio_sid,assignment_type,assigned_to,status").eq("organization_id", org)
      .eq("phone_number", from).maybeSingle(),
  ) as Record<string, any> | null;
  if (
    !n || !["active", "Active"].includes(n.status) || (n.assignment_type === "personal" && n.assigned_to !== actorId)
  ) throw new A2pError("SENDER_NOT_ALLOWED", "This sender is unavailable.", 403);
  const state = checked(
    await db.from("a2p_numbers").select("status,messaging_service_sid").eq("organization_id", org).eq(
      "phone_number_id",
      n.id,
    ).eq("phone_sid", n.twilio_sid).maybeSingle(),
  ) as Record<string, any> | null;
  if (state?.status !== "registered" || state.messaging_service_sid !== r.messaging_service_sid) {
    throw new A2pError("NUMBER_NOT_REGISTERED", "This phone number has not completed A2P registration.", 409);
  }
  const creds = await credentials(db, a);
  const t = new TwilioA2p(creds);
  await t.number(n.twilio_sid);
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

/** Automated messages use an active, registered agency number, never a personal sender. */
export async function registeredWorkflowNumber(db: Db, org: string): Promise<string | null> {
  const a = await account(db, org);
  if (!a?.sms_enforced) return null;
  const r = await registration(db, org);
  if (!r?.messaging_service_sid) throw new A2pError("A2P_NOT_READY", "Agency A2P registration is incomplete.", 409);
  const mappings = checked(
    await db.from("a2p_numbers").select("phone_number_id").eq("organization_id", org)
      .eq("messaging_service_sid", r.messaging_service_sid).eq("status", "registered"),
  ) as { phone_number_id: string }[];
  if (!mappings.length) throw new A2pError("NUMBER_NOT_REGISTERED", "No registered agency sender is available.", 409);
  const n = checked(
    await db.from("phone_numbers").select("phone_number").eq("organization_id", org)
      .eq("assignment_type", "agency").in("status", ["active", "Active"]).in(
        "id",
        mappings.map((n) => n.phone_number_id),
      )
      .order("is_default", { ascending: false }).order("id").limit(1).maybeSingle(),
  ) as { phone_number: string } | null;
  if (!n) throw new A2pError("SENDER_NOT_ALLOWED", "No active registered agency sender is available.", 409);
  return n.phone_number;
}
