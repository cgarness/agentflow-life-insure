import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UnsavedChangesProvider } from "@/contexts/UnsavedChangesContext";
import type { GridSnapshot } from "@/lib/commission/adminTypes";
import { CommissionApiError } from "@/lib/commission/errors";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GRID = id(1);

function synthetic(): GridSnapshot {
  return {
    grid: {
      id: GRID, name: "Synthetic Private", effectiveDate: "2025-04-01", isActive: true, contractLevels: [120, 100], revision: 5,
      origin: "full_copy", shared: false, editable: true, updatedAt: "2025-04-02T10:00:00Z", updatedByName: "Ada One",
    },
    products: [{ id: id(10), category: "whole_life", carrier: "Synthetic Carrier", productName: "Synthetic Final", isActive: true }],
    variants: [
      { id: id(20), productId: id(10), label: "0-70", minAge: null, maxAge: 70, termYears: null },
      { id: id(21), productId: id(10), label: "71+", minAge: 71, maxAge: null, termYears: null },
    ],
    rates: [
      { variantId: id(20), contractLevel: 120, ratePercent: "91.75" },
      { variantId: id(20), contractLevel: 100, ratePercent: "75.5" },
      { variantId: id(21), contractLevel: 100, ratePercent: "0" },
    ],
    references: [],
  };
}

const h = vi.hoisted(() => ({
  snapshot: null as GridSnapshot | null,
  save: { mutate: vi.fn(), isPending: false },
}));
vi.mock("@/hooks/useCommissionGridsAdmin", () => ({
  useGridSnapshot: () => ({ data: h.snapshot, isError: false, refetch: vi.fn(async () => ({ data: h.snapshot })) }),
  useCommissionGridMutations: () => ({ save: h.save }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import GridEditor from "../GridEditor";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  h.snapshot = synthetic();
  h.save = { mutate: vi.fn(), isPending: false };
});
afterEach(cleanup);

const renderEditor = (calculatorGridId: string | null = null) =>
  render(
    <UnsavedChangesProvider>
      <MemoryRouter initialEntries={["/settings?section=commission-grids"]}>
        <Routes>
          <Route path="/settings" element={<><Link to="/dashboard">Dashboard link</Link><GridEditor gridId={GRID} calculatorGridId={calculatorGridId} onClose={() => {}} /></>} />
          <Route path="/dashboard" element={<p>Dashboard page</p>} />
        </Routes>
      </MemoryRouter>
    </UnsavedChangesProvider>,
  );
const cell = (label: string, level: number) => screen.getByRole("textbox", { name: `${label} at level ${level}` });
const saveButton = () => screen.getByRole("button", { name: /Save changes/ });

describe("GridEditor", () => {
  it("loads the grid as a clean draft with its last editor", () => {
    renderEditor();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    expect(screen.getByText(/Last edited by Ada One/)).toBeInTheDocument();
    expect((cell("0-70", 120) as HTMLInputElement).value).toBe("91.75");
    expect((cell("71+", 120) as HTMLInputElement).value).toBe("");
    expect(saveButton()).toBeDisabled();
  });

  it("saves edits as one change set at the loaded revision", () => {
    renderEditor();
    fireEvent.change(cell("71+", 120), { target: { value: "0" } });
    fireEvent.change(cell("0-70", 100), { target: { value: "" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(saveButton());
    expect(h.save.mutate).toHaveBeenCalledWith(
      {
        gridId: GRID,
        revision: 5,
        changes: { rates: [{ variant_id: id(20), contract_level: 100, rate_percent: null }, { variant_id: id(21), contract_level: 120, rate_percent: "0" }] },
      },
      expect.anything(),
    );
  });

  it("refuses an invalid rate instead of rounding it", () => {
    renderEditor();
    fireEvent.change(cell("0-70", 120), { target: { value: "87.555" } });
    expect(screen.getByText("Rates must be between 0 and 300 with at most two decimal places.")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(cell("0-70", 120).className).toContain("border-destructive");
  });

  it("asks before removing a level that has rates, then removes them with it", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Remove level 100" }));
    expect(screen.getByText(/2 rates at this level will be deleted when you save/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove level" }));
    expect(screen.queryByRole("button", { name: "Remove level 100" })).toBeNull();
    fireEvent.click(saveButton());
    const { changes } = h.save.mutate.mock.calls[0][0];
    expect(changes.grid.contract_levels).toEqual([120]);
    expect(changes.rates).toEqual([
      { variant_id: id(20), contract_level: 100, rate_percent: null },
      { variant_id: id(21), contract_level: 100, rate_percent: null },
    ]);
  });

  it("shows a conflict instead of overwriting another admin's save", () => {
    h.save.mutate.mockImplementation((_args, options) =>
      options.onError(new CommissionApiError("conflict", "This grid was changed by someone else. Reload to see the latest version.", "PT409")));
    renderEditor();
    fireEvent.change(cell("0-70", 120), { target: { value: "91" } });
    fireEvent.click(saveButton());
    expect(screen.getByRole("alert").textContent).toContain("This grid was changed by someone else. Reload to see the latest version.");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("confirms saving the grid the calculator uses, and warns when deactivating it", () => {
    renderEditor(GRID);
    fireEvent.click(screen.getByRole("switch", { name: "Active" }));
    fireEvent.click(saveButton());
    expect(screen.getByText(/Deactivating this grid turns the Commission Calculator off/)).toBeInTheDocument();
    expect(h.save.mutate).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Save changes" }));
    expect(h.save.mutate.mock.calls[0][0].changes.grid.is_active).toBe(false);
  });

  it("holds navigation away from unsaved changes until Leave", () => {
    renderEditor();
    fireEvent.change(cell("0-70", 120), { target: { value: "91" } });
    fireEvent.click(screen.getByText("Dashboard link"));
    expect(screen.getByText("You have unsaved changes. If you leave, your changes will be lost.")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
  });

  it("asks before deleting a product and counts what goes with it", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Delete Synthetic Final" }));
    expect(screen.getByText("2 variants and 3 rates are deleted when you save.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(saveButton());
    expect(h.save.mutate.mock.calls[0][0].changes).toEqual({ delete_product_ids: [id(10)] });
  });
});
