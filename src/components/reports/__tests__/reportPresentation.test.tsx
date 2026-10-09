import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReportSection from "../ReportSection";
import SectionRenderer from "../SectionRenderer";
import StatCard from "../StatCard";

const sections = [
  { id: "stat_total_contacted", visible: true },
  { id: "stat_total_dials", visible: true },
  { id: "stat_top_performer", visible: true },
  { id: "campaign_performance", visible: true },
  { id: "agent_performance_cards", visible: true },
  { id: "lead_source_roi", visible: false },
  { id: "communications_stats", visible: true },
  { id: "calling_heatmap", visible: true },
  { id: "unknown_panel", visible: true },
];
const components = Object.fromEntries(sections.filter((s) => s.id !== "calling_heatmap").map((s) => [s.id, <span key={s.id}>{s.id}</span>]));

describe("report section layout", () => {
  it("renders only the requested group, retaining saved order and meaningful section IDs", () => {
    const { container } = render(<SectionRenderer sections={sections} components={components} showTeamSections group="stats" />);
    expect(Array.from(container.querySelectorAll("[data-report-section]"), (element) => element.getAttribute("data-report-section")))
      .toEqual(["stat_total_contacted", "stat_total_dials", "stat_top_performer"]);
    expect(screen.getByRole("group", { name: "Key metrics" })).toHaveAttribute("data-report-group", "stats");
    expect(screen.queryByText("campaign_performance")).not.toBeInTheDocument();
  });

  it("omits hidden, unregistered, absent and team-only content in Personal", () => {
    render(<SectionRenderer sections={sections} components={components} showTeamSections={false} />);
    expect(screen.getByText("campaign_performance")).toBeInTheDocument();
    expect(screen.getByText("communications_stats")).toBeInTheDocument();
    for (const id of ["stat_top_performer", "agent_performance_cards", "lead_source_roi", "unknown_panel", "calling_heatmap"]) {
      expect(screen.queryByText(id)).not.toBeInTheDocument();
    }
  });

  it.each([1, 2, 3, 4, 5, 6])("lays out %i visible metrics with no filler cell, every tile inside its section wrapper", (count) => {
    const ids = ["stat_total_dials", "stat_total_contacted", "stat_contact_rate", "stat_appointments_set", "stat_total_talk_time", "stat_session_time"].slice(0, count);
    const strip = ids.map((id) => ({ id, visible: true }));
    const tiles = Object.fromEntries(ids.map((id) => [id, <StatCard key={id} label={id} value="1" state="ready" />]));
    const { container } = render(<SectionRenderer sections={strip} components={tiles} showTeamSections={false} group="stats" />);
    const group = screen.getByRole("group", { name: "Key metrics" });
    const row = group.firstElementChild!;
    expect(group.children).toHaveLength(1);
    expect(Array.from(row.children, (cell) => cell.getAttribute("data-report-section"))).toEqual(ids); // nothing but the tiles
    expect(row.className).toContain("flex-wrap");
    for (const cell of Array.from(row.children)) expect(cell.querySelector("[data-stat-state]")).not.toBeNull();
    expect(container.querySelector(".bg-border\\/60, .gap-px")).toBeNull(); // the old grid-of-gaps filler
  });

  it("team-only metrics in Personal leave no gap behind", () => {
    const strip = [{ id: "stat_total_dials", visible: true }, { id: "stat_top_performer", visible: true }, { id: "stat_contact_rate", visible: true }];
    const tiles = Object.fromEntries(strip.map(({ id }) => [id, <StatCard key={id} label={id} value="1" state="ready" />]));
    render(<SectionRenderer sections={strip} components={tiles} showTeamSections={false} group="stats" />);
    const row = screen.getByRole("group", { name: "Key metrics" }).firstElementChild!;
    expect(Array.from(row.children, (cell) => cell.getAttribute("data-report-section"))).toEqual(["stat_total_dials", "stat_contact_rate"]);
  });

  it("titles the performance and diagnostics groups without subtitles; performance panels are full width", () => {
    render(<SectionRenderer sections={sections} components={components} showTeamSections />);
    const performance = screen.getByRole("group", { name: "Performance" });
    expect(within(performance).getByRole("heading", { level: 2, name: "Performance" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Dialer intelligence" })).getByRole("heading", { level: 2, name: "Dialer intelligence" })).toBeInTheDocument();
    expect(screen.queryByText("People, campaigns, and lead sources.")).not.toBeInTheDocument();
    expect(screen.queryByText("Call patterns and dialer activity.")).not.toBeInTheDocument();
    const grid = performance.querySelector("[data-report-section]")!.parentElement!;
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).not.toMatch(/lg:grid-cols-2/);
    for (const cell of Array.from(grid.children)) expect(cell.className).not.toMatch(/col-span/);
  });

  it("does not add empty layout groups", () => {
    const { container } = render(<SectionRenderer sections={[]} components={{}} showTeamSections />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("accessible report panels", () => {
  it("uses a separate export action and a toggle that controls its content", () => {
    const onExport = vi.fn();
    render(<ReportSection title="Call flow" onExport={onExport}><p>Panel contents</p></ReportSection>);
    const toggle = screen.getByRole("button", { name: "Call flow" });
    const contentId = toggle.getAttribute("aria-controls")!;
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(contentId)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Export Call flow CSV" }));
    expect(onExport).toHaveBeenCalledOnce();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(contentId)).not.toBeVisible();
    expect(screen.queryByText("Panel contents")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText("Panel contents")).toBeVisible();
  });

  it("gives repeated titles separate content IDs and supports initially closed panels", () => {
    render(<><ReportSection title="Details" defaultOpen={false}>First</ReportSection><ReportSection title="Details">Second</ReportSection></>);
    const toggles = screen.getAllByRole("button", { name: "Details" });
    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
    expect(toggles[0].getAttribute("aria-controls")).not.toBe(toggles[1].getAttribute("aria-controls"));
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CSV/ })).not.toBeInTheDocument();
  });
});

describe("metric strip values", () => {
  it("retains complete formatted values and unknown-coverage explanations", () => {
    render(<StatCard label="Exact premium example" value="$123,456,789.01" subtitle="Known for 17 policies; 3 policies have unknown premium." state="ready" />);
    expect(screen.getByText("$123,456,789.01")).toBeVisible();
    expect(screen.getByText("Known for 17 policies; 3 policies have unknown premium.")).toBeVisible();
  });

  it("keeps unavailable distinct from zero and suppresses the previous value during loading", () => {
    const { rerender } = render(<StatCard label="Session time" value="—" subtitle="Session attribution unavailable" state="unavailable" />);
    expect(screen.getByText("—")).toBeVisible();
    expect(screen.getByText("Session attribution unavailable")).toBeVisible();
    rerender(<StatCard label="Session time" value="2h 0m 0s" state="loading" />);
    expect(screen.queryByText("2h 0m 0s")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Loading Session time").parentElement).toHaveAttribute("aria-busy", "true");
  });

  it("marks a data-quality note with a caution dot and keeps the value", () => {
    render(<StatCard label="Talk time" value="28h 4m 3s" subtitle="Durations: 1,263 unknown source or amount · 484 conflicting" noteTone="caution" state="ready" />);
    const note = screen.getByText("Durations: 1,263 unknown source or amount · 484 conflicting").parentElement!;
    expect(note).toHaveAttribute("data-note-tone", "caution");
    expect(note.querySelector('span[aria-hidden="true"].bg-warning')).not.toBeNull();
    expect(screen.getByText("28h 4m 3s")).toBeVisible();
  });

  it.each(["error", "unavailable"] as const)("a %s reason reads as foreground text beside a destructive icon, with no digits", (state) => {
    const { container } = render(<StatCard label="Calls made" value="—" subtitle="Couldn't load — not a zero" state={state} />);
    const note = screen.getByText("Couldn't load — not a zero").parentElement!;
    expect(note).toHaveClass("text-foreground");
    expect(note).not.toHaveClass("text-destructive");
    expect(note.querySelector('svg[aria-hidden="true"].text-destructive')).not.toBeNull();
    expect(container.querySelector("[data-stat-state]")).toHaveAttribute("data-stat-state", state);
    expect(container.textContent).not.toMatch(/\d/);
  });
});
