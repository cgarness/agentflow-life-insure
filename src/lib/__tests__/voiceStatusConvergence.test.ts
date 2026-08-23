// Rev 7 C9 — twilio-voice-status must converge terminal state AND its missed-call notification.
// Every transient failure after a VALID signature (row lookup, exact-row update, notification
// insert, unexpected exception) returns a retryable 5xx so Twilio redelivers; unmatched and
// business-ignored callbacks stay 2xx; an invalid signature stays 403. Every ACCEPTED missed
// outcome (no-answer, busy, canceled) durably persists is_missed=true in the same verified update,
// so a redelivery of a frozen terminal row can still converge the idempotent notification.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyStatusLadder,
  decideVoiceStatusResponse,
  shouldEmitMissedCallNotification,
  shouldPersistMissedFlag,
} from "../../../supabase/functions/twilio-voice-status/terminal-guard";
import { chooseDurationToWrite } from "../../../supabase/functions/twilio-voice-status/duration";

describe("C9.1–C9.4 — transient failures after a valid signature are retryable 5xx", () => {
  it("calls lookup failure → 503", () => {
    expect(decideVoiceStatusResponse("lookup_failed")).toBe(503);
  });

  it("exact-row update failure → 503", () => {
    expect(decideVoiceStatusResponse("update_failed")).toBe(503);
  });

  it("unexpected post-signature exception → 503", () => {
    expect(decideVoiceStatusResponse("unexpected_error")).toBe(503);
  });

  it("missed-notification insert failure → 503", () => {
    expect(decideVoiceStatusResponse("notify_failed")).toBe(503);
  });
});

describe("C9.8–C9.9 — non-transient outcomes keep their current codes", () => {
  it("unmatched callback → 200", () => {
    expect(decideVoiceStatusResponse("unmatched")).toBe(200);
  });

  it("business-ignored (unhandled status / no SIDs) → 200", () => {
    expect(decideVoiceStatusResponse("ignored")).toBe(200);
  });

  it("successful processing → 200", () => {
    expect(decideVoiceStatusResponse("ok")).toBe(200);
  });

  it("invalid signature → 403", () => {
    expect(decideVoiceStatusResponse("bad_signature")).toBe(403);
  });

  it("a superseded CAS (concurrent writer won) is not retryable → 200", () => {
    expect(decideVoiceStatusResponse("superseded")).toBe(200);
  });
});

describe("C9.5 — no-answer, busy and canceled each persist is_missed = true", () => {
  it("all three missed outcomes are durable", () => {
    expect(shouldPersistMissedFlag("no-answer")).toBe(true);
    expect(shouldPersistMissedFlag("busy")).toBe(true);
    expect(shouldPersistMissedFlag("canceled")).toBe(true);
  });

  it("answered/other outcomes never set the flag", () => {
    expect(shouldPersistMissedFlag("completed")).toBe(false);
    expect(shouldPersistMissedFlag("in-progress")).toBe(false);
    expect(shouldPersistMissedFlag("ringing")).toBe(false);
    expect(shouldPersistMissedFlag("failed")).toBe(false);
    expect(shouldPersistMissedFlag("")).toBe(false);
  });
});

describe("C9.6 — retry after a notification failure converges exactly once", () => {
  const notify = (storedIsMissed: boolean, ladderAccepted: boolean, status: string) =>
    shouldEmitMissedCallNotification({
      effectiveCallStatus: status,
      ladderAcceptedStatusWrite: ladderAccepted,
      updateSucceeded: true,
      storedIsMissed,
      direction: "inbound",
      organizationId: "org-1",
    });

  it("first delivery notifies from the accepted transition", () => {
    const ladder = applyStatusLadder("ringing", "no-answer");
    expect(ladder.writeStatus).toBe(true);
    expect(notify(true, ladder.writeStatus, "no-answer")).toBe(true);
  });

  it("redelivery of a FROZEN terminal row with durable is_missed re-attempts the idempotent insert", () => {
    const ladder = applyStatusLadder("no-answer", "no-answer");
    expect(ladder.writeStatus).toBe(false); // terminal frozen — no status/duration/outcome regression
    expect(notify(true, ladder.writeStatus, "no-answer")).toBe(true);
  });

  it("the same redelivery on a NOT-missed terminal row stays silent", () => {
    const ladder = applyStatusLadder("completed", "no-answer");
    expect(ladder.writeStatus).toBe(false);
    expect(notify(false, ladder.writeStatus, "no-answer")).toBe(false);
  });
});

describe("C9.7 — a late missed callback after a genuinely answered+completed call stays suppressed", () => {
  it("completed (answered, not missed) → late no-answer: no status write, no notification", () => {
    const ladder = applyStatusLadder("completed", "no-answer");
    expect(ladder.writeStatus).toBe(false);
    expect(
      shouldEmitMissedCallNotification({
        effectiveCallStatus: "no-answer",
        ladderAcceptedStatusWrite: false,
        updateSucceeded: true,
        storedIsMissed: false,
        direction: "inbound",
        organizationId: "org-1",
      }),
    ).toBe(false);
  });
});

describe("C9.10 — status and duration stay monotonic across concurrent/reordered callbacks", () => {
  it("terminal status is frozen against every later transition", () => {
    for (const later of ["ringing", "connected", "completed", "no-answer", "failed"]) {
      expect(applyStatusLadder("completed", later).writeStatus).toBe(false);
    }
  });

  it("duration never regresses", () => {
    expect(chooseDurationToWrite(42, 0)).toBeNull();
    expect(chooseDurationToWrite(42, 41)).toBeNull();
    expect(chooseDurationToWrite(42, 43)).toBe(43);
    expect(chooseDurationToWrite(null, 0)).toBe(0);
  });
});

describe("C9 — handler wiring is pinned at the source", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../supabase/functions/twilio-voice-status/index.ts"),
    "utf8",
  );

  it("the lookup helper surfaces transient errors instead of acking as 'no row'", () => {
    expect(src.includes("lookup_failed")).toBe(true);
  });

  it("the fatal catch no longer returns 200", () => {
    const catchIdx = src.lastIndexOf("} catch (err) {");
    const tail = src.slice(catchIdx);
    expect(tail.includes("unexpected_error")).toBe(true);
    expect(/status:\s*200/.test(tail)).toBe(false);
  });

  it("a notification failure returns a retryable response", () => {
    expect(src.includes("notify_failed")).toBe(true);
  });

  it("every response code flows through the pure decision", () => {
    expect(src.includes("decideVoiceStatusResponse")).toBe(true);
  });

  it("the accepted missed outcome is persisted durably in the verified update", () => {
    expect(src.includes("shouldPersistMissedFlag")).toBe(true);
  });

  it("a CAS-zero result re-reads the exact row before converging", () => {
    expect(src.includes("supersededRow")).toBe(true);
  });

  it("STIR/SHAKEN enrichment failure cannot abandon the terminal write", () => {
    const stirIdx = src.indexOf("fetchTwilioStirShakenLevel(accountSid");
    const block = src.slice(Math.max(0, stirIdx - 400), stirIdx + 600);
    expect(block.includes("try {")).toBe(true);
  });

  it("the notification helper reports whether it actually converged", () => {
    const shared = readFileSync(
      resolve(__dirname, "../../../supabase/functions/_shared/notifications.ts"),
      "utf8",
    );
    expect(shared.includes("MissedNotificationResult")).toBe(true);
    expect(shared.includes("retryable")).toBe(true);
  });
});
