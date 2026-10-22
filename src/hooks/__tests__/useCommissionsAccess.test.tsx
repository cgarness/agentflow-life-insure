/**
 * Commissions access is decided as soon as it is reliably known, through the real usePermissions hook. Admin and Super
 * Admin hold the Own toggle without the role_permissions read (usePermissions' full access and the server's
 * policy_commission_toggle both decide so), Agents and Team Leaders fail closed until their role's permissions load and
 * then the stored "View Own Commission Percentage" toggle decides, and nothing is enabled under View As. The
 * role_permissions read is issued once, as before: no request is added.
 */
import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ORG: "00000000-0000-4000-8000-0000000000a1",
  USER: "00000000-0000-4000-8000-0000000000b1",
  VIEWED: "00000000-0000-4000-8000-0000000000ff",
  role: "Agent", superAdmin: false, impersonating: false,
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  release: [] as Array<(value: { data: unknown; error: null }) => void>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // Every read is held until the test releases it, so "while permissions load" is a real pending query.
    from: (table: string) => {
      const read = { table, filters: [] as Array<[string, unknown]> };
      h.reads.push(read);
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => { read.filters.push([column, value]); return builder; },
        maybeSingle: () => new Promise((resolve) => h.release.push(resolve)),
      };
      return builder;
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: h.USER }, isImpersonating: h.impersonating, isBuildingOrganization: false,
    // Mirrors production: under View As the profile is the viewed user's.
    profile: { id: h.impersonating ? h.VIEWED : h.USER, role: h.role, is_super_admin: h.superAdmin, organization_id: h.ORG },
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.ORG, role: h.role }) }));

import { useCommissionsAccess } from "../useCommissionsCenter";

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const permissionReads = () => h.reads.filter((read) => read.table === "role_permissions");
const stored = (agent: boolean, teamLeader: boolean) => ({
  p: [], f: [], d: [], s: [], c: [{ name: "View Own Commission Percentage", description: "", agent, teamLeader }],
});
/** Releases the held role_permissions read and waits until the hook has committed the loaded permissions. */
async function resolvePermissions(permissions: ReturnType<typeof stored>, result: { current: { permissionsLoading: boolean } }) {
  act(() => {
    h.release.splice(0).forEach((resolve) => resolve({ data: { permissions }, error: null }));
  });
  await waitFor(() => expect(result.current.permissionsLoading).toBe(false));
}

beforeEach(() => {
  h.role = "Agent"; h.superAdmin = false; h.impersonating = false; h.reads = []; h.release = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(cleanup);

describe("useCommissionsAccess", () => {
  it.each([
    ["an Admin", "Admin", false],
    ["a Super Admin", "Agent", true],
  ])("permits %s on the first render, while the role_permissions read is still pending", (_label, role, superAdmin) => {
    h.role = role; h.superAdmin = superAdmin;
    const { result } = renderHook(() => useCommissionsAccess(), { wrapper });

    expect(result.current.permissionsLoading).toBe(true);
    expect(result.current.permitted).toBe(true);
    expect(result.current.enabled).toBe(true);
    // Same single, organization-scoped read as before the change.
    expect(permissionReads()).toEqual([{ table: "role_permissions", filters: [["organization_id", h.ORG], ["role", role]] }]);
  });

  it("permits a Super Admin whose stored role is the legacy 'Super Admin' string, which never loads role permissions", () => {
    // usePermissions maps no role key for 'Super Admin', so its loading never ends; the server still grants is_super.
    h.role = "Super Admin"; h.superAdmin = true;
    const { result } = renderHook(() => useCommissionsAccess(), { wrapper });

    expect(result.current.permissionsLoading).toBe(true);
    expect(result.current.permitted).toBe(true);
    expect(result.current.enabled).toBe(true);
    expect(permissionReads()).toEqual([]);
  });

  it("keeps an Admin permitted whose stored toggle is off, as the server's full-access rule does", async () => {
    h.role = "Admin";
    const { result } = renderHook(() => useCommissionsAccess(), { wrapper });
    await resolvePermissions(stored(false, false), result);

    expect(result.current.permitted).toBe(true);
  });

  it.each(["Agent", "Team Leader"])("fails closed for the %s role until its permissions load, then the toggle decides", async (role) => {
    h.role = role;
    const pending = renderHook(() => useCommissionsAccess(), { wrapper });
    expect(pending.result.current.permissionsLoading).toBe(true);
    expect(pending.result.current.permitted).toBe(false);
    expect(pending.result.current.enabled).toBe(false);
    await resolvePermissions(stored(true, true), pending.result);
    expect(pending.result.current.permitted).toBe(true);
    expect(pending.result.current.enabled).toBe(true);
    expect(permissionReads()).toHaveLength(1);
    pending.unmount();

    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const denied = renderHook(() => useCommissionsAccess(), { wrapper });
    await resolvePermissions(role === "Agent" ? stored(false, true) : stored(true, false), denied.result);
    expect(denied.result.current.permitted).toBe(false);
    expect(denied.result.current.enabled).toBe(false);
  });

  it.each(["Admin", "Agent"])("enables nothing under View As, even while viewing as an %s", async (role) => {
    h.role = role; h.impersonating = true;
    const { result } = renderHook(() => useCommissionsAccess(), { wrapper });
    expect(result.current.isImpersonating).toBe(true);
    expect(result.current.enabled).toBe(false);
    await resolvePermissions(stored(true, true), result);
    expect(result.current.enabled).toBe(false);
  });
});
