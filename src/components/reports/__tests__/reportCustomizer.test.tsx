import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReportCustomizer from "../ReportCustomizer";
import { DEFAULT_LAYOUT, REPORT_LAYOUT_SECTIONS, type SectionConfig } from "@/lib/report-layout-constants";

const freshSections = () => DEFAULT_LAYOUT.sections.map((section) => ({ ...section }));
const props = () => ({
  editMode: true, sections: freshSections(), onSectionsChange: vi.fn(), showTeamSections: true,
  busy: false, error: null as string | null, onSave: vi.fn(), onCancel: vi.fn(), onReset: vi.fn(),
});

function DraftEditor({ initial = freshSections() }: { initial?: SectionConfig[] }) {
  const [sections, setSections] = React.useState(initial);
  return <ReportCustomizer {...props()} sections={sections} onSectionsChange={setSections} />;
}

const idsIn = (container: HTMLElement, group: string) => Array.from(
  container.querySelectorAll(`[data-customizer-group="${group}"] [data-customizer-section]`),
  (element) => element.getAttribute("data-customizer-section"),
);

describe("personal report customization", () => {
  it("limits metrics to six and allows replacing a selected metric", () => {
    render(<DraftEditor />);
    const available = screen.getByRole("checkbox", { name: "Show Avg talk time per dial" });
    expect(screen.getByText(/6 of 6 metrics selected/)).toBeInTheDocument();
    expect(available).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Calls made" }));
    expect(available).toBeEnabled();
    fireEvent.click(available);
    expect(available).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Show Calls made" })).toBeDisabled();
    expect(screen.getByText(/6 of 6 metrics selected/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^Show Policies sold$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^Show Known annual premium$/i })).not.toBeInTheDocument();
  });

  it("reorders within a group without mutating input or moving other groups", () => {
    const original = freshSections();
    const snapshot = structuredClone(original);
    const { container } = render(<DraftEditor initial={original} />);
    const stats = idsIn(container, "stats");
    const diagnostics = idsIn(container, "diagnostics");
    expect(screen.getByRole("button", { name: "Move Agent performance up" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Agent performance down" }));
    expect(idsIn(container, "performance")).toEqual([
      "agent_efficiency", "agent_performance_cards", "campaign_performance", "lead_source_roi",
    ]);
    expect(idsIn(container, "stats")).toEqual(stats);
    expect(idsIn(container, "diagnostics")).toEqual(diagnostics);
    expect(original).toEqual(snapshot);
    expect(screen.getByRole("button", { name: "Move Lead sources down" })).toBeDisabled();
  });

  it("keeps focus on the moved item, switching to its other move button at a group edge (U-9)", () => {
    const { container } = render(<DraftEditor />);
    const press = (name: string) => {
      const button = screen.getByRole("button", { name });
      button.focus();
      fireEvent.click(button);
    };
    const focused = () => document.activeElement?.getAttribute("aria-label");
    // Same direction while the button stays enabled (the moved row is re-ordered in the DOM).
    press("Move Agent performance down");
    expect(idsIn(container, "performance")).toEqual(["agent_efficiency", "agent_performance_cards", "campaign_performance", "lead_source_roi"]);
    expect(focused()).toBe("Move Agent performance down");
    // Into the first slot: "up" disables, so focus moves to the same item's "down".
    press("Move Agent performance up");
    expect(idsIn(container, "performance")[0]).toBe("agent_performance_cards");
    expect(screen.getByRole("button", { name: "Move Agent performance up" })).toBeDisabled();
    expect(focused()).toBe("Move Agent performance down");
    // Into the last slot: "down" disables, so focus moves to the same item's "up".
    press("Move Campaign performance down");
    expect(idsIn(container, "performance").at(-1)).toBe("campaign_performance");
    expect(screen.getByRole("button", { name: "Move Campaign performance down" })).toBeDisabled();
    expect(focused()).toBe("Move Campaign performance up");
  });

  it("does not move focus for a move the owner refused", () => {
    const input = props();
    const { rerender } = render(<ReportCustomizer {...input} />);
    screen.getByRole("button", { name: "Move Agent efficiency up" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Move Agent efficiency up" }));
    expect(input.onSectionsChange).toHaveBeenCalledOnce();
    const calls = screen.getByRole("checkbox", { name: "Show Calls made" });
    calls.focus();
    // A later render with the order unchanged (the move never happened) must not steal focus back.
    rerender(<ReportCustomizer {...input} sections={input.sections.map((section) => ({ ...section }))} />);
    expect(document.activeElement).toBe(calls);
  });

  it("says in one line that only the viewer's report changes and the fixed content stays", () => {
    render(<ReportCustomizer {...props()} />);
    const region = screen.getByRole("region", { name: "Customize your report" });
    expect(within(region).getByText("Only your view changes. Production totals and trends always stay.")).toBeInTheDocument();
    expect(within(region).getByText("Reset removes your saved layout and uses your agency default when available.")).toBeInTheDocument();
    expect(region.querySelector("[data-customizer-actions]")).toContainElement(screen.getByRole("button", { name: "Save layout" }));
  });

  it("keeps selected team metrics removable in Personal with a scope explanation", () => {
    const input = props();
    input.showTeamSections = false;
    input.sections = [{ id: "stat_top_performer", visible: true }];
    render(<ReportCustomizer {...input} />);
    const teamLabel = REPORT_LAYOUT_SECTIONS.find((section) => section.id === "stat_top_performer")!.label;
    const checkbox = screen.getByRole("checkbox", { name: `Show ${teamLabel}` });
    expect(checkbox).toBeChecked();
    expect(screen.getByText("Team and Agency scopes only")).toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(input.onSectionsChange).toHaveBeenCalledWith([{ id: "stat_top_performer", visible: false }]);
  });

  it("uses explicit Save, Cancel and Reset actions without organization writes", () => {
    const input = props();
    render(<ReportCustomizer {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(input.onSave).toHaveBeenCalledOnce();
    expect(input.onCancel).toHaveBeenCalledOnce();
    expect(input.onReset).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /org default/i })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Customize your report" })).toBeInTheDocument();
  });

  it("blocks edits while pending and displays a failed save without discarding draft choices", () => {
    const input = props();
    input.sections[0].visible = false;
    const { rerender } = render(<ReportCustomizer {...input} busy />);
    const region = screen.getByRole("region", { name: "Customize your report" });
    for (const button of within(region).getAllByRole("button")) expect(button).toBeDisabled();
    for (const checkbox of within(region).getAllByRole("checkbox")) expect(checkbox).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Updating…" }));
    expect(input.onSave).not.toHaveBeenCalled();
    rerender(<ReportCustomizer {...input} error="Your layout could not be saved. Try again." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your layout could not be saved. Try again.");
    expect(screen.getByRole("checkbox", { name: "Show Calls made" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save layout" })).toBeEnabled();
  });
});
