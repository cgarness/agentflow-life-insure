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
import CallDurationAnalysis from "../CallDurationAnalysis";

describe("Call duration (v3)", () => {
  it("averages each outcome from its exact total seconds and calls, and keeps no insight sentence (A-L2)", () => {
    const onExport = vi.fn();
    render(<CallDurationAnalysis dispositions={bundle().dispositionsV3} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /^call duration$/i }));
    expect(document.body.textContent).not.toMatch(/averaged .* versus/);
    fireEvent.click(screen.getByRole("button", { name: /export call duration csv/i }));
    const rows = onExport.mock.calls[0][2] as unknown[][];
    expect(rows.find(r => r[0] === "Interested")?.[2]).toBe(20);
    expect(rows.find(r => r[0] === "No outcome recorded")?.[2]).toBe(12);
  });
});
