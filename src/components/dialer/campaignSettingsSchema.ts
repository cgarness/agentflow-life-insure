import { z } from "zod";

/**
 * Validation for the Dialer "Calling Settings" modal (campaign-level).
 *
 * Parsed in DialerPage.handleSaveCallingSettings BEFORE any supabase write so a
 * blank Max Attempts can never be coerced to `0` and silently empty the queue
 * (Number("") === 0). When Unlimited is off, maxAttempts must be an integer
 * 1–99; when Unlimited is on it must be null.
 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

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
    retryIntervalHours: z
      .number({ invalid_type_error: "Retry interval must be a number." })
      .int("Retry interval must be a whole number.")
      .min(0, "Retry interval must be 0–168 hours.")
      .max(168, "Retry interval must be 0–168 hours."),
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

/** Static copy/labels for the modal — kept here so the component stays < 200 lines. */
export const CAMPAIGN_SETTINGS_COPY = {
  callingWindowLabel: "Calling Window",
  callingWindowHelper:
    "Auto-dial avoids dialing outside this window. Timezone is estimated from the lead's state.",
  localPresenceHelper:
    "Matches caller ID to the lead's area code using eligible agency numbers. Personal/direct numbers are excluded from rotation; if no local match exists, your default caller ID is used.",
  sessionActiveNote: "Changes apply to your next call.",
} as const;
