/** Ordering helpers used by the actual Dialer dispatch path. */

export type DialIntent = "manual" | "auto";
export type ManualDialDecision =
  | "dial"
  | "redial"
  | "blocked-active"
  | "blocked-persisting"
  | "blocked-draft"
  | "blocked-wrap-up";

export interface ManualDialGateInput {
  intent: DialIntent;
  callState: string;
  dispositionSavePending: boolean;
  pendingAdvanceForCurrentLead: boolean;
  hasCurrentCall: boolean;
  showWrapUp: boolean;
  hasDraft: boolean;
}

/**
 * Manual repeat calls are allowed after the previous Voice.js call has ended.
 * Auto-dial is deliberately stricter: it never consumes an existing call/wrap-up
 * state, which prevents the historic rapid-redial loop.
 */
export function resolveManualDialDecision(input: ManualDialGateInput): ManualDialDecision {
  if (input.callState === "dialing" || input.callState === "active" || input.callState === "incoming") {
    return "blocked-active";
  }
  if (input.dispositionSavePending || input.pendingAdvanceForCurrentLead) {
    return "blocked-persisting";
  }
  if (input.hasCurrentCall || input.showWrapUp) {
    if (input.intent === "auto") return "blocked-wrap-up";
    if (input.hasDraft) return "blocked-draft";
    return "redial";
  }
  return "dial";
}
export type GatedCallOutcome = "no-session" | "dnc-blocked" | "verification-failed" | "not-started" | "dispatched";
export interface GatedCallSteps {
  ensureSession: () => Promise<boolean>;
  checkDnc: () => Promise<boolean>;
  onDncBlocked: () => void;
  onVerificationFailed?: (error: unknown) => void;
  incrementStats: () => void;
  dispatch: () => Promise<boolean>;
}
export async function runGatedCall(steps: GatedCallSteps): Promise<GatedCallOutcome> {
  if (!(await steps.ensureSession())) return "no-session";
  try {
    if (await steps.checkDnc()) {
      steps.onDncBlocked();
      return "dnc-blocked";
    }
  } catch (error) {
    steps.onVerificationFailed?.(error);
    return "verification-failed";
  }
  if (!(await steps.dispatch())) return "not-started";
  steps.incrementStats();
  return "dispatched";
}
export async function runGatedDispatch(
  ensureSession: () => Promise<boolean>,
  dispatch: () => Promise<boolean>,
): Promise<boolean> {
  if (!(await ensureSession())) return false;
  return dispatch();
}
