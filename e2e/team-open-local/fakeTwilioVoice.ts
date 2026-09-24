/**
 * TEST-ONLY browser fake of `@/lib/twilio-voice` for the isolated LOCAL verification harness
 * (implementation_plan.md §10). It is swapped in ONLY by `vite.local.config.ts`. It has no network,
 * no Twilio SDK and no token fetch, so it cannot place calls. It exposes the same exports the app
 * imports, and it models Voice.js the same way the Vitest integration fake does: an outbound Call's
 * status is "open" only after `accept`.
 *
 * The Playwright driver controls it through `window.__fakeVoice`. Every simulated event is recorded
 * in `window.__fakeVoice.log`.
 */
export type { Call as TwilioCall, Device as TwilioDevice } from "@twilio/voice-sdk";

type Listener = (...a: unknown[]) => void;
type Subscriber = (payload: { call: FakeCall; rawNotification: unknown }) => void;

export type TwilioTokenResponse = { token: string; identity: string; expires_in: number };
export type IncomingCallNotificationPayload = { call: FakeCall; rawNotification: unknown };
export type InitTwilioDeviceOptions = {
  onRegistered?: (device: FakeDevice) => void;
  onUnregistered?: (device: FakeDevice) => void;
  onError?: (err: Error, device: FakeDevice) => void;
  onDeviceChange?: (device: FakeDevice, lost: unknown[]) => void;
};

export class TwilioInitStaleError extends Error {}

class FakeCall {
  private listeners = new Map<string, Listener[]>();
  private st = "connecting";
  customParameters = new Map<string, string>();
  constructor(public direction: "OUTGOING" | "INCOMING", public parameters: Record<string, string>) {}
  on(ev: string, fn: Listener) { (this.listeners.get(ev) ?? this.listeners.set(ev, []).get(ev)!).push(fn); return this; }
  removeListener(ev: string, fn: Listener) { this.listeners.set(ev, (this.listeners.get(ev) ?? []).filter((f) => f !== fn)); return this; }
  off(ev: string, fn: Listener) { return this.removeListener(ev, fn); }
  emit(ev: string, ...a: unknown[]) {
    if (ev === "ringing") this.st = "ringing";
    if (ev === "accept") this.st = "open";
    if (["disconnect", "cancel", "reject", "error"].includes(ev)) this.st = "closed";
    fake.log.push({ at: Date.now(), ev, dir: this.direction, sid: this.parameters.CallSid });
    for (const fn of [...(this.listeners.get(ev) ?? [])]) fn(...a);
  }
  status() { return this.st; }
  accept() { this.emit("accept"); }
  reject() { this.emit("reject"); }
  ignore() {}
  disconnect() { if (this.st !== "closed") this.emit("disconnect", this); }
  mute() {}
  isMuted() { return false; }
  getRemoteStream() { return null; }
  getLocalStream() { return null; }
}

class FakeDevice {
  state = "registered";
  audio = { isOutputSelectionSupported: false, outgoing: () => {}, incoming: () => {} };
  destroy() { this.state = "destroyed"; }
  disconnectAll() { fake.calls.forEach((c) => c.disconnect()); }
}

const subscribers = new Set<Subscriber>();
let device: FakeDevice | null = null;
let seq = 0;

const fake = {
  log: [] as Array<Record<string, unknown>>,
  calls: [] as FakeCall[],
  lastDial: null as null | Record<string, string>,
  current(): FakeCall | null { return fake.calls[fake.calls.length - 1] ?? null; },
  emit(ev: string) { fake.current()?.emit(ev); },
  incoming(from = "+15550001234") {
    const call = new FakeCall("INCOMING", { From: from, CallSid: `CAFAKEIN${String(++seq).padStart(24, "0")}` });
    fake.calls.push(call);
    subscribers.forEach((fn) => fn({ call, rawNotification: null }));
    return call.parameters.CallSid;
  },
};
(window as unknown as { __fakeVoice: typeof fake }).__fakeVoice = fake;

export function isTwilioDeviceDestroying() { return false; }
export function getTwilioLifecycleGeneration() { return 0; }
export function clearIncomingCallHandlers() { subscribers.clear(); }
export function subscribeIncomingCall(cb: Subscriber) { subscribers.add(cb); return () => { subscribers.delete(cb); }; }
export function subscribeToIncomingCalls(cb: (call: FakeCall) => void) { subscribeIncomingCall(({ call }) => cb(call)); }
export function unsubscribeFromIncomingCalls() {}
export async function fetchTwilioToken(): Promise<TwilioTokenResponse> {
  return { token: "fake-local-token", identity: "fake-local-identity", expires_in: 3600 };
}
export async function initTwilioDevice(opts?: InitTwilioDeviceOptions) {
  device = device ?? new FakeDevice();
  queueMicrotask(() => opts?.onRegistered?.(device!));
  return device;
}
export async function twilioMakeCall(params: { to: string; callerId: string; callRowId: string; orgId: string }) {
  fake.lastDial = { ...params };
  const call = new FakeCall("OUTGOING", { To: params.to, CallSid: `CAFAKEOUT${String(++seq).padStart(23, "0")}` });
  fake.calls.push(call);
  fake.log.push({ at: Date.now(), ev: "connect", dir: "OUTGOING", callRowId: params.callRowId });
  return call;
}
export function twilioHangUp(call: FakeCall) { call.disconnect(); }
export function twilioHangUpAll() { device?.disconnectAll(); }
export async function twilioAnswerCall(call: FakeCall) { call.accept(); }
export function twilioRejectCall(call: FakeCall) { call.reject(); }
export async function destroyTwilioDevice() { device?.destroy(); device = null; subscribers.clear(); }
export function getCallSid(call: FakeCall) { return call.parameters.CallSid ?? ""; }
export function getCallDirection(call: FakeCall): "inbound" | "outbound" {
  return String(call.direction ?? "").toLowerCase() === "incoming" ? "inbound" : "outbound";
}
export function getCallStatus(call: FakeCall) { return call.status(); }
export function getCurrentIdentity() { return device ? "fake-local-identity" : null; }
export function getCurrentToken() { return device ? "fake-local-token" : null; }
export function getTwilioDevice() { return device; }
export function findTwilioRemoteAudioElement() { return null; }
export async function checkMicrophonePermission() { return true; }
