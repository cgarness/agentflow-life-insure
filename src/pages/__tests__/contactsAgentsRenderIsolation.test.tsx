/**
 * Contacts → Agents: render isolation across a viewer / organization change.
 *
 * The Agents tab clears its rows in a passive `useEffect` keyed on `agentScopeKey`, which runs
 * AFTER the commit — so on the render where the effective viewer or organization changes, the
 * previous scope's agent rows are still in state, are committed and are painted under the new
 * identity. Same class of defect as the conversations surfaces, same detection technique: a
 * recorder's `useLayoutEffect` snapshots the committed DOM after every commit and before any
 * passive effect.
 *
 * The existing fail-closed behaviour under "View As" must survive unchanged.
 */

import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "55555555-5555-4555-8555-555555555555";
const VIEWER_A = uid(1);
const VIEWER_B = uid(2);

const frames: string[] = [];
const Recorder: React.FC = () => {
  React.useLayoutEffect(() => { frames.push(document.body.textContent ?? ""); });
  return null;
};

const usersState = vi.hoisted(() => ({
  /** viewerId → the agent rows getByIds should return. */
  rowsByViewer: {} as Record<string, Record<string, unknown>[]>,
  scopeIdsByViewer: {} as Record<string, string[]>,
  getByIdsCalls: [] as string[][],
}));

const authState = vi.hoisted(() => ({
  userId: "00000000-0000-4000-8000-000000000001",
  profileId: "00000000-0000-4000-8000-000000000001",
  role: "Admin",
  isSuperAdmin: false,
  isImpersonating: false,
  organizationId: "11111111-1111-4111-8111-111111111111",
}));

const routerState = vi.hoisted(() => ({ params: new URLSearchParams("tab=Agents") }));

vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: {
    getAgentScopeIds: (p: { viewerId: string }) =>
      Promise.resolve(usersState.scopeIdsByViewer[p.viewerId] ?? [p.viewerId]),
    getByIds: (p: { ids: string[] }) => {
      usersState.getByIdsCalls.push(p.ids);
      const viewer = p.ids[0];
      return Promise.resolve(usersState.rowsByViewer[viewer] ?? []);
    },
    getAll: () => Promise.resolve([]),
    getById: () => Promise.resolve(null),
  },
}));
vi.mock("@/integrations/supabase/client", () => {
  const res = Promise.resolve({ data: [], error: null, count: 0 });
  const b: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) => (p === "then" ? (res as never as { then: never }).then.bind(res) : () => b),
  });
  return { supabase: { from: () => b, rpc: () => b, auth: {} } };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: authState.userId },
    profile: { id: authState.profileId, organization_id: authState.organizationId, role: authState.role },
    isImpersonating: authState.isImpersonating,
    isBuildingOrganization: false,
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({
    organizationId: authState.organizationId,
    role: authState.role,
    isSuperAdmin: authState.isSuperAdmin || authState.isImpersonating,
  }),
}));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({ formatDate: (v: unknown) => String(v ?? ""), formatDateTime: (v: unknown) => String(v ?? "") }),
}));
vi.mock("@/hooks/useContactScope", () => ({
  useContactScope: () => ({
    scope: "mine", setScope: () => {}, availableScopes: ["mine"], maxScope: "all",
    teamAgents: [], teamAgentIds: [], hasDownline: false, ready: true, prefError: false,
  }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasContactsPermission: () => true, getDataScope: () => "all", isLoading: false }),
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ state: null, pathname: "/contacts", search: "", hash: "", key: "t" }),
  useSearchParams: () => [
    routerState.params,
    (next: unknown) => {
      const resolved = typeof next === "function"
        ? (next as (p: URLSearchParams) => unknown)(routerState.params) : next;
      routerState.params = resolved instanceof URLSearchParams
        ? resolved : new URLSearchParams(resolved as Record<string, string>);
    },
  ],
}));
vi.mock("@/components/contacts/FullScreenContactView", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddClientModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddRecruitModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ContactsFilterModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ContactKanbanBoard", () => ({ ContactKanbanBoard: () => null }));
vi.mock("@/components/contacts/ContactScopeSelector", () => ({ default: () => null }));
vi.mock("@/components/contacts/AgentModal", () => ({ default: () => null }));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  CommissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import Contacts from "@/pages/Contacts";

const agentRow = (id: string, first: string) => ({
  id, email: `${first}@x.test`, firstName: first, lastName: "Person", role: "Agent",
  status: "Active", availabilityStatus: "Available", themePreference: "light",
  isSuperAdmin: false, lastLoginAt: null, createdAt: "2026-01-01T00:00:00Z",
  profile: { userId: id, organizationId: ORG_A, licensedStates: [], carriers: [] },
});

beforeEach(() => {
  frames.length = 0;
  usersState.rowsByViewer = {};
  usersState.scopeIdsByViewer = {};
  usersState.getByIdsCalls = [];
  authState.userId = VIEWER_A;
  authState.profileId = VIEWER_A;
  authState.role = "Admin";
  authState.isSuperAdmin = false;
  authState.isImpersonating = false;
  authState.organizationId = ORG_A;
  routerState.params = new URLSearchParams("tab=Agents");
});

afterEach(cleanup);

const tree = () => (<><Contacts /><Recorder /></>);

describe("the Agents tab never commits the previous scope's rows", () => {
  it("viewer A's agent row appears in NO frame after the viewer changes", async () => {
    usersState.rowsByViewer[VIEWER_A] = [agentRow(VIEWER_A, "AlphaAgent")];
    usersState.rowsByViewer[VIEWER_B] = [agentRow(VIEWER_B, "BetaAgent")];

    const { rerender } = render(tree());
    await screen.findAllByText(/AlphaAgent/);

    const before = frames.length;
    authState.profileId = VIEWER_B;
    authState.userId = VIEWER_B;
    rerender(tree());
    await screen.findAllByText(/BetaAgent/);

    const after = frames.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((f) => f.includes("AlphaAgent"))).toEqual([]);
  });

  it("an ORGANIZATION change also drops the previous rows immediately", async () => {
    usersState.rowsByViewer[VIEWER_A] = [agentRow(VIEWER_A, "AlphaAgent")];

    const { rerender } = render(tree());
    await screen.findAllByText(/AlphaAgent/);

    const before = frames.length;
    authState.organizationId = ORG_B;
    usersState.rowsByViewer[VIEWER_A] = [agentRow(VIEWER_A, "OrgBAgent")];
    rerender(tree());

    await waitFor(() => expect(screen.queryAllByText(/AlphaAgent/)).toHaveLength(0));
    expect(frames.slice(before).filter((f) => f.includes("AlphaAgent"))).toEqual([]);
  });
});

describe("fail-closed behaviour under View As is unchanged", () => {
  it("the contact grids stay withheld while impersonating", async () => {
    authState.isImpersonating = true;
    authState.isSuperAdmin = true;
    routerState.params = new URLSearchParams("tab=Leads");

    render(tree());

    expect(await screen.findByText(/aren't available while viewing as another user/i)).toBeInTheDocument();
  });
});
