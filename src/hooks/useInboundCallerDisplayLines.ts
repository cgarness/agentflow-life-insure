import { useMemo } from "react";
import { useTelnyx } from "@/contexts/TelnyxContext";
import { buildInboundCallerLines } from "@/components/layout/inboundCallerDisplay";
import { buildOrgDidLast10Set, extractWebrtcInboundRemoteNumber } from "@/lib/telnyxInboundCaller";

export function telnyxUsefulIncomingDisplayName(incomingName: string, incomingNumber: string): string {
  const name = incomingName.trim();
  if (!name) return "";
  if (isTelnyxNameJustTheNumber(name, incomingNumber)) return "";
  return name;
}

function isTelnyxNameJustTheNumber(name: string, number: string): boolean {
  const n = name.trim();
  if (!n) return true;
  const nd = number.replace(/\D/g, "");
  const nn = n.replace(/\D/g, "");
  if (!nd || nn.length < 7) return false;
  return nn === nd || nd.endsWith(nn) || (nn.length >= 10 && nd.endsWith(nn.slice(-10)));
}

/**
 * Shared inbound headline + phone line (Floating Dialer, IncomingCallModal, etc.).
 */
export function useInboundCallerDisplayLines(opts?: { onCall?: boolean }) {
  const onCall = opts?.onCall ?? false;
  const {
    identifiedContact,
    incomingCallerNumber,
    incomingCallerName,
    crmContactName,
    currentCall,
    availableNumbers,
    selectedCallerNumber,
    defaultCallerNumber,
    callState,
    lastCallDirection,
  } = useTelnyx();

  const telnyxUsefulCallerName = useMemo(() => {
    const name = incomingCallerName.trim();
    if (!name) return "";
    if (isTelnyxNameJustTheNumber(name, incomingCallerNumber)) return "";
    return name;
  }, [incomingCallerName, incomingCallerNumber]);

  const inboundExcludeSet = useMemo(
    () => buildOrgDidLast10Set(availableNumbers, defaultCallerNumber, selectedCallerNumber),
    [availableNumbers, defaultCallerNumber, selectedCallerNumber],
  );

  const webrtcInboundRaw = useMemo(() => {
    const inboundUi =
      callState === "incoming" ||
      (onCall && callState === "active" && lastCallDirection === "inbound");
    if (!inboundUi || !currentCall) return "";
    return extractWebrtcInboundRemoteNumber(currentCall, inboundExcludeSet);
  }, [callState, onCall, lastCallDirection, currentCall, inboundExcludeSet]);

  return useMemo(
    () =>
      buildInboundCallerLines({
        identifiedContact,
        incomingCallerNumber,
        webrtcRemoteRaw: webrtcInboundRaw,
        excludeOrgLast10: inboundExcludeSet,
        crmContactName,
        telnyxCallerName: telnyxUsefulCallerName,
      }),
    [
      identifiedContact,
      incomingCallerNumber,
      webrtcInboundRaw,
      inboundExcludeSet,
      crmContactName,
      telnyxUsefulCallerName,
    ],
  );
}
