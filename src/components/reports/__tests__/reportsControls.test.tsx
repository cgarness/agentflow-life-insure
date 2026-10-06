import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReportScopeTabs from "../ReportScopeTabs";
import ReportsToolbar from "../ReportsToolbar";
import { reportScope } from "@/lib/__tests__/reportsFixtures";

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
    render(<ReportScopeTabs scope={reportScope()} onScope={onScope} />);
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
    for (const name of ["Customize layout", "Refresh reports", "Start Date", "End Date", "Today"])
      expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.queryByRole("combobox", { name: "Agent filter" })).not.toBeInTheDocument();
  });
});
