// Pure, dependency-free notification recipient/event-key logic shared by the notification-writing
// Edge Functions. Kept Deno-free so it can be unit-tested under vitest (see
// src/lib/__tests__/notificationRecipients.test.ts — the twilio-voice-status/duration.ts pattern).
//
// Missed-call recipient priority (approved product behavior, rulings D2/D3):
//   1. routed  — the agents actually rung by inbound routing, as persisted on
//                calls.routed_agent_ids by twilio-voice-inbound (direct line, assigned,
//                round-robin pick, every all-ring agent, the union of fallback-chain waves).
//   2. number_owner — the dialed number's assigned_to owner (direct-line/assigned-number
//                owner), the fallback when routing info was never captured (legacy rows,
//                after-hours calls that rang nobody, persistence failure).
//   3. contact_agent — the CRM contact's assigned agent.
//   4. managers — org Admins/Team Leaders, ONLY as a true no-owner fallback.
// A known routed agent never falls through to the manager blast. Forward-to-PSTN legs carry
// no agent id (an external phone), so a forwarded-and-missed call resolves via the wave that
// preceded the forward, or tiers 2-4. Unknown/unmatched callers use the same chain.

export type MissedCallRecipientTier =
  | "routed"
  | "number_owner"
  | "contact_agent"
  | "managers"
  | "none";

export type MissedCallRecipientInputs = {
  /** Tier 1 — already validated as Active profiles in the call's organization. */
  routedAgentIds: string[];
  /** Tier 2 — validated Active org profile owning the dialed number, if any. */
  numberOwnerId: string | null;
  /** Tier 3 — the matched CRM contact's assigned agent, if any. */
  contactAssignedAgentId: string | null;
  /** Tier 4 — org Admins/Team Leaders. */
  managerIds: string[];
};

function dedupeNonEmpty(ids: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id === "string" && id.length > 0 && !out.includes(id)) out.push(id);
  }
  return out;
}

export function resolveMissedCallRecipients(
  inputs: MissedCallRecipientInputs,
): { recipients: string[]; tier: MissedCallRecipientTier } {
  const routed = dedupeNonEmpty(inputs.routedAgentIds);
  if (routed.length > 0) return { recipients: routed, tier: "routed" };

  const owner = dedupeNonEmpty([inputs.numberOwnerId]);
  if (owner.length > 0) return { recipients: owner, tier: "number_owner" };

  const contactAgent = dedupeNonEmpty([inputs.contactAssignedAgentId]);
  if (contactAgent.length > 0) return { recipients: contactAgent, tier: "contact_agent" };

  const managers = dedupeNonEmpty(inputs.managerIds);
  if (managers.length > 0) return { recipients: managers, tier: "managers" };

  return { recipients: [], tier: "none" };
}

// ── Event keys (unique with the recipient via UNIQUE (user_id, event_key)) ──────────────────

export function missedCallEventKey(callId: string): string {
  return `missed_call:${callId}`;
}

export function inboundSmsEventKey(
  messageSid: string | null | undefined,
  messageRowId: string | null | undefined,
): string | null {
  const sid = (messageSid || "").trim();
  if (sid) return `inbound_sms:${sid}`;
  const rowId = (messageRowId || "").trim();
  if (rowId) return `inbound_sms:msg:${rowId}`;
  return null;
}

export function inboundEmailEventKey(contactEmailRowId: string | null | undefined): string | null {
  const rowId = (contactEmailRowId || "").trim();
  return rowId ? `inbound_email:${rowId}` : null;
}

// ── Dialed-number candidates for the tier-2 owner lookup ────────────────────────────────────

/** US-centric phone format variants for matching phone_numbers.phone_number. */
export function buildDialedNumberCandidates(raw: string | null | undefined): string[] {
  const trimmed = (raw || "").trim();
  if (!trimmed) return [];
  const digits = trimmed.replace(/\D/g, "");
  const candidates: string[] = [trimmed];
  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    candidates.push(`+1${last10}`, `1${last10}`, last10);
    if (digits.length === 11) candidates.push(`+${digits}`);
  }
  return dedupeNonEmpty(candidates);
}

// ── Missed-call notification row builder ────────────────────────────────────────────────────

export type MissedCallNotificationRow = {
  user_id: string;
  type: "missed_call";
  title: string;
  body: string;
  action_url: string | null;
  action_label: string | null;
  organization_id: string;
  metadata: { contact_id: string | null; phone: string; call_id: string };
  read: false;
  event_key: string;
};

export function buildMissedCallNotificationRows(args: {
  recipients: string[];
  callId: string;
  organizationId: string;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
}): MissedCallNotificationRow[] {
  const name =
    (args.contactName && args.contactName.trim()) ||
    (args.contactPhone && args.contactPhone.trim()) ||
    "Unknown caller";
  const phone = args.contactPhone || "";
  const body = phone ? `Missed call from ${name} (${phone})` : `Missed call from ${name}`;
  const actionUrl = args.contactId ? `/contacts?contact=${args.contactId}` : null;
  const eventKey = missedCallEventKey(args.callId);

  return args.recipients.map((uid) => ({
    user_id: uid,
    type: "missed_call" as const,
    title: "Missed Call",
    body,
    action_url: actionUrl,
    action_label: actionUrl ? "View Contact" : null,
    organization_id: args.organizationId,
    metadata: { contact_id: args.contactId, phone, call_id: args.callId },
    read: false as const,
    event_key: eventKey,
  }));
}

// ── DB-backed tier resolution (fail closed) ─────────────────────────────────────────────────
// Deno-free: the client is typed structurally so this logic runs under vitest with a mock and
// under Deno with the real supabase-js client. FAIL-CLOSED CONTRACT: a lookup/validation error
// aborts resolution (ok:false) — it is never interpreted as an empty tier, and it can never
// escalate into the Admin/Team-Leader fallback. Each tier is consulted only after the previous
// tier SUCCESSFULLY established that no valid recipient exists.

/** Minimal structural shape of the supabase client this module needs. */
export interface MissedCallDb {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

export type MissedCallDbCall = {
  id: string;
  contact_id: string | null;
  contact_type: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  organization_id: string | null;
  agent_id: string | null;
  caller_id_used?: string | null;
  routed_agent_ids?: string[] | null;
};

export type MissedCallResolution =
  | { ok: true; recipients: string[]; tier: MissedCallRecipientTier }
  | { ok: false; failedTier: "routed" | "number_owner" | "contact_agent" | "managers"; message: string };

export async function resolveMissedCallRecipientsFromDb(
  db: MissedCallDb,
  call: MissedCallDbCall,
): Promise<MissedCallResolution> {
  const orgId = call.organization_id as string;

  // Tier 1 — routed agents, re-validated as Active profiles in the call's org.
  let routedAgentIds: string[] = [];
  const rawRouted = Array.isArray(call.routed_agent_ids)
    ? call.routed_agent_ids.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (rawRouted.length > 0) {
    const { data, error } = await db
      .from("profiles")
      .select("id")
      .in("id", rawRouted)
      .eq("organization_id", orgId)
      .eq("status", "Active");
    if (error) {
      return { ok: false, failedTier: "routed", message: error.message ?? "routed validation failed" };
    }
    routedAgentIds = ((data || []) as Array<{ id: string }>).map((r) => r.id);
    // A successful validation that yields nobody means the routed ids are stale/invalid —
    // that is an established-empty tier, so the chain may continue.
  }

  // Tier 2 — the dialed number's owner, org-scoped and validated Active.
  let numberOwnerId: string | null = null;
  if (routedAgentIds.length === 0 && call.caller_id_used) {
    const candidates = buildDialedNumberCandidates(call.caller_id_used);
    if (candidates.length > 0) {
      const { data: num, error: numError } = await db
        .from("phone_numbers")
        .select("assigned_to")
        .eq("organization_id", orgId)
        .in("phone_number", candidates)
        .not("assigned_to", "is", null)
        .limit(1)
        .maybeSingle();
      if (numError) {
        return { ok: false, failedTier: "number_owner", message: numError.message ?? "number lookup failed" };
      }
      const owner = (num as { assigned_to: string | null } | null)?.assigned_to ?? null;
      if (owner) {
        const { data: prof, error: profError } = await db
          .from("profiles")
          .select("id")
          .eq("id", owner)
          .eq("organization_id", orgId)
          .eq("status", "Active")
          .maybeSingle();
        if (profError) {
          return { ok: false, failedTier: "number_owner", message: profError.message ?? "owner validation failed" };
        }
        if ((prof as { id: string } | null)?.id) numberOwnerId = owner;
      }
    }
  }

  // Tier 3 — the CRM contact's assigned agent, validated Active in the call's org.
  let contactAssignedAgentId: string | null = null;
  if (routedAgentIds.length === 0 && !numberOwnerId && call.contact_id) {
    const table =
      call.contact_type === "client" ? "clients" : call.contact_type === "recruit" ? "recruits" : "leads";
    const { data: contact, error: contactError } = await db
      .from(table)
      .select("assigned_agent_id")
      .eq("id", call.contact_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (contactError) {
      return { ok: false, failedTier: "contact_agent", message: contactError.message ?? "contact lookup failed" };
    }
    const assigned = (contact as { assigned_agent_id: string | null } | null)?.assigned_agent_id ?? null;
    if (assigned) {
      const { data: prof, error: profError } = await db
        .from("profiles")
        .select("id")
        .eq("id", assigned)
        .eq("organization_id", orgId)
        .eq("status", "Active")
        .maybeSingle();
      if (profError) {
        return { ok: false, failedTier: "contact_agent", message: profError.message ?? "agent validation failed" };
      }
      if ((prof as { id: string } | null)?.id) contactAssignedAgentId = assigned;
    }
  }

  // Tier 4 — Active Admins/Team Leaders in the call's org, only after tiers 1-3 established empty.
  let managerIds: string[] = [];
  if (routedAgentIds.length === 0 && !numberOwnerId && !contactAssignedAgentId) {
    const { data: admins, error: adminsError } = await db
      .from("profiles")
      .select("id")
      .eq("organization_id", orgId)
      .eq("status", "Active")
      .in("role", ["Admin", "Team Leader"]);
    if (adminsError) {
      return { ok: false, failedTier: "managers", message: adminsError.message ?? "manager lookup failed" };
    }
    managerIds = ((admins || []) as Array<{ id: string }>).map((a) => a.id);
  }

  return {
    ok: true,
    ...resolveMissedCallRecipients({ routedAgentIds, numberOwnerId, contactAssignedAgentId, managerIds }),
  };
}
