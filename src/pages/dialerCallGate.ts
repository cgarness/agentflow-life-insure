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
export type GatedCallOutcome = "no-session" | "dnc-blocked" | "verification-failed" | "not-started" | "dispatched" | "stale";
export interface GatedCallSteps {
  isCurrent?: () => boolean;
  ensureSession: () => Promise<boolean>;
  checkDnc: () => Promise<boolean>;
  onDncBlocked: () => void;
  onVerificationFailed?: (error: unknown) => void;
  incrementStats: () => void;
  dispatch: () => Promise<boolean>;
}
export async function runGatedCall(steps: GatedCallSteps): Promise<GatedCallOutcome> {
  const current = () => steps.isCurrent?.() !== false;
  try {
    if (!current()) return "stale";
    if (!(await steps.ensureSession())) return "no-session";
    if (!current()) return "stale";
    const blocked = await steps.checkDnc();
    if (!current()) return "stale";
    if (blocked) { steps.onDncBlocked(); return "dnc-blocked"; }
    if (!(await steps.dispatch())) return "not-started";
    if (!current()) return "stale";
    steps.incrementStats();
    return "dispatched";
  } catch (error) {
    if (current()) steps.onVerificationFailed?.(error);
    return "verification-failed";
  }
}
export async function runGatedDispatch(
  ensureSession: () => Promise<boolean>,
  dispatch: () => Promise<boolean>,
): Promise<boolean> {
  if (!(await ensureSession())) return false;
  return dispatch();
}

export function callBlockReason(input: ManualDialGateInput & {
  ready: boolean; hasLead: boolean; busy: boolean; readinessError?: string | null; eligibilityError?: string | null;
}): string | null {
  if (!input.hasLead) return "Select a lead to call.";
  if (input.busy) return "Please wait for the current action to finish.";
  if (input.eligibilityError) return input.eligibilityError;
  const decision = resolveManualDialDecision(input);
  if (decision === "blocked-active") return "Finish the current call first.";
  if (decision === "blocked-persisting") return "The previous outcome is still saving.";
  if (decision === "blocked-draft") return "Save the current outcome before calling again.";
  if (decision === "blocked-wrap-up") return "Complete the current outcome before Auto Dial resumes.";
  if (!input.ready) return input.readinessError || "Phone is connecting. Wait for Ready before calling.";
  return null;
}
