import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { buildV3Bundle, T_SELF, T_PEER } from "@/lib/__tests__/reportsV3Fixtures";
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div className="h-[300px] w-[600px]">{children}</div> };
});
const bundle = (patch?: (b: Record<string, any>) => void) => { const b = buildV3Bundle({ requestedScope: "agency", startDate: "2026-07-01", endDate: "2026-07-14" }); patch?.(b); return b; };
const ready = <T,>(data: T) => ({ status: "ready" as const, data });
import AgentPerformanceCards from "../AgentPerformanceCards";

const panels = (b: Record<string, any>, journey: unknown = ready(b.journeyV3)) => ({
  summary: ready(b.summaryV3), journey, salesAppointments: ready(b.salesAppointmentsV3), states: ready(b.statesV3),
  volume: ready(b.volumeV3), dispositions: ready(b.dispositionsV3), campaigns: ready(b.campaignsV3), leadSources: ready(b.leadSourcesV3),
}) as never;

describe("Agent performance (v3 join)", () => {
  it("joins the three readers on agent_id in server order, with the D6 columns and the viewer's row marked You", () => {
    render(<AgentPerformanceCards panels={panels(bundle())} viewerId={T_SELF} agencyScope />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain("Avery Self"); expect(rows[0].textContent).toContain("You");
    expect(rows[1].textContent).toContain("Blake Peer");
    for (const h of ["Policies sold", "Annual premium (AP)", "Calls", "Contacted calls", "Call contact rate", "Calls per policy", "Sales appointments per policy", "1 Call Close", "Total talk time"]) {
      expect(screen.getByRole("columnheader", { name: h })).toBeTruthy();
    }
    expect(rows[0].textContent).toContain("$4,000.50");
  });
  it("a missing panel's cells read not loaded, never 0", () => {
    render(<AgentPerformanceCards panels={panels(bundle(), { status: "error", kind: "unavailable" })} viewerId={T_SELF} agencyScope />);
    expect(screen.getAllByText("not loaded").length).toBeGreaterThan(0);
  });
  it("has no total row built from agent rows; the agency Unattributed row appears only when there is something unattributed", () => {
    const b = bundle(x => { x.summaryV3.metrics[1].detail.quality.unattributed_policies = 2; x.summaryV3.metrics[0].detail.unattributed_annual_premium = 500.25; });
    const { rerender } = render(<AgentPerformanceCards panels={panels(bundle())} viewerId={T_PEER} agencyScope />);
    expect(screen.queryByText("Unattributed")).toBeNull();
    rerender(<AgentPerformanceCards panels={panels(b)} viewerId={T_PEER} agencyScope />);
    expect(screen.getByText("Unattributed")).toBeTruthy();
    expect(document.body.textContent).toContain("$500.25");
    expect(screen.queryByText(/^Total$/)).toBeNull();
  });
});
