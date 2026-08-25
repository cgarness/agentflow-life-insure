// Fail-first tests — twilio-recording-status R17 pipeline (plan rev5: T27 + the six R17 scenarios,
// including delete-only-after-commit ordering, via the injectable pure orchestrator).
import { describe, it, expect } from "vitest";
import {
  classifyRecordingRow,
  shouldWriteFailureSentinel,
  runRecordingPipeline,
  decideRecordingResponseStatus,
} from "../../../supabase/functions/twilio-recording-status/idempotency";

describe("classifyRecordingRow (T27/R17)", () => {
  it("a valid recording_storage_path is the ONLY success short-circuit", () => {
    expect(classifyRecordingRow({ recording_storage_path: "org/20260822/CAx.mp3", recording_url: "storage:org/20260822/CAx.mp3" })).toBe("skip_already_stored");
  });
  it("failure sentinels are NOT success — the row stays recoverable", () => {
    expect(classifyRecordingRow({ recording_storage_path: null, recording_url: "__recording_failed__" })).toBe("process");
    expect(classifyRecordingRow({ recording_storage_path: null, recording_url: "__recording_upload_failed__" })).toBe("process");
    expect(classifyRecordingRow({ recording_storage_path: "", recording_url: null })).toBe("process");
  });
  it("no matched row ⇒ unmatched (ack; never download/upload/delete)", () => {
    expect(classifyRecordingRow(null)).toBe("unmatched");
  });
});

describe("shouldWriteFailureSentinel", () => {
  it("only when no successful storage path exists", () => {
    expect(shouldWriteFailureSentinel({ recording_storage_path: null })).toBe(true);
    expect(shouldWriteFailureSentinel({ recording_storage_path: "" })).toBe(true);
    expect(shouldWriteFailureSentinel({ recording_storage_path: "org/x.mp3" })).toBe(false);
  });
});

type Step = "download" | "upload" | "persist" | "deleteSource" | "sentinel";
function makeDeps(failAt: Partial<Record<Step, boolean>> = {}) {
  const order: Step[] = [];
  return {
    order,
    deps: {
      download: async () => { order.push("download"); if (failAt.download) throw new Error("dl"); return new Uint8Array([1]); },
      upload: async () => { order.push("upload"); if (failAt.upload) throw new Error("up"); },
      persistMetadata: async () => { order.push("persist"); if (failAt.persist) throw new Error("db"); },
      deleteSource: async () => { order.push("deleteSource"); if (failAt.deleteSource) throw new Error("del"); },
      writeFailureSentinel: async () => { order.push("sentinel"); },
    },
  };
}

describe("runRecordingPipeline (R17 six scenarios)", () => {
  it("happy path: download → upload → persist → deleteSource, in that exact order", async () => {
    const { order, deps } = makeDeps();
    const out = await runRecordingPipeline(deps);
    expect(out).toEqual({ outcome: "stored" });
    expect(order).toEqual(["download", "upload", "persist", "deleteSource"]);
  });

  it("download failure: source preserved (no delete), sentinel written, retryable", async () => {
    const { order, deps } = makeDeps({ download: true });
    const out = await runRecordingPipeline(deps);
    expect(out.outcome).toBe("retryable_failure");
    expect(order).not.toContain("deleteSource");
    expect(order).toContain("sentinel");
  });

  it("upload failure: source preserved, sentinel written, retryable", async () => {
    const { order, deps } = makeDeps({ upload: true });
    const out = await runRecordingPipeline(deps);
    expect(out.outcome).toBe("retryable_failure");
    expect(order).not.toContain("deleteSource");
  });

  it("R17 core — DB persist failure: the Twilio source is NOT deleted (delete only after commit)", async () => {
    const { order, deps } = makeDeps({ persist: true });
    const out = await runRecordingPipeline(deps);
    expect(out.outcome).toBe("retryable_failure");
    expect(order).toEqual(["download", "upload", "persist", "sentinel"]);
  });

  it("delete failure AFTER successful persist is retryable (rev 6 C6: stored_cleanup_failed), no sentinel", async () => {
    // Superseded behavior: this used to report "stored", silently orphaning the Twilio copy.
    // C6: the recording IS safely stored, but the response must be 5xx so the redelivered callback
    // can finish the source deletion via the cleanup-only path (recordingCleanupRetry.test.ts).
    const { deps, order } = makeDeps({ deleteSource: true });
    const out = await runRecordingPipeline(deps);
    expect(out).toEqual({ outcome: "stored_cleanup_failed", stage: "delete" });
    expect(order).not.toContain("sentinel");
  });

  it("retry after failure completes: second run with healthy deps succeeds (source was preserved)", async () => {
    const first = makeDeps({ upload: true });
    await runRecordingPipeline(first.deps);
    const second = makeDeps();
    const out = await runRecordingPipeline(second.deps);
    expect(out).toEqual({ outcome: "stored" });
    expect(second.order).toEqual(["download", "upload", "persist", "deleteSource"]);
  });
});

describe("decideRecordingResponseStatus (R17 retry channel — Twilio does not retry 5xx by default,", () => {
  it("so recoverable failures return 5xx for the connection-override retry policy", () => {
    expect(decideRecordingResponseStatus("retryable_failure")).toBe(503);
  });
  it("stored / duplicate / unmatched / non-completed ack 200", () => {
    for (const o of ["stored", "skip_already_stored", "unmatched", "ignored"]) {
      expect(decideRecordingResponseStatus(o as never)).toBe(200);
    }
  });
});
