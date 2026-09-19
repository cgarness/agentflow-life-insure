// Corrective pass, defects 1 and 2 — the SDK wrapper, tested with a FAKE Twilio Device that reproduces
// the real 2.18.1 ordering: `register()` emits `registered` and only THEN resolves. Cold startup must
// configure ring outputs on the Device that actually registered; `deviceChange` re-applies the saved
// preference; a failed output selection falls back; a teardown during a pending token fetch or a
// pending register() retires the late Device and never publishes it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class FakeAudio {
    isOutputSelectionSupported = true;
    availableOutputDevices = new Map<string, { deviceId: string; label: string }>([
      ["default", { deviceId: "default", label: "Speakers" }],
      ["hs1", { deviceId: "hs1", label: "Headset" }],
    ]);
    setCalls: string[][] = [];
    failNextSet = false;
    outgoingCalls: unknown[] = [];
    private listeners = new Map<string, Listener[]>();
    /** Conversation audio: must NEVER be written by ring-output configuration. */
    speakerCalls: unknown[] = [];
    speakerDevices = { set: async (v: unknown) => { this.speakerCalls.push(v); }, get: () => new Set(), test: async () => {} };
    ringtoneDevices = {
      set: async (ids: string | string[]) => {
        if (this.failNextSet) { this.failNextSet = false; throw new Error("unknown sink"); }
        this.setCalls.push(Array.isArray(ids) ? ids : [ids]);
      },
      get: () => new Set(),
      test: async () => {},
    };
    outgoing(v: unknown) { this.outgoingCalls.push(v); }
    on(event: string, fn: Listener) { (this.listeners.get(event) ?? this.listeners.set(event, []).get(event)!).push(fn); }
    emit(event: string, ...args: unknown[]) { for (const fn of this.listeners.get(event) ?? []) fn(...args); }
  }

  const state = {
    created: [] as FakeDevice[],
    registerGate: null as null | { pending: boolean; resolve: () => void },
    tokenGate: [] as Array<() => void>,
    tokenCalls: 0,
  };

  class FakeDevice {
    static State = { Unregistered: "unregistered", Registering: "registering", Registered: "registered", Destroyed: "destroyed" };
    state = "unregistered";
    audio = new FakeAudio();
    destroyed = false;
    unregisterCalls = 0;
    private listeners = new Map<string, Listener[]>();
    constructor(public token: string, public options: unknown) { state.created.push(this); }
    on(event: string, fn: Listener) { (this.listeners.get(event) ?? this.listeners.set(event, []).get(event)!).push(fn); }
    emit(event: string, ...args: unknown[]) { for (const fn of this.listeners.get(event) ?? []) fn(...args); }
    async register() {
      this.state = "registering";
      if (state.registerGate?.pending) await new Promise<void>((r) => { state.registerGate = { pending: true, resolve: r }; });
      this.state = "registered";
      this.emit("registered");           // SDK 2.18.1: the event fires, then register() resolves
    }
    async unregister() { this.unregisterCalls += 1; this.state = "unregistered"; this.emit("unregistered"); }
    destroy() { this.destroyed = true; this.state = "destroyed"; }
    updateToken() {}
    disconnectAll() {}
  }

  return { FakeDevice, state };
});

type FakeDevice = InstanceType<typeof fakes.FakeDevice>;

vi.mock("@twilio/voice-sdk", () => ({
  Device: fakes.FakeDevice,
  Call: { Codec: { Opus: "opus", PCMU: "pcmu" } },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async () => {
        fakes.state.tokenCalls += 1;
        await new Promise<void>((r) => { fakes.state.tokenGate.push(r); });
        return { data: { token: `tok-${fakes.state.tokenCalls}`, identity: `agent_${fakes.state.tokenCalls}`, expires_in: 3600 }, error: null };
      },
    },
  },
}));

import {
  TwilioInitStaleError,
  destroyTwilioDevice,
  getCurrentIdentity,
  getTwilioDevice,
  initTwilioDevice,
} from "@/lib/twilio-voice";
import { applyRingtoneOutputs } from "@/lib/ringtoneOutputs";
import { DeviceLifecycle } from "@/lib/deviceLifecycle";
import type { Device } from "@twilio/voice-sdk";

const { state } = fakes;
const created = state.created;
const releaseToken = () => { const r = state.tokenGate.shift(); if (r) r(); };
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(async () => {
  created.length = 0;
  state.registerGate = null;
  state.tokenGate = [];
  state.tokenCalls = 0;
  await destroyTwilioDevice();
});

describe("D1 — cold startup configures ring outputs on the Device that registered", () => {
  it("onRegistered receives the Device, getTwilioDevice() is already valid during the event, and outputs are applied to it", async () => {
    const seen: Array<{ same: boolean; getterNonNull: boolean }> = [];
    const p = initTwilioDevice({
      onRegistered: (device) => {
        seen.push({ same: device === getTwilioDevice(), getterNonNull: getTwilioDevice() !== null });
        void applyRingtoneOutputs(device as never);
      },
    });
    await flush();
    releaseToken();
    const device = (await p) as unknown as FakeDevice;
    expect(seen).toEqual([{ same: true, getterNonNull: true }]);
    await flush();
    expect(device.audio.setCalls).toEqual([["default", "hs1"]]);   // speakers AND headset (D9)
    expect(device.audio.outgoingCalls).toEqual([false]);           // outgoing chime off
    expect(device.audio.speakerCalls).toEqual([]);                 // conversation (speaker) audio NEVER written by ring configuration
  });

  it("deviceChange (headset plugged in / removed) re-applies the saved preference on the live Device", async () => {
    const p = initTwilioDevice({ onDeviceChange: (device) => { void applyRingtoneOutputs(device as never); } });
    await flush(); releaseToken();
    const device = (await p) as unknown as FakeDevice;
    device.audio.availableOutputDevices.delete("hs1");
    device.audio.emit("deviceChange", [{ deviceId: "hs1" }]);
    await flush();
    expect(device.audio.setCalls).toEqual([["default"]]);
    device.audio.availableOutputDevices.set("hs1", { deviceId: "hs1", label: "Headset" });
    device.audio.emit("deviceChange", []);
    await flush();
    expect(device.audio.setCalls).toEqual([["default"], ["default", "hs1"]]);
    expect(device.audio.speakerCalls).toEqual([]);
  });

  it("a failed output selection falls back to every available output", async () => {
    const p = initTwilioDevice({ onRegistered: (device) => { (device as unknown as FakeDevice).audio.failNextSet = true; void applyRingtoneOutputs(device as never); } });
    await flush(); releaseToken();
    const device = (await p) as unknown as FakeDevice;
    await flush();
    expect(device.audio.setCalls).toEqual([["default", "hs1"]]);
  });
});

describe("D2 — teardown invalidates pending initialization", () => {
  it("logout while the token fetch is pending: no Device is built afterwards, init rejects as stale", async () => {
    const onRegistered = vi.fn();
    const p = initTwilioDevice({ onRegistered });
    await flush();
    expect(state.tokenCalls).toBe(1);
    await destroyTwilioDevice();           // logout before the token arrives
    releaseToken();
    await expect(p).rejects.toBeInstanceOf(TwilioInitStaleError);
    expect(created).toHaveLength(0);
    expect(getTwilioDevice()).toBeNull();
    expect(onRegistered).not.toHaveBeenCalled();
  });

  it("logout while register() is pending: the late Device is retired and its registered event is ignored", async () => {
    state.registerGate = { pending: true, resolve: () => {} };
    const onRegistered = vi.fn();
    const p = initTwilioDevice({ onRegistered });
    await flush(); releaseToken(); await flush();
    expect(created).toHaveLength(1);
    const late = created[0];
    await destroyTwilioDevice();           // logout mid-registration
    state.registerGate!.resolve();         // the SDK now emits `registered` and resolves
    await expect(p).rejects.toBeInstanceOf(TwilioInitStaleError);
    expect(onRegistered).not.toHaveBeenCalled();
    expect(late.destroyed).toBe(true);
    expect(getTwilioDevice()).toBeNull();
  });

  it("overlapping initialization builds ONE Device; a fresh init after logout builds a new generation", async () => {
    const p1 = initTwilioDevice();
    const p2 = initTwilioDevice();
    await flush(); releaseToken();
    const [d1, d2] = await Promise.all([p1, p2]);
    expect(d1).toBe(d2);
    expect(created).toHaveLength(1);
    await destroyTwilioDevice();
    expect((d1 as unknown as FakeDevice).destroyed).toBe(true);
    const p3 = initTwilioDevice();
    await flush(); releaseToken();
    const d3 = await p3;
    expect(d3).not.toBe(d1);
    expect(created).toHaveLength(2);
  });

  it("a stale token fetch that resolves late never clobbers the identity the NEW generation owns", async () => {
    const pA = initTwilioDevice();                 // generation A: token pending
    await flush();
    await destroyTwilioDevice();                   // identity change
    const pB = initTwilioDevice();                 // generation B: its own token pending
    await flush();
    expect(state.tokenGate).toHaveLength(2);
    state.tokenGate[1]();                          // B's token resolves FIRST
    await flush(); await flush();
    const dB = await pB;
    expect(getCurrentIdentity()).toBe("agent_2");
    state.tokenGate[0]();                          // A's token resolves late
    await expect(pA).rejects.toBeInstanceOf(TwilioInitStaleError);
    expect(getCurrentIdentity()).toBe("agent_2");  // pre-fix: nulled (or briefly A's identity)
    expect(getTwilioDevice()).toBe(dB);
  });

  it("an obsolete Device that still emits `incoming` after teardown rejects the call instead of ringing", async () => {
    const p = initTwilioDevice();
    await flush(); releaseToken();
    const device = (await p) as unknown as FakeDevice;
    await destroyTwilioDevice();
    const call = { reject: vi.fn() };
    device.emit("incoming", call);
    expect(call.reject).toHaveBeenCalled();
  });
});

describe("D2 — recovery over the REAL wrapper (coordinator + wrapper together)", () => {
  function coordinator() {
    const timers: Array<{ fn: () => void; id: number }> = [];
    let tid = 0;
    const events = { ready: 0, notReady: [] as string[], errors: [] as string[] };
    const lc = new DeviceLifecycle<Device>(
      {
        init: (handlers) => initTwilioDevice({
          onRegistered: (d) => handlers.onRegistered(d),
          onUnregistered: (d) => handlers.onUnregistered(d),
          onError: (e, d) => handlers.onError(e, d),
          onDeviceChange: (d, lost) => handlers.onDeviceChange(d, lost),
        }),
        destroy: () => destroyTwilioDevice(),
        isCallLive: () => false,
        now: () => Date.now(),
        setTimeout: (fn) => { const id = ++tid; timers.push({ fn, id }); return id; },
        clearTimeout: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); },
      },
      {
        onReady: () => { events.ready += 1; },
        onNotReady: (r) => events.notReady.push(r),
        onError: (e) => events.errors.push(e.message),
        onDeviceChange: () => {},
      },
    );
    const fire = async () => { for (const t of timers.splice(0)) t.fn(); await flush(); await flush(); };
    return { lc, timers, events, fire };
  }

  it("an `error` that leaves the Device registered: recovery reuses it AND re-targets its later events to the current generation", async () => {
    const c = coordinator();
    void c.lc.requestInit("u1:org1", "eager");
    await flush(); releaseToken(); await flush();
    expect(c.events.ready).toBe(1);
    const d1 = created[0];
    expect(d1.state).toBe("registered");

    d1.emit("error", new Error("31486 busy"));      // SDK forwards a signaling error; the Device stays Registered
    expect(c.lc.isReady()).toBe(false);
    expect(c.timers).toHaveLength(1);

    await c.fire();                                  // bounded recovery: the wrapper reuses the registered Device
    expect(created).toHaveLength(1);
    expect(state.tokenCalls).toBe(1);
    expect(c.lc.isReady()).toBe(true);

    d1.state = "unregistered";                       // a REAL socket drop after the recovery (SDK: state, then the event)
    d1.emit("unregistered");
    expect(c.lc.isReady()).toBe(false);              // pre-fix: stayed true — the listeners still reported to generation 1
    expect(c.events.notReady).toEqual(["error", "unregistered"]);
    expect(c.timers).toHaveLength(1);                // and recovery is armed again

    await c.fire();                                  // this time the Device is unregistered ⇒ a new one is built
    await flush(); releaseToken(); await flush();
    expect(created).toHaveLength(2);
    expect(d1.destroyed).toBe(true);
    expect(c.lc.isReady()).toBe(true);
    expect(getTwilioDevice()).toBe(created[1] as unknown as Device);
  });
});
