/**
 * Pure inbound-call ownership/display helpers for the R13 browser contract (plan rev5 §4.4).
 *
 * The browser is UI ONLY on inbound calls: Twilio's signed per-agent statusCallback claims
 * ownership server-side (`claim_inbound_call`, service-role), and the browser merely OBSERVES the
 * row — `agent_id = my uid` is the one and only ownership confirmation.
 *
 * Rev 8 C14 makes that claim complete and enforceable: NO browser path writes an inbound calls row
 * at all — not ownership, not SIDs, and not terminal state (status/outcome/is_missed/ended_at/
 * duration/provider metadata). Every browser calls-row mutation is gated by
 * `canBrowserFinalizeCallRow` / `canBrowserFinalizeOrphanRow` / `shouldSyncIdsToRow`, and
 * `src/lib/__tests__/inboundBrowserLifecycleWrites.test.ts` audits the whole file for new ones.
 */

/** TwiML `<Parameter name="af_call_row_id">` → Voice SDK `call.customParameters` key. */
export const AF_CALL_ROW_ID_PARAM = "af_call_row_id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the server-issued call row id from Voice SDK `call.customParameters`
 * (a `Map<string, string>` in @twilio/voice-sdk; a plain object is accepted defensively).
 * Returns null for anything that is not a well-formed UUID — there is NO fallback key: a ring
 * without a valid `af_call_row_id` simply has no CRM identity (never "the newest ringing call").
 */
export function extractAfCallRowId(
  customParameters:
    | Map<string, string>
    | Record<string, unknown>
    | null
    | undefined,
): string | null {
  if (!customParameters) return null;
  let raw: unknown;
  if (typeof (customParameters as Map<string, string>).get === "function") {
    raw = (customParameters as Map<string, string>).get(AF_CALL_ROW_ID_PARAM);
  } else {
    raw = (customParameters as Record<string, unknown>)[AF_CALL_ROW_ID_PARAM];
  }
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return UUID_RE.test(t) ? t : null;
}

export type InboundOwnership = "pending" | "mine" | "lost";

/**
 * R13 ownership observation: `agent_id` NULL ⇒ still pending (a local accept confirms nothing);
 * my uid ⇒ mine; anything else ⇒ lost race (teardown with zero writes). With no uid available a
 * non-null agent_id can never be "mine".
 */
export function classifyInboundOwnership(
  rowAgentId: unknown,
  myUserId: string | null | undefined,
): InboundOwnership {
  const agent = typeof rowAgentId === "string" ? rowAgentId.trim() : "";
  if (!agent) return "pending";
  if (myUserId && agent === myUserId) return "mine";
  return "lost";
}

/**
 * T9: on inbound rows `contact_phone` is the customer ANI and `caller_id_used` is OUR DID —
 * display must prefer `contact_phone` (matching the CommunicationDetails timeline contract).
 */
export function pickInboundDisplayPhone(row: {
  contact_phone?: unknown;
  caller_id_used?: unknown;
}): string {
  const contactPhone = String(row.contact_phone ?? "").trim();
  if (contactPhone) return contactPhone;
  return String(row.caller_id_used ?? "").trim();
}

/** The three real contact types — never collapsed, never invented (recruits stay recruits). */
export function normalizeInboundContactType(
  t: unknown,
): "lead" | "client" | "recruit" | undefined {
  const v = typeof t === "string" ? t.trim().toLowerCase() : "";
  if (v === "lead" || v === "client" || v === "recruit") return v;
  return undefined;
}

/**
 * T26: browser `.webm` recording is the OUTBOUND recorder only (server-side Dial recording was
 * removed for outbound 2026-04-20). Inbound recording is Twilio dual-channel via the webhook's
 * `record-from-answer-dual` — starting the browser recorder too would race two writers on the same
 * `recording_storage_path`/`recording_url` columns.
 */
export function shouldStartBrowserRecording(isInbound: boolean): boolean {
  return !isInbound;
}

export type RealtimeInboundRowAction = "ignore" | "observe" | "observe_and_display";

/**
 * Rev 6 C5 — EXACT-ROW scoping for the org-wide `calls` Realtime subscription.
 * Ownership, ANI, name, and contact reconciliation may act only on the row identified by the
 * current ring's server-issued af_call_row_id. An unrelated inbound row is ignored EVEN WHEN its
 * agent_id equals the current user (another call of mine must never repaint this ring). With no
 * known row id nothing is processed — there is no newest-ringing, phone, org-wide, or browser-SID
 * fallback keying. A lost race on the exact row is observation-only (teardown, never a repaint).
 */
export function classifyRealtimeInboundRow(args: {
  rowId: unknown;
  rowDirection: unknown;
  rowAgentId: unknown;
  currentInboundRowId: string | null;
  myUserId: string | null | undefined;
}): RealtimeInboundRowAction {
  const current = (args.currentInboundRowId || "").trim();
  if (!current) return "ignore";
  const d = String(args.rowDirection ?? "").toLowerCase();
  if (d !== "inbound" && d !== "incoming") return "ignore";
  if (String(args.rowId ?? "") !== current) return "ignore";
  const ownership = classifyInboundOwnership(args.rowAgentId, args.myUserId ?? null);
  return ownership === "lost" ? "observe" : "observe_and_display";
}

/**
 * §1.3: the browser must never re-home inbound SIDs — `calls.twilio_call_sid` stays the parent
 * PSTN SID (webhook-owned) and `provider_session_id` is written exactly once by the claim CAS.
 * Outbound keeps the existing one-shot sync.
 */
export function shouldSyncIdsToRow(isInbound: boolean): boolean {
  return !isInbound;
}

/** Mount-time orphan sweep: a call ringing longer than this is treated as stale (unchanged). */
export const ORPHAN_STALE_RINGING_MS = 5 * 60 * 1000;

export type OrphanRecovery =
  | "surface_inbound_readonly"
  | "stale_cleanup"
  | "silent_finalize";

/**
 * Rev 8 C14 — THE predicate for "may the browser write a terminal state onto this calls row?".
 * Only OUTBOUND calls: inbound lifecycle is Twilio-authoritative end to end (the webhook/RPC paths
 * own status, outcome, is_missed, ended_at, duration and provider metadata), and the R7 ladder
 * freezes the FIRST terminal — so a premature browser 'completed' would permanently win over the
 * real outcome. Unknown/missing direction fails closed (no write).
 */
export function canBrowserFinalizeCallRow(direction: unknown): boolean {
  const d = String(direction ?? "").trim().toLowerCase();
  return d === "outbound" || d === "outgoing";
}

/**
 * Rev 7 C8 — the mount-time orphan sweep finds "my newest ringing/connected call" agent-wide, with
 * no tie to this browser's actual call leg: a second tab opened during a live inbound call would
 * otherwise complete the winning row. Same rule, same predicate as every other browser terminal
 * write (C14).
 */
export function canBrowserFinalizeOrphanRow(direction: unknown): boolean {
  return canBrowserFinalizeCallRow(direction);
}

/**
 * Rev 7 C8 — what the mount-time sweep may do with the row it found.
 * Inbound (and anything not provably outbound) is surfaced READ-ONLY: zero calls-row writes, no
 * stale-ringing cleanup, no silent finalize. Outbound behavior is unchanged: a ringing row older
 * than the stale threshold is cleaned up, anything else is silently finalized as before.
 */
export function classifyOrphanRecovery(
  row: { direction?: unknown; status?: unknown; started_at?: string | null },
  nowMs: number,
  staleThresholdMs: number = ORPHAN_STALE_RINGING_MS,
): OrphanRecovery {
  if (!canBrowserFinalizeOrphanRow(row.direction)) return "surface_inbound_readonly";
  const status = String(row.status ?? "").trim().toLowerCase();
  if (status === "ringing" && row.started_at) {
    const age = nowMs - new Date(row.started_at).getTime();
    if (Number.isFinite(age) && age > staleThresholdMs) return "stale_cleanup";
  }
  return "silent_finalize";
}
