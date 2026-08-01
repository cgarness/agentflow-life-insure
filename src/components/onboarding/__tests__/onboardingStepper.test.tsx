/**
 * Onboarding stepper contract.
 *
 * The indicator must be understandable without colour (numbers + labels +
 * `aria-current`) and must never imply that a visited step's data was already
 * persisted — nothing is saved until the final submit.
 */
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import OnboardingStepper from "@/components/onboarding/OnboardingStepper";

afterEach(cleanup);

const items = () => within(screen.getByRole("list", { name: "Setup progress" })).getAllByRole("listitem");

describe("OnboardingStepper", () => {
  it("renders exactly three steps with numbers and labels", () => {
    render(<OnboardingStepper current={0} finalLabel="Agency" />);
    const steps = items();
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent("1");
    expect(steps[0]).toHaveTextContent("Profile");
    expect(steps[1]).toHaveTextContent("2");
    expect(steps[1]).toHaveTextContent("Licensing");
    expect(steps[2]).toHaveTextContent("3");
    expect(steps[2]).toHaveTextContent("Agency");
  });

  it("marks only the current step with aria-current", () => {
    render(<OnboardingStepper current={1} finalLabel="Agency" />);
    const steps = items();
    expect(steps[0]).not.toHaveAttribute("aria-current");
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(steps[2]).not.toHaveAttribute("aria-current");
  });

  it("describes each step's state in text, not colour alone", () => {
    render(<OnboardingStepper current={1} finalLabel="Workspace" />);
    const steps = items();
    expect(steps[0]).toHaveTextContent("visited");
    expect(steps[1]).toHaveTextContent("current step");
    expect(steps[2]).toHaveTextContent("not started");
  });

  it("does not claim a visited step was completed or saved", () => {
    const { container } = render(<OnboardingStepper current={2} finalLabel="Agency" />);
    expect(screen.queryByText(/completed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
    // No checkmark glyph — a tick would imply persisted data.
    expect(container.querySelector("svg")).toBeNull();
  });

  it("switches the third label between the founder and invite audiences", () => {
    const { rerender } = render(<OnboardingStepper current={2} finalLabel="Agency" />);
    expect(items()[2]).toHaveTextContent("Agency");

    rerender(<OnboardingStepper current={2} finalLabel="Workspace" />);
    expect(items()[2]).toHaveTextContent("Workspace");
  });
});
