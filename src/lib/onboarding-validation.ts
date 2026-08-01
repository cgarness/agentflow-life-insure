import { z } from "zod";

/**
 * Zod validation for the `/onboarding` wizard.
 *
 * The required-field SET is deliberately identical to the hand-rolled checks it
 * replaces (`useOnboardingPageFlow` step 0/1/2): first name, last name, a phone
 * with at least ten digits, and a resident state on step one; nothing on step
 * two; the agency display name for founders on step three. Only the message copy
 * improves. Error keys are unchanged so the `errors: Record<string, string>`
 * contract the step components consume still holds.
 */

const requiredText = (message: string) => z.string().trim().min(1, message);

export const onboardingProfileSchema = z.object({
  firstName: requiredText("Enter your first name"),
  lastName: requiredText("Enter your last name"),
  phone: requiredText("Enter your phone number").refine(
    (v) => v.replace(/\D/g, "").length >= 10,
    "Enter a valid 10-digit phone number",
  ),
  residentState: requiredText("Select your resident state"),
});

/** Everything on the licensing step is optional — this schema documents that and never fails. */
export const onboardingLicensingSchema = z.object({
  npn: z.string(),
  licensedStates: z.array(z.string()),
  timezone: z.string(),
  commissionDigits: z.string(),
});

export const onboardingFounderAgencySchema = z.object({
  agencyName: requiredText("Enter your agency's display name"),
});

/** Stable DOM ids — used for `aria-describedby`, error ids, and focus targeting. */
export const ONBOARDING_FIELD_IDS = {
  firstName: "onboarding-first-name",
  lastName: "onboarding-last-name",
  phone: "onboarding-phone",
  residentState: "onboarding-resident-state",
  npn: "onboarding-npn",
  licensedStates: "onboarding-licensed-states",
  timezone: "onboarding-timezone",
  commissionDigits: "onboarding-commission",
  agencyName: "onboarding-agency-name",
  agencyTimezone: "onboarding-agency-timezone",
} as const;

export type OnboardingFieldKey = keyof typeof ONBOARDING_FIELD_IDS;

/** DOM order per step — decides which invalid field is "first" for focus. */
export const ONBOARDING_FIELD_ORDER: Record<number, OnboardingFieldKey[]> = {
  0: ["firstName", "lastName", "phone", "residentState"],
  1: ["npn", "licensedStates", "timezone", "commissionDigits"],
  2: ["agencyName", "agencyTimezone"],
};

/** Flatten a ZodError into the `{ field: message }` map the step components render. */
export function zodErrorsToFieldMap(error: z.ZodError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in map)) map[key] = issue.message;
  }
  return map;
}

/** The first invalid field for a step, in DOM order. */
export function firstInvalidField(step: number, errors: Record<string, string>): OnboardingFieldKey | null {
  const order = ONBOARDING_FIELD_ORDER[step] ?? [];
  return order.find((key) => Boolean(errors[key])) ?? null;
}

const GENERIC_COMPLETION_ERROR = "We couldn't finish setup. Please check your connection and try again.";

/**
 * User-facing copy for a completion failure.
 *
 * Only messages this app authored are shown verbatim — everything else (Supabase
 * / PostgREST / network internals, raw database responses) is replaced with an
 * actionable generic message. Callers keep `console.error(err)` for debugging.
 */
export function describeCompletionError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
        ? (err as { message: string }).message
        : null;

  if (raw && raw.startsWith("Session is still missing organization or role claims")) return raw;
  return GENERIC_COMPLETION_ERROR;
}
