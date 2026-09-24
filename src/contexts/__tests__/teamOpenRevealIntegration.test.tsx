/**
 * Team/Open reveal — INTEGRATION against the real TwilioProvider event→state mapping (rev 5 §8.2).
 *
 * Mounts the real `TwilioProvider` (fake SDK wrapper, same pattern as twilioProviderLifecycle.test)
 * and drives the real `useTeamOpenDialSession` + `computeTeamOpenCallStatus` exactly as DialerPage
 * wires them. It proves the APP's mapping from Voice.js Call events to the reveal; it does NOT prove
 * Twilio's network behaviour (that `accept` means destination-answered relies on the SDK guard and
 * the `answerOnBridge` TwiML precondition — see outboundAnswerSignalPinned.test.ts).
 */
import React, { useRef, useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "11111111-1111-4111-8111-111111111111";
const CALLER = "+15550001111";

type Handlers = { onRegistered?: (d: unknown) => void; onUnregistered?: (d: unknown) => void; onError?: (e: Error, d: unknown) => void };
const voice = vi.hoisted(() => ({
  inits: [] as Array<{ opts: Handlers; device: { id: number; destroy: () => void }; resolve: (d: unknown) => void }>,
  incoming: null as null | ((call: unknown) => void),
  registered: null as unknown,
  dialFactory: (() => { throw new Error("no dial factory"); }) as () => unknown,
}));

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
      eq() { return b; }, in() { return b; }, or() { return b; }, order() { return b; }, limit() { return b; }, neq() { return b; }, is() { return b; },
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
vi.mock("@/lib/ringtoneOutputs", () => ({ applyRingtoneOutputs: vi.fn(async () => ({ supported: true, applied: ["default"] })) }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, info: () => {}, message: () => {}, warning: () => {} }) }));

import { TwilioProvider, useTwilio } from "@/contexts/TwilioContext";
import { useTeamOpenDialSession } from "@/hooks/useTeamOpenDialSession";
import { computeTeamOpenCallStatus, isInboundActivity } from "@/lib/teamOpenReveal";
import { isVoiceSdkInboundDirection } from "@/lib/voiceSdkNotificationBranch";
import type { TwilioCall } from "@/lib/twilio-voice";

/** A Voice.js-like Call: real add/remove of listeners; status "open" only after `accept`. */
function fakeCall(direction: "OUTGOING" | "INCOMING", opts: { acceptOnFirstSubscribe?: boolean } = {}) {
  const listeners = new Map<string, Array<(...a: unknown[]) => void>>();
  let st = "connecting";
  let autoAccepted = false;
  const call = {
    direction,
    parameters: { From: "+15550009999", CallSid: "CA" + "2".repeat(32) },
    customParameters: new Map(),
    on(ev: string, fn: (...a: unknown[]) => void) {
      (listeners.get(ev) ?? listeners.set(ev, []).get(ev)!).push(fn);
      // Accepted right after the PROVIDER wires its listener, before this hook's effects run.
      if (ev === "accept" && opts.acceptOnFirstSubscribe && !autoAccepted) {
        autoAccepted = true;
        queueMicrotask(() => call.emit("accept"));
      }
      return call;
    },
    removeListener(ev: string, fn: (...a: unknown[]) => void) { listeners.set(ev, (listeners.get(ev) ?? []).filter((f) => f !== fn)); return call; },
    off(ev: string, fn: (...a: unknown[]) => void) { return call.removeListener(ev, fn); },
    emit(ev: string, ...a: unknown[]) {
      if (ev === "ringing") st = "ringing";
      if (ev === "accept") st = "open";
      if (["disconnect", "cancel", "reject", "error"].includes(ev)) st = "closed";
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

interface ProbeProps { leadId: string; lock: string | null; wrapUp: boolean; enabled?: boolean }
function Probe({ leadId, lock, wrapUp, enabled = true }: ProbeProps) {
  const t = useTwilio();
  const dialled = useRef<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const session = useTeamOpenDialSession({
    enabled,
    callState: t.callState,
    lastCallDirection: t.lastCallDirection,
    currentCall: t.currentCall as TwilioCall | null,
    currentCallId: callId,
    dialledCampaignLeadIdRef: dialled,
    confirmedLockLeadId: lock,
  });
  const reveal = computeTeamOpenCallStatus({
    currentCampaignLeadId: leadId,
    confirmedLockLeadId: lock,
    callState: t.callState,
    inboundActive: isInboundActivity(t.callState, t.lastCallDirection, isVoiceSdkInboundDirection((t.currentCall as { direction?: string } | null)?.direction)),
    dialSession: session,
    showWrapUp: wrapUp,
  });
  return (
    <div>
      <span data-testid="status">{t.status}</span>
      <span data-testid="callState">{t.callState}</span>
      <span data-testid="reveal">{reveal}</span>
      <span data-testid="attempt">{session ? `${session.attemptId}:${session.answered}:${session.callRowId ?? "-"}` : "none"}</span>
      <button onClick={async () => {
        dialled.current = leadId; // as proceedWithCall does, before makeCall
        const id = await t.makeCall("+15550002222", CALLER, { campaignLeadId: leadId, campaignId: "camp-1" } as never);
        setCallId(id ?? null);
      }}>dial</button>
    </div>
  );
}

let props: ProbeProps;
function mount(p: ProbeProps) {
  props = p;
  return render(<TwilioProvider><Probe {...p} /></TwilioProvider>);
}
function rerenderWith(r: ReturnType<typeof render>, p: Partial<ProbeProps>) {
  props = { ...props, ...p };
  r.rerender(<TwilioProvider><Probe {...props} /></TwilioProvider>);
}
const reveal = () => screen.getByTestId("reveal").textContent;
const callState = () => screen.getByTestId("callState").textContent;
const attempt = () => screen.getByTestId("attempt").textContent;
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function ready(p: ProbeProps) {
  const r = mount(p);
  await waitFor(() => expect(voice.inits).toHaveLength(1));
  const it = voice.inits[0];
  voice.registered = it.device;
  await act(async () => { it.opts.onRegistered?.(it.device); it.resolve(it.device); });
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
  await settle(50); // phone numbers load
  return r;
}
async function dial(call: FakeCall) {
  voice.dialFactory = () => call;
  await act(async () => { screen.getByText("dial").click(); });
  await waitFor(() => expect(callState()).toBe("dialing"));
  await waitFor(() => expect(attempt()).not.toBe("none"));
}
async function emit(call: FakeCall, ev: string, ...a: unknown[]) {
  await act(async () => { call.emit(ev, ...a); });
}

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
afterEach(cleanup);

describe("Team/Open reveal × real TwilioProvider event mapping", () => {
  it("outbound media / early media while the destination rings: partial (ringing) only, never full", async () => {
    await ready({ leadId: "cl-A", lock: "cl-A", wrapUp: false });
    const call = fakeCall("OUTGOING");
    await dial(call);
    expect(reveal()).toBe("ringing");
    await emit(call, "ringing", true); // SDK ringing with early media (media up, not answered)
    expect(callState()).toBe("dialing");
    expect(reveal()).toBe("ringing");
  }, 15_000);

  it.each(["disconnect", "cancel", "reject", "error"])("unanswered outcome via %s: ends masked, never flashes full details", async (ev) => {
    await ready({ leadId: "cl-A", lock: "cl-A", wrapUp: false });
    const call = fakeCall("OUTGOING");
    await dial(call);
    await emit(call, "ringing", false);
    const seen: string[] = [];
    const obs = new MutationObserver(() => seen.push(reveal() ?? ""));
    obs.observe(screen.getByTestId("reveal"), { childList: true, characterData: true, subtree: true });
    await emit(call, ev, ev === "error" ? { message: "failed" } : undefined);
    await waitFor(() => expect(callState()).toMatch(/ended|idle/));
    await settle(300);
    obs.disconnect();
    expect(seen).not.toContain("connected");
    expect(reveal()).toBe("idle");
  }, 15_000);

  it("actual answered outbound (the attempt's own Call accept) → full reveal; wrap-up keeps it", async () => {
    const r = await ready({ leadId: "cl-A", lock: "cl-A", wrapUp: false });
    const call = fakeCall("OUTGOING");
    await dial(call);
    await emit(call, "accept");
    await waitFor(() => expect(callState()).toBe("active"));
    expect(reveal()).toBe("connected");
    await waitFor(() => expect(attempt()).toMatch(/^1:true:5555555/)); // calls-row id bound to THIS attempt
    await emit(call, "disconnect");
    rerenderWith(r, { wrapUp: true });
    await settle(300);
    expect(reveal()).toBe("connected");
  }, 15_000);

  it("a Call already accepted when the hook binds it still reveals (listener timing cannot break it)", async () => {
    await ready({ leadId: "cl-A", lock: "cl-A", wrapUp: false });
    const call = fakeCall("OUTGOING", { acceptOnFirstSubscribe: true });
    voice.dialFactory = () => call;
    await act(async () => { screen.getByText("dial").click(); });
    await waitFor(() => expect(callState()).toBe("active"));
    await waitFor(() => expect(reveal()).toBe("connected"));
  }, 15_000);

  it("repeat attempts to the same lead: answered never carries over; a prior attempt's late accept never counts", async () => {
    await ready({ leadId: "cl-A", lock: "cl-A", wrapUp: false });
    const first = fakeCall("OUTGOING");
    await dial(first);
    await emit(first, "accept");
    await waitFor(() => expect(reveal()).toBe("connected"));
    await emit(first, "disconnect");
    await waitFor(() => expect(callState()).toBe("idle"), { timeout: 3_000 });
    const second = fakeCall("OUTGOING");
    await dial(second);
    expect(attempt()).toMatch(/^2:false:/);
    expect(reveal()).toBe("ringing");
    await emit(first, "accept"); // late event from the PRIOR attempt's Call instance
    expect(attempt()).toMatch(/^2:false:/);
    expect(reveal()).not.toBe("connected");
    await emit(second, "accept");
    await waitFor(() => expect(reveal()).toBe("connected"));
  }, 20_000);

  it("inbound interruption never satisfies the outbound gate", async () => {
    await ready({ leadId: "cl-A", lock: "cl-A", wrapUp: false });
    const inbound = fakeCall("INCOMING");
    await act(async () => { voice.incoming!(inbound); });
    await waitFor(() => expect(callState()).toBe("incoming"));
    expect(reveal()).toBe("idle");
    expect(attempt()).toBe("none");
  }, 15_000);

  it("lock loss and a different lead loading during wrap-up mask immediately", async () => {
    const r = await ready({ leadId: "cl-A", lock: "cl-A", wrapUp: false });
    const call = fakeCall("OUTGOING");
    await dial(call);
    await emit(call, "accept");
    await waitFor(() => expect(reveal()).toBe("connected"));
    await emit(call, "disconnect");
    rerenderWith(r, { wrapUp: true });
    await settle(300);
    expect(reveal()).toBe("connected");
    rerenderWith(r, { lock: null });
    expect(reveal()).toBe("idle");
    rerenderWith(r, { leadId: "cl-B", lock: "cl-B" });
    expect(reveal()).toBe("idle");
    expect(attempt()).toBe("none");
  }, 15_000);

  it("the hook removes only its own accept listener", async () => {
    const r = await ready({ leadId: "cl-A", lock: "cl-A", wrapUp: false });
    const call = fakeCall("OUTGOING");
    await dial(call);
    await waitFor(() => expect(call.count("accept")).toBe(2)); // provider's + this hook's
    rerenderWith(r, { enabled: false });
    await waitFor(() => expect(call.count("accept")).toBe(1)); // provider's listener untouched
  }, 15_000);
});
