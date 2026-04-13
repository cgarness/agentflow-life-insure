import type { IdentifiedContact } from "@/contexts/TelnyxContext";

/**
 * True when `name` is empty or is effectively the same digit string as the caller’s phone
 * (Telnyx / webhook often put the ANI in both “name” and “number” — not a CRM display name).
 */
export function isInboundNameSameAsPhoneNumber(name: string, callerPhone: string): boolean {
  const n = name.trim();
  if (!n) return true;
  const nd = callerPhone.replace(/\D/g, "");
  const nn = n.replace(/\D/g, "");
  if (nn.length < 7) return false;
  if (!nd) return nn.length >= 10;
  return nn === nd || nd.endsWith(nn) || (nn.length >= 10 && nd.endsWith(nn.slice(-10)));
}

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
  const idNameRaw = (args.identifiedContact?.name || "").trim();
  const idNum = (args.identifiedContact?.number || "").trim();
  const crm = (args.crmContactName || "").trim();
  const telnyxName = (args.telnyxCallerName || "").trim();

  const phoneCompare = idNum || inc || rtc;
  const idName =
    idNameRaw && !isInboundNameSameAsPhoneNumber(idNameRaw, phoneCompare || idNameRaw)
      ? idNameRaw
      : "";

  const displayName = idName || crm || telnyxName || idNum || rtc || "Unknown Caller";

  let displayPhone = idNum || inc || rtc;
  if (!displayPhone && digitCount(displayName) >= MIN_SIGNIFICANT_DIGITS) {
    displayPhone = displayName;
  }

  return { displayName, displayPhone };
}
