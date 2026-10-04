// Pure, dependency-free duration helpers for twilio-voice-status.
// Kept Deno-free so they can be unit-tested under vitest (see
// src/lib/__tests__/twilioStatusDuration.test.ts).
//
// Invariant: Twilio status callback duration is the canonical source of truth for
// persisted calls.duration. Browser timers are UI-only and must not write it.

/** Parse a Twilio duration field as a non-negative integer of seconds, or null. */
export function parseDurationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n <= 2147483647 ? n : null;
}

/**
 * Monotonic duration guard for out-of-order / retried callbacks.
 * Returns the value to persist, or null to leave the existing value untouched.
 *  - write when there is no existing value;
 *  - write when the incoming candidate is strictly greater than existing;
 *  - never regress an existing positive duration (protects against a late
 *    non-answer/busy/canceled/failed callback reporting 0).
 */
export function chooseDurationToWrite(
  existing: number | null,
  candidate: number | null,
): number | null {
  if (candidate === null) return null;
  if (existing === null) return candidate;
  return candidate > existing ? candidate : null;
}

/** Signed duration fields belong to their own leg; the Dial action also proves parent/child correlation. */
export function durationEvidence(params: Record<string, string>, matchedSid: string, candidate: number | null) {
  if (candidate === null) return null;
  const primary = parseDurationSeconds(params.CallDuration);
  const secondary = parseDurationSeconds(params.DialCallDuration);
  const provider = primary !== null || secondary !== null;
  const sid = primary !== null ? params.CallSid : secondary !== null ? params.DialCallSid || params.CallSid : matchedSid;
  return { source: provider ? "provider" : candidate === 0 ? "terminal_non_answer" : "elapsed_estimate", sid,
    parentSid: params.DialCallSid && params.CallSid ? params.CallSid : params.ParentCallSid || null,
    sequence: parseDurationSeconds(params.SequenceNumber),
    observedAt: params.Timestamp && Number.isFinite(Date.parse(params.Timestamp)) ? new Date(params.Timestamp).toISOString() : null };
}
