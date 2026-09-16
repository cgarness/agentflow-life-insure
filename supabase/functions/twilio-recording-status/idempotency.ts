// Pure, dependency-free R17 pipeline logic for twilio-recording-status.
// Kept Deno-free so it is unit-tested under vitest (see src/lib/__tests__/recordingIdempotency.test.ts
// and src/lib/__tests__/recordingCleanupRetry.test.ts).
// Plan rev5 R17 + rev6 C6: a valid recording_storage_path is the ONLY success short-circuit (failure
// sentinels are recoverable, not success); the Twilio source recording is deleted ONLY after storage
// upload AND verified DB metadata persistence both succeed; every recoverable failure preserves the
// source and returns a retryable 5xx (the callback URL's connection overrides provide the bounded
// retry channel — Twilio's default policy does not retry 5xx); unmatched callbacks never
// download/upload/delete. C6: the source RecordingSid is persisted atomically with the verified
// metadata, a failed post-persist DELETE is itself retryable (5xx), and a retried callback whose
// RecordingSid exactly matches the stored source SID performs CLEANUP ONLY — a different
// RecordingSid never deletes that distinct source ("first completed recording wins" preserves it).

const RECORDING_SID_RE = /^RE[0-9a-fA-F]{32}$/;

export function isValidRecordingSid(sid: string | null | undefined): boolean {
  return RECORDING_SID_RE.test((sid || "").trim());
}

export interface RecordingRowState {
  recording_storage_path?: string | null;
  recording_url?: string | null;
  /** C6: Twilio RecordingSid persisted atomically with the verified metadata (M3 column). */
  recording_source_sid?: string | null;
}

export type RecordingRowClass =
  | "skip_already_stored"
  | "cleanup_retry"
  | "process"
  | "unmatched";

export function isSuccessStoragePath(path: string | null | undefined): boolean {
  return typeof path === "string" && path.trim() !== "";
}

/**
 * C11 (rev 7) — the ONE "unstored" predicate: NULL/undefined or a trimmed-empty string. It governs
 * classification, the failure-sentinel guard, and the first-writer metadata CAS alike. Previously
 * the CAS used `recording_storage_path IS NULL`, so a row holding '' classified as recoverable but
 * could never persist — an endless 503 loop with no convergence.
 */
export function isUnstoredRecordingPath(path: string | null | undefined): boolean {
  return !isSuccessStoragePath(path);
}

export type RecordingPathCas =
  | { kind: "is_null" }
  | { kind: "eq"; value: string };

/**
 * C11 — first-writer-wins CAS against the EXACT value observed on the row we classified. NULL uses
 * `IS NULL`; every other observed value (including '' and whitespace-only) uses an equality match,
 * so a blank path converges while a concurrent writer that stored a real path makes this update
 * match zero rows and keeps its own result.
 */
export function recordingPathCas(observed: string | null | undefined): RecordingPathCas {
  return observed === null || observed === undefined
    ? { kind: "is_null" }
    : { kind: "eq", value: observed };
}

/**
 * C6 classification: a stored row whose durable source SID EXACTLY matches this callback's
 * RecordingSid still owes Twilio a source deletion (idempotent: 404 = already gone). A stored row
 * with a different/absent source SID acks without deleting — that callback's recording is a
 * DISTINCT source which must be preserved, and legacy/browser-stored rows never trigger deletion.
 */
export function classifyRecordingRow(
  row: RecordingRowState | null | undefined,
  callbackRecordingSid?: string | null,
): RecordingRowClass {
  if (!row) return "unmatched";
  if (!isSuccessStoragePath(row.recording_storage_path)) return "process";
  const stored = (row.recording_source_sid || "").trim();
  const incoming = (callbackRecordingSid || "").trim();
  if (
    stored !== "" &&
    incoming !== "" &&
    isValidRecordingSid(incoming) &&
    stored === incoming
  ) {
    return "cleanup_retry";
  }
  return "skip_already_stored";
}

/**
 * Failure sentinels may be written ONLY while no successful storage path exists — same C11
 * predicate as classification and the metadata CAS.
 */
export function shouldWriteFailureSentinel(row: RecordingRowState | null | undefined): boolean {
  return isUnstoredRecordingPath(row?.recording_storage_path);
}

export interface RecordingPipelineDeps {
  download: () => Promise<Uint8Array>;
  upload: (bytes: Uint8Array) => Promise<void>;
  /** Must THROW (or reject) unless the exact-row metadata write provably succeeded (R17). */
  persistMetadata: () => Promise<void>;
  deleteSource: () => Promise<void>;
  writeFailureSentinel: (stage: "download" | "upload" | "persist") => Promise<void>;
}

export type RecordingPipelineResult =
  | { outcome: "stored" }
  | { outcome: "stored_cleanup_failed"; stage: "delete" }
  | { outcome: "retryable_failure"; stage: "download" | "upload" | "persist" };

/**
 * The ordered pipeline: download → upload → persistMetadata → deleteSource.
 * deleteSource runs ONLY after persistMetadata succeeded (delete-only-after-commit). C6: its own
 * non-404 failure is a RETRYABLE outcome (stored_cleanup_failed → 5xx) — the recording is safely
 * stored and the durably persisted source SID lets the retried callback finish the deletion via
 * the cleanup-only path; no sentinel is written for a delete failure (metadata is already good).
 * Any earlier failure preserves the Twilio source, best-effort writes the guarded sentinel, and is
 * reported retryable.
 */
export async function runRecordingPipeline(
  deps: RecordingPipelineDeps,
): Promise<RecordingPipelineResult> {
  let stage: "download" | "upload" | "persist" = "download";
  try {
    const bytes = await deps.download();
    stage = "upload";
    await deps.upload(bytes);
    stage = "persist";
    await deps.persistMetadata();
  } catch {
    try {
      await deps.writeFailureSentinel(stage);
    } catch {
      /* sentinel write is best-effort; the 5xx retry channel is the recovery path */
    }
    return { outcome: "retryable_failure", stage };
  }
  try {
    await deps.deleteSource();
  } catch {
    return { outcome: "stored_cleanup_failed", stage: "delete" };
  }
  return { outcome: "stored" };
}

export type CleanupRetryResult =
  | { outcome: "cleanup_done" }
  | { outcome: "cleanup_retryable_failure" };

/**
 * C6 cleanup-only retry for a row whose metadata is already verified-stored: exactly one Twilio
 * DELETE attempt, nothing else — no download, no upload, no metadata rewrite. The injected
 * deleteSource resolves on 2xx AND 404 (already gone = success) and throws only on other failures,
 * which stay retryable (5xx) and observable via the caller's structured telemetry.
 */
export async function runCleanupRetry(deps: {
  deleteSource: () => Promise<void>;
}): Promise<CleanupRetryResult> {
  try {
    await deps.deleteSource();
  } catch {
    return { outcome: "cleanup_retryable_failure" };
  }
  return { outcome: "cleanup_done" };
}

export type RecordingOutcome =
  | "stored"
  | "stored_cleanup_failed"
  | "skip_already_stored"
  | "cleanup_done"
  | "cleanup_retryable_failure"
  | "unmatched"
  | "ignored"
  | "retryable_failure";

export function decideRecordingResponseStatus(outcome: RecordingOutcome): number {
  return outcome === "retryable_failure" ||
      outcome === "stored_cleanup_failed" ||
      outcome === "cleanup_retryable_failure"
    ? 503
    : 200;
}

// ── Inbound Calling v2 — AgentFlow voicemail pipeline (implementation_plan.md rev 3 §10, §8.6 +
// safeguards 2 and 3). Pure, Deno-free; unit-tested in src/lib/__tests__/voicemailRecordingPipeline.test.ts.
//
// A `source=voicemail` recording callback stores media in the PRIVATE `voicemails` bucket and its
// metadata in public.voicemails (upsert_voicemail_from_recording, status='stored'), then deletes the
// Twilio source. The response policy differs from conversation recordings in ONE place: once media and
// metadata are stored AND the source is deleted, the callback answers 200 even if the notification
// insert failed — the SQL sweep owns the notification (safeguard 2). A failed source deletion after
// storage is a DURABLE retryable state (record_voicemail_cleanup_failure → source_cleanup_state='failed',
// backoff, attempts) answered 503 so the redelivered callback performs CLEANUP ONLY (no re-download,
// no re-upload, no metadata rewrite) and the retention purge's cleanup pass retries later (safeguard 3).

export interface VoicemailRowState {
  status?: string | null;
  storage_path?: string | null;
  source_cleanup_state?: string | null;
}

export type VoicemailRowClass = "process" | "cleanup_retry" | "skip_already_stored";

export function classifyVoicemailRow(row: VoicemailRowState | null | undefined): VoicemailRowClass {
  if (!row) return "process";
  const status = (row.status || "").trim();
  if (status === "stored" || status === "purged") {
    return (row.source_cleanup_state || "").trim() === "deleted" ? "skip_already_stored" : "cleanup_retry";
  }
  return "process";  // pending / failed / unknown ⇒ recoverable
}

// ── Ownership of the provider-side recording (corrective pass, 2026-09-16) ───────────────────────
//
// A DELETE is only meaningful against the account that OWNS the recording, and a 404 only means
// "already gone" when the request reached that account. The previous revision defaulted the owner to
// the platform credential's own account (`params["AccountSid"] ?? creds.accountSid`) and then
// persisted that guess through `p_account_sid` as though it were authoritative. If the recording
// actually lives in a subaccount, the parent-account DELETE answers 404, the row is marked deleted,
// and the media survives. Ownership is therefore ESTABLISHED, never assumed:
//   * the signature-validated callback's own `AccountSid` establishes it;
//   * failing that, an owner already stored on the row establishes it for a retry;
//   * a stored owner that disagrees with the callback is a CONFLICT and is never silently overwritten;
//   * otherwise ownership is UNRESOLVED: preserve the source, persist no guess, stay recoverable.

const PROVIDER_ACCOUNT_SID_RE = /^AC[0-9a-fA-F]{32}$/;

export type VoicemailOwner =
  | { kind: "established"; accountSid: string; source: "callback" | "stored" }
  | { kind: "conflict"; callbackAccountSid: string; storedAccountSid: string }
  | { kind: "unresolved"; reason: "absent" | "malformed" };

export function resolveVoicemailOwner(input: {
  callbackAccountSid?: string | null;
  storedAccountSid?: string | null;
}): VoicemailOwner {
  const cb = (input.callbackAccountSid ?? "").trim();
  const stored = (input.storedAccountSid ?? "").trim();
  const cbOk = PROVIDER_ACCOUNT_SID_RE.test(cb);
  const storedOk = PROVIDER_ACCOUNT_SID_RE.test(stored);

  if (cbOk && storedOk && cb !== stored) {
    return { kind: "conflict", callbackAccountSid: cb, storedAccountSid: stored };
  }
  if (cbOk) return { kind: "established", accountSid: cb, source: "callback" };
  if (storedOk) return { kind: "established", accountSid: stored, source: "stored" };
  return { kind: "unresolved", reason: cb === "" && stored === "" ? "absent" : "malformed" };
}

/**
 * DURABLE OWNERSHIP RECOVERY (corrective pass, 2026-09-16).
 *
 * Establishing the owner in memory is not enough. The reproduced sequence: a stored/purged row holds
 * `provider_account_sid = NULL`, a signed callback supplies account B, the cleanup-retry branch
 * DELETEs against B, the provider answers 503, the callback records the failure and returns 503 — but
 * B is never written. The next purge run sees NULL again, issues no request, and reports
 * `unresolved_ownership` forever. Ownership must therefore be PERSISTED AND VERIFIED before any
 * provider deletion is attempted.
 *
 * The write is a narrowly scoped guarded UPDATE of the owner column alone, bound to the exact
 * voicemail, RecordingSid, call and organization, with `provider_account_sid IS NULL` as its guard.
 * It deliberately does NOT reuse `upsert_voicemail_from_recording`: that function's status expression
 * is `CASE WHEN v.status = 'stored' THEN 'stored' ELSE EXCLUDED.status END`, so a PURGED row would
 * come back as 'stored' — resurrecting purged media — and it would also rewrite recording metadata.
 * Because the update names only `provider_account_sid`, status, storage_path, cleanup state, attempt
 * count, listened state and notification state are all left exactly as they are.
 */
export type OwnerPersistOutcome =
  /** The guarded update landed and the row now holds the expected owner. */
  | "persisted"
  /** Someone else already wrote the SAME owner — a concurrent but agreeing outcome. */
  | "already_matching"
  /** A DIFFERENT established owner is on the row. Never overwrite it. */
  | "conflict"
  /** The outcome is unknown or unavailable: preserve the source and stay recoverable. */
  | "inconclusive";

const OWNER_SID_RE = /^AC[0-9a-fA-F]{32}$/;

/**
 * Turns the result of the guarded owner write — plus a bounded readback when the guard matched
 * nothing — into a durable verdict. A write whose response was lost is NOT assumed to have failed:
 * the readback decides, exactly as elsewhere in this function.
 */
export function classifyOwnerPersistence(input: {
  expected: string;
  /** `provider_account_sid` values returned by the guarded update (empty array = guard matched nothing). */
  updatedOwners?: Array<string | null> | null;
  /** The update returned an error or threw. */
  writeFailed?: boolean;
  /** Owner observed by the bounded readback, if one was performed. */
  readBackOwner?: string | null;
  /** The readback itself was unavailable. */
  readBackFailed?: boolean;
}): OwnerPersistOutcome {
  const expected = (input.expected ?? "").trim();
  if (!OWNER_SID_RE.test(expected)) return "inconclusive";

  const fromReadBack = (): OwnerPersistOutcome => {
    if (input.readBackFailed) return "inconclusive";
    const seen = (input.readBackOwner ?? "").trim();
    if (seen === expected) return "already_matching";
    if (OWNER_SID_RE.test(seen)) return "conflict";
    return "inconclusive"; // still NULL, malformed, or the row was not found
  };

  if (input.writeFailed) return fromReadBack();

  const rows = input.updatedOwners ?? [];
  if (rows.length === 0) return fromReadBack();
  const written = (rows[0] ?? "").trim();
  if (written === expected) return "persisted";
  if (OWNER_SID_RE.test(written)) return "conflict";
  return "inconclusive";
}

/**
 * The upsert's `provider_account_sid` is authoritative: M7 resolves it as
 * `coalesce(v.provider_account_sid, EXCLUDED.provider_account_sid)`, so an EXISTING value wins and
 * the value we passed in may not be what the row actually holds. Never assume the incoming value won.
 */
export function ownerFromUpsertAgrees(authoritative: unknown, used: string): boolean {
  const a = (typeof authoritative === "string" ? authoritative : "").trim();
  return OWNER_SID_RE.test(a) && a === (used ?? "").trim();
}

export type VoicemailOutcome =
  | "stored"
  | "stored_notify_pending"
  | "stored_cleanup_failed"
  | "skip_already_stored"
  | "cleanup_done"
  | "cleanup_retryable_failure"
  | "unmatched"
  | "invalid_request"
  /** The callback and the stored row disagree about which account owns the recording. */
  | "ownership_conflict"
  /** No account could be established as the owner; the source is preserved and nothing is guessed. */
  | "ownership_unresolved"
  | "ignored"
  | "retryable_failure";

/**
 * §8.6 + safeguard 3: 503 ONLY while storage/metadata persistence is incomplete or the source
 * deletion still owes a retry; 200 once stored + deleted, even when the notification is still owed.
 */
export function decideVoicemailResponseStatus(outcome: VoicemailOutcome): number {
  return outcome === "retryable_failure" ||
      outcome === "stored_cleanup_failed" ||
      outcome === "cleanup_retryable_failure" ||
      // Ownership problems are RECOVERABLE, not acknowledgements: the provider source still exists
      // and the obligation is outstanding, so the callback must not be answered with a bare 200.
      outcome === "ownership_conflict" ||
      outcome === "ownership_unresolved"
    ? 503
    : 200;
}

export interface VoicemailPipelineDeps {
  download: () => Promise<Uint8Array>;
  upload: (bytes: Uint8Array) => Promise<void>;
  /** upsert_voicemail_from_recording(status='stored', path, duration, account) — must THROW unless verified. */
  persistStored: () => Promise<void>;
  /** best-effort observability row (status='failed'); never throws into the pipeline. */
  persistFailed: (stage: "download" | "upload" | "persist") => Promise<void>;
  /** resolves on 2xx AND 404; throws otherwise. */
  deleteSource: () => Promise<void>;
  markSourceDeleted: () => Promise<void>;
  recordCleanupFailure: (message: string) => Promise<void>;
  /** converge_inbound_notifications — best effort; its failure never changes the response. */
  notify: () => Promise<boolean>;
}

export type VoicemailPipelineResult =
  | { outcome: "stored"; notified: true }
  | { outcome: "stored_notify_pending"; notified: false }
  | { outcome: "stored_cleanup_failed"; stage: "delete" }
  | { outcome: "retryable_failure"; stage: "download" | "upload" | "persist" };

export async function runVoicemailPipeline(deps: VoicemailPipelineDeps): Promise<VoicemailPipelineResult> {
  let stage: "download" | "upload" | "persist" = "download";
  try {
    const bytes = await deps.download();
    stage = "upload";
    await deps.upload(bytes);
    stage = "persist";
    await deps.persistStored();
  } catch {
    try { await deps.persistFailed(stage); } catch { /* observability only */ }
    return { outcome: "retryable_failure", stage };
  }
  try {
    await deps.deleteSource();
    try { await deps.markSourceDeleted(); } catch { /* cleanup state converges on the next callback/pass */ }
  } catch (err) {
    try { await deps.recordCleanupFailure(err instanceof Error ? err.message : String(err)); } catch { /* durable state best effort */ }
    return { outcome: "stored_cleanup_failed", stage: "delete" };
  }
  let notified = false;
  try { notified = await deps.notify(); } catch { notified = false; }
  return notified ? { outcome: "stored", notified: true } : { outcome: "stored_notify_pending", notified: false };
}

export type VoicemailCleanupResult =
  | { outcome: "cleanup_done"; notified: boolean }
  | { outcome: "cleanup_retryable_failure" };

/** Cleanup-only redelivery: one DELETE, then the durable state update, then a best-effort converge. */
export async function runVoicemailCleanupRetry(deps: {
  deleteSource: () => Promise<void>;
  markSourceDeleted: () => Promise<void>;
  recordCleanupFailure: (message: string) => Promise<void>;
  notify: () => Promise<boolean>;
}): Promise<VoicemailCleanupResult> {
  try {
    await deps.deleteSource();
  } catch (err) {
    try { await deps.recordCleanupFailure(err instanceof Error ? err.message : String(err)); } catch { /* best effort */ }
    return { outcome: "cleanup_retryable_failure" };
  }
  try { await deps.markSourceDeleted(); } catch { /* converges on the next pass */ }
  let notified = false;
  try { notified = await deps.notify(); } catch { notified = false; }
  return { outcome: "cleanup_done", notified };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The SIGNED voicemail callback query (server-issued by twilio-voice-inbound; validated, never trusted blindly). */
export function parseVoicemailCallbackQuery(q: {
  source?: string | null; mailbox?: string | null; call_row_id?: string | null; org_id?: string | null; attempt_id?: string | null;
}): { ok: true; mailbox: string; callRowId: string; orgId: string; attemptId: string | null } | { ok: false; reason: string } {
  if ((q.source || "") !== "voicemail") return { ok: false, reason: "not_voicemail" };
  const mailbox = (q.mailbox || "").trim();
  if (mailbox !== "group" && !/^agent:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mailbox)) {
    return { ok: false, reason: "invalid_mailbox" };
  }
  const callRowId = (q.call_row_id || "").trim();
  const orgId = (q.org_id || "").trim();
  if (!UUID_RE.test(callRowId) || !UUID_RE.test(orgId)) return { ok: false, reason: "invalid_ids" };
  const attemptRaw = (q.attempt_id || "").trim();
  if (attemptRaw && !UUID_RE.test(attemptRaw)) return { ok: false, reason: "invalid_attempt_id" };
  return { ok: true, mailbox, callRowId, orgId, attemptId: attemptRaw || null };
}
