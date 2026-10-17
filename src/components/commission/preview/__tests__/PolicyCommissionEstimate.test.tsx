import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PolicyCommissionPreview } from "@/hooks/usePolicyCommissionPreview";

const h = vi.hoisted(() => ({ preview: null as unknown, throws: false }));
// The panel's data comes from the hook; its own behavior (and the real selection state) is tested here.
vi.mock("@/hooks/usePolicyCommissionPreview", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePolicyCommissionPreview: () => {
    if (h.throws) throw new Error("synthetic preview failure");
    return h.preview;
  },
}));
// policyPreview reuses the sale writers' premium rule (policySaleRecording), which imports the client.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { PolicyCommissionEstimate, type PolicyCommissionEstimateProps } from "../PolicyCommissionEstimate";
import { IDS, syntheticContext } from "@/lib/commission/__tests__/syntheticGrid";
import type { ReadyCalculatorContext } from "@/lib/commission/types";

const NORTH = "Synthetic Carrier North";
const SOUTH = "Synthetic Carrier South";
const ready = (overrides: Partial<Extract<PolicyCommissionPreview, { status: "ready" }>> = {}): PolicyCommissionPreview => ({
  status: "ready",
  identity: "viewer-a|1|0",
  context: syntheticContext("100"),
  level: { kind: "valid", level: 100 },
  agentName: null,
  ...overrides,
});
const baseProps: PolicyCommissionEstimateProps = { owner: { kind: "self" }, policyType: "Final Expense", carrier: NORTH, monthlyPremium: "100" };

function setup(props: Partial<PolicyCommissionEstimateProps> = {}) {
  const view = render(<PolicyCommissionEstimate {...baseProps} {...props} />);
  const rerender = (next: Partial<PolicyCommissionEstimateProps> = {}) =>
    view.rerender(<PolicyCommissionEstimate {...baseProps} {...props} {...next} />);
  return { ...view, rerender };
}
const panel = () => screen.queryByRole("region", { name: "Commission estimate" });
const productSelect = () => screen.getByLabelText("Product") as HTMLSelectElement;
const termSelect = () => screen.queryByLabelText("Term") as HTMLSelectElement | null;
const ageInput = () => screen.getByLabelText("Insured age") as HTMLInputElement;
const figures = () => {
  const region = panel();
  if (!region) return null;
  const first = within(region).queryByText(/^Estimated first-year commission:/);
  const advance = within(region).queryByText(/^Estimated advance \(75%\):/);
  return first && advance ? [first.textContent, advance.textContent] : null;
};

beforeEach(() => {
  h.preview = ready();
  h.throws = false;
});
afterEach(cleanup);

describe("states", () => {
  it("renders nothing while hidden, or before a carrier is chosen", () => {
    h.preview = { status: "hidden", identity: "x" };
    const hidden = setup();
    expect(hidden.container.innerHTML).toBe("");
    hidden.unmount();
    h.preview = ready();
    const noCarrier = setup({ carrier: "  " });
    expect(noCarrier.container.innerHTML).toBe("");
  });

  it("shows unavailable and level problems as one muted line, with no inputs or figures", () => {
    h.preview = { status: "unavailable", identity: "x", message: "No assigned agent" };
    const unavailable = setup();
    expect(panel()?.textContent).toBe("No assigned agent");
    expect(screen.queryByLabelText("Product")).toBeNull();
    unavailable.unmount();
    h.preview = ready({ level: { kind: "problem", message: "This agent's contract level isn't set up." }, agentName: "Synthetic B" });
    setup();
    expect(panel()?.textContent).toBe("For Synthetic BThis agent's contract level isn't set up.");
    expect(figures()).toBeNull();
  });

  it("states when the grid has no matching product for the carrier", () => {
    setup({ carrier: "Synthetic Carrier West" });
    expect(panel()?.textContent).toBe("No matching product on your agency's comp grid");
    expect(figures()).toBeNull();
  });

  it("a preview failure renders nothing and never takes the surrounding form down", () => {
    h.throws = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <p>Policy fields</p>
        <PolicyCommissionEstimate {...baseProps} />
      </div>,
    );
    expect(screen.getByText("Policy fields")).toBeTruthy();
    expect(panel()).toBeNull();
    warn.mockRestore();
    error.mockRestore();
  });
});

describe("Final Expense product choice (decision P2)", () => {
  it("offers only the matched carrier's whole-life products and never auto-selects", () => {
    setup();
    expect(Array.from(productSelect().options).map((o) => o.text)).toEqual(["Choose…", "North Final Plan"]);
    expect(productSelect().value).toBe("");
    expect(figures()).toBeNull();
    expect(within(panel()!).getByText("Choose a product.")).toBeTruthy();
  });

  it("shows the two compact estimate lines once the exact product and age are entered", () => {
    setup();
    fireEvent.change(productSelect(), { target: { value: IDS.finalPlan } });
    fireEvent.change(ageInput(), { target: { value: "60" } });
    expect(figures()).toEqual(["Estimated first-year commission: $858.00", "Estimated advance (75%): $643.50"]);
  });

  it("estimates a genuinely stored zero rate as $0.00", () => {
    setup({ carrier: SOUTH });
    fireEvent.change(productSelect(), { target: { value: IDS.zeroPlan } });
    fireEvent.change(ageInput(), { target: { value: "60" } });
    expect(figures()).toEqual(["Estimated first-year commission: $0.00", "Estimated advance (75%): $0.00"]);
  });
});

describe("recalculation and inputs", () => {
  it("recalculates on every premium, age, product and term change", () => {
    h.preview = ready({ level: { kind: "valid", level: 130 } });
    const view = setup({ policyType: "Term" });
    fireEvent.change(productSelect(), { target: { value: IDS.levelTerm } });
    expect(termSelect()).toBeTruthy();
    fireEvent.change(ageInput(), { target: { value: "40" } });
    expect(within(panel()!).getByText("Choose a term length.")).toBeTruthy();
    fireEvent.change(termSelect()!, { target: { value: "20" } });
    expect(figures()).toEqual(["Estimated first-year commission: $1,002.00", "Estimated advance (75%): $751.50"]);
    view.rerender({ policyType: "Term", monthlyPremium: "$200.00" });
    expect(figures()).toEqual(["Estimated first-year commission: $2,004.00", "Estimated advance (75%): $1,503.00"]);
    fireEvent.change(ageInput(), { target: { value: "70" } });
    expect(figures()).toBeNull();
    expect(within(panel()!).getByText("Not available for this age.")).toBeTruthy();
    view.rerender({ policyType: "Term", monthlyPremium: "" });
    expect(within(panel()!).getByText("Enter the monthly premium.")).toBeTruthy();
  });

  it("prefills only a valid age, follows the Sold Date while untouched and keeps an edit", () => {
    const prefill = { dateOfBirth: "1966-06-15", onDate: "2026-06-14" };
    const view = setup({ agePrefill: prefill });
    expect(ageInput().value).toBe("59");
    view.rerender({ agePrefill: { ...prefill, onDate: "2026-06-15" } });
    expect(ageInput().value).toBe("60");
    fireEvent.change(ageInput(), { target: { value: "61" } });
    view.rerender({ agePrefill: { ...prefill, onDate: "2026-07-01" } });
    expect(ageInput().value).toBe("61");
    view.unmount();
    setup({ agePrefill: { dateOfBirth: "2030-01-01", age: 50, onDate: "2026-06-15" } });
    expect(ageInput().value).toBe("");
  });

  it("identifies another credited agent compactly", () => {
    h.preview = ready({ agentName: "Synthetic B", level: { kind: "valid", level: 120 } });
    setup();
    expect(within(panel()!).getByText("For Synthetic B")).toBeTruthy();
    fireEvent.change(productSelect(), { target: { value: IDS.finalPlan } });
    fireEvent.change(ageInput(), { target: { value: "60" } });
    expect(figures()).toEqual(["Estimated first-year commission: $1,056.00", "Estimated advance (75%): $792.00"]);
  });
});

describe("clearing selections", () => {
  const choose = () => {
    fireEvent.change(productSelect(), { target: { value: IDS.finalPlan } });
    fireEvent.change(ageInput(), { target: { value: "60" } });
  };

  it("clears a product the policy type or carrier no longer offers, and never resurrects it", () => {
    const view = setup();
    choose();
    view.rerender({ policyType: "Term" });
    expect(productSelect().value).toBe("");
    expect(figures()).toBeNull();
    view.rerender({ policyType: "Final Expense" });
    expect(productSelect().value).toBe("");
    choose();
    view.rerender({ carrier: SOUTH });
    expect(productSelect().value).toBe("");
    view.rerender({ carrier: NORTH });
    expect(productSelect().value).toBe("");
  });

  it("clears a term the grid revision no longer supports, keeping the product", () => {
    const view = setup({ policyType: "Term" });
    fireEvent.change(productSelect(), { target: { value: IDS.levelTerm } });
    fireEvent.change(termSelect()!, { target: { value: "30" } });
    const base = syntheticContext("100");
    const revised: ReadyCalculatorContext = {
      ...base,
      grid: { ...base.grid, revision: base.grid.revision + 1 },
      variants: base.variants.filter((variant) => variant.id !== IDS.levelTerm30),
    };
    h.preview = ready({ context: revised });
    view.rerender({ policyType: "Term" });
    expect(productSelect().value).toBe(IDS.levelTerm);
    expect(termSelect()!.value).toBe("");
  });

  it("starts over for a new viewer or permission set, or a different grid", () => {
    const view = setup();
    choose();
    h.preview = ready({ identity: "viewer-b|1|0" });
    view.rerender();
    expect(productSelect().value).toBe("");
    expect(ageInput().value).toBe("");
    choose();
    const base = syntheticContext("100");
    h.preview = ready({ identity: "viewer-b|1|0", context: { ...base, grid: { ...base.grid, id: "00000000-0000-4000-8000-000000000099" } } });
    view.rerender();
    expect(productSelect().value).toBe("");
    expect(ageInput().value).toBe("");
  });

  it("keeps inputs while the panel is briefly hidden (e.g. a refetch)", () => {
    const view = setup();
    choose();
    h.preview = { status: "hidden", identity: "viewer-a|1|0" };
    view.rerender();
    expect(panel()).toBeNull();
    h.preview = ready();
    view.rerender();
    expect(productSelect().value).toBe(IDS.finalPlan);
    expect(figures()).not.toBeNull();
  });
});
