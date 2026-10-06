import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AgentPerformanceCards from "../AgentPerformanceCards";
import { AGENT_A, premium, reportSummary } from "@/lib/__tests__/reportsFixtures";

describe("Agent performance table", () => {
  it("only permits authorized agent filters and toggles the selected agent off", () => {
    const summary = reportSummary();
    const onSelectAgent = vi.fn();
    const props = { summary, selectableAgentIds: new Set([AGENT_A]), onSelectAgent };
    const { rerender } = render(<AgentPerformanceCards {...props} selectedAgentId={null} />);
    expect(screen.getByRole("region", { name: "Agent performance table" })).toHaveAttribute("tabindex", "0");
    expect(screen.queryByRole("button", { name: /Bob Agent/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filter reports to Alice Agent" }));
    expect(onSelectAgent).toHaveBeenLastCalledWith(AGENT_A);
    rerender(<AgentPerformanceCards {...props} selectedAgentId={AGENT_A} />);
    const selected = screen.getByRole("button", { name: "Clear agent filter for Alice Agent" });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(selected);
    expect(onSelectAgent).toHaveBeenLastCalledWith(null);
  });

  it("preserves unknown premium, true zero, coverage and full seconds", () => {
    const summary = reportSummary();
    summary.by_agent[0].premium = premium(1, 0);
    summary.by_agent[1].premium = premium(2, 2, 0);
    render(<AgentPerformanceCards summary={summary} selectedAgentId={null} selectableAgentIds={new Set()} onSelectAgent={vi.fn()} />);
    const alice = screen.getByRole("row", { name: /Alice Agent/ });
    expect(within(alice).getByText("0/1 known · 1 unknown")).toBeInTheDocument();
    expect(within(alice).getByText("—")).toBeInTheDocument();
    expect(within(alice).getByText("0h 4m 24s")).toBeInTheDocument();
    const bob = screen.getByRole("row", { name: /Bob Agent/ });
    expect(within(bob).getByText("$0.00")).toBeInTheDocument();
    expect(within(bob).getByText("2/2 known")).toBeInTheDocument();
  });

  it("retains exact CSV columns and non-identifying unattributed values", () => {
    const summary = reportSummary();
    summary.by_agent[0].premium = premium(1, 1, 100.01);
    summary.unattributed.premium = premium(1, 0);
    const onExport = vi.fn();
    render(<AgentPerformanceCards summary={summary} selectedAgentId={null} selectableAgentIds={new Set()} onSelectAgent={vi.fn()} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /CSV/i }));
    const [report, headers, rows] = onExport.mock.calls[0];
    expect(report).toBe("Agent Performance");
    expect(headers).toEqual(["Agent", "Status", "Calls made", "Contacted", "Call contact rate %", "Talk time (s)", "Policies (current assignment)", "Converted", "Bookings created (all types)", "Session time (s)", "Known annual premium", "Policies with known premium", "Policies with unknown premium"]);
    expect(rows[0][5]).toBe(264);
    expect(rows[0][10]).toBe(summary.by_agent[0].premium.annual_premium);
    expect(rows.at(-1)).toEqual(["Unattributed", null, 0, null, null, 0, 1, null, 1, null, null, 0, 1]);
    expect(screen.getByRole("row", { name: /Unattributed/ })).toHaveTextContent("0/1 known · 1 unknown");
  });
});
