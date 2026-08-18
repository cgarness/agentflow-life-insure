
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildDialedNumberCandidates,
  buildMissedCallNotificationRows,
  resolveMissedCallRecipients,
} from "./notification-recipients.ts";

export type MissedCallData = {
  id: string;
  contact_id: string | null;
  contact_type: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  organization_id: string | null;
  agent_id: string | null;
  /** The dialed AgentFlow number (calls.caller_id_used) — tier-2 owner lookup. */
  caller_id_used?: string | null;
  /** Agents actually rung, persisted by twilio-voice-inbound (calls.routed_agent_ids). */
  routed_agent_ids?: string[] | null;
};

/**
 * Exactly-once missed-call notifications.
 *
 * Recipient priority (see notification-recipients.ts for the documented scenarios):
 *   routed agents → dialed-number owner → contact's assigned agent → Admin/Team Leader fallback.
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
): Promise<void> {
  if (!call.organization_id) {
    console.warn("[notifications] Cannot insert missed call notification: missing organization_id");
    return;
  }

  const orgId = call.organization_id;

  // Tier 1 — routed agents, re-validated as Active profiles in the call's org so a corrupted
  // or cross-org id can never receive an alert.
  let routedAgentIds: string[] = [];
  const rawRouted = Array.isArray(call.routed_agent_ids)
    ? call.routed_agent_ids.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (rawRouted.length > 0) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .in("id", rawRouted)
      .eq("organization_id", orgId)
      .eq("status", "Active");
    if (error) {
      console.warn("[notifications] routed-agent validation failed:", error.message);
    } else {
      routedAgentIds = ((data || []) as Array<{ id: string }>).map((r) => r.id);
    }
  }

  // Tier 2 — the dialed number's owner (direct-line/assigned-number), org-scoped and validated.
  let numberOwnerId: string | null = null;
  if (routedAgentIds.length === 0 && call.caller_id_used) {
    const candidates = buildDialedNumberCandidates(call.caller_id_used);
    if (candidates.length > 0) {
      const { data: num } = await supabase
        .from("phone_numbers")
        .select("assigned_to")
        .eq("organization_id", orgId)
        .in("phone_number", candidates)
        .not("assigned_to", "is", null)
        .limit(1)
        .maybeSingle();
      const owner = (num as { assigned_to: string | null } | null)?.assigned_to ?? null;
      if (owner) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("id")
          .eq("id", owner)
          .eq("organization_id", orgId)
          .eq("status", "Active")
          .maybeSingle();
        if ((prof as { id: string } | null)?.id) numberOwnerId = owner;
      }
    }
  }

  // Tier 3 — the CRM contact's assigned agent (lead by default; client/recruit by contact_type).
  let contactAssignedAgentId: string | null = null;
  if (routedAgentIds.length === 0 && !numberOwnerId && call.contact_id) {
    const table =
      call.contact_type === "client"
        ? "clients"
        : call.contact_type === "recruit"
          ? "recruits"
          : "leads";
    const { data: contact } = await supabase
      .from(table)
      .select("assigned_agent_id")
      .eq("id", call.contact_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    contactAssignedAgentId =
      (contact as { assigned_agent_id: string | null } | null)?.assigned_agent_id ?? null;
  }

  // Tier 4 — org Admins + Team Leaders, only when nobody above resolved.
  let managerIds: string[] = [];
  if (routedAgentIds.length === 0 && !numberOwnerId && !contactAssignedAgentId) {
    const { data: admins } = await supabase
      .from("profiles")
      .select("id")
      .eq("organization_id", orgId)
      .in("role", ["Admin", "Team Leader"]);
    managerIds = ((admins || []) as Array<{ id: string }>).map((a) => a.id);
  }

  const { recipients, tier } = resolveMissedCallRecipients({
    routedAgentIds,
    numberOwnerId,
    contactAssignedAgentId,
    managerIds,
  });

  if (recipients.length === 0) {
    console.warn("[notifications] No recipients found for missed call notification", { orgId });
    return;
  }

  const rows = buildMissedCallNotificationRows({
    recipients,
    callId: call.id,
    organizationId: orgId,
    contactId: call.contact_id,
    contactName: call.contact_name,
    contactPhone: call.contact_phone,
  });

  const { error } = await supabase
    .from("notifications")
    .upsert(rows, { onConflict: "user_id,event_key", ignoreDuplicates: true });
  if (error) {
    console.error("[notifications] notifications upsert failed:", error.message);
  } else {
    console.log(
      `[notifications] Missed-call notifications ensured for call ${call.id} (tier=${tier}, recipients=${recipients.length})`,
    );
  }
}
