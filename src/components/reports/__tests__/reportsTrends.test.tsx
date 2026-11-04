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
import ReportTrends from "../ReportTrends";

describe("Trends and call outcomes (section 3)", () => {
  it("has one heading and one grouping control for its three fixed cards; Call outcomes spans the row", () => {
    const onGrouping = vi.fn();
    render(<ReportTrends grouping="daily" onGroupingChange={onGrouping} sections={{ policies_sold: <p>A</p>, call_volume: <p>B</p>, call_outcomes: <p>C</p> }} />);
    expect(screen.getAllByRole("heading", { name: "Trends and call outcomes" })).toHaveLength(1);
    expect(screen.getAllByRole("group", { name: "Group trends by" })).toHaveLength(1);
    expect([...document.querySelectorAll("[data-report-section]")].map(e => e.getAttribute("data-report-section"))).toEqual(["policies_sold", "call_volume", "call_outcomes"]);
    expect(document.querySelector("[data-report-section='call_outcomes']")?.className).toContain("xl:col-span-2");
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    expect(onGrouping).toHaveBeenCalledWith("weekly");
  });
  it("skips a card that was not built instead of leaving an empty cell", () => {
    render(<ReportTrends grouping="daily" onGroupingChange={() => undefined} sections={{ policies_sold: <p>A</p> }} />);
    expect(document.querySelectorAll("[data-report-section]")).toHaveLength(1);
  });
});
