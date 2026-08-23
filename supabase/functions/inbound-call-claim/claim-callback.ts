// Pure, dependency-free helpers for the Twilio-authoritative answer-claim webhook.
// Kept Deno-free so they are unit-tested under vitest (see src/lib/__tests__/inboundClaimCallback.test.ts).
// Plan rev5: R13 (Twilio-authoritative claiming), R16 (strict SIDs), R19 (event set + response policy).

const CALL_SID_RE = /^CA[0-9a-fA-F]{32}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isValidCallSid(sid: string | null | undefined): boolean {
  return CALL_SID_RE.test((sid || "").trim());
}

export type CallbackEventClass = "claim" | "ignore_losing_leg" | "ignore_other";

/**
 * R19 event policy:
 *   in-progress  — the `answered` event: PRIMARY answered proof;
 *   completed    — the `completed` event: RECOVERY proof when the answered delivery was lost;
 *   canceled/busy/failed/no-answer — losing legs: NEVER claim (2xx ack, no retries);
 *   everything else (initiated/ringing/…) — ignored.
 */
export function classifyCallbackEvent(callStatus: string | null | undefined): CallbackEventClass {
  const s = (callStatus || "").trim().toLowerCase();
  if (s === "in-progress" || s === "completed") return "claim";
  if (s === "canceled" || s === "busy" || s === "failed" || s === "no-answer") return "ignore_losing_leg";
  return "ignore_other";
}

/** R13: the server-issued (never browser-supplied) signed query params. Null on any malformation. */
export function parseClaimCallbackParams(url: URL): { callRowId: string; agentId: string } | null {
  const callRowId = (url.searchParams.get("call_row_id") || "").trim();
  const agentId = (url.searchParams.get("agent_id") || "").trim();
  if (!UUID_RE.test(callRowId) || !UUID_RE.test(agentId)) return null;
  return { callRowId, agentId };
}

/** The answered <Client> leg arrives as Called/To = "client:<identity>". */
export function extractClientIdentity(calledOrTo: string | null | undefined): string {
  const v = (calledOrTo || "").trim();
  return v.startsWith("client:") ? v.slice("client:".length) : v;
}

export type AnsweredIdentityCheck =
  | "match"
  | "missing_answered_identity"
  | "missing_profile_identity"
  | "identity_mismatch";

/**
 * Rev 6 C4 — the R13 answered-identity cross-check, FAIL CLOSED.
 * The answered child leg's client identity (first nonempty of Called, To, after stripping the
 * client: prefix and trimming) must be present AND exactly equal to the Active profile's nonempty
 * twilio_client_identity. A signed callback with missing, empty, or mismatched identity is a
 * business rejection — it must never reach the claim RPC.
 */
export function checkAnsweredClientIdentity(args: {
  calledParam: string | null | undefined;
  toParam: string | null | undefined;
  profileIdentity: string | null | undefined;
}): AnsweredIdentityCheck {
  const answered =
    extractClientIdentity(args.calledParam).trim() ||
    extractClientIdentity(args.toParam).trim();
  const profile = (args.profileIdentity || "").trim();
  if (!answered) return "missing_answered_identity";
  if (!profile) return "missing_profile_identity";
  return answered === profile ? "match" : "identity_mismatch";
}

export type ClaimHandlerOutcome =
  | { kind: "claimed" }
  | { kind: "rejected" }
  | { kind: "ignored" }
  | { kind: "transient" }
  | { kind: "bad_signature" };

/**
 * R19 response policy: transient DB/RPC failures → retryable 5xx (the callback URL's connection
 * overrides redeliver); valid business rejections and ignored losing-leg events → 2xx so Twilio
 * never retries pointlessly; invalid signature stays 403.
 */
export function decideClaimResponseStatus(outcome: ClaimHandlerOutcome): number {
  switch (outcome.kind) {
    case "transient":
      return 503;
    case "bad_signature":
      return 403;
    default:
      return 200;
  }
}
