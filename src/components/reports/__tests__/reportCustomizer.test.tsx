import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ReportCustomizer from "../ReportCustomizer";
import { DEFAULT_LAYOUT, type SectionConfig } from "@/lib/report-layout-constants";

function Harness({ initial = DEFAULT_LAYOUT.sections, team = true, refuse = false, onChange }: { initial?: SectionConfig[]; team?: boolean; refuse?: boolean; onChange?: (s: SectionConfig[]) => void }) {
  const [sections, setSections] = useState(initial);
  return <ReportCustomizer editMode sections={sections} showTeamSections={team} busy={false} error={null}
    onSectionsChange={s => { onChange?.(s); if (!refuse) setSections(s); }} onSave={vi.fn()} onCancel={vi.fn()} onReset={vi.fn()} />;
}
const order = (group: string) => [...document.querySelectorAll(`[data-customizer-group='${group}'] [data-customizer-section]`)].map(e => e.getAttribute("data-customizer-section"));

describe("Customizer (layout v5)", () => {
  it("limits the activity strip to six and allows replacing a selected metric", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Total talk time" }));
    expect((screen.getByRole("checkbox", { name: "Show Time in dialer" }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Calls made" }));
    expect((screen.getByRole("checkbox", { name: "Show Time in dialer" }) as HTMLInputElement).disabled).toBe(false);
  });
  it("reorders within a group without mutating input or moving other groups", () => {
    const initial = DEFAULT_LAYOUT.sections.map(s => ({ ...s }));
    const frozen = JSON.stringify(initial);
    render(<Harness initial={initial} />);
    const before = order("sections");
    fireEvent.click(screen.getByRole("button", { name: "Move Lead sources up" }));
    expect(order("breakdowns").slice(0, 2)).toEqual(["lead_source_roi", "campaign_performance"]);
    expect(order("sections")).toEqual(before);
    expect(JSON.stringify(initial)).toBe(frozen);
  });
  it("sections are visibility only: no move buttons", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /Move Regional performance/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Show Regional performance" })).toBeTruthy();
  });
  it("keeps focus on the moved item, switching to its other move button at a group edge (U-9)", () => {
    render(<Harness />);
    const up = screen.getByRole("button", { name: "Move Lead sources up" });
    up.focus(); fireEvent.click(up);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Move Lead sources down");
  });
  it("does not move focus for a move the owner refused", () => {
    render(<Harness refuse />);
    const up = screen.getByRole("button", { name: "Move Lead sources up" });
    up.focus(); fireEvent.click(up);
    expect(document.activeElement).toBe(up);
  });
  it("says in one line that only the viewer's report changes and the fixed content stays", () => {
    render(<Harness />);
    expect(screen.getByText(/^Only your view changes\. Production, highlights and trends always stay/)).toBeTruthy();
  });
  it("keeps the team-only agent table listed in Personal with a scope explanation", () => {
    render(<Harness team={false} />);
    expect(screen.getByText("Team and Agency scopes only")).toBeTruthy();
  });
});
