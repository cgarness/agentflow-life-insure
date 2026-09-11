/**
 * Inbound Calling v2 — availability derivation (pure; implementation_plan.md rev 3 §6.3, P14).
 * MANUAL states are the only stored values an agent picks; "On a Call" and "Offline" are derived from
 * the Device and never persisted as availability (the server derives connectivity from presence).
 */
export const MANUAL_AVAILABILITY = ["Available", "On Break", "Do Not Disturb"] as const;
export type ManualAvailability = (typeof MANUAL_AVAILABILITY)[number];

export const AVAILABILITY_DOT_CLASS: Record<string, string> = {
  Available: "bg-success",
  "On Break": "bg-warning",
  "Do Not Disturb": "bg-destructive",
  "On a Call": "bg-teal-400",
  "Offline (phone disconnected)": "bg-muted-foreground/50",
};

export function deriveEffectiveAvailability(args: {
  manual: ManualAvailability | string;
  phoneConnected: boolean;
  onCall: boolean;
}): string {
  if (args.onCall) return "On a Call";
  if (!args.phoneConnected) return "Offline (phone disconnected)";
  return args.manual;
}
