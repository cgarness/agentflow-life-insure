/**
 * Inbound Calling v2 — availability derivation (pure; implementation_plan.md rev 3 §6.3, P14; corrective
 * pass defect 6). The three MANUAL states are the only values an agent picks; a STORED `Offline` (legacy
 * value, or set by an earlier profile save) is shown truthfully because the routing engine treats it as
 * "not connected" (calls skip the browser and follow D3 — mobile, then voicemail). "On a Call" and
 * "Offline (phone disconnected)" are derived from the Device and never persisted. Availability only
 * changes routing once the organization runs the v2 engine; before that it is PENDING ACTIVATION.
 */
export const MANUAL_AVAILABILITY = ["Available", "On Break", "Do Not Disturb"] as const;
export type ManualAvailability = (typeof MANUAL_AVAILABILITY)[number];
export type StoredAvailability = ManualAvailability | "Offline";
export type RoutingEngine = "legacy" | "v2" | "unknown";

export const LABEL_ON_CALL = "On a Call";
export const LABEL_PHONE_DISCONNECTED = "Offline (phone disconnected)";
export const LABEL_STORED_OFFLINE = "Offline (set on your profile)";

export const AVAILABILITY_DOT_CLASS: Record<string, string> = {
  Available: "bg-success",
  "On Break": "bg-warning",
  "Do Not Disturb": "bg-destructive",
  [LABEL_ON_CALL]: "bg-teal-400",
  [LABEL_PHONE_DISCONNECTED]: "bg-muted-foreground/50",
  [LABEL_STORED_OFFLINE]: "bg-muted-foreground/50",
};

export function normalizeStoredAvailability(raw: string | null | undefined): StoredAvailability {
  const v = (raw || "").trim();
  if ((MANUAL_AVAILABILITY as readonly string[]).includes(v)) return v as ManualAvailability;
  if (v === "Offline") return "Offline";
  return "Available";
}

export function deriveEffectiveAvailability(args: {
  stored: StoredAvailability | string;
  phoneConnected: boolean;
  onCall: boolean;
}): string {
  if (args.onCall) return LABEL_ON_CALL;
  if (args.stored === "Offline") return LABEL_STORED_OFFLINE;
  if (!args.phoneConnected) return LABEL_PHONE_DISCONNECTED;
  return args.stored;
}

/** What the active routing engine actually does with the stored value (shown next to the picker). */
export function describeAvailabilityEffect(args: { stored: StoredAvailability | string; engine: RoutingEngine }): {
  activationPending: boolean;
  routing: string;
} {
  if (args.engine !== "v2") {
    return {
      activationPending: true,
      routing: args.engine === "unknown"
        ? "Routing engine unknown — the setting is saved and applies once Inbound Calling v2 is active."
        : "Pending activation: the legacy routing engine does not use availability yet. The setting is saved and applies once Inbound Calling v2 is active.",
    };
  }
  switch (args.stored) {
    case "Offline":
      return { activationPending: false, routing: "Inbound calls skip AgentFlow and go to your mobile, then voicemail. Choose Available to ring here." };
    case "On Break":
    case "Do Not Disturb":
      return { activationPending: false, routing: "Inbound calls go straight to your voicemail (browser and mobile are skipped)." };
    default:
      return { activationPending: false, routing: "Inbound calls ring here while your phone is connected; unanswered calls forward to your mobile." };
  }
}

/**
 * Announced by the administrator card whenever it learns the organization's routing engine (initial load
 * and every successful switch), so the availability surfaces in the SAME session (top bar, profile card)
 * describe the engine that is actually enforcing availability — no page reload required.
 */
export const ROUTING_ENGINE_EVENT = "agentflow:routing-engine";

export function announceRoutingEngine(engine: RoutingEngine): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent(ROUTING_ENGINE_EVENT, { detail: { engine } }));
}

export function readAnnouncedEngine(event: Event): RoutingEngine | null {
  const engine = (event as CustomEvent<{ engine?: unknown }>).detail?.engine;
  return engine === "v2" || engine === "legacy" || engine === "unknown" ? engine : null;
}
