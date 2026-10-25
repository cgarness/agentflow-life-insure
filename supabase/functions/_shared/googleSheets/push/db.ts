// Narrow PostgREST access for push processing. Every call goes through a public, service-role-only
// google_sheets_* wrapper (the private helpers are not HTTP-exposed); every ownership decision is made in SQL.
import { DbError, type ClaimedSource, type RpcClient } from "../db.ts";
import type { Notice } from "./headers.ts";

async function call<T>(db: RpcClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new DbError(error.message, error.code);
  return data as T;
}
const first = <T>(r: T[] | T | null): T | null => (Array.isArray(r) ? r[0] ?? null : r);

export type AcceptOutcome = "invalid" | "unknown_channel" | "rejected_token" | "rejected_resource" | "duplicate"
  | "ignored_inactive" | "ignored_stale" | "sync" | "queued";
export type Worker = "receiver" | "maintenance" | "api";
export type JobOutcome = "done" | "backlog" | "retry" | "blocked";

export interface PushClaim {
  target_id: string; organization_id: string; user_id: string; connection_id: string; spreadsheet_id: string;
  attempt_id: string; from_seq: number; snapshot_seq: number; sources: string[];
  oldest_received_at: string | null; oldest_queued_at: string | null;
}
export interface JobResult {
  outcome: JobOutcome; reason: string; sources_run: number; imported: number; flagged: number; skipped: number;
  already: number; errors: number; google_requests: number; first_commit_at: string | null;
}
export interface StopItem { row: string; channel_id: string; resource_id: string | null; connection_id?: string }
export interface WatchResult { status: string; stop: StopItem[]; kicked: boolean; target_id?: string }
export interface MaintenanceItem {
  kind: "stop" | "register"; row?: string; channel_id?: string; resource_id?: string; connection_id: string;
  target_id?: string; generation?: number; spreadsheet_id?: string; reason?: string;
}
export interface RealtimeStatus {
  mode: "off" | "pilot" | "on";
  sources: Record<string, { state: "active" | "setting_up" | "interrupted"; last_notification_at: string | null; last_processed_at: string | null; pending: boolean }>;
}

export const pushDb = (db: RpcClient) => ({
  accept: (n: Notice, tokenDigest: string, receivedAt: Date) =>
    call<{ outcome: AcceptOutcome; target_id: string | null; process: boolean }[]>(db, "google_sheets_push_accept", {
      p_channel_id: n.channelId, p_token_digest: tokenDigest, p_resource_id: n.resourceId, p_state: n.state,
      p_message_number: n.messageNumber, p_changed: n.changed, p_received_at: receivedAt.toISOString(),
    }).then((r) => first(r) ?? { outcome: "invalid" as const, target_id: null, process: false }),
  claim: (lease: string, target: string | null, leaseS: number, worker: Worker) =>
    call<PushClaim[]>(db, "google_sheets_push_claim", { p_lease: lease, p_target: target, p_lease_s: leaseS, p_worker: worker })
      .then((r) => first(r)),
  claimSource: (target: string, targetLease: string, source: string, lease: string) =>
    call<ClaimedSource[]>(db, "google_sheets_push_claim_source", { p_target: target, p_target_lease: targetLease, p_source: source, p_lease: lease })
      .then((r) => first(r)),
  complete: (target: string, lease: string, result: JobResult) =>
    call<{ status: string; outcome?: string; dirty: boolean }>(db, "google_sheets_push_complete", { p_target: target, p_lease: lease, p_result: result }),
  kick: (user: string, org: string, source: string, reason: "activate" | "resume" | "save" | "review" | "identity_review") =>
    call<string | null>(db, "google_sheets_push_kick", { p_user: user, p_org: org, p_source: source, p_reason: reason }),
  watchBegin: (connection: string, generation: number, spreadsheet: string, channelId: string, tokenDigest: string, keyId: string, reason: string) =>
    call<{ outcome: string; channel_row_id: string | null; target_id: string | null }[]>(db, "google_sheets_watch_begin", {
      p_connection: connection, p_generation: generation, p_spreadsheet: spreadsheet, p_channel_id: channelId,
      p_token_digest: tokenDigest, p_key_id: keyId, p_reason: reason,
    }).then((r) => first(r) ?? { outcome: "failed", channel_row_id: null, target_id: null }),
  watchResult: (row: string, action: "activated" | "failed" | "stopped" | "stop_failed" | "abandoned",
    resourceId: string | null, expiration: Date | null, code: string | null) =>
    call<WatchResult>(db, "google_sheets_watch_result", {
      p_channel_row: row, p_action: action, p_resource_id: resourceId, p_expiration: expiration?.toISOString() ?? null, p_code: code,
    }),
  watchRelease: (user: string, org: string, spreadsheet: string | null, force: boolean) =>
    call<{ stop: StopItem[] }>(db, "google_sheets_watch_release", { p_user: user, p_org: org, p_spreadsheet: spreadsheet, p_force: force }),
  maintenanceClaim: (lease: string, limit: number, keyId: string) =>
    call<{ mode: string; items: MaintenanceItem[] }>(db, "google_sheets_push_maintenance_claim", { p_lease: lease, p_limit: limit, p_key_id: keyId }),
  status: (user: string, org: string) => call<RealtimeStatus>(db, "google_sheets_push_status", { p_user: user, p_org: org }),
});
export type PushDb = ReturnType<typeof pushDb>;
