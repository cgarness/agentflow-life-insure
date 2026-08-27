/**
 * impersonationProfile — the ONE mapper that builds the profile a Super Admin "View As" session
 * runs on, plus the fail-closed guard for the copy persisted in `localStorage`.
 *
 * ## Why this exists
 *
 * `AuthContext.startImpersonation` takes a `Profile` — the snake_case `profiles` ROW shape that
 * every consumer reads (`profile.id`, `profile.role`, `profile.organization_id`). Both "View As"
 * entry points used to hand it a `UserProfile` instead — the camelCase DTO from `rowToUser`, which
 * has `userId` / `organizationId` / `isSuperAdmin` and **no `id`, no `role`, no `organization_id`
 * at all** — through an unchecked `as unknown as Profile` cast.
 *
 * The cast compiled and the object was structurally unrelated, so during "View As":
 *   `profile.id`, `profile.role`, `profile.organization_id`, `profile.is_super_admin` were all
 *   `undefined`; `useOrganization()` returned `undefined` org and role; `usePermissions` could
 *   never satisfy `canFetchPermissions` and stayed loading forever; and the TopBar rendered
 *   "Viewing as …" with a blank name.
 *
 * This module replaces both casts with one explicit, validated, unit-tested mapping.
 *
 * ## Fail-closed contract
 *
 * Every function here returns `null` rather than a partially-populated `Profile`. A `null`
 * impersonation means "not impersonating" — the app falls back to the real authenticated profile,
 * which is the safe direction. A half-built profile is what caused the original defect, so it is
 * never produced: `id`, `role` and `organization_id` are all mandatory.
 *
 * ⚠️ `platform_role` is deliberately NOT carried across. Platform authority is read from
 * `realProfile` (see `useIsPlatformAdmin`), never from the effective profile, so synthesizing it
 * here could only ever grant authority that impersonation must not confer.
 */

import type { Profile } from "@/contexts/AuthContext";
import type { User, UserProfile } from "@/lib/types";

/** The shape both "View As" entry points already hold: `usersApi.getAll()` rows. */
export type ImpersonationSource = User & { profile: UserProfile };

/** `localStorage` key holding the active impersonation. Exported so the guard and the writer agree. */
export const IMPERSONATION_STORAGE_KEY = "agentflow_impersonation";

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value: unknown): boolean {
  return value === true;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The three fields that make a profile usable for scoping. If any is missing the profile is
 * rejected outright — this is the invariant the old cast violated.
 */
function hasScopingIdentity(id: string, role: string, organizationId: string): boolean {
  return id.length > 0 && role.length > 0 && organizationId.length > 0;
}

/**
 * Build the impersonation `Profile` from a `usersApi` row.
 *
 * `id`, `role`, `email`, `first_name`, `last_name`, `status`, `phone`, `avatar_url`,
 * `theme_preference`, `availability_status`, `is_super_admin` and `created_at` come from the `User`
 * half; the goal/licence/notification fields and `organization_id` / `team_id` / `upline_id` come
 * from the nested `UserProfile` half. Returns `null` when the row cannot supply a scoping identity.
 */
export function toImpersonationProfile(source: ImpersonationSource | null | undefined): Profile | null {
  if (!source || typeof source !== "object") return null;
  const nested = source.profile;
  if (!nested || typeof nested !== "object") return null;

  const id = str(source.id);
  const role = str(source.role);
  const organizationId = str(nested.organizationId);
  if (!hasScopingIdentity(id, role, organizationId)) return null;

  const profile: Profile = {
    id,
    first_name: str(source.firstName),
    last_name: str(source.lastName),
    email: str(source.email),
    phone: str(source.phone),
    role,
    status: str(source.status),
    availability_status: str(source.availabilityStatus),
    avatar_url: str(source.avatar),
    theme_preference: str(source.themePreference),
    licensed_states: arr(nested.licensedStates),
    carriers: arr(nested.carriers),
    resident_state: str(nested.residentState),
    commission_level: str(nested.commissionLevel),
    upline_id: str(nested.uplineId),
    onboarding_complete: bool(nested.onboardingComplete),
    monthly_call_goal: num(nested.monthlyCallGoal),
    monthly_policies_goal: num(nested.monthlyPoliciesGoal),
    weekly_appointment_goal: num(nested.weeklyAppointmentGoal),
    monthly_appointment_goal: num(nested.monthlyAppointmentGoal),
    monthly_premium_goal: num(nested.monthlyPremiumGoal),
    npn: str(nested.npn),
    timezone: str(nested.timezone),
    win_sound_enabled: bool(nested.winSoundEnabled),
    email_notifications_enabled: bool(nested.emailNotificationsEnabled),
    sms_notifications_enabled: bool(nested.smsNotificationsEnabled),
    push_notifications_enabled: bool(nested.pushNotificationsEnabled),
    organization_id: organizationId,
    team_id: str(nested.teamId) || null,
    // The VIEWED profile's own flag — never the real Super Admin's. Viewing as an Agent must not
    // confer super-admin status on the effective profile.
    is_super_admin: bool(source.isSuperAdmin),
    // Platform authority is intentionally not impersonable (see the module header).
    platform_role: null,
    created_at: str(source.createdAt),
    updated_at: "",
  };

  return profile;
}

/**
 * Validate a `Profile` that came back out of `localStorage`.
 *
 * Storage is untrusted: it can hold a payload written by an older build (the legacy `UserProfile`
 * DTO, which has no `id` / `role` / `organization_id`), a hand-edited object, or a truncated write.
 * Anything that cannot supply a scoping identity is rejected so the session falls back to the real
 * profile instead of running on a half-built one.
 */
export function parseStoredImpersonationProfile(raw: string | null | undefined): Profile | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const candidate = parsed as Record<string, unknown>;
  const id = str(candidate.id);
  const role = str(candidate.role);
  const organizationId = str(candidate.organization_id);
  if (!hasScopingIdentity(id, role, organizationId)) return null;

  // Re-normalize rather than trusting the stored object wholesale, so a stored payload can never
  // introduce a field shape the app does not expect — including `platform_role`, which is pinned
  // to null no matter what storage claims.
  const profile: Profile = {
    id,
    first_name: str(candidate.first_name),
    last_name: str(candidate.last_name),
    email: str(candidate.email),
    phone: str(candidate.phone),
    role,
    status: str(candidate.status),
    availability_status: str(candidate.availability_status),
    avatar_url: str(candidate.avatar_url),
    theme_preference: str(candidate.theme_preference),
    licensed_states: arr(candidate.licensed_states),
    carriers: arr(candidate.carriers),
    resident_state: str(candidate.resident_state),
    commission_level: str(candidate.commission_level),
    upline_id: str(candidate.upline_id),
    onboarding_complete: bool(candidate.onboarding_complete),
    monthly_call_goal: num(candidate.monthly_call_goal),
    monthly_policies_goal: num(candidate.monthly_policies_goal),
    weekly_appointment_goal: num(candidate.weekly_appointment_goal),
    monthly_appointment_goal: num(candidate.monthly_appointment_goal),
    monthly_premium_goal: num(candidate.monthly_premium_goal),
    npn: str(candidate.npn),
    timezone: str(candidate.timezone),
    win_sound_enabled: bool(candidate.win_sound_enabled),
    email_notifications_enabled: bool(candidate.email_notifications_enabled),
    sms_notifications_enabled: bool(candidate.sms_notifications_enabled),
    push_notifications_enabled: bool(candidate.push_notifications_enabled),
    organization_id: organizationId,
    team_id: str(candidate.team_id) || null,
    is_super_admin: bool(candidate.is_super_admin),
    platform_role: null,
    created_at: str(candidate.created_at),
    updated_at: str(candidate.updated_at),
  };

  return profile;
}
