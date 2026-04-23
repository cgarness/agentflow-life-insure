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
  currentToken = data.token;
  currentIdentity = data.identity;
  return data;
}

export type InitTwilioDeviceOptions = {
  onRegistered?: () => void;
  onUnregistered?: () => void;
  onError?: (err: Error) => void;
};

function wireDeviceListeners(device: Device, opts?: InitTwilioDeviceOptions): void {
  device.on("registered", () => {
    console.log("[twilio-voice] device registered, identity:", currentIdentity);
    opts?.onRegistered?.();
  });

  device.on("unregistered", () => {
    console.log("[twilio-voice] device unregistered");
    opts?.onUnregistered?.();
  });

  device.on("error", (error: unknown) => {
    console.error("[twilio-voice] device error:", error);
    opts?.onError?.(error instanceof Error ? error : new Error(String(error)));
  });

  device.on("incoming", (call: Call) => {
    dispatchIncoming({ call, rawNotification: call });
  });

  device.on("tokenWillExpire", async () => {
    try {
      console.log("[twilio-voice] tokenWillExpire → refreshing");
      const { token } = await fetchTwilioToken();
      device.updateToken(token);
      console.log("[twilio-voice] token refreshed");
    } catch (e) {
      console.error("[twilio-voice] token refresh failed:", e);
    }
  });
}

/**
 * Initializes (or returns the existing) Twilio Device singleton. Fetches a
 * token, constructs the Device, wires listeners, and registers.
 */
export async function initTwilioDevice(opts?: InitTwilioDeviceOptions): Promise<Device> {
  if (twilioDevice && twilioDevice.state === Device.State.Registered) {
    try {
      twilioDevice.audio?.outgoing(false);
    } catch {
      /* ignore */
    }
    return twilioDevice;
  }
  if (registering) return registering;

  registering = (async () => {
    const { token } = await fetchTwilioToken();

    const device = new Device(token, {
      edge: "ashburn",
      region: "us1",
      closeProtection: true,
      codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
      // Emits Call "ringing" for outbound when callee is alerted (pairs with Dial answerOnBridge).
      enableRingingState: true,
    });

    wireDeviceListeners(device, opts);
    await device.register();

    // Twilio plays a short "outgoing" chime when the PSTN leg connects — turn it off; call audio is unchanged.
    try {
      device.audio?.outgoing(false);
    } catch {
      /* older SDKs may omit audio helper */
    }

    twilioDevice = device;
    return device;
  })();

  try {
    return await registering;
  } finally {
    registering = null;
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

/** Tears down the Device (used on logout / navigation away). */
export async function destroyTwilioDevice(): Promise<void> {
  clearIncomingCallHandlers();
  if (!twilioDevice) return;
  try {
    await twilioDevice.unregister();
  } catch (e) {
    console.warn("[twilio-voice] unregister error:", e);
  }
  try {
    twilioDevice.destroy();
  } catch (e) {
    console.warn("[twilio-voice] destroy error:", e);
  }
  twilioDevice = null;
  currentToken = null;
  currentIdentity = null;
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
