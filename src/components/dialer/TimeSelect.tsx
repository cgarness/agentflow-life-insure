import React, { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Parse a "h:mm AM/PM" string to minutes-since-midnight, or null if unparseable. */
function parseTimeToMinutes(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === "PM") hours += 12;
  return hours * 60 + parseInt(m[2], 10);
}

/** Build a "h:mm AM/PM" label from minutes-since-midnight. */
function minutesToLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const min = minutes % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${min.toString().padStart(2, "0")} ${period}`;
}

// 15-minute increments, full-day coverage (12:00 AM … 11:45 PM).
const STEP_MINUTES = 15;
const ALL_OPTION_MINUTES = Array.from(
  { length: (24 * 60) / STEP_MINUTES },
  (_, i) => i * STEP_MINUTES,
);

// ─── Component ───────────────────────────────────────────────────────────────────

interface TimeSelectProps {
  /** Current value as "h:mm AM/PM" (matches the dialer's save parsers). */
  value: string | undefined;
  onChange: (value: string) => void;
  /**
   * When set ("h:mm AM/PM"), only times strictly after this are selectable.
   * Used to keep an appointment end-time after its start-time. If filtering
   * leaves no options (start is the last slot of the day), the full list is
   * shown so the control never breaks.
   */
  minTime?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Forwarded to the trigger for layout (e.g. grid cell sizing). */
  "aria-label"?: string;
}

/**
 * TimeSelect — design-system Select for dialer time entry (Tailwind only).
 *
 * Emits 12-hour "h:mm AM/PM" strings in 15-minute increments across the full
 * day. This format is accepted by both dialer save paths: appointments via
 * `convertTo24h` (dialer-api) and callbacks via the inline parser in DialerPage.
 * Replaces the prior native `<input type="time">` controls (manual entry +
 * 12h/24h format mismatch).
 */
export const TimeSelect: React.FC<TimeSelectProps> = ({
  value,
  onChange,
  minTime,
  placeholder = "Select time",
  disabled,
  className,
  "aria-label": ariaLabel,
}) => {
  const options = useMemo(() => {
    const minMinutes = parseTimeToMinutes(minTime);
    const filtered =
      minMinutes === null
        ? ALL_OPTION_MINUTES
        : ALL_OPTION_MINUTES.filter((m) => m > minMinutes);
    const source = filtered.length > 0 ? filtered : ALL_OPTION_MINUTES;
    return source.map((m) => minutesToLabel(m));
  }, [minTime]);

  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={
          className ??
          "h-auto w-full p-2 text-xs bg-accent/30 border border-border rounded-lg focus:ring-1 focus:ring-primary"
        }
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-60">
        {options.map((label) => (
          <SelectItem key={label} value={label} className="text-xs">
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default TimeSelect;
