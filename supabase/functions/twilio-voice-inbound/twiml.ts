// Pure, dependency-free TwiML builders + terminal-action decisions for twilio-voice-inbound.
// Kept Deno-free so they are unit-tested under vitest (see src/lib/__tests__/inboundTwiml.test.ts —
// the twilio-voice-status/duration.ts house pattern). Plan rev5: R3, R13, R17, R19, T19, T20, D3, D7.

export interface RingTarget {
  identity: string;
  agentId: string;
}

/**
 * Twilio webhook connection-override fragments (R17/R19). Overrides ride the URL FRAGMENT — never
 * transmitted on the wire, never part of the signed URL — and configure bounded retries for HTTP 5xx,
 * TCP/TLS connect failures (ct) and read timeouts (rt). Twilio's DEFAULT policy does not retry 5xx.
 */
export const CLAIM_CALLBACK_RETRY_FRAGMENT = "#rc=3&rp=5xx,ct,rt";
export const RECORDING_CALLBACK_RETRY_FRAGMENT = "#rc=3&rp=5xx,ct,rt";

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** T19: clamp(phone_settings.ring_timeout ?? 30, 5, 120) — the plan §5.6 formula, exactly. */
export function clampRingTimeout(raw: unknown): number {
  const n = raw === null || raw === undefined ? 30 : Number(raw);
  if (!Number.isFinite(n)) return 30;
  return Math.max(5, Math.min(120, Math.round(n)));
}

export interface ClientDialOpts {
  targets: RingTarget[];
  callRowId: string;
  timeoutSec: number;
  actionUrl: string;
  recordingEnabled: boolean;
  recordingStatusUrl: string;
  claimCallbackBaseUrl: string;
}

/**
 * R13/R19: one <Client> noun per routed agent, each carrying
 *   - nested <Identity> + <Parameter name="af_call_row_id"> (→ Voice SDK call.customParameters),
 *   - a per-agent SIGNED statusCallback URL with server-issued call_row_id + agent_id query params
 *     (never from the browser) and the bounded retry override fragment,
 *   - statusCallbackEvent="answered completed": in-progress = primary answered proof; completed =
 *     lost-answered recovery. Losing legs (canceled/busy/failed/no-answer) are filtered server-side.
 * R3: af_org_id is NEVER passed — organization identity comes from the database.
 */
export function buildClientDialTwiml(opts: ClientDialOpts): string {
  const safeAction = xmlEscape(opts.actionUrl);
  const recUrl = `${opts.recordingStatusUrl}${RECORDING_CALLBACK_RETRY_FRAGMENT}`;
  const recordAttrs = opts.recordingEnabled
    ? ` record="record-from-answer-dual" recordingStatusCallback="${xmlEscape(recUrl)}"` +
      ` recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"`
    : "";
  const clients = opts.targets
    .map((t) => {
      const cb =
        `${opts.claimCallbackBaseUrl}?call_row_id=${opts.callRowId}&agent_id=${t.agentId}` +
        CLAIM_CALLBACK_RETRY_FRAGMENT;
      return (
        `<Client statusCallback="${xmlEscape(cb)}"` +
        ` statusCallbackEvent="answered completed" statusCallbackMethod="POST">` +
        `<Identity>${xmlEscape(t.identity)}</Identity>` +
        `<Parameter name="af_call_row_id" value="${xmlEscape(opts.callRowId)}"/>` +
        `</Client>`
      );
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Dial timeout="${clampRingTimeout(opts.timeoutSec)}" action="${safeAction}" method="POST"${recordAttrs}>` +
    `${clients}` +
    `</Dial>` +
    `</Response>`
  );
}

export type TerminalAction = "forward" | "voicemail" | "hangup";

/**
 * T20/D3: the documented non-voicemail terminal behavior. When the effective fallback action resolves
 * to voicemail (explicitly or by default) and voicemail_enabled is false ⇒ hangup with greeting —
 * a <Record> is never emitted.
 */
export function resolveTerminalAction(opts: {
  fallbackAction: string;
  voicemailEnabled: boolean;
  forwardingNumber: string;
  alreadyForwarded: boolean;
}): TerminalAction {
  if (
    opts.fallbackAction === "forward" &&
    (opts.forwardingNumber || "").trim() !== "" &&
    !opts.alreadyForwarded
  ) {
    return "forward";
  }
  if (opts.fallbackAction === "hangup") return "hangup";
  // voicemail, forward-exhausted, and the unset default all land on the voicemail branch:
  return opts.voicemailEnabled ? "voicemail" : "hangup";
}

export function buildVoicemailTwiml(
  recordingUrl: string,
  hangupActionUrl: string,
  greetingText: string,
  greetingUrl: string,
): string {
  const safeRec = xmlEscape(`${recordingUrl}${RECORDING_CALLBACK_RETRY_FRAGMENT}`);
  const safeAction = xmlEscape(hangupActionUrl);
  const greetingVerb = greetingUrl && greetingUrl.trim()
    ? `<Play>${xmlEscape(greetingUrl.trim())}</Play>`
    : `<Say voice="Polly.Joanna">${xmlEscape(greetingText)}</Say>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `${greetingVerb}` +
    `<Record maxLength="120" playBeep="true" recordingStatusCallback="${safeRec}"` +
    ` recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"` +
    ` action="${safeAction}" method="POST"/>` +
    `<Say voice="Polly.Joanna">We did not receive a message. Goodbye.</Say>` +
    `<Hangup/>` +
    `</Response>`
  );
}

/** D7: forwarded external legs are intentionally unrecorded — no record attributes, ever. */
export function buildForwardTwiml(forwardingNumber: string, actionUrl: string): string {
  const safeNumber = xmlEscape(forwardingNumber);
  const safeAction = xmlEscape(actionUrl);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Dial action="${safeAction}" method="POST">${safeNumber}</Dial>` +
    `</Response>`
  );
}

export function buildHangupTwiml(greetingText: string): string {
  const safeGreeting = xmlEscape(greetingText);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say voice="Polly.Joanna">${safeGreeting}</Say>` +
    `<Hangup/>` +
    `</Response>`
  );
}

// ── Inbound Calling v2 (implementation_plan.md rev 3 §8–§10; D4, D6, D9, D12, P5, P6, P7, P17) ──────
// Pure builders for the v2 stage machine. Every URL below is a SERVER-issued signed callback carrying
// call_row_id / org_id / attempt_id / agent_id — never anything from the browser.

/** §8.5: <Dial action> URLs carry the same bounded connection-override policy (verify live). */
export const DIAL_ACTION_RETRY_FRAGMENT = "#rc=3&rp=5xx,ct,rt";

/** v2 ring windows (browser_ring_seconds / mobile_ring_seconds): clamp(raw ?? 20, 5, 120). */
export function clampV2RingSeconds(raw: unknown): number {
  const n = raw === null || raw === undefined ? 20 : Number(raw);
  if (!Number.isFinite(n)) return 20;
  return Math.max(5, Math.min(120, Math.round(n)));
}

export interface MobileForwardOpts {
  /** E.164 destination snapshot persisted by commit_owner_mobile (never re-read from settings). */
  mobileNumber: string;
  timeoutSec: number;
  /** stage=owner_mobile parent <Dial action> (DialBridged / DialCallStatus arrive here). */
  actionUrl: string;
  /** stage=mobile_whisper — executed on the CALLED leg before bridging (Press 1 acceptance, P6). */
  whisperUrl: string;
  /** stage=mobile_leg_status — child-leg lifecycle (initiated/ringing/answered/completed). */
  legStatusUrl: string;
}

/**
 * D12: the mobile leg is NEVER recorded — no `record` attribute on <Dial>, no recording callback.
 * P7: no callerId attribute (Twilio's default caller ID applies; verify live).
 * The whisper URL runs on the called party before Twilio bridges; a <Hangup/> there refuses the bridge.
 */
export function buildMobileForwardTwiml(opts: MobileForwardOpts): string {
  const number = (opts.mobileNumber || "").trim();
  if (!/^\+[1-9][0-9]{7,14}$/.test(number)) {
    throw new Error("buildMobileForwardTwiml: destination must be E.164");
  }
  const action = xmlEscape(`${opts.actionUrl}${DIAL_ACTION_RETRY_FRAGMENT}`);
  const whisper = xmlEscape(opts.whisperUrl);
  const legStatus = xmlEscape(`${opts.legStatusUrl}${CLAIM_CALLBACK_RETRY_FRAGMENT}`);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Dial timeout="${clampV2RingSeconds(opts.timeoutSec)}" action="${action}" method="POST">` +
    `<Number url="${whisper}" method="POST" statusCallback="${legStatus}"` +
    ` statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST">` +
    `${xmlEscape(number)}` +
    `</Number>` +
    `</Dial>` +
    `</Response>`
  );
}

/**
 * P6: the whisper played to the agent's mobile. actionOnEmptyResult="true" makes Twilio post the
 * Gather action even when no digit arrives, so `no_digit` is RECORDED (record_inbound_mobile_accept)
 * instead of silently falling through. The trailing <Hangup/> is defense in depth: reaching it means
 * the call is never bridged.
 */
export function buildMobileWhisperTwiml(opts: { gatherActionUrl: string; callerLabel: string }): string {
  const action = xmlEscape(opts.gatherActionUrl);
  const label = xmlEscape((opts.callerLabel || "").trim() || "an unknown number");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Gather input="dtmf" numDigits="1" timeout="5" actionOnEmptyResult="true" action="${action}" method="POST">` +
    `<Say voice="Polly.Joanna">AgentFlow call from ${label}. Press 1 to accept.</Say>` +
    `</Gather>` +
    `<Hangup/>` +
    `</Response>`
  );
}

/** Press 1 recorded as `accepted`: an empty response ends the whisper TwiML and lets Twilio bridge. */
export function buildWhisperAcceptTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

/** Any other acceptance result (no digit, wrong digit, caller already gone, unrecorded): never bridge. */
export function buildWhisperRejectTwiml(text = "Goodbye."): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say voice="Polly.Joanna">${xmlEscape(text)}</Say>` +
    `<Hangup/>` +
    `</Response>`
  );
}

/** Empty TwiML: the parent call ends (used after a bridged conversation or an answered browser leg). */
export function buildEmptyTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

/**
 * Safeguard 5: `DialBridged` is a documented parameter of the <Dial action> request. It is parsed
 * strictly — "true" ⇒ true, "false" ⇒ false, anything else (including ABSENT) ⇒ null so the SQL
 * evidence becomes `unconfirmed` rather than a guessed attribution.
 */
export function parseDialBridged(raw: string | null | undefined): boolean | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

/** Spoken caller label for the whisper: digits grouped so Polly reads a phone number, never raw input. */
export function spokenCallerLabel(fromNumber: string | null | undefined): string {
  const digits = (fromNumber || "").replace(/\D/g, "");
  if (!digits) return "an unknown number";
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.split("").join(" ");
}
