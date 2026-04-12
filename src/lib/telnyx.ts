// IMPORTANT: Add VITE_TELNYX_SIP_USERNAME and VITE_TELNYX_SIP_PASSWORD to your .env file.
// These must be prefixed with VITE_ to be accessible in the browser.

import { TelnyxRTC } from "@telnyx/webrtc";
import { resolveTelnyxNotificationBranch, isTelnyxSdkInboundDirection } from "@/lib/telnyxNotificationBranch";

let telnyxClient: TelnyxRTC | null = null;

/** Payload passed to subscribers when an inbound call is ringing (MVP pub/sub). */
export type IncomingCallNotificationPayload = {
  call: unknown;
  rawNotification: unknown;
};

type IncomingSubscriber = (payload: IncomingCallNotificationPayload) => void;

const incomingSubscribers = new Set<IncomingSubscriber>();
const wiredClients = new WeakSet<TelnyxRTC>();

function dispatchIncoming(payload: IncomingCallNotificationPayload): void {
  incomingSubscribers.forEach((fn) => {
    try {
      fn(payload);
    } catch (e) {
      console.warn("[telnyx] incoming subscriber error:", e);
    }
  });
}

/**
 * Subscribe to inbound (ringing) WebRTC call notifications.
 * Unsubscribe by calling the returned teardown function.
 */
export function subscribeIncomingCall(cb: IncomingSubscriber): () => void {
  incomingSubscribers.add(cb);
  return () => incomingSubscribers.delete(cb);
}

/**
 * Wire Telnyx SDK notifications for incoming calls and fan out to subscribers.
 * Safe to call once per client instance (idempotent).
 *
 * The SDK emits `telnyx.notification`; some examples also use `notification`, so both are bound.
 */
export function wireTelnyxIncomingNotifications(client: TelnyxRTC): void {
  if (wiredClients.has(client)) return;
  wiredClients.add(client);

  const handler = (notification: { call?: { direction?: string; state?: string } }) => {
    const call = notification?.call;
    if (!call) return;
    if (!isTelnyxSdkInboundDirection(call.direction)) return;
    const branch = resolveTelnyxNotificationBranch({
      direction: call.direction,
      state: call.state,
    });
    if (branch !== "incoming") return;
    dispatchIncoming({ call, rawNotification: notification });
  };

  client.on("telnyx.notification", handler);
  client.on("notification", handler);
}

export async function initTelnyx(): Promise<TelnyxRTC> {
  if (telnyxClient && telnyxClient.connected) {
    return telnyxClient;
  }

  // Request mic permission before initializing
  await navigator.mediaDevices.getUserMedia({ audio: true });

  telnyxClient = new TelnyxRTC({
    login: import.meta.env.VITE_TELNYX_SIP_USERNAME,
    password: import.meta.env.VITE_TELNYX_SIP_PASSWORD,
  });

  wireTelnyxIncomingNotifications(telnyxClient);
  telnyxClient.connect();
  return telnyxClient;
}

export async function makeCall(destinationNumber: string, callerId: string) {
  const client = await initTelnyx();
  const call = client.newCall({
    destinationNumber,
    callerNumber: callerId,
  });
  return call;
}

export function hangUp(call: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call.hangup();
}
