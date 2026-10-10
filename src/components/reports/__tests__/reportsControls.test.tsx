import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReportScopeTabs from "../ReportScopeTabs";
import ReportsToolbar from "../ReportsToolbar";
import { reportScope, reportSummary } from "@/lib/__tests__/reportsFixtures";
import { installJsdomPolyfills } from "@/pages/__tests__/onboardingTestUtils";

installJsdomPolyfills(); // Radix Select probes pointer capture and scrollIntoView on open

const PERIOD_OPTIONS = ["Today", "Yesterday", "Last 7 days", "Last 30 days", "This month", "Last month", "Custom range"];
const periodSelect = () => screen.getByRole("combobox", { name: "Report period" });
const openPeriod = () => fireEvent.keyDown(periodSelect(), { key: "Enter" });

describe("Report scope tabs", () => {
  it("uses server scopes instead of deriving access from the role", () => {
    const onScope = vi.fn();
    render(<ReportScopeTabs scope={reportScope({ role: "Agent", requested_scope: "agency", available_scopes: ["personal", "agency"] })} onScope={onScope} />);
    expect(screen.getByRole("tab", { name: "Agency" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Personal" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Team" })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Personal" }), { button: 0, ctrlKey: false });
    expect(onScope).toHaveBeenCalledWith("personal");
  });

  it("moves keyboard focus without requesting a scope until activation", async () => {
    const onScope = vi.fn();
    render(<ReportScopeTabs scope={reportScope()} onScope={onScope} panelRendered />);
    const team = screen.getByRole("tab", { name: "Team" });
    const personal = screen.getByRole("tab", { name: "Personal" });
    act(() => team.focus());
    fireEvent.keyDown(team, { key: "ArrowLeft" });
    await waitFor(() => expect(personal).toHaveFocus());
    expect(onScope).not.toHaveBeenCalled();
    fireEvent.keyDown(personal, { key: "Enter" });
    expect(onScope).toHaveBeenCalledExactlyOnceWith("personal");
    expect(personal).toHaveAttribute("aria-controls", "reports-scope-panel");
  });

  it("points the tabs at the scope panel only while that panel renders (U-8)", () => {
    const { rerender } = render(<ReportScopeTabs scope={reportScope()} onScope={vi.fn()} />);
    for (const tab of screen.getAllByRole("tab")) expect(tab).not.toHaveAttribute("aria-controls");
    rerender(<ReportScopeTabs scope={reportScope()} onScope={vi.fn()} panelRendered />);
    for (const tab of screen.getAllByRole("tab")) expect(tab).toHaveAttribute("aria-controls", "reports-scope-panel");
  });

  it("holds the bar's place with a skeleton while the scope resolves, and offers no tab", () => {
    const { container, rerender } = render(<ReportScopeTabs scope={null} onScope={vi.fn()} loading />);
    expect(container.querySelector("[data-report-scope-skeleton]")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    rerender(<ReportScopeTabs scope={null} onScope={vi.fn()} />); // failed: no placeholder pretending to load
    expect(container.querySelector("[data-report-scope-skeleton]")).toBeNull();
    rerender(<ReportScopeTabs scope={reportScope()} onScope={vi.fn()} loading />);
    expect(container.querySelector("[data-report-scope-skeleton]")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("does not expose unresolved scopes or reactivate the current scope", () => {
    const onScope = vi.fn();
    const { rerender } = render(<ReportScopeTabs scope={null} onScope={onScope} />);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    rerender(<ReportScopeTabs scope={reportScope()} onScope={onScope} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Team" }), { button: 0, ctrlKey: false });
    expect(onScope).not.toHaveBeenCalled();
    rerender(<ReportScopeTabs scope={reportScope()} onScope={onScope} disabled />);
    expect(screen.getByRole("tab", { name: "Personal" })).toBeDisabled();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Personal" }), { button: 0, ctrlKey: false });
    expect(onScope).not.toHaveBeenCalled();
  });
});

const toolbarProps = (): React.ComponentProps<typeof ReportsToolbar> => ({
  scope: reportScope(), scopeStatusText: "Reports unavailable", onScope: vi.fn(),
  preset: "30d", onPreset: vi.fn(), customStart: null, customEnd: null,
  onCustomStart: vi.fn(), onCustomEnd: vi.fn(), range: { startDate: "2026-06-21", endDate: "2026-07-20" }, rangeProblem: null,
  agentId: null, onAgent: vi.fn(), editMode: false, onToggleEdit: vi.fn(), onRefresh: vi.fn(),
  canExport: true, exportReady: true, onExport: vi.fn(),
});

describe("Reports toolbar readiness", () => {
  it("keeps customization disabled until viewer preferences are ready", () => {
    const props = toolbarProps();
    const { rerender } = render(<ReportsToolbar {...props} />);
    expect(screen.getByRole("heading", { name: "Reports" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Customize layout" })).toBeDisabled();
    rerender(<ReportsToolbar {...props} customizationReady />);
    fireEvent.click(screen.getByRole("button", { name: "Customize layout" }));
    expect(props.onToggleEdit).toHaveBeenCalledOnce();
    expect(screen.getByTestId("report-period")).toHaveTextContent("Jun 21, 2026 – Jul 20, 2026");
    expect(screen.getByText(/America\/Los_Angeles/)).toBeInTheDocument();
  });

  it("withholds all scope-dependent controls when scope is unavailable", () => {
    render(<ReportsToolbar {...toolbarProps()} scope={null} range={null} preset="custom" canExport={false} customizationReady />);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
    for (const name of ["Customize layout", "Refresh reports", "Start Date", "End Date"])
      expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(periodSelect()).toBeDisabled();
    expect(screen.queryByRole("combobox", { name: "Agent filter" })).not.toBeInTheDocument();
    expect(screen.getByText("Reports unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Data basis" })).not.toBeInTheDocument();
  });

  it("keeps the action order and accessible names; phone labels stay in sr-only text", () => {
    render(<ReportsToolbar {...toolbarProps()} customizationReady />);
    const header = screen.getByRole("banner");
    const actions = within(header).getAllByRole("button").filter((b) => ["Customize layout", "Export", "Refresh reports"].includes(b.getAttribute("aria-label") ?? b.textContent ?? ""));
    expect(actions.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Customize layout", "Export", "Refresh reports"]);
    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(screen.queryByText("Production and the activity behind it.")).not.toBeInTheDocument();
    for (const label of ["Customize", "Export"]) expect(within(header).getByText(label)).toHaveClass("sr-only", "sm:not-sr-only");
    for (const b of actions) expect(b).toHaveClass("h-10", "w-10");
    expect(screen.getByRole("button", { name: "Refresh reports" })).toHaveClass("border"); // outline, no longer a ghost icon
  });

  it("marks the pressed Customize button with foreground text, not small primary text, and keeps it usable", () => {
    const props = toolbarProps();
    render(<ReportsToolbar {...props} customizationReady editMode />);
    const button = screen.getByRole("button", { name: "Customize layout" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveClass("text-foreground");
    expect(button).not.toHaveClass("text-primary");
    fireEvent.click(button); // the page wires this to cancel while editing
    expect(props.onToggleEdit).toHaveBeenCalledOnce();
  });
});

describe("Report period select", () => {
  it("offers the presets in a fixed order in sentence case and applies the chosen one", async () => {
    const props = toolbarProps();
    render(<ReportsToolbar {...props} />);
    expect(periodSelect()).toHaveTextContent("Last 30 days");
    expect(screen.queryByRole("group", { name: "Report period" })).not.toBeInTheDocument(); // the preset buttons are gone
    openPeriod();
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual(PERIOD_OPTIONS);
    fireEvent.click(within(listbox).getByRole("option", { name: "This month" }));
    expect(props.onPreset).toHaveBeenCalledExactlyOnceWith("month");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("shows the date pickers only for Custom range, without the inline 'Pick both dates' prompt", () => {
    const { rerender } = render(<ReportsToolbar {...toolbarProps()} />);
    expect(screen.queryByRole("button", { name: "Start Date" })).not.toBeInTheDocument();
    rerender(<ReportsToolbar {...toolbarProps()} preset="custom" range={null} />);
    expect(periodSelect()).toHaveTextContent("Custom range");
    expect(screen.getByRole("button", { name: "Start Date" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "End Date" })).toBeEnabled();
    expect(screen.queryByText(/Pick both dates/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-period")).not.toBeInTheDocument();
  });

  it.each([
    ["order", "End date must be on or after the start date."],
    ["too_long", "Choose a range of up to 90 days."],
  ] as const)("explains an invalid range (%s) in foreground text with a destructive icon", (problem, message) => {
    render(<ReportsToolbar {...toolbarProps()} scope={reportScope({ max_range_days: 90 })} preset="custom"
      customStart="2026-07-10" customEnd="2026-07-01" range={{ startDate: "2026-07-10", endDate: "2026-07-01" }} rangeProblem={problem} />);
    const text = screen.getByText(message);
    expect(text).toHaveClass("text-foreground");
    expect(text.className).not.toMatch(/amber/);
    expect(text.querySelector("svg")).toHaveClass("text-destructive");
    expect(screen.getByRole("button", { name: "Start Date" })).toHaveTextContent("Jul 10, 2026");
  });

  it("lays the period beside the agent filter, and across both phone columns in Personal scope", () => {
    const { rerender } = render(<ReportsToolbar {...toolbarProps()} />);
    expect(screen.getByRole("combobox", { name: "Agent filter" })).toHaveTextContent("Whole team");
    expect(periodSelect()).not.toHaveClass("col-span-2");
    rerender(<ReportsToolbar {...toolbarProps()} scope={reportScope({ scope: "own", requested_scope: "personal" })} />);
    expect(screen.queryByRole("combobox", { name: "Agent filter" })).not.toBeInTheDocument();
    expect(periodSelect()).toHaveClass("col-span-2");
  });
});

describe("Report context line", () => {
  it("shows period and zone, not the scope words; the as-of only when the page passes a current summary's", () => {
    const summary = reportSummary();
    const props = { ...toolbarProps(), dataBasis: { summary: { status: "ready" as const, data: summary }, timeZone: "America/Los_Angeles", today: "2026-07-20" } };
    const { rerender } = render(<ReportsToolbar {...props} />);
    expect(screen.queryByText(/Your team/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-as-of")).not.toBeInTheDocument();
    rerender(<ReportsToolbar {...props} asOf={summary.as_of} />);
    const asOf = screen.getByTestId("report-as-of");
    expect(asOf).toHaveTextContent("Summary as of 11:00 AM PDT");
    expect(asOf.querySelector("time")).toHaveAttribute("datetime", "2026-07-20T18:00:00Z");
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Data basis" })).toBeInTheDocument();
  });
});
