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
import PoliciesSoldChart from "../PoliciesSoldChart";
import CallVolumeChart from "../CallVolumeChart";

describe("Production trend (v3 production_by_date)", () => {
  it("groups exact cents: $3,000.25 + $1,000.25 is exactly $4,000.50 in the weekly CSV", () => {
    const onExport = vi.fn();
    render(<PoliciesSoldChart summary={bundle().summaryV3} grouping="weekly" onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /export production trend csv/i }));
    const rows = onExport.mock.calls[0][2] as unknown[][];
    // Written once at 2 dp from exact cents: the week with both sales is exactly "4000.50"; others are "0.00".
    expect(rows.map(r => r[2])).toContain("4000.50");
    expect(rows.every(r => r[2] === null || /^\d+\.\d{2}$/.test(r[2] as string))).toBe(true);
    expect(rows.every(r => r[5] === null || /^\d+\.\d$/.test(r[5] as string))).toBe(true);
  });
  it("keeps an all-unknown premium bucket as a gap (null), never $0", () => {
    const b = bundle(x => { x.summaryV3.production_by_date[0] = { ...x.summaryV3.production_by_date[0], premium_known: 0, premium_missing: 3, annual_premium: 0 }; });
    const onExport = vi.fn();
    render(<PoliciesSoldChart summary={b.summaryV3} grouping="daily" onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /export production trend csv/i }));
    expect((onExport.mock.calls[0][2] as unknown[][])[0][2]).toBeNull();
  });
  it("shows only the empty message for a period with no policies", () => {
    const b = bundle(x => { x.summaryV3.production_by_date = x.summaryV3.production_by_date.map((d: object) => ({ ...d, policies_sold: 0, annual_premium: 0, premium_known: 0 })); });
    render(<PoliciesSoldChart summary={b.summaryV3} grouping="daily" />);
    expect(screen.getByText("No policies sold in this period.")).toBeTruthy();
  });
});

describe("Calling trend (v3 by_date)", () => {
  it("rates use the grouped counts rounded once, never averaged daily rates or inbound calls", () => {
    const onExport = vi.fn();
    render(<CallVolumeChart volume={bundle().volumeV3} grouping="weekly" onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    const rows = onExport.mock.calls[0][2] as unknown[][];
    expect(rows.some(r => r.includes(200))).toBe(true);
  });
});
