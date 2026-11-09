import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import SectionRenderer, { visibleIds } from "../SectionRenderer";
import { DEFAULT_LAYOUT, normalizeReportLayout } from "@/lib/report-layout-constants";

const components = Object.fromEntries(DEFAULT_LAYOUT.sections.map(s => [s.id, <p key={s.id}>{s.id}</p>]));
const rendered = () => [...document.querySelectorAll("[data-report-section]")].map(e => e.getAttribute("data-report-section"));

describe("SectionRenderer (layout v5)", () => {
  it("renders only the requested group in saved order, with meaningful section ids", () => {
    const layout = normalizeReportLayout({ version: 5, sections: [{ id: "disposition_deep_dive", visible: true }, { id: "lead_source_roi", visible: true }] });
    render(<SectionRenderer sections={layout.sections} group="breakdowns" showTeamSections components={components} />);
    expect(rendered()).toEqual(["disposition_deep_dive", "lead_source_roi", "campaign_performance", "call_flow_analysis", "call_duration_analysis"]);
  });
  it("omits hidden, absent and team-only content in Personal", () => {
    const layout = normalizeReportLayout({ version: 5, sections: [{ id: "calling_heatmap", visible: false }] });
    const { regional_performance: _r, ...partial } = components;
    render(<SectionRenderer sections={layout.sections} group="sections" showTeamSections={false} components={partial} />);
    expect(rendered()).toEqual([]);
    expect(visibleIds(layout.sections, "sections", true)).toEqual(["agent_performance_cards", "regional_performance"]);
  });
  it("marks each section with its group id so the page keeps the brief order", () => {
    render(<SectionRenderer sections={DEFAULT_LAYOUT.sections} group="sections" showTeamSections components={components} />);
    expect([...document.querySelectorAll("[data-report-group]")].map(e => e.getAttribute("data-report-group"))).toEqual(["agent_performance_cards", "regional_performance", "calling_heatmap"]);
  });
});
