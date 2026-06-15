import { z } from "zod";
import { SETTINGS_EDIT_POLICIES } from "@/lib/campaign-settings-permissions";

/**
 * Validation for the Dialer "Calling Settings" modal (campaign-level).
 *
 * Parsed in DialerPage.handleSaveCallingSettings BEFORE any supabase write so a
 * blank Max Attempts can never be coerced to `0` and silently empty the queue
 * (Number("") === 0). When Unlimited is off, maxAttempts must be an integer
 * 1–99; when Unlimited is on it must be null.
 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Retry interval presets (minutes). Canonical field is
 * campaigns.retry_interval_minutes; retry_interval_hours is derived (ceil) only
 * for legacy/display. "Custom (minutes)" in the control accepts any integer 0..MAX.
 * Shared by the Zod rule below and the RetryIntervalField control.
 */
export const RETRY_MINUTES_MAX = 10080; // 168h ceiling (matches the prior hours bound)
export const RETRY_PRESETS: ReadonlyArray<{ label: string; minutes: number }> = [
  { label: "Immediate", minutes: 0 },
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
  { label: "4 hours", minutes: 240 },
  { label: "24 hours", minutes: 1440 },
];

export const campaignSettingsSchema = z
  .object({
    isUnlimited: z.boolean(),
    // null when Unlimited; otherwise an integer 1–99. Blank is coerced to null
    // by the caller, then rejected below when Unlimited is off.
    maxAttempts: z
      .number({ invalid_type_error: "Enter a whole number of attempts (1–99)." })
      .int("Max attempts must be a whole number.")
      .min(1, "Max attempts must be at least 1.")
      .max(99, "Max attempts cannot exceed 99.")
      .nullable(),
    ringTimeout: z
      .number({ invalid_type_error: "Ring timeout must be a number." })
      .int("Ring timeout must be a whole number.")
      .min(5, "Ring timeout must be 5–120 seconds.")
      .max(120, "Ring timeout must be 5–120 seconds."),
    // Canonical retry field is campaigns.retry_interval_minutes. Preset or custom,
    // always a whole number of minutes >= 0 (168h ceiling = 10080).
    retryIntervalMinutes: z
      .number({ invalid_type_error: "Retry interval must be a number of minutes." })
      .int("Retry interval must be a whole number of minutes.")
      .min(0, "Retry interval must be 0 minutes or more.")
      .max(RETRY_MINUTES_MAX, "Retry interval cannot exceed 10080 minutes (168 hours)."),
    callingHoursStart: z.string().regex(HHMM, "Use a valid start time (HH:MM)."),
    callingHoursEnd: z.string().regex(HHMM, "Use a valid end time (HH:MM)."),
  })
  .superRefine((v, ctx) => {
    if (!v.isUnlimited && v.maxAttempts === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxAttempts"],
        message: "Enter a max attempts value (1–99), or turn on Unlimited.",
      });
    }
  });

export type CampaignSettingsValues = z.infer<typeof campaignSettingsSchema>;

/**
 * Validation for the "Settings Access" section. `policy` is one of the four
 * edit-permission policies; `userIds` are the selected grantees (only meaningful
 * for team_leaders / specific_users — an empty list is allowed and simply means
 * "no extra people"). Parsed in handleSaveCallingSettings before the RPC call.
 */
export const settingsAccessSchema = z.object({
  policy: z.enum(SETTINGS_EDIT_POLICIES),
  userIds: z.array(z.string().uuid("Select valid teammates.")),
});

export type SettingsAccessValues = z.infer<typeof settingsAccessSchema>;

/** Static copy/labels for the modal — kept here so the component stays < 200 lines. */
export const CAMPAIGN_SETTINGS_COPY = {
  callingWindowLabel: "Calling Window",
  callingWindowHelper:
    "Auto-dial avoids dialing outside this window. Timezone is estimated from the lead's state.",
  localPresenceHelper:
    "Matches caller ID to the lead's area code using eligible agency numbers. Personal/direct numbers are excluded from rotation; if no local match exists, your default caller ID is used.",
  sessionActiveNote: "Changes apply to your next call.",
  // Settings Access (edit-permission model)
  accessLabel: "Settings Access",
  accessHelper: "Choose who can change this campaign's calling settings.",
  pickerPlaceholder: "Search teammates by name or email…",
  pickerEmpty: "No teammates found.",
  noPermission: "You don't have permission to edit this campaign's settings.",
  accessSaveFailed: "Settings access could not be saved.",
  // Licensed-state access (Build 2b)
  requireLicensedStateLabel: "Require licensed-state access",
  requireLicensedStateHelper:
    "When on, agents only receive campaign contacts in states where they hold an active license. Contacts with no state are still shown.",
  requireLicensedStateNotApplicable: "Applies to Team and Open Pool campaigns.",
} as const;
