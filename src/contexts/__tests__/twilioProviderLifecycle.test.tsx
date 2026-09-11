/**
 * Corrective pass, defect 2 — the PROVIDER's lifecycle wiring, exercised by mounting `TwilioProvider`
 * against a fake SDK wrapper (no source-string assertions): cold start registers ONE Device and the
 * status follows the SDK's `registered`; an organization change tears the Device down and the UI says
 * "connecting" until the NEW Device registers; a same-identity recovery after `unregistered` is
 * deferred while a call is ringing and resumes when the call ends; sign-out tears the Device down.
 */
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG1 = "11111111-1111-4111-8111-111111111111";
const ORG2 = "22222222-2222-4222-8222-222222222222";
const ROW = "33333333-3333-4333-8333-333333333333";

type Handlers = {
  onRegistered?: (d: unknown) => void;
  onUnregistered?: (d: unknown) => void;
  onError?: (e: Error, d: unknown) => void;
  onDeviceChange?: (d: unknown, lost: unknown[]) => void;
};

const ring = vi.hoisted(() => ({ calls: [] as unknown[] }));
type FakeStream = { getTracks: () => Array<{ stop: () => void }>; track: { stop: ReturnType<typeof vi.fn>; kind: string } };
const mic = vi.hoisted(() => ({ pending: [] as Array<() => void>, gate: false, streams: [] as FakeStream[] }));
const voice = vi.hoisted(() => ({
  inits: [] as Array<{ opts: Handlers; device: { id: number; destroy: () => void }; resolve: (d: unknown) => void; reject: (e: Error) => void }>,
  destroys: 0,
  incoming: null as null | ((call: unknown) => void),
}));

const authState = vi.hoisted(() => ({
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null,
  real: null as Record<string, unknown> | null,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: authState.userId ? { id: authState.userId } : null,
    profile: authState.real,
    realProfile: authState.real,
    isImpersonating: false,
  }),
}));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder() {
    const b: Record<string, unknown> = {
      select() { return b; }, update() { return b; }, insert() { return b; }, upsert() { return b; },
      eq() { return b; }, in() { return b; }, or() { return b; }, order() { return b; }, limit() { return b; }, neq() { return b; }, is() { return b; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    };
    return b;
  }
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  return {
    supabase: {
      from: () => makeBuilder(),
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => channel,
      removeChannel: () => {},
      auth: {
        getSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }),
        refreshSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }),
      },
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

vi.mock("@twilio/voice-sdk", () => ({ Device: class {} }));
vi.mock("@/lib/twilio-voice", () => ({
  // The real wrapper resolves register() AFTER emitting `registered`; the test drives both by hand.
  initTwilioDevice: vi.fn((opts: Handlers) => new Promise((resolve, reject) => {
    const device = { id: voice.inits.length + 1, destroy: vi.fn() };
    voice.inits.push({ opts, device, resolve, reject });
  })),
  destroyTwilioDevice: vi.fn(async () => { voice.destroys += 1; }),
  twilioMakeCall: vi.fn(),
  twilioHangUp: vi.fn(),
  twilioHangUpAll: vi.fn(),
  twilioAnswerCall: vi.fn(),
  getTwilioDevice: vi.fn(() => null),
  getCallSid: vi.fn(() => "CA" + "1".repeat(32)),
  getCallDirection: vi.fn(() => "incoming"),
  getCallStatus: vi.fn(() => "pending"),
  clearIncomingCallHandlers: vi.fn(),
  subscribeToIncomingCalls: vi.fn((h: (call: unknown) => void) => { voice.incoming = h; }),
}));
vi.mock("@/lib/ringtoneOutputs", () => ({
  applyRingtoneOutputs: vi.fn(async (device: unknown) => { ring.calls.push(device); return { supported: true, applied: ["default"] }; }),
  loadRingtoneOutputPref: () => ({ mode: "all" }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(() => {}, { error: () => {}, success: () => {}, info: () => {}, message: () => {} }),
}));

import { TwilioProvider, useTwilio } from "@/contexts/TwilioContext";

const Probe: React.FC = () => {
  const t = useTwilio();
  return (
    <div>
      <span data-testid="status">{t.status}</span>
      <span data-testid="callState">{t.callState}</span>
    </div>
  );
};

function mount() {
  return render(
    <TwilioProvider>
      <Probe />
    </TwilioProvider>,
  );
}

const profileRow = (org: string) => ({
  id: USER, organization_id: org, role: "Agent", is_super_admin: false, first_name: "Ann", last_name: "Agent",
});

/** A ringing inbound leg as the Voice SDK hands it to the provider (parameters + custom parameters + events). */
function fakeIncomingCall() {
  const listeners = new Map<string, Array<(...a: unknown[]) => void>>();
  const call = {
    parameters: { From: "+15550001111", CallSid: "CA" + "1".repeat(32) },
    customParameters: new Map([["af_call_row_id", ROW]]),
    on(ev: string, fn: (...a: unknown[]) => void) { (listeners.get(ev) ?? listeners.set(ev, []).get(ev)!).push(fn); return call; },
    off() { return call; },
    removeListener() { return call; },
    emit(ev: string, ...a: unknown[]) { for (const fn of listeners.get(ev) ?? []) fn(...a); },
    reject: vi.fn(), accept: vi.fn(), disconnect: vi.fn(), ignore: vi.fn(), mute: vi.fn(),
    status: () => "pending", direction: "INCOMING", isMuted: () => false,
  };
  return call;
}

const registerLatest = async () => {
  const it = voice.inits[voice.inits.length - 1];
  await act(async () => { it.opts.onRegistered?.(it.device); it.resolve(it.device); });
};
const status = () => screen.getByTestId("status").textContent;
const callState = () => screen.getByTestId("callState").textContent;
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  ring.calls = [];
  mic.pending = [];
  mic.gate = false;
  mic.streams = [];
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      // Every permission result is a distinct stream with ONE stoppable track, recorded in order.
      getUserMedia: () => new Promise<unknown>((resolve) => {
        const track = { stop: vi.fn(), kind: "audio" };
        const stream: FakeStream = { getTracks: () => [track], track };
        mic.streams.push(stream);
        if (mic.gate) mic.pending.push(() => resolve(stream)); else resolve(stream);
      }),
    },
  });
  voice.inits = [];
  voice.destroys = 0;
  voice.incoming = null;
  authState.userId = USER;
  authState.real = profileRow(ORG1);
});
afterEach(cleanup);

describe("TwilioProvider — Device lifecycle wiring (behavioral)", () => {
  it("cold start: ONE registration, the status becomes ready on the SDK's `registered` event, and ring outputs are applied to THAT Device (again on deviceChange)", async () => {
    mount();
    await waitFor(() => expect(voice.inits).toHaveLength(1));
    await settle();
    expect(voice.inits).toHaveLength(1);                 // profile/org effects did not double-register
    expect(status()).toBe("connecting");
    expect(ring.calls).toEqual([]);                      // nothing configured before a Device exists (defect 1)
    await registerLatest();
    await waitFor(() => expect(status()).toBe("ready"));
    await waitFor(() => expect(ring.calls).toEqual([voice.inits[0].device]));   // the registered instance
    const d1 = voice.inits[0];
    await act(async () => { d1.opts.onDeviceChange?.(d1.device, []); });        // headset plugged in / removed
    await waitFor(() => expect(ring.calls).toEqual([d1.device, d1.device]));
  });

  it("a sign-out during the microphone prompt abandons that generation: the stale init never reaches the wrapper", async () => {
    mic.gate = true;
    const view = mount();
    await waitFor(() => expect(mic.pending).toHaveLength(1));   // mic prompt open, wrapper not called yet
    expect(voice.inits).toHaveLength(0);

    authState.real = profileRow(ORG2);                          // identity change while the prompt is open
    view.rerender(<TwilioProvider><Probe /></TwilioProvider>);
    await waitFor(() => expect(voice.destroys).toBe(1));
    await waitFor(() => expect(mic.pending).toHaveLength(2));   // the new generation's own prompt

    await act(async () => { mic.pending[0](); });               // the STALE prompt resolves first
    await settle();
    expect(voice.inits).toHaveLength(0);                        // pre-fix: the stale generation built a Device here
    await act(async () => { mic.pending[1](); });
    await waitFor(() => expect(voice.inits).toHaveLength(1));
    await registerLatest();
    await waitFor(() => expect(status()).toBe("ready"));
    expect(voice.inits[0].device.destroy).not.toHaveBeenCalled();
  });

  it("microphone streams: a permission result returned to an obsolete attempt is STOPPED, never kept, and the wrapper is not called", async () => {
    mic.gate = true;
    const view = mount();
    await waitFor(() => expect(mic.pending).toHaveLength(1));   // permission prompt open
    authState.userId = null;                                    // sign-out completes while it is open
    authState.real = null;
    view.rerender(<TwilioProvider><Probe /></TwilioProvider>);
    await waitFor(() => expect(voice.destroys).toBe(1));
    await act(async () => { mic.pending[0](); });               // the permission resolves afterwards
    await settle();
    expect(voice.inits).toHaveLength(0);                        // no Device for a signed-out user
    expect(mic.streams[0].track.stop).toHaveBeenCalledTimes(1); // pre-fix: retained, never stopped
  });

  it("microphone streams: an OLD permission result arriving after a newer generation succeeded is stopped and does not replace the current stream", async () => {
    mic.gate = true;
    const view = mount();
    await waitFor(() => expect(mic.pending).toHaveLength(1));   // generation 1's prompt
    authState.real = profileRow(ORG2);                          // identity change → generation 2
    view.rerender(<TwilioProvider><Probe /></TwilioProvider>);
    await waitFor(() => expect(mic.pending).toHaveLength(2));
    await act(async () => { mic.pending[1](); });               // generation 2 gets ITS stream first
    await waitFor(() => expect(voice.inits).toHaveLength(1));
    await registerLatest();
    await waitFor(() => expect(status()).toBe("ready"));

    await act(async () => { mic.pending[0](); });               // generation 1's late result
    await settle();
    expect(mic.streams[0].track.stop).toHaveBeenCalledTimes(1); // stopped as obsolete …
    expect(mic.streams[1].track.stop).not.toHaveBeenCalled();   // … the current stream untouched

    authState.userId = null;                                    // sign-out releases the CURRENT stream
    authState.real = null;
    view.rerender(<TwilioProvider><Probe /></TwilioProvider>);
    await waitFor(() => expect(mic.streams[1].track.stop).toHaveBeenCalledTimes(1));   // pre-fix: never (overwritten by stream 1)
    expect(mic.streams[0].track.stop).toHaveBeenCalledTimes(1);                        // not stopped twice
  });

  it("microphone streams: a repeated recovery replaces the registration stream without leaking it, and never runs while a call is live", async () => {
    mount();
    await waitFor(() => expect(voice.inits).toHaveLength(1));
    await registerLatest();
    await waitFor(() => expect(status()).toBe("ready"));
    expect(mic.streams).toHaveLength(1);

    const call = fakeIncomingCall();
    await act(async () => { voice.incoming!(call); });
    await waitFor(() => expect(callState()).toBe("incoming"));
    const d1 = voice.inits[0];
    await act(async () => { d1.opts.onUnregistered?.(d1.device); });   // socket drop while ringing
    await settle(2_300);
    expect(mic.streams).toHaveLength(1);                                 // deferred: no new capture during the ring
    expect(mic.streams[0].track.stop).not.toHaveBeenCalled();           // the live call's audio untouched
    await act(async () => { call.emit("cancel"); });
    await waitFor(() => expect(voice.inits).toHaveLength(2), { timeout: 4_000 });   // recovery resumed on idle
    await waitFor(() => expect(mic.streams).toHaveLength(2));
    expect(mic.streams[1].track.stop).not.toHaveBeenCalled();           // the replacement is retained
    await registerLatest();
    await waitFor(() => expect(status()).toBe("ready"));
  }, 15_000);

  it("microphone streams: an idle recovery replaces the previous registration stream (stopped once) and keeps the new one", async () => {
    const view = mount();
    await waitFor(() => expect(voice.inits).toHaveLength(1));
    await registerLatest();
    await waitFor(() => expect(status()).toBe("ready"));
    const d1 = voice.inits[0];
    await act(async () => { d1.opts.onUnregistered?.(d1.device); });   // socket drop while idle
    await waitFor(() => expect(voice.inits).toHaveLength(2), { timeout: 4_000 });   // bounded recovery ran
    await waitFor(() => expect(mic.streams).toHaveLength(2));
    expect(mic.streams[0].track.stop).toHaveBeenCalledTimes(1);        // pre-fix: overwritten, never stopped (leak)
    expect(mic.streams[1].track.stop).not.toHaveBeenCalled();
    await registerLatest();
    await waitFor(() => expect(status()).toBe("ready"));
    authState.userId = null;
    authState.real = null;
    view.rerender(<TwilioProvider><Probe /></TwilioProvider>);
    await waitFor(() => expect(mic.streams[1].track.stop).toHaveBeenCalledTimes(1));
    expect(mic.streams[0].track.stop).toHaveBeenCalledTimes(1);
  }, 10_000);

  it("a queued network-online callback followed by sign-out does not initialize a Device for the signed-out user", async () => {
    const view = mount();
    await waitFor(() => expect(voice.inits).toHaveLength(1));
    await registerLatest();
    await waitFor(() => expect(status()).toBe("ready"));
    const d1 = voice.inits[0];
    await act(async () => { d1.opts.onUnregistered?.(d1.device); });   // not ready ⇒ the online handler will re-init
    await waitFor(() => expect(status()).toBe("connecting"));
    await act(async () => { window.dispatchEvent(new Event("online")); });   // 1 s re-init queued

    authState.userId = null;                                             // sign-out during that second
    authState.real = null;
    view.rerender(<TwilioProvider><Probe /></TwilioProvider>);
    await waitFor(() => expect(voice.destroys).toBe(1));
    await settle(3_500);                                                 // past the online delay AND the recovery delay
    expect(voice.inits).toHaveLength(1);                                 // pre-fix: the stale closure registered user A again
    expect(status()).not.toBe("ready");
  }, 10_000);

  it("network-online is an entry point of the SAME coordinator: it joins an in-flight registration instead of starting another", async () => {
    mount();
    await waitFor(() => expect(voice.inits).toHaveLength(1));   // registration in flight (never completes here)
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await settle(1_300);                                        // past the handler's 1 s delay
    expect(voice.inits).toHaveLength(1);                        // in_flight: no second wrapper call, no teardown
    expect(voice.destroys).toBe(0);
  });

  it("organization change: the old Device is torn down, the UI says connecting until the NEW Device registers", async () => {
    const view = mount();
    await waitFor(() => expect(voice.inits).toHaveLength(1));
    await registerLatest();
    await waitFor(() => expect(status()).toBe("ready"));

    authState.real = profileRow(ORG2);
    view.rerender(<TwilioProvider><Probe /></TwilioProvider>);
    await waitFor(() => expect(voice.destroys).toBe(1));
    await waitFor(() => expect(voice.inits).toHaveLength(2));
    expect(status()).toBe("connecting");                 // pre-fix: stayed "ready" while nothing was registered
    await registerLatest();
    await waitFor(() => expect(status()).toBe("ready"));
    expect(voice.destroys).toBe(1);
  });

  it("recovery after `unregistered` is DEFERRED while a call is ringing and resumes when the call ends", async () => {
    mount();
    await waitFor(() => expect(voice.inits).toHaveLength(1));
    await registerLatest();
    await waitFor(() => expect(status()).toBe("ready"));
    expect(voice.incoming).not.toBeNull();

    const call = fakeIncomingCall();
    await act(async () => { voice.incoming!(call); });
    await waitFor(() => expect(callState()).toBe("incoming"));

    const d1 = voice.inits[0];
    await act(async () => { d1.opts.onUnregistered?.(d1.device); });   // socket drop while ringing
    await waitFor(() => expect(status()).toBe("connecting"));
    await settle(2_300);                                              // past the coordinator's 2 s recovery delay
    expect(voice.inits).toHaveLength(1);                              // deferred: the ring was never interrupted
    expect(voice.destroys).toBe(0);

    await act(async () => { call.emit("cancel"); });                  // caller hung up
    await waitFor(() => expect(callState()).toBe("idle"), { timeout: 3_000 });
    await waitFor(() => expect(voice.inits).toHaveLength(2));         // the deferred recovery ran on idle
    await registerLatest();
    await waitFor(() => expect(status()).toBe("ready"));
  }, 15_000);

  it("sign-out tears the Device down and starts nothing afterwards", async () => {
    const view = mount();
    await waitFor(() => expect(voice.inits).toHaveLength(1));
    await registerLatest();
    await waitFor(() => expect(status()).toBe("ready"));

    authState.userId = null;
    authState.real = null;
    view.rerender(<TwilioProvider><Probe /></TwilioProvider>);
    await waitFor(() => expect(voice.destroys).toBe(1));
    await settle();
    expect(voice.inits).toHaveLength(1);
    expect(status()).not.toBe("ready");
  });
});
