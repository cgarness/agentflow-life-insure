/**
 * Twilio Voice SDK wrapper — core browser
 * telephony library. Owns Device lifecycle, token fetch/refresh, and the
 * incoming-call pub/sub that TwilioContext consumes (Phase 7).
 */

import { Call, Device } from "@twilio/voice-sdk";
import { supabase } from "@/integrations/supabase/client";

export type { Call as TwilioCall, Device as TwilioDevice } from "@twilio/voice-sdk";

/** Payload passed to subscribers when an inbound call is ringing (MVP pub/sub). */
export type IncomingCallNotificationPayload = {
  call: Call;
  rawNotification: unknown;
};

type IncomingSubscriber = (payload: IncomingCallNotificationPayload) => void;

export type TwilioTokenResponse = {
  token: string;
  identity: string;
  expires_in: number;
};

const incomingSubscribers = new Set<IncomingSubscriber>();

let twilioDevice: Device | null = null;
let currentToken: string | null = null;
let currentIdentity: string | null = null;
let registering: Promise<Device> | null = null;
/**
 * Inbound Calling v2 (§6.1): an in-flight teardown is awaited by the next init so a destroy that is
 * still unregistering can never race a fresh registration of the same identity (two Devices, one of
 * them silently dying with the inbound ring).
 */
let destroying: Promise<void> | null = null;
/**
 * Lifecycle GENERATION (corrective pass, defect 2). `destroyTwilioDevice()` bumps it. Every pending
 * `initTwilioDevice()` captured the generation it started in and fails closed at its next checkpoint
 * (after the token fetch, after `register()`) when the generation moved — a token fetch that was in
 * flight during logout can no longer resume and register a Device nobody owns. Every Device listener
 * is also bound to its generation, so callbacks from an obsolete Device are ignored.
 */
let lifecycleGen = 0;

export class TwilioInitStaleError extends Error {
  constructor() {
    super("Twilio Device initialization was superseded by a teardown");
    this.name = "TwilioInitStaleError";
  }
}

export function isTwilioDeviceDestroying(): boolean {
  return destroying !== null;
}

export function getTwilioLifecycleGeneration(): number {
  return lifecycleGen;
}

function dispatchIncoming(payload: IncomingCallNotificationPayload): void {
  incomingSubscribers.forEach((fn) => {
    try {
      fn(payload);
    } catch (e) {
      console.warn("[twilio-voice] incoming subscriber error:", e);
    }
  });
}

/** Clears all inbound listeners (used before re-init / full teardown). */
export function clearIncomingCallHandlers(): void {
  incomingSubscribers.clear();
}

/**
 * Subscribe to inbound (ringing) Twilio call notifications.
 * Returns a teardown function — matches the prior pub/sub contract used by TwilioContext.
 */
export function subscribeIncomingCall(cb: IncomingSubscriber): () => void {
  incomingSubscribers.add(cb);
  return () => {
    incomingSubscribers.delete(cb);
  };
}

/** Convenience: subscribe with `(call) => void` (TwilioContext). */
export function subscribeToIncomingCalls(cb: (call: Call) => void): void {
  subscribeIncomingCall(({ call }) => cb(call));
}

export function unsubscribeFromIncomingCalls(_cb: IncomingSubscriber | ((call: Call) => void)): void {
  /* Prefer clearIncomingCallHandlers() when re-initializing the Device. */
}

/** Fetches a fresh Access Token from the `twilio-token` Edge Function. */
export async function fetchTwilioToken(): Promise<TwilioTokenResponse> {
  const { data, error } = await supabase.functions.invoke<TwilioTokenResponse>("twilio-token");
  if (error) {
    console.error("[twilio-voice] fetchTwilioToken error:", error);
    throw error;
  }
  if (!data?.token || !data?.identity) {
    throw new Error("[twilio-voice] twilio-token returned an invalid payload");
  }
  // Module state (getCurrentIdentity / getCurrentToken) is written by the LIVE caller after its own
  // generation check, so a stale fetch that resolves late never clobbers a newer generation's values.
  return data;
}

export type InitTwilioDeviceOptions = {
  /** Fired on the SDK's `registered` event with the Device that registered (available synchronously here). */
  onRegistered?: (device: Device) => void;
  onUnregistered?: (device: Device) => void;
  onError?: (err: Error, device: Device) => void;
  /**
   * AudioHelper `deviceChange` — the set of available audio devices changed (headset plugged in or
   * removed). `lostActiveDevices` lists active devices that disappeared. The SDK itself drops a lost
   * device from `ringtoneDevices`; the provider re-applies the saved ring-output preference here.
   */
  onDeviceChange?: (device: Device, lostActiveDevices: MediaDeviceInfo[]) => void;
};

/**
 * The handlers of the LATEST `initTwilioDevice()` call. Listeners are bound to a Device once and read
 * this holder at event time, so a recovery that finds the Device still registered (an `error` that
 * did not unregister it) re-targets every later `unregistered` / `error` / `deviceChange` to the
 * current coordinator generation instead of a generation that no longer listens.
 */
let activeOpts: InitTwilioDeviceOptions | undefined;

function wireDeviceListeners(device: Device, gen: number): void {
  // A callback is honoured only while this Device is the CURRENT one of the CURRENT generation.
  const live = () => gen === lifecycleGen && twilioDevice === device;
  const opts = () => activeOpts;

  device.on("registered", () => {
    if (!live()) return;
    console.log("[twilio-voice] device registered, identity:", currentIdentity);
    opts()?.onRegistered?.(device);
  });

  device.on("unregistered", () => {
    if (!live()) return;
    console.log("[twilio-voice] device unregistered");
    opts()?.onUnregistered?.(device);
  });

  device.on("error", (error: unknown) => {
    if (!live()) return;
    console.error("[twilio-voice] device error:", error);
    opts()?.onError?.(error instanceof Error ? error : new Error(String(error)), device);
  });

  device.on("incoming", (call: Call) => {
    if (!live()) {
      // an obsolete Device that still receives a call must not ring a torn-down provider
      try { call.reject(); } catch { /* ignore */ }
      return;
    }
    dispatchIncoming({ call, rawNotification: call });
  });

  device.on("tokenWillExpire", async () => {
    if (!live()) return;
    try {
      console.log("[twilio-voice] tokenWillExpire → refreshing");
      const { token, identity } = await fetchTwilioToken();
      if (!live()) return;
      currentToken = token;
      currentIdentity = identity;
      device.updateToken(token);
      console.log("[twilio-voice] token refreshed");
    } catch (e) {
      console.error("[twilio-voice] token refresh failed:", e);
    }
  });

  try {
    device.audio?.on("deviceChange", (lost: MediaDeviceInfo[] | undefined) => {
      if (!live()) return;
      opts()?.onDeviceChange?.(device, Array.isArray(lost) ? lost : []);
    });
  } catch (e) {
    console.warn("[twilio-voice] audio deviceChange listener unavailable:", e);
  }
}

function retireDevice(device: Device): void {
  try {
    if (device.state === Device.State.Registered) {
      device.unregister().catch(() => { /* already going away */ });
    }
  } catch {
    /* ignore */
  }
  try {
    device.destroy();
  } catch (e) {
    console.warn("[twilio-voice] destroy error:", e);
  }
}

/**
 * Initializes (or returns the existing) Twilio Device singleton. Fetches a token, constructs the
 * Device, wires listeners, and registers. The Device is published to `getTwilioDevice()` BEFORE
 * `register()` because the SDK (2.18.1 `Device.register`) resolves that promise only AFTER emitting
 * `registered` — so `onRegistered` receives the Device instance and the getter is already valid
 * during the event (corrective pass, defect 1). Every await is a generation checkpoint: a teardown in
 * the meantime makes this call retire whatever it built and reject with TwilioInitStaleError.
 */
export async function initTwilioDevice(opts?: InitTwilioDeviceOptions): Promise<Device> {
  const gen = lifecycleGen;
  if (destroying) {
    try {
      await destroying;
    } catch {
      /* teardown errors are logged by destroyTwilioDevice */
    }
  }
  if (gen !== lifecycleGen) throw new TwilioInitStaleError();
  activeOpts = opts;   // the current caller's handlers, whether the Device is reused, joined or built
  if (twilioDevice && twilioDevice.state === Device.State.Registered) {
    try {
      twilioDevice.audio?.outgoing(false);
    } catch {
      /* ignore */
    }
    return twilioDevice;
  }
  if (registering) return registering;

  const attempt = (async () => {
    // A Device left in a non-registered state (after `unregistered`/`error`) is retired before a new
    // one is built, so at most one Device exists per generation.
    const previous = twilioDevice;
    if (previous) {
      twilioDevice = null;
      retireDevice(previous);
    }
    const { token, identity } = await fetchTwilioToken();
    if (gen !== lifecycleGen) throw new TwilioInitStaleError();   // a newer generation owns the module state
    currentToken = token;
    currentIdentity = identity;

    const device = new Device(token, {
      edge: "ashburn",
      region: "us1",
      closeProtection: true,
      codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
      // Emits Call "ringing" for outbound when callee is alerted (pairs with Dial answerOnBridge).
      enableRingingState: true,
    });

    twilioDevice = device;   // visible to getTwilioDevice() during the `registered` event
    wireDeviceListeners(device, gen);
    try {
      await device.register();
    } catch (e) {
      if (twilioDevice === device) twilioDevice = null;
      retireDevice(device);
      throw e;
    }
    if (gen !== lifecycleGen || twilioDevice !== device) {
      // torn down while registering: the late Device is retired and never handed out
      retireDevice(device);
      throw new TwilioInitStaleError();
    }

    // Twilio plays a short "outgoing" chime when the PSTN leg connects — turn it off; call audio is unchanged.
    try {
      device.audio?.outgoing(false);
    } catch {
      /* older SDKs may omit audio helper */
    }
    return device;
  })();

  registering = attempt;
  try {
    return await attempt;
  } finally {
    if (registering === attempt) registering = null;
  }
}

/** Initiates an outbound call via the registered Device. */
export async function twilioMakeCall(params: {
  to: string;
  callerId: string;
  callRowId: string;
  orgId: string;
}): Promise<Call> {
  const device = twilioDevice;
  if (!device || device.state !== Device.State.Registered) {
    throw new Error("[twilio-voice] device is not registered — call initTwilioDevice() first");
  }

  const call = await device.connect({
    params: {
      To: params.to,
      CallerId: params.callerId,
      CallRowId: params.callRowId,
      OrgId: params.orgId,
    },
  });
  return call;
}

/** Disconnects a single active call. */
export function twilioHangUp(call: Call): void {
  call.disconnect();
}

/** Disconnects every active call on the Device. */
export function twilioHangUpAll(): void {
  twilioDevice?.disconnectAll();
}

/** Accepts a ringing inbound call. */
export async function twilioAnswerCall(
  call: Call,
  options?: { rtcConstraints?: MediaStreamConstraints },
): Promise<void> {
  if (options?.rtcConstraints) {
    await call.accept({ rtcConstraints: options.rtcConstraints });
  } else {
    call.accept();
  }
}

/** Rejects a ringing inbound call. */
export function twilioRejectCall(call: Call): void {
  call.reject();
}

/**
 * Tears down the Device. Inbound Calling v2 (§6.1): PROVIDER-OWNED — called only by TwilioProvider on
 * identity loss (logout / user change) or before a re-initialisation; UI surfaces (floating dialer
 * close, dialer session end) never call it, so the Device stays registered for the whole sign-in and
 * inbound readiness (D1) does not depend on which panel is open.
 *
 * Bumps the lifecycle generation FIRST: a pending `initTwilioDevice` (token fetch or `register()` in
 * flight) fails closed at its next checkpoint and retires whatever it built; listeners of older
 * Devices are ignored from here on.
 */
export async function destroyTwilioDevice(): Promise<void> {
  lifecycleGen += 1;
  registering = null;
  activeOpts = undefined;
  clearIncomingCallHandlers();
  const device = twilioDevice;
  twilioDevice = null;
  currentToken = null;
  currentIdentity = null;
  if (destroying) {
    try {
      await destroying;
    } catch {
      /* logged below */
    }
  }
  if (!device) return;
  const teardown = (async () => {
    try {
      await device.unregister();
    } catch (e) {
      console.warn("[twilio-voice] unregister error:", e);
    }
    try {
      device.destroy();
    } catch (e) {
      console.warn("[twilio-voice] destroy error:", e);
    }
  })();
  destroying = teardown;
  try {
    await teardown;
  } finally {
    if (destroying === teardown) destroying = null;
  }
}

/** Returns the CallSid for an established Call. */
export function getCallSid(call: Call): string {
  return call.parameters.CallSid ?? "";
}

/** Normalizes Twilio's uppercase INCOMING / OUTGOING to lowercase inbound / outbound. */
export function getCallDirection(call: Call): "inbound" | "outbound" {
  const raw = String(call.direction ?? "").toLowerCase();
  return raw === "incoming" ? "inbound" : "outbound";
}

/** Returns the current Twilio call status string (ringing / open / closed / ...). */
export function getCallStatus(call: Call): string {
  return call.status();
}

/** Module-level getters for the cached identity — used by UI / debugging. */
export function getCurrentIdentity(): string | null {
  return currentIdentity;
}

export function getCurrentToken(): string | null {
  return currentToken;
}

export function getTwilioDevice(): Device | null {
  return twilioDevice;
}

/**
 * Locates the HTML audio element Twilio Voice.js injects for remote playback
 * (srcObject = remote MediaStream, typically autoplay). Used for browser-side
 * recording via captureStream().
 */
export function findTwilioRemoteAudioElement(): HTMLAudioElement | null {
  if (typeof document === "undefined") return null;
  const nodes = document.querySelectorAll("audio");
  for (let i = 0; i < nodes.length; i++) {
    const element = nodes[i];
    if (!(element instanceof HTMLAudioElement)) continue;
    const src = element.srcObject;
    if (!(src instanceof MediaStream) || src.getAudioTracks().length === 0) {
      continue;
    }
    if (element.autoplay === true || !element.paused) {
      return element;
    }
  }
  return null;
}

/**
 * Probes microphone permission so the UI can surface a warning. The Twilio SDK
 * itself handles mic acquisition during device.connect() / call.accept() — this
 * is purely an informational check, NOT a prerequisite for placing a call.
 */
export async function checkMicrophonePermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}
