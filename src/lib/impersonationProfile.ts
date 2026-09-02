/**
 * impersonationProfile — the ONE mapper that builds the profile a Super Admin "View As" session
 * runs on, plus the fail-closed guard for the copy persisted in `localStorage`.
 *
 * ## Why this exists
 *
 * Every consumer reads the snake_case `profiles` ROW shape (`profile.id`, `profile.role`,
 * `profile.organization_id`). Both "View As" entry points used to hand `AuthContext` a `UserProfile`
 * instead — the camelCase DTO from `rowToUser`, which has `userId` / `organizationId` /
 * `isSuperAdmin` and **no `id`, no `role`, no `organization_id` at all** — through an unchecked
 * `as unknown as Profile` cast.
 *
 * The cast compiled and the object was structurally unrelated, so during "View As":
 *   `profile.id`, `profile.role`, `profile.organization_id`, `profile.is_super_admin` were all
 *   `undefined`; `useOrganization()` returned `undefined` org and role; `usePermissions` could
 *   never satisfy `canFetchPermissions` and stayed loading forever; and the TopBar rendered
 *   "Viewing as …" with a blank name.
 *
 * This module replaces both casts with one explicit, validated, unit-tested mapping.
 *
 * ## Current shape (corrected 2026-08-27)
 *
 * `AuthContext.startImpersonation` no longer takes a `Profile` at all — it takes the target's **id**
 * and re-reads the row from `profiles` itself, because a client-supplied object cannot be trusted to
 * state the target's role, status or organization. `profileRowToImpersonationProfile` is therefore
 * the only mapper on an authority path, and it is fed a SERVER row. `toImpersonationProfile` remains
 * exported and tested but is no longer used in production; see the warning on it.
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
 * Build a `Profile` from a client-side `usersApi` row.
 *
 * ⚠️ NOT AN AUTHORITY PATH, and no longer used by one. Impersonation is activated ONLY by
 * `AuthContext.startImpersonation`, which takes the target's **id** and re-reads the row from
 * `profiles` itself — precisely because a client-side DTO cannot be trusted to state the target's
 * role, status or organization. Do not re-wire this into `startImpersonation`; passing its output
 * there is what let a candidate claiming `role: "Admin"` impersonate an `Agent` row as an
 * organization-wide viewer. It is retained (and tested) as a plain DTO→row-shape mapper.
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
 * The ONLY thing persisted for an active "View As": a pointer bound to the operator who chose it.
 *
 * Two separate bypasses shaped this format.
 *
 * 1. The original format stored the whole `Profile`, including `role`, `organization_id` and
 *    `is_super_admin`, and rehydration validated only its SHAPE. Any signed-in user could write
 *    `{ id, role: "Admin", organization_id }` into storage and `useAuth().profile` — which every
 *    scoping surface reads — would hand back role "Admin".
 *
 * 2. v1 replaced that with a bare `{ version: 1, targetProfileId }` pointer, which removed the
 *    authority from the payload but left it OWNERLESS. `localStorage` is per-origin, not
 *    per-account: operator X's parked intent survived X signing out and Y signing in on the same
 *    browser, and the restore path re-read it as Y's intent. Whether Y could act on it depended
 *    entirely on Y *also* being a Super Admin in the target's organization — an authorization
 *    check the pointer had no business relying on, because it is the wrong question. The stored
 *    intent is "X wants to view as T", and it means nothing to anybody except X.
 *
 * v2 therefore records BOTH identifiers and nothing else. Authority still comes exclusively from
 * the server-side `profiles` row of the REAL session user; `ownerProfileId` decides only whether
 * this intent is addressed to the operator now holding the session.
 */
export interface StoredImpersonationTarget {
  version: 2;
  ownerProfileId: string;
  targetProfileId: string;
}

/**
 * What a caller gets back: the two identifiers, without the storage version. The version is a
 * detail of the payload on disk and carries no meaning once the payload has been accepted.
 */
export type StoredImpersonationPointer = Omit<StoredImpersonationTarget, "version">;

const IMPERSONATION_STORAGE_VERSION = 2;

/** Every storage access is wrapped: a blocked or quota-exhausted store must never crash the app. */
function safeStorage<T>(op: () => T, fallback: T): T {
  try {
    return op();
  } catch (e) {
    console.warn("[Auth] localStorage access failed:", e);
    return fallback;
  }
}

/** Remove any stored impersonation. Never throws. */
export function clearStoredImpersonation(): void {
  safeStorage(() => localStorage.removeItem(IMPERSONATION_STORAGE_KEY), undefined);
}

/**
 * Persist the owner-bound pointer. Never throws, and never writes an authority-bearing field.
 *
 * BOTH identifiers are mandatory. A pointer written without an owner would be indistinguishable
 * from the ownerless v1 payloads the reader is required to reject, so it is refused at the writer
 * rather than being persisted in a form that can only ever fail closed later.
 */
export function writeStoredImpersonationTarget(ownerProfileId: string, targetProfileId: string): void {
  const owner = str(ownerProfileId);
  const target = str(targetProfileId);
  if (!owner || !target) return;
  const payload: StoredImpersonationTarget = {
    version: IMPERSONATION_STORAGE_VERSION,
    ownerProfileId: owner,
    targetProfileId: target,
  };
  safeStorage(() => localStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(payload)), undefined);
}

/**
 * Read the stored pointer — both identifiers, and NOTHING else.
 *
 * Returns `null` for anything unreadable, malformed, wrong-versioned, or missing either id. The
 * caller must still compare `ownerProfileId` against the REAL authenticated profile before it
 * looks the target up, and must still re-fetch the target from the server: this function proves
 * only that *somebody* parked an intent, never that it belongs to the current operator.
 *
 * ## Legacy payloads are cleared, not salvaged
 *
 * A v1 pointer and a legacy serialized `Profile` both name a target with no record of who chose
 * it. There is no way to recover that owner after the fact — an owner cannot be inferred from
 * whoever happens to be signed in now, since that is exactly the confusion the format exists to
 * prevent. Both are therefore rejected AND erased on sight: leaving them in place would re-offer
 * the same unattributable intent on every subsequent load.
 */
export function readStoredImpersonationTarget(): StoredImpersonationPointer | null {
  const raw = safeStorage(() => localStorage.getItem(IMPERSONATION_STORAGE_KEY), null);
  if (typeof raw !== "string" || raw.trim().length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearStoredImpersonation();
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    clearStoredImpersonation();
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== IMPERSONATION_STORAGE_VERSION) {
    clearStoredImpersonation();
    return null;
  }

  const ownerProfileId = str(candidate.ownerProfileId);
  const targetProfileId = str(candidate.targetProfileId);
  if (!ownerProfileId || !targetProfileId) {
    clearStoredImpersonation();
    return null;
  }

  return { ownerProfileId, targetProfileId };
}

/**
 * The ONLY account status a "View As" may target.
 *
 * Eligibility is an allow-list, not a deny-list. Rejecting just `Deleted` let every other
 * non-active state through — `Inactive` above all, which `AuthContext.fetchProfile` treats as
 * grounds to sign the account OUT, and which `TeamMembersTable` already hides the Impersonate
 * action for. A missing or unrecognised status is refused for the same reason: an authority
 * decision must fail closed on a value it does not understand.
 */
export const IMPERSONATABLE_STATUS = "Active";

/** True only for an account that is eligible to be viewed as. */
export function isImpersonatableStatus(status: unknown): boolean {
  return typeof status === "string" && status.trim() === IMPERSONATABLE_STATUS;
}

/**
 * Build the impersonation `Profile` from a SERVER-FETCHED `profiles` row.
 *
 * This is the only path that may produce an active impersonation. It fails closed on a missing
 * scoping identity and on any status that is not `Active`, and it never carries `platform_role`.
 */
export function profileRowToImpersonationProfile(row: unknown): Profile | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;

  const id = str(r.id);
  const role = str(r.role);
  const organizationId = str(r.organization_id);
  if (!hasScopingIdentity(id, role, organizationId)) return null;

  // Only an eligible ACTIVE account may be impersonated — `Deleted`, `Inactive`, `Pending`,
  // anything unrecognised, and a missing status are all refused.
  const status = str(r.status);
  if (!isImpersonatableStatus(status)) return null;

  return {
    id,
    first_name: str(r.first_name),
    last_name: str(r.last_name),
    email: str(r.email),
    phone: str(r.phone),
    role,
    status,
    availability_status: str(r.availability_status),
    avatar_url: str(r.avatar_url),
    theme_preference: str(r.theme_preference),
    licensed_states: arr(r.licensed_states),
    carriers: arr(r.carriers),
    resident_state: str(r.resident_state),
    commission_level: str(r.commission_level),
    upline_id: str(r.upline_id),
    onboarding_complete: bool(r.onboarding_complete),
    monthly_call_goal: num(r.monthly_call_goal),
    monthly_policies_goal: num(r.monthly_policies_goal),
    weekly_appointment_goal: num(r.weekly_appointment_goal),
    monthly_appointment_goal: num(r.monthly_appointment_goal),
    monthly_premium_goal: num(r.monthly_premium_goal),
    npn: str(r.npn),
    timezone: str(r.timezone),
    win_sound_enabled: bool(r.win_sound_enabled),
    email_notifications_enabled: bool(r.email_notifications_enabled),
    sms_notifications_enabled: bool(r.sms_notifications_enabled),
    push_notifications_enabled: bool(r.push_notifications_enabled),
    organization_id: organizationId,
    team_id: str(r.team_id) || null,
    is_super_admin: bool(r.is_super_admin),
    // Platform authority is never impersonable — it is read from `realProfile`.
    platform_role: null,
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}
