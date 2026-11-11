/** Carriers is additive for legacy arrays, without reopening other saved page or feature permissions. */
import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "Agent", userId: "user-1" as string | null, orgId: "org-1" as string | null, superAdmin: false,
  rows: [] as Array<{ id: string; role: string; permissions: Record<string, unknown> }>,
  reads: [] as Array<{ table: string; columns: string; filters: Array<[string, unknown]> }>,
  upserts: [] as Array<{ organization_id: string; role: string; permissions: Record<string, unknown> }>,
  error: null as Error | null, deferred: false,
  release: [] as Array<(value: { data: unknown; error: Error | null }) => void>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const read = { table, columns: "", filters: [] as Array<[string, unknown]> };
      const builder = {
        select: (columns: string) => { read.columns = columns; h.reads.push(read); return builder; },
        eq: (column: string, value: unknown) => { read.filters.push([column, value]); return builder; },
        maybeSingle: () => {
          if (h.deferred) return new Promise((resolve) => h.release.push(resolve));
          const role = read.filters.find(([column]) => column === "role")?.[1];
          const row = h.rows.find((item) => item.role === role);
          return Promise.resolve({ data: row ? { permissions: row.permissions } : null, error: h.error });
        },
        then: (resolve: (value: { data: typeof h.rows; error: null }) => unknown) =>
          Promise.resolve({ data: h.rows, error: null }).then(resolve),
        upsert: (payload: typeof h.upserts[number]) => {
          h.upserts.push(payload);
          h.rows = [...h.rows.filter((row) => row.role !== payload.role), { id: "rp-1", ...payload }];
          return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "rp-1" }, error: null }) }) };
        },
        insert: () => Promise.resolve({ data: null, error: null }),
      };
      return builder;
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: h.userId ? { id: h.userId } : null,
    profile: { id: h.userId, role: h.role, organization_id: h.orgId, is_super_admin: h.superAdmin },
    isBuildingOrganization: false,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import Permissions from "@/components/settings/Permissions";
import PageGuard from "@/components/PageGuard";
import { DEFAULT_PAGES, normalizeCarriersPagePermission } from "@/config/permissionDefaults";
import { usePermissions } from "@/hooks/usePermissions";

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
);
const stored = (p: unknown[] = []) => ({ p, f: [], d: [], c: [], s: [] });
const setStored = (p: unknown[]) => {
  h.rows = ["Agent", "Team Leader"].map((role) => ({ id: `rp-${role}`, role, permissions: stored(p) }));
};
const pageSwitch = (name = "Carriers") => {
  const heading = screen.getByRole("heading", { name: "Page Access" });
  const section = heading.closest("button")!.parentElement!;
  const label = within(section).getByText(name, { exact: true });
  return within(label.parentElement!.parentElement!).getByRole("switch");
};

beforeEach(() => {
  h.role = "Agent"; h.userId = "user-1"; h.orgId = "org-1"; h.superAdmin = false;
  h.rows = []; h.reads = []; h.upserts = []; h.error = null; h.deferred = false; h.release = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); });

describe("additive Carriers normalization", () => {
  it("adds only Carriers, preserving every other saved value, row, and position without mutating the input", () => {
    const saved = [
      { name: "Reports", agent: false, teamLeader: false },
      { name: "Custom page", agent: "existing legacy value", teamLeader: null, extra: "preserved" },
      { name: "Contacts", agent: true, teamLeader: false },
    ];
    const snapshot = JSON.stringify(saved);
    const normalized = normalizeCarriersPagePermission(saved);
    expect(normalized).toEqual([...saved, { name: "Carriers", agent: true, teamLeader: true }]);
    saved.forEach((row, index) => expect(normalized[index]).toBe(row));
    expect(JSON.stringify(saved)).toBe(snapshot);
    expect(normalizeCarriersPagePermission(normalized)).toEqual(normalized);
    expect(normalized.some((row) => row.name === "Dialer")).toBe(false);
  });

  it.each([true, false, "true", "false", 1, 0, null, undefined, {}, []])(
    "accepts only literal true for an explicit Carriers flag (%j)", (flag) => {
      const other = { name: "Resources", agent: false, teamLeader: true };
      const saved = [other, { name: "Carriers", agent: flag, teamLeader: flag, extra: "keep" }];
      const normalized = normalizeCarriersPagePermission(saved);
      expect(normalized).toHaveLength(2);
      expect(normalized[0]).toBe(other);
      expect(normalized[1]).toEqual({ name: "Carriers", agent: flag === true, teamLeader: flag === true, extra: "keep" });
      expect(saved[1].agent).toBe(flag);
    },
  );

  it("leaves every existing page default unchanged", () => {
    expect(DEFAULT_PAGES.filter((row) => row.name !== "Carriers")).toEqual([
      { name: "Dashboard", agent: true, teamLeader: true },
      { name: "Dialer", agent: true, teamLeader: true },
      { name: "Contacts", agent: true, teamLeader: true },
      { name: "Conversations", agent: true, teamLeader: true },
      { name: "Calendar", agent: true, teamLeader: true },
      { name: "Campaigns", agent: true, teamLeader: true },
      { name: "Leaderboard", agent: true, teamLeader: true },
      { name: "Reports", agent: false, teamLeader: true },
      { name: "AI Agents", agent: false, teamLeader: true },
      { name: "Training", agent: true, teamLeader: true },
      { name: "Resources", agent: true, teamLeader: true },
    ]);
  });
});

describe("real permission hook and Settings agreement", () => {
  it.each(["Agent", "Team Leader"])("grants Carriers from a legacy %s row only after it loads", async (role) => {
    h.role = role; h.deferred = true;
    const existing = { name: "Reports", agent: false, teamLeader: false };
    const { result } = renderHook(() => usePermissions(), { wrapper });
    expect(result.current.hasPageAccess("Carriers")).toBe(false);
    expect(result.current.isLoading).toBe(true);
    expect(h.reads).toEqual([{ table: "role_permissions", columns: "permissions", filters: [["organization_id", "org-1"], ["role", role]] }]);
    act(() => h.release.splice(0).forEach((resolve) => resolve({ data: { permissions: stored([existing]) }, error: null })));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPageAccess("Carriers")).toBe(true);
    expect(result.current.hasPageAccess("Reports")).toBe(false);
    expect(result.current.hasPageAccess("Dialer")).toBe(false);
    expect(result.current.permissions?.p).toEqual([existing, { name: "Carriers", agent: true, teamLeader: true }]);
  });

  const cases = [
    { label: "legacy row", pages: [] },
    { label: "explicit Agent only", pages: [{ name: "Carriers", agent: true, teamLeader: false }] },
    { label: "explicit Team Leader only", pages: [{ name: "Carriers", agent: false, teamLeader: true }] },
    { label: "malformed flags", pages: [{ name: "Carriers", agent: "true", teamLeader: 1 }] },
    { label: "missing flags", pages: [{ name: "Carriers" }] },
  ];
  for (const role of ["Agent", "Team Leader"]) {
    it.each(cases)(`${role} Settings agrees with enforcement for $label`, async ({ pages }) => {
      h.role = role; setStored(pages);
      const { result } = renderHook(() => usePermissions(), { wrapper });
      render(<Permissions />, { wrapper });
      await screen.findByRole("heading", { name: "Page Access" });
      if (role === "Team Leader") fireEvent.click(screen.getByRole("button", { name: "Team Leader" }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(pageSwitch()).toHaveAttribute("aria-checked", String(result.current.hasPageAccess("Carriers")));
      expect(screen.getByRole("button", { name: "Save Permissions" })).toBeDisabled();
    });

    it(`${role} can save an explicit denial and the real hook receives it after invalidation`, async () => {
      h.role = role; setStored([{ name: "Reports", agent: false, teamLeader: false }]);
      const { result } = renderHook(() => usePermissions(), { wrapper });
      render(<Permissions />, { wrapper });
      await screen.findByRole("heading", { name: "Page Access" });
      if (role === "Team Leader") fireEvent.click(screen.getByRole("button", { name: "Team Leader" }));
      await waitFor(() => expect(result.current.hasPageAccess("Carriers")).toBe(true));
      expect(result.current.hasPageAccess("Dialer")).toBe(false);
      expect(result.current.hasPageAccess("Contacts")).toBe(false);
      expect(pageSwitch("Dialer")).toHaveAttribute("aria-checked", "false");
      expect(pageSwitch("Contacts")).toHaveAttribute("aria-checked", "false");
      expect(pageSwitch()).toHaveAttribute("aria-checked", "true");
      fireEvent.click(pageSwitch());
      fireEvent.click(screen.getByRole("button", { name: "Save Permissions" }));
      await waitFor(() => expect(result.current.hasPageAccess("Carriers")).toBe(false));
      expect(h.upserts).toHaveLength(1);
      expect(h.upserts[0]).toMatchObject({ organization_id: "org-1", role });
      expect(pageSwitch()).toHaveAttribute("aria-checked", "false");
      expect(result.current.hasPageAccess("Reports")).toBe(false);
      expect(result.current.hasPageAccess("Dialer")).toBe(false);
      expect(result.current.hasPageAccess("Contacts")).toBe(false);
    });
  }

  it.each(["Agent", "Team Leader"])("uses the new default when no %s permission row exists", async (role) => {
    h.role = role;
    const { result } = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPageAccess("Carriers")).toBe(true);
  });

  it("keeps full initial page defaults in Settings when no permission row exists", async () => {
    render(<Permissions />, { wrapper });
    await screen.findByRole("heading", { name: "Page Access" });
    for (const name of ["Carriers", "Dialer", "Contacts"]) expect(pageSwitch(name)).toHaveAttribute("aria-checked", "true");
  });

  it("preserves saved feature, data-scope, commission, settings, and Contacts decisions", async () => {
    const permissions = {
      p: [{ name: "Reports", agent: false, teamLeader: true }],
      f: [{ category: "Reports", features: [{ name: "View Own Reports", description: "", agent: false, teamLeader: true }] }],
      d: [{ label: "Dashboard & Reports", description: "", agent: "team", teamLeader: "all" }],
      c: [{ name: "View Own Commission Percentage", description: "", agent: false, teamLeader: true }],
      s: [{ slug: "carriers", label: "Carriers", agent: false, teamLeader: true }],
      contacts: { "contacts.leads.view_assigned": false },
    };
    h.rows = [{ id: "rp-1", role: "Agent", permissions }];
    const { result } = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPageAccess("Carriers")).toBe(true);
    expect(result.current.hasPageAccess("Reports")).toBe(false);
    expect(result.current.hasFeatureAccess("View Own Reports")).toBe(false);
    expect(result.current.getDataScope("reports")).toBe("team");
    expect(result.current.canSeeCommission("View Own Commission Percentage")).toBe(false);
    expect(result.current.hasSettingsSectionAccess("carriers")).toBe(false);
    expect(result.current.hasContactsPermission("contacts.leads.view_assigned")).toBe(false);
    for (const key of ["f", "d", "c", "contacts"] as const) expect(result.current.permissions?.[key]).toEqual(permissions[key]);
  });
});

describe("permission failure and route boundaries", () => {
  it.each(["Agent", "Team Leader"])("denies %s after a failed permission read", async (role) => {
    h.role = role; h.error = new Error("permission query unavailable");
    const { result } = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(result.current.error).toBe(h.error));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.permissions).toBeNull();
    expect(result.current.hasPageAccess("Carriers")).toBe(false);
  });

  it.each(["Unrecognized", "Super Admin"])("does not infer access or issue a query for unknown role %s", (role) => {
    h.role = role;
    const { result } = renderHook(() => usePermissions(), { wrapper });
    expect(result.current.hasPageAccess("Carriers")).toBe(false);
    expect(result.current.permissions).toBeNull();
    expect(h.reads).toEqual([]);
  });

  it.each(["user", "organization"])("does not query or grant Carriers without a %s", (missing) => {
    if (missing === "user") h.userId = null;
    else h.orgId = null;
    const { result } = renderHook(() => usePermissions(), { wrapper });
    expect(result.current.hasPageAccess("Carriers")).toBe(false);
    expect(h.reads).toEqual([]);
  });

  it.each([["Admin", false], ["Agent", true], ["Super Admin", true]] as const)(
    "preserves existing full-access semantics for role=%s superAdmin=%s", (role, superAdmin) => {
      h.role = role; h.superAdmin = superAdmin; h.deferred = true;
      const { result } = renderHook(() => usePermissions(), { wrapper });
      expect(result.current.hasPageAccess("Carriers")).toBe(true);
      expect(result.current.hasPageAccess("Reports")).toBe(true);
    },
  );

  it.each(["denied", "failure"])("PageGuard never mounts the Carriers content after %s", async (reason) => {
    setStored([{ name: "Carriers", agent: false, teamLeader: true }]);
    if (reason === "failure") h.error = new Error("permission query unavailable");
    const mounted = vi.fn();
    const Content = () => { React.useEffect(mounted, []); return <div>Carrier directory content</div>; };
    render(<PageGuard pageName="Carriers"><Content /></PageGuard>, { wrapper });
    expect(mounted).not.toHaveBeenCalled();
    await screen.findByRole("heading", { name: "Access Denied" });
    expect(screen.queryByText("Carrier directory content")).toBeNull();
    expect(mounted).not.toHaveBeenCalled();
  });
});
