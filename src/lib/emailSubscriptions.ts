import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

/**
 * Onboarding email preferences — the browser's only paths into user_email_subscriptions.
 *
 * - The browser never writes the table: `authenticated` holds SELECT only, with an own-row,
 *   own-agency policy. Changes go through `set_my_onboarding_email_opt_out`, which derives the user
 *   from auth.uid() and the database profile.
 * - Unsubscribing from an email link goes through the token-gated `email-unsubscribe` function, so a
 *   recipient does not need to sign in.
 * - Nothing here touches transactional or security email.
 */

/** Same shape the Edge function checks (UNSUBSCRIBE_TOKEN_SHAPE in _shared/onboardingEmail/unsubscribeToken.ts). */
export const unsubscribeTokenSchema = z
  .string()
  .trim()
  .max(512)
  .regex(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

export const emailSubscriptionStatusSchema = z.object({
  onboarding_program_enabled: z.boolean(),
  onboarding_opted_out: z.boolean(),
});
export type EmailSubscriptionStatus = z.infer<typeof emailSubscriptionStatusSchema>;

export const onboardingPreferenceSchema = z.object({ optedOut: z.boolean() });
export type OnboardingPreferenceInput = z.infer<typeof onboardingPreferenceSchema>;

export class EmailPreferenceError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "EmailPreferenceError";
  }
}

/** The caller's own status; null when the server returns no row (no session or no profile). */
export async function fetchMyEmailSubscriptions(): Promise<EmailSubscriptionStatus | null> {
  // Narrow cast: the RPC is not in the generated types (repo precedent for new RPCs).
  const { data, error } = await (supabase as any).rpc("get_my_email_subscriptions").maybeSingle();
  if (error) throw new EmailPreferenceError("Couldn't load your email preferences.", error);
  if (!data) return null;
  const parsed = emailSubscriptionStatusSchema.safeParse(data);
  if (!parsed.success) throw new EmailPreferenceError("Couldn't read your email preferences.", parsed.error);
  return parsed.data;
}

/** Saves the caller's own preference and returns the stored opted-out state. */
export async function setMyOnboardingEmailOptOut(input: OnboardingPreferenceInput): Promise<boolean> {
  const { optedOut } = onboardingPreferenceSchema.parse(input);
  const { data, error } = await (supabase as any).rpc("set_my_onboarding_email_opt_out", { p_opted_out: optedOut });
  if (error) throw new EmailPreferenceError("Couldn't save your email preference.", error);
  if (typeof data !== "boolean") throw new EmailPreferenceError("Couldn't confirm your email preference.");
  return data;
}

export type UnsubscribeResult = "unsubscribed" | "invalid" | "error";

/** Confirms an emailed unsubscribe link. Never retries on its own and never reports a false success. */
export async function submitUnsubscribe(token: string): Promise<UnsubscribeResult> {
  const parsed = unsubscribeTokenSchema.safeParse(token);
  if (!parsed.success) return "invalid";
  try {
    const { data, error } = await supabase.functions.invoke("email-unsubscribe", { body: { token: parsed.data } });
    if (!error && (data as { ok?: unknown } | null)?.ok === true) return "unsubscribed";
    const status = (error as { context?: { status?: number } } | null)?.context?.status;
    return status === 400 ? "invalid" : "error";
  } catch {
    return "error";
  }
}
