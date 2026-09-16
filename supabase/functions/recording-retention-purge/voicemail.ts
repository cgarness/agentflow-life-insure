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
} as const;

// ── Result shapes ────────────────────────────────────────────────────────────────────────────────
//
// `completed` = the phase ran to its natural end with nothing outstanding (including the healthy
//               empty queue, which is distinguishable by queue_empty + zero counters).
// `skipped`   = the phase did not run at all; `reason` says why (missing_credentials,
//               schema_unavailable, db_timeout). This is the documented compatibility behaviour when
//               the v2 schema is genuinely absent — and it no longer looks like a healthy zero run.
// `partial`   = the phase made progress but stopped early or left work unresolved.
// `failed`    = the phase could not make progress.

export type PhaseStatus = "completed" | "skipped" | "partial" | "failed";

export interface RetentionPhase {
  status: PhaseStatus;
  reason?: string;
  orgs_processed: number;
  /** Organizations whose retention loop ended on an error rather than an empty batch. */
  orgs_incomplete: number;
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
  /** True only when every organization's batch query came back empty. */
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
   * Rows seen this pass that are one failed attempt away from M7's 50-attempt ceiling, after which
   * `voicemails_cleanup_batch` stops offering them and their provider source is abandoned. Reported
   * so that abandonment is observable; this code never changes the ceiling.
   */
  near_attempt_ceiling: number;
  budget_exhausted: boolean;
  queue_empty: boolean;
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
  cleanupBatch: (limit: number) => Promise<DbResult<CleanupRow[]>>;
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
 * Distinguishes "the v2 schema is genuinely absent" (the documented compatibility path) from "the
 * database was momentarily unavailable". Both skip the phase, but only the first is benign, so they
 * must not share a reason: a nightly connection refusal previously read as `schema_unavailable`.
 */
export function classifySkipReason(err: DbError, timedOut: boolean): string {
  if (timedOut) return "db_timeout";
  const m = (err?.message || "").toLowerCase();
  const missing =
    /does not exist|undefined table|undefined function|could not find .* in the schema cache|schema cache|relation .* does not exist|pgrst202|42p01|42883/.test(m);
  return missing ? "schema_unavailable" : "db_unavailable";
}

/** A phase deadline: its own budget, but never past the whole invocation's cap. */
export function phaseDeadline(deps: VoicemailDeps, phaseBudgetMs: number): number {
  return Math.min(deps.nowMs() + phaseBudgetMs, deps.invocationStartMs + LIMITS.INVOCATION_BUDGET_MS);
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
  fallbackAccountSid: string,
): Promise<{ outcome: RowOutcome; providerConfirmed: boolean }> {
  const sid = (row.recording_sid || "").trim();
  // The owning account SID is interpolated into the provider URL path, so it is validated to the same
  // standard as the recording SID; anything else falls back to the platform account rather than
  // shaping the request from unvalidated stored data.
  const storedOwner = (row.provider_account_sid || "").trim();
  const owner = ACCOUNT_SID_RE.test(storedOwner) ? storedOwner : fallbackAccountSid;

  const provider = await callProvider(deps, {
    ownerAccountSid: owner,
    recordingSid: sid,
    timeoutMs: LIMITS.PROVIDER_REQUEST_TIMEOUT_MS,
  });
  const providerConfirmed = providerConfirmsDeleted(provider);
  const detail = describeProviderResult(provider);

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
        return { outcome: "reconciled", providerConfirmed };
      }
      safeLog(deps, "error", "provider deletion confirmed but database reconciliation FAILED — cleanup still owed", {
        recording_sid: sid,
        error: r.error.message,
        timed_out: r.timedOut === true,
        readback: rb.note,
        note: r.timedOut ? "an aborted database request does not prove the transaction rolled back" : undefined,
      });
      return { outcome: "unresolved", providerConfirmed };
    }
    const { confirmed, note } = await confirmDeletedState(deps, sid, r.data?.updated);
    if (confirmed) return { outcome: "reconciled", providerConfirmed };
    safeLog(deps, "error", "provider deletion confirmed but database state could not be confirmed — cleanup still owed", {
      recording_sid: sid,
      note,
    });
    return { outcome: "unresolved", providerConfirmed };
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
    return { outcome: "unresolved", providerConfirmed };
  }
  if (r.data?.updated === true) {
    safeLog(deps, "warn", "provider deletion failed; failure recorded and backoff applied", {
      recording_sid: sid,
      provider: detail,
    });
    return { outcome: "provider_failure_recorded", providerConfirmed };
  }
  // `updated:false` here means no non-deleted row matched. Read back before deciding.
  const { confirmed, note } = await confirmDeletedState(deps, sid, false);
  if (confirmed) {
    safeLog(deps, "info", "provider deletion failed but the row is already reconciled elsewhere", {
      recording_sid: sid,
      provider: detail,
      note,
    });
    return { outcome: "reconciled", providerConfirmed };
  }
  safeLog(deps, "error", "provider deletion failed and the failure record did not land — cleanup still owed", {
    recording_sid: sid,
    provider: detail,
    note,
  });
  return { outcome: "unresolved", providerConfirmed };
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
    rows_purged: 0,
    objects_removed: 0,
    objects_missing: 0,
    budget_exhausted: false,
    queue_empty: true,
  };
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
    for (let round = 0; round < LIMITS.RETENTION_MAX_ROUNDS; round++) {
      if (outOfTime()) {
        out.budget_exhausted = true;
        incomplete = true;
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
      const expired = batch.data ?? [];
      if (expired.length === 0) break;
      out.queue_empty = false;

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
    }
  }

  if (out.orgs_incomplete > 0 || out.budget_exhausted || out.objects_missing > 0) {
    // Running out of budget is not a FAILURE — nothing went wrong, there was simply more to do than
    // time allowed, and everything left is still eligible next run.
    const onlyBudget = out.orgs_incomplete === 0 && out.objects_missing === 0;
    out.status = onlyBudget || out.rows_purged > 0 || out.objects_removed > 0 ? "partial" : "failed";
    if (!out.reason) {
      out.reason = out.orgs_incomplete > 0
        ? (out.incomplete_reason ?? "org_incomplete")
        : out.budget_exhausted
          ? "budget_exhausted"
          : "objects_missing";
    }
  }
  return out;
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
    near_attempt_ceiling: 0,
    budget_exhausted: false,
    queue_empty: false,
  };

  const creds = deps.credentials();
  if (!creds) {
    safeLog(deps, "warn", "voicemail source cleanup SKIPPED — provider credentials absent", {});
    return { ...out, status: "skipped", reason: "missing_credentials" };
  }

  const deadline = phaseDeadline(deps, LIMITS.CLEANUP_PASS_BUDGET_MS);
  const outOfTime = () => deps.nowMs() >= deadline;
  const attempted = new Set<string>();

  // Tracks whether the last batch filled its limit. A short final batch means the queue drained
  // inside our capacity, so hitting CLEANUP_MAX_BATCHES then is NOT evidence that work remains.
  let lastBatchWasFull = false;

  for (;;) {
    if (out.batches >= LIMITS.CLEANUP_MAX_BATCHES) {
      if (lastBatchWasFull) {
        out.stopped_reason = "max_batches";
      } else {
        out.queue_empty = true;
        out.stopped_reason = "queue_drained";
      }
      break;
    }
    if (outOfTime()) {
      out.budget_exhausted = true;
      out.stopped_reason = "budget";
      break;
    }

    const batch = await boundedDb(() => deps.cleanupBatch(LIMITS.CLEANUP_BATCH_SIZE), LIMITS.DB_REQUEST_TIMEOUT_MS);
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
      out.queue_empty = true;
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
        out.rows_attempted += 1;
        const { outcome, providerConfirmed } = await reconcileCleanupRow(deps, row, creds.accountSid);
        if (providerConfirmed) out.provider_deletions += 1;
        else out.provider_failures += 1;
        if (outcome === "reconciled") out.reconciled += 1;
        else if (outcome === "provider_failure_recorded") out.provider_failures_recorded += 1;
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
  const outstanding =
    out.unresolved > 0 ||
    out.provider_failures > 0 ||
    out.skipped_invalid_sid > 0 ||
    out.budget_exhausted ||
    out.stopped_reason === "no_progress" ||
    out.stopped_reason === "batch_error" ||
    out.stopped_reason === "max_batches";

  if (out.rows_attempted === 0 && out.skipped_invalid_sid === 0 && out.queue_empty) {
    out.status = "completed";
    out.reason = "no_work";
  } else if (outstanding) {
    out.status = progressed > 0 ? "partial" : "failed";
    if (!out.reason) {
      out.reason = out.unresolved > 0
        ? "unresolved"
        : out.provider_failures > 0
          ? "provider_failures"
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
      near_attempt_ceiling: 0,
      budget_exhausted: false,
      queue_empty: false,
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
