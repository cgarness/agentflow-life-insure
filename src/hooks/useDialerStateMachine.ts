import { useEffect, useRef, useCallback } from 'react';

/**
 * useDialerStateMachine — Two-Lane Auto-Dialer State Machine
 *
 * Separates auto-dialer logic into two distinct paths:
 *
 * **Fast Path** (zero-click): Triggered by ring timeout, AMD machine detection,
 * or explicit "No Answer" click. Auto-logs the disposition and advances.
 *
 * **Deliberate Path** (manual): Triggered after a connected call ends.
 * Agent must disposition via Save & Next before the next call fires.
 *
 * State Transitions:
 *   IDLE → DIALING → RINGING → CONNECTED → WRAP_UP → IDLE
 *                       ↓                        ↓
 *                  FAST_DISPOSE            DELIBERATE_DISPOSE
 *                       ↓                        ↓
 *                     IDLE ←──────────────────  IDLE
 */

type CallState = 'idle' | 'dialing' | 'active' | 'ended';
type TelnyxStatus = 'idle' | 'connecting' | 'ready' | 'error';

export type MachineState =
  | 'IDLE'
  | 'DIALING'
  | 'RINGING'
  | 'CONNECTED'
  | 'WRAP_UP'
  | 'FAST_DISPOSE'
  | 'DELIBERATE_DISPOSE';

export type FastDisposeReason = 'ring_timeout' | 'amd_machine' | 'no_answer';

export interface UseDialerStateMachineProps {
  /** Whether auto-dial toggle is ON */
  isAutoDialEnabled: boolean;
  /** Telnyx call state from context */
  telnyxCallState: CallState;
  /** Telnyx connection status from context */
  telnyxStatus: TelnyxStatus;
  /** Current lead being viewed/called */
  currentLead: any | null;
  /** Ref that tracks whether the agent has dialed at least once this session */
  hasDialedOnce: React.MutableRefObject<boolean>;
  /** Whether the wrap-up panel is currently showing */
  showWrapUp: boolean;
  /** Calling hours checker from AutoDialer instance */
  checkCallingHours?: (leadState: string) => boolean;
  /** Whether the dialer is currently transitioning between leads */
  isAdvancing?: boolean;

  // ── Callbacks ──
  /** Initiate a call to the current lead */
  onCall: () => void;
  /** Skip the current lead (calling hours violation, etc.) */
  onSkip: () => void;
}

export interface UseDialerStateMachineReturn {
  /** Current machine state (derived, not stored — uses Telnyx state as source of truth) */
  machineState: MachineState;
}

/**
 * AUTO_DIAL_DELAY_MS — time between disposition commit and next call initiation.
 * 2 seconds gives the UI time to update and the agent a beat to orient.
 */
const AUTO_DIAL_DELAY_MS = 3000;

export function useDialerStateMachine({
  isAutoDialEnabled,
  telnyxCallState,
  telnyxStatus,
  currentLead,
  hasDialedOnce,
  showWrapUp,
  checkCallingHours,
  isAdvancing,
  onCall,
  onSkip,
}: UseDialerStateMachineProps): UseDialerStateMachineReturn {

  // ── Derive machine state from Telnyx context ──
  // This avoids maintaining separate state that can drift from the source of truth.
  const machineState: MachineState = (() => {
    if (showWrapUp) return 'WRAP_UP';
    if (telnyxCallState === 'active') return 'CONNECTED';
    if (telnyxCallState === 'dialing') return 'DIALING';
    if (telnyxCallState === 'ended') return 'WRAP_UP';
    return 'IDLE';
  })();

  // ── Guard ref to prevent double-firing within the same lead ──
  const lastAutoDialedLeadId = useRef<string | null>(null);
  const autoDialTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (autoDialTimerRef.current) {
        clearTimeout(autoDialTimerRef.current);
        autoDialTimerRef.current = null;
      }
    };
  }, []);

  // ── Reactive Auto-Dial Trigger ──
  // This replaces the scattered useEffect in DialerPage (lines 1572-1634).
  // It fires ONLY when all preconditions are met:
  //   1. Auto-dial is enabled
  //   2. Telnyx is ready + idle
  //   3. We have a current lead
  //   4. Agent has dialed at least once this session (hasDialedOnce guard)
  //   5. Wrap-up is NOT open
  //   6. We haven't already auto-dialed this lead
  useEffect(() => {
    // ── Guard: must press Call at least once before auto-dial fires ──
    if (!hasDialedOnce.current) return;

    // ── Guard: all preconditions ──
    if (
      !isAutoDialEnabled ||
      !currentLead ||
      telnyxCallState !== 'idle' ||
      telnyxStatus !== 'ready' ||
      showWrapUp ||
      isAdvancing
    ) {
      if (autoDialTimerRef.current) {
        console.log('[StateMachine] Auto-dial preconditions lost, clearing timer.');
        clearTimeout(autoDialTimerRef.current);
        autoDialTimerRef.current = null;
      }
      return;
    }

    const leadId = currentLead.id || currentLead.lead_id;

    // ── Guard: don't re-dial the same lead ──
    if (lastAutoDialedLeadId.current === leadId) {
      return;
    }

    // If we already have a timer running for THIS lead, let it ride.
    // This prevents re-renders from pushing the 2s delay infinitely.
    if (autoDialTimerRef.current) {
      return;
    }

    // ── Calling hours compliance (auto-dial only) ──
    if (checkCallingHours) {
      const leadState = currentLead.state || '';
      if (!checkCallingHours(leadState)) {
        const displayState = leadState || 'this state';
        console.log(`[StateMachine] Outside calling hours for ${displayState} — skipping.`);
        onSkip();
        return;
      }
    }

    console.log(`[StateMachine] Auto-dial trigger: waiting ${AUTO_DIAL_DELAY_MS}ms before calling ${currentLead.first_name || 'lead'}...`);

    autoDialTimerRef.current = setTimeout(() => {
      // ── Double-check guards after delay ──
      if (
        !isAutoDialEnabled ||
        telnyxCallState !== 'idle' ||
        telnyxStatus !== 'ready' ||
        showWrapUp
      ) {
        console.log('[StateMachine] Post-delay guard check failed, aborting auto-dial.');
        autoDialTimerRef.current = null;
        return;
      }

      console.log(`[StateMachine] ${AUTO_DIAL_DELAY_MS}ms delay complete. Initiating call.`);
      lastAutoDialedLeadId.current = leadId;
      autoDialTimerRef.current = null;
      onCall();
    }, AUTO_DIAL_DELAY_MS);

    return () => {
      // We explicitly DO NOT clear the timer on minor dependency changes (like showWrapUp flickering)
      // unless we transitioning to a new lead or disabling auto-dial.
    };
  }, [
    currentLead?.id,
    currentLead?.lead_id,
    isAutoDialEnabled,
    telnyxStatus,
    telnyxCallState,
    showWrapUp,
    checkCallingHours,
    onCall,
    onSkip,
    hasDialedOnce,
    isAdvancing,
  ]);

  // (Lead change reset removed to prevent race conditions during auto-advance)

  return { machineState };
}
