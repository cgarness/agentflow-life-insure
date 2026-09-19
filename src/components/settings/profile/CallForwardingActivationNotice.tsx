import React from "react";
import type { RoutingEngine } from "@/lib/agentAvailability";

/**
 * Shown only while the agency's call forwarding is not known to be active. The two states are kept
 * distinct on purpose: an UNCONFIRMED state is never reported as "not available", because we would
 * be asserting something we have not established. Neither string names the routing engine.
 *
 * `engine` keeps the `RoutingEngine` union rather than widening to `string`: it is the discriminator
 * that chooses between those two states, so a typo here must stay a compile error.
 */
export const CallForwardingActivationNotice: React.FC<{ engine: RoutingEngine }> = ({ engine }) => (
  <p
    className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground"
    data-testid="call-forwarding-pending"
    data-engine={engine}
  >
    {engine === "legacy"
      ? "Call forwarding isn't available for your agency yet. Your settings are saved and apply once it's turned on."
      : "We couldn't confirm whether call forwarding is active for your agency. Your settings are saved either way."}
  </p>
);

export default CallForwardingActivationNotice;
