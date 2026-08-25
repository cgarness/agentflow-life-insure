// Rev 7 C11 — a blank recording_storage_path must stay RECOVERABLE.
// classifyRecordingRow treats '' (and whitespace) as unstored and enters the full pipeline, but the
// first-writer CAS used `.is("recording_storage_path", null)`, which lands zero rows forever on such
// a row — an infinite 503 loop with no convergence. One predicate now governs classification, the
// failure-sentinel guard, and the metadata CAS: unstored = NULL or trimmed-empty, and the CAS
// compares against the EXACT observed prior value so first-writer-wins still holds.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyRecordingRow,
  isUnstoredRecordingPath,
  recordingPathCas,
  shouldWriteFailureSentinel,
} from "../../../supabase/functions/twilio-recording-status/idempotency";

const RE_1 = "RE" + "1".repeat(32);

describe("C11 — one consistent 'unstored' predicate", () => {
  it("NULL/undefined are unstored", () => {
    expect(isUnstoredRecordingPath(null)).toBe(true);
    expect(isUnstoredRecordingPath(undefined)).toBe(true);
  });

  it("empty and whitespace-only strings are unstored (explicitly defined)", () => {
    expect(isUnstoredRecordingPath("")).toBe(true);
    expect(isUnstoredRecordingPath("   ")).toBe(true);
    expect(isUnstoredRecordingPath("\t\n")).toBe(true);
  });

  it("a real path is stored", () => {
    expect(isUnstoredRecordingPath("org/20260823/CA1.mp3")).toBe(false);
    expect(isUnstoredRecordingPath("  org/x.mp3  ")).toBe(false);
  });
});

describe("C11.1–C11.3 — NULL, empty and whitespace-only paths all process", () => {
  it("NULL path processes", () => {
    expect(classifyRecordingRow({ recording_storage_path: null }, RE_1)).toBe("process");
  });

  it("empty path processes (was: entered the pipeline but could never persist)", () => {
    expect(classifyRecordingRow({ recording_storage_path: "" }, RE_1)).toBe("process");
  });

  it("whitespace-only path processes", () => {
    expect(classifyRecordingRow({ recording_storage_path: "   " }, RE_1)).toBe("process");
  });

  it("the CAS targets the exact observed value so each of them can actually land", () => {
    expect(recordingPathCas(null)).toEqual({ kind: "is_null" });
    expect(recordingPathCas(undefined)).toEqual({ kind: "is_null" });
    expect(recordingPathCas("")).toEqual({ kind: "eq", value: "" });
    expect(recordingPathCas("   ")).toEqual({ kind: "eq", value: "   " });
  });
});

describe("C11.4–C11.5 — a nonblank stored path is never overwritten; first-writer-wins holds", () => {
  it("a stored path short-circuits before the pipeline", () => {
    expect(
      classifyRecordingRow(
        { recording_storage_path: "org/x.mp3", recording_source_sid: null },
        RE_1,
      ),
    ).toBe("skip_already_stored");
  });

  it("the CAS on a stored path is a real-value comparison, so a concurrent winner makes it miss", () => {
    // The loser observed '' (or NULL) and CASes on that; the winner has already written a real
    // path, so the loser's update matches zero rows and cannot clobber it.
    expect(recordingPathCas("")).not.toEqual({ kind: "eq", value: "org/winner.mp3" });
    expect(recordingPathCas("org/winner.mp3")).toEqual({ kind: "eq", value: "org/winner.mp3" });
  });
});

describe("C11.6 — failure sentinels cannot overwrite successful metadata", () => {
  it("sentinels are allowed only while the path is unstored (same predicate)", () => {
    expect(shouldWriteFailureSentinel({ recording_storage_path: null })).toBe(true);
    expect(shouldWriteFailureSentinel({ recording_storage_path: "" })).toBe(true);
    expect(shouldWriteFailureSentinel({ recording_storage_path: "  " })).toBe(true);
    expect(shouldWriteFailureSentinel({ recording_storage_path: "org/x.mp3" })).toBe(false);
  });
});

describe("C11 — handler wiring is pinned at the source", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../supabase/functions/twilio-recording-status/index.ts"),
    "utf8",
  );

  it("the `IS NULL` form survives ONLY as the NULL branch of the shared CAS helper", () => {
    // Any other occurrence would be a hardcoded predicate that can never match a blank path.
    const occurrences = (src.match(/\.is\("recording_storage_path", null\)/g) || []).length;
    expect(occurrences).toBe(1);
    const casStart = src.indexOf("const applyRecordingPathCas");
    const casBlock = src.slice(casStart, casStart + 400);
    expect(casBlock.includes('.is("recording_storage_path", null)')).toBe(true);
  });

  it("both the metadata CAS and the sentinel guard use the shared observed-value CAS", () => {
    expect((src.match(/recordingPathCas\(/g) || []).length).toBeGreaterThanOrEqual(1);
    expect(src.includes("applyRecordingPathCas")).toBe(true);
  });
});
