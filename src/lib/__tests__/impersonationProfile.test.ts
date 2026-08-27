/**
 * toImpersonationProfile / parseStoredImpersonationProfile — the "View As" payload repair.
 *
 * The defect: both entry points did `startImpersonation(u.profile as unknown as Profile)`, handing
 * AuthContext a camelCase `UserProfile` DTO (`userId` / `organizationId` / `isSuperAdmin`, and NO
 * `id`, `role`, `organization_id`, `first_name` or `email` at all) cast to the snake_case `Profile`
 * row shape every consumer reads. During "View As" that made `profile.id`, `profile.role`,
 * `profile.organization_id` and `profile.is_super_admin` all `undefined`, which in turn left
 * `useOrganization()` with an undefined org and role and `usePermissions` loading forever.
 *
 * These tests pin the replacement AND the fail-closed behaviour on malformed stored data.
 */

import { describe, it, expect } from "vitest";
import {
  IMPERSONATION_STORAGE_KEY,
  parseStoredImpersonationProfile,
  toImpersonationProfile,
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

describe("parseStoredImpersonationProfile — untrusted storage", () => {
  it("round-trips a profile written by toImpersonationProfile", () => {
    const written = JSON.stringify(toImpersonationProfile(source()));
    const restored = parseStoredImpersonationProfile(written);
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(AGENT_ID);
    expect(restored!.role).toBe("Agent");
    expect(restored!.organization_id).toBe(ORG);
  });

  it("REJECTS a legacy payload written by the broken build", () => {
    // A camelCase UserProfile that an older session persisted. It must not resurrect a half-built
    // impersonation on the next page load.
    const legacy = JSON.stringify(source().profile);
    expect(parseStoredImpersonationProfile(legacy)).toBeNull();
  });

  it("rejects malformed JSON, empty values and wrong container types", () => {
    expect(parseStoredImpersonationProfile("{not json")).toBeNull();
    expect(parseStoredImpersonationProfile("")).toBeNull();
    expect(parseStoredImpersonationProfile(null)).toBeNull();
    expect(parseStoredImpersonationProfile(undefined)).toBeNull();
    expect(parseStoredImpersonationProfile("[]")).toBeNull();
    expect(parseStoredImpersonationProfile("null")).toBeNull();
    expect(parseStoredImpersonationProfile('"a string"')).toBeNull();
  });

  it("rejects a profile missing any one of the three scoping fields", () => {
    const base = toImpersonationProfile(source())!;
    for (const field of ["id", "role", "organization_id"] as const) {
      const broken = { ...base, [field]: "" };
      expect(parseStoredImpersonationProfile(JSON.stringify(broken))).toBeNull();
    }
  });

  it("never lets storage grant platform authority", () => {
    const base = toImpersonationProfile(source())!;
    const tampered = { ...base, platform_role: "platform_admin" };
    const restored = parseStoredImpersonationProfile(JSON.stringify(tampered));
    expect(restored).not.toBeNull();
    expect(restored!.platform_role).toBeNull();
  });

  it("exports the storage key so writer and guard cannot drift apart", () => {
    expect(IMPERSONATION_STORAGE_KEY).toBe("agentflow_impersonation");
  });
});
