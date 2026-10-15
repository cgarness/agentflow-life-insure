import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminOverview, SharedGridCatalogEntry } from "@/lib/commission/adminTypes";

const SHARED = "00000000-0000-4000-8000-0000000000a1";
const OTHER_SHARED = "00000000-0000-4000-8000-0000000000a2";
const PRIVATE = "00000000-0000-4000-8000-0000000000b1";

const mutation = () => ({ mutate: vi.fn(), isPending: false });
const h = vi.hoisted(() => ({
  access: { loading: false, enabled: true },
  overview: null as AdminOverview | null,
  catalog: [] as SharedGridCatalogEntry[],
  mutations: {} as Record<string, { mutate: ReturnType<typeof vi.fn>; isPending: boolean }>,
}));

vi.mock("@/hooks/useCommissionGridsAdmin", () => ({
  useCommissionGridsData: () => ({
    access: h.access,
    overview: { data: h.overview, isError: false, error: null },
    catalog: { data: h.catalog, isError: false, error: null },
  }),
  useCommissionGridMutations: () => h.mutations,
  useGridSnapshot: () => ({ data: undefined, isPending: true, isError: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import CommissionGridsSettings from "../CommissionGridsSettings";

const grid = (id: string, name: string, shared: boolean, extra: Partial<AdminOverview["grids"][number]> = {}) => ({
  id, name, shared, effectiveDate: "2025-03-01", isActive: true, contractLevels: [130, 100], revision: 4,
  origin: shared ? ("agentflow_reference" as const) : ("full_copy" as const), updatedAt: "2025-03-02T10:00:00Z",
  updatedByName: shared ? null : "Ada One", productCount: 3, ...extra,
});

beforeAll(() => {
  // jsdom lacks these; Radix Select / RadioGroup call them.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  h.access = { loading: false, enabled: true };
  h.catalog = [
    { id: SHARED, name: "Synthetic Shared One", effectiveDate: "2025-01-01", contractLevels: [145, 65], isEnabled: true },
    { id: OTHER_SHARED, name: "Synthetic Shared Two", effectiveDate: "2025-06-01", contractLevels: [100], isEnabled: false },
  ];
  h.overview = { calculatorGridId: SHARED, grids: [grid(SHARED, "Synthetic Shared One", true), grid(PRIVATE, "Synthetic Private", false)] };
  h.mutations = { enable: mutation(), disable: mutation(), select: mutation(), create: mutation(), remove: mutation(), save: mutation() };
});
afterEach(cleanup);

describe("Settings › Commission Grids", () => {
  it("is for agency admins only", () => {
    h.access = { loading: false, enabled: false };
    render(<CommissionGridsSettings />);
    expect(screen.getByText("Only agency admins can manage commission grids.")).toBeInTheDocument();
    expect(screen.queryByText("Calculator grid")).toBeNull();
  });

  it("works before any calculator is configured and shows catalog metadata only", () => {
    h.overview = { calculatorGridId: null, grids: [] };
    h.catalog = h.catalog.map((entry) => ({ ...entry, isEnabled: false }));
    render(<CommissionGridsSettings />);
    expect(screen.getByText("No grid is selected, so agents don't see the Commission Calculator.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View/ })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Enable" })[0]);
    expect(h.mutations.enable.mutate).toHaveBeenCalledWith(SHARED, expect.anything());
  });

  it("confirms before disabling the grid the calculator uses", () => {
    render(<CommissionGridsSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(screen.getByText(/Your calculator uses this grid\. Agents won't see the Commission Calculator/)).toBeInTheDocument();
    expect(h.mutations.disable.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(h.mutations.disable.mutate).toHaveBeenCalledWith(SHARED, expect.anything());
  });

  it("confirms deleting a private grid with its revision", () => {
    render(<CommissionGridsSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/Its 3 products and every rate are deleted\. This can't be undone\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete grid" }));
    expect(h.mutations.remove.mutate).toHaveBeenCalledWith({ gridId: PRIVATE, revision: 4 }, expect.anything());
  });

  it("changes the calculator grid only after confirmation, compare-and-set on the selection it saw", () => {
    render(<CommissionGridsSettings />);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Grid used by the calculator" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Synthetic Private" }));
    expect(screen.getByText("Agents will estimate from this grid right away.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use this grid" }));
    expect(h.mutations.select.mutate).toHaveBeenCalledWith({ gridId: PRIVATE, expectedCurrent: SHARED }, expect.anything());
  });

  it("duplicating an enabled AgentFlow grid says the copy won't follow it", () => {
    render(<CommissionGridsSettings />);
    fireEvent.click(screen.getByRole("button", { name: /Duplicate/ }));
    expect(screen.getByText("This copy will not update when the shared grid changes.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Duplicate with rates/ })).toBeChecked();
  });

  it("validates the new-grid form with Zod before calling the server", async () => {
    render(<CommissionGridsSettings />);
    fireEvent.click(screen.getByRole("button", { name: /New grid/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create grid" }));
    expect(await screen.findByText("Enter a name of 1 to 120 characters, without leading or trailing spaces.")).toBeInTheDocument();
    expect(screen.getByText("Choose an effective date.")).toBeInTheDocument();
    expect(h.mutations.create.mutate).not.toHaveBeenCalled();
  });
});
