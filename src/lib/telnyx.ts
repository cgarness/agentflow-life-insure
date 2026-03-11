// IMPORTANT: Add VITE_TELNYX_SIP_USERNAME and VITE_TELNYX_SIP_PASSWORD to your .env file.
// These must be prefixed with VITE_ to be accessible in the browser.

import { TelnyxRTC } from "@telnyx/webrtc";

let telnyxClient: TelnyxRTC | null = null;

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

export function hangUp(call: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  call.hangup();
}
