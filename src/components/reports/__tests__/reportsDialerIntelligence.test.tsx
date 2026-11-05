import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { buildV3Bundle, T_SELF, T_PEER } from "@/lib/__tests__/reportsV3Fixtures";
import { reportDispositionsV3Schema } from "@/lib/reports-v3-schemas";
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div className="h-[300px] w-[600px]">{children}</div> };
});
const bundle = (patch?: (b: Record<string, any>) => void) => { const b = buildV3Bundle({ requestedScope: "agency", startDate: "2026-07-01", endDate: "2026-07-14" }); patch?.(b); return b; };
const ready = <T,>(data: T) => ({ status: "ready" as const, data });
import DispositionsPieChart from "../DispositionsPieChart";
import CallingHeatmap from "../CallingHeatmap";
import CallFlowAnalysis from "../CallFlowAnalysis";
import DispositionDeepDive from "../DispositionDeepDive";
import { PanelSlot } from "../reportSectionMap";

describe("Call outcomes (v3 disposition reader)", () => {
  it("names every outcome in text with its count, including No outcome recorded; colour is only a swatch", () => {
    render(<DispositionsPieChart dispositions={bundle().dispositionsV3} />);
    expect(screen.getByText("Call outcomes")).toBeTruthy();
    expect(screen.getByText("Interested")).toBeTruthy();
    expect(screen.getByText("No outcome recorded")).toBeTruthy();
    expect(document.body.textContent).toContain("150");
  });
  it("with no confirmed attempts shows the empty state, not a zero total", () => {
    render(<DispositionsPieChart dispositions={bundle(b => { b.dispositionsV3.call_population.attempts = 0; b.dispositionsV3.by_disposition = []; }).dispositionsV3} />);
    expect(document.body.textContent).not.toMatch(/\b0 calls\b/);
  });
});

describe("Calling heatmap (v3 call-volume reader)", () => {
  it("has hour column headers, day row headers and values in the cell text; the metric toggle uses aria-pressed", () => {
    render(<CallingHeatmap volume={bundle().volumeV3} />);
    expect(screen.getAllByText("Mon").length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("120");
    const rate = screen.getByRole("button", { name: "Call contact rate" });
    fireEvent.click(rate);
    expect(rate.getAttribute("aria-pressed")).toBe("true");
  });
  it("widens to all 24 hours when calls fall outside 6 AM–9 PM", () => {
    const b = bundle(x => { x.volumeV3.heatmap[2] = { dow: 0, hour: 2, calls_made: 1, contacted: 0 }; x.volumeV3.heatmap[34].calls_made = 119; });
    render(<CallingHeatmap volume={b.volumeV3} />);
    expect(screen.getAllByText("2 AM").length).toBeGreaterThan(0);
  });
});

describe("Call flow and deep dive", () => {
  it("call flow names weekdays from the reader's dow (v3 has no dow_name)", () => {
    const onExport = vi.fn();
    render(<CallFlowAnalysis volume={bundle().volumeV3} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /^call flow$/i }));
    fireEvent.click(screen.getByRole("button", { name: "By day" }));
    fireEvent.click(screen.getByRole("button", { name: /export call flow csv/i }));
    const labels = onExport.mock.calls.flatMap(c => (c[2] as unknown[][]).map(r => r[0]));
    expect(labels).toEqual(expect.arrayContaining(["Monday", "Tuesday"]));
  });
  it("draws an outcome without a configured colour in the neutral colour and names every series", () => {
    render(<DispositionDeepDive dispositions={bundle().dispositionsV3} />);
    fireEvent.click(screen.getByRole("button", { name: /disposition deep dive/i }));
    expect(screen.getAllByText("No outcome recorded").length).toBeGreaterThan(0);
  });
  it("a failed panel reads as an error with Retry and the not-a-zero copy, with no digits", () => {
    const retry = vi.fn();
    render(<PanelSlot title="Call outcomes" state={{ status: "error", kind: "unavailable" }} onRetry={retry}>{() => <p>never</p>}</PanelSlot>);
    expect(screen.getByRole("alert").textContent).toContain("This is not a zero");
    expect(screen.getByRole("alert").textContent).not.toMatch(/\d/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });
});

describe("Disposition deep dive at team and personal scope (unattributed breakdown is agency-only)", () => {
  const scoped = (requestedScope: "agency" | "team" | "personal", patch?: (d: Record<string, any>) => void) => {
    const d = buildV3Bundle({ requestedScope, startDate: "2026-07-01", endDate: "2026-07-14" }).dispositionsV3;
    patch?.(d);
    return d;
  };
  const openCampaigns = () => {
    fireEvent.click(screen.getByRole("button", { name: /disposition deep dive/i }));
    fireEvent.click(screen.getByRole("button", { name: "By campaign" }));
  };
  it.each(["team", "personal"] as const)("the %s payload (unattributed null) parses through the v3 contract", (scope) => {
    expect(scoped(scope).deep_dive.unattributed).toBeNull();
    expect(reportDispositionsV3Schema.safeParse(scoped(scope)).success).toBe(true);
  });
  it("agency: the attribution note counts restricted-campaign and unattributed calls", () => {
    render(<DispositionDeepDive dispositions={scoped("agency", d => { d.deep_dive.other_campaigns.total = 20; d.deep_dive.unattributed.total = 5; })} />);
    openCampaigns();
    expect(screen.getByText(/25 calls have unavailable campaign attribution/)).toBeTruthy();
  });
  it("team: without the agency-only breakdown the note counts only the scope's own restricted-campaign calls", () => {
    render(<DispositionDeepDive dispositions={scoped("team", d => { d.deep_dive.other_campaigns.total = 20; })} />);
    openCampaigns();
    expect(screen.getByText(/20 calls have unavailable campaign attribution/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/);
  });
  it("personal: no restricted-campaign calls and no unattributed breakdown shows no note and no zero claim", () => {
    render(<DispositionDeepDive dispositions={scoped("personal")} />);
    openCampaigns();
    expect(screen.queryByText(/unavailable campaign attribution/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null|\b0 calls have/);
  });
});

