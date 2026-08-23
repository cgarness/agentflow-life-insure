// Rev 7 C12 — an externally forwarded leg that ANSWERED must be protected from stale missed actions.
// "agent_id proves answered" holds for <Client> legs only: an external <Number> forward can complete
// successfully while agent_id stays NULL. A durable, monotonic proof (calls.outcome =
// 'forwarded_answered') is recorded when DialCallStatus='completed' is accepted for the forwarding
// leg, and both markMissedAndNotify and terminal finalization reject stale missed actions when
// EITHER an AgentFlow client claim exists OR that proof exists. A bare parent status='completed' is
// never accepted as proof (an abandoned caller produces exactly that).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTERNAL_ANSWER_OUTCOME,
  canMarkRowMissed,
  hasExternalAnswerProof,
  isAnsweredDialStatus,
  shouldRecordExternalAnswerProof,
} from "../../../supabase/functions/twilio-voice-inbound/routing";

describe("C12 — the durable proof", () => {
  it("is recorded only for an ANSWERED external forwarding return", () => {
    expect(
      shouldRecordExternalAnswerProof({ dialCallStatus: "completed", alreadyForwarded: true }),
    ).toBe(true);
    expect(
      shouldRecordExternalAnswerProof({ dialCallStatus: "answered", alreadyForwarded: true }),
    ).toBe(true);
  });

  it("is NOT recorded for an answered <Client> return (agent_id is that leg's proof)", () => {
    expect(
      shouldRecordExternalAnswerProof({ dialCallStatus: "completed", alreadyForwarded: false }),
    ).toBe(false);
  });

  it("is NOT recorded for an unanswered forward return", () => {
    for (const s of ["no-answer", "busy", "failed", "canceled", ""]) {
      expect(
        shouldRecordExternalAnswerProof({ dialCallStatus: s, alreadyForwarded: true }),
      ).toBe(false);
    }
  });

  it("uses a single canonical outcome token", () => {
    expect(EXTERNAL_ANSWER_OUTCOME).toBe("forwarded_answered");
    expect(hasExternalAnswerProof({ outcome: EXTERNAL_ANSWER_OUTCOME })).toBe(true);
    expect(hasExternalAnswerProof({ outcome: "busy" })).toBe(false);
    expect(hasExternalAnswerProof({ outcome: null })).toBe(false);
    expect(hasExternalAnswerProof({})).toBe(false);
  });

  it("isAnsweredDialStatus is unchanged", () => {
    expect(isAnsweredDialStatus("completed")).toBe(true);
    expect(isAnsweredDialStatus("answered")).toBe(true);
    expect(isAnsweredDialStatus("no-answer")).toBe(false);
  });
});

describe("C12.1–C12.2 — a stale action after an answered external forward is rejected", () => {
  it("stale earlier-wave no-answer action cannot mark the forwarded call missed", () => {
    expect(
      canMarkRowMissed({ agent_id: null, status: "completed", outcome: EXTERNAL_ANSWER_OUTCOME }),
    ).toBe(false);
  });

  it("a duplicate voicemail/hangup action cannot mark it missed either", () => {
    expect(
      canMarkRowMissed({ agent_id: null, status: "connected", outcome: EXTERNAL_ANSWER_OUTCOME }),
    ).toBe(false);
    expect(
      canMarkRowMissed({ agent_id: null, status: "ringing", outcome: EXTERNAL_ANSWER_OUTCOME }),
    ).toBe(false);
  });
});

describe("C12.3–C12.5 — legitimate missed marking is preserved", () => {
  it("an unanswered external forward stays markable", () => {
    expect(canMarkRowMissed({ agent_id: null, status: "ringing", outcome: null })).toBe(true);
    expect(canMarkRowMissed({ agent_id: null, status: "no-answer", outcome: "busy" })).toBe(true);
  });

  it("an answered AgentFlow Client leg is rejected by the claim proof", () => {
    expect(canMarkRowMissed({ agent_id: "u1", status: "connected", outcome: null })).toBe(false);
  });

  it("an abandoned caller (parent completed, nothing answered) is STILL a missed call", () => {
    // The whole reason bare status is not proof.
    expect(canMarkRowMissed({ agent_id: null, status: "completed", outcome: null })).toBe(true);
  });
});

describe("C12.6 — the answered proof wins monotonically over a missed action", () => {
  it("once the proof exists no later missed action can take effect, in any status", () => {
    for (const status of ["ringing", "connected", "completed", "no-answer", "failed"]) {
      expect(
        canMarkRowMissed({ agent_id: null, status, outcome: EXTERNAL_ANSWER_OUTCOME }),
      ).toBe(false);
    }
  });
});

describe("C12 — wiring is pinned at the source", () => {
  const inboundSrc = readFileSync(
    resolve(__dirname, "../../../supabase/functions/twilio-voice-inbound/index.ts"),
    "utf8",
  );
  const m2 = readFileSync(
    resolve(__dirname, "../../../supabase/migrations/20260822120100_inbound_claim_lifecycle.sql"),
    "utf8",
  );

  it("the forward return records the proof through finalization", () => {
    expect(inboundSrc.includes("shouldRecordExternalAnswerProof")).toBe(true);
    expect(inboundSrc.includes("p_external_answer")).toBe(true);
  });

  it("markMissedAndNotify's UPDATE excludes rows carrying the proof (NULL-safe)", () => {
    const fnIdx = inboundSrc.indexOf("async function markMissedAndNotify");
    const body = inboundSrc.slice(fnIdx, fnIdx + 2200);
    expect(body.includes("outcome.is.null")).toBe(true);
    // the token is referenced through the shared constant, never re-typed as a literal
    expect(body.includes("EXTERNAL_ANSWER_OUTCOME")).toBe(true);
    expect(body.includes("outcome.neq.")).toBe(true);
  });

  it("finalize_inbound_call_terminal records and honors the proof", () => {
    expect(m2.includes("p_external_answer")).toBe(true);
    expect(m2.includes("forwarded_answered")).toBe(true);
    expect(m2.includes("externally_answered")).toBe(true);
  });

  it("the ACL matrix follows the new finalize signature", () => {
    expect(m2.includes("finalize_inbound_call_terminal(uuid,uuid,text,boolean,boolean)")).toBe(true);
  });
});
