import type { IdentifiedContact } from "@/contexts/TelnyxContext";
import {
  isInboundNameSameAsPhoneNumber,
  stripIfOrgOwnedPhoneLabel,
} from "@/lib/telnyxInboundCaller";
import { formatPhoneNumber } from "@/utils/phoneUtils";

/** Re-export for callers that already import from this module. */
export { isInboundNameSameAsPhoneNumber } from "@/lib/telnyxInboundCaller";

/** Strip placeholder text mistakenly stored in the “number” field. */
export function sanitizeCallerIdPhoneField(value: string): string {
  const t = value.trim();
  if (!t || /^unknown\s*caller$/i.test(t)) return "";
  return t;
}

/** Telnyx / SDK often sends these as “display name” on inbound browser legs — not a person. */
function isGarbageInboundDisplayLabel(s: string): boolean {
  const t = s.trim().toLowerCase();
  return (
    !t ||
    t === "unknown caller" ||
    t === "unknown" ||
    t === "outbound call" ||
    t === "anonymous"
  );
}

/**
 * Inbound ring / active: headline + phone line. Name line never uses "Connecting…".
 * Phone line prefers CRM/DB, then context state, then WebRTC leg.
 */
export function buildInboundCallerLines(args: {
  identifiedContact: IdentifiedContact | null;
  incomingCallerNumber: string;
  webrtcRemoteRaw: string;
  /** Last-10 digits of org-owned DIDs — never show as inbound “customer” caller ID. */
  excludeOrgLast10?: Set<string>;
  /** `resolve_inbound_caller_display_name` / org CRM (separate from webhook `identifiedContact`). */
  crmContactName?: string;
  /** Telnyx SIP display name when it is not just the raw number. */
  telnyxCallerName?: string;
}): { displayName: string; displayPhone: string } {
  const ex = args.excludeOrgLast10;
  const inc = stripIfOrgOwnedPhoneLabel(
    sanitizeCallerIdPhoneField(args.incomingCallerNumber),
    ex,
  );
  const rtc = stripIfOrgOwnedPhoneLabel((args.webrtcRemoteRaw || "").trim(), ex);
  const idNameRaw = (args.identifiedContact?.name || "").trim();
  const idNum = stripIfOrgOwnedPhoneLabel(
    (args.identifiedContact?.number || "").trim(),
    ex,
  );
  const crmRaw = (args.crmContactName || "").trim();
  const crm = !isGarbageInboundDisplayLabel(crmRaw) ? crmRaw : "";
  const telnyxRaw = (args.telnyxCallerName || "").trim();
  const telnyxName = !isGarbageInboundDisplayLabel(telnyxRaw) ? telnyxRaw : "";

  const phoneCompare = idNum || inc || rtc;
  const idName =
    idNameRaw && !isInboundNameSameAsPhoneNumber(idNameRaw, phoneCompare || idNameRaw)
      ? idNameRaw
      : "";

  const rawPhone = idNum || inc || rtc;
  const humanHeadline = idName || crm || telnyxName;
  const phoneAsHeadline =
    !humanHeadline && rawPhone
      ? formatPhoneNumber(rawPhone) || rawPhone
      : "";
  const displayName = humanHeadline || phoneAsHeadline || "";
  /** When CRM/Telnyx supplies a name before DID strip clears context, keep any non–org-DID digits for the subtitle. */
  const displayPhone =
    rawPhone ||
    (humanHeadline
      ? stripIfOrgOwnedPhoneLabel(
          sanitizeCallerIdPhoneField(args.incomingCallerNumber),
          ex,
        ) || idNum ||
        rtc
      : "");

  return { displayName, displayPhone };
}
