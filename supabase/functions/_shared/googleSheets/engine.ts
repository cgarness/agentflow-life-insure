// One source run, shared by the scheduled worker, Sync now and push processing: token → one consistent read →
// header and structural checks → plan → bounded atomic ingest batches → lease/version/generation-guarded finish.
// The run's status is reported only when its finish COMPLETED; a released / not_owner / not_found / failed
// finish makes the run "stale" while keeping the truthful counts of batches that already committed.
import { LIMITS, type SheetsConfig } from "./config.ts";
import type { ClaimedSource, FinishOutcome, IngestResult, SheetsDb } from "./db.ts";
import { DbError } from "./db.ts";
import { GoogleApiError, sanitizeError } from "./errors.ts";
import { readTab } from "./google.ts";
import { planRowPosition, planSourceId, type PlannedRow } from "./identity.ts";
import { buildLead, displayFields, fingerprint, resolveColumns, resolveCustomFieldNames, rowSignature, validateMapping } from "./mapping.ts";
import { refreshAccessToken } from "./oauth.ts";

type FetchFn = typeof fetch;
export interface RunDeps {
  db: SheetsDb; cfg: SheetsConfig; fetchFn: FetchFn; now?: () => number;
  /** Called after each committed ingest batch (push telemetry: first commit time). */
  onIngest?: (res: IngestResult) => void;
}
export type RunTrigger = "schedule" | "manual" | "push";
export interface RunOutcome {
  sourceId: string; status: "ok" | "needs_review" | "access_lost" | "error" | "backoff" | "reconnect" | "stale";
  imported: number; flagged: number; skipped: number; errors: number; backlog: boolean; reason?: string;
  /** Candidates a permanent receipt already covered (duplicates prevented); not sent to finish. */
  already: number;
  /** What google_sheets_finish did with this run's result ("failed" = the finish call itself failed). */
  finalized?: FinishOutcome | "failed";
}

const chunk = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Builds planned rows (fingerprints, content signatures, validity, IDs) for every data row of a read. */
export async function planRows(rows: string[][], cols: ReturnType<typeof resolveColumns>, names: Map<string, string>): Promise<PlannedRow[]> {
  return Promise.all(rows.map(async (row, i) => {
    const b = buildLead(row, cols, names);
    const idValue = cols.idIdx === null ? null : ((row[cols.idIdx] ?? "").trim() || null);
    return { n: i + 2, idValue, empty: b.empty, valid: b.valid, reason: b.reason, fp: await fingerprint(b.core),
             sig: await rowSignature(row, cols), lead: b.lead, display: displayFields(row, cols) };
  }));
}

export async function runSource(deps: RunDeps, s: ClaimedSource, lease: string, trigger: RunTrigger, budgetMs: number): Promise<RunOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const startedIso = new Date(started).toISOString();
  const out: RunOutcome = { sourceId: s.source_id, status: "ok", imported: 0, flagged: 0, skipped: 0, errors: 0, backlog: false, already: 0 };
  const counts = () => ({ imported: out.imported, flagged: out.flagged, skipped: out.skipped, errors: out.errors });
  /** Reports `status` only if the finish completed; otherwise the run is stale (committed counts are kept). */
  const settle = async (status: RunOutcome["status"], result: Record<string, unknown>, reason?: string): Promise<RunOutcome> => {
    out.status = status;
    if (reason) out.reason = reason;
    try {
      out.finalized = await deps.db.finish(s, lease, trigger, { started_at: startedIso, ...result });
    } catch (e) {
      out.finalized = "failed";
      console.error(`google-sheets: finish failed for ${s.source_id}: ${sanitizeError(e)}`);
    }
    if (out.finalized !== "completed" && status !== "reconnect") {
      out.status = "stale";
      out.reason = reason ? `${reason}; finish_${out.finalized}` : `finish_${out.finalized}`;
    }
    return out;
  };
  const review = (reason: string) => settle("needs_review", { health: "needs_review", review_reason: reason, error_code: reason }, reason);

  try {
    const tok = await deps.db.refreshToken(s.connection_id);
    if (!tok || tok.auth_generation !== s.auth_generation) return await settle("stale", { health: "ok", backoff: true, error_code: "connection_changed" }, "connection_changed");
    let access: string;
    try {
      access = (await refreshAccessToken(deps.fetchFn, deps.cfg, tok.refresh_token)).access_token;
    } catch (e) {
      if (e instanceof GoogleApiError && e.failure === "reconnect") {
        await deps.db.markReconnect(s.connection_id, s.auth_generation, e.reason);
        return await settle("reconnect", { health: "ok", backoff: true, error_code: "reconnect_required" });
      }
      throw e;
    }

    const mapping = validateMapping(s.mapping);
    if (!mapping.ok) return await review("mapping_invalid");
    const tab = await readTab(deps.fetchFn, access, s.spreadsheet_id, Number(s.sheet_id));
    if (tab.overflow) return await review("too_large");
    const cols = resolveColumns(tab.header, mapping.mapping, s.identity_mode === "source_id" ? s.id_header : null);
    if (cols.problems.length > 0) return await review(s.identity_mode === "source_id" && cols.idIdx === null ? "id_column_missing" : "header_changed");
    const ctx = await deps.db.context(s.user_id, s.organization_id);
    const custom = resolveCustomFieldNames(cols.custom.map((c) => c.customFieldId), ctx.custom_fields ?? []);
    if (custom.unresolved.length > 0) return await review("custom_field_unavailable");

    const planned = await planRows(tab.rows, cols, custom.names);
    const state = await deps.db.loadState(s.source_id, lease);
    const plan = s.identity_mode === "source_id"
      ? planSourceId(planned, state.rows ?? [], new Set(state.receipt_ids ?? []))
      : planRowPosition(planned, state.rows ?? []);
    if (plan.structural) return await review(plan.structural);

    for (const ops of chunk(plan.ops, LIMITS.pendingBatch)) await deps.db.ingest(s, lease, [], ops);
    const todo = plan.candidates.slice(0, LIMITS.rowsPerRun);
    let processed = 0;
    for (const batch of chunk(todo, LIMITS.ingestBatch)) {
      if (now() - started > budgetMs) break;
      const res = await deps.db.ingest(s, lease, batch.map((c) => ({ k: c.k, n: c.row.n, f: c.row.fp, lead: c.row.lead })), []);
      out.imported += res.imported; out.flagged += res.flagged; out.skipped += res.skipped; out.errors += res.errors;
      out.already += (res.rows ?? []).filter((r) => r.o === "already").length;
      deps.onIngest?.(res);
      processed += batch.length;
    }
    out.errors += plan.newErrors.length;
    out.backlog = plan.candidates.length > processed;
    return await settle("ok", {
      health: "ok", ...counts(), pending: plan.pendingCount, rows_read: tab.rows.length, backlog: out.backlog,
      phase_complete: s.phase === "initial" && !out.backlog,
      errors_sample: plan.newErrors.slice(0, 20),
    });
  } catch (e) {
    if (e instanceof DbError && e.stale) {
      // Release the lease if it is still ours; finish never overwrites a newer configuration's status.
      return await settle("stale", { health: "ok", ...counts() }, e.message);
    }
    if (e instanceof GoogleApiError) {
      if (e.reason === "tab_missing") return await review("tab_missing");
      if (e.failure === "access_lost") return await settle("access_lost", { health: "access_lost", error_code: e.reason });
      if (e.failure === "reconnect") {
        await deps.db.markReconnect(s.connection_id, s.auth_generation, e.reason);
        return await settle("reconnect", { health: "ok", backoff: true, error_code: "reconnect_required" });
      }
      if (e.failure === "api_not_enabled") return await settle("error", { health: "error", error_code: "api_not_enabled" });
      return await settle("backoff", { health: "ok", backoff: true, error_code: e.failure === "quota" ? "rate_limited" : "google_unavailable", ...counts() });
    }
    console.error(`google-sheets: run failed for ${s.source_id}: ${sanitizeError(e)}`);
    return await settle("error", { health: "error", error_code: "run_failed", error_message: sanitizeError(e), ...counts() });
  }
}
