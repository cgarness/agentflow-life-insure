import type { IdentifiedContact } from "@/contexts/TelnyxContext";

/** Strip placeholder text mistakenly stored in the “number” field. */
export function sanitizeCallerIdPhoneField(value: string): string {
  const t = value.trim();
  if (!t || /^unknown\s*caller$/i.test(t)) return "";
  return t;
}

const MIN_SIGNIFICANT_DIGITS = 10;

function digitCount(s: string): number {
  return s.replace(/\D/g, "").length;
}

/**
 * Inbound ring / active: headline + phone line. Name line never uses "Connecting…".
 * Phone line prefers CRM/DB, then context state, then WebRTC leg.
 */
export function buildInboundCallerLines(args: {
  identifiedContact: IdentifiedContact | null;
  incomingCallerNumber: string;
  webrtcRemoteRaw: string;
  /** `resolve_inbound_caller_display_name` / org CRM (separate from webhook `identifiedContact`). */
  crmContactName?: string;
  /** Telnyx SIP display name when it is not just the raw number. */
  telnyxCallerName?: string;
}): { displayName: string; displayPhone: string } {
  const inc = sanitizeCallerIdPhoneField(args.incomingCallerNumber);
  const rtc = (args.webrtcRemoteRaw || "").trim();
  const idName = (args.identifiedContact?.name || "").trim();
  const idNum = (args.identifiedContact?.number || "").trim();
  const crm = (args.crmContactName || "").trim();
  const telnyxName = (args.telnyxCallerName || "").trim();

  const displayName = idName || crm || telnyxName || idNum || rtc || "Unknown Caller";

  let displayPhone = idNum || inc || rtc;
  if (!displayPhone && digitCount(displayName) >= MIN_SIGNIFICANT_DIGITS) {
    displayPhone = displayName;
  }

  return { displayName, displayPhone };
}
