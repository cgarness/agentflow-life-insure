import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UnsavedChangesProvider } from "@/contexts/UnsavedChangesContext";
import type { GridSnapshot } from "@/lib/commission/adminTypes";

/**
 * Collapsible carrier groups in the grid editor. Collapsing is a view choice only: the draft, its dirty
 * state, the save payload and validation must not change, and a collapsed group must still say it has
 * problems (its product and variant messages are otherwise shown only inside the group).
 * A native <button> is what makes Enter and Space work; jsdom cannot press them, so real key presses
 * are checked in a browser (see WORK_LOG, 2026-10-16 pre-PR corrections).
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GRID = id(1);

function synthetic(): GridSnapshot {
  return {
    grid: {
      id: GRID, name: "Synthetic Private", effectiveDate: "2025-04-01", isActive: true, contractLevels: [120, 100], revision: 7,
      origin: "full_copy", shared: false, editable: true, updatedAt: "2025-04-02T10:00:00Z", updatedByName: "Ada One",
    },
    products: [
      { id: id(10), category: "term", carrier: "Synthetic Carrier East", productName: "East Level", isActive: true },
      { id: id(11), category: "whole_life", carrier: "Synthetic Carrier East", productName: "East Final", isActive: true },
      { id: id(12), category: "iul", carrier: "Synthetic Carrier West", productName: "West Builder", isActive: true },
    ],
    variants: [
      { id: id(20), productId: id(10), label: "", minAge: 18, maxAge: 60, termYears: [20] },
      { id: id(21), productId: id(11), label: "", minAge: 50, maxAge: 80, termYears: null },
      { id: id(22), productId: id(12), label: "", minAge: 0, maxAge: 17, termYears: null },
    ],
    rates: [
      { variantId: id(20), contractLevel: 120, ratePercent: "40.5" },
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

const renderEditor = () =>
  render(
    <UnsavedChangesProvider>
      <MemoryRouter initialEntries={["/settings?section=commission-grids"]}>
        <GridEditor gridId={GRID} calculatorGridId={null} onClose={() => {}} />
      </MemoryRouter>
    </UnsavedChangesProvider>,
  );

const toggle = (carrier: string) => screen.getByRole("button", { name: new RegExp(`^(Collapse|Expand) ${carrier}$`) });
/** A product-name input by its current value, including inputs inside a collapsed (hidden) group. */
const productName = (value: string) =>
  screen.getAllByRole("textbox", { name: "Product name", hidden: true }).find((input) => (input as HTMLInputElement).value === value)!;
const saveButton = () => screen.getByRole("button", { name: /Save changes/ });

describe("Carrier groups in the grid editor", () => {
  it("start expanded, and collapse and expand only the chosen carrier", () => {
    renderEditor();
    const east = toggle("Synthetic Carrier East");
    expect(east).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByDisplayValue("East Level")).toBeVisible();

    fireEvent.click(east);
    expect(toggle("Synthetic Carrier East")).toHaveAttribute("aria-expanded", "false");
    expect(toggle("Synthetic Carrier East")).toHaveAccessibleName("Expand Synthetic Carrier East");
    expect(screen.getByDisplayValue("East Level")).not.toBeVisible();
    expect(screen.getByDisplayValue("East Final")).not.toBeVisible();
    // The other carrier is untouched.
    expect(toggle("Synthetic Carrier West")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByDisplayValue("West Builder")).toBeVisible();
    // The rate matrix still lists every product's rates (collapsing hides only the group's fields).
    expect(screen.getAllByRole("textbox", { name: "All ages at level 120" })).toHaveLength(3);

    fireEvent.click(toggle("Synthetic Carrier East"));
    expect(toggle("Synthetic Carrier East")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByDisplayValue("East Level")).toBeVisible();
  });

  it("use a focusable native button that names and controls the group's region", () => {
    renderEditor();
    const east = toggle("Synthetic Carrier East");
    expect(east.tagName).toBe("BUTTON");
    expect(east).toHaveAttribute("type", "button");
    expect(east).not.toHaveAttribute("tabindex", "-1");
    east.focus();
    expect(east).toHaveFocus();

    const regionId = east.getAttribute("aria-controls");
    expect(regionId).toBeTruthy();
    const region = document.getElementById(regionId!);
    expect(region).not.toBeNull();
    expect(within(region!).getByDisplayValue("East Level")).toBeInTheDocument();

    fireEvent.click(east);
    expect(region).not.toBeVisible();
    // The control keeps focus and its relationship while collapsed.
    expect(toggle("Synthetic Carrier East")).toHaveFocus();
    expect(toggle("Synthetic Carrier East")).toHaveAttribute("aria-controls", regionId);
  });

  it("keep an unsaved draft through collapse and expand, and save it unchanged", () => {
    renderEditor();
    fireEvent.change(screen.getByDisplayValue("East Final"), { target: { value: "East Final Plus" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.click(toggle("Synthetic Carrier East"));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    fireEvent.click(toggle("Synthetic Carrier East"));
    expect(screen.getByDisplayValue("East Final Plus")).toBeVisible();

    // Saving while collapsed sends the same change set at the loaded revision.
    fireEvent.click(toggle("Synthetic Carrier East"));
    fireEvent.click(saveButton());
    expect(h.save.mutate).toHaveBeenCalledTimes(1);
    const [args] = h.save.mutate.mock.calls[0];
    expect(args.gridId).toBe(GRID);
    expect(args.revision).toBe(7);
    expect(JSON.stringify(args.changes)).toContain("East Final Plus");
    expect(JSON.stringify(args.changes)).not.toContain("rate_percent");
  });

  it("say how many problems a collapsed group holds, and keep Save disabled", () => {
    renderEditor();
    fireEvent.change(screen.getByDisplayValue("East Level"), { target: { value: "" } });
    const message = "Product names need 1 to 160 characters, without leading or trailing spaces.";
    expect(screen.getByText(message)).toBeVisible();
    expect(screen.queryByText(/^\d+ problems?$/)).toBeNull(); // nothing extra while the group is open

    fireEvent.click(toggle("Synthetic Carrier East"));
    expect(screen.getByText("1 problem")).toBeVisible();
    expect(screen.getByText(message)).not.toBeVisible();
    expect(saveButton()).toBeDisabled();
    // Only the collapsed group with the problem is flagged.
    fireEvent.click(toggle("Synthetic Carrier West"));
    expect(screen.getAllByText(/^\d+ problems?$/)).toHaveLength(1);

    fireEvent.click(toggle("Synthetic Carrier East"));
    expect(screen.queryByText("1 problem")).toBeNull();
    expect(screen.getByText(message)).toBeVisible();

    // Fixing it while collapsed clears the count and re-enables Save.
    fireEvent.click(toggle("Synthetic Carrier East"));
    fireEvent.change(productName(""), { target: { value: "East Level" } });
    expect(screen.queryByText("1 problem")).toBeNull();
    expect(saveButton()).toBeDisabled(); // back to the loaded value: nothing to save
  });
});
