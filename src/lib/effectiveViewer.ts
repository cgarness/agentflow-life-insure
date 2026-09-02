/**
 * effectiveViewer — the single, explicit accessor contract for "who is looking at this data".
 *
 * The codebase historically had two competing conventions:
 *   - `useAuth().user.id`  — ALWAYS the real authenticated Supabase session user. Under Super Admin
 *     "View As" this is the Super Admin, never the viewed profile.
 *   - `useAuth().profile`  — already impersonation-aware (`AuthContext` returns
 *     `impersonatedUser || profile`), so `profile.id` IS the effective viewer.
 *
 * Data scoping must use the EFFECTIVE identity. This module holds the pure half of that contract
 * (a type plus two predicates) so it can be unit-tested with no React and no Supabase.
 *
 * ⚠️ `useOrganization().isSuperAdmin` is deliberately NOT usable for this: it returns
 * `isSuperAdmin || isImpersonating`, i.e. **true for the whole duration of a "View As" session
 * regardless of who is being viewed**. Gating an organization-wide branch on it widens "View As
 * Agent" back to the entire organization — the exact failure this module exists to prevent.
 * Use `isOrganizationWideViewer` / `isEffectiveSuperAdmin` instead.
 *
 * This is QUERY SCOPING, not a database authorization boundary. RLS always evaluates the REAL
 * `auth.uid()`; impersonation is a client-side construct the server never sees.
 */

/** The role strings enforced by the `profiles_role_check` DB constraint. */
export const AGENT_ROLE = "Agent";
export const TEAM_LEADER_ROLE = "Team Leader";
export const ADMIN_ROLE = "Admin";
export const SUPER_ADMIN_ROLE = "Super Admin";

export interface EffectiveViewer {
  /** `profiles.id` of the EFFECTIVE profile — the viewed profile while "View As" is active. */
  viewerId: string;
  /** The EFFECTIVE agency role, exact-cased as stored (`Agent` / `Team Leader` / `Admin` / `Super Admin`). */
  role: string;
  /** The EFFECTIVE organization — the viewed profile's org while "View As" is active, else the home org. */
  organizationId: string;
  /** True while a Super Admin is viewing as another profile. */
  isImpersonating: boolean;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Build an `EffectiveViewer` from loosely-typed inputs, or `null` when the identity is not fully
 * resolved. `null` means "not ready" and callers MUST treat it as loading — never as an empty
 * result, and never as a licence to query unscoped.
 */
export function buildEffectiveViewer(input: {
  viewerId?: string | null;
  role?: string | null;
  organizationId?: string | null;
  isImpersonating?: boolean;
}): EffectiveViewer | null {
  const viewerId = isNonEmptyString(input.viewerId) ? input.viewerId.trim() : "";
  const role = isNonEmptyString(input.role) ? input.role.trim() : "";
  const organizationId = isNonEmptyString(input.organizationId) ? input.organizationId.trim() : "";
  if (!viewerId || !role || !organizationId) return null;
  return { viewerId, role, organizationId, isImpersonating: input.isImpersonating === true };
}

/**
 * True for a viewer entitled to organization-wide reads: an Admin, or a Super Admin who is NOT
 * impersonating (home-organization scope).
 *
 * Under "View As Agent" the effective role is `Agent`, so this returns **false** — the real Super
 * Admin session cannot widen the displayed results.
 */
export function isOrganizationWideViewer(viewer: EffectiveViewer | null | undefined): boolean {
  if (!viewer) return false;
  if (viewer.role === ADMIN_ROLE) return true;
  return viewer.role === SUPER_ADMIN_ROLE && !viewer.isImpersonating;
}

/**
 * True only for a real, non-impersonating Super Admin. This is the safe replacement for
 * `useOrganization().isSuperAdmin` at any site that decides how much DATA to show.
 * (Navigation/settings-visibility gates may keep using the old flag — they are not data scope.)
 */
export function isEffectiveSuperAdmin(viewer: EffectiveViewer | null | undefined): boolean {
  return !!viewer && viewer.role === SUPER_ADMIN_ROLE && !viewer.isImpersonating;
}

/**
 * Stable identity key for the clear-and-guard pattern.
 *
 * Under "View As" the organization changes IN PLACE with no remount, so consumers must derive
 * their reset from this key on the SAME render the identity changes — an effect-based reset would
 * be one commit too late and would let the previous viewer's rows paint.
 */
export function effectiveViewerKey(viewer: EffectiveViewer | null | undefined): string | null {
  if (!viewer) return null;
  return `${viewer.viewerId}::${viewer.organizationId}::${viewer.role}::${viewer.isImpersonating ? 1 : 0}`;
}
