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
