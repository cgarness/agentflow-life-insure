/**
 * F1 / F6 — `buildProfileSavePayload`: what Settings → User Management sends on Save.
 *
 * `upline_id` and `commission_level` are listed in the PATCH only when they really change
 * (an `UPDATE OF upline_id` trigger fires on the SET list, not on the value), never when the
 * viewer may not change them, and role / status / the Super Admin flag likewise. The
 * editability flags mirror `enforce_profile_field_authorization` and the commission-level
 * guard for the UI; they are not authorization.
 *
 * All ids are synthetic. No production identifier appears in this file.
 */
import { describe, expect, it } from "vitest";
import {
  buildProfileSavePayload,
  isOrgAdminViewer,
  profileFieldEditability,
  type ProfileSaveForm,
  type ProfileSaveOriginal,
} from "@/lib/user-management/profileSavePayload";
import type { User, UserProfile } from "@/lib/types";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

const TL = uid(1);
const OTHER_TL = uid(2);

const original = (over: Partial<ProfileSaveOriginal["profile"]> = {}, top: Partial<ProfileSaveOriginal> = {}): ProfileSaveOriginal => ({
  id: uid(9),
  role: "Agent",
  status: "Active",
  isSuperAdmin: false,
  ...top,
  profile: { commissionLevel: "50%", uplineId: TL, ...over },
});

/** The modal seeds its form from the original row; tests then change one thing. */
const seeded = (o: ProfileSaveOriginal, over: ProfileSaveForm = {}): ProfileSaveForm => ({
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.test",
  phone: "",
  role: o.role,
  status: o.status,
  isSuperAdmin: o.isSuperAdmin,
  licensedStates: [],
  residentState: "",
  commissionLevel: o.profile.commissionLevel,
  uplineId: o.profile.uplineId,
  npn: "",
  timezone: "",
  carriers: [],
  ...over,
});

const ADMIN_OTHER = { isAdminViewer: true, isSelf: false };
const ADMIN_SELF = { isAdminViewer: true, isSelf: true };
const TL_OTHER = { isAdminViewer: false, isSelf: false };
const NON_ADMIN_SELF = { isAdminViewer: false, isSelf: true };

describe("upline — sent only when it really changes", () => {
  it("an untouched uuid upline is omitted (no uplineId key at all)", () => {
    const o = original();
    const { profileUpdates } = buildProfileSavePayload(o, seeded(o), ADMIN_OTHER);
    expect(profileUpdates).not.toHaveProperty("uplineId");
  });

  it("an untouched null upline is omitted, whether the form holds null or \"_none\"", () => {
    const o = original({ uplineId: null });
    for (const formValue of [null, "_none", ""]) {
      const { profileUpdates } = buildProfileSavePayload(o, seeded(o, { uplineId: formValue }), ADMIN_OTHER);
      expect(profileUpdates).not.toHaveProperty("uplineId");
    }
  });

  it("uuid → None sends uplineId: null", () => {
    const o = original();
    for (const formValue of [null, "_none"]) {
      const { profileUpdates } = buildProfileSavePayload(o, seeded(o, { uplineId: formValue }), ADMIN_OTHER);
      expect(profileUpdates).toHaveProperty("uplineId", null);
    }
  });

  it("null → uuid and uuid → another uuid are sent", () => {
    const fromNone = original({ uplineId: null });
    expect(buildProfileSavePayload(fromNone, seeded(fromNone, { uplineId: TL }), ADMIN_OTHER).profileUpdates.uplineId).toBe(TL);
    const moved = original();
    expect(buildProfileSavePayload(moved, seeded(moved, { uplineId: OTHER_TL }), ADMIN_OTHER).profileUpdates.uplineId).toBe(OTHER_TL);
  });

  it("a schema-fallback original (upline unknown) never sends an upline", () => {
    const o = original({ uplineId: undefined });
    for (const formValue of [TL, null, "_none"]) {
      const { profileUpdates } = buildProfileSavePayload(o, seeded(o, { uplineId: formValue }), ADMIN_OTHER);
      expect(profileUpdates).not.toHaveProperty("uplineId");
    }
  });

  it("a form that never held an upline (undefined) sends none", () => {
    const o = original();
    const { profileUpdates } = buildProfileSavePayload(o, seeded(o, { uplineId: undefined }), ADMIN_OTHER);
    expect(profileUpdates).not.toHaveProperty("uplineId");
  });

  it("a non-Admin never sends an upline, even a changed one", () => {
    const o = original();
    for (const viewer of [TL_OTHER, NON_ADMIN_SELF]) {
      const { profileUpdates } = buildProfileSavePayload(o, seeded(o, { uplineId: OTHER_TL }), viewer);
      expect(profileUpdates).not.toHaveProperty("uplineId");
    }
  });

  it("an Admin editing their own profile may change their upline", () => {
    const o = original({ uplineId: null });
    expect(buildProfileSavePayload(o, seeded(o, { uplineId: TL }), ADMIN_SELF).profileUpdates.uplineId).toBe(TL);
  });
});

describe("commission level — sent only when changed and editable", () => {
  it("an unchanged commission level is omitted", () => {
    const o = original();
    const { profileUpdates } = buildProfileSavePayload(o, seeded(o), ADMIN_OTHER);
    expect(profileUpdates).not.toHaveProperty("commissionLevel");
  });

  it("a NULL level (mapped to \"0%\") left as \"0%\" or blank is never rewritten", () => {
    const o = original({ commissionLevel: "0%" });
    for (const formValue of ["0%", "", null]) {
      const { profileUpdates } = buildProfileSavePayload(o, seeded(o, { commissionLevel: formValue }), ADMIN_OTHER);
      expect(profileUpdates).not.toHaveProperty("commissionLevel");
    }
  });

  it("a Team Leader editing another member never sends commission, even changed", () => {
    const o = original();
    const { profileUpdates, editable } = buildProfileSavePayload(o, seeded(o, { commissionLevel: "90%" }), TL_OTHER);
    expect(profileUpdates).not.toHaveProperty("commissionLevel");
    expect(editable.commission).toBe(false);
  });

  it("an Admin editing another member sends a changed level", () => {
    const o = original();
    expect(buildProfileSavePayload(o, seeded(o, { commissionLevel: "75%" }), ADMIN_OTHER).profileUpdates.commissionLevel).toBe("75%");
  });

  it("an Admin editing themself sends a changed level", () => {
    const o = original();
    expect(buildProfileSavePayload(o, seeded(o, { commissionLevel: "80%" }), ADMIN_SELF).profileUpdates.commissionLevel).toBe("80%");
  });

  it("a member editing themself keeps the existing self-edit (M1 guard lets self pass)", () => {
    const o = original();
    expect(buildProfileSavePayload(o, seeded(o, { commissionLevel: "60%" }), NON_ADMIN_SELF).profileUpdates.commissionLevel).toBe("60%");
  });

  it("an Admin clearing the level sends \"0%\" (the modal's existing default)", () => {
    const o = original();
    expect(buildProfileSavePayload(o, seeded(o, { commissionLevel: "" }), ADMIN_OTHER).profileUpdates.commissionLevel).toBe("0%");
  });
});

describe("role, status and the Super Admin flag", () => {
  it("unchanged role and status are not sent", () => {
    const o = original();
    const { userUpdates } = buildProfileSavePayload(o, seeded(o), ADMIN_OTHER);
    expect(userUpdates).not.toHaveProperty("role");
    expect(userUpdates).not.toHaveProperty("status");
    expect(userUpdates).not.toHaveProperty("isSuperAdmin");
  });

  it("an Admin's changed role and status are sent", () => {
    const o = original();
    const { userUpdates } = buildProfileSavePayload(o, seeded(o, { role: "Team Leader", status: "Inactive" }), ADMIN_OTHER);
    expect(userUpdates).toMatchObject({ role: "Team Leader", status: "Inactive" });
  });

  it("a non-Admin never sends role or status", () => {
    const o = original();
    const { userUpdates } = buildProfileSavePayload(o, seeded(o, { role: "Admin", status: "Inactive" }), TL_OTHER);
    expect(userUpdates).not.toHaveProperty("role");
    expect(userUpdates).not.toHaveProperty("status");
  });

  it("no one sends a change to their own role or status", () => {
    const o = original();
    for (const viewer of [ADMIN_SELF, NON_ADMIN_SELF]) {
      const { userUpdates } = buildProfileSavePayload(o, seeded(o, { role: "Admin", status: "Inactive" }), viewer);
      expect(userUpdates).not.toHaveProperty("role");
      expect(userUpdates).not.toHaveProperty("status");
    }
  });

  it("the Super Admin flag is sent only by a platform super admin, never for their own profile", () => {
    const o = original();
    const form = seeded(o, { isSuperAdmin: true });
    expect(buildProfileSavePayload(o, form, { ...ADMIN_OTHER, isSuperAdminViewer: true }).userUpdates.isSuperAdmin).toBe(true);
    expect(buildProfileSavePayload(o, form, ADMIN_OTHER).userUpdates).not.toHaveProperty("isSuperAdmin");
    expect(buildProfileSavePayload(o, form, { ...ADMIN_SELF, isSuperAdminViewer: true }).userUpdates).not.toHaveProperty("isSuperAdmin");
  });

  it("names, email, phone and avatar pass through for every viewer", () => {
    const o = original();
    const { userUpdates } = buildProfileSavePayload(o, seeded(o, { phone: "555", avatar: "data:x" }), TL_OTHER);
    expect(userUpdates).toEqual({ firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", phone: "555", avatar: "data:x" });
  });
});

describe("the other profile fields keep the modal's existing defaults", () => {
  it("fills blanks exactly as the modal did", () => {
    const o = original();
    const { profileUpdates } = buildProfileSavePayload(
      o,
      seeded(o, { licensedStates: null, residentState: null, npn: null, timezone: null, carriers: null }),
      TL_OTHER,
    );
    expect(profileUpdates).toEqual({
      licensedStates: [],
      residentState: "",
      npn: "",
      timezone: "Eastern Time (US & Canada)",
      carriers: [],
    });
  });

  it("passes licences, NPN, timezone and (already normalized) carriers through", () => {
    const o = original();
    const carriers = [{ carrier: "Acme Life", writingNumber: "W1" }];
    const { profileUpdates } = buildProfileSavePayload(
      o,
      seeded(o, { licensedStates: [{ state: "TX", licenseNumber: "1" }], residentState: "TX", npn: "42", timezone: "Central Time (US & Canada)", carriers }),
      ADMIN_OTHER,
    );
    expect(profileUpdates).toEqual({
      licensedStates: [{ state: "TX", licenseNumber: "1" }],
      residentState: "TX",
      npn: "42",
      timezone: "Central Time (US & Canada)",
      carriers,
    });
  });
});

describe("account-control editability (UI mirror of the database rules)", () => {
  it("a non-Admin editing another member gets every account control disabled", () => {
    expect(profileFieldEditability(TL_OTHER)).toEqual({
      role: false,
      status: false,
      upline: false,
      billing: false,
      commission: false,
      superAdminFlag: false,
      deleteUser: false,
      deactivate: false,
    });
  });

  it("an Admin editing another member gets them all except the Super Admin flag", () => {
    expect(profileFieldEditability(ADMIN_OTHER)).toEqual({
      role: true,
      status: true,
      upline: true,
      billing: true,
      commission: true,
      superAdminFlag: false,
      deleteUser: true,
      deactivate: true,
    });
  });

  it("an Admin editing themself keeps upline, billing and commission but not role, status, delete or deactivate", () => {
    expect(profileFieldEditability(ADMIN_SELF)).toMatchObject({
      role: false,
      status: false,
      upline: true,
      billing: true,
      commission: true,
      deleteUser: false,
      deactivate: false,
    });
  });

  it("a non-Admin editing themself keeps only commission", () => {
    expect(profileFieldEditability(NON_ADMIN_SELF)).toEqual({
      role: false,
      status: false,
      upline: false,
      billing: false,
      commission: true,
      superAdminFlag: false,
      deleteUser: false,
      deactivate: false,
    });
  });

  it("the payload reports the same editability", () => {
    const o = original();
    expect(buildProfileSavePayload(o, seeded(o), TL_OTHER).editable).toEqual(profileFieldEditability(TL_OTHER));
  });
});

describe("fits the modal's existing types", () => {
  it("accepts the mapped `User & { profile: UserProfile }` row and the modal's `Partial<User & UserProfile>` form", () => {
    const row = {
      id: uid(9),
      email: "ada@example.test",
      firstName: "Ada",
      lastName: "Lovelace",
      role: "Agent",
      status: "Active",
      isSuperAdmin: false,
      profile: { commissionLevel: "50%", uplineId: TL },
    } as unknown as User & { profile: UserProfile };
    const form: Partial<User & UserProfile> = { firstName: "Ada", role: "Agent", status: "Active", uplineId: TL, commissionLevel: "50%" };
    const { profileUpdates, userUpdates } = buildProfileSavePayload(row, form, ADMIN_OTHER);
    expect(profileUpdates).not.toHaveProperty("uplineId");
    expect(profileUpdates).not.toHaveProperty("commissionLevel");
    expect(userUpdates).toEqual({ firstName: "Ada" });
  });
});

describe("isOrgAdminViewer — mirrors enforce_profile_field_authorization", () => {
  it("is_super_admin profiles are admins anywhere", () => {
    expect(isOrgAdminViewer({ role: "Agent", isSuperAdmin: true, organizationId: OTHER_ORG }, ORG)).toBe(true);
  });

  it("Admin / Super Admin roles are admins of their own organization only", () => {
    expect(isOrgAdminViewer({ role: "Admin", organizationId: ORG }, ORG)).toBe(true);
    expect(isOrgAdminViewer({ role: "Super Admin", organizationId: ORG }, ORG)).toBe(true);
    expect(isOrgAdminViewer({ role: "Admin", organizationId: OTHER_ORG }, ORG)).toBe(false);
    expect(isOrgAdminViewer({ role: "Admin", organizationId: null }, null)).toBe(false);
  });

  it("Team Leaders, Agents and a missing viewer are not", () => {
    expect(isOrgAdminViewer({ role: "Team Leader", organizationId: ORG }, ORG)).toBe(false);
    expect(isOrgAdminViewer({ role: "Agent", organizationId: ORG }, ORG)).toBe(false);
    expect(isOrgAdminViewer(null, ORG)).toBe(false);
  });
});
