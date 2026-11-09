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
import CampaignPerformance from "../CampaignPerformance";
import LeadSourceTable from "../LeadSourceTable";

describe("Campaign performance (call-only, D6-22)", () => {
  it("adds the two reconciliation rows so Calls made sums to KPI 5; Other campaigns shows no name or type (RL-49)", () => {
    const b = bundle(); const onExport = vi.fn();
    render(<CampaignPerformance campaigns={b.campaignsV3} onExport={onExport} />);
    const foot = document.querySelector("tfoot")!;
    expect(within(foot as HTMLElement).getByText("Calls without a campaign")).toBeTruthy();
    expect(within(foot as HTMLElement).getByText("Other campaigns")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /export campaign performance csv/i }));
    const rows = onExport.mock.calls[0][2] as unknown[][];
    expect(rows.reduce((s, r) => s + (r[2] as number), 0)).toBe(b.summaryV3.metrics[4].value);
    expect(rows.find(r => r[0] === "Other campaigns")?.[1]).toBeNull();
    expect(document.body.textContent).not.toMatch(/premium|polic|converted|leads dialed/i);
  });
  it("leaves the rate blank when a row has no calls", () => {
    const b = bundle(x => { x.campaignsV3.other_campaigns = { calls_made: 0, contacted_calls: 0, contact_rate_numerator: 0, contact_rate_denominator: 0 }; });
    render(<CampaignPerformance campaigns={b.campaignsV3} />);
    const other = screen.getByText("Other campaigns").closest("tr")!;
    expect(other.lastElementChild?.textContent).toBe("");
  });
});

describe("Lead sources (call-only)", () => {
  it("puts calls with no current lead in a footer row with a blank New leads cell; Calls made sums to KPI 5", () => {
    const b = bundle(); const onExport = vi.fn();
    render(<LeadSourceTable leadSources={b.leadSourcesV3} onExport={onExport} />);
    const row = screen.getByText("Not linked to a current lead").closest("tr")!;
    expect(row.children[1].textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /export lead sources csv/i }));
    expect((onExport.mock.calls[0][2] as unknown[][]).reduce((s, r) => s + (r[2] as number), 0)).toBe(200);
  });
});
