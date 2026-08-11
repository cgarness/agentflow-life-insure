/**
 * Outbound-call gating for the Dialer.
 *
 * These are the ACTUAL sequencing helpers `DialerPage` uses — not a test reimplementation — so the
 * ordering guarantee (campaign-session authorization runs BEFORE DNC processing, optimistic stat
 * increments, and any Twilio dispatch) is provable directly. `TwilioContext.makeCall()`, call
 * telemetry, DNC rules, and queue behaviour are all passed in as callbacks; this module decides
 * only the order and the abort points.
 */

export type GatedCallOutcome = "no-session" | "dnc-blocked" | "dispatched";

export interface GatedCallSteps {
  /** Server-authoritative campaign-session gate (DialerPage.ensureCampaignSession). */
  ensureSession: () => Promise<boolean>;
  /** Returns whether the lead is DNC-blocked. Only called once the session is authorized. */
  checkDnc: () => Promise<boolean>;
  /** Handle a DNC block (predictive skip or manual warning). No call is dispatched. */
  onDncBlocked: () => void;
  /** Optimistic local + persisted stat increment. Only reached past DNC. */
  incrementStats: () => void;
  /** The established single-leg Voice.js dispatch (DialerPage.initiateCall). */
  dispatch: () => void;
}

/**
 * Runs the manual/predictive call sequence with hard abort points:
 *   1. ensureSession() — a false result returns "no-session" and NOTHING else runs
 *      (no DNC check, no stat increment, no dispatch).
 *   2. checkDnc() — a block calls onDncBlocked() and returns "dnc-blocked" (no stats, no dispatch).
 *   3. incrementStats() then dispatch() — returns "dispatched".
 */
export async function runGatedCall(steps: GatedCallSteps): Promise<GatedCallOutcome> {
  if (!(await steps.ensureSession())) return "no-session";

  const blocked = await steps.checkDnc();
  if (blocked) {
    steps.onDncBlocked();
    return "dnc-blocked";
  }

  steps.incrementStats();
  steps.dispatch();
  return "dispatched";
}

/**
 * Final-choke-point gate shared by `proceedWithCall` (incl. the caller-ID "Call Anyway" override)
 * and the DNC "Dial Anyway" override: the dispatch closure runs ONLY when the session is authorized.
 * Returns whether the call was dispatched.
 */
export async function runGatedDispatch(
  ensureSession: () => Promise<boolean>,
  dispatch: () => void | Promise<void>,
): Promise<boolean> {
  if (!(await ensureSession())) return false;
  await dispatch();
  return true;
}
