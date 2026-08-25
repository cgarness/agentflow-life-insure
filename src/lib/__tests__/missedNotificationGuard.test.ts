// Rev 6 C7 — suppressed late statuses must not emit missed-call notifications.
// A missed-call notification may be emitted ONLY after (a) the monotonic ladder ACCEPTED the
// terminal transition and (b) the exact calls-row update SUCCEEDED. A late/replayed no-answer,
// busy, or canceled callback against an already-terminal row must change nothing and notify nobody.
// The same stale/reordered-action rule applies to twilio-voice-inbound's markMissedAndNotify: an
// already-ANSWERED (claimed) call is never re-marked missed by an older wave's fallback.
//
// C7 refinement (post adversarial review): (1) a row that is DURABLY missed (is_missed=true, set by
// an accepted guarded writer) still converges its notification on any later successful callback —
// the fail-closed recipient resolver aborts its single insert attempt on transient errors and
// documents relying on the other writer to converge; (2) answered-ness is `agent_id` (atomic with
// the claim CAS), never the parent's own status — an abandoned caller whose parent shows
// 'completed' with no agent is a genuinely MISSED call; (3) the accepted status write is an atomic
// CAS and a transient update failure returns 5xx so the callback redelivers.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyStatusLadder,
  shouldEmitMissedCallNotification,
} from "../../../supabase/functions/twilio-voice-status/terminal-guard";
import { canMarkRowMissed } from "../../../supabase/functions/twilio-voice-inbound/routing";

/** Mirror of the handler's status→patch mapping for the three missed-capable callbacks. */
const PATCH_STATUS: Record<string, string> = {
  "no-answer": "no-answer",
  busy: "completed",
  canceled: "failed",
};

function decideLate(
  storedStatus: string,
  callStatus: string,
  updateSucceeded = true,
  storedIsMissed = false,
) {
  const ladder = applyStatusLadder(storedStatus, PATCH_STATUS[callStatus] ?? callStatus);
  return {
    ladder,
    notify: shouldEmitMissedCallNotification({
      effectiveCallStatus: callStatus,
      ladderAcceptedStatusWrite: ladder.writeStatus,
      updateSucceeded,
      storedIsMissed,
      direction: "inbound",
      organizationId: "org-1",
    }),
  };
}

describe("C7.1–C7.3 — late statuses after completed: row unchanged, zero notifications", () => {
  it("completed → late no-answer is suppressed and silent", () => {
    const { ladder, notify } = decideLate("completed", "no-answer");
    expect(ladder.writeStatus).toBe(false); // terminal frozen: no status/is_missed/outcome write
    expect(notify).toBe(false);
  });

  it("completed → late busy is suppressed and silent", () => {
    const { ladder, notify } = decideLate("completed", "busy");
    expect(ladder.writeStatus).toBe(false);
    expect(notify).toBe(false);
  });

  it("completed → late canceled is suppressed and silent", () => {
    const { ladder, notify } = decideLate("completed", "canceled");
    expect(ladder.writeStatus).toBe(false);
    expect(notify).toBe(false);
  });
});

describe("C7.4 — accepted missed terminals still notify", () => {
  it("ringing → no-answer/busy/canceled notifies", () => {
    expect(decideLate("ringing", "no-answer").notify).toBe(true);
    expect(decideLate("ringing", "busy").notify).toBe(true);
    expect(decideLate("ringing", "canceled").notify).toBe(true);
  });

  it("connected → missed terminal notifies when accepted", () => {
    expect(decideLate("connected", "no-answer").notify).toBe(true);
  });

  it("accepted NON-missed terminals never notify", () => {
    const ladder = applyStatusLadder("connected", "completed");
    expect(ladder.writeStatus).toBe(true);
    expect(
      shouldEmitMissedCallNotification({
        effectiveCallStatus: "completed",
        ladderAcceptedStatusWrite: ladder.writeStatus,
        updateSucceeded: true,
        storedIsMissed: false,
        direction: "inbound",
        organizationId: "org-1",
      }),
    ).toBe(false);
  });
});

describe("C7.5 — a failed calls-row update never notifies", () => {
  it("accepted transition + failed update = silent", () => {
    const { ladder } = decideLate("ringing", "no-answer");
    expect(ladder.writeStatus).toBe(true);
    expect(decideLate("ringing", "no-answer", false).notify).toBe(false);
  });
});

describe("C7.6 — duplicate missed callback is exactly-once at the decision level", () => {
  it("first no-answer notifies; the replay (now stored terminal, not durably missed) is suppressed", () => {
    expect(decideLate("ringing", "no-answer").notify).toBe(true);
    expect(decideLate("no-answer", "no-answer").notify).toBe(false);
  });
});

describe("C7 refinement — durably-missed rows re-converge an aborted notification insert", () => {
  // insertMissedCallNotifications is FAIL-CLOSED: a transient recipient-resolution error aborts the
  // attempt with nothing inserted, and its contract says the other writer converges on the next
  // invocation. So a row already marked is_missed by an ACCEPTED writer must still be able to
  // converge here; the (user_id, event_key) upsert keeps the result exactly-once.
  it("a suppressed later callback on a durably-missed row still converges the notification", () => {
    expect(decideLate("no-answer", "completed", true, true).notify).toBe(true);
  });

  it("convergence never fires on a failed update, and never for a not-missed row", () => {
    expect(decideLate("no-answer", "completed", false, true).notify).toBe(false);
    expect(decideLate("completed", "no-answer", true, false).notify).toBe(false);
  });

  it("convergence still respects direction/org gating", () => {
    expect(
      shouldEmitMissedCallNotification({
        effectiveCallStatus: "completed",
        ladderAcceptedStatusWrite: false,
        updateSucceeded: true,
        storedIsMissed: true,
        direction: "outbound",
        organizationId: "org-1",
      }),
    ).toBe(false);
  });
});

describe("C7 — direction/org gating preserved", () => {
  it("outbound rows and missing org never notify", () => {
    expect(
      shouldEmitMissedCallNotification({
        effectiveCallStatus: "no-answer",
        ladderAcceptedStatusWrite: true,
        updateSucceeded: true,
        storedIsMissed: false,
        direction: "outbound",
        organizationId: "org-1",
      }),
    ).toBe(false);
    expect(
      shouldEmitMissedCallNotification({
        effectiveCallStatus: "no-answer",
        ladderAcceptedStatusWrite: true,
        updateSucceeded: true,
        storedIsMissed: false,
        direction: "inbound",
        organizationId: null,
      }),
    ).toBe(false);
  });
});

describe("C7.7 — stale earlier-wave fallback never re-marks an ANSWERED call", () => {
  it("a claimed row is never markable missed (agent_id is the atomic answered proof)", () => {
    expect(canMarkRowMissed({ agent_id: "u1", status: "ringing" })).toBe(false);
    expect(canMarkRowMissed({ agent_id: "u1", status: "connected" })).toBe(false);
    expect(canMarkRowMissed({ agent_id: "u1", status: "completed" })).toBe(false);
    expect(canMarkRowMissed({ agent_id: "  u1  ", status: "no-answer" })).toBe(false);
  });

  it("an abandoned unanswered caller stays a MISSED call (parent status is NOT answer proof)", () => {
    // A caller hanging up while the fallback action is being processed lands the parent's own
    // 'completed' first; the call still rang agents and nobody answered — a legitimate missed
    // call. Likewise an inbound parent can read 'connected' merely because Twilio answered the
    // call to execute TwiML. Only agent_id (written atomically by the claim CAS) proves an agent
    // answered, so status must never gate the missed mark — that would silently lose notifications.
    expect(canMarkRowMissed({ agent_id: null, status: "completed" })).toBe(true);
    expect(canMarkRowMissed({ agent_id: null, status: "connected" })).toBe(true);
    expect(canMarkRowMissed({ agent_id: null, status: "ringing" })).toBe(true);
    expect(canMarkRowMissed({ agent_id: "", status: "no-answer" })).toBe(true);
  });
});

describe("C7 — handler wiring is pinned at the source", () => {
  const statusSrc = readFileSync(
    resolve(__dirname, "../../../supabase/functions/twilio-voice-status/index.ts"),
    "utf8",
  );
  const inboundSrc = readFileSync(
    resolve(__dirname, "../../../supabase/functions/twilio-voice-inbound/index.ts"),
    "utf8",
  );

  it("voice-status derives notification from the ladder-gated decision", () => {
    expect(statusSrc.includes("shouldEmitMissedCallNotification")).toBe(true);
  });

  it("the raw-status notification trigger is gone", () => {
    expect(statusSrc.includes("isTerminalMissed")).toBe(false);
    expect(statusSrc.includes("existing?.is_missed || patch.is_missed")).toBe(false);
  });

  it("the calls update is exact-row and its outcome is verified", () => {
    expect(statusSrc.includes("updateSucceeded")).toBe(true);
    expect(statusSrc.includes('.select("id")')).toBe(true);
  });

  it("the accepted status write is an atomic CAS (first accepted terminal stands under concurrency)", () => {
    expect(statusSrc.includes("statusCasApplied")).toBe(true);
    expect(statusSrc.includes('.eq("status", ')).toBe(true);
  });

  it("a transient calls-update failure returns 5xx so the callback redelivers", () => {
    const updIdx = statusSrc.indexOf("statusCasApplied");
    expect(updIdx).toBeGreaterThan(-1);
    expect(/status:\s*503/.test(statusSrc.slice(updIdx))).toBe(true);
  });

  it("the canonical number statusCallback URL carries the connection-override retry fragment", () => {
    const cfg = readFileSync(
      resolve(__dirname, "../../../supabase/functions/_shared/twilioNumberConfig.ts"),
      "utf8",
    );
    expect(cfg.includes("twilio-voice-status#rc=3&rp=5xx,ct,rt")).toBe(true);
  });

  it("voice-inbound's missed-mark UPDATE is guarded by the atomic answered proof only", () => {
    const fnIdx = inboundSrc.indexOf("async function markMissedAndNotify");
    const body = inboundSrc.slice(fnIdx, fnIdx + 2000);
    expect(body.includes('.is("agent_id", null)')).toBe(true);
    // status must NOT gate the mark (see the abandoned-caller case above)
    expect(/\.not\("status",\s*"in"/.test(body)).toBe(false);
    expect(body.includes('.neq("status"')).toBe(false);
  });

  it("the finalize caller treats the stale-fallback 'claimed_active' refusal as an idempotent skip", () => {
    expect(inboundSrc.includes("claimed_active")).toBe(true);
  });
});
