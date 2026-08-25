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
