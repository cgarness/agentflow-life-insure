// Onboarding email series — the one TypeScript catalog of steps, timing, CTA paths and the
// role-to-series mapping. Timing must equal the SQL seed in
// supabase/migrations/pending/20261011120000_onboarding_email_foundation.sql, and the role mapping
// must equal onboarding_email_enroll_due's CASE; catalog.test.ts holds both equal.
// Day 0 is the existing welcome email (send-welcome-email) and is deliberately NOT a step here.

export type SequenceKey = "agent" | "agency_admin";

export interface OnboardingStep {
  stepKey: string;
  sequenceKey: SequenceKey;
  dayOffset: number;
  position: number;
  templateVersion: number;
  /** In-app path the primary CTA opens; must be in VERIFIED_CTA_PATHS. */
  ctaPath: string;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = Object.freeze([
  { stepKey: "agent_day01_dialer_ready", sequenceKey: "agent", dayOffset: 1, position: 1, templateVersion: 1, ctaPath: "/dialer" },
  { stepKey: "agent_day03_work_leads", sequenceKey: "agent", dayOffset: 3, position: 2, templateVersion: 1, ctaPath: "/contacts" },
  { stepKey: "agent_day05_campaigns", sequenceKey: "agent", dayOffset: 5, position: 3, templateVersion: 1, ctaPath: "/dialer" },
  { stepKey: "agent_day08_numbers", sequenceKey: "agent", dayOffset: 8, position: 4, templateVersion: 1, ctaPath: "/settings?section=my-profile" },
  { stepKey: "agent_day14_routine", sequenceKey: "agent", dayOffset: 14, position: 5, templateVersion: 1, ctaPath: "/dashboard" },
  { stepKey: "admin_day02_agency_setup", sequenceKey: "agency_admin", dayOffset: 2, position: 1, templateVersion: 1, ctaPath: "/settings?section=company-branding" },
  { stepKey: "admin_day04_agents_dialing", sequenceKey: "agency_admin", dayOffset: 4, position: 2, templateVersion: 1, ctaPath: "/settings?section=user-management" },
  { stepKey: "admin_day07_team_performance", sequenceKey: "agency_admin", dayOffset: 7, position: 3, templateVersion: 1, ctaPath: "/reports" },
  { stepKey: "admin_day12_high_performing", sequenceKey: "agency_admin", dayOffset: 12, position: 4, templateVersion: 1, ctaPath: "/settings?section=call-scripts" },
]);

export const SEQUENCE_LENGTH: Readonly<Record<SequenceKey, number>> = Object.freeze({ agent: 5, agency_admin: 4 });

export const SEQUENCE_LABEL: Readonly<Record<SequenceKey, string>> = Object.freeze({
  agent: "New Agent Tips",
  agency_admin: "Agency Setup",
});

/**
 * CTA destinations verified against src/App.tsx routes and src/config/settingsConfig.ts slugs on
 * 2026-10-10. catalog.test.ts re-checks every entry against those files.
 */
export const VERIFIED_CTA_PATHS: ReadonlySet<string> = new Set([
  "/dialer",
  "/contacts",
  "/dashboard",
  "/reports",
  "/settings?section=my-profile",
  "/settings?section=company-branding",
  "/settings?section=user-management",
  "/settings?section=call-scripts",
]);

/** Public confirm page for the footer unsubscribe link (src/pages/EmailUnsubscribePage.tsx). */
export const UNSUBSCRIBE_PAGE_PATH = "/email/unsubscribe";
export const PRIVACY_PATH = "/privacy";

/**
 * Series for a role, mirroring onboarding_email_enroll_due: Admin gets the agency admin series,
 * Agent and Team Leader get the agent series, and Super Admins (role or flag) get none.
 */
export function sequenceForRole(role: string | null | undefined, isSuperAdmin: boolean): SequenceKey | null {
  if (isSuperAdmin) return null;
  if (role === "Admin") return "agency_admin";
  if (role === "Agent" || role === "Team Leader") return "agent";
  return null;
}

export function findStep(stepKey: string): OnboardingStep | null {
  return ONBOARDING_STEPS.find((step) => step.stepKey === stepKey) ?? null;
}
