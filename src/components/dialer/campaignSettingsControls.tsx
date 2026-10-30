import React from "react";
import { CAMPAIGN_SETTINGS_COPY, RETRY_PRESETS, RETRY_MINUTES_MAX } from "./campaignSettingsSchema";

/**
 * Small shared field controls for the Calling Settings modal. Extracted from
 * CampaignSettingsModal so that file stays < 200 lines after the Settings Access
 * section was added. Tailwind only; no business logic.
 */

export const inputCls =
  "rounded border border-input bg-background px-2 py-1.5 text-sm";

/* Max Call Attempts (blank stays blank — never coerced to 0) + Unlimited. */
export function MaxAttemptsField({ isUnlimited, onUnlimitedChange, value, onChange }: {
  isUnlimited: boolean; onUnlimitedChange: (v: boolean) => void; value: number | ""; onChange: (v: number | "") => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Max Call Attempts</label>
      <div className="flex items-center gap-3">
        <input
          type="number"
          min={1}
          max={99}
          value={isUnlimited ? "" : value}
          disabled={isUnlimited}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className={`w-20 disabled:opacity-40 ${inputCls}`}
          placeholder="3"
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
          <input type="checkbox" checked={isUnlimited} onChange={(e) => onUnlimitedChange(e.target.checked)} className="accent-primary" />
          Unlimited
        </label>
      </div>
    </div>
  );
}

/* Calling window: start/end time inputs. Wraps instead of overflowing on narrow phones. */
export function CallingWindowField({ start, end, onStartChange, onEndChange }: {
  start: string; end: string; onStartChange: (v: string) => void; onEndChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{CAMPAIGN_SETTINGS_COPY.callingWindowLabel}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input type="time" value={start} onChange={(e) => onStartChange(e.target.value)} className={`min-w-0 ${inputCls}`} />
        <span className="text-muted-foreground text-sm">to</span>
        <input type="time" value={end} onChange={(e) => onEndChange(e.target.value)} className={`min-w-0 ${inputCls}`} />
      </div>
      <p className="text-xs text-muted-foreground">{CAMPAIGN_SETTINGS_COPY.callingWindowHelper}</p>
    </div>
  );
}

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
      <div className="flex flex-wrap items-center gap-2">
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

const RETRY_CUSTOM = "custom";

/* Retry interval: preset dropdown (minutes) + optional custom-minutes input.
 * Preset data + the max bound live in campaignSettingsSchema.ts (shared with Zod). */
export function RetryIntervalField({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (v: number) => void;
}) {
  const matchesPreset = RETRY_PRESETS.some((p) => p.minutes === minutes);
  // Mount in custom mode only when the loaded value isn't a preset. The modal
  // re-mounts these fields on each open (spinner shows while loading), so the
  // initial value reflects the freshly loaded campaign.
  const [isCustom, setIsCustom] = React.useState(!matchesPreset);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Retry Interval</label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={isCustom ? RETRY_CUSTOM : String(minutes)}
          onChange={(e) => {
            if (e.target.value === RETRY_CUSTOM) {
              setIsCustom(true);
            } else {
              setIsCustom(false);
              onChange(Number(e.target.value));
            }
          }}
          className={inputCls}
        >
          {RETRY_PRESETS.map((p) => (
            <option key={p.minutes} value={p.minutes}>
              {p.label}
            </option>
          ))}
          <option value={RETRY_CUSTOM}>Custom (minutes)</option>
        </select>
        {isCustom && (
          <input
            type="number"
            min={0}
            max={RETRY_MINUTES_MAX}
            value={minutes}
            onChange={(e) =>
              onChange(e.target.value === "" ? 0 : Math.max(0, Math.floor(Number(e.target.value))))
            }
            className={`w-24 ${inputCls}`}
            placeholder="minutes"
            aria-label="Custom retry interval in minutes"
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {minutes === 0
          ? "Immediate — leads become retry-eligible right away."
          : "Minutes before a skipped/uncontacted lead becomes retry-eligible."}
      </p>
    </div>
  );
}

/* A labelled on/off switch with an optional helper line. */
export function ToggleRow({
  label,
  helper,
  checked,
  onToggle,
  disabled = false,
}: {
  label: string;
  helper?: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={onToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
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
