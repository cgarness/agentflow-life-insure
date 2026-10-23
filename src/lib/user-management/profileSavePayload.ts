/**
 * Settings → User Management profile save: what `UserProfileModal` sends, built as a pure
 * function so the rules are testable without rendering the modal.
 *
 * Why the diff matters (hierarchy stabilization F1): PostgreSQL fires `UPDATE OF upline_id`
 * / `UPDATE OF commission_level` triggers whenever the column is in the SET list, even when
 * the value is unchanged. The modal used to send both on every save, so an ordinary save of
 * a Team Leader re-derived its children's `hierarchy_path` (activating Team Leader
 * authority without review) and every save took the hierarchy lock. `upline_id` and
 * `commission_level` are therefore sent ONLY when they differ from the mapped original row.
 *
 * Account-control editability (F6) mirrors `enforce_profile_field_authorization` and the
 * commission-level guard so the UI does not offer a change the database will refuse. It is
 * a UI mirror, NOT authorization: the database decides from the actor's profile row.
 */
import type { User, UserProfile, UserRole, UserStatus } from "@/lib/types";

/** The row the modal opened, as mapped by `usersSupabaseApi` (`rowToUser`). */
export type ProfileSaveOriginal = Pick<User, "id" | "role" | "status" | "isSuperAdmin"> & {
  profile: Pick<UserProfile, "commissionLevel"> & {
    /** `null` = no upline; `undefined` = unknown (a schema-fallback row never selected it). */
    uplineId?: string | null;
  };
};

/** The modal's form state. Carriers must already be normalized by the caller. */
export interface ProfileSaveForm {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  role?: string;
  status?: string;
  avatar?: string;
  isSuperAdmin?: boolean;
  licensedStates?: unknown[] | null;
  residentState?: string | null;
  commissionLevel?: string | null;
  /** A profile id, `null` / `"_none"` / `""` for "None", or `undefined` when untouched. */
  uplineId?: string | null;
  npn?: string | null;
  timezone?: string | null;
  carriers?: unknown[] | null;
}

export interface ProfileSaveViewer {
  /** The viewer's profile is `is_super_admin`, or role Admin / Super Admin of this org. */
  isAdminViewer: boolean;
  /** The viewer is editing their own profile. */
  isSelf: boolean;
  /** The viewer is a platform super admin (`is_super_admin`); gates the Super Admin switch. */
  isSuperAdminViewer?: boolean;
}

/** Which account-control inputs the modal may enable for this viewer and target. */
export interface ProfileFieldEditability {
  /** No one changes their own role; otherwise Admin-only. */
  role: boolean;
  /** Admin-only, and never on one's own profile (existing modal rule). */
  status: boolean;
  /** Admin-only (`enforce_profile_field_authorization`). */
  upline: boolean;
  /** Admin-only (`enforce_profile_field_authorization`). */
  billing: boolean;
  /** Admin, or the member themself (M1 commission-level guard). */
  commission: boolean;
  /** Platform super admin, never on their own profile. */
  superAdminFlag: boolean;
  /** "Delete User" — Admin-only and never one's own profile. */
  deleteUser: boolean;
  /** Deactivate / Reactivate — Admin-only and never one's own profile. */
  deactivate: boolean;
}

export interface ProfileSavePayload {
  /** For `usersSupabaseApi.update(id, …)`. */
  userUpdates: Partial<User>;
  /** For `usersSupabaseApi.updateProfile(id, …)`; `uplineId` / `commissionLevel` only when changed. */
  profileUpdates: Partial<Omit<UserProfile, "uplineId">> & { uplineId?: string | null };
  editable: ProfileFieldEditability;
}

const DEFAULT_COMMISSION_LEVEL = "0%";
const DEFAULT_TIMEZONE = "Eastern Time (US & Canada)";

/**
 * `isAdminViewer` as `enforce_profile_field_authorization` decides it: the viewer's profile is
 * `is_super_admin`, or has role Admin / Super Admin in the member's organization. Pass the
 * viewer's PROFILE fields (e.g. `useAuth().realProfile`), not JWT claims.
 */
export function isOrgAdminViewer(
  viewer: { role?: string | null; isSuperAdmin?: boolean | null; organizationId?: string | null } | null | undefined,
  memberOrganizationId: string | null | undefined,
): boolean {
  if (!viewer) return false;
  if (viewer.isSuperAdmin === true) return true;
  const role = viewer.role ?? "";
  return (
    (role === "Admin" || role === "Super Admin") &&
    !!viewer.organizationId &&
    viewer.organizationId === memberOrganizationId
  );
}

export function profileFieldEditability(viewer: ProfileSaveViewer): ProfileFieldEditability {
  const admin = viewer.isAdminViewer === true;
  const self = viewer.isSelf === true;
  return {
    role: admin && !self,
    status: admin && !self,
    upline: admin,
    billing: admin,
    commission: admin || self,
    superAdminFlag: viewer.isSuperAdminViewer === true && !self,
    deleteUser: admin && !self,
    deactivate: admin && !self,
  };
}

/** `null` for "None"; `undefined` when the form never held a value. */
function normalizeFormUpline(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "_none" ? null : trimmed;
}

export function buildProfileSavePayload(
  original: ProfileSaveOriginal,
  form: ProfileSaveForm,
  viewer: ProfileSaveViewer,
): ProfileSavePayload {
  const editable = profileFieldEditability(viewer);

  const userUpdates: Partial<User> = {};
  if (form.firstName !== undefined) userUpdates.firstName = form.firstName;
  if (form.lastName !== undefined) userUpdates.lastName = form.lastName;
  if (form.email !== undefined) userUpdates.email = form.email;
  if (form.phone !== undefined) userUpdates.phone = form.phone;
  if (form.avatar !== undefined) userUpdates.avatar = form.avatar;
  // Role, status and the Super Admin flag: sent only when editable AND changed, so a
  // read-only or untouched control can never put an account-control column in the PATCH.
  if (editable.role && form.role !== undefined && form.role !== original.role) {
    userUpdates.role = form.role as UserRole;
  }
  if (editable.status && form.status !== undefined && form.status !== original.status) {
    userUpdates.status = form.status as UserStatus;
  }
  if (
    editable.superAdminFlag &&
    form.isSuperAdmin !== undefined &&
    form.isSuperAdmin !== (original.isSuperAdmin === true)
  ) {
    userUpdates.isSuperAdmin = form.isSuperAdmin;
  }

  const profileUpdates: ProfileSavePayload["profileUpdates"] = {
    licensedStates: form.licensedStates ?? [],
    residentState: form.residentState || "",
    npn: form.npn || "",
    timezone: form.timezone || DEFAULT_TIMEZONE,
    carriers: form.carriers ?? [],
  };

  // Upline: only an Admin may change it, and only a real change is sent. An original whose
  // upline is unknown (schema-fallback row) never sends one: there is nothing to diff against.
  const nextUpline = normalizeFormUpline(form.uplineId);
  const originalUpline = original.profile.uplineId;
  if (editable.upline && nextUpline !== undefined && originalUpline !== undefined) {
    if (nextUpline !== (originalUpline ?? null)) profileUpdates.uplineId = nextUpline;
  }

  // Commission: `rowToUser` maps NULL to "0%", and the modal saves "" as "0%", so both sides
  // are compared in that form — an untouched NULL is never rewritten as "0%".
  if (editable.commission && form.commissionLevel !== undefined) {
    const nextCommission = form.commissionLevel || DEFAULT_COMMISSION_LEVEL;
    const originalCommission = original.profile.commissionLevel || DEFAULT_COMMISSION_LEVEL;
    if (nextCommission !== originalCommission) profileUpdates.commissionLevel = nextCommission;
  }

  return { userUpdates, profileUpdates, editable };
}
