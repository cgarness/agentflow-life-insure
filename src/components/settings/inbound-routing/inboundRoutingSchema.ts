import { z } from "zod";

export const ROUTING_MODES = ["assigned", "all-ring", "round_robin"] as const;
export const FALLBACK_ACTIONS = ["voicemail", "forward", "hangup"] as const;
export const FALLBACK_TIER_KEYS = [
  "last_agent",
  "campaign_agents",
  "state_licensed",
  "all_available",
] as const;

export const routingModeSchema = z.enum(ROUTING_MODES);
export const fallbackActionSchema = z.enum(FALLBACK_ACTIONS);
export const fallbackTierKeySchema = z.enum(FALLBACK_TIER_KEYS);

// Forgiving E.164-ish format: optional +, allow common separators, 7–20 chars total
const e164ishPattern = /^\+?[0-9\s().\-]{7,20}$/;

const optionalForwardingNumberSchema = z
  .string()
  .trim()
  .max(20, "Forwarding number is too long.")
  .optional()
  .default("");

const optionalGreetingSchema = z
  .string()
  .trim()
  .max(500, "Greeting must be 500 characters or fewer.")
  .optional()
  .default("");

const optionalAfterHoursSmsSchema = z
  .string()
  .trim()
  .max(320, "After-hours SMS must be 320 characters or fewer.")
  .optional()
  .default("");

export const fallbackChainSchema = z
  .array(fallbackTierKeySchema)
  .superRefine((arr, ctx) => {
    const seen = new Set<string>();
    arr.forEach((key, idx) => {
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [idx],
          message: `Duplicate fallback tier: ${key}`,
        });
      }
      seen.add(key);
    });
  });

export const inboundRoutingSettingsSchema = z
  .object({
    routing_mode: routingModeSchema,
    fallback_action: fallbackActionSchema,
    forwarding_number: optionalForwardingNumberSchema,
    voicemail_greeting_text: optionalGreetingSchema,
    voicemail_greeting_url: z.string().trim().max(2048).optional().default(""),
    after_hours_sms_enabled: z.boolean(),
    after_hours_sms: optionalAfterHoursSmsSchema,
    inbound_fallback_chain: fallbackChainSchema,
    auto_create_lead: z.boolean(),
    voicemail_enabled: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.fallback_action === "forward") {
      const trimmed = (val.forwarding_number || "").trim();
      if (!trimmed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["forwarding_number"],
          message: "Forwarding number is required when fallback is set to Forward.",
        });
      } else if (!e164ishPattern.test(trimmed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["forwarding_number"],
          message: "Forwarding number must look like a phone number (e.g. +1 555 123 4567).",
        });
      }
    }
    if (val.fallback_action === "voicemail" || val.fallback_action === "hangup") {
      const trimmed = (val.voicemail_greeting_text || "").trim();
      if (!trimmed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["voicemail_greeting_text"],
          message: "Greeting text is required for voicemail or hang-up.",
        });
      }
    }
    if (val.after_hours_sms_enabled) {
      const trimmed = (val.after_hours_sms || "").trim();
      if (!trimmed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["after_hours_sms"],
          message: "After-hours SMS is enabled — add a message body.",
        });
      }
    }
  });

export type InboundRoutingSettingsInput = z.input<typeof inboundRoutingSettingsSchema>;
export type InboundRoutingSettingsParsed = z.output<typeof inboundRoutingSettingsSchema>;

// Business hours — one row per day_of_week (0..6).
const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:MM (24h).");

export const businessHoursDaySchema = z
  .object({
    day_of_week: z.number().int().min(0).max(6),
    is_open: z.boolean(),
    open_time: z.string(),
    close_time: z.string(),
  })
  .superRefine((val, ctx) => {
    if (val.is_open) {
      const openOk = timeStringSchema.safeParse(val.open_time);
      const closeOk = timeStringSchema.safeParse(val.close_time);
      if (!openOk.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["open_time"],
          message: "Open time is required when the day is open.",
        });
      }
      if (!closeOk.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["close_time"],
          message: "Close time is required when the day is open.",
        });
      }
      if (openOk.success && closeOk.success && val.close_time <= val.open_time) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["close_time"],
          message: "Close time must be after open time.",
        });
      }
    }
  });

export const businessHoursWeekSchema = z
  .array(businessHoursDaySchema)
  .min(1, "Business hours are required.");

export type BusinessHoursDayInput = z.input<typeof businessHoursDaySchema>;

// Per-number routing modal — `global` means "use the org default".
export const PER_NUMBER_ROUTING_MODES = [
  "global",
  "assigned",
  "all-ring",
  "round_robin",
] as const;
export const PER_NUMBER_FALLBACK_ACTIONS = [
  "global",
  "voicemail",
  "forward",
  "hangup",
] as const;

export const perNumberRoutingSchema = z
  .object({
    organizationId: z.string().uuid("Organization is required."),
    inbound_routing_mode: z.enum(PER_NUMBER_ROUTING_MODES),
    fallback_action: z.enum(PER_NUMBER_FALLBACK_ACTIONS),
    voicemail_enabled: z.boolean(),
    voicemail_greeting_text: optionalGreetingSchema,
    forwarding_number: optionalForwardingNumberSchema,
  })
  .superRefine((val, ctx) => {
    if (val.fallback_action === "forward") {
      const trimmed = (val.forwarding_number || "").trim();
      if (!trimmed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["forwarding_number"],
          message: "Forwarding number is required when fallback is set to Forward.",
        });
      } else if (!e164ishPattern.test(trimmed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["forwarding_number"],
          message: "Forwarding number must look like a phone number (e.g. +1 555 123 4567).",
        });
      }
    }
    if (val.fallback_action === "voicemail" || val.fallback_action === "hangup") {
      const trimmed = (val.voicemail_greeting_text || "").trim();
      if (!trimmed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["voicemail_greeting_text"],
          message: "Greeting text is required for voicemail or hang-up.",
        });
      }
    }
  });

export type PerNumberRoutingInput = z.input<typeof perNumberRoutingSchema>;

/**
 * Extract the first user-friendly error message from a Zod safeParse failure.
 */
export function firstZodIssueMessage(
  err: z.ZodError | null | undefined,
  fallback = "Please review the form and try again.",
): string {
  if (!err) return fallback;
  const issue = err.issues[0];
  if (!issue) return fallback;
  return issue.message || fallback;
}
