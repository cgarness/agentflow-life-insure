import React from "react";

/**
 * Small shared field controls for the Calling Settings modal. Extracted from
 * CampaignSettingsModal so that file stays < 200 lines after the Settings Access
 * section was added. Tailwind only; no business logic.
 */

export const inputCls =
  "rounded border border-input bg-background px-2 py-1.5 text-sm";

/* A plain numeric field (label + number input + optional hint). */
export function NumberField({
  label,
  value,
  min,
  max,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  hint?: React.ReactNode;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`w-24 ${inputCls}`}
        />
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

/* A labelled on/off switch with an optional helper line. */
export function ToggleRow({
  label,
  helper,
  checked,
  onToggle,
}: {
  label: string;
  helper?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={onToggle}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-1"}`}
          />
        </button>
      </div>
      {helper && <p className="mt-1 text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}
