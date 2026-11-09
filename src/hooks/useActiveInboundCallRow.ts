import { useEffect, useRef } from "react";
import { useTwilio } from "@/contexts/TwilioContext";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { extractAfCallRowId } from "@/lib/inboundCallOwnership";
import { endTrackedCall, recordActiveInboundCall, setTrackedCallIdentity } from "@/lib/recentTrackedCall";

/**
 * Records the active inbound call's server-issued row id for the sale source-call chip (Reports V2 PKG-C, IN-A).
 * Reads only public useTwilio() values; it writes nothing to TwilioContext or to any calls row and never touches call
 * initiation, audio or the re-entrancy guards. The store is scoped to the signed-in user and organization.
 */
export function useActiveInboundCallRow() {
  const { currentCall, callState, lastCallDirection, identifiedContact, incomingCallerName, incomingCallerNumber } = useTwilio();
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const userId = user?.id ?? null;
  const orgId = organizationId ?? null;
  const tracked = useRef<string | null>(null);

  useEffect(() => { setTrackedCallIdentity(userId, orgId); }, [userId, orgId]);

  const rowId = callState === "active" && lastCallDirection === "inbound"
    ? extractAfCallRowId(currentCall?.customParameters ?? null) : null;
  const label = identifiedContact?.name || incomingCallerName || incomingCallerNumber || null;

  useEffect(() => {
    if (rowId) {
      if (tracked.current && tracked.current !== rowId) endTrackedCall(tracked.current);
      recordActiveInboundCall(rowId, label);
      tracked.current = rowId;
    } else if (tracked.current) {
      endTrackedCall(tracked.current);
      tracked.current = null;
    }
  }, [rowId, label]);
}
