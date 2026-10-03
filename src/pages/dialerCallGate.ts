/** Ordering helpers used by the actual Dialer dispatch path. */
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
