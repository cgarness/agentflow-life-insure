import { useEffect, useRef, useCallback, useState } from "react";

/**
 * useDialerStateMachine — Two-Lane Auto-Dialer State Machine
 *
 * Auto-dial waits dialDelayMs then calls onCall. Callbacks and guards use refs so
 * dependency churn (handleCall identity from dialerStats, etc.) does not reset the timer
 * or leave stale timeouts firing for the wrong lead.
 */

type CallState = "idle" | "dialing" | "incoming" | "active" | "ended";
type TelnyxStatus = "idle" | "connecting" | "ready" | "error";

export type MachineState =
  | "IDLE"
  | "DIALING"
  | "RINGING"
  | "CONNECTED"
  | "WRAP_UP"
  | "FAST_DISPOSE"
  | "DELIBERATE_DISPOSE";

export type FastDisposeReason = "ring_timeout" | "no_answer";

function useLatestRef<T>(value: T) {
  const r = useRef(value);
  r.current = value;
  return r;
}

export interface UseDialerStateMachineProps {
  isAutoDialEnabled: boolean;
  telnyxCallState: CallState;
  telnyxStatus: TelnyxStatus;
  currentLead: any | null;
  hasDialedOnce: React.MutableRefObject<boolean>;
  showWrapUp: boolean;
  checkCallingHours?: (leadState: string) => boolean;
  /** Blocks arming auto-dial while queue/index/URL are settling */
  isAdvancing?: boolean;
  /** Pause before auto-dial fires (from campaign `dial_delay_seconds`, clamped in the hook). */
  dialDelayMs?: number;
  onCall: () => void;
  onSkip: () => void;
}

export interface UseDialerStateMachineReturn {
  machineState: MachineState;
  autoDialCountdownActive: boolean;
  cancelAutoDialCountdown: () => void;
}

const DEFAULT_DIAL_DELAY_MS = 2000;
const MIN_DIAL_DELAY_MS = 500;
const MAX_DIAL_DELAY_MS = 10_000;

export function useDialerStateMachine({
  isAutoDialEnabled,
  telnyxCallState,
  telnyxStatus,
  currentLead,
  hasDialedOnce,
  showWrapUp,
  checkCallingHours,
  isAdvancing = false,
  dialDelayMs: dialDelayMsProp,
  onCall,
  onSkip,
}: UseDialerStateMachineProps): UseDialerStateMachineReturn {
  const dialDelayMs = Math.min(
    MAX_DIAL_DELAY_MS,
    Math.max(MIN_DIAL_DELAY_MS, dialDelayMsProp ?? DEFAULT_DIAL_DELAY_MS),
  );
  const machineState: MachineState = (() => {
    if (showWrapUp) return "WRAP_UP";
    if (telnyxCallState === "active") return "CONNECTED";
    if (telnyxCallState === "incoming") return "CONNECTED";
    if (telnyxCallState === "dialing") return "DIALING";
    if (telnyxCallState === "ended") return "WRAP_UP";
    return "IDLE";
  })();

  const onCallRef = useLatestRef(onCall);
  const onSkipRef = useLatestRef(onSkip);
  const checkHoursRef = useLatestRef(checkCallingHours);
  const currentLeadRef = useLatestRef(currentLead);

  const lastAutoDialedLeadId = useRef<string | null>(null);
  const autoDialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Which lead key the pending timeout is dialing — must match at fire time */
  const scheduledForLeadKeyRef = useRef<string | null>(null);

  const [autoDialCountdownActive, setAutoDialCountdownActive] = useState(false);

  const clearAutoDialTimer = useCallback(() => {
    if (autoDialTimerRef.current) {
      clearTimeout(autoDialTimerRef.current);
      autoDialTimerRef.current = null;
    }
    scheduledForLeadKeyRef.current = null;
    setAutoDialCountdownActive(false);
  }, []);

  const cancelAutoDialCountdown = useCallback(() => {
    clearAutoDialTimer();
    const lead = currentLeadRef.current;
    const k = lead ? String(lead.id || lead.lead_id || "") : "";
    if (k) lastAutoDialedLeadId.current = k;
  }, [clearAutoDialTimer]);

  const leadKey = currentLead ? String(currentLead.id || currentLead.lead_id || "") : "";

  const guardsRef = useRef({
    isAutoDialEnabled,
    telnyxCallState,
    telnyxStatus,
    showWrapUp,
    isAdvancing,
    leadKey,
  });
  guardsRef.current = {
    isAutoDialEnabled,
    telnyxCallState,
    telnyxStatus,
    showWrapUp,
    isAdvancing,
    leadKey,
  };

  useEffect(() => {
    return () => {
      clearAutoDialTimer();
    };
  }, [clearAutoDialTimer]);

  useEffect(() => {
    if (!hasDialedOnce.current) return;

    if (
      !isAutoDialEnabled ||
      !leadKey ||
      telnyxCallState !== "idle" ||
      telnyxStatus !== "ready" ||
      showWrapUp ||
      isAdvancing
    ) {
      clearAutoDialTimer();
      return;
    }

    const lead = currentLeadRef.current;
    if (!lead) return;

    if (lastAutoDialedLeadId.current === leadKey) {
      return;
    }

    if (checkHoursRef.current) {
      const leadState = lead.state || "";
      if (!checkHoursRef.current(leadState)) {
        onSkipRef.current();
        return;
      }
    }

    if (autoDialTimerRef.current && scheduledForLeadKeyRef.current === leadKey) {
      return;
    }

    if (autoDialTimerRef.current) {
      clearAutoDialTimer();
    }

    scheduledForLeadKeyRef.current = leadKey;
    setAutoDialCountdownActive(true);

    const fireKey = leadKey;

    autoDialTimerRef.current = setTimeout(() => {
      autoDialTimerRef.current = null;
      scheduledForLeadKeyRef.current = null;
      setAutoDialCountdownActive(false);

      const g = guardsRef.current;
      if (g.leadKey !== fireKey) return;

      if (
        !g.isAutoDialEnabled ||
        g.telnyxCallState !== "idle" ||
        g.telnyxStatus !== "ready" ||
        g.showWrapUp ||
        g.isAdvancing
      ) {
        return;
      }

      lastAutoDialedLeadId.current = fireKey;
      onCallRef.current();
    }, dialDelayMs);
  }, [
    leadKey,
    isAutoDialEnabled,
    telnyxCallState,
    telnyxStatus,
    showWrapUp,
    isAdvancing,
    dialDelayMs,
    clearAutoDialTimer,
  ]);

  return { machineState, autoDialCountdownActive, cancelAutoDialCountdown };
}
