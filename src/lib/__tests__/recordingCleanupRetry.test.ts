// Rev 6 C6 — recording deletion failure gets a DURABLE retry path.
// The Twilio RecordingSid is persisted atomically with the verified storage metadata
// (calls.recording_source_sid, added by the unapplied M3 migration). A non-404 DELETE failure after
// successful persistence returns a retryable 5xx; the retry performs CLEANUP ONLY (no download, no
// upload, no metadata rewrite) keyed by exact RecordingSid equality; 404 counts as cleanup success;
// a DIFFERENT RecordingSid is never deleted just because the row already stores a recording.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyRecordingRow,
  decideRecordingResponseStatus,
  isValidRecordingSid,
  runCleanupRetry,
  runRecordingPipeline,
} from "../../../supabase/functions/twilio-recording-status/idempotency";

const RE_1 = "RE" + "1".repeat(32);
const RE_2 = "RE" + "2".repeat(32);

function pipelineDeps(overrides: Partial<Parameters<typeof runRecordingPipeline>[0]> = {}) {
  const calls: string[] = [];
  const deps = {
    download: async () => {
      calls.push("download");
      return new Uint8Array([1]);
    },
    upload: async () => {
      calls.push("upload");
    },
    persistMetadata: async () => {
      calls.push("persist");
    },
    deleteSource: async () => {
      calls.push("delete");
    },
    writeFailureSentinel: async () => {
      calls.push("sentinel");
    },
    ...overrides,
  };
  return { deps, calls };
}

describe("C6.1 — successful persist followed by DELETE failure returns 5xx", () => {
  it("reports a delete-stage retryable outcome, with NO sentinel write", async () => {
    const { deps, calls } = pipelineDeps({
      deleteSource: async () => {
        calls.push("delete");
        throw new Error("delete HTTP 500 Internal Server Error");
      },
    });
    const result = await runRecordingPipeline(deps);
    expect(result).toEqual({ outcome: "stored_cleanup_failed", stage: "delete" });
    expect(decideRecordingResponseStatus(result.outcome)).toBe(503);
    expect(calls).toEqual(["download", "upload", "persist", "delete"]);
    expect(calls).not.toContain("sentinel");
  });
});

describe("C6.2 — retry with stored metadata performs cleanup ONLY", () => {
  it("classifies stored-path + exact matching source SID as cleanup_retry", () => {
    expect(
      classifyRecordingRow(
        { recording_storage_path: "org/x.mp3", recording_source_sid: RE_1 },
        RE_1,
      ),
    ).toBe("cleanup_retry");
  });

  it("runCleanupRetry takes only deleteSource — no download/upload/persist exists on the retry path", async () => {
    let deletes = 0;
    const result = await runCleanupRetry({
      deleteSource: async () => {
        deletes += 1;
      },
    });
    expect(result).toEqual({ outcome: "cleanup_done" });
    expect(decideRecordingResponseStatus(result.outcome)).toBe(200);
    expect(deletes).toBe(1);
  });
});

describe("C6.3 — 404 on cleanup is success", () => {
  it("a resolving deleteSource (its 404 branch does not throw) yields cleanup_done", async () => {
    // The handler's deleteSource treats HTTP 404 as already-deleted and resolves; only non-404
    // failures throw. A resolved delete therefore IS the 404-or-2xx success contract.
    const result = await runCleanupRetry({ deleteSource: async () => {} });
    expect(result.outcome).toBe("cleanup_done");
  });
});

describe("C6.4 — repeated cleanup failure stays retryable and observable", () => {
  it("returns a 503-mapped retryable outcome on every failing attempt", async () => {
    const failingDelete = async () => {
      throw new Error("delete HTTP 503 Service Unavailable");
    };
    const first = await runCleanupRetry({ deleteSource: failingDelete });
    const second = await runCleanupRetry({ deleteSource: failingDelete });
    expect(first).toEqual({ outcome: "cleanup_retryable_failure" });
    expect(second).toEqual({ outcome: "cleanup_retryable_failure" });
    expect(decideRecordingResponseStatus(first.outcome)).toBe(503);
    expect(decideRecordingResponseStatus(second.outcome)).toBe(503);
  });
});

describe("C6.5 — a distinct second RecordingSid is never deleted", () => {
  it("stored path + DIFFERENT callback SID classifies as skip (first completed recording wins)", () => {
    expect(
      classifyRecordingRow(
        { recording_storage_path: "org/x.mp3", recording_source_sid: RE_1 },
        RE_2,
      ),
    ).toBe("skip_already_stored");
  });

  it("stored path with NO recorded source SID (legacy/browser rows) never triggers cleanup", () => {
    expect(
      classifyRecordingRow(
        { recording_storage_path: "org/x.mp3", recording_source_sid: null },
        RE_2,
      ),
    ).toBe("skip_already_stored");
    expect(
      classifyRecordingRow({ recording_storage_path: "org/x.mp3" }, RE_2),
    ).toBe("skip_already_stored");
  });

  it("a malformed callback SID can never match", () => {
    expect(
      classifyRecordingRow(
        { recording_storage_path: "org/x.mp3", recording_source_sid: RE_1 },
        "RE_not_hex",
      ),
    ).toBe("skip_already_stored");
  });
});

describe("C6.6 — unmatched callbacks still never download/upload/persist/delete", () => {
  it("no row is unmatched regardless of the callback SID", () => {
    expect(classifyRecordingRow(null, RE_1)).toBe("unmatched");
    expect(classifyRecordingRow(undefined, RE_1)).toBe("unmatched");
  });
});

describe("C6.7 — delete NEVER occurs before verified metadata persistence", () => {
  it("a failing persist stops the pipeline before deleteSource", async () => {
    const { deps, calls } = pipelineDeps({
      persistMetadata: async () => {
        calls.push("persist");
        throw new Error("metadata persist: exact-row update did not land");
      },
    });
    const result = await runRecordingPipeline(deps);
    expect(result).toEqual({ outcome: "retryable_failure", stage: "persist" });
    expect(calls).toEqual(["download", "upload", "persist", "sentinel"]);
    expect(calls).not.toContain("delete");
  });

  it("the happy path is strictly download → upload → persist → delete", async () => {
    const { deps, calls } = pipelineDeps();
    const result = await runRecordingPipeline(deps);
    expect(result).toEqual({ outcome: "stored" });
    expect(calls).toEqual(["download", "upload", "persist", "delete"]);
  });
});

describe("C6 — RecordingSid validation", () => {
  it("accepts exactly RE + 32 hex", () => {
    expect(isValidRecordingSid(RE_1)).toBe(true);
    expect(isValidRecordingSid("RE" + "a".repeat(32))).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(isValidRecordingSid("")).toBe(false);
    expect(isValidRecordingSid(null)).toBe(false);
    expect(isValidRecordingSid("CA" + "1".repeat(32))).toBe(false);
    expect(isValidRecordingSid("RE" + "1".repeat(31))).toBe(false);
    expect(isValidRecordingSid("RE" + "g".repeat(32))).toBe(false);
  });
});

describe("C6 — handler wiring is pinned at the source", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../supabase/functions/twilio-recording-status/index.ts"),
    "utf8",
  );

  it("persists recording_source_sid atomically inside the verified metadata update", () => {
    const persistStart = src.indexOf("persistMetadata");
    const persistBlock = src.slice(persistStart, persistStart + 1200);
    expect(persistBlock.includes("recording_source_sid")).toBe(true);
  });

  it("selects recording_source_sid in the row lookup", () => {
    expect(src.includes("recording_source_sid")).toBe(true);
    expect(/select\([^)]*recording_source_sid/.test(src)).toBe(true);
  });

  it("the cleanup-retry branch exists and never re-enters the full pipeline", () => {
    expect(src.includes("runCleanupRetry")).toBe(true);
    const cleanupIdx = src.indexOf("runCleanupRetry(");
    const pipelineIdx = src.indexOf("runRecordingPipeline(");
    expect(cleanupIdx).toBeGreaterThan(-1);
    expect(pipelineIdx).toBeGreaterThan(cleanupIdx); // cleanup branch returns before the pipeline call
  });

  it("no stale 'ops tooling' deletion-recovery claim survives", () => {
    expect(src.toLowerCase().includes("ops tooling")).toBe(false);
  });

  it("the success persist is FIRST-WRITER-WINS (concurrent distinct recordings cannot clobber)", () => {
    const persistStart = src.indexOf("persistMetadata: async");
    const persistBlock = src.slice(persistStart, persistStart + 1800);
    expect(persistBlock.includes('.is("recording_storage_path", null)')).toBe(true);
  });

  it("a persist-race loser removes its OWN uploaded object and preserves its Twilio source", () => {
    const persistStart = src.indexOf("persistMetadata: async");
    const persistBlock = src.slice(persistStart, persistStart + 2400);
    expect(persistBlock.includes(".remove([storagePath])")).toBe(true);
  });

  it("the loser NEVER removes the winner's object (same-SID duplicates share a path)", () => {
    // A concurrent duplicate of the SAME RecordingSid uploads to the identical path the winner
    // persisted — the loser must compare the stored winner path before removing anything.
    const persistStart = src.indexOf("persistMetadata: async");
    const persistBlock = src.slice(persistStart, persistStart + 2400);
    expect(persistBlock.includes("winnerPath")).toBe(true);
    expect(persistBlock.includes("winnerPath !== storagePath")).toBe(true);
  });

  it("each recording gets its own storage object (path keyed by CallSid AND RecordingSid)", () => {
    // Concurrent distinct recordings for one call must never share an upsert target — the winner's
    // verified metadata must reference bytes no loser can overwrite.
    expect(/function buildStoragePath\([^)]*recordingSid/.test(src)).toBe(true);
  });

  it("a matched row with NULL organization_id is preserved-acked before any pipeline work", () => {
    expect(src.includes("NULL organization_id")).toBe(true);
  });

  it("a malformed RecordingSid skips the source delete instead of promising a dead-end retry", () => {
    const depStart = src.indexOf("deleteSource: async");
    const depBlock = src.slice(depStart, depStart + 900);
    expect(depBlock.includes("isValidRecordingSid(recordingSid)")).toBe(true);
  });
});
