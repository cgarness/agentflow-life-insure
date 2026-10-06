import { describe, it, expect, vi } from "vitest";

import { resolveManualDialDecision, runGatedCall, runGatedDispatch } from "@/pages/dialerCallGate";

/**
 * These test the ACTUAL helpers DialerPage.handleCall / proceedWithCall / caller-ID selection run through — not a reimplementation. They prove the ordering guarantee: campaign-session
 * authorization gates BEFORE DNC processing, optimistic stats, and Twilio dispatch, and that the
 * caller-ID and DNC overrides cannot dispatch after a refusal.
 */

function makeSteps(over: Partial<Parameters<typeof runGatedCall>[0]> = {}) {
  return {
    ensureSession: vi.fn(async () => true),
    checkDnc: vi.fn(async () => false),
    onDncBlocked: vi.fn(),
    incrementStats: vi.fn(),
    dispatch: vi.fn(async () => true),
    ...over,
  };
}

describe("runGatedCall — handleCall sequence", () => {
  it("aborts on a false session BEFORE DNC, stats, and dispatch", async () => {
    const steps = makeSteps({ ensureSession: vi.fn(async () => false) });
    const outcome = await runGatedCall(steps);

    expect(outcome).toBe("no-session");
    expect(steps.checkDnc).not.toHaveBeenCalled();      // no DNC check after refusal
    expect(steps.incrementStats).not.toHaveBeenCalled(); // no optimistic stat increment
    expect(steps.onDncBlocked).not.toHaveBeenCalled();
    expect(steps.dispatch).not.toHaveBeenCalled();       // initiateCall/proceedWithCall/twilioMakeCall never reached
  });

  it("blocks on DNC without incrementing stats or dispatching", async () => {
    const steps = makeSteps({ checkDnc: vi.fn(async () => true) });
    const outcome = await runGatedCall(steps);

    expect(outcome).toBe("dnc-blocked");
    expect(steps.ensureSession).toHaveBeenCalledOnce();
    expect(steps.onDncBlocked).toHaveBeenCalledOnce();
    expect(steps.incrementStats).not.toHaveBeenCalled();
    expect(steps.dispatch).not.toHaveBeenCalled();
  });

  it("on a successful/authorized session, follows the established workflow in order", async () => {
    const order: string[] = [];
    const steps = makeSteps({
      ensureSession: vi.fn(async () => { order.push("session"); return true; }),
      checkDnc: vi.fn(async () => { order.push("dnc"); return false; }),
      incrementStats: vi.fn(() => order.push("stats")),
      dispatch: vi.fn(async () => { order.push("dispatch"); return true; }),
    });
    const outcome = await runGatedCall(steps);

    expect(outcome).toBe("dispatched");
    expect(order).toEqual(["session", "dnc", "dispatch", "stats"]);
    expect(steps.onDncBlocked).not.toHaveBeenCalled();
  });

  it("checks the session exactly once (a matching cached session is not re-validated per step)", async () => {
    const steps = makeSteps();
    await runGatedCall(steps);
    expect(steps.ensureSession).toHaveBeenCalledOnce();
  });
});

describe("runGatedDispatch — caller-ID selection", () => {
  it("does NOT dispatch when the session is refused", async () => {
    const dispatch = vi.fn(async () => true);
    const dispatched = await runGatedDispatch(async () => false, dispatch);

    expect(dispatched).toBe(false);
    expect(dispatch).not.toHaveBeenCalled(); // twilioMakeCall never reached
  });

  it("dispatches when the session is authorized", async () => {
    const dispatch = vi.fn(async () => true);
    const dispatched = await runGatedDispatch(async () => true, dispatch);

    expect(dispatched).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("awaits an async dispatch closure and never runs it after a refusal", async () => {
    const seen: string[] = [];
    const ok = await runGatedDispatch(async () => { seen.push("gate-true"); return true; }, async () => { seen.push("dispatch"); return true; });
    expect(ok).toBe(true);
    expect(seen).toEqual(["gate-true", "dispatch"]);

    seen.length = 0;
    const no = await runGatedDispatch(async () => { seen.push("gate-false"); return false; }, async () => { seen.push("dispatch"); return true; });
    expect(no).toBe(false);
    expect(seen).toEqual(["gate-false"]); // dispatch closure never ran
  });
});


describe("fail-closed final verification", () => {
  it("does not dispatch or count when DNC verification fails", async () => {
    const error = new Error("database unavailable");
    const steps = makeSteps({ checkDnc: vi.fn(async () => { throw error; }), onVerificationFailed: vi.fn() });
    expect(await runGatedCall(steps)).toBe("verification-failed");
    expect(steps.dispatch).not.toHaveBeenCalled();
    expect(steps.incrementStats).not.toHaveBeenCalled();
    expect(steps.onVerificationFailed).toHaveBeenCalledWith(error);
  });
  it("does not count a call refused at the actual Twilio boundary", async () => {
    const steps = makeSteps({ dispatch: vi.fn(async () => false) });
    expect(await runGatedCall(steps)).toBe("not-started");
    expect(steps.incrementStats).not.toHaveBeenCalled();
  });
});


describe("resolveManualDialDecision — intentional repeat calls", () => {
  const base = {
    intent: "manual" as const,
    callState: "idle",
    dispositionSavePending: false,
    pendingAdvanceForCurrentLead: false,
    hasCurrentCall: false,
    showWrapUp: false,
    hasDraft: false,
  };

  it("allows a fresh manual dial", () => {
    expect(resolveManualDialDecision(base)).toBe("dial");
  });

  it("allows a manual repeat call after the previous call ended", () => {
    expect(resolveManualDialDecision({
      ...base,
      callState: "ended",
      hasCurrentCall: true,
      showWrapUp: true,
    })).toBe("redial");
  });

  it("does not let auto-dial consume an existing call/wrap-up state", () => {
    expect(resolveManualDialDecision({
      ...base,
      intent: "auto",
      hasCurrentCall: true,
    })).toBe("blocked-wrap-up");
  });

  it("still blocks while a call is actually active or starting", () => {
    expect(resolveManualDialDecision({ ...base, callState: "dialing" })).toBe("blocked-active");
    expect(resolveManualDialDecision({ ...base, callState: "active" })).toBe("blocked-active");
    expect(resolveManualDialDecision({ ...base, callState: "incoming" })).toBe("blocked-active");
  });

  it("still blocks while the previous disposition/advance is being persisted", () => {
    expect(resolveManualDialDecision({ ...base, dispositionSavePending: true })).toBe("blocked-persisting");
    expect(resolveManualDialDecision({ ...base, pendingAdvanceForCurrentLead: true })).toBe("blocked-persisting");
  });

  it("protects an unsaved disposition or notes draft from being discarded by a redial", () => {
    expect(resolveManualDialDecision({
      ...base,
      hasCurrentCall: true,
      hasDraft: true,
    })).toBe("blocked-draft");
  });
});
