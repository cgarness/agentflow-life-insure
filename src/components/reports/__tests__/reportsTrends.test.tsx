import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Grouping } from "@/lib/reports-format";
import type { ReportVolume } from "@/lib/reports-schemas";
import { reportVolume } from "@/lib/__tests__/reportsFixtures";
import ReportTrends from "../ReportTrends";
import PoliciesSoldChart from "../PoliciesSoldChart";
import CallVolumeChart from "../CallVolumeChart";

// Each chart exposes the bucket labels it was given and its sync id, so the test can see that one control
// regroups every trend panel (SVG geometry belongs to the browser fixture).
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ComposedChart: ({ data, syncId, children }: { data: Array<{ label: string }>; syncId?: string; children: React.ReactNode }) => (
    <div data-testid="trend-chart" data-sync={syncId} data-labels={data.map((row) => row.label).join("|")}>{children}</div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: ({ yAxisId }: { yAxisId: string }) => <div data-testid={`axis-${yAxisId}`} />,
  Bar: () => null,
  Line: () => null,
  Tooltip: () => null,
}));

afterEach(cleanup);

function Harness({ volume, withCalling = true }: { volume: ReportVolume; withCalling?: boolean }) {
  const [grouping, setGrouping] = useState<Grouping>("daily");
  const sections: Record<string, React.ReactNode> = {
    policies_sold: <PoliciesSoldChart volume={volume} grouping={grouping} />,
    ...(withCalling ? { call_volume: <CallVolumeChart volume={volume} grouping={grouping} /> } : {}),
  };
  return <ReportTrends sections={sections} grouping={grouping} onGroupingChange={setGrouping} />;
}

const trends = () => screen.getByRole("region", { name: "Trends" });
const labelsOf = () => screen.getAllByTestId("trend-chart").map((chart) => chart.getAttribute("data-labels"));
const pressed = () => within(screen.getByRole("group", { name: "Group trends by" })).getAllByRole("button")
  .filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.textContent);

describe("Trends", () => {
  it("has one heading and one grouping control, outside both trend cards", () => {
    render(<Harness volume={reportVolume()} />);
    expect(screen.getByRole("heading", { level: 2, name: "Trends" })).toHaveAttribute("id", "report-trends-title");
    expect(trends()).toHaveAttribute("data-report-group", "trends");
    expect(screen.getAllByRole("group")).toHaveLength(1);
    const control = screen.getByRole("group", { name: "Group trends by" });
    expect(within(control).getAllByRole("button").map((b) => [b.textContent, b.getAttribute("aria-pressed")]))
      .toEqual([["Daily", "true"], ["Weekly", "false"], ["Monthly", "false"]]);
    const cards = Array.from(trends().querySelectorAll("[data-report-section]"));
    expect(cards.map((card) => card.getAttribute("data-report-section"))).toEqual(["policies_sold", "call_volume"]);
    for (const card of cards) expect(card.contains(control)).toBe(false);
  });

  it("regroups both cards' stacked panels together and moves aria-pressed", () => {
    render(<Harness volume={reportVolume()} />);
    const charts = screen.getAllByTestId("trend-chart");
    expect(charts).toHaveLength(4); // two single-axis panels per card
    expect(charts.every((chart) => chart.getAttribute("data-sync") === "report-trends")).toBe(true);
    expect(new Set(labelsOf()).size).toBe(1);
    expect(labelsOf()[0]?.split("|")).toHaveLength(31);

    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    expect(pressed()).toEqual(["Weekly"]);
    expect(new Set(labelsOf())).toEqual(new Set(["Jul 01 – Jul 05|Week of Jul 06|Week of Jul 13|Week of Jul 20|Jul 27 – Jul 31"]));

    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(pressed()).toEqual(["Monthly"]);
    expect(new Set(labelsOf())).toEqual(new Set(["Jul 2026"]));
    expect(screen.getAllByTestId("trend-chart")).toHaveLength(4);
  });

  it("keeps each panel on its own single axis", () => {
    render(<Harness volume={reportVolume()} />);
    const [production, calling] = Array.from(trends().querySelectorAll<HTMLElement>("[data-report-section]"));
    expect(within(production).getAllByTestId(/^axis-/).map((a) => a.dataset.testid)).toEqual(["axis-policies", "axis-premium"]);
    expect(within(calling).getAllByTestId(/^axis-/).map((a) => a.dataset.testid)).toEqual(["axis-calls", "axis-rate"]);
  });

  it("renders the production card alone when no calling section was built", () => {
    render(<Harness volume={reportVolume()} withCalling={false} />);
    expect(Array.from(trends().querySelectorAll("[data-report-section]")).map((card) => card.getAttribute("data-report-section"))).toEqual(["policies_sold"]);
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(labelsOf()).toEqual(["Jul 2026", "Jul 2026"]);
  });
});
