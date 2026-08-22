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
