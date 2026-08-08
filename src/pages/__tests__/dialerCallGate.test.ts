import { describe, it, expect, vi } from "vitest";

import { runGatedCall, runGatedDispatch } from "@/pages/dialerCallGate";

/**
 * These test the ACTUAL helpers DialerPage.handleCall / proceedWithCall / the DNC "Dial Anyway"
 * override run through — not a reimplementation. They prove the ordering guarantee: campaign-session
 * authorization gates BEFORE DNC processing, optimistic stats, and Twilio dispatch, and that the
 * caller-ID and DNC overrides cannot dispatch after a refusal.
 */

function makeSteps(over: Partial<Parameters<typeof runGatedCall>[0]> = {}) {
  return {
    ensureSession: vi.fn(async () => true),
    checkDnc: vi.fn(async () => false),
    onDncBlocked: vi.fn(),
    incrementStats: vi.fn(),
    dispatch: vi.fn(),
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
      dispatch: vi.fn(() => order.push("dispatch")),
    });
    const outcome = await runGatedCall(steps);

    expect(outcome).toBe("dispatched");
    expect(order).toEqual(["session", "dnc", "stats", "dispatch"]);
    expect(steps.onDncBlocked).not.toHaveBeenCalled();
  });

  it("checks the session exactly once (a matching cached session is not re-validated per step)", async () => {
    const steps = makeSteps();
    await runGatedCall(steps);
    expect(steps.ensureSession).toHaveBeenCalledOnce();
  });
});

describe("runGatedDispatch — caller-ID 'Call Anyway' and DNC 'Dial Anyway' overrides", () => {
  it("does NOT dispatch when the session is refused", async () => {
    const dispatch = vi.fn();
    const dispatched = await runGatedDispatch(async () => false, dispatch);

    expect(dispatched).toBe(false);
    expect(dispatch).not.toHaveBeenCalled(); // twilioMakeCall never reached
  });

  it("dispatches when the session is authorized", async () => {
    const dispatch = vi.fn();
    const dispatched = await runGatedDispatch(async () => true, dispatch);

    expect(dispatched).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("awaits an async dispatch closure and never runs it after a refusal", async () => {
    const seen: string[] = [];
    const ok = await runGatedDispatch(async () => { seen.push("gate-true"); return true; }, async () => { seen.push("dispatch"); });
    expect(ok).toBe(true);
    expect(seen).toEqual(["gate-true", "dispatch"]);

    seen.length = 0;
    const no = await runGatedDispatch(async () => { seen.push("gate-false"); return false; }, async () => { seen.push("dispatch"); });
    expect(no).toBe(false);
    expect(seen).toEqual(["gate-false"]); // dispatch closure never ran
  });
});
