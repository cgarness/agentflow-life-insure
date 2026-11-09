/**
 * Regional performance (D5 §4, §8): the default metric, the lazily loaded map with its keyboard and selection, the
 * accessible table, the export control, and the load boundary ("Map couldn't load." switches to Table).
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { reportStateBreakdownV3Schema } from "@/lib/reports-v3-schemas";
import { buildV3Bundle } from "@/lib/__tests__/reportsV3Fixtures";
import RegionalPerformance from "../regional/RegionalPerformance";

const states = () => reportStateBreakdownV3Schema.parse(
  buildV3Bundle({ requestedScope: "agency", startDate: "2026-06-16", endDate: "2026-07-15", agentId: null }).statesV3);

describe("Regional performance", () => {
  it("defaults to Calls made and loads the map lazily as 51 named toggle buttons with one tab stop", async () => {
    render(<RegionalPerformance data={states()} />);
    expect(within(screen.getByRole("group", { name: "Map metric" })).getByRole("button", { name: "Calls made" })).toHaveAttribute("aria-pressed", "true");
    const map = await screen.findByRole("group", { name: "Map of states" });
    const paths = within(map).getAllByRole("button");
    expect(paths).toHaveLength(51);
    expect(paths.filter(p => p.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(within(map).getByRole("button", { name: "California, 150 calls made" })).toBeInTheDocument();
  });

  it("selects a state by keyboard and clears it with Escape; the small states have their own buttons", async () => {
    render(<RegionalPerformance data={states()} />);
    const map = await screen.findByRole("group", { name: "Map of states" });
    const ca = within(map).getByRole("button", { name: "California, 150 calls made" });
    ca.focus(); fireEvent.keyDown(ca, { key: "Enter" });
    expect(ca).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    fireEvent.keyDown(ca, { key: "Escape" });
    expect(ca).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Small states").querySelectorAll("button").length).toBeGreaterThanOrEqual(9);
  });

  it("the table view has 51 sortable rows and fixed Mapped total, Unmapped and Total footers", async () => {
    render(<RegionalPerformance data={states()} />);
    fireEvent.click(within(screen.getByRole("group", { name: "View" })).getByRole("button", { name: "Table" }));
    const table = screen.getByRole("table");
    const [, body, foot] = within(table).getAllByRole("rowgroup");
    expect(within(body).getAllByRole("row")).toHaveLength(51);
    expect(within(foot).getAllByRole("row").map(r => within(r).getByRole("rowheader").textContent)).toEqual(
      ["Mapped total", expect.stringContaining("Unmapped"), "Total"]);
    expect(within(body).getAllByRole("row")[0]).toHaveTextContent("California");
    const header = within(table).getByRole("columnheader", { name: "Calls made" });
    expect(header).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(within(foot).getAllByRole("row")[2]).toHaveTextContent("200");
  });

  it("shows the export control only when an exporter is given", () => {
    const { rerender } = render(<RegionalPerformance data={states()} />);
    expect(screen.queryByRole("button", { name: "Export Regional performance CSV" })).toBeNull();
    const onExport = vi.fn();
    rerender(<RegionalPerformance data={states()} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: "Export Regional performance CSV" }));
    expect(onExport).toHaveBeenCalledOnce();
  });
});

describe("Regional performance map load boundary", () => {
  it("a map chunk that fails to load says so and switches to the table", async () => {
    vi.resetModules();
    vi.doMock("@/components/reports/regional/StateMap", () => { throw new Error("chunk failed"); });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { default: Regional } = await import("@/components/reports/regional/RegionalPerformance");
      render(<Regional data={states()} />);
      expect(await screen.findByRole("table")).toBeInTheDocument();
      expect(within(screen.getByRole("group", { name: "View" })).getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
    } finally { quiet.mockRestore(); vi.doUnmock("@/components/reports/regional/StateMap"); }
  });
});
