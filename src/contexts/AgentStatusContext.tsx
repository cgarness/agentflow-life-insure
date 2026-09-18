import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTwilio } from "@/contexts/TwilioContext";
import { supabase } from "@/integrations/supabase/client";
import {
  MANUAL_AVAILABILITY,
  ROUTING_ENGINE_EVENT,
  describeAvailabilityEffect,
  deriveEffectiveAvailability,
  normalizeStoredAvailability,
  readAnnouncedEngine,
  type ManualAvailability,
  type RoutingEngine,
  type StoredAvailability,
} from "@/lib/agentAvailability";

/**
 * Inbound Calling v2 — availability (implementation_plan.md rev 3 §6.3; D1, D11, P14, invariant #31;
 * corrective pass defect 6).
 *
 * The three MANUAL states (Available / On Break / Do Not Disturb) are persisted on the REAL operator's
 * `profiles.availability_status` through `updateProfile` — never the "View As" profile. The STORED value is
 * shown truthfully: a stored `Offline` is not mapped to Available, because the v2 engine treats it as "not
 * connected" (browser skipped, D3 mobile). "On a Call" / "Offline (phone disconnected)" are derived and never
 * written. The organization's routing engine is read so the UI says whether availability is actually
 * enforced (v2) or PENDING ACTIVATION (legacy ignores it). Under "View As" changes are hidden.
 */
interface AgentStatusContextType {
  /** Stored value on the real profile (the routing engine's input). */
  stored: StoredAvailability;
  /** The manual choice currently selected (a stored Offline selects nothing). */
  manual: ManualAvailability | null;
  /** What the operator sees: manual, or a derived "On a Call" / "Offline (…)". */
  effectiveLabel: string;
  phoneConnected: boolean;
  onCall: boolean;
  saving: boolean;
  canChange: boolean;
  /** The organization's active routing engine ("unknown" until read). */
  engine: RoutingEngine;
  /** true while the active engine does not enforce availability (legacy or unknown). */
  activationPending: boolean;
  /** One sentence describing what the active engine does with the stored value. */
  routingEffect: string;
  setAvailability: (next: ManualAvailability) => Promise<void>;
  /** Re-reads the organization's routing engine (bounded retries). */
  refreshEngine: () => Promise<void>;
}

const AgentStatusContext = createContext<AgentStatusContextType>({
  stored: "Available",
  manual: "Available",
  effectiveLabel: "Available",
  phoneConnected: false,
  onCall: false,
  saving: false,
  canChange: false,
  engine: "unknown",
  activationPending: true,
  routingEffect: "",
  setAvailability: async () => {},
  refreshEngine: async () => {},
});

export const useAgentStatus = () => useContext(AgentStatusContext);

export const AgentStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { realProfile, updateProfile, isImpersonating } = useAuth();
  const { status, callState } = useTwilio();
  const [saving, setSaving] = useState(false);
  const [engine, setEngine] = useState<RoutingEngine>("unknown");
  const orgId = realProfile?.organization_id ?? null;

  // The engine read is bounded (3 attempts) and a persistent failure is "unknown" — never silently
  // "legacy" or "v2". The administrator card announces every engine change it learns of, so the
  // availability surfaces follow an activation / rollback made in the same session.
  const engineLoadSeq = useRef(0);
  const loadEngine = useCallback(async (attempts = 3) => {
    const seq = ++engineLoadSeq.current;
    if (!orgId) { setEngine("unknown"); return; }
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let failure: string | null = null;
      try {
        const { data, error } = await supabase
          .from("inbound_routing_settings")
          .select("routing_engine")
          .eq("organization_id", orgId)
          .maybeSingle();
        if (seq !== engineLoadSeq.current) return;      // superseded by a newer load / org change
        if (!error) {
          setEngine(data?.routing_engine === "v2" ? "v2" : "legacy");   // no row ⇒ not configured ⇒ legacy
          return;
        }
        failure = error.message;
      } catch (e) {
        if (seq !== engineLoadSeq.current) return;
        failure = e instanceof Error ? e.message : String(e);
      }
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt));
      else console.warn("[AgentStatusContext] routing engine unavailable after retries:", failure);
    }
    if (seq === engineLoadSeq.current) setEngine("unknown");
  }, [orgId]);

  useEffect(() => { void loadEngine(); }, [loadEngine]);

  useEffect(() => {
    const onAnnounced = (event: Event) => {
      const announced = readAnnouncedEngine(event);
      if (announced && announced !== "unknown") { engineLoadSeq.current += 1; setEngine(announced); }
      else void loadEngine();
    };
    window.addEventListener(ROUTING_ENGINE_EVENT, onAnnounced);
    return () => window.removeEventListener(ROUTING_ENGINE_EVENT, onAnnounced);
  }, [loadEngine]);

  const stored = normalizeStoredAvailability(realProfile?.availability_status);
  const manual: ManualAvailability | null = (MANUAL_AVAILABILITY as readonly string[]).includes(stored) ? (stored as ManualAvailability) : null;
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

  const value = useMemo<AgentStatusContextType>(() => {
    const effect = describeAvailabilityEffect({ stored, engine });
    return {
      stored,
      manual,
      effectiveLabel: deriveEffectiveAvailability({ stored, phoneConnected, onCall }),
      phoneConnected,
      onCall,
      saving,
      canChange: !isImpersonating && !!realProfile,
      engine,
      activationPending: effect.activationPending,
      routingEffect: effect.routing,
      setAvailability,
      refreshEngine: () => loadEngine(),
    };
  }, [stored, manual, phoneConnected, onCall, saving, isImpersonating, realProfile, engine, setAvailability, loadEngine]);

  return <AgentStatusContext.Provider value={value}>{children}</AgentStatusContext.Provider>;
};
