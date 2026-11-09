import React from "react";
import { formatModeValue, modeValue, REGIONAL_MODES, REGIONAL_MODE_LABELS, stateName, type StateRow } from "@/lib/reports-regional";

/** The selected state's four values and premium completeness (polite live region). */
const StateDetails: React.FC<{ row: StateRow | null; onClear: () => void }> = ({ row, onClear }) => (
  <div aria-live="polite" className="min-h-[4.5rem] rounded-lg border border-border bg-card/60 p-3 text-sm">
    {row ? (
      <>
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">{stateName(row.state)}</p>
          <button type="button" onClick={onClear} className="text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">Clear</button>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          {REGIONAL_MODES.map(m => (
            <div key={m}><dt className="text-xs text-muted-foreground">{REGIONAL_MODE_LABELS[m]}</dt><dd className="font-semibold tabular-nums">{formatModeValue(modeValue(row, m), m)}</dd></div>
          ))}
        </dl>
        {(row.premium.missing_count > 0 || row.premium.invalid_count > 0) && (
          <p className="mt-1 text-xs text-muted-foreground">{row.premium.known_count} of {row.premium.policy_count} premiums known</p>
        )}
      </>
    ) : <p className="text-xs text-muted-foreground">Select a state to see its details.</p>}
  </div>
);

export default StateDetails;
