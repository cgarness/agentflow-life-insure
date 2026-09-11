import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTwilio } from "@/contexts/TwilioContext";
import { deriveEffectiveAvailability, MANUAL_AVAILABILITY, type ManualAvailability } from "@/lib/agentAvailability";

/**
 * Inbound Calling v2 — availability (implementation_plan.md rev 3 §6.3; D1, D11, P14, invariant #31).
 *
 * The three MANUAL states (Available / On Break / Do Not Disturb) are persisted on the REAL operator's
 * `profiles.availability_status` through `updateProfile` — never the "View As" profile. "On a Call" and
 * "Offline" are DERIVED here from the Twilio Device (call state / registration) and are never written:
 * the server decides "connected" from presence registrations (§6.2), and On Break / DND bypass the
 * browser AND the mobile (D11) purely from the stored manual value. Under "View As" changes are hidden.
 */
interface AgentStatusContextType {
  /** Stored manual value (the source of truth for D11). */
  manual: ManualAvailability;
  /** What the operator sees: manual, or a derived "On a Call" / "Offline (phone disconnected)". */
  effectiveLabel: string;
  phoneConnected: boolean;
  onCall: boolean;
  saving: boolean;
  canChange: boolean;
  setAvailability: (next: ManualAvailability) => Promise<void>;
}

const AgentStatusContext = createContext<AgentStatusContextType>({
  manual: "Available",
  effectiveLabel: "Available",
  phoneConnected: false,
  onCall: false,
  saving: false,
  canChange: false,
  setAvailability: async () => {},
});

export const useAgentStatus = () => useContext(AgentStatusContext);

export const AgentStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { realProfile, updateProfile, isImpersonating } = useAuth();
  const { status, callState } = useTwilio();
  const [saving, setSaving] = useState(false);

  const stored = realProfile?.availability_status ?? "Available";
  const manual: ManualAvailability = (MANUAL_AVAILABILITY as readonly string[]).includes(stored)
    ? (stored as ManualAvailability)
    : "Available";
  const phoneConnected = status === "ready";
  const onCall = callState === "incoming" || callState === "active" || callState === "dialing";

  const setAvailability = useCallback(async (next: ManualAvailability) => {
    if (isImpersonating || !realProfile) return;
    setSaving(true);
    try {
      await updateProfile({ availability_status: next });
    } finally {
      setSaving(false);
    }
  }, [isImpersonating, realProfile, updateProfile]);

  const value = useMemo<AgentStatusContextType>(() => ({
    manual,
    effectiveLabel: deriveEffectiveAvailability({ manual, phoneConnected, onCall }),
    phoneConnected,
    onCall,
    saving,
    canChange: !isImpersonating && !!realProfile,
    setAvailability,
  }), [manual, phoneConnected, onCall, saving, isImpersonating, realProfile, setAvailability]);

  return <AgentStatusContext.Provider value={value}>{children}</AgentStatusContext.Provider>;
};
