// Corrective pass, defect 2 — the ONE Device lifecycle coordinator, tested BEHAVIORALLY with a fake
// SDK wrapper whose init/destroy promises are resolved by hand (delayed token responses, overlapping
// initialization, logout, identity change, recovery deferred until idle).
import { describe, expect, it } from "vitest";
import {
  DeviceLifecycle,
  LIFECYCLE_RECOVERY_DELAY_MS,
  LIFECYCLE_RECOVERY_MAX_ATTEMPTS,
  type LifecycleHandlers,
} from "@/lib/deviceLifecycle";

type Dev = { id: number; destroyed: boolean };

function harness() {
  let nextId = 1;
  const inits: Array<{ handlers: LifecycleHandlers<Dev>; isLive: () => boolean; resolve: (d: Dev) => void; reject: (e: Error) => void; device: Dev }> = [];
  const destroys: number[] = [];
  const retired: number[] = [];
  const timers: Array<{ fn: () => void; ms: number; id: number }> = [];
  let timerId = 0;
  let now = 100_000;
  const state = { live: false };
  const events = { ready: [] as number[], notReady: [] as string[], errors: [] as string[], deviceChange: [] as number[], deferred: [] as string[] };
  const lifecycle = new DeviceLifecycle<Dev>(
    {
      init: (handlers, isLive) =>
        new Promise<Dev>((resolve, reject) => {
          const device: Dev = { id: nextId++, destroyed: false };
          inits.push({ handlers, isLive, resolve, reject, device });
        }),
      destroy: async () => { destroys.push(now); },
      retire: (d) => { d.destroyed = true; retired.push(d.id); },
      isCallLive: () => state.live,
      now: () => now,
      setTimeout: (fn, ms) => { const id = ++timerId; timers.push({ fn, ms, id }); return id; },
      clearTimeout: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); },
    },
    {
      onReady: (d) => events.ready.push(d.id),
      onNotReady: (r) => events.notReady.push(r),
      onError: (e) => events.errors.push(e.message),
      onDeviceChange: (d) => events.deviceChange.push(d.id),
      onDeferred: (r) => events.deferred.push(r),
    },
  );
  /** Emulates the SDK: `registered` fires BEFORE register() resolves. */
  const completeInit = async (i: number) => {
    const it = inits[i];
    it.handlers.onRegistered(it.device);
    it.resolve(it.device);
    await flush();
  };
  const fireTimers = async () => { const due = timers.splice(0); for (const t of due) t.fn(); await flush(); };
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  return { lifecycle, inits, destroys, retired, timers, events, state, completeInit, fireTimers, flush, advance: (ms: number) => { now += ms; } };
}

const ID = "user-1:org-1";

describe("L1 — cold start and overlapping requests", () => {
  it("first request starts ONE init; an overlapping request joins it; ready is reported once the SDK registers", async () => {
    const h = harness();
    expect(await h.lifecycle.requestInit(ID, "eager")).toBe("started");
    expect(await h.lifecycle.requestInit(ID, "dialer_open")).toBe("in_flight");
    expect(h.inits).toHaveLength(1);
    expect(h.lifecycle.isReady()).toBe(false);
    await h.completeInit(0);
    expect(h.lifecycle.isReady()).toBe(true);
    expect(h.events.ready).toEqual([1]);
    expect(await h.lifecycle.requestInit(ID, "again")).toBe("already_ready");
    expect(h.inits).toHaveLength(1);
  });

  it("no identity ⇒ nothing starts", async () => {
    const h = harness();
    expect(await h.lifecycle.requestInit(null, "eager")).toBe("no_identity");
    expect(h.inits).toHaveLength(0);
  });
});

describe("L2 — logout while a token response is still pending (delayed init)", () => {
  it("teardown invalidates the pending init: the late Device is retired and never reported ready", async () => {
    const h = harness();
    await h.lifecycle.requestInit(ID, "eager");
    expect(h.inits).toHaveLength(1);
    await h.lifecycle.teardown("logout");                 // token still pending
    expect(h.destroys).toHaveLength(1);
    expect(h.events.notReady).toEqual(["teardown"]);
    await h.completeInit(0);                              // the old init finally registers
    expect(h.lifecycle.isReady()).toBe(false);
    expect(h.events.ready).toEqual([]);
    expect(h.retired).toEqual([1, 1]);                    // retired at the registered callback AND at resolution
    expect(h.lifecycle.currentDevice()).toBeNull();
  });

  it("a stale rejection after teardown is silent (no error surfaced for a Device nobody owns)", async () => {
    const h = harness();
    await h.lifecycle.requestInit(ID, "eager");
    await h.lifecycle.teardown("logout");
    h.inits[0].reject(new Error("superseded"));
    await h.flush();
    expect(h.events.errors).toEqual([]);
    expect(h.events.notReady).toEqual(["teardown"]);
  });

  it("callbacks of an obsolete Device (unregistered / error / deviceChange) are ignored after logout", async () => {
    const h = harness();
    await h.lifecycle.requestInit(ID, "eager");
    await h.completeInit(0);
    await h.lifecycle.teardown("logout");
    h.inits[0].handlers.onUnregistered(h.inits[0].device);
    h.inits[0].handlers.onError(new Error("late"), h.inits[0].device);
    h.inits[0].handlers.onDeviceChange(h.inits[0].device, []);
    expect(h.events.notReady).toEqual(["teardown"]);
    expect(h.events.errors).toEqual([]);
    expect(h.events.deviceChange).toEqual([]);
    expect(h.timers).toHaveLength(0);                     // no recovery scheduled for a torn-down generation
  });
});

describe("L2b — work awaited BEFORE the wrapper (mic prompt) is abandoned after a teardown", () => {
  it("isLive() turns false on teardown; an abandoned init rejects silently; a stale completion never retires the Device the new generation owns", async () => {
    const h = harness();
    await h.lifecycle.requestInit(ID, "eager");
    expect(h.inits[0].isLive()).toBe(true);
    await h.lifecycle.teardown("identity_change");          // during the (simulated) mic prompt
    expect(h.inits[0].isLive()).toBe(false);
    h.inits[0].reject(new Error("device init abandoned"));  // what the provider does when isLive() is false
    await h.flush();
    expect(h.events.errors).toEqual([]);                    // silent: nobody owns that generation
    expect(h.events.notReady).toEqual(["teardown"]);

    await h.lifecycle.requestInit("user-1:org-2", "after change");
    await h.completeInit(1);
    expect(h.lifecycle.isReady()).toBe(true);
    // A stale run that (through a shared wrapper attempt) resolves with the CURRENT Device must not retire it.
    h.inits[0].resolve(h.inits[1].device);
    await h.flush();
    expect(h.inits[1].device.destroyed).toBe(false);
    expect(h.retired).toEqual([]);
    expect(h.lifecycle.isReady()).toBe(true);
  });
});

describe("L3 — identity change", () => {
  it("a different identity tears the old generation down first; the old init's late completion is retired; the new one becomes ready", async () => {
    const h = harness();
    await h.lifecycle.requestInit("user-1:org-1", "eager");
    expect(await h.lifecycle.requestInit("user-2:org-1", "eager")).toBe("started");
    expect(h.destroys).toHaveLength(1);
    expect(h.inits).toHaveLength(2);
    await h.completeInit(0);                               // old identity's Device registers late
    expect(h.events.ready).toEqual([]);
    expect(h.retired).toContain(1);
    await h.completeInit(1);
    expect(h.events.ready).toEqual([2]);
    expect(h.lifecycle.snapshot().identity).toBe("user-2:org-1");
  });
});

describe("L4 — a live call is never interrupted; recovery resumes when idle", () => {
  it("requestInit during a ringing/dialing/active call is deferred, then runs on onCallEnded", async () => {
    const h = harness();
    await h.lifecycle.requestInit(ID, "eager");
    await h.completeInit(0);
    h.inits[0].handlers.onUnregistered(h.inits[0].device);   // socket dropped mid-session
    expect(h.events.notReady).toEqual(["unregistered"]);
    h.state.live = true;                                      // a call is now active
    expect(await h.lifecycle.requestInit(ID, "network_online")).toBe("deferred_live_call");
    expect(h.inits).toHaveLength(1);
    await h.fireTimers();                                     // the recovery timer also defers
    expect(h.inits).toHaveLength(1);
    expect(h.events.deferred.length).toBeGreaterThan(0);
    h.state.live = false;
    h.lifecycle.onCallEnded();
    await h.flush();
    expect(h.inits).toHaveLength(2);
    await h.completeInit(1);
    expect(h.lifecycle.isReady()).toBe(true);
  });

  it("onCallEnded with nothing deferred does nothing", async () => {
    const h = harness();
    await h.lifecycle.requestInit(ID, "eager");
    await h.completeInit(0);
    h.lifecycle.onCallEnded();
    await h.flush();
    expect(h.inits).toHaveLength(1);
  });
});

describe("L5 — bounded recovery after unregistered / error", () => {
  it("unregistered schedules one timer; the timer re-initialises when idle; attempts are capped per window", async () => {
    const h = harness();
    await h.lifecycle.requestInit(ID, "eager");
    await h.completeInit(0);
    for (let round = 0; round < LIFECYCLE_RECOVERY_MAX_ATTEMPTS + 2; round++) {
      const dev = h.inits[h.inits.length - 1];
      dev.handlers.onUnregistered(dev.device);
      expect(h.timers.length).toBeLessThanOrEqual(1);
      await h.fireTimers();
      if (h.inits.length > round + 1) {
        h.inits[h.inits.length - 1].handlers.onRegistered(h.inits[h.inits.length - 1].device);
        h.inits[h.inits.length - 1].resolve(h.inits[h.inits.length - 1].device);
        await h.flush();
      }
    }
    // 1 initial + at most MAX recovery inits inside the window
    expect(h.inits.length).toBe(1 + LIFECYCLE_RECOVERY_MAX_ATTEMPTS);
    h.advance(61_000);                                       // a new window re-arms recovery
    const dev = h.inits[h.inits.length - 1];
    dev.handlers.onUnregistered(dev.device);
    await h.fireTimers();
    expect(h.inits.length).toBe(2 + LIFECYCLE_RECOVERY_MAX_ATTEMPTS);
    expect(h.timers.every((t) => t.ms === LIFECYCLE_RECOVERY_DELAY_MS)).toBe(true);
  });

  it("an `error` from the REPLACEMENT Device before it registers is reported and recovery is scheduled (never dropped as a stale Device)", async () => {
    const h = harness();
    await h.lifecycle.requestInit(ID, "eager");
    await h.completeInit(0);
    h.inits[0].handlers.onUnregistered(h.inits[0].device);
    await h.fireTimers();                                    // recovery builds Device 2
    expect(h.inits).toHaveLength(2);
    const d2 = h.inits[1];
    d2.handlers.onError(new Error("31005 gateway"), d2.device);   // while registering, before `registered`
    expect(h.events.errors).toEqual(["31005 gateway"]);
    expect(h.events.notReady).toEqual(["unregistered", "error"]);
    expect(h.timers).toHaveLength(1);                        // recovery armed (it yields to the in-flight init)
    await h.completeInit(1);                                 // the in-flight registration still completes
    expect(h.lifecycle.isReady()).toBe(true);
    await h.fireTimers();
    expect(h.inits).toHaveLength(2);                         // ready ⇒ the armed recovery is a no-op
  });

  it("an init failure surfaces an error and schedules nothing by itself (the online/idle hooks retry)", async () => {
    const h = harness();
    await h.lifecycle.requestInit(ID, "eager");
    h.inits[0].reject(new Error("token 500"));
    await h.flush();
    expect(h.events.errors).toEqual(["token 500"]);
    expect(h.events.notReady).toEqual(["init_failed"]);
    expect(h.lifecycle.isReady()).toBe(false);
    expect(await h.lifecycle.requestInit(ID, "retry")).toBe("started");
  });
});
