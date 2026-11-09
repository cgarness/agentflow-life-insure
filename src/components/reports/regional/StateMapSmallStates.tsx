import React from "react";
import { cn } from "@/lib/utils";
import { SMALL_STATE_CODES } from "@/lib/reports-regional";

/** The 9 small jurisdictions as plain buttons (at least 24 px, WCAG 2.5.8). */
const StateMapSmallStates: React.FC<{ labels: Record<string, string>; selected: string | null; onSelect: (c: string | null) => void }> = ({ labels, selected, onSelect }) => (
  <div className="flex flex-wrap gap-1.5" aria-label="Small states">
    {SMALL_STATE_CODES.map(code => (
      <button key={code} type="button" aria-pressed={selected === code} aria-label={labels[code]} onClick={() => onSelect(selected === code ? null : code)}
        className={cn("min-h-8 min-w-10 rounded-md border border-border px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected === code ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted")}>{code}</button>
    ))}
  </div>
);

export default StateMapSmallStates;
