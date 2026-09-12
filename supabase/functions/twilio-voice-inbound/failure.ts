// Inbound Calling v2 — the infrastructure-failure dependency wiring (corrective pass 5, finding 4). Deno-free
// so the REAL notification helper (_shared/notifications.ts + notification-recipients.ts) is exercised in
// src/lib/__tests__/inboundFailureNotification.test.ts against a fake PostgREST client.
//
// The ONE atomic failure decision is abandon_inbound_routing (finalize 'no-answer' + D13 classification with
// the intended recipients + closure of the open ring stage). Notification work runs strictly AFTER a
// SUCCESSFUL decision, in the background, and honours the COMMITTED classification: the call row is re-read
// with the complete D13 projection and handed to the shared helper, whose tier 0 routes a snapshot row to the
// authoritative SQL rule (converge_inbound_notifications). Corrective pass 7: the projection also carries
// `routing_engine`, so a v2 row goes to that rule whether or not its snapshot is populated — an empty v2
// snapshot is an unresolved recipient (owed work the SQL retries), never permission to notify a fallback.
// Only a LEGACY call (no v2 decision) keeps the legacy tiers. A decision that did not land (`is_missed` false) is
// never turned into a separate legacy classification: the durable sweeps converge it later.

import type { InfrastructureFailureDeps } from "./settings.ts";

export interface FailureDb {
  // deno-lint-ignore no-explicit-any
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: { message: string } | null }>;
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

/** The complete projection the notification helper needs — including every D13 column (tier 0). */
export const MISSED_CALL_NOTIFICATION_PROJECTION =
  "id, organization_id, contact_id, contact_type, contact_name, contact_phone, agent_id, caller_id_used, routed_agent_ids, is_missed, missed_reason, missed_for_agent_id, missed_recipient_ids, missed_notified_at, routing_engine";

export interface MissedCallRow {
  id: string;
  organization_id: string | null;
  contact_id: string | null;
  contact_type: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  agent_id: string | null;
  caller_id_used: string | null;
  routed_agent_ids: string[] | null;
  is_missed: boolean | null;
  missed_reason: string | null;
  missed_for_agent_id: string | null;
  missed_recipient_ids: string[] | null;
  missed_notified_at: string | null;
  /** corrective pass 7: the per-call engine decision — a v2 row never uses the legacy recipient tiers. */
  routing_engine: string | null;
}

export type Notifier = (db: FailureDb, row: MissedCallRow) => Promise<unknown>;

export type NotifyAfterAbandonResult =
  | { kind: "delivered"; result: unknown }
  | { kind: "skipped"; reason: "not_missed" | "already_notified" | "call_unavailable" | "not_found" };

/**
 * Notification strictly from the COMMITTED classification: re-read the row with the full projection; a row
 * that is not (yet) missed is skipped — never classified here — and a row already notified is skipped.
 */
export async function notifyAfterAbandon(
  db: FailureDb,
  notifier: Notifier,
  callRowId: string,
  organizationId: string,
  log?: (message: string, meta?: Record<string, unknown>) => void,
): Promise<NotifyAfterAbandonResult> {
  const { data, error } = await db
    .from("calls")
    .select(MISSED_CALL_NOTIFICATION_PROJECTION)
    .eq("id", callRowId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    log?.("failure notification: committed row unavailable — left to the notification sweep", { callRowId, error: error.message });
    return { kind: "skipped", reason: "call_unavailable" };
  }
  const row = data as MissedCallRow | null;
  if (!row) return { kind: "skipped", reason: "not_found" };
  if (row.is_missed !== true) {
    log?.("failure notification: the abandon decision has not landed — no legacy classification, the sweeps converge later", { callRowId });
    return { kind: "skipped", reason: "not_missed" };
  }
  if (row.missed_notified_at) return { kind: "skipped", reason: "already_notified" };
  const result = await notifier(db, row);
  return { kind: "delivered", result };
}

/**
 * The failure dependencies for one request: the abandon decision (awaited, bounded by the deadline) and the
 * background notification that follows ONLY a successful decision.
 */
export function infrastructureFailureDeps(
  db: FailureDb,
  notifier: Notifier,
  args: { callRowId: string; organizationId: string; reason: string; recipients?: string[]; forAgentId?: string | null },
  background: (work: Promise<unknown>) => void,
  log?: (message: string, meta?: Record<string, unknown>) => void,
): InfrastructureFailureDeps {
  const { callRowId, organizationId, reason } = args;
  return {
    abandon: async () => {
      const { data, error } = await db.rpc("abandon_inbound_routing", {
        p_call_row_id: callRowId, p_org_id: organizationId, p_reason: reason.slice(0, 80),
        p_recipient_ids: args.recipients ?? [], p_for_agent_id: args.forAgentId ?? null,
      });
      if (error) throw new Error(error.message);
      log?.("abandon_inbound_routing", { callRowId, reason, result: data });
      return data;
    },
    notify: () => notifyAfterAbandon(db, notifier, callRowId, organizationId, log),
    background,
    log,
  };
}
