/** SDK `telnyx.notification` call branch for state machine / UI (unit-tested). */
export type TelnyxNotificationBranch = "incoming" | "dialing" | "active" | "ended" | "other";

/**
 * Telnyx Call Control / DB use `inbound`; the WebRTC JS SDK often reports the same leg as `incoming`.
 * Treat both everywhere we branch on SDK `call.direction`.
 */
export function isTelnyxSdkInboundDirection(direction?: string | null): boolean {
  const d = String(direction ?? "").toLowerCase();
  return d === "inbound" || d === "incoming";
}

export function resolveTelnyxNotificationBranch(call: {
  direction?: string;
  state?: string;
}): TelnyxNotificationBranch {
  const dir = call.direction;
  const state = call.state;
  if (state === "destroy" || state === "hangup") return "ended";
  if (state === "active") return "active";
  if (isTelnyxSdkInboundDirection(dir)) {
    if (
      state === "ringing" ||
      state === "new" ||
      state === "early" ||
      state === "trying" ||
      state === "requesting" ||
      state === "answering" ||
      state === "recovering"
    ) {
      return "incoming";
    }
  }
  if (state === "ringing" || state === "trying" || state === "early") return "dialing";
  return "other";
}
