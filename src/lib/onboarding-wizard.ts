import type { User } from "@supabase/supabase-js";

/** New signups (create-user / accept-invite) must finish the in-app wizard before the main CRM. */
export function needsAppOnboardingWizard(user: User | null | undefined): boolean {
  if (!user?.email_confirmed_at) return false;
  const m = user.user_metadata as Record<string, unknown>;
  return m?.needs_app_wizard === true && m?.app_wizard_completed !== true;
}

export function isSelfServeSignup(user: User | null | undefined): boolean {
  const m = user?.user_metadata as Record<string, unknown> | undefined;
  return m?.signup_source === "self_serve";
}

export function resolvePostAuthPath(user: User | null | undefined): string {
  if (needsAppOnboardingWizard(user)) return "/onboarding";
  return "/dashboard";
}
