/** Voice SDK notification envelope branch for state machine / UI (unit-tested). */
export type VoiceSdkNotificationBranch = "incoming" | "dialing" | "active" | "ended" | "other";

/**
 * Call rows use `inbound`; some browser voice SDKs report the same leg as `incoming`.
 * Treat both everywhere we branch on SDK `call.direction`.
 */
export function isVoiceSdkInboundDirection(direction?: string | null): boolean {
  const d = String(direction ?? "").toLowerCase();
  return d === "inbound" || d === "incoming";
}

export function resolveVoiceSdkNotificationBranch(call: {
  direction?: string;
  state?: string;
}): VoiceSdkNotificationBranch {
  const dir = call.direction;
  const state = call.state;
  if (state === "destroy" || state === "hangup") return "ended";
  if (state === "active") return "active";
  if (isVoiceSdkInboundDirection(dir)) {
    return "incoming";
  }
  if (state === "ringing" || state === "trying" || state === "early") return "dialing";
  return "other";
}
