/**
 * toImpersonationProfile / the stored-pointer API — the "View As" payload and authority repair.
 *
 * The defect: both entry points did `startImpersonation(u.profile as unknown as Profile)`, handing
 * AuthContext a camelCase `UserProfile` DTO (`userId` / `organizationId` / `isSuperAdmin`, and NO
 * `id`, `role`, `organization_id`, `first_name` or `email` at all) cast to the snake_case `Profile`
 * row shape every consumer reads. During "View As" that made `profile.id`, `profile.role`,
 * `profile.organization_id` and `profile.is_super_admin` all `undefined`, which in turn left
 * `useOrganization()` with an undefined org and role and `usePermissions` loading forever.
 *
 * A SECOND, separate defect was that storage held the whole `Profile` and rehydration validated
 * only its shape, so any signed-in user could forge an Admin role for themselves. Storage now holds
 * only `{ version: 1, targetProfileId }`; authority is proved server-side (see
 * `src/contexts/__tests__/impersonationAuthority.test.tsx`).
 *
 * These tests pin the replacement AND the fail-closed behaviour on malformed stored data.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  IMPERSONATABLE_STATUS,
  IMPERSONATION_STORAGE_KEY,
  clearStoredImpersonation,
  isImpersonatableStatus,
  profileRowToImpersonationProfile,
  readStoredImpersonationTargetId,
  toImpersonationProfile,
  writeStoredImpersonationTarget,
  type ImpersonationSource,
} from "@/lib/impersonationProfile";
import type { User, UserProfile } from "@/lib/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";

function source(overrides: Partial<User> = {}, profileOverrides: Partial<UserProfile> = {}): ImpersonationSource {
  const user: User = {
    id: AGENT_ID,
    email: "agent@example.test",
    firstName: "Ada",
    lastName: "Agent",
    role: "Agent",
    phone: "555-0100",
    avatar: "https://example.test/a.png",
    status: "Active",
    availabilityStatus: "Available",
    themePreference: "dark",
    isSuperAdmin: false,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
  const profile: UserProfile = {
    userId: AGENT_ID,
    licensedStates: ["TX"],
    carriers: ["Carrier A"],
    residentState: "TX",
    commissionLevel: "80%",
    uplineId: "33333333-3333-4333-8333-333333333333",
    onboardingComplete: true,
    monthlyCallGoal: 100,
    monthlyPoliciesGoal: 10,
    weeklyAppointmentGoal: 5,
    monthlyAppointmentGoal: 20,
    monthlyPremiumGoal: 5000,
    npn: "NPN123",
    timezone: "Eastern Time (US & Canada)",
    winSoundEnabled: true,
    emailNotificationsEnabled: true,
    smsNotificationsEnabled: false,
    pushNotificationsEnabled: true,
    organizationId: ORG,
    teamId: "44444444-4444-4444-8444-444444444444",
    isSuperAdmin: false,
    ...profileOverrides,
  };
  return { ...user, profile };
}

describe("toImpersonationProfile — produces a REAL Profile, not an undefined-riddled cast", () => {
  it("populates the three fields that decide data scope", () => {
    const p = toImpersonationProfile(source());
    expect(p).not.toBeNull();
    // These are precisely what the old `as unknown as Profile` cast left undefined.
    expect(p!.id).toBe(AGENT_ID);
    expect(p!.role).toBe("Agent");
    expect(p!.organization_id).toBe(ORG);
    expect(p!.is_super_admin).toBe(false);
  });

  it("carries the display identity the TopBar and banner render", () => {
    const p = toImpersonationProfile(source())!;
    expect(p.first_name).toBe("Ada");
    expect(p.last_name).toBe("Agent");
    expect(p.email).toBe("agent@example.test");
    // "Viewing as undefined" was the visible symptom of the broken payload.
    expect(`${p.first_name}`).not.toContain("undefined");
  });

  it("maps the snake_case row shape from BOTH halves of the source", () => {
    const p = toImpersonationProfile(source())!;
    expect(p.status).toBe("Active");
    expect(p.phone).toBe("555-0100");
    expect(p.avatar_url).toBe("https://example.test/a.png");
    expect(p.theme_preference).toBe("dark");
    expect(p.upline_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(p.team_id).toBe("44444444-4444-4444-8444-444444444444");
    expect(p.commission_level).toBe("80%");
    expect(p.licensed_states).toEqual(["TX"]);
    expect(p.monthly_call_goal).toBe(100);
    expect(p.win_sound_enabled).toBe(true);
    expect(p.sms_notifications_enabled).toBe(false);
    // No camelCase leakage.
    expect((p as unknown as Record<string, unknown>).organizationId).toBeUndefined();
    expect((p as unknown as Record<string, unknown>).userId).toBeUndefined();
  });

  it("does NOT impersonate platform authority", () => {
    const p = toImpersonationProfile(source())!;
    // `platform_role` is read from realProfile (useIsPlatformAdmin), never the effective profile.
    expect(p.platform_role).toBeNull();
  });

  it("carries the VIEWED user's super-admin flag, not a hardcoded one", () => {
    const p = toImpersonationProfile(source({ isSuperAdmin: true, role: "Super Admin" }))!;
    expect(p.is_super_admin).toBe(true);
    expect(p.role).toBe("Super Admin");
  });
});

describe("toImpersonationProfile — fails closed", () => {
  it("rejects a source with no organization", () => {
    expect(toImpersonationProfile(source({}, { organizationId: null }))).toBeNull();
  });

  it("rejects a source with no role", () => {
    expect(toImpersonationProfile(source({ role: "" as never }))).toBeNull();
  });

  it("rejects a source with no id", () => {
    expect(toImpersonationProfile(source({ id: "" }))).toBeNull();
  });

  it("rejects a bare UserProfile — the exact payload the old cast passed", () => {
    const legacy = source().profile as unknown as ImpersonationSource;
    expect(toImpersonationProfile(legacy)).toBeNull();
  });

  it("rejects null / undefined / a non-object", () => {
    expect(toImpersonationProfile(null)).toBeNull();
    expect(toImpersonationProfile(undefined)).toBeNull();
    expect(toImpersonationProfile({ id: AGENT_ID } as unknown as ImpersonationSource)).toBeNull();
  });
});

describe("stored impersonation is a POINTER, never authority", () => {
  // The bypass this replaces: the whole `Profile` used to be persisted and rehydrated after a
  // shape-only check, so any signed-in user could write `{ id, role: "Admin", organization_id }`
  // into storage and be granted an organization-wide role by the application itself.
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { store = {}; },
        key: () => null,
        length: 0,
      },
    });
  });

  it("writes ONLY a versioned target id", () => {
    writeStoredImpersonationTarget(AGENT_ID);
    const written = JSON.parse(store[IMPERSONATION_STORAGE_KEY]);
    expect(written).toEqual({ version: 1, targetProfileId: AGENT_ID });
    // Nothing authority-bearing may be persisted.
    expect(Object.keys(written).sort()).toEqual(["targetProfileId", "version"]);
  });

  it("round-trips the pointer", () => {
    writeStoredImpersonationTarget(AGENT_ID);
    expect(readStoredImpersonationTargetId()).toBe(AGENT_ID);
  });

  it("salvages ONLY the id from a legacy full-profile payload — never its role or organization", () => {
    store[IMPERSONATION_STORAGE_KEY] = JSON.stringify({
      id: AGENT_ID, role: "Admin", organization_id: ORG, is_super_admin: true,
    });
    // The id is a candidate pointer, still worthless until re-validated server-side.
    expect(readStoredImpersonationTargetId()).toBe(AGENT_ID);
    // And there is no API that could return the forged role/org — the function returns a string.
    expect(typeof readStoredImpersonationTargetId()).toBe("string");
  });

  it("rejects malformed, wrong-versioned and empty payloads", () => {
    for (const raw of [
      "{not json", "[]", "null", '"a string"', "{}",
      JSON.stringify({ version: 2, targetProfileId: AGENT_ID }),
      JSON.stringify({ version: 1, targetProfileId: "" }),
      JSON.stringify({ version: 1 }),
    ]) {
      store[IMPERSONATION_STORAGE_KEY] = raw;
      expect(readStoredImpersonationTargetId(), `payload: ${raw}`).toBeNull();
    }
  });

  it("returns null when nothing is stored", () => {
    expect(readStoredImpersonationTargetId()).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true, writable: true,
      value: {
        getItem() { throw new DOMException("denied", "SecurityError"); },
        setItem() { throw new DOMException("denied", "SecurityError"); },
        removeItem() { throw new DOMException("denied", "SecurityError"); },
      },
    });
    expect(() => readStoredImpersonationTargetId()).not.toThrow();
    expect(readStoredImpersonationTargetId()).toBeNull();
    expect(() => writeStoredImpersonationTarget(AGENT_ID)).not.toThrow();
    expect(() => clearStoredImpersonation()).not.toThrow();
  });

  it("clear removes the pointer", () => {
    writeStoredImpersonationTarget(AGENT_ID);
    clearStoredImpersonation();
    expect(readStoredImpersonationTargetId()).toBeNull();
  });

  it("exports the storage key so writer and reader cannot drift apart", () => {
    expect(IMPERSONATION_STORAGE_KEY).toBe("agentflow_impersonation");
  });
});

describe("profileRowToImpersonationProfile — the ONLY path that can activate an impersonation", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: AGENT_ID, role: "Agent", organization_id: ORG, is_super_admin: false,
    status: "Active", first_name: "Tara", last_name: "Target", email: "t@x.test",
    phone: "555", team_id: null, upline_id: null, ...over,
  });

  it("builds a usable effective profile from a server row", () => {
    const p = profileRowToImpersonationProfile(row())!;
    expect(p.id).toBe(AGENT_ID);
    expect(p.role).toBe("Agent");
    expect(p.organization_id).toBe(ORG);
    expect(p.first_name).toBe("Tara");
  });

  it("refuses a row without a scoping identity", () => {
    expect(profileRowToImpersonationProfile(row({ id: "" }))).toBeNull();
    expect(profileRowToImpersonationProfile(row({ role: "" }))).toBeNull();
    expect(profileRowToImpersonationProfile(row({ organization_id: null }))).toBeNull();
  });

  it("refuses a Deleted account", () => {
    expect(profileRowToImpersonationProfile(row({ status: "Deleted" }))).toBeNull();
  });

  it("refuses every status that is not exactly Active", () => {
    // Eligibility is an ALLOW-LIST. Rejecting only `Deleted` let `Inactive` through — a status
    // `AuthContext.fetchProfile` treats as grounds to sign the account out, and which
    // `TeamMembersTable` already hides the Impersonate action for.
    for (const status of ["Inactive", "Pending", "Suspended", "active", "ACTIVE", "", " "]) {
      expect(profileRowToImpersonationProfile(row({ status })), `status: ${JSON.stringify(status)}`).toBeNull();
    }
    // A missing status is refused too: an authority decision fails closed on a value it cannot read.
    expect(profileRowToImpersonationProfile(row({ status: undefined }))).toBeNull();
    expect(profileRowToImpersonationProfile(row({ status: null }))).toBeNull();
    // …and the one eligible value still works.
    expect(profileRowToImpersonationProfile(row({ status: "Active" }))).not.toBeNull();
  });

  it("isImpersonatableStatus is the single exported predicate for that rule", () => {
    expect(isImpersonatableStatus(IMPERSONATABLE_STATUS)).toBe(true);
    expect(isImpersonatableStatus("Active")).toBe(true);
    expect(isImpersonatableStatus("Inactive")).toBe(false);
    expect(isImpersonatableStatus("Deleted")).toBe(false);
    expect(isImpersonatableStatus(undefined)).toBe(false);
    expect(isImpersonatableStatus(null)).toBe(false);
    expect(isImpersonatableStatus(1)).toBe(false);
  });

  it("refuses null, arrays and non-objects", () => {
    expect(profileRowToImpersonationProfile(null)).toBeNull();
    expect(profileRowToImpersonationProfile(undefined)).toBeNull();
    expect(profileRowToImpersonationProfile([])).toBeNull();
    expect(profileRowToImpersonationProfile("x")).toBeNull();
  });

  it("never confers platform authority, whatever the row says", () => {
    const p = profileRowToImpersonationProfile(row({ platform_role: "platform_admin" }))!;
    expect(p.platform_role).toBeNull();
  });

  it("carries the VIEWED account's super-admin flag, not a hardcoded one", () => {
    expect(profileRowToImpersonationProfile(row({ is_super_admin: true, role: "Super Admin" }))!.is_super_admin).toBe(true);
    expect(profileRowToImpersonationProfile(row())!.is_super_admin).toBe(false);
  });
});
