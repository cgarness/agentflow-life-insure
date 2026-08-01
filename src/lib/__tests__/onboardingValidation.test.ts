/**
 * Onboarding Zod schemas + error plumbing.
 *
 * The required-field SET must stay exactly what the hand-rolled checks enforced
 * (names, a ≥10-digit phone and a resident state on step one; nothing on step
 * two; the agency name for founders) — only the copy improved.
 */
import { describe, it, expect } from "vitest";
import {
  ONBOARDING_FIELD_IDS,
  describeCompletionError,
  firstInvalidField,
  onboardingFounderAgencySchema,
  onboardingLicensingSchema,
  onboardingProfileSchema,
  zodErrorsToFieldMap,
} from "@/lib/onboarding-validation";

const errorsFor = (input: { firstName: string; lastName: string; phone: string; residentState: string }) => {
  const parsed = onboardingProfileSchema.safeParse(input);
  return parsed.success ? {} : zodErrorsToFieldMap(parsed.error);
};

const VALID = { firstName: "Ada", lastName: "Byron", phone: "15125550123", residentState: "Texas" };

describe("onboardingProfileSchema (step one)", () => {
  it("accepts a complete profile", () => {
    expect(errorsFor(VALID)).toEqual({});
  });

  it("requires all four fields, keyed by the field names the UI renders", () => {
    expect(errorsFor({ firstName: "", lastName: "", phone: "", residentState: "" })).toEqual({
      firstName: "Enter your first name",
      lastName: "Enter your last name",
      phone: "Enter your phone number",
      residentState: "Select your resident state",
    });
  });

  it("treats whitespace as empty", () => {
    const errors = errorsFor({ ...VALID, firstName: "   ", lastName: "\t" });
    expect(errors.firstName).toBe("Enter your first name");
    expect(errors.lastName).toBe("Enter your last name");
  });

  it("keeps the ten-digit phone rule", () => {
    expect(errorsFor({ ...VALID, phone: "512555012" }).phone).toBe("Enter a valid 10-digit phone number");
    expect(errorsFor({ ...VALID, phone: "5125550123" }).phone).toBeUndefined();
    // The stored `1`-prefixed format still passes.
    expect(errorsFor({ ...VALID, phone: "15125550123" }).phone).toBeUndefined();
    // Formatted input passes on digit count, not shape.
    expect(errorsFor({ ...VALID, phone: "(512) 555-0123" }).phone).toBeUndefined();
  });
});

describe("onboardingLicensingSchema (step two)", () => {
  it("never blocks — every field is optional", () => {
    expect(
      onboardingLicensingSchema.safeParse({ npn: "", licensedStates: [], timezone: "", commissionDigits: "" }).success,
    ).toBe(true);
  });
});

describe("onboardingFounderAgencySchema (step three, founder)", () => {
  it("requires an agency display name", () => {
    const parsed = onboardingFounderAgencySchema.safeParse({ agencyName: "  " });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(zodErrorsToFieldMap(parsed.error)).toEqual({ agencyName: "Enter your agency's display name" });
    }
    expect(onboardingFounderAgencySchema.safeParse({ agencyName: "Byron Financial" }).success).toBe(true);
  });
});

describe("focus targeting", () => {
  it("picks the first invalid field in DOM order", () => {
    expect(firstInvalidField(0, { phone: "x", firstName: "y" })).toBe("firstName");
    expect(firstInvalidField(0, { residentState: "x", phone: "y" })).toBe("phone");
    expect(firstInvalidField(0, {})).toBeNull();
    expect(firstInvalidField(2, { agencyName: "x" })).toBe("agencyName");
  });

  it("exposes a stable id for every focusable field", () => {
    expect(ONBOARDING_FIELD_IDS.firstName).toBe("onboarding-first-name");
    expect(ONBOARDING_FIELD_IDS.residentState).toBe("onboarding-resident-state");
    expect(ONBOARDING_FIELD_IDS.agencyName).toBe("onboarding-agency-name");
  });
});

describe("describeCompletionError", () => {
  it("passes through the claims-not-ready recovery message this app authored", () => {
    const msg =
      "Session is still missing organization or role claims. Try signing out and back in, then finish setup.";
    expect(describeCompletionError(new Error(msg))).toBe(msg);
  });

  it("never leaks Supabase, PostgREST or database internals", () => {
    const generic = "We couldn't finish setup. Please check your connection and try again.";
    expect(describeCompletionError(new Error('duplicate key value violates unique constraint "profiles_pkey"'))).toBe(
      generic,
    );
    expect(describeCompletionError({ message: "JWT expired", code: "PGRST301" })).toBe(generic);
    expect(describeCompletionError({ message: 'new row violates row-level security policy for table "profiles"' })).toBe(
      generic,
    );
    expect(describeCompletionError(null)).toBe(generic);
    expect(describeCompletionError("boom")).toBe(generic);
  });
});
