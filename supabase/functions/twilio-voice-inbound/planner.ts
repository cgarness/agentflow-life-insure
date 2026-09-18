// Pure, dependency-free v2 routing decisions for twilio-voice-inbound (implementation_plan.md rev 3
// §8.1/§8.3/§9 + safeguards 1 and 5). Kept Deno-free so they are unit-tested under vitest
// (src/lib/__tests__/inboundStages.test.ts). The DATABASE owns every reservation, the D13 commit and
// the bridge evidence (plan_inbound_route / advance_to_owner_mobile / record_inbound_mobile_*); this
// module only maps persisted results to the next TwiML and never infers what the database did not say.

export type OwnerSource = "direct_line" | "contact";

/**
 * P1 + D2 + D5: a direct line's owner outranks the contact's assigned agent; otherwise the contact's
 * assigned agent; otherwise no owner ⇒ the admin-selected inbound group. A number's `assigned_to` on
 * a NON-direct line is NOT a routing input under v2 (P11 retires the per-number overrides).
 */
export function resolveOwnerCandidate(args: {
  isDirectLine: boolean | null | undefined;
  numberAssignedTo: string | null | undefined;
  contactAssignedAgentId: string | null | undefined;
}): { ownerAgentId: string | null; ownerSource: OwnerSource | null } {
  const direct = args.isDirectLine === true ? (args.numberAssignedTo || "").trim() : "";
  if (direct) return { ownerAgentId: direct, ownerSource: "direct_line" };
  const contact = (args.contactAssignedAgentId || "").trim();
  if (contact) return { ownerAgentId: contact, ownerSource: "contact" };
  return { ownerAgentId: null, ownerSource: null };
}

export type RouteStage =
  | "owner_browser"
  | "owner_mobile"
  | "owner_voicemail"
  | "group_browser"
  | "group_voicemail"
  | "done";

/** The subset of inbound_route_attempts the handlers read (to_jsonb(a) from the RPCs or a row read). */
export interface AttemptView {
  id: string;
  stage: RouteStage | string;
  mode: "owner" | "group" | string;
  owner_agent_id: string | null;
  reserved_agent_ids: string[] | null;
  browser_ring_timeout_sent: number | null;
  mobile_number_dialed: string | null;
  voicemail_kind: "agent" | "group" | string | null;
  voicemail_agent_id: string | null;
  voicemail_group_ids: string[] | null;
  mobile_accept_result?: string | null;
  mobile_bridge_evidence?: string | null;
  /** Child leg SID bound by record_inbound_mobile_accept (defect 5: whisper/bridge callbacks must match it). */
  mobile_child_call_sid?: string | null;
  terminal: boolean;
}

/** Mailbox identifier carried in the SIGNED recording callback: 'agent:<uuid>' or 'group'. */
export function mailboxForAttempt(a: Pick<AttemptView, "mode" | "owner_agent_id" | "voicemail_kind" | "voicemail_agent_id">): string {
  const agent = (a.voicemail_agent_id || (a.mode === "owner" ? a.owner_agent_id : null) || "").trim();
  if (a.voicemail_kind === "group") return "group";
  return agent ? `agent:${agent}` : "group";
}

export function parseMailbox(raw: string | null | undefined): { kind: "agent"; agentId: string } | { kind: "group" } | null {
  const v = (raw || "").trim();
  if (v === "group") return { kind: "group" };
  const m = /^agent:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(v);
  return m ? { kind: "agent", agentId: m[1].toLowerCase() } : null;
}

export type NextTwiml =
  | { kind: "client_dial"; agentIds: string[]; timeoutSec: number; stage: "owner_browser" | "group_browser" }
  | { kind: "mobile_dial"; mobile: string }
  | { kind: "voicemail"; mailbox: string }
  | { kind: "empty" };

function ids(v: string[] | null | undefined): string[] {
  return (v || []).filter((x): x is string => typeof x === "string" && x.length > 0);
}

/**
 * Idempotent re-emission for a duplicate delivery (duplicate initial webhook, duplicate <Dial action>):
 * the TwiML for the PERSISTED stage. `owner_mobile` without a destination snapshot can only mean a
 * torn write that the database forbids — it is served voicemail, never an unsnapshotted mobile <Dial>.
 */
export function nextForPersistedStage(a: AttemptView, defaultRingSec: number): NextTwiml {
  const ring = a.browser_ring_timeout_sent ?? defaultRingSec;
  switch (a.stage) {
    case "owner_browser":
      return { kind: "client_dial", agentIds: ids(a.reserved_agent_ids), timeoutSec: ring, stage: "owner_browser" };
    case "group_browser":
      return { kind: "client_dial", agentIds: ids(a.reserved_agent_ids), timeoutSec: ring, stage: "group_browser" };
    case "owner_mobile": {
      const mobile = (a.mobile_number_dialed || "").trim();
      return mobile ? { kind: "mobile_dial", mobile } : { kind: "voicemail", mailbox: mailboxForAttempt(a) };
    }
    case "owner_voicemail":
      return { kind: "voicemail", mailbox: mailboxForAttempt({ ...a, voicemail_kind: "agent" }) };
    case "group_voicemail":
      return { kind: "voicemail", mailbox: "group" };
    case "done":
      return { kind: "empty" };
    default:
      return { kind: "voicemail", mailbox: mailboxForAttempt(a) };
  }
}

/** advance_to_owner_mobile result (M6 §7). */
export interface AdvanceToMobileResult {
  updated?: boolean;
  forward?: boolean;
  reason?: string;
  stage?: string;
  terminal?: boolean;
  mobile?: string | null;
  owner?: string | null;
}

/**
 * Safeguard 1: the mobile <Dial> is emitted ONLY when the database reports `forward:true` (both the
 * attempt CAS and the guarded D13 parent-call mark landed in one transaction). Every refusal and every
 * zero-row outcome follows the PERSISTED stage; nothing here can produce a mobile dial from a partial
 * commit. `call_not_forwardable` means the call was answered by a browser claim or is already terminal
 * — the parent simply ends.
 */
export function decideOwnerBrowserReturn(
  r: AdvanceToMobileResult | null | undefined,
  ownerAgentId: string | null,
  defaultRingSec: number,
): NextTwiml {
  const ownerMailbox = ownerAgentId ? `agent:${ownerAgentId}` : "group";
  if (!r) return { kind: "voicemail", mailbox: ownerMailbox };
  if (r.forward === true && r.updated === true) {
    const mobile = (r.mobile || "").trim();
    return mobile ? { kind: "mobile_dial", mobile } : { kind: "voicemail", mailbox: ownerMailbox };
  }
  if (r.updated === true && r.forward === false) {
    return { kind: "voicemail", mailbox: ownerMailbox };
  }
  // updated:false — follow the persisted stage
  if (r.reason === "call_not_forwardable") return { kind: "empty" };
  const persisted: AttemptView = {
    id: "", stage: r.stage || "", mode: "owner", owner_agent_id: ownerAgentId, reserved_agent_ids: [],
    browser_ring_timeout_sent: null, mobile_number_dialed: r.mobile ?? null, voicemail_kind: null,
    voicemail_agent_id: ownerAgentId, voicemail_group_ids: [], terminal: r.terminal === true,
  };
  if (persisted.stage === "owner_browser") {
    // stage_conflict / attempt still ringing per the database: never re-ring a browser wave from a
    // Dial-action return — the caller is holding; voicemail is the safe path.
    return { kind: "voicemail", mailbox: ownerMailbox };
  }
  return nextForPersistedStage(persisted, defaultRingSec);
}

export type BridgeEvidence = "dial_bridged" | "not_bridged" | "unconfirmed";

/**
 * Safeguard 5 — next-step TwiML after the mobile <Dial> returns, reconciled with the DOCUMENTED Dial
 * action results (DialCallStatus ∈ completed|answered|busy|no-answer|failed|canceled, DialBridged):
 *   dial_bridged                       ⇒ the conversation happened: the parent ends (`done`).
 *   unconfirmed + accepted + answered  ⇒ DialBridged was ABSENT but the documented status says the
 *                                        accepted leg completed: the parent ends WITHOUT attribution
 *                                        (the database keeps `unconfirmed`, no outcome/duration proof).
 *   anything else                      ⇒ owner voicemail (D6); no new missed mark — D13 already holds.
 */
export function decideMobileReturn(args: {
  evidence: BridgeEvidence | string;
  acceptResult: string | null | undefined;
  dialCallStatus: string;
}): { next: "hangup" | "voicemail"; toStage: "done" | "owner_voicemail"; finalOutcome: string } {
  const status = (args.dialCallStatus || "").trim().toLowerCase();
  const answered = status === "completed" || status === "answered";
  if (args.evidence === "dial_bridged") {
    return { next: "hangup", toStage: "done", finalOutcome: "mobile_bridged" };
  }
  if (args.evidence === "unconfirmed" && args.acceptResult === "accepted" && answered) {
    return { next: "hangup", toStage: "done", finalOutcome: "mobile_unconfirmed_ended" };
  }
  return {
    next: "voicemail",
    toStage: "owner_voicemail",
    finalOutcome: args.evidence === "unconfirmed" ? "mobile_unconfirmed" : "mobile_not_bridged",
  };
}

/**
 * record_inbound_mobile_accept result → whisper TwiML: bridge ONLY on the database's bridge PERMISSION
 * (`accept:true`), which requires a recorded `accepted` AND a caller who is still present. A replayed
 * Gather after the caller hung up carries `result:'accepted'` (the preserved fact) with `accept:false`.
 */
export function decideWhisperResponse(r: { accept?: boolean; result?: string; caller_present?: boolean } | null | undefined): "bridge" | "hangup" {
  return r && r.accept === true && r.result === "accepted" && r.caller_present !== false ? "bridge" : "hangup";
}

/** Child-leg statuses that end the mobile leg (release the accepted-mobile reservation). */
export function isTerminalLegStatus(callStatus: string | null | undefined): boolean {
  const s = (callStatus || "").trim().toLowerCase();
  return s === "completed" || s === "busy" || s === "no-answer" || s === "failed" || s === "canceled";
}

export function isAnsweredDial(dialCallStatus: string | null | undefined): boolean {
  const s = (dialCallStatus || "").trim().toLowerCase();
  return s === "completed" || s === "answered";
}

export function parseDurationInt(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string | null | undefined): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// ── Callback identity binding (corrective pass, defect 5) ─────────────────────────────────────────────
// Twilio's documented request fields per callback type:
//   parent <Dial action> (owner_browser / owner_mobile / group_browser) and <Record action> (voicemail_done):
//     CallSid = the PARENT call.
//   child-leg requests (<Number url> whisper, <Number statusCallback> leg status):
//     CallSid = the CHILD call, ParentCallSid = the parent created by <Dial>, To = the dialed destination.
// Every stage callback is bound to the stored call row named by the signed call_row_id: organization,
// parent SID and (for child legs) destination and already-bound child SID must all agree, or the request
// is refused with no write.

export type CallbackStage = "owner_browser" | "owner_mobile" | "group_browser" | "voicemail_done" | "mobile_whisper" | "mobile_leg_status";

export const PARENT_STAGES: ReadonlySet<string> = new Set(["owner_browser", "owner_mobile", "group_browser", "voicemail_done"]);
export const CHILD_STAGES: ReadonlySet<string> = new Set(["mobile_whisper", "mobile_leg_status"]);

export interface StoredCallForIdentity {
  organization_id: string | null;
  twilio_call_sid: string | null;
}

export type IdentityVerdict =
  | { ok: true; parentCallSid: string }
  | { ok: false; reason: "org_mismatch" | "parent_sid_mismatch" | "missing_parent_sid" | "child_sid_mismatch" | "destination_mismatch" | "unknown_stage" | "stored_parent_missing" };

const CALL_SID_RE = /^CA[0-9a-fA-F]{32}$/;

/** Digits only; a bare 10-digit US number gets its country code (mirrors private.phone_digits_e164ish). */
export function phoneDigitsE164ish(v: string | null | undefined): string {
  const raw = (v || "").trim();
  const d = raw.replace(/\D/g, "");
  // A bare 10-digit national number gets the NANP country code; an E.164 input ('+…') is taken as-is,
  // so a 10-digit non-NANP E.164 number never collides with a +1 number (mirrors private.phone_digits_e164ish).
  return d.length === 10 && !raw.startsWith("+") ? `1${d}` : d;
}
const digits = phoneDigitsE164ish;

export function verifyCallbackIdentity(args: {
  stage: string;
  params: Record<string, string | undefined>;
  orgId: string;
  stored: StoredCallForIdentity;
  /** for child legs: the attempt's persisted destination and (if already bound) child SID */
  attempt?: { mobile_number_dialed: string | null; mobile_child_call_sid: string | null } | null;
}): IdentityVerdict {
  const { stage, params, stored } = args;
  if (!stored.organization_id || stored.organization_id !== args.orgId) return { ok: false, reason: "org_mismatch" };
  const parent = (stored.twilio_call_sid || "").trim();
  if (!CALL_SID_RE.test(parent)) return { ok: false, reason: "stored_parent_missing" };
  if (PARENT_STAGES.has(stage)) {
    if ((params.CallSid || "").trim() !== parent) return { ok: false, reason: "parent_sid_mismatch" };
    return { ok: true, parentCallSid: parent };
  }
  if (CHILD_STAGES.has(stage)) {
    const parentParam = (params.ParentCallSid || "").trim();
    if (!parentParam) return { ok: false, reason: "missing_parent_sid" };
    if (parentParam !== parent) return { ok: false, reason: "parent_sid_mismatch" };
    const child = (params.CallSid || "").trim();
    const bound = (args.attempt?.mobile_child_call_sid || "").trim();
    if (bound && child && bound !== child) return { ok: false, reason: "child_sid_mismatch" };
    if (stage === "mobile_whisper") {
      const dialed = digits(args.attempt?.mobile_number_dialed);
      const to = digits(params.To);
      if (!dialed || !to || dialed !== to) return { ok: false, reason: "destination_mismatch" };
    }
    return { ok: true, parentCallSid: parent };
  }
  return { ok: false, reason: "unknown_stage" };
}
