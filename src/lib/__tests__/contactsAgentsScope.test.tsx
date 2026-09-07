/**
 * Fix 2 (page wiring) — the Contacts → Agents tab asks only for the viewer's own
 * scope, for every role, and can never widen.
 *
 * Before the fix the tab called `usersApi.getAll({ organizationId })`, an
 * organization-wide profiles query, so every viewer saw every non-deleted profile in
 * the organization. It now resolves the viewer + recursive `upline_id` downline and
 * loads exactly those rows.
 *
 * This is Contacts-page query/UI scoping, not a database authorization boundary: the
 * permissive organization-wide SELECT policy on `profiles` is unchanged.
 *
 * All ids are synthetic. No production identifier appears in this file.
 */
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "11111111-1111-4111-8111-111111111111";

const VIEWER = uid(1);
const DOWNLINE_A = uid(2);
const DOWNLINE_B = uid(3);
const OUT_OF_SCOPE = uid(99);

const usersState = vi.hoisted(() => ({
  scopeIds: [] as string[],
  /** Per-organization scope override, for the View As switch test. */
  scopeIdsByOrg: null as Record<string, string[]> | null,
  scopeError: null as Error | null,
  scopeNeverResolves: false,
  /** When true, getByIds hands back a promise the test resolves by hand. */
  deferGetByIds: false,
  deferred: [] as { ids: string[]; resolve: () => void }[],
  /** Hold the scope traversal for one organization, to control resolution order. */
  deferScopeForOrg: null as string | null,
  deferredScopes: [] as { organizationId: string | null; resolve: () => void }[],
  rowsById: new Map<string, Record<string, unknown>>(),
  calls: {
    getAgentScopeIds: [] as { viewerId: string; organizationId: string | null }[],
    getByIds: [] as { ids: string[]; organizationId?: string | null; search?: string }[],
    getAll: [] as unknown[],
    getById: [] as string[],
  },
}));

const authState = vi.hoisted(() => ({
  userId: "00000000-0000-4000-8000-000000000001",
  /** The EFFECTIVE profile id — equal to `userId` unless a test simulates impersonation. */
  profileId: "00000000-0000-4000-8000-000000000001",
  role: "Admin",
  isSuperAdmin: false,
  isImpersonating: false,
  /** Mutable so a View As organization switch can be simulated mid-flight. */
  organizationId: "11111111-1111-4111-8111-111111111111",
}));

const scopeHookState = vi.hoisted(() => ({
  teamAgentIds: [] as string[],
}));

const routerState = vi.hoisted(() => ({
  params: new URLSearchParams("tab=Agents"),
}));

vi.mock("@/lib/supabase-users", () => {
  const makeUser = (id: string) => ({
    id,
    email: `${id}@example.test`,
    firstName: `Person${id.slice(-2)}`,
    lastName: "Scoped",
    role: "Agent",
    status: "Active",
    availabilityStatus: "Offline",
    themePreference: "light",
    isSuperAdmin: false,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    profile: {
      userId: id,
      licensedStates: [],
      carriers: [],
      residentState: "Texas",
      commissionLevel: "Street",
      uplineId: null,
      onboardingComplete: false,
      monthlyCallGoal: 0,
      monthlyPoliciesGoal: 0,
      weeklyAppointmentGoal: 0,
      monthlyAppointmentGoal: 0,
      monthlyPremiumGoal: 0,
      npn: "",
      timezone: "Eastern Time (US & Canada)",
      winSoundEnabled: true,
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: false,
      pushNotificationsEnabled: true,
      onboardingItems: [],
      organizationId: ORG,
      teamId: null,
      isSuperAdmin: false,
      billingType: null,
    },
  });

  return {
    usersSupabaseApi: {
      getAgentScopeIds: (params: { viewerId: string; organizationId: string | null }) => {
        usersState.calls.getAgentScopeIds.push(params);
        if (usersState.scopeNeverResolves) return new Promise<string[]>(() => {});
        if (usersState.scopeError) return Promise.reject(usersState.scopeError);
        const byOrg = usersState.scopeIdsByOrg;
        const ids =
          byOrg && params.organizationId && byOrg[params.organizationId]
            ? [...byOrg[params.organizationId]]
            : [...usersState.scopeIds];
        if (usersState.deferScopeForOrg && params.organizationId === usersState.deferScopeForOrg) {
          return new Promise<string[]>((resolveOuter) => {
            usersState.deferredScopes.push({
              organizationId: params.organizationId,
              resolve: () => resolveOuter(ids),
            });
          });
        }
        return Promise.resolve(ids);
      },
      getByIds: (params: { ids: string[]; organizationId?: string | null; search?: string }) => {
        usersState.calls.getByIds.push({ ...params, ids: [...params.ids] });
        const rows = params.ids.map((id) => makeUser(id));
        if (!usersState.deferGetByIds) return Promise.resolve(rows);
        return new Promise((resolveOuter) => {
          usersState.deferred.push({
            ids: [...params.ids],
            resolve: () => resolveOuter(rows),
          });
        });
      },
      getAll: (...args: unknown[]) => {
        usersState.calls.getAll.push(args);
        return Promise.resolve([]);
      },
      getById: (id: string) => {
        usersState.calls.getById.push(id);
        return Promise.reject(new Error("User not found"));
      },
    },
  };
});

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasContactsPermission: () => true,
    hasPageAccess: () => true,
    hasFeatureAccess: () => true,
    getDataScope: () => "all",
    canSeeCommission: () => true,
    hasSettingsSectionAccess: () => true,
    isLoading: false,
    error: null,
    permissions: null,
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: authState.userId },
    // `profile` carries `id` because a real `profiles` row always does, and Contacts now derives
    // its viewer from the EFFECTIVE profile (`useEffectiveViewer` → `profile.id`) rather than from
    // `user.id`. Under "View As" those differ: `user.id` stays the real Super Admin while
    // `profile.id` becomes the viewed agent. This harness keeps them equal, which is the
    // non-impersonating case every assertion below is written against.
    profile: {
      id: authState.profileId,
      organization_id: authState.organizationId,
      role: authState.role,
    },
    isImpersonating: authState.isImpersonating,
    isBuildingOrganization: false,
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  // Mirrors the real hook: under View As the organization changes IN PLACE, with no
  // remount and no change to the authenticated user id.
  useOrganization: () => ({
    organizationId: authState.organizationId,
    role: authState.role,
    isSuperAdmin: authState.isSuperAdmin,
  }),
}));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    formatDate: (v: unknown) => String(v ?? ""),
    formatDateTime: (v: unknown) => String(v ?? ""),
  }),
}));
vi.mock("@/hooks/useContactScope", () => ({
  useContactScope: () => ({
    scope: "mine",
    setScope: () => {},
    availableScopes: ["mine"],
    maxScope: "all",
    teamAgents: [],
    teamAgentIds: scopeHookState.teamAgentIds,
    hasDownline: false,
    ready: true,
    prefError: false,
  }),
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ state: null, pathname: "/contacts", search: "", hash: "", key: "t" }),
  useSearchParams: () => [
    routerState.params,
    (next: unknown) => {
      routerState.params =
        typeof next === "function"
          ? (next as (p: URLSearchParams) => URLSearchParams)(routerState.params)
          : (next as URLSearchParams);
    },
  ],
}));
vi.mock("@/integrations/supabase/client", () => {
  const res = Promise.resolve({ data: [], error: null, count: 0 });
  const b: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === "then" ? (res as unknown as { then: unknown }).then.bind(res) : () => b,
    },
  );
  return { supabase: { from: () => b, rpc: () => b, auth: {} } };
});
vi.mock("@/components/contacts/FullScreenContactView", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddClientModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddRecruitModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ContactsFilterModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ContactKanbanBoard", () => ({ ContactKanbanBoard: () => null }));
vi.mock("@/components/contacts/ContactScopeSelector", () => ({ default: () => null }));
vi.mock("@/components/contacts/AgentModal", () => ({
  default: ({ agent }: { agent: { id: string } | null }) =>
    agent ? React.createElement("div", { "data-testid": "agent-modal" }, agent.id) : null,
}));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  CommissionGate: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import Contacts from "@/pages/Contacts";

function renderContacts() {
  return render(React.createElement(Contacts));
}

/** The ids the Agents tab actually asked the database for, most recent last. */
const requestedIds = () => usersState.calls.getByIds.map((c) => c.ids);
const lastRequestedIds = () => usersState.calls.getByIds.at(-1)?.ids ?? null;

beforeEach(() => {
  usersState.scopeIds = [VIEWER, DOWNLINE_A, DOWNLINE_B];
  usersState.scopeError = null;
  usersState.scopeNeverResolves = false;
  usersState.calls.getAgentScopeIds = [];
  usersState.calls.getByIds = [];
  usersState.calls.getAll = [];
  usersState.calls.getById = [];
  authState.userId = VIEWER;
  authState.profileId = VIEWER;
  authState.isImpersonating = false;
  authState.role = "Admin";
  authState.isSuperAdmin = false;
  authState.organizationId = ORG;
  usersState.scopeIdsByOrg = null;
  usersState.deferGetByIds = false;
  usersState.deferred = [];
  usersState.deferScopeForOrg = null;
  usersState.deferredScopes = [];
  scopeHookState.teamAgentIds = [];
  routerState.params = new URLSearchParams("tab=Agents");
});

afterEach(() => {
  cleanup();
});

describe("the Agents tab asks only for the resolved scope", () => {
  it("passes the traversal result through unchanged, with the viewer present", async () => {
    renderContacts();
    await waitFor(() => expect(usersState.calls.getByIds.length).toBeGreaterThan(0));
    expect(lastRequestedIds()).toEqual([VIEWER, DOWNLINE_A, DOWNLINE_B]);
    expect(lastRequestedIds()).toContain(VIEWER);
    expect(usersState.calls.getAgentScopeIds[0]).toEqual({
      viewerId: VIEWER,
      organizationId: ORG,
    });
  });

  it("never calls the organization-wide getAll from the Agents tab", async () => {
    renderContacts();
    await waitFor(() => expect(usersState.calls.getByIds.length).toBeGreaterThan(0));
    expect(usersState.calls.getAll).toEqual([]);
  });

  it("scopes the row fetch to the viewer's organization", async () => {
    renderContacts();
    await waitFor(() => expect(usersState.calls.getByIds.length).toBeGreaterThan(0));
    expect(usersState.calls.getByIds.at(-1)?.organizationId).toBe(ORG);
  });

  it("renders one row per scoped profile", async () => {
    renderContacts();
    await waitFor(() => expect(screen.queryByText(/no agents available/i)).toBeNull());
    await waitFor(() => {
      expect(screen.getAllByText(/Scoped/).length).toBe(3);
    });
  });

  it("a leaf viewer sees exactly one row — themselves", async () => {
    usersState.scopeIds = [VIEWER];
    renderContacts();
    await waitFor(() => expect(usersState.calls.getByIds.length).toBeGreaterThan(0));
    expect(lastRequestedIds()).toEqual([VIEWER]);
    await waitFor(() => expect(screen.getAllByText(/Scoped/).length).toBe(1));
  });
});

describe("role never widens the tab", () => {
  const roles: { role: string; isSuperAdmin: boolean }[] = [
    { role: "Admin", isSuperAdmin: false },
    { role: "Team Leader", isSuperAdmin: false },
    { role: "Agent", isSuperAdmin: false },
    { role: "Super Admin", isSuperAdmin: true },
  ];

  for (const { role, isSuperAdmin } of roles) {
    it(`${role} takes the identical scoped path`, async () => {
      authState.role = role;
      authState.isSuperAdmin = isSuperAdmin;
      renderContacts();
      await waitFor(() => expect(usersState.calls.getByIds.length).toBeGreaterThan(0));
      expect(lastRequestedIds()).toEqual([VIEWER, DOWNLINE_A, DOWNLINE_B]);
      expect(usersState.calls.getAll).toEqual([]);
    });
  }
});

describe("the Agents tab does not consult the hierarchy_path-based contact scope", () => {
  it("a wide teamAgentIds from useContactScope does not reach the Agents query", async () => {
    scopeHookState.teamAgentIds = [VIEWER, OUT_OF_SCOPE, uid(98), uid(97)];
    renderContacts();
    await waitFor(() => expect(usersState.calls.getByIds.length).toBeGreaterThan(0));
    expect(lastRequestedIds()).toEqual([VIEWER, DOWNLINE_A, DOWNLINE_B]);
    expect(lastRequestedIds()).not.toContain(OUT_OF_SCOPE);
  });
});

describe("fail closed", () => {
  it("a traversal failure yields an empty scope and never an organization-wide fallback", async () => {
    usersState.scopeError = new Error("traversal boom");
    renderContacts();
    await waitFor(() => expect(usersState.calls.getAgentScopeIds.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText(/no agents available/i)).toBeTruthy());
    expect(usersState.calls.getAll).toEqual([]);
    for (const call of usersState.calls.getByIds) expect(call.ids).toEqual([]);
    expect(screen.queryByText(/Scoped/)).toBeNull();
  });

  it("uses generic empty wording that does not claim the organization has no users", async () => {
    usersState.scopeIds = [];
    renderContacts();
    await waitFor(() => expect(screen.getByText(/no agents available/i)).toBeTruthy());
    expect(screen.queryByText(/no agents yet/i)).toBeNull();
    expect(screen.queryByText(/agents in your organization will appear here/i)).toBeNull();
  });

  it("shows the loading state, not the empty state, while the traversal is unresolved", async () => {
    usersState.scopeNeverResolves = true;
    const { container } = renderContacts();
    await waitFor(() => expect(usersState.calls.getAgentScopeIds.length).toBeGreaterThan(0));
    expect(screen.queryByText(/no agents available/i)).toBeNull();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(usersState.calls.getByIds).toEqual([]);
  });
});

describe("search and filters narrow, never widen", () => {
  it("a search term leaves the requested id set byte-identical", async () => {
    renderContacts();
    await waitFor(() => expect(usersState.calls.getByIds.length).toBeGreaterThan(0));
    const before = lastRequestedIds();

    const searchBox = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchBox, { target: { value: "scoped" } });

    await waitFor(() => expect(usersState.calls.getByIds.length).toBeGreaterThan(1));
    expect(lastRequestedIds()).toEqual(before);
    expect(usersState.calls.getByIds.at(-1)?.search).toBe("scoped");
    for (const ids of requestedIds()) expect(ids).toEqual([VIEWER, DOWNLINE_A, DOWNLINE_B]);
  });
});

describe("stale in-flight fetches cannot apply one viewer's scope to another", () => {
  // Review finding D2: under View As the organization changes IN PLACE — no remount,
  // and `user.id` stays the real authenticated user. A slow Agents fetch issued for the
  // previous organization can therefore resolve AFTER the new organization's fetch has
  // already painted, repainting the table with the previous organization's scope.
  const OTHER_ORG_ID = "33333333-3333-4333-8333-333333333333";
  const OTHER_MEMBER = uid(50);

  it("a slow fetch for the previous organization cannot repaint the new one", async () => {
    usersState.scopeIdsByOrg = {
      [ORG]: [VIEWER, DOWNLINE_A, DOWNLINE_B],
      [OTHER_ORG_ID]: [OTHER_MEMBER],
    };
    usersState.deferGetByIds = true;

    const { rerender } = renderContacts();

    // Organization A's row fetch is issued and left in flight.
    await waitFor(() => expect(usersState.deferred.length).toBe(1));
    const orgAFetch = usersState.deferred[0];
    expect(orgAFetch.ids).toEqual([VIEWER, DOWNLINE_A, DOWNLINE_B]);

    // View As switches to organization B, in place.
    authState.organizationId = OTHER_ORG_ID;
    rerender(React.createElement(Contacts));

    await waitFor(() =>
      expect(
        usersState.calls.getAgentScopeIds.some((c) => c.organizationId === OTHER_ORG_ID),
      ).toBe(true),
    );
    await waitFor(() => expect(usersState.deferred.length).toBe(2));
    const orgBFetch = usersState.deferred[1];
    expect(orgBFetch.ids).toEqual([OTHER_MEMBER]);

    // B lands first, then the stale A resolves late.
    orgBFetch.resolve();
    await waitFor(() => expect(screen.getAllByText(/Scoped/).length).toBe(1));
    orgAFetch.resolve();

    // The stale organization-A scope must never repaint organization B's table.
    await waitFor(() => expect(screen.getAllByText(/Scoped/).length).toBe(1));
    expect(screen.queryAllByText(new RegExp(`Person${DOWNLINE_A.slice(-2)}`))).toHaveLength(0);
    expect(screen.queryAllByText(new RegExp(`Person${DOWNLINE_B.slice(-2)}`))).toHaveLength(0);
    expect(screen.getAllByText(new RegExp(`Person${OTHER_MEMBER.slice(-2)}`)).length).toBeGreaterThan(0);
  });

  it("a stale fetch cannot paint even while the new organization's scope is still resolving", async () => {
    // The harder ordering: the previous organization's fetch resolves BEFORE the new
    // organization's traversal has finished, so no newer fetch has been issued yet.
    // Its own completion clears the loading flag, so any committed rows would be
    // visible on screen while impersonating the new organization.
    usersState.scopeIdsByOrg = {
      [ORG]: [VIEWER, DOWNLINE_A, DOWNLINE_B],
      [OTHER_ORG_ID]: [OTHER_MEMBER],
    };
    usersState.deferGetByIds = true;
    usersState.deferScopeForOrg = OTHER_ORG_ID;

    const { rerender } = renderContacts();
    await waitFor(() => expect(usersState.deferred.length).toBe(1));

    authState.organizationId = OTHER_ORG_ID;
    rerender(React.createElement(Contacts));

    // The new organization's traversal is deliberately still pending.
    await waitFor(() => expect(usersState.deferredScopes.length).toBe(1));
    expect(usersState.deferred.length).toBe(1);

    // The previous organization's rows arrive now.
    usersState.deferred[0].resolve();
    await waitFor(() => expect(usersState.calls.getByIds.length).toBe(1));

    // Nothing from the previous organization may reach the screen.
    expect(screen.queryAllByText(/Scoped/)).toHaveLength(0);

    // And the new organization still resolves correctly afterwards.
    usersState.deferredScopes[0].resolve();
    await waitFor(() => expect(usersState.deferred.length).toBe(2));
    usersState.deferred[1].resolve();
    await waitFor(() => expect(screen.getAllByText(/Scoped/).length).toBe(1));
    expect(screen.getAllByText(new RegExp(`Person${OTHER_MEMBER.slice(-2)}`)).length).toBeGreaterThan(0);
  });

  it("a stale fetch that errors cannot raise an error on the current organization", async () => {
    usersState.scopeIdsByOrg = {
      [ORG]: [VIEWER, DOWNLINE_A, DOWNLINE_B],
      [OTHER_ORG_ID]: [OTHER_MEMBER],
    };
    usersState.deferGetByIds = true;

    const { rerender } = renderContacts();
    await waitFor(() => expect(usersState.deferred.length).toBe(1));

    authState.organizationId = OTHER_ORG_ID;
    rerender(React.createElement(Contacts));
    await waitFor(() => expect(usersState.deferred.length).toBe(2));

    usersState.deferred[1].resolve();
    await waitFor(() => expect(screen.getAllByText(/Scoped/).length).toBe(1));
    usersState.deferred[0].resolve();

    await waitFor(() => expect(screen.getAllByText(/Scoped/).length).toBe(1));
    expect(screen.queryByText(/couldn't load/i)).toBeNull();
  });
});

describe("out-of-scope agents cannot be opened", () => {
  it("a deep link to an agent outside the scope does not open AgentModal", async () => {
    routerState.params = new URLSearchParams(
      `tab=Agents&contactType=agent&contact=${OUT_OF_SCOPE}`,
    );
    renderContacts();
    await waitFor(() => expect(usersState.calls.getByIds.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText(/Scoped/).length).toBe(3));
    expect(screen.queryByTestId("agent-modal")).toBeNull();
  });

  it("the deep-link fallback never resolves an agent through the users API", async () => {
    routerState.params = new URLSearchParams(
      `tab=Agents&contactType=agent&contact=${OUT_OF_SCOPE}`,
    );
    renderContacts();
    await waitFor(() => expect(usersState.calls.getByIds.length).toBeGreaterThan(0));
    expect(usersState.calls.getById).toEqual([]);
  });

  it("an in-scope deep link still opens AgentModal", async () => {
    routerState.params = new URLSearchParams(
      `tab=Agents&contactType=agent&contact=${DOWNLINE_A}`,
    );
    renderContacts();
    await waitFor(() => expect(screen.getByTestId("agent-modal")).toBeTruthy());
    expect(screen.getByTestId("agent-modal").textContent).toBe(DOWNLINE_A);
  });
});
