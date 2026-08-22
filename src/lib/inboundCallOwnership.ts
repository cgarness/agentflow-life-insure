/**
 * Pure inbound-call ownership/display helpers for the R13 browser contract (plan rev5 §4.4).
 *
 * The browser is UI ONLY on inbound calls: Twilio's signed per-agent statusCallback claims
 * ownership server-side (`claim_inbound_call`, service-role), and the browser merely OBSERVES the
 * row — `agent_id = my uid` is the one and only ownership confirmation. Nothing in this module (or
 * its callers) writes ownership, SIDs, or status for inbound rows.
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

/**
 * §1.3: the browser must never re-home inbound SIDs — `calls.twilio_call_sid` stays the parent
 * PSTN SID (webhook-owned) and `provider_session_id` is written exactly once by the claim CAS.
 * Outbound keeps the existing one-shot sync.
 */
export function shouldSyncIdsToRow(isInbound: boolean): boolean {
  return !isInbound;
}
