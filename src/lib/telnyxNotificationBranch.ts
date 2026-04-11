/** SDK `telnyx.notification` call branch for state machine / UI (unit-tested). */
export type TelnyxNotificationBranch = "incoming" | "dialing" | "active" | "ended" | "other";

export function resolveTelnyxNotificationBranch(call: {
  direction?: string;
  state?: string;
}): TelnyxNotificationBranch {
  const dir = call.direction;
  const state = call.state;
  if (state === "destroy" || state === "hangup") return "ended";
  if (state === "active") return "active";
  if (dir === "inbound") {
    if (
      state === "ringing" ||
      state === "new" ||
      state === "early" ||
      state === "trying" ||
      state === "requesting" ||
      state === "answering"
    ) {
      return "incoming";
    }
  }
  if (state === "ringing" || state === "trying" || state === "early") return "dialing";
  return "other";
}
