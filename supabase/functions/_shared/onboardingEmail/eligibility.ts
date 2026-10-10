// Onboarding email series — send-time eligibility. A pure function over the facts returned by
// public.get_onboarding_email_context (read at send time, never cached), so every rule is
// table-tested in eligibility.test.ts. Plan §3.3.
//   cancel -> this and every remaining step of the enrollment stop (deleted, opted out, role or
//             agency changed, no longer eligible)
//   skip   -> only this step stops; later steps are evaluated on their own day
//   send   -> to the CURRENT confirmed auth email, never a cached or caller-supplied address

import { sequenceForRole } from "./catalog.ts";

/** Row shape of public.get_onboarding_email_context(uuid). */
export interface DeliveryContext {
  delivery_id: string;
  delivery_status: string;
  step_key: string;
  template_version: number;
  sequence_key: string;
  expires_at: string;
  enrollment_status: string;
  enrollment_organization_id: string;
  profile_exists: boolean;
  profile_status: string | null;
  profile_role: string | null;
  profile_is_super_admin: boolean;
  profile_organization_id: string | null;
  first_name: string | null;
  auth_exists: boolean;
  email: string | null;
  email_confirmed: boolean;
  auth_deleted: boolean;
  auth_banned: boolean;
  organization_status: string | null;
  opted_out: boolean;
}

/** Step-level reasons (complete_onboarding_email_delivery 'skipped'). */
export type SkipReason = "stale" | "user_inactive" | "organization_inactive" | "email_unconfirmed" | "enrollment_closed";

/** Enrollment-level reasons (complete_onboarding_email_delivery 'cancelled'). */
export type CancelReason = "user_deleted" | "opted_out" | "role_ineligible" | "role_changed" | "organization_changed";

export type EligibilityDecision =
  | { action: "send"; email: string; firstName: string | null }
  | { action: "skip"; reason: SkipReason }
  | { action: "cancel"; reason: CancelReason };

const SINGLE_ADDRESS = /^[^\s@,;<>"'()]+@[^\s@,;<>"'()]+\.[^\s@,;<>"'()]+$/;

export function isDeliverableAddress(email: string | null | undefined): email is string {
  const value = (email ?? "").trim();
  return value.length > 0 && value.length <= 254 && SINGLE_ADDRESS.test(value);
}

export function evaluateEligibility(ctx: DeliveryContext | null, now: Date): EligibilityDecision {
  if (!ctx) return { action: "cancel", reason: "user_deleted" };

  if (!ctx.profile_exists || !ctx.auth_exists || ctx.auth_deleted || ctx.profile_status === "Deleted") {
    return { action: "cancel", reason: "user_deleted" };
  }
  if (ctx.opted_out) return { action: "cancel", reason: "opted_out" };
  if (ctx.enrollment_status !== "active") return { action: "skip", reason: "enrollment_closed" };

  const sequence = sequenceForRole(ctx.profile_role, ctx.profile_is_super_admin === true);
  if (!sequence) return { action: "cancel", reason: "role_ineligible" };
  if (sequence !== ctx.sequence_key) return { action: "cancel", reason: "role_changed" };
  if (!ctx.profile_organization_id || ctx.profile_organization_id !== ctx.enrollment_organization_id) {
    return { action: "cancel", reason: "organization_changed" };
  }

  if (ctx.profile_status !== "Active" || ctx.auth_banned) return { action: "skip", reason: "user_inactive" };
  if ((ctx.organization_status ?? "active") !== "active") return { action: "skip", reason: "organization_inactive" };
  if (!ctx.email_confirmed || !isDeliverableAddress(ctx.email)) return { action: "skip", reason: "email_unconfirmed" };

  const expiresAt = Date.parse(ctx.expires_at);
  if (!Number.isFinite(expiresAt) || now.getTime() >= expiresAt) return { action: "skip", reason: "stale" };

  return { action: "send", email: ctx.email.trim(), firstName: ctx.first_name };
}
