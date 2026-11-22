import { fromZonedTime } from "date-fns-tz";
import type { EmailSender } from "@/lib/automation-channels";

/** Test values typed into the preview form. Nothing here is read from or written to a real contact. */
export interface PreviewValues {
  trigger?: string;
  campaign_id?: string;
  disposition_id?: string;
  outcome?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  lead_source?: string;
  /** Wall-clock time from a datetime-local input, read in `timezone`. */
  appointment_start?: string;
  timezone: string;
}

export interface PreviewFlags {
  sms_eligible: boolean;
  email_eligible: boolean;
  lookup_failed: boolean;
  assigned: boolean;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The instant a wall-clock time names in a time zone, or undefined when either part is unusable. */
export function zonedInstant(local: string | undefined, timezone: string): string | undefined {
  if (!local || !timezone) return undefined;
  try {
    const instant = fromZonedTime(local, timezone);
    return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
  } catch {
    return undefined;
  }
}

/** The synthetic event the shared preview evaluates. */
export function previewInput(
  triggerType: string | undefined, values: PreviewValues, flags: PreviewFlags, senders: Record<string, EmailSender>,
): Record<string, unknown> {
  const {appointment_start, timezone, trigger, ...contact} = values;
  const start = zonedInstant(appointment_start, timezone);
  return {
    ...contact,
    trigger: trigger || triggerType,
    sms_eligible: flags.sms_eligible,
    email_eligible: flags.email_eligible,
    lookup_failed: flags.lookup_failed,
    // An unanswered call without a responsible agent becomes a callback instead of a task.
    has_owner: flags.assigned,
    responsible_agent: flags.assigned,
    email_senders: senders,
    ...(start && {appointment_start: start, timezone}),
  };
}
