import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UnsavedChangesProvider } from "@/contexts/UnsavedChangesContext";
import type { AdminOverview, GridSnapshot, SharedGridCatalogEntry } from "@/lib/commission/adminTypes";
import { CommissionApiError } from "@/lib/commission/errors";

/**
 * A failed background read must never destroy an unsaved draft. Real React Query, the real admin hooks, the
 * real settings section, editor, draft, navigation guard and dialogs: only the server calls, the signed-in
 * identity and the permission check are stand-ins. Synthetic data only.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER_A = id(901);
const USER_B = id(902);
const ORG = id(950);
const OTHER_ORG = id(951);
const SHARED = id(1);
const PRIVATE = id(2);

const h = vi.hoisted(() => ({
  auth: null as { user: { id: string } | null; profile: { id: string; organization_id: string } | null; isImpersonating: boolean } | null,
  admin: true,
  api: {
    fetchAdminOverview: vi.fn(),
    fetchSharedGridCatalog: vi.fn(),
    fetchGridSnapshot: vi.fn(),
    saveGridChanges: vi.fn(),
    createPrivateGrid: vi.fn(),
    deletePrivateGrid: vi.fn(),
    enableSharedGrid: vi.fn(),
    disableSharedGrid: vi.fn(),
    selectCalculatorGrid: vi.fn(),
  },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isLoading: false, hasSettingsSectionAccess: () => h.admin }) }));
vi.mock("@/lib/commission/adminApi", () => h.api);
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import CommissionGridsSettings from "../CommissionGridsSettings";

const listed = (gridId: string, name: string, shared: boolean, revision: number) => ({
  id: gridId, name, shared, effectiveDate: "2025-03-01", isActive: true, contractLevels: [120, 100], revision,
  origin: shared ? ("agentflow_reference" as const) : ("full_copy" as const), updatedAt: "2025-03-02T10:00:00Z",
  updatedByName: shared ? null : "Ada One", productCount: 1,
});
const overview = (): AdminOverview => ({
  calculatorGridId: SHARED,
  grids: [listed(SHARED, "Synthetic Shared", true, 3), listed(PRIVATE, "Synthetic Private", false, 5)],
});
const catalog = (): SharedGridCatalogEntry[] => [
  { id: SHARED, name: "Synthetic Shared", effectiveDate: "2025-01-01", contractLevels: [120, 100], isEnabled: true },
];
const snapshot = (revision = 5, rate = "91.75"): GridSnapshot => ({
  grid: {
    id: PRIVATE, name: "Synthetic Private", effectiveDate: "2025-04-01", isActive: true, contractLevels: [120, 100], revision,
    origin: "full_copy", shared: false, editable: true, updatedAt: "2025-04-02T10:00:00Z", updatedByName: "Ada One",
  },
  products: [{ id: id(10), category: "whole_life", carrier: "Synthetic Carrier", productName: "Synthetic Final", isActive: true }],
  variants: [{ id: id(20), productId: id(10), label: "0-70", minAge: null, maxAge: 70, termYears: null }],
  rates: [
    { variantId: id(20), contractLevel: 120, ratePercent: rate },
    { variantId: id(20), contractLevel: 100, ratePercent: "75.5" },
  ],
  references: [],
});
const failure = () => new CommissionApiError("failed", "Synthetic network failure");
const signedIn = (userId: string, organizationId = ORG) => ({ user: { id: userId }, profile: { id: userId, organization_id: organizationId }, isImpersonating: false });

const clients: QueryClient[] = [];
function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  clients.push(client);
  const tree = () => (
    <QueryClientProvider client={client}>
      <UnsavedChangesProvider>
        <MemoryRouter initialEntries={["/settings?section=commission-grids"]}>
          <Routes>
            <Route path="/settings" element={<><Link to="/dashboard">Dashboard link</Link><CommissionGridsSettings /></>} />
            <Route path="/dashboard" element={<p>Dashboard page</p>} />
          </Routes>
        </MemoryRouter>
      </UnsavedChangesProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  return { client, rerender: () => view.rerender(tree()) };
}
const CELL = { name: "0-70 at level 120" };
const cell = () => screen.getByRole("textbox", CELL) as HTMLInputElement;
const UNSAVED_DIALOG = "You have unsaved changes. If you leave, your changes will be lost.";
/** A background refetch of one admin read, as a focus refresh or a post-save invalidation would run it. */
const refresh = (client: QueryClient, part: "overview" | "catalog" | "snapshot") =>
  act(async () => {
    await client.refetchQueries({ predicate: (query) => query.queryKey[0] === "commission-grids-admin" && query.queryKey[3] === part });
    // React Query tells its observers on a timer; let that land inside act so the UI reflects the result.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function openEditedGrid() {
  const ui = renderSection();
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  await screen.findByRole("textbox", CELL);
  fireEvent.change(cell(), { target: { value: "91" } });
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  return ui;
}
async function expectHeldThenStay() {
  fireEvent.click(screen.getByText("Dashboard link"));
  expect(screen.getByText(UNSAVED_DIALOG)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Stay" }));
  await waitFor(() => expect(screen.queryByText(UNSAVED_DIALOG)).toBeNull());
  expect(screen.queryByText("Dashboard page")).toBeNull();
  expect(cell().value).toBe("91");
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  h.auth = signedIn(USER_A);
  h.admin = true;
  Object.values(h.api).forEach((fn) => fn.mockReset());
  h.api.fetchAdminOverview.mockImplementation(async () => overview());
  h.api.fetchSharedGridCatalog.mockImplementation(async () => catalog());
  h.api.fetchGridSnapshot.mockImplementation(async () => snapshot());
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe("Commission grid editor: background read failures keep the unsaved draft", () => {
  it.each(["overview", "catalog"] as const)("a failed %s refresh keeps the open editor, its draft and its guard", async (part) => {
    const { client } = await openEditedGrid();
    (part === "overview" ? h.api.fetchAdminOverview : h.api.fetchSharedGridCatalog).mockRejectedValueOnce(failure());
    await refresh(client, part);
    expect(cell().value).toBe("91");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't refresh commission grids. Showing what was last loaded.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    await expectHeldThenStay();
  });

  it("a failed snapshot refresh keeps the controls, the draft and a working Stay/Leave dialog", async () => {
    const { client } = await openEditedGrid();
    h.api.fetchGridSnapshot.mockRejectedValueOnce(failure());
    await refresh(client, "snapshot");
    expect(cell().value).toBe("91");
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't refresh this grid. Your unsaved changes are still here.");
    expect(screen.getByRole("button", { name: /Save changes/ })).toBeEnabled();
    await expectHeldThenStay();
  });

  it("Retry clears failed refreshes without losing the draft", async () => {
    const { client } = await openEditedGrid();
    h.api.fetchAdminOverview.mockRejectedValueOnce(failure());
    h.api.fetchGridSnapshot.mockRejectedValueOnce(failure());
    await refresh(client, "overview");
    await refresh(client, "snapshot");
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    screen.getAllByRole("button", { name: "Retry" }).forEach((button) => fireEvent.click(button));
    await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(0));
    expect(cell().value).toBe("91");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("a save followed by a failed refresh reads as saved, holds nothing, and Retry recovers the editor", async () => {
    await openEditedGrid();
    h.api.saveGridChanges.mockResolvedValueOnce({ revision: 6 });
    h.api.fetchGridSnapshot.mockRejectedValueOnce(failure());
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    expect(await screen.findByText("Your changes were saved, but the latest version of this grid couldn't be loaded.")).toBeInTheDocument();
    expect(h.api.saveGridChanges).toHaveBeenCalledWith(PRIVATE, 5, expect.anything());
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    expect(screen.getByText("91")).toBeInTheDocument();
    h.api.fetchGridSnapshot.mockImplementation(async () => snapshot(6, "91"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect((await screen.findByRole("textbox", CELL) as HTMLInputElement).value).toBe("91");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Dashboard link"));
    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
  });

  it("a failed initial load replaces the view with the error and Retry, which then loads it", async () => {
    h.api.fetchAdminOverview.mockRejectedValueOnce(failure());
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic network failure");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    h.api.fetchGridSnapshot.mockRejectedValueOnce(failure());
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic network failure");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect((await screen.findByRole("textbox", CELL) as HTMLInputElement).value).toBe("91.75");
  });
});

describe("Commission grid editor: access changes still remove the editor and its draft", () => {
  it("permission loss denies access and releases navigation", async () => {
    const { rerender } = await openEditedGrid();
    h.admin = false;
    rerender();
    expect(screen.getByText("Only agency admins can manage commission grids.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", CELL)).toBeNull();
    fireEvent.click(screen.getByText("Dashboard link"));
    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
  });

  it("logout denies access, and signing back in starts from the list without the draft", async () => {
    const { rerender } = await openEditedGrid();
    h.auth = { user: null, profile: null, isImpersonating: false };
    rerender();
    expect(screen.getByText("Only agency admins can manage commission grids.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", CELL)).toBeNull();
    h.auth = signedIn(USER_A);
    rerender();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect((await screen.findByRole("textbox", CELL) as HTMLInputElement).value).toBe("91.75");
  });

  it.each([
    ["another user in the same agency", () => signedIn(USER_B)],
    ["the same user in another agency", () => signedIn(USER_A, OTHER_ORG)],
  ])("%s starts from the list and never sees the unsaved draft", async (_label, next) => {
    const { rerender } = await openEditedGrid();
    h.auth = next();
    rerender();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect((await screen.findByRole("textbox", CELL) as HTMLInputElement).value).toBe("91.75");
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });
});
