import React from "react";
import type { CallState } from "@/contexts/TelnyxContext";

type Props = {
  callState: CallState;
  lastCallDirection: "inbound" | "outbound";
  onCall: boolean;
};

/** Uppercase phase line: outbound dial vs active inbound vs active outbound. */
export const DialerCallPhaseLabel: React.FC<Props> = ({ callState, lastCallDirection, onCall }) => {
  if (callState === "dialing") {
    return (
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-center">
        Calling…
      </p>
    );
  }
  if (onCall && callState === "active") {
    const label = lastCallDirection === "inbound" ? "Inbound call" : "Outbound call";
    return (
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-center">
        {label}
      </p>
    );
  }
  return null;
};
