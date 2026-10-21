import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { syntheticContext } from "@/lib/commission/__tests__/syntheticGrid";
import CalculatorWorkspace from "../CalculatorWorkspace";

beforeAll(() => {
  // jsdom lacks these; Radix Select calls them.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const choose = (label: string, option: string) => {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: option }));
};
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const estimateRows = () =>
  within(screen.getByLabelText("Estimate"))
    .getAllByRole("definition")
    .map((cell) => cell.textContent);

describe("CalculatorWorkspace", () => {
  it("shows the read-only level and a short Estimate only label; the explanation is in the info control, with no grid name", () => {
    render(<CalculatorWorkspace context={syntheticContext(" 100 ")} />);
    expect(screen.getByText("Your level:").textContent).toBe("Your level: 100");
    expect(screen.getByText("Estimate only")).toBeInTheDocument();
    expect(screen.queryByText(/Assumes a 75% advance/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About this estimate" }));
    expect(screen.getByText(/Assumes a 75% advance\. Actual commission and payment timing may vary by age, plan type and carrier rules\./))
      .toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Synthetic Test Grid|effective March 1, 2025|Based on the/);
    expect(screen.queryByRole("textbox", { name: /level/i })).toBeNull();
  });

  it("shows the off-grid message and no inputs for a level that is not on the grid", () => {
    render(<CalculatorWorkspace context={syntheticContext("155%")} />);
    expect(screen.getByText("Your contract level isn't on your agency's comp grid. Ask your admin.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Policy type" })).toBeNull();
  });

  it("distinguishes a missing level (setup) from earnings", () => {
    render(<CalculatorWorkspace context={syntheticContext(null)} />);
    expect(screen.getByText("Your level:").textContent).toBe("Your level: Not set");
    expect(screen.getByText(/hasn't been set up yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Estimate")).toBeNull();
  });

  it("calculates from the inputs in order and clears the result when the carrier changes", () => {
    render(<CalculatorWorkspace context={syntheticContext("100")} />);
    expect(screen.getByText(/to see the estimate/)).toBeInTheDocument();
    choose("Policy type", "Term");
    choose("Carrier", "Synthetic Carrier North");
    choose("Product", "North Level Term");
    type("Client age", "40");
    type("Monthly premium", "100");
    expect(screen.queryByLabelText("Estimate")).toBeNull(); // the term length is still missing
    choose("Term length", "20 years");
    expect(estimateRows()).toEqual(["92.5%", "$1,110.00", "$832.50", "$92.50", "$92.50", "$92.50"]);

    choose("Carrier", "Synthetic Carrier South");
    expect(screen.queryByLabelText("Estimate")).toBeNull();
    expect((screen.getByLabelText("Client age") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Monthly premium") as HTMLInputElement).value).toBe("");
  });

  it("explains unavailable combinations and shows field errors only for entered values", () => {
    render(<CalculatorWorkspace context={syntheticContext("100")} />);
    choose("Policy type", "Term");
    choose("Carrier", "Synthetic Carrier North");
    choose("Product", "North Level Term");
    type("Client age", "55");
    type("Monthly premium", "100");
    choose("Term length", "30 years");
    expect(screen.getByRole("status").textContent).toBe("Not available for a 30-year term at age 55.");
    type("Client age", "101");
    expect(screen.getByText("Enter a whole-number age from 0 to 100.")).toBeInTheDocument();
    type("Monthly premium", "0");
    expect(screen.getByText("Monthly premium must be greater than $0.")).toBeInTheDocument();
  });

  it("estimates a present zero rate as $0 and reports a missing rate as unavailable", () => {
    render(<CalculatorWorkspace context={syntheticContext("100")} />);
    choose("Policy type", "Whole Life");
    choose("Carrier", "Synthetic Carrier South");
    choose("Product", "South Zero Plan");
    type("Client age", "0");
    type("Monthly premium", "250");
    expect(estimateRows()).toEqual(["0%", "$0.00", "$0.00", "$0.00", "$0.00", "$0.00"]);
    cleanup();
    render(<CalculatorWorkspace context={syntheticContext("120")} />);
    choose("Policy type", "Whole Life");
    choose("Carrier", "Synthetic Carrier South");
    choose("Product", "South Zero Plan");
    type("Client age", "30");
    type("Monthly premium", "250");
    expect(screen.getByRole("status").textContent).toBe("Not available at your contract level.");
  });
});
