import { describe, expect, it } from "vitest";
import {
  chooseDurationToWrite,
  parseDurationSeconds,
} from "../../../supabase/functions/twilio-voice-status/duration";

describe("parseDurationSeconds", () => {
  it("parses a valid non-negative integer string", () => {
    expect(parseDurationSeconds("62")).toBe(62);
    expect(parseDurationSeconds("0")).toBe(0);
  });

  it("returns null for missing/empty input", () => {
    expect(parseDurationSeconds(undefined)).toBeNull();
    expect(parseDurationSeconds("")).toBeNull();
  });

  it("rejects non-numeric and negative values", () => {
    expect(parseDurationSeconds("abc")).toBeNull();
    expect(parseDurationSeconds("-5")).toBeNull();
  });
});

describe("chooseDurationToWrite (monotonic guard)", () => {
  it("writes the candidate when there is no existing value", () => {
    expect(chooseDurationToWrite(null, 62)).toBe(62);
    expect(chooseDurationToWrite(null, 0)).toBe(0);
  });

  it("writes a strictly greater candidate", () => {
    expect(chooseDurationToWrite(58, 62)).toBe(62);
  });

  it("does not regress an existing positive duration", () => {
    expect(chooseDurationToWrite(62, 0)).toBeNull();
    expect(chooseDurationToWrite(62, 62)).toBeNull();
    expect(chooseDurationToWrite(62, 30)).toBeNull();
  });

  it("leaves existing untouched when there is no candidate", () => {
    expect(chooseDurationToWrite(62, null)).toBeNull();
    expect(chooseDurationToWrite(null, null)).toBeNull();
  });
});

// End-to-end style assertions mapping the status-callback duration logic to the brief's
// expected-outcome matrix. Mirrors how index.ts derives durationCandidate then applies
// the guard before persisting.
describe("status callback duration outcomes (brief matrix)", () => {
  const completedCandidate = (form: Record<string, string>, existing: number | null) => {
    const callDuration = parseDurationSeconds(form.CallDuration ?? form.DialCallDuration);
    const candidate = callDuration; // completed prefers Twilio duration
    return chooseDurationToWrite(existing, candidate);
  };

  const terminalCandidate = (form: Record<string, string>, existing: number | null) => {
    const callDuration = parseDurationSeconds(form.CallDuration ?? form.DialCallDuration);
    const candidate = callDuration ?? 0; // terminal non-answer floors at 0
    return chooseDurationToWrite(existing, candidate);
  };

  it("1: completed CallDuration=62 -> 62", () => {
    expect(completedCandidate({ CallDuration: "62" }, null)).toBe(62);
  });

  it("2: completed only DialCallDuration=58 -> 58", () => {
    expect(completedCandidate({ DialCallDuration: "58" }, null)).toBe(58);
  });

  it("3: no-answer with no duration, existing null -> 0", () => {
    expect(terminalCandidate({}, null)).toBe(0);
  });

  it("4: busy/canceled/failed with no duration, existing null -> 0", () => {
    expect(terminalCandidate({}, null)).toBe(0);
  });

  it("5: existing 62, late no-answer with no duration -> remains 62 (no write)", () => {
    expect(terminalCandidate({}, 62)).toBeNull();
  });

  it("6: existing null, terminal no-answer with no duration -> 0", () => {
    expect(terminalCandidate({}, null)).toBe(0);
  });
});
