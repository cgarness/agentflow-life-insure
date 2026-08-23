// Pure, dependency-free status-ladder guard for twilio-voice-status.
// Kept Deno-free so it is unit-tested under vitest (see src/lib/__tests__/twilioStatusTerminalGuard.test.ts —
// the duration.ts house pattern). Plan rev5 R7: status is fully monotonic
//   ringing → connected → terminal (completed | no-answer | failed)
// A late/replayed callback can never move status backwards; a terminal state is frozen (first accepted
// terminal stands); suppressed writes still permit monotonic enrichment (duration via
// chooseDurationToWrite, ended_at only when NULL, shaken_stir/metadata) — handled by the caller.

const TERMINAL = new Set(["completed", "failed", "no-answer"]);

export function isTerminalCallStatus(status: string | null | undefined): boolean {
  return TERMINAL.has((status || "").trim());
}

function rank(status: string | null | undefined): number {
  const s = (status || "").trim();
  if (TERMINAL.has(s)) return 3;
  if (s === "connected") return 2;
  if (s === "ringing") return 1;
  return 0;
}

export interface LadderDecision {
  /** Persist patch.status (and, when applicable, started_at)? */
  writeStatus: boolean;
  /** Drop the started_at backfill that accompanies a suppressed 'ringing' write. */
  dropStartedAt: boolean;
  /** Monotonic enrichment (duration guard / ended_at-when-NULL / shaken_stir) always remains allowed. */
  allowEnrichment: boolean;
}

export function applyStatusLadder(
  storedStatus: string | null | undefined,
  incomingStatus: string,
): LadderDecision {
  const stored = rank(storedStatus);
  const incoming = rank(incomingStatus);

  // Terminal is frozen: no terminal→anything rewrite, including terminal→terminal (first stands).
  if (stored === 3) {
    return { writeStatus: false, dropStartedAt: true, allowEnrichment: true };
  }
  // Backward moves below terminal are dropped (closes the connected→ringing hole).
  if (incoming < stored) {
    return { writeStatus: false, dropStartedAt: true, allowEnrichment: true };
  }
  return { writeStatus: true, dropStartedAt: false, allowEnrichment: true };
}

/** The raw callback statuses that represent a missed inbound outcome. */
const MISSED_TRIGGER_STATUSES = new Set(["no-answer", "busy", "canceled"]);

/**
 * Rev 6 C7 — a missed-call notification may be emitted ONLY when the exact calls-row update
 * actually SUCCEEDED (never notify on a failed or CAS-missed write), on an inbound row with an
 * organization, AND one of:
 *   (a) the monotonic ladder ACCEPTED this callback's terminal status write and the raw effective
 *       status is a missed outcome (no-answer/busy/canceled) — the fresh-miss path. A suppressed
 *       late/replayed missed status on a row that is NOT durably missed changes nothing and
 *       notifies nobody; or
 *   (b) the row is DURABLY missed already (`is_missed = true`, written by an accepted guarded
 *       writer) — the convergence path. insertMissedCallNotifications is fail-closed: a transient
 *       recipient-resolution error aborts its single attempt with nothing inserted, and its
 *       contract explicitly relies on the other writer re-attempting. Converging here cannot
 *       manufacture a spurious notification (is_missed is only ever set for genuinely unanswered
 *       calls) and the notifications (user_id, event_key) upsert keeps the result exactly-once.
 */
export function shouldEmitMissedCallNotification(args: {
  effectiveCallStatus: string;
  ladderAcceptedStatusWrite: boolean;
  updateSucceeded: boolean;
  /** `calls.is_missed` as durably stored before/after this write (an accepted writer set it). */
  storedIsMissed: boolean;
  direction: string | null | undefined;
  organizationId: string | null | undefined;
}): boolean {
  if (!args.updateSucceeded) return false;
  if ((args.direction || "").trim().toLowerCase() !== "inbound") return false;
  if (!args.organizationId) return false;

  const freshMiss =
    args.ladderAcceptedStatusWrite &&
    MISSED_TRIGGER_STATUSES.has((args.effectiveCallStatus || "").trim().toLowerCase());

  return freshMiss || args.storedIsMissed === true;
}

/** Rev 7 C9 — the raw callback statuses whose ACCEPTED write must durably persist is_missed. */
export function shouldPersistMissedFlag(effectiveCallStatus: string): boolean {
  return MISSED_TRIGGER_STATUSES.has((effectiveCallStatus || "").trim().toLowerCase());
}

export type VoiceStatusOutcome =
  | "ok"
  | "ignored"
  | "unmatched"
  | "superseded"
  | "lookup_failed"
  | "update_failed"
  | "notify_failed"
  | "unexpected_error"
  | "bad_signature";

/**
 * Rev 7 C9 — one response policy for the whole handler.
 * After a VALID signature every transient failure (row lookup, exact-row update, notification
 * insert, unexpected exception) is a retryable 503 so Twilio's connection-override policy
 * redelivers — acking 200 there permanently loses the terminal write and/or its missed-call
 * notification. Unmatched rows, business-ignored statuses and a CAS superseded by a concurrent
 * writer are NOT retryable (200); an invalid signature stays 403.
 */
export function decideVoiceStatusResponse(outcome: VoiceStatusOutcome): number {
  switch (outcome) {
    case "bad_signature":
      return 403;
    case "lookup_failed":
    case "update_failed":
    case "notify_failed":
    case "unexpected_error":
      return 503;
    default:
      return 200;
  }
}
