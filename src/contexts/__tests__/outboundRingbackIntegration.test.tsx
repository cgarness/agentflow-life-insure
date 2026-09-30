/**
 * Outbound ringback × the REAL TwilioProvider event wiring (fake SDK wrapper, same pattern as
 * teamOpenRevealIntegration.test). The real `@/lib/outboundRingback` helper runs against a fake
 * `window.AudioContext` that records every buffer source, so "audible loops" is counted exactly:
 * a source is audible from `start()` until `stop()`. "Stops immediately" is sampled INSIDE the act()
 * callback, right after the event fires and before React renders or runs any effect, so each stop is
 * proven synchronous in its own handler, not merely achieved by the `callState` backstop a render later.
 *
 * It proves the app's mapping from Voice.js Call events to what the agent hears; it does not prove
 * Twilio's network behaviour (see outboundRingbackSdkPinned.test.ts for the pinned SDK facts).
 */
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudioContext } from "@/lib/__tests__/fixtures/fakeRingbackAudio";

const CALLER = "+15550001111";

type Handlers = { onRegistered?: (d: unknown) => void };
const voice = vi.hoisted(() => ({
  inits: [] as Array<{ opts: Handlers; device: { id: number; destroy: () => void }; resolve: (d: unknown) => void }>,
  incoming: null as null | ((call: unknown) => void),
  registered: null as unknown,
  dialFactory: (() => { throw new Error("no dial factory"); }) as () => unknown,
}));
const audio = vi.hoisted(() => ({ contexts: [] as unknown[] }));

vi.mock("@/contexts/AuthContext", () => {
  const profile = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", organization_id: "11111111-1111-4111-8111-111111111111", role: "Agent", is_super_admin: false, first_name: "Ann", last_name: "Agent" };
  return { useAuth: () => ({ user: { id: profile.id }, profile, realProfile: profile, isImpersonating: false }) };
});

vi.mock("@/integrations/supabase/client", () => {
  let rowSeq = 0;
  function makeBuilder(table: string) {
    let inserted = false;
    const b: Record<string, unknown> = {
      select() { return b; }, update() { return b; }, insert() { inserted = true; return b; }, upsert() { return b; },
      eq() { return b; }, in() { return b; }, or() { return b; }, order() { return b; }, limit() { return b; }, neq() { return b; }, is() { return b; }, not() { return b; },
      maybeSingle() {
        return Promise.resolve({ data: table === "calls" && inserted ? { id: `5555555${++rowSeq}-5555-4555-8555-555555555555` } : null, error: null });
      },
      single() { return (b.maybeSingle as () => Promise<unknown>)(); },
      then(resolve: (v: unknown) => unknown) {
        const data = table === "phone_numbers"
          ? [{ id: "pn-1", phone_number: "+15550001111", is_default: true, status: "active", assignment_type: "agency", assigned_to: null, daily_call_count: 0, daily_call_limit: 500, spam_status: null, area_code: "555", friendly_name: "Main", is_direct_line: false }]
          : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return b;
  }
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  const session = { access_token: "t", expires_at: 4102444800, user: { app_metadata: { organization_id: "11111111-1111-4111-8111-111111111111" } } };
  return {
    supabase: {
      from: (table: string) => makeBuilder(table),
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => channel,
      removeChannel: () => {},
      auth: {
        getSession: () => Promise.resolve({ data: { session }, error: null }),
        refreshSession: () => Promise.resolve({ data: { session }, error: null }),
      },
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

vi.mock("@twilio/voice-sdk", () => ({ Device: class {} }));
vi.mock("@/lib/twilio-voice", () => ({
  initTwilioDevice: vi.fn((opts: Handlers) => new Promise((resolve) => {
    const device = { id: voice.inits.length + 1, destroy: vi.fn() };
    voice.inits.push({ opts, device, resolve });
  })),
  destroyTwilioDevice: vi.fn(async () => {}),
  twilioMakeCall: vi.fn(async () => voice.dialFactory()),
  twilioHangUp: vi.fn(),
  twilioHangUpAll: vi.fn(),
  twilioAnswerCall: vi.fn(async () => {}),
  getTwilioDevice: vi.fn(() => voice.registered),
  getCallSid: vi.fn(() => "CA" + "1".repeat(32)),
  getCallDirection: vi.fn((call: { direction?: string }) => call?.direction ?? "incoming"),
  // Real wrapper returns call.status(); the fake Call models the SDK: "open" only after `accept`.
  getCallStatus: vi.fn((call: { status?: () => string }) => call?.status?.() ?? "pending"),
  clearIncomingCallHandlers: vi.fn(),
  subscribeToIncomingCalls: vi.fn((h: (call: unknown) => void) => { voice.incoming = h; }),
}));
// Browser recording starts 1 s after an accept; it is not under test here.
vi.mock("@/lib/browser-recording", () => ({
  startRecording: vi.fn(async () => {}),
  stopRecordingAsync: vi.fn(async () => null),
  uploadCallRecording: vi.fn(async () => {}),
}));
vi.mock("@/lib/ringtoneOutputs", () => ({ applyRingtoneOutputs: vi.fn(async () => ({ supported: true, applied: ["default"] })) }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, info: () => {}, message: () => {}, warning: () => {} }) }));

import { TwilioProvider, useTwilio } from "@/contexts/TwilioContext";
import { isOutboundRingbackPlaying, stopOutboundRingback } from "@/lib/outboundRingback";

/** A Voice.js-like Call: real listeners; status tracks ringing → open (accept) → closed. */
function fakeCall(direction: "OUTGOING" | "INCOMING") {
  const listeners = new Map<string, Array<(...a: unknown[]) => void>>();
  let st = "connecting";
  const call = {
    direction,
    parameters: { From: "+15550009999", CallSid: "CA" + "2".repeat(32) },
    customParameters: new Map(),
    on(ev: string, fn: (...a: unknown[]) => void) { (listeners.get(ev) ?? listeners.set(ev, []).get(ev)!).push(fn); return call; },
    removeListener(ev: string, fn: (...a: unknown[]) => void) { listeners.set(ev, (listeners.get(ev) ?? []).filter((f) => f !== fn)); return call; },
    emit(ev: string, ...a: unknown[]) {
      if (ev === "ringing") st = "ringing";
      if (ev === "accept") st = "open";
      if (["disconnect", "cancel", "reject", "error", "transportClose"].includes(ev)) st = "closed";
      for (const fn of [...(listeners.get(ev) ?? [])]) fn(...a);
    },
    count: (ev: string) => (listeners.get(ev) ?? []).length,
    status: () => st,
    reject: vi.fn(), accept: vi.fn(), disconnect: vi.fn(), ignore: vi.fn(), mute: vi.fn(),
    isMuted: () => false, getRemoteStream: () => null, getLocalStream: () => null,
  };
  return call;
}
type FakeCall = ReturnType<typeof fakeCall>;

function Probe() {
  const t = useTwilio();
  return (
    <div>
      <span data-testid="status">{t.status}</span>
      <span data-testid="callState">{t.callState}</span>
      <button onClick={() => void t.makeCall("+15550002222", CALLER, { campaignLeadId: "cl-A", campaignId: "camp-1" })}>dial</button>
      <button onClick={() => void t.hangUp()}>hangup</button>
      <button onClick={() => t.applyDialSessionRingTimeout(1)}>ring1</button>
      <button onClick={() => t.destroyClient()}>destroy</button>
    </div>
  );
}

const callState = () => screen.getByTestId("callState").textContent;
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const contexts = () => audio.contexts as FakeAudioContext[];
/** Ringback loops audible right now, across every audio context the page created. */
const audible = () => contexts().reduce((n, c) => n + c.audibleCount(), 0);
const sourcesCreated = () => contexts().reduce((n, c) => n + c.sources.length, 0);

async function ready() {
  const prior = voice.inits.length;
  const r = render(<TwilioProvider><Probe /></TwilioProvider>);
  await waitFor(() => expect(voice.inits).toHaveLength(prior + 1));
  const it = voice.inits[prior];
  voice.registered = it.device;
  await act(async () => { it.opts.onRegistered?.(it.device); it.resolve(it.device); });
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
  await settle(50); // phone numbers load
  return r;
}
async function click(label: string) {
  await act(async () => { screen.getByText(label).click(); });
}
async function dial(call: FakeCall) {
  voice.dialFactory = () => call;
  await click("dial");
  await waitFor(() => expect(callState()).toBe("dialing"));
  await waitFor(() => expect(call.count("ringing")).toBe(1)); // makeCall has wired the Call
}
async function emit(call: FakeCall, ev: string, ...a: unknown[]) {
  await act(async () => { call.emit(ev, ...a); });
}
/** Audible loops at the instant `fire` returns — before React renders or runs effects (no backstop yet). */
async function audibleRightAfter(fire: () => void): Promise<number> {
  let n = -1;
  await act(async () => { fire(); n = audible(); });
  return n;
}

beforeAll(() => {
  class WindowAudioContext extends FakeAudioContext {
    constructor() {
      super({ sampleRate: 8000 });
      audio.contexts.push(this);
    }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, writable: true, value: WindowAudioContext });
});
beforeEach(() => {
  voice.inits = [];
  voice.incoming = null;
  voice.registered = null;
  voice.dialFactory = () => { throw new Error("no dial factory"); };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: vi.fn(), kind: "audio" }] }) },
  });
});
afterEach(() => {
  cleanup();
  stopOutboundRingback();
});

describe("outbound ringback × real TwilioProvider", () => {
  it("1 — outbound ringing(false): the synthetic ringback starts for that call", async () => {
    await ready();
    const call = fakeCall("OUTGOING");
    await dial(call);
    expect(audible()).toBe(0); // nothing before the SDK says the destination is ringing
    await emit(call, "ringing", false);
    expect(callState()).toBe("dialing");
    expect(audible()).toBe(1);
    expect(isOutboundRingbackPlaying(call)).toBe(true);
  }, 15_000);

  it("2 — outbound ringing(true): no synthetic tone, the carrier's early media is heard instead", async () => {
    await ready();
    const call = fakeCall("OUTGOING");
    await dial(call);
    const before = sourcesCreated();
    await emit(call, "ringing", true);
    expect(callState()).toBe("dialing");
    expect(audible()).toBe(0);
    expect(sourcesCreated()).toBe(before);
    expect(isOutboundRingbackPlaying()).toBe(false);
  }, 15_000);

  it("3 — inbound ringing never starts the outbound ringback", async () => {
    await ready();
    const inbound = fakeCall("INCOMING");
    await act(async () => { voice.incoming!(inbound); });
    await waitFor(() => expect(callState()).toBe("incoming"));
    await emit(inbound, "ringing", false);
    await emit(inbound, "ringing", true);
    expect(audible()).toBe(0);
    expect(isOutboundRingbackPlaying()).toBe(false);
    expect(callState()).toBe("incoming");
  }, 15_000);

  it("4 — accept (the lead answered) stops it", async () => {
    await ready();
    const call = fakeCall("OUTGOING");
    await dial(call);
    await emit(call, "ringing", false);
    expect(audible()).toBe(1);
    expect(await audibleRightAfter(() => call.emit("accept"))).toBe(0);
    await waitFor(() => expect(callState()).toBe("active"));
    expect(audible()).toBe(0);
  }, 15_000);

  it.each(["disconnect", "cancel", "reject"])("5 — %s stops it", async (ev) => {
    await ready();
    const call = fakeCall("OUTGOING");
    await dial(call);
    await emit(call, "ringing", false);
    expect(audible()).toBe(1);
    expect(await audibleRightAfter(() => call.emit(ev))).toBe(0);
    await waitFor(() => expect(callState()).toMatch(/ended|idle/));
  }, 15_000);

  it("6a — a call error stops it", async () => {
    await ready();
    const call = fakeCall("OUTGOING");
    await dial(call);
    await emit(call, "ringing", false);
    expect(audible()).toBe(1);
    expect(await audibleRightAfter(() => call.emit("error", { message: "31005 connection error" }))).toBe(0);
  }, 15_000);

  it("6b — the agent hanging up stops it", async () => {
    await ready();
    const call = fakeCall("OUTGOING");
    await dial(call);
    await emit(call, "ringing", false);
    expect(audible()).toBe(1);
    expect(await audibleRightAfter(() => screen.getByText("hangup").click())).toBe(0);
    expect(callState()).toMatch(/ended|idle/);
  }, 15_000);

  it("7 — ring-timeout watchdog termination stops it", async () => {
    await ready();
    await click("ring1"); // merged ring limit = 1 s (the watchdog's minimum)
    const call = fakeCall("OUTGOING");
    await dial(call);
    await emit(call, "ringing", false);
    expect(audible()).toBe(1);
    await waitFor(() => expect(call.disconnect).toHaveBeenCalled(), { timeout: 4_000 }); // the watchdog's own teardown
    await waitFor(() => expect(callState()).toMatch(/ended|idle/));
    expect(audible()).toBe(0);
    expect(isOutboundRingbackPlaying()).toBe(false);
  }, 15_000);

  it("8 — the next outbound call never inherits the prior tone, and the prior Call's late events cannot drive the new one's", async () => {
    await ready();
    const first = fakeCall("OUTGOING");
    await dial(first);
    await emit(first, "ringing", false);
    expect(isOutboundRingbackPlaying(first)).toBe(true);
    await click("hangup");
    await waitFor(() => expect(callState()).toBe("idle"), { timeout: 3_000 });
    expect(audible()).toBe(0);

    const second = fakeCall("OUTGOING");
    await dial(second);
    expect(audible()).toBe(0); // the new call starts silent until ITS ringing
    await emit(second, "ringing", false);
    expect(audible()).toBe(1);
    expect(isOutboundRingbackPlaying(second)).toBe(true);
    const created = sourcesCreated();

    await emit(first, "ringing", false); // stale: cannot start / take over the tone
    expect(isOutboundRingbackPlaying(second)).toBe(true);
    expect(sourcesCreated()).toBe(created);
    await emit(first, "ringing", true); // stale early media: cannot stop the current call's tone
    expect(isOutboundRingbackPlaying(second)).toBe(true);
    expect(audible()).toBe(1);

    expect(await audibleRightAfter(() => second.emit("accept"))).toBe(0);
  }, 20_000);

  it("8b — an inbound call replacing a ringing outbound call silences the ringback", async () => {
    await ready();
    const out = fakeCall("OUTGOING");
    await dial(out);
    await emit(out, "ringing", false);
    expect(audible()).toBe(1);
    const inbound = fakeCall("INCOMING");
    expect(await audibleRightAfter(() => voice.incoming!(inbound))).toBe(0);
    await emit(out, "ringing", false); // the replaced Call is no longer current
    expect(audible()).toBe(0);
  }, 15_000);

  it("9 — duplicate ringing(false) events never create a second loop", async () => {
    await ready();
    const call = fakeCall("OUTGOING");
    await dial(call);
    const before = sourcesCreated();
    for (let i = 0; i < 4; i++) await emit(call, "ringing", false);
    expect(sourcesCreated()).toBe(before + 1);
    expect(audible()).toBe(1);
  }, 15_000);

  it("10 — early media and the synthetic tone never sound together", async () => {
    await ready();
    const lateMedia = fakeCall("OUTGOING");
    await dial(lateMedia);
    await emit(lateMedia, "ringing", false);
    expect(audible()).toBe(1);
    expect(await audibleRightAfter(() => lateMedia.emit("ringing", true))).toBe(0); // carrier early media begins mid-ring
    await emit(lateMedia, "ringing", false); // and stays the ringback for the rest of the call
    expect(audible()).toBe(0);
    await click("hangup");
    await waitFor(() => expect(callState()).toBe("idle"), { timeout: 3_000 });

    const earlyMedia = fakeCall("OUTGOING");
    await dial(earlyMedia);
    await emit(earlyMedia, "ringing", true);
    await emit(earlyMedia, "ringing", false);
    expect(audible()).toBe(0);
    expect(isOutboundRingbackPlaying()).toBe(false);
  }, 20_000);

  it("a ringing Call closed by a signaling drop (`transportClose` only, no disconnect) stops it", async () => {
    await ready();
    const call = fakeCall("OUTGOING");
    await dial(call);
    await emit(call, "ringing", false);
    expect(audible()).toBe(1);
    expect(await audibleRightAfter(() => call.emit("transportClose"))).toBe(0);
    expect(isOutboundRingbackPlaying()).toBe(false);
    expect(callState()).toBe("dialing"); // the provider's (pre-existing) state is untouched; the stop is its own
  }, 15_000);

  it("a network drop mid-ring stops it", async () => {
    await ready();
    const call = fakeCall("OUTGOING");
    await dial(call);
    await emit(call, "ringing", false);
    expect(audible()).toBe(1);
    expect(await audibleRightAfter(() => window.dispatchEvent(new Event("offline")))).toBe(0);
  }, 15_000);

  it("provider teardown (sign-out) and unmount stop it", async () => {
    const r = await ready();
    const call = fakeCall("OUTGOING");
    await dial(call);
    await emit(call, "ringing", false);
    expect(audible()).toBe(1);
    expect(await audibleRightAfter(() => screen.getByText("destroy").click())).toBe(0);
    r.unmount();

    const r2 = await ready();
    const again = fakeCall("OUTGOING");
    await dial(again);
    await emit(again, "ringing", false);
    expect(audible()).toBe(1);
    r2.unmount();
    expect(audible()).toBe(0);
  }, 20_000);
});
