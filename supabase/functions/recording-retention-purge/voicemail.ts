// Inbound Calling v2 — voicemail phases of recording-retention-purge (P13 retention + safeguard-3
// source cleanup). Pure and Deno-free so it is unit-tested under vitest
// (src/lib/__tests__/recordingRetentionVoicemail.test.ts); index.ts owns the Deno/Supabase wiring and
// does nothing but build the dependencies and splice the returned object into its JSON response.
//
// CORRECTIVE PASS (2026-09-16). The previous revision reported a cleanup as done the moment Twilio
// answered, discarding both reconciliation RPCs' results. Four reproduced defects drive this file:
//   D1  provider DELETE succeeded but the metadata RPC errored -> reported one deletion, left cleanup
//       pending, logged nothing.
//   D2  provider DELETE failed and recording the failure also errored -> attempts never advanced and
//       nothing said so.
//   D3  101 eligible rows -> only 100 processed, ever (one un-looped batch).
//   D4  a stalled first DELETE had no AbortSignal and blocked every later row.
//
// The contract this file now keeps:
//   * PROVIDER deletion and DATABASE reconciliation are counted separately and never conflated. A row
//     is "reconciled" only when the database says so.
//   * `{updated:false}` is NOT proof of completion — it means "no row matched sid AND state<>'deleted'",
//     which is either an idempotent re-run or a missing row. A bounded readback tells them apart.
//   * If persisting a failure ALSO fails, the row is reported `unresolved`: the obligation stands, and
//     we never claim the database attempt counter advanced (so the 50-attempt ceiling is never
//     credited with work the database did not record).
//   * Every provider request is cancellable and every database wait is bounded. A timeout is an
//     UNKNOWN outcome, not a rollback — an aborted request may still have committed, so a timed-out
//     reconciliation counts as unresolved and is re-derived by readback where that is possible.
//   * The pass walks past the first batch while budget and capacity remain, and stops when an
//     invocation stops making progress, so an unchanged batch can never re-issue a DELETE or spin.
//
// Unchanged by design: the daily 15 8 * * * schedule, `voicemail_retention_days`, the 90-day unheard
// cap, the database 50-attempt ceiling and its backoff, and the conversation-recording purge.

/** Unheard voicemails are kept at most this long, regardless of the per-org listened retention. */
export const VOICEMAIL_UNHEARD_MAX_DAYS = 90;

/**
 * Execution limits. Deliberately CONSTANTS, not settings: they bound one invocation of a daily cron
 * job and are not a product surface.
 *
 * HOW THE BUDGETS ACTUALLY BIND, stated precisely because it is easy to overstate: a budget is
 * checked before work is STARTED, never mid-flight. So each phase can overrun its own budget by at
 * most one unit of work — one provider request (PROVIDER_REQUEST_TIMEOUT_MS) plus its reconciliation
 * round trips (at most 3 x DB_REQUEST_TIMEOUT_MS) — i.e. up to ~34 s beyond CLEANUP_PASS_BUDGET_MS,
 * and up to ~24 s beyond RETENTION_PASS_BUDGET_MS (3 bounded database calls).
 *
 * The conversation-recording pass runs FIRST and is unbounded (pre-existing, deliberately untouched).
 * INVOCATION_BUDGET_MS therefore caps both voicemail phases against the handler's own start, so a
 * slow recording pass shortens the voicemail phases instead of pushing the handler past the platform
 * ceiling. Each phase deadline is min(phase start + phase budget, invocation start + this cap).
 */
export const LIMITS = {
  /**
   * Hard cap for BOTH voicemail phases measured from the handler's start, leaving headroom under the
   * ~150 s platform ceiling for the unbounded conversation-recording pass that precedes them.
   */
  INVOCATION_BUDGET_MS: 110_000,
  /** Whole voicemail-retention phase. */
  RETENTION_PASS_BUDGET_MS: 30_000,
  /** Whole source-cleanup phase. */
  CLEANUP_PASS_BUDGET_MS: 45_000,
  /** Any single database call (batch fetch, purge, reconcile, readback). */
  DB_REQUEST_TIMEOUT_MS: 8_000,
  /** Any single provider (Twilio) DELETE; cancellable via AbortSignal in index.ts. */
  PROVIDER_REQUEST_TIMEOUT_MS: 10_000,
  /** Rows per retention batch — unchanged from the previous revision. */
  RETENTION_BATCH_SIZE: 200,
  /** Retention rounds per organization — unchanged from the previous revision. */
  RETENTION_MAX_ROUNDS: 25,
  /** Rows per cleanup batch. The SQL clamps p_limit to 1..500; 100 keeps each batch quick. */
  CLEANUP_BATCH_SIZE: 100,
  /** Capacity ceiling for one invocation: 10 x 100 = up to 1000 rows. */
  CLEANUP_MAX_BATCHES: 10,
  /** Concurrent provider DELETEs, so one stalled request cannot consume the pass. */
  CLEANUP_CONCURRENCY: 5,
  /** Rows the blocked-work summary will scan before it reports itself capped (SQL clamps to 50 000). */
  BLOCKED_SCAN_LIMIT: 5_000,
} as const;

// ── Result shapes ────────────────────────────────────────────────────────────────────────────────
//
// `completed` = the phase ran to its natural end with nothing outstanding (including the healthy
//               empty queue, which is distinguishable by queue_empty + zero counters).
// `skipped`   = the phase did not run at all; `reason` says why — `missing_credentials`;
//               `schema_unavailable` (a database SQLSTATE establishes the v2 objects are genuinely
//               absent: the documented compatibility path); `schema_inconclusive` (the API's schema
//               cache could not resolve the object, which is NOT proof the migration is missing);
//               `db_unavailable` (an availability fault); `db_timeout`; or
//               `invocation_budget_exhausted` (admission closed before the phase began).
//               None of these looks like a healthy zero run.
// `partial`   = the phase made progress but stopped early or left work unresolved.
// `failed`    = the phase could not make progress.

export type PhaseStatus = "completed" | "skipped" | "partial" | "failed";

export interface RetentionPhase {
  status: PhaseStatus;
  reason?: string;
  orgs_processed: number;
  /** Organizations whose retention loop ended on an OPERATIONAL ERROR (never on budget or capacity). */
  orgs_incomplete: number;
  /**
   * Organizations that used every round without ever seeing an empty batch, so more rows may remain.
   * Nothing failed — the invocation simply ran out of capacity, which is `partial`, not `failed`.
   */
  orgs_capacity_limited: number;
  /** Organizations that were selected but ran out of budget before finishing (or before starting). */
  orgs_budget_limited: number;
  /** Batch queries actually issued this phase. `queue_empty` is only meaningful when this is > 0. */
  batches_observed: number;
  /** Of those, how many came back empty. */
  batches_empty: number;
  rows_purged: number;
  objects_removed: number;
  /**
   * Objects the storage layer did NOT report as removed although they were requested. Reported so a
   * silently partial removal is visible; it does not change the purge decision.
   */
  objects_missing: number;
  budget_exhausted: boolean;
  /** batch_error | storage_error | purge_error — the FIRST cause that left an organization incomplete. */
  incomplete_reason?: string;
  /**
   * True only when at least one batch query was issued AND every one of them came back empty. A phase
   * that never got to query anything reports false: nothing was observed, so nothing is claimed.
   */
  queue_empty: boolean;
}

export interface CleanupPhase {
  status: PhaseStatus;
  reason?: string;
  batches: number;
  /** Rows whose provider DELETE was actually started this invocation. */
  rows_attempted: number;
  /**
   * PROVIDER-SIDE ONLY: the provider confirmed the recording is gone (2xx or 404). This is NOT a
   * durable-cleanup count — the database may still not know. Compare with `reconciled`.
   */
  provider_deletions: number;
  /** DURABLE: the database state is confirmed `source_cleanup_state='deleted'`. */
  reconciled: number;
  /** PROVIDER-SIDE ONLY: the provider did not confirm deletion. */
  provider_failures: number;
  /** Of `provider_failures`, those whose failure row was durably recorded (attempts advanced). */
  provider_failures_recorded: number;
  /**
   * Rows whose DATABASE outcome is unknown or failed: the obligation is still outstanding, no
   * attempt counter is credited, and a later invocation must pick the row up again.
   */
  unresolved: number;
  /**
   * Rows this pass could not act on — a malformed recording SID, or a batch element that is not a
   * usable row at all. The provider is never contacted for these.
   */
  skipped_invalid_sid: number;
  /**
   * Rows whose owning provider account could not be established AFTER being selected, so NO request was
   * issued. Their obligation is untouched and outstanding; they are neither attempts nor completions.
   * With M8's actionable selection this is normally 0 — a row would have to lose its owner between
   * selection and processing — and the standing backlog is reported by `blocked_ownership_*` instead.
   */
  unresolved_ownership: number;
  /**
   * CORRECTIVE PASS 13. Rows the actionable selection deliberately skipped because their owning provider
   * account cannot be established. They are NEVER modified — no request, no failure record, no attempt
   * increment, no backoff — so they can neither be deleted against the wrong account nor silently retired
   * at the 50-attempt ceiling. They are reported here precisely so that excluding them from the scan is
   * not the same as pretending they do not exist.
   *
   * `_due` is what this pass skipped now; `_total` is the whole standing backlog whatever its backoff;
   * `_orgs` keeps one organization's bad data from reading as a platform-wide fault. Each one becomes
   * actionable again by itself as soon as a signed callback persists its owner.
   */
  blocked_ownership_due: number;
  blocked_ownership_total: number;
  blocked_ownership_orgs: number;
  /** The bounded blocked scan hit its cap: the real backlog is LARGER than the numbers above. */
  blocked_scan_capped: boolean;
  /** The blocked summary could not be read, so the backlog size is UNKNOWN for this pass. */
  blocked_summary_unavailable: boolean;
  /** The oldest blocked row seen, so a long-standing backlog is visible as such. */
  oldest_blocked_at?: string | null;
  /**
   * Rows seen this pass that are one failed attempt away from M7's 50-attempt ceiling, after which
   * `voicemails_cleanup_batch` stops offering them and their provider source is abandoned. Reported
   * so that abandonment is observable; this code never changes the ceiling.
   */
  near_attempt_ceiling: number;
  budget_exhausted: boolean;
  /**
   * NOTHING IS OWED: the ACTIONABLE queue drained AND no blocked rows are outstanding AND the blocked
   * backlog was actually readable. Excluding blocked rows from the scan must never be reported as an
   * empty queue, so this deliberately depends on all three.
   */
  queue_empty: boolean;
  /** The narrower observation: an empty ACTIONABLE batch was seen. Says nothing about blocked rows. */
  actionable_queue_empty: boolean;
  /** queue_empty | queue_drained | no_progress | budget | max_batches | batch_error */
  stopped_reason?: string;
}

export interface VoicemailPhases {
  /**
   * False when EITHER voicemail phase is anything other than `completed`. The handler's top-level
   * `ok` describes the conversation-recording purge and is deliberately unchanged, so this is the
   * scan-level signal for the voicemail phases.
   */
  voicemail_phases_ok: boolean;
  voicemail_retention: RetentionPhase;
  voicemail_source_cleanup: CleanupPhase;
}

// ── Dependencies ─────────────────────────────────────────────────────────────────────────────────

export interface DbError {
  message: string;
  /**
   * The structured code the data layer returned, carried across the boundary unchanged. PostgreSQL
   * SQLSTATEs (`42P01`, `42883`) are trustworthy evidence about the SCHEMA; PostgREST `PGRST*` codes
   * describe the API's own metadata cache and are NOT evidence that the migration objects are absent.
   */
  code?: string | null;
}
export interface DbResult<T> {
  data: T | null;
  error: DbError | null;
}

/** What the provider call reports back. A thrown dependency is handled too — see `callProvider`. */
export type ProviderResult =
  | { kind: "status"; status: number }
  | { kind: "timeout"; message?: string }
  | { kind: "network"; message: string };

export interface RoutingSettingsRow {
  organization_id: string | null;
  voicemail_retention_days: number | null;
}
export interface ExpiredRow {
  id: string;
  storage_path: string | null;
}
/** One row from `voicemails_cleanup_blocked_summary`. */
export interface BlockedSummaryRow {
  blocked_due?: number | null;
  blocked_total?: number | null;
  blocked_orgs?: number | null;
  oldest_blocked_at?: string | null;
  scan_capped?: boolean | null;
}

export interface CleanupRow {
  id: string;
  recording_sid: string;
  provider_account_sid: string | null;
  /**
   * As returned by `voicemails_cleanup_batch`. The SQL filters `source_cleanup_attempts < 50`, so a
   * row that crosses the ceiling silently LEAVES the queue with its provider source still present.
   * We surface how many rows are one attempt away so that abandonment is visible rather than silent.
   */
  source_cleanup_attempts?: number | null;
}

export interface VoicemailDeps {
  /** Wall clock for budgets. Injected so budgets are testable under fake timers. */
  nowMs: () => number;
  /**
   * When the HTTP handler started. Both phase deadlines are additionally capped at
   * `invocationStartMs + LIMITS.INVOCATION_BUDGET_MS`, so the unbounded conversation-recording pass
   * that runs first shortens the voicemail phases instead of overrunning the platform ceiling.
   */
  invocationStartMs: number;
  /**
   * Anchor for the retention cutoffs, captured once per invocation BEFORE the conversation-recording
   * pass (unchanged from the previous revision). Reusing it errs conservative — it can only keep a
   * row marginally longer, never purge one early — and it is what keeps the recording pass untouched.
   */
  retentionAnchorMs: number;

  listRoutingSettings: () => Promise<DbResult<RoutingSettingsRow[]>>;
  expiredBatch: (args: {
    orgId: string;
    listenedCutoff: string;
    unheardCutoff: string;
    limit: number;
  }) => Promise<DbResult<ExpiredRow[]>>;
  removeObjects: (paths: string[]) => Promise<DbResult<unknown>>;
  markPurged: (ids: string[]) => Promise<DbResult<number>>;

  /** null when TWILIO credentials are absent — the cleanup phase then reports `skipped`. */
  credentials: () => { accountSid: string; authToken: string } | null;
  /**
   * M8 `voicemails_cleanup_actionable_batch`: due rows whose owner is ESTABLISHED. Replaces M7's
   * `voicemails_cleanup_batch`, which returned unownable rows too and so let an arbitrary prefix of
   * them hide every actionable row behind it. M7's function is left in place for the previously
   * deployed worker, so this migration can be applied before this code ships.
   */
  cleanupActionableBatch: (limit: number) => Promise<DbResult<CleanupRow[]>>;
  /** M8 `voicemails_cleanup_blocked_summary`: the backlog the selection above deliberately skipped. */
  cleanupBlockedSummary: (scanLimit: number) => Promise<DbResult<BlockedSummaryRow[] | BlockedSummaryRow>>;
  deleteProviderRecording: (args: {
    ownerAccountSid: string;
    recordingSid: string;
    timeoutMs: number;
  }) => Promise<ProviderResult>;
  markSourceDeleted: (sid: string) => Promise<DbResult<{ updated?: boolean } | null>>;
  recordCleanupFailure: (sid: string, error: string) => Promise<DbResult<{ updated?: boolean } | null>>;
  /** Bounded readback used only to resolve an ambiguous `{updated:false}`. */
  readCleanupState: (sid: string) => Promise<DbResult<{ source_cleanup_state: string } | null>>;

  log: (level: "info" | "warn" | "error", message: string, detail?: Record<string, unknown>) => void;
}

const RECORDING_SID_RE = /^RE[0-9a-fA-F]{32}$/;
const ACCOUNT_SID_RE = /^AC[0-9a-fA-F]{32}$/;
const DAY_MS = 86_400_000;

/**
 * PostgreSQL SQLSTATEs that are trustworthy DATABASE evidence that the object is not there.
 * 42P01 undefined_table, 42883 undefined_function.
 */
const SCHEMA_ABSENT_SQLSTATES = new Set(["42P01", "42883"]);
/**
 * PostgREST codes that mean its SCHEMA CACHE could not resolve the object. A stale or cold cache says
 * nothing about whether the migration ran, so these are INCONCLUSIVE, never proof of absence.
 * PGRST202 no matching function, PGRST204 column not found, PGRST205 table not found.
 */
const SCHEMA_CACHE_CODES = new Set(["PGRST202", "PGRST204", "PGRST205"]);

/**
 * Why a phase was skipped. Only a database SQLSTATE establishes the benign "the v2 schema is genuinely
 * absent" compatibility case; API metadata that merely failed to resolve is reported separately, and
 * anything else is an availability fault. Classification is driven by the STRUCTURED CODE, never by
 * matching the message text — a stale schema cache used to read as proof the migration was missing.
 */
export function classifySkipReason(err: DbError, timedOut: boolean): string {
  if (timedOut) return "db_timeout";
  const code = String(err?.code ?? "").trim().toUpperCase();
  if (SCHEMA_ABSENT_SQLSTATES.has(code)) return "schema_unavailable";
  if (SCHEMA_CACHE_CODES.has(code)) return "schema_inconclusive";
  return "db_unavailable";
}

/**
 * A phase deadline: its own budget, but never past the invocation's ADMISSION LIMIT.
 *
 * ADMISSION, NOT CANCELLATION. `INVOCATION_BUDGET_MS` governs whether NEW work may be STARTED. It is
 * not a hard cancellation deadline and nothing is aborted when it passes: a provider request already
 * in flight runs to its own `PROVIDER_REQUEST_TIMEOUT_MS`, and a database call already issued runs to
 * `DB_REQUEST_TIMEOUT_MS`. So the handler can still finish slightly past the limit — bounded by one
 * unit of already-admitted work — and that overrun is the documented behaviour, not a violation.
 */
export function phaseDeadline(deps: VoicemailDeps, phaseBudgetMs: number): number {
  return Math.min(deps.nowMs() + phaseBudgetMs, deps.invocationStartMs + LIMITS.INVOCATION_BUDGET_MS);
}

/** True when the invocation's admission limit has already passed: no new work may be started. */
export function admissionClosed(deps: VoicemailDeps): boolean {
  return deps.nowMs() >= deps.invocationStartMs + LIMITS.INVOCATION_BUDGET_MS;
}

// ── Bounded waits ────────────────────────────────────────────────────────────────────────────────

export interface BoundedResult<T> extends DbResult<T> {
  /** The wait elapsed. The request may still have committed — a timeout is UNKNOWN, not rolled back. */
  timedOut?: boolean;
  /** The dependency threw rather than returning `{error}`. */
  threw?: boolean;
}

/**
 * Runs one database call under a deadline, normalising BOTH failure shapes a dependency can produce:
 * a returned `{error}` and a thrown/rejected promise. A timeout is reported as `timedOut` so callers
 * never treat it as a proven rollback.
 */
export async function boundedDb<T>(
  run: () => Promise<DbResult<T>>,
  timeoutMs: number,
): Promise<BoundedResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BoundedResult<T>>((resolve) => {
    timer = setTimeout(
      () => resolve({ data: null, error: { message: `database call timed out after ${timeoutMs} ms` }, timedOut: true }),
      timeoutMs,
    );
  });
  const attempt = (async (): Promise<BoundedResult<T>> => {
    try {
      const r = await run();
      return { data: r?.data ?? null, error: r?.error ?? null };
    } catch (err) {
      return { data: null, error: { message: errText(err) }, threw: true };
    }
  })();
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Grace beyond `timeoutMs` before the helper stops waiting on the provider dependency itself. The
 * dependency is expected to honour `timeoutMs` (index.ts aborts the request), but the helper does not
 * TRUST it to: without this, a dependency that ignores its budget would stall a worker indefinitely.
 */
export const PROVIDER_WAIT_GRACE_MS = 2_000;

/**
 * Calls the provider, normalising a thrown dependency into a `network` result and a dependency that
 * never settles into a `timeout` result.
 */
export async function callProvider(
  deps: VoicemailDeps,
  args: { ownerAccountSid: string; recordingSid: string; timeoutMs: number },
): Promise<ProviderResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<ProviderResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ kind: "timeout", message: `provider dependency did not settle within ${args.timeoutMs + PROVIDER_WAIT_GRACE_MS} ms` }),
      args.timeoutMs + PROVIDER_WAIT_GRACE_MS,
    );
  });
  try {
    const r = await Promise.race([attemptProvider(deps, args), guard]);
    if (!r || typeof r !== "object" || !("kind" in r)) {
      return { kind: "network", message: "provider returned an unrecognised result" };
    }
    return r;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function attemptProvider(
  deps: VoicemailDeps,
  args: { ownerAccountSid: string; recordingSid: string; timeoutMs: number },
): Promise<ProviderResult> {
  try {
    return await deps.deleteProviderRecording(args);
  } catch (err) {
    const message = errText(err);
    if (/abort|timed? ?out/i.test(message)) return { kind: "timeout", message };
    return { kind: "network", message };
  }
}

/** 2xx or 404 confirms the recording is gone at the provider; nothing else does. */
export function providerConfirmsDeleted(r: ProviderResult): boolean {
  return r.kind === "status" && ((r.status >= 200 && r.status < 300) || r.status === 404);
}

export function describeProviderResult(r: ProviderResult): string {
  if (r.kind === "status") return `delete HTTP ${r.status}`;
  if (r.kind === "timeout") return `delete timed out${r.message ? `: ${r.message}` : ""}`;
  return `delete failed: ${r.message}`;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Logging must never influence control flow: a logger that throws cannot change an outcome. */
function safeLog(
  deps: VoicemailDeps,
  level: "info" | "warn" | "error",
  message: string,
  detail?: Record<string, unknown>,
): void {
  try {
    deps.log(level, message, detail);
  } catch {
    /* ignored on purpose */
  }
}

// ── Reconciliation ───────────────────────────────────────────────────────────────────────────────

export type RowOutcome =
  | "reconciled"
  | "provider_failure_recorded"
  /**
   * The owning provider account could not be ESTABLISHED for this row, so no request was issued at
   * all. 404 is an idempotent completion signal only when the request targeted the established owner;
   * holding credentials for the platform account does not establish ownership of a subaccount's
   * recording. The obligation is preserved untouched and needs operator attention, not a retry.
   */
  | "unresolved_ownership"
  | "unresolved";

/**
 * Turns `{updated}` into a durable verdict. `updated:true` is proof. `updated:false` is NOT — it only
 * says no row matched `sid AND state<>'deleted'`, so we read the row back: state `deleted` means an
 * idempotent/concurrent completion; anything else (including a missing row or an unreadable one)
 * leaves the obligation outstanding.
 */
async function confirmDeletedState(
  deps: VoicemailDeps,
  sid: string,
  updated: boolean | undefined,
): Promise<{ confirmed: boolean; note: string }> {
  if (updated === true) return { confirmed: true, note: "updated" };
  const rb = await boundedDb(() => deps.readCleanupState(sid), LIMITS.DB_REQUEST_TIMEOUT_MS);
  if (rb.error) {
    return { confirmed: false, note: `readback failed: ${rb.error.message}` };
  }
  if (rb.data && rb.data.source_cleanup_state === "deleted") {
    return { confirmed: true, note: "readback: already deleted" };
  }
  if (!rb.data) return { confirmed: false, note: "readback: row not found" };
  return { confirmed: false, note: `readback: state=${rb.data.source_cleanup_state}` };
}

/** Processes one due row end to end and returns its durable outcome. Never throws. */
export async function reconcileCleanupRow(
  deps: VoicemailDeps,
  row: CleanupRow,
): Promise<{ outcome: RowOutcome; providerAttempted: boolean; providerConfirmed: boolean }> {
  const sid = (row.recording_sid || "").trim();

  // OWNERSHIP FIRST. A DELETE is only meaningful against the account that owns the recording, and a
  // 404 only means "already gone" when the request reached that account. Substituting the platform
  // account turns "you are asking the wrong account" into a false completion: the row is marked
  // deleted while the media survives in the subaccount. So a row whose owner is not established
  // issues NO request, records NO failure (this is a data problem, not a transient fault, and
  // advancing the attempt counter would eventually abandon it silently) and stays exactly as it is.
  const storedOwner = (row.provider_account_sid || "").trim();
  if (!ACCOUNT_SID_RE.test(storedOwner)) {
    safeLog(deps, "error", "voicemail cleanup cannot establish the owning account — no provider request issued; cleanup still owed", {
      recording_sid: sid,
      row_id: row.id,
      stored_owner: storedOwner === "" ? "(absent)" : "(malformed)",
      note: "credentials for the platform account do not establish ownership of another account's recording",
    });
    return { outcome: "unresolved_ownership", providerAttempted: false, providerConfirmed: false };
  }
  const owner = storedOwner;

  const provider = await callProvider(deps, {
    ownerAccountSid: owner,
    recordingSid: sid,
    timeoutMs: LIMITS.PROVIDER_REQUEST_TIMEOUT_MS,
  });
  const providerConfirmed = providerConfirmsDeleted(provider);
  const detail = describeProviderResult(provider);
  const attempted = { providerAttempted: true as const };

  if (providerConfirmed) {
    const r = await boundedDb(() => deps.markSourceDeleted(sid), LIMITS.DB_REQUEST_TIMEOUT_MS);
    if (r.error) {
      // D1: the provider deletion is real; the write's outcome is unknown. An aborted or failed
      // request may still have COMMITTED, so read the row back before concluding anything.
      const rb = await confirmDeletedState(deps, sid, undefined);
      if (rb.confirmed) {
        safeLog(deps, "warn", "reconciliation call failed but the row reads back as deleted — treating as reconciled", {
          recording_sid: sid,
          error: r.error.message,
          timed_out: r.timedOut === true,
        });
        return { outcome: "reconciled", ...attempted, providerConfirmed };
      }
      safeLog(deps, "error", "provider deletion confirmed but database reconciliation FAILED — cleanup still owed", {
        recording_sid: sid,
        error: r.error.message,
        timed_out: r.timedOut === true,
        readback: rb.note,
        note: r.timedOut ? "an aborted database request does not prove the transaction rolled back" : undefined,
      });
      return { outcome: "unresolved", ...attempted, providerConfirmed };
    }
    const { confirmed, note } = await confirmDeletedState(deps, sid, r.data?.updated);
    if (confirmed) return { outcome: "reconciled", ...attempted, providerConfirmed };
    safeLog(deps, "error", "provider deletion confirmed but database state could not be confirmed — cleanup still owed", {
      recording_sid: sid,
      note,
    });
    return { outcome: "unresolved", ...attempted, providerConfirmed };
  }

  const r = await boundedDb(() => deps.recordCleanupFailure(sid, detail), LIMITS.DB_REQUEST_TIMEOUT_MS);
  if (r.error) {
    // D2: the failure record's outcome is unknown. A timeout may still have committed, so we claim
    // NEITHER that the attempt counter advanced NOR that it did not — only that it is not credited.
    safeLog(deps, "error", "provider deletion failed AND recording that failure did not confirm — obligation outstanding", {
      recording_sid: sid,
      provider: detail,
      error: r.error.message,
      timed_out: r.timedOut === true,
      attempt_counter: r.timedOut
        ? "UNKNOWN — the request was abandoned, which does not prove the transaction rolled back; not credited either way"
        : "not credited",
      note: "the 50-attempt ceiling cannot protect work the database did not confirm",
    });
    return { outcome: "unresolved", ...attempted, providerConfirmed };
  }
  if (r.data?.updated === true) {
    safeLog(deps, "warn", "provider deletion failed; failure recorded and backoff applied", {
      recording_sid: sid,
      provider: detail,
    });
    return { outcome: "provider_failure_recorded", ...attempted, providerConfirmed };
  }
  // `updated:false` here means no non-deleted row matched. Read back before deciding.
  const { confirmed, note } = await confirmDeletedState(deps, sid, false);
  if (confirmed) {
    safeLog(deps, "info", "provider deletion failed but the row is already reconciled elsewhere", {
      recording_sid: sid,
      provider: detail,
      note,
    });
    return { outcome: "reconciled", ...attempted, providerConfirmed };
  }
  safeLog(deps, "error", "provider deletion failed and the failure record did not land — cleanup still owed", {
    recording_sid: sid,
    provider: detail,
    note,
  });
  return { outcome: "unresolved", ...attempted, providerConfirmed };
}

// ── Bounded-concurrency pool ─────────────────────────────────────────────────────────────────────

/**
 * Runs `work` over `items` with at most `concurrency` in flight, calling `shouldStop()` before each
 * item is STARTED. Items never started are returned as `notStarted` so the caller can leave their
 * obligations recoverable rather than pretending they were attempted.
 */
export async function runBounded<T>(
  items: T[],
  concurrency: number,
  shouldStop: () => boolean,
  work: (item: T) => Promise<void>,
): Promise<{ started: number; notStarted: T[] }> {
  let next = 0;
  let started = 0;
  const notStarted: T[] = [];
  const workers: Promise<void>[] = [];
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  for (let lane = 0; lane < lanes; lane++) {
    workers.push(
      (async () => {
        for (;;) {
          if (next >= items.length) return;
          if (shouldStop()) return;
          const item = items[next++];
          started += 1;
          await work(item);
        }
      })(),
    );
  }
  await Promise.all(workers);
  for (let i = next; i < items.length; i++) notStarted.push(items[i]);
  return { started, notStarted };
}

// ── Phase 1: voicemail retention ─────────────────────────────────────────────────────────────────

export async function runVoicemailRetention(deps: VoicemailDeps): Promise<RetentionPhase> {
  const out: RetentionPhase = {
    status: "completed",
    orgs_processed: 0,
    orgs_incomplete: 0,
    orgs_capacity_limited: 0,
    orgs_budget_limited: 0,
    batches_observed: 0,
    batches_empty: 0,
    rows_purged: 0,
    objects_removed: 0,
    objects_missing: 0,
    budget_exhausted: false,
    queue_empty: false,
  };
  // Admission check BEFORE the first query: if the invocation's limit is already spent — typically
  // because the unbounded conversation-recording pass consumed it — start no new voicemail work.
  if (admissionClosed(deps)) {
    safeLog(deps, "warn", "voicemail retention SKIPPED — the invocation admission limit was already spent on entry", {
      invocation_budget_ms: LIMITS.INVOCATION_BUDGET_MS,
      elapsed_ms: deps.nowMs() - deps.invocationStartMs,
    });
    return { ...out, status: "skipped", reason: "invocation_budget_exhausted" };
  }
  const deadline = phaseDeadline(deps, LIMITS.RETENTION_PASS_BUDGET_MS);
  const outOfTime = () => deps.nowMs() >= deadline;

  const settings = await boundedDb(() => deps.listRoutingSettings(), LIMITS.DB_REQUEST_TIMEOUT_MS);
  if (settings.error) {
    const reason = classifySkipReason(settings.error, settings.timedOut === true);
    safeLog(deps, reason === "schema_unavailable" ? "warn" : "error",
      `voicemail retention SKIPPED — routing settings unavailable (${reason})`, {
        error: settings.error.message,
        timed_out: settings.timedOut === true,
      });
    return { ...out, status: "skipped", reason, queue_empty: false };
  }

  const rows = settings.data ?? [];
  if (rows.length === 0) {
    safeLog(deps, "info", "voicemail retention: no organization has routing settings — nothing to do");
    return { ...out, status: "completed", reason: "no_org_settings" };
  }

  for (const row of rows) {
    if (outOfTime()) {
      out.budget_exhausted = true;
      safeLog(deps, "warn", "voicemail retention budget exhausted — remaining organizations left for the next run", {
        budget_ms: LIMITS.RETENTION_PASS_BUDGET_MS,
      });
      break;
    }
    let sawAnyBatch = false;
    const orgId = row.organization_id;
    const days = Number(row.voicemail_retention_days ?? 30);
    if (!orgId || !Number.isFinite(days) || days <= 0) continue;
    out.orgs_processed += 1;

    // Cutoffs are UNCHANGED: listened rows against `listened_at` at the org's retention, unheard rows
    // against `created_at` at the 90-day cap. Strict `<` lives in the SQL.
    const listenedCutoff = new Date(deps.retentionAnchorMs - days * DAY_MS).toISOString();
    const unheardCutoff = new Date(deps.retentionAnchorMs - VOICEMAIL_UNHEARD_MAX_DAYS * DAY_MS).toISOString();

    let incomplete = false;
    let incompleteReason: string | undefined;
    let budgetLimited = false;
    let capacityLimited = true; // cleared the moment we observe an empty batch for this organization
    for (let round = 0; round < LIMITS.RETENTION_MAX_ROUNDS; round++) {
      if (outOfTime()) {
        // Budget is NOT an operational failure: nothing went wrong, there was simply more to do than
        // time allowed, and everything left is still eligible on the next run.
        out.budget_exhausted = true;
        budgetLimited = true;
        break;
      }
      const batch = await boundedDb(
        () => deps.expiredBatch({ orgId, listenedCutoff, unheardCutoff, limit: LIMITS.RETENTION_BATCH_SIZE }),
        LIMITS.DB_REQUEST_TIMEOUT_MS,
      );
      if (batch.error) {
        safeLog(deps, "error", "voicemail retention batch query failed — organization left incomplete", {
          organization_id: orgId,
          error: batch.error.message,
          timed_out: batch.timedOut === true,
        });
        incomplete = true;
        incompleteReason ??= "batch_error";
        break;
      }
      out.batches_observed += 1;
      sawAnyBatch = true;
      const expired = batch.data ?? [];
      if (expired.length === 0) {
        out.batches_empty += 1;
        capacityLimited = false; // this organization's queue is provably drained
        break;
      }

      const paths = expired.map((r) => r.storage_path).filter((p): p is string => !!p);
      if (paths.length) {
        const removed = await boundedDb(() => deps.removeObjects(paths), LIMITS.DB_REQUEST_TIMEOUT_MS);
        if (removed.error) {
          // PRESERVED: objects stay, rows stay 'stored', the next run retries. Never mark purged
          // without a successful removal.
          safeLog(deps, "error", "voicemail storage removal failed — nothing marked purged, work left for the next run", {
            organization_id: orgId,
            objects: paths.length,
            error: removed.error.message,
            timed_out: removed.timedOut === true,
          });
          incomplete = true;
          incompleteReason ??= "storage_error";
          break;
        }
        // Supabase Storage reports per-object outcomes in `data`. Count what it says it removed, not
        // what we asked for, and surface any shortfall. (The purge decision is deliberately unchanged:
        // the existing contract is bucket-level — a returned error means nothing is marked purged.)
        const removedList = Array.isArray(removed.data) ? (removed.data as unknown[]).length : null;
        out.objects_removed += removedList ?? paths.length;
        if (removedList !== null && removedList < paths.length) {
          out.objects_missing += paths.length - removedList;
          safeLog(deps, "warn", "voicemail storage removal reported fewer objects than requested", {
            organization_id: orgId,
            requested: paths.length,
            removed: removedList,
            note: "rows are still marked purged — the bucket-level contract is unchanged by this pass",
          });
        }
      }

      const purged = await boundedDb(
        () => deps.markPurged(expired.map((r) => r.id)),
        LIMITS.DB_REQUEST_TIMEOUT_MS,
      );
      if (purged.error) {
        safeLog(deps, "error", "marking voicemails purged failed after their media was removed", {
          organization_id: orgId,
          rows: expired.length,
          error: purged.error.message,
          timed_out: purged.timedOut === true,
          note: purged.timedOut ? "an aborted database request does not prove the transaction rolled back" : undefined,
        });
        incomplete = true;
        incompleteReason ??= "purge_error";
        break;
      }
      out.rows_purged += Number(purged.data ?? 0);
    }
    if (incomplete) {
      out.orgs_incomplete += 1;
      out.incomplete_reason ??= incompleteReason;
    } else if (budgetLimited) {
      out.orgs_budget_limited += 1;
    } else if (capacityLimited && sawAnyBatch) {
      // Every round was used and no empty batch was ever seen, so completion is NOT established.
      out.orgs_capacity_limited += 1;
      safeLog(deps, "warn", "voicemail retention used every round without draining the queue — more rows may remain", {
        organization_id: orgId,
        rounds: LIMITS.RETENTION_MAX_ROUNDS,
        batch_size: LIMITS.RETENTION_BATCH_SIZE,
      });
    }

  }

  // NOTE: `objects_missing` is reported but deliberately does NOT by itself degrade the phase. When a
  // previous run removed the media and then failed to mark the rows purged, those rows are re-offered
  // and their objects are already gone — a benign self-heal that would otherwise flag every recovery
  // run as `partial`. Only an incomplete organization or an exhausted budget changes the status.
  // `queue_empty` reports ONLY what was observed: at least one batch query was issued and every one
  // of them came back empty. A phase that never got to query anything claims nothing.
  out.queue_empty = out.batches_observed > 0 && out.batches_observed === out.batches_empty;

  // Status, in priority order. An OPERATIONAL failure outranks a capacity or budget limit; a capacity
  // or budget limit is `partial`, never `failed`, because nothing went wrong and everything left is
  // still eligible next run. `completed` requires that completion was actually ESTABLISHED.
  if (out.orgs_incomplete > 0) {
    out.status = out.rows_purged > 0 || out.objects_removed > 0 ? "partial" : "failed";
    out.reason ??= out.incomplete_reason ?? "org_incomplete";
  } else if (out.orgs_capacity_limited > 0) {
    out.status = "partial";
    out.reason ??= "capacity_limited";
  } else if (out.budget_exhausted || out.orgs_budget_limited > 0) {
    out.status = "partial";
    out.reason ??= "budget_exhausted";
  }
  return out;
}

/**
 * The parsed blocked-work backlog, or an explicit reason it is UNKNOWN.
 *
 * CORRECTIVE PASS 13b. The first version of this parser coerced anything missing or malformed to 0,
 * which silently turned "we could not find out" into "there is no backlog" — destroying the very
 * distinction the blocked-work reporting exists to make. An empty object, a summary missing
 * `blocked_total`, a negative or non-numeric count, or a self-contradictory pair (100 due out of a total
 * of 0) all produced `completed / no_work / queue_empty: true`. The whole contract is now validated, and
 * ANY breach yields `unknown` with the reason named.
 *
 * CORRECTIVE PASS 13c closed the last inconsistent shape the contract still accepted: `scan_capped: true`
 * with `blocked_total: 0`, which reported a truncated scan and an empty backlog in the same breath and
 * still read as `completed / no_work / queue_empty: true`. See the derivation at the check itself.
 */
export type BlockedSummary = { due: number; total: number; orgs: number; oldest: string | null; capped: boolean };
export type BlockedSummaryParse = { ok: true; value: BlockedSummary } | { ok: false; reason: string };

/** Non-negative, finite, integral, and a real JSON number — `voicemails_cleanup_blocked_summary` casts
 *  every count to `integer`, so a string, a float or a negative is a broken contract, not a variant. */
function countOf(row: Record<string, unknown>, key: string): { ok: true; n: number } | { ok: false; reason: string } {
  // A key that is absent and a key explicitly set to `undefined` are the same broken contract.
  if (!(key in row) || row[key] === undefined) return { ok: false, reason: `${key} is missing` };
  const v = row[key];
  if (typeof v !== "number") return { ok: false, reason: `${key} is ${v === null ? "null" : typeof v}, not a number` };
  if (!Number.isFinite(v)) return { ok: false, reason: `${key} is not finite` };
  if (!Number.isInteger(v)) return { ok: false, reason: `${key} is not an integer (${v})` };
  if (v < 0) return { ok: false, reason: `${key} is negative (${v})` };
  return { ok: true, n: v };
}

/**
 * Validates the COMPLETE summary contract before believing any of it.
 *
 * Accepts the SQL shape (`RETURNS TABLE` arrives as a one-element array) and the bare-object form some
 * clients hand back. Anything else — an empty array, several rows, a non-object, a missing or malformed
 * field, a bad cap flag, or counts that contradict each other — is UNKNOWN. Unknown is not zero: the
 * caller sets `blocked_summary_unavailable`, refuses to call the queue empty, and refuses a clean
 * `completed / no_work`, while still letting actionable cleanup proceed.
 */
export function parseBlockedSummary(
  data: BlockedSummaryRow[] | BlockedSummaryRow | null | undefined,
): BlockedSummaryParse {
  if (data === null || data === undefined) return { ok: false, reason: "no summary returned" };

  let row: unknown = data;
  if (Array.isArray(data)) {
    // RETURNS TABLE over a single aggregate row: exactly one element, never zero and never several.
    if (data.length !== 1) return { ok: false, reason: `expected exactly 1 summary row, got ${data.length}` };
    row = data[0];
  }
  if (!row || typeof row !== "object" || Array.isArray(row)) return { ok: false, reason: "summary row is not an object" };
  const r = row as Record<string, unknown>;

  const due = countOf(r, "blocked_due");
  if (!due.ok) return { ok: false, reason: due.reason };
  const total = countOf(r, "blocked_total");
  if (!total.ok) return { ok: false, reason: total.reason };
  const orgs = countOf(r, "blocked_orgs");
  if (!orgs.ok) return { ok: false, reason: orgs.reason };

  if (!("scan_capped" in r) || r.scan_capped === undefined) return { ok: false, reason: "scan_capped is missing" };
  if (typeof r.scan_capped !== "boolean") return { ok: false, reason: `scan_capped is ${typeof r.scan_capped}, not a boolean` };

  if (!("oldest_blocked_at" in r) || r.oldest_blocked_at === undefined) return { ok: false, reason: "oldest_blocked_at is missing" };
  const oldestRaw = r.oldest_blocked_at;
  if (oldestRaw !== null && typeof oldestRaw !== "string") {
    return { ok: false, reason: `oldest_blocked_at is ${typeof oldestRaw}, not a string or null` };
  }

  // Relationships the SQL guarantees. A summary that contradicts itself is not partially usable.
  if (due.n > total.n) return { ok: false, reason: `blocked_due (${due.n}) exceeds blocked_total (${total.n})` };
  if (orgs.n > total.n) return { ok: false, reason: `blocked_orgs (${orgs.n}) exceeds blocked_total (${total.n})` };
  if (total.n > 0 && orgs.n < 1) return { ok: false, reason: `blocked_total is ${total.n} but blocked_orgs is 0` };
  if (total.n === 0 && (due.n !== 0 || orgs.n !== 0)) {
    return { ok: false, reason: `blocked_total is 0 but due=${due.n} orgs=${orgs.n}` };
  }
  if (total.n > 0 && oldestRaw === null) return { ok: false, reason: `blocked_total is ${total.n} but oldest_blocked_at is null` };
  if (total.n === 0 && oldestRaw !== null) return { ok: false, reason: "blocked_total is 0 but oldest_blocked_at is set" };
  // CORRECTIVE PASS 13c. A capped scan that retained nothing is arithmetically impossible, so believing
  // it produced `queue_empty: true` and `completed / no_work` alongside `blocked_scan_capped: true` —
  // two statements that contradict each other in the same report. The derivation, straight from M8:
  //   n           := least(greatest(coalesce(p_scan_limit, 5000), 1), 50000)   -- so n >= 1, always
  //   scanned     := (blocked predicate) LIMIT n + 1
  //   scan_capped := count(scanned) > n
  //   kept        := scanned LIMIT n          -- so count(kept) = min(count(scanned), n)
  //   blocked_total := count(kept)
  // `scan_capped` true means count(scanned) > n >= 1, hence count(kept) = n >= 1, hence blocked_total >= 1.
  // A capped scan therefore ALWAYS reports at least one retained blocked row. This is a malformed-response
  // boundary, not a claim about anything production's SQL emits.
  if (r.scan_capped && total.n === 0) {
    return { ok: false, reason: "scan_capped is true but blocked_total is 0 (a capped scan retains at least one row)" };
  }

  return { ok: true, value: { due: due.n, total: total.n, orgs: orgs.n, oldest: oldestRaw, capped: r.scan_capped } };
}

// ── Phase 2: provider source cleanup ─────────────────────────────────────────────────────────────

export async function runVoicemailSourceCleanup(deps: VoicemailDeps): Promise<CleanupPhase> {
  const out: CleanupPhase = {
    status: "completed",
    batches: 0,
    rows_attempted: 0,
    provider_deletions: 0,
    reconciled: 0,
    provider_failures: 0,
    provider_failures_recorded: 0,
    unresolved: 0,
    skipped_invalid_sid: 0,
    unresolved_ownership: 0,
    blocked_ownership_due: 0,
    blocked_ownership_total: 0,
    blocked_ownership_orgs: 0,
    blocked_scan_capped: false,
    blocked_summary_unavailable: false,
    oldest_blocked_at: null,
    near_attempt_ceiling: 0,
    budget_exhausted: false,
    queue_empty: false,
    actionable_queue_empty: false,
  };

  if (admissionClosed(deps)) {
    safeLog(deps, "warn", "voicemail source cleanup SKIPPED — the invocation admission limit was already spent on entry", {
      invocation_budget_ms: LIMITS.INVOCATION_BUDGET_MS,
      elapsed_ms: deps.nowMs() - deps.invocationStartMs,
    });
    return { ...out, status: "skipped", reason: "invocation_budget_exhausted" };
  }

  const creds = deps.credentials();
  if (!creds) {
    safeLog(deps, "warn", "voicemail source cleanup SKIPPED — provider credentials absent", {});
    return { ...out, status: "skipped", reason: "missing_credentials" };
  }

  const deadline = phaseDeadline(deps, LIMITS.CLEANUP_PASS_BUDGET_MS);
  const outOfTime = () => deps.nowMs() >= deadline;
  const attempted = new Set<string>();

  // The backlog the actionable selection will skip, read ONCE and bounded. Its failure degrades the
  // REPORT, never the work: the pass still cleans up actionable rows, it just cannot say how much
  // blocked work stands behind them, and it says exactly that instead of implying none.
  {
    const summary = await boundedDb(
      () => deps.cleanupBlockedSummary(LIMITS.BLOCKED_SCAN_LIMIT) as Promise<DbResult<BlockedSummaryRow[]>>,
      LIMITS.DB_REQUEST_TIMEOUT_MS,
    );
    const parsed: BlockedSummaryParse = summary.error
      ? { ok: false, reason: `read failed: ${summary.error.message}` }
      : parseBlockedSummary(summary.data);
    if (!parsed.ok) {
      // UNKNOWN, never zero. The counters stay at their initial 0 only because the type requires a
      // number; `blocked_summary_unavailable` is what the status logic and `queue_empty` actually read,
      // so an unreadable or malformed summary can never be mistaken for an empty backlog.
      out.blocked_summary_unavailable = true;
      safeLog(deps, "error", "voicemail blocked-work summary unavailable — the size of the unresolved-ownership backlog is UNKNOWN this pass", {
        reason: parsed.reason,
        timed_out: summary.timedOut === true,
        note: "this is NOT a report of zero blocked rows; actionable cleanup still runs",
      });
    } else {
      out.blocked_ownership_due = parsed.value.due;
      out.blocked_ownership_total = parsed.value.total;
      out.blocked_ownership_orgs = parsed.value.orgs;
      out.blocked_scan_capped = parsed.value.capped;
      out.oldest_blocked_at = parsed.value.oldest;
      if (parsed.value.total > 0) {
        safeLog(deps, "error", "voicemail source cleanup is BLOCKED on rows whose owning provider account cannot be established — skipped, never modified, and still owed", {
          blocked_due: parsed.value.due,
          blocked_total: parsed.value.total,
          organizations: parsed.value.orgs,
          oldest_blocked_at: parsed.value.oldest,
          scan_capped: parsed.value.capped,
          note: "these need operator attention: each becomes actionable again once a signed callback persists its owner",
        });
      }
    }
  }

  // Tracks whether the last batch filled its limit. A short final batch means the queue drained
  // inside our capacity, so hitting CLEANUP_MAX_BATCHES then is NOT evidence that work remains.
  let lastBatchWasFull = false;

  for (;;) {
    if (out.batches >= LIMITS.CLEANUP_MAX_BATCHES) {
      if (lastBatchWasFull) {
        out.stopped_reason = "max_batches";
      } else {
        // The last batch was short, so the queue was drained WITHIN our capacity. We never observed
        // an empty batch, so `queue_empty` stays false — rows that became due during the pass are
        // not reflected here.
        out.stopped_reason = "queue_drained";
      }
      break;
    }
    if (outOfTime()) {
      out.budget_exhausted = true;
      out.stopped_reason = "budget";
      break;
    }

    const batch = await boundedDb(() => deps.cleanupActionableBatch(LIMITS.CLEANUP_BATCH_SIZE), LIMITS.DB_REQUEST_TIMEOUT_MS);
    out.batches += 1;
    if (batch.error) {
      if (out.batches === 1) {
        const reason = classifySkipReason(batch.error, batch.timedOut === true);
        safeLog(deps, reason === "schema_unavailable" ? "warn" : "error",
          `voicemail source cleanup SKIPPED — due-batch query unavailable (${reason})`, {
            error: batch.error.message,
            timed_out: batch.timedOut === true,
          });
        // `batches: 0` — a skipped phase did not run, so it must not report a batch it never used.
        return { ...out, batches: 0, status: "skipped", reason };
      }
      safeLog(deps, "error", "voicemail source cleanup due-batch query failed mid-pass", {
        error: batch.error.message,
        timed_out: batch.timedOut === true,
      });
      out.stopped_reason = "batch_error";
      break;
    }

    const raw = batch.data ?? [];
    lastBatchWasFull = raw.length >= LIMITS.CLEANUP_BATCH_SIZE;
    // Drop anything that is not a usable row BEFORE the progress guard touches it: a null or
    // schema-drifted element must not throw out of the loop and discard the pass's counters.
    const rows = raw.filter((r): r is CleanupRow => !!r && typeof r === "object" && typeof r.id === "string");
    if (rows.length < raw.length) {
      out.skipped_invalid_sid += raw.length - rows.length;
      safeLog(deps, "error", "voicemail due-batch returned unusable rows — skipped (schema drift?)", {
        returned: raw.length,
        usable: rows.length,
      });
    }
    if (rows.length === 0) {
      // The ACTIONABLE queue is drained. Whether anything is still OWED depends on the blocked backlog,
      // which `queue_empty` accounts for below.
      out.actionable_queue_empty = true;
      out.stopped_reason = "queue_empty";
      break;
    }

    // Progress guard: a batch containing nothing we have not already tried this invocation means the
    // pass has stopped converging (typically every reconciliation is unresolved). Stop rather than
    // re-issue provider DELETEs for rows we already attempted.
    const fresh = rows.filter((r) => !attempted.has(r.id));
    if (fresh.length === 0) {
      out.stopped_reason = "no_progress";
      safeLog(deps, "warn", "voicemail source cleanup made no progress on a repeated batch — stopping this invocation", {
        batch_rows: rows.length,
        attempted_this_run: attempted.size,
      });
      break;
    }

    const { notStarted } = await runBounded(fresh, LIMITS.CLEANUP_CONCURRENCY, outOfTime, async (row) => {
      // EVERYTHING here is inside the guard: a malformed row object must not reject the worker pool
      // and discard the whole pass's counters. One bad row is one unresolved obligation.
      try {
        attempted.add(row?.id);
        const attempts = Number(row?.source_cleanup_attempts ?? 0);
        if (Number.isFinite(attempts) && attempts >= 49) out.near_attempt_ceiling += 1;
        const sid = (row?.recording_sid || "").trim();
        if (!RECORDING_SID_RE.test(sid)) {
          out.skipped_invalid_sid += 1;
          safeLog(deps, "warn", "voicemail row has a malformed recording SID — provider not contacted", { row_id: row?.id });
          return;
        }
        const { outcome, providerAttempted, providerConfirmed } = await reconcileCleanupRow(deps, row);
        // Attempt and completion counters stay truthful: a row we never asked about is neither.
        if (providerAttempted) {
          out.rows_attempted += 1;
          if (providerConfirmed) out.provider_deletions += 1;
          else out.provider_failures += 1;
        }
        if (outcome === "reconciled") out.reconciled += 1;
        else if (outcome === "provider_failure_recorded") out.provider_failures_recorded += 1;
        else if (outcome === "unresolved_ownership") out.unresolved_ownership += 1;
        else out.unresolved += 1;
      } catch (err) {
        out.unresolved += 1;
        safeLog(deps, "error", "voicemail cleanup row threw unexpectedly — obligation left outstanding", {
          row_id: row?.id,
          error: errText(err),
        });
      }
    });

    if (notStarted.length > 0) {
      out.budget_exhausted = true;
      out.stopped_reason = "budget";
      safeLog(deps, "warn", "voicemail source cleanup budget exhausted — unstarted rows left recoverable", {
        not_started: notStarted.length,
        budget_ms: LIMITS.CLEANUP_PASS_BUDGET_MS,
      });
      break;
    }
  }

  // Status. `completed` is reserved for a pass that finished its queue with NOTHING outstanding —
  // a provider failure is outstanding work even when its failure row was written perfectly, so a
  // pass in which the provider rejected every DELETE can never read as a healthy completion.
  const progressed = out.reconciled + out.provider_failures_recorded;
  // NOTHING IS OWED requires all three: the actionable queue drained, no blocked backlog, and a blocked
  // backlog that was actually readable. Skipping blocked rows must never read as an empty queue.
  out.queue_empty =
    out.actionable_queue_empty && out.blocked_ownership_total === 0 && !out.blocked_summary_unavailable;

  const outstanding =
    out.unresolved > 0 ||
    out.unresolved_ownership > 0 ||
    out.blocked_ownership_total > 0 ||
    out.blocked_summary_unavailable ||
    out.provider_failures > 0 ||
    out.skipped_invalid_sid > 0 ||
    out.budget_exhausted ||
    out.stopped_reason === "no_progress" ||
    out.stopped_reason === "batch_error" ||
    out.stopped_reason === "max_batches";

  if (out.rows_attempted === 0 && out.skipped_invalid_sid === 0 && out.unresolved_ownership === 0 && out.queue_empty) {
    out.status = "completed";
    out.reason = "no_work";
  } else if (outstanding) {
    // Running out of budget is not a FAILURE in either phase: nothing went wrong, there was simply
    // more to do than time allowed, and everything left is still eligible on the next run.
    const onlyBudget =
      out.budget_exhausted &&
      out.unresolved === 0 &&
      out.unresolved_ownership === 0 &&
      out.blocked_ownership_total === 0 &&
      !out.blocked_summary_unavailable &&
      out.provider_failures === 0 &&
      out.skipped_invalid_sid === 0 &&
      out.stopped_reason !== "no_progress" &&
      out.stopped_reason !== "batch_error";
    // A pass that cleaned everything it COULD reach, with a blocked backlog standing behind it, has made
    // progress and left work unresolved: `partial`. It is not `failed` (nothing went wrong here) and it
    // is emphatically not `completed`.
    const blockedOnly =
      (out.blocked_ownership_total > 0 || out.blocked_summary_unavailable) &&
      out.unresolved === 0 &&
      out.unresolved_ownership === 0 &&
      out.provider_failures === 0 &&
      out.skipped_invalid_sid === 0 &&
      !out.budget_exhausted &&
      out.stopped_reason !== "no_progress" &&
      out.stopped_reason !== "batch_error";
    out.status = progressed > 0 || onlyBudget || blockedOnly ? "partial" : "failed";
    if (!out.reason) {
      out.reason = out.unresolved_ownership > 0
        ? "unresolved_ownership"
        : out.unresolved > 0
        ? "unresolved"
        : out.provider_failures > 0
          ? "provider_failures"
          : out.blocked_summary_unavailable
            ? "blocked_summary_unavailable"
            : out.blocked_ownership_total > 0
              ? "blocked_unresolved_ownership"
              : (out.stopped_reason ?? "outstanding");
    }
  } else {
    out.status = "completed";
  }
  return out;
}

// ── Entry point used by index.ts ─────────────────────────────────────────────────────────────────

/**
 * Runs both voicemail phases and returns exactly the object index.ts splices into its JSON response.
 * NEVER rejects: a dependency that throws becomes a `failed` phase, so no caller-side try/catch can
 * silently discard a corrected result, and a voicemail failure can never turn the conversation
 * recording purge's 200 into a 500.
 */
export async function runVoicemailPhases(deps: VoicemailDeps): Promise<VoicemailPhases> {
  const retention = await safePhase(
    () => runVoicemailRetention(deps),
    (message): RetentionPhase => ({
      status: "failed",
      reason: `unexpected_error: ${message}`,
      orgs_processed: 0,
      orgs_incomplete: 0,
      orgs_capacity_limited: 0,
      orgs_budget_limited: 0,
      batches_observed: 0,
      batches_empty: 0,
      rows_purged: 0,
      objects_removed: 0,
      objects_missing: 0,
      budget_exhausted: false,
      queue_empty: false,
    }),
    deps,
    "voicemail retention",
  );
  const cleanup = await safePhase(
    () => runVoicemailSourceCleanup(deps),
    (message): CleanupPhase => ({
      status: "failed",
      reason: `unexpected_error: ${message}`,
      batches: 0,
      rows_attempted: 0,
      provider_deletions: 0,
      reconciled: 0,
      provider_failures: 0,
      provider_failures_recorded: 0,
      unresolved: 0,
      skipped_invalid_sid: 0,
      unresolved_ownership: 0,
      blocked_ownership_due: 0,
      blocked_ownership_total: 0,
      blocked_ownership_orgs: 0,
      blocked_scan_capped: false,
      blocked_summary_unavailable: true,
      oldest_blocked_at: null,
      near_attempt_ceiling: 0,
      budget_exhausted: false,
      queue_empty: false,
      actionable_queue_empty: false,
    }),
    deps,
    "voicemail source cleanup",
  );
  return {
    voicemail_phases_ok: retention.status === "completed" && cleanup.status === "completed",
    voicemail_retention: retention,
    voicemail_source_cleanup: cleanup,
  };
}

async function safePhase<T>(
  run: () => Promise<T>,
  onError: (message: string) => T,
  deps: VoicemailDeps,
  label: string,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const message = errText(err);
    try {
      safeLog(deps, "error", `${label} threw unexpectedly — reported as failed`, { error: message });
    } catch {
      /* logging must never mask the phase result */
    }
    return onError(message);
  }
}
