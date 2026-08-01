/**
 * Route-gating regression guard.
 *
 * The onboarding redesign must not move any of these: who is sent to the wizard,
 * who is sent past it, and how the founder branch is detected. `App.tsx`'s
 * `/onboarding` gate, `ProtectedRoute` and `resolvePostAuthDestination` all read
 * these three pure functions.
 */
import { describe, it, expect } from "vitest";
import { isSelfServeSignup, needsAppOnboardingWizard, resolvePostAuthPath } from "@/lib/onboarding-wizard";
import type { User } from "@supabase/supabase-js";

const user = (overrides: Record<string, unknown>) => overrides as unknown as User;

const CONFIRMED = "2026-08-01T00:00:00.000Z";

describe("needsAppOnboardingWizard", () => {
  it("is true only for a confirmed account still carrying the unfinished wizard flag", () => {
    expect(needsAppOnboardingWizard(user({ email_confirmed_at: CONFIRMED, user_metadata: { needs_app_wizard: true } }))).toBe(
      true,
    );
  });

  it("is false before the email is confirmed", () => {
    expect(needsAppOnboardingWizard(user({ user_metadata: { needs_app_wizard: true } }))).toBe(false);
  });

  it("is false once the wizard has been completed", () => {
    expect(
      needsAppOnboardingWizard(
        user({ email_confirmed_at: CONFIRMED, user_metadata: { needs_app_wizard: true, app_wizard_completed: true } }),
      ),
    ).toBe(false);
  });

  it("is false when the flag was never set, and for no user at all", () => {
    expect(needsAppOnboardingWizard(user({ email_confirmed_at: CONFIRMED, user_metadata: {} }))).toBe(false);
    expect(needsAppOnboardingWizard(null)).toBe(false);
    expect(needsAppOnboardingWizard(undefined)).toBe(false);
  });
});

describe("isSelfServeSignup (founder detection)", () => {
  it("keys off signup_source === 'self_serve' only", () => {
    expect(isSelfServeSignup(user({ user_metadata: { signup_source: "self_serve" } }))).toBe(true);
    expect(isSelfServeSignup(user({ user_metadata: { signup_source: "invite" } }))).toBe(false);
    expect(isSelfServeSignup(user({ user_metadata: {} }))).toBe(false);
    expect(isSelfServeSignup(null)).toBe(false);
  });
});

describe("resolvePostAuthPath", () => {
  it("sends an unfinished wizard to /onboarding and everyone else to /dashboard", () => {
    expect(resolvePostAuthPath(user({ email_confirmed_at: CONFIRMED, user_metadata: { needs_app_wizard: true } }))).toBe(
      "/onboarding",
    );
    expect(
      resolvePostAuthPath(
        user({ email_confirmed_at: CONFIRMED, user_metadata: { needs_app_wizard: true, app_wizard_completed: true } }),
      ),
    ).toBe("/dashboard");
    expect(resolvePostAuthPath(user({ user_metadata: {} }))).toBe("/dashboard");
  });
});
