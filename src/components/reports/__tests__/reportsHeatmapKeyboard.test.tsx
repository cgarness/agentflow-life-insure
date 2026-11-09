import React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CallingHeatmap from "../CallingHeatmap";
import { buildV3Bundle } from "@/lib/__tests__/reportsV3Fixtures";

const volume = () => buildV3Bundle({ requestedScope: "agency", startDate: "2026-07-01", endDate: "2026-07-14" }).volumeV3;

describe("Calling heatmap keyboard grid (D6 §4.7)", () => {
  it("is one role=grid with a single tab stop; arrows, Home/End and PageUp/PageDown move focus", () => {
    render(<CallingHeatmap volume={volume()} />);
    expect(screen.getByRole("grid")).toBeTruthy();
    const stops = screen.getAllByRole("gridcell").filter(c => c.tabIndex === 0);
    expect(stops).toHaveLength(1);
    stops[0].focus();
    fireEvent.keyDown(stops[0], { key: "ArrowRight" });
    expect(screen.getAllByRole("gridcell").indexOf(document.activeElement as HTMLElement)).toBe(1);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    fireEvent.keyDown(document.activeElement!, { key: "PageDown" });
    const cells = screen.getAllByRole("gridcell");
    expect(cells.indexOf(document.activeElement as HTMLElement)).toBe(cells.length - 1);
  });
  it("Enter pins a cell and the status line reads it with the rate rounded once; Escape clears the pin", () => {
    render(<CallingHeatmap volume={volume()} />);
    const monday10 = screen.getAllByRole("gridcell").find(c => c.textContent?.includes("120"))!;
    monday10.focus(); fireEvent.keyDown(monday10, { key: "Enter" });
    expect(monday10.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Mon 10 AM · 120 calls made · 30 contacted · 25.0% call contact rate");
    fireEvent.keyDown(monday10, { key: "Escape" });
    expect(monday10.getAttribute("aria-selected")).toBe("false");
  });
});
