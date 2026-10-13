// Narrow PostgREST access for the Sheets Edge Functions. Every call goes through a public,
// service-role-only google_sheets_* wrapper (the private helpers are not HTTP-exposed).
import type { LedgerRow } from "./identity.ts";
import type { OwnerCustomField } from "./mapping.ts";

export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string; code?: string } | null }>;
}

export class DbError extends Error {
  constructor(message: string, public code?: string) { super(message); this.name = "DbError"; }
  get stale(): boolean { return this.message.startsWith("stale"); }
}

async function call<T>(db: RpcClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new DbError(error.message, error.code);
  return data as T;
}

export interface ClaimedSource {
  source_id: string; organization_id: string; user_id: string; connection_id: string; auth_generation: number;
  spreadsheet_id: string; sheet_id: number; mapping: unknown; identity_mode: "source_id" | "row_position";
  id_header: string | null; lead_source_default: string; config_version: number; phase: "initial" | "steady"; row_epoch: number;
}
export interface IngestResult {
  imported: number; flagged: number; skipped: number; errors: number; new_pending: number;
  rows: { k: string; o: "imported" | "flagged" | "skipped" | "already" | "error"; reason?: string; lead_id?: string }[];
}
export interface OwnerContext {
  duplicate_rule: string; duplicate_scope: string; duplicate_action: string; default_status: string;
  lead_sources: string[]; has_lead_created_workflows: boolean; custom_fields: OwnerCustomField[];
}

export const sheetsDb = (db: RpcClient) => ({
  claim: (lease: string, limit: number, source?: { id: string; user: string; org: string }) =>
    call<ClaimedSource[]>(db, "google_sheets_claim", {
      p_lease: lease, p_limit: limit, p_source: source?.id ?? null, p_user: source?.user ?? null, p_org: source?.org ?? null,
    }).then((r) => r ?? []),
  loadState: (source: string, lease: string) =>
    call<{ rows: LedgerRow[]; receipt_ids: string[] }>(db, "google_sheets_load_state", { p_source: source, p_lease: lease }),
  ingest: (s: ClaimedSource, lease: string, rows: unknown[], pending: unknown[]) =>
    call<IngestResult>(db, "google_sheets_ingest", {
      p_source: s.source_id, p_lease: lease, p_version: s.config_version, p_generation: s.auth_generation, p_rows: rows, p_pending: pending,
    }),
  finish: (s: ClaimedSource, lease: string, trigger: "schedule" | "manual" | "activation", result: Record<string, unknown>) =>
    call<boolean>(db, "google_sheets_finish", {
      p_source: s.source_id, p_lease: lease, p_version: s.config_version, p_trigger: trigger, p_result: result,
    }),
  refreshToken: (connection: string) =>
    call<{ refresh_token: string; auth_generation: number }[]>(db, "google_sheets_get_refresh_token", { p_connection: connection })
      .then((r) => r?.[0] ?? null),
  markReconnect: (connection: string, generation: number, code: string) =>
    call<boolean>(db, "google_sheets_mark_reconnect", { p_connection: connection, p_generation: generation, p_code: code }),
  context: (user: string, org: string) => call<OwnerContext>(db, "google_sheets_context", { p_user: user, p_org: org }),
});
export type SheetsDb = ReturnType<typeof sheetsDb>;
