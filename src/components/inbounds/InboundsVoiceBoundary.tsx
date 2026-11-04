import { useEffect, type ReactNode } from "react";
import { TwilioProvider } from "@/contexts/TwilioContext";
import { INBOUNDS_ENABLED } from "@/lib/inbounds/contracts";
// Room is deliberately a separate document, so it cannot register the CRM Device identity.
const ROOM_DOCUMENT =
  INBOUNDS_ENABLED &&
  window.location.pathname.replace(/\/+$/, "") === "/inbounds";
export function InboundsVoiceBoundary({ children }: { children: ReactNode }) {
  return ROOM_DOCUMENT ? (
    <>{children}</>
  ) : (
    <TwilioProvider>{children}</TwilioProvider>
  );
}
export function InboundsDocument({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (INBOUNDS_ENABLED && !ROOM_DOCUMENT) window.location.assign("/inbounds");
  }, []);
  return INBOUNDS_ENABLED && !ROOM_DOCUMENT ? null : <>{children}</>;
}
