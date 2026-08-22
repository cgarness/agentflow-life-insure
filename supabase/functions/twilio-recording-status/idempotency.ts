// Pure, dependency-free R17 pipeline logic for twilio-recording-status.
// Kept Deno-free so it is unit-tested under vitest (see src/lib/__tests__/recordingIdempotency.test.ts).
// Plan rev5 R17: a valid recording_storage_path is the ONLY success short-circuit (failure sentinels
// are recoverable, not success); the Twilio source recording is deleted ONLY after storage upload AND
// verified DB metadata persistence both succeed; every recoverable failure preserves the source and
// returns a retryable 5xx (the callback URL's connection overrides provide the bounded retry channel —
// Twilio's default policy does not retry 5xx); unmatched callbacks never download/upload/delete.

export interface RecordingRowState {
  recording_storage_path?: string | null;
  recording_url?: string | null;
}

export type RecordingRowClass = "skip_already_stored" | "process" | "unmatched";

export function isSuccessStoragePath(path: string | null | undefined): boolean {
  return typeof path === "string" && path.trim() !== "";
}

export function classifyRecordingRow(row: RecordingRowState | null | undefined): RecordingRowClass {
  if (!row) return "unmatched";
  if (isSuccessStoragePath(row.recording_storage_path)) return "skip_already_stored";
  return "process";
}

/** Failure sentinels may be written ONLY while no successful storage path exists. */
export function shouldWriteFailureSentinel(row: RecordingRowState | null | undefined): boolean {
  return !isSuccessStoragePath(row?.recording_storage_path);
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
  | { outcome: "retryable_failure"; stage: "download" | "upload" | "persist" };

/**
 * The ordered pipeline: download → upload → persistMetadata → deleteSource.
 * deleteSource runs ONLY after persistMetadata succeeded (delete-only-after-commit); its own failure
 * is non-fatal (the recording is safely stored; the orphaned Twilio copy is retried by ops tooling).
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
    /* non-fatal: stored + verified; source cleanup can be retried */
  }
  return { outcome: "stored" };
}

export type RecordingOutcome =
  | "stored"
  | "skip_already_stored"
  | "unmatched"
  | "ignored"
  | "retryable_failure";

export function decideRecordingResponseStatus(outcome: RecordingOutcome): number {
  return outcome === "retryable_failure" ? 503 : 200;
}
