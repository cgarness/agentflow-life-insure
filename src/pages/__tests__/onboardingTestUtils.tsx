import { vi } from "vitest";
import type { Profile } from "@/contexts/AuthContext";

/**
 * Shared fixtures + a Supabase stub for the `/onboarding` wizard tests.
 *
 * Deliberately NOT part of `src/test/setup.ts`: the jsdom gaps below only matter
 * for the Radix/cmdk surfaces this wizard introduces, and the other 51 suites
 * must keep running against the setup they were written for.
 *
 * No real Supabase call is ever made and no credential appears anywhere here.
 */

/** jsdom lacks the DOM APIs Radix Select/Popover probe on open. */
export function installJsdomPolyfills(): void {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
}

export const FOUNDER_USER = {
  id: "founder-1",
  email: "founder@agency.com",
  email_confirmed_at: "2026-08-01T00:00:00.000Z",
  user_metadata: { needs_app_wizard: true, signup_source: "self_serve" },
};

export const INVITED_USER = {
  id: "agent-1",
  email: "agent@agency.com",
  email_confirmed_at: "2026-08-01T00:00:00.000Z",
  user_metadata: { needs_app_wizard: true, signup_source: "invite" },
};

/**
 * The exact `profiles.licensed_states` payload the invitation flow writes
 * (InviteUserModal → invite-user → accept-invite) and that crashed production
 * `/onboarding` with React error #31. Frozen so no code under test can mutate
 * what is supposed to be immutable profile data.
 */
export const PRODUCTION_OBJECT_LICENSED_STATES: ReadonlyArray<{ state: string; licenseNumber: string }> =
  Object.freeze([Object.freeze({ state: "CA", licenseNumber: "" })]);

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "profile-1",
    first_name: "Ada",
    last_name: "Byron",
    email: "agent@agency.com",
    phone: "15125550123",
    role: "Agent",
    resident_state: "Texas",
    licensed_states: [],
    commission_level: "",
    npn: "",
    timezone: "Eastern Time (US & Canada)",
    organization_id: "org-1",
    upline_id: "",
    onboarding_complete: false,
    ...overrides,
  } as unknown as Profile;
}

/** Mutable auth state the mocked `useAuth` reads on every render. */
export const authState = {
  user: FOUNDER_USER as unknown as Record<string, unknown> | null,
  profile: makeProfile() as Profile | null,
  updateProfile: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  navigate: vi.fn(),
};

/** Everything the wizard reads from / writes to Supabase, captured for assertions. */
export const supabaseState = {
  organizationName: "Provisioned Org",
  companyName: "",
  uplineRow: null as { first_name: string; last_name: string } | null,
  refreshSessionCalls: 0,
  authUpdates: [] as { data: Record<string, unknown> }[],
  organizationUpdates: [] as { payload: Record<string, unknown>; id: unknown }[],
  companySettingsUpserts: [] as { payload: Record<string, unknown>; options: unknown }[],
  organizationUpdateError: null as unknown,
  companySettingsUpsertError: null as unknown,
  claims: { role: "Admin", organization_id: "org-1" } as Record<string, unknown>,
};

export function resetOnboardingMocks(): void {
  authState.user = FOUNDER_USER as unknown as Record<string, unknown>;
  authState.profile = makeProfile();
  authState.updateProfile.mockReset();
  authState.updateProfile.mockResolvedValue(undefined);
  authState.logout.mockReset();
  authState.logout.mockResolvedValue(undefined);
  authState.navigate.mockReset();

  supabaseState.organizationName = "Provisioned Org";
  supabaseState.companyName = "";
  supabaseState.uplineRow = null;
  supabaseState.refreshSessionCalls = 0;
  supabaseState.authUpdates = [];
  supabaseState.organizationUpdates = [];
  supabaseState.companySettingsUpserts = [];
  supabaseState.organizationUpdateError = null;
  supabaseState.companySettingsUpsertError = null;
  supabaseState.claims = { role: "Admin", organization_id: "org-1" };
}

function selectResult(table: string) {
  if (table === "organizations") return { data: { name: supabaseState.organizationName }, error: null };
  if (table === "company_settings") return { data: { company_name: supabaseState.companyName }, error: null };
  if (table === "profiles") return { data: supabaseState.uplineRow, error: null };
  return { data: null, error: null };
}

/** Chainable stub matching only the calls the wizard actually makes. */
export function createSupabaseMock() {
  return {
    auth: {
      refreshSession: async () => {
        supabaseState.refreshSessionCalls += 1;
        return { data: { session: { user: { app_metadata: supabaseState.claims } } }, error: null };
      },
      updateUser: async (args: { data: Record<string, unknown> }) => {
        supabaseState.authUpdates.push(args);
        return { error: null };
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => selectResult(table) }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: async (_column: string, id: unknown) => {
          supabaseState.organizationUpdates.push({ payload, id });
          return { error: supabaseState.organizationUpdateError };
        },
      }),
      upsert: async (payload: Record<string, unknown>, options: unknown) => {
        supabaseState.companySettingsUpserts.push({ payload, options });
        return { error: supabaseState.companySettingsUpsertError };
      },
    }),
  };
}
