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
// It also exposes the svg's name, focusability and desc, and forwards a mouse move as recharts reports an
// active index (the keyboard layer reports arrow keys the same way).
type ChartProps = {
  data: Array<{ label: string }>; syncId?: string; children: React.ReactNode; accessibilityLayer?: boolean; desc?: string;
  "aria-label"?: string; onMouseMove?: (state: { activeTooltipIndex?: number }) => void; onMouseLeave?: () => void;
};
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ComposedChart: ({ data, syncId, children, accessibilityLayer, desc, onMouseMove, onMouseLeave, ...rest }: ChartProps) => (
    <div data-testid="trend-chart" data-sync={syncId} data-labels={data.map((row) => row.label).join("|")}
      data-name={rest["aria-label"]} data-focusable={String(!!accessibilityLayer)} data-desc={desc}
      onMouseMove={(event) => onMouseMove?.({ activeTooltipIndex: Number((event.target as HTMLElement).dataset.index ?? 0) })}
      onMouseLeave={() => onMouseLeave?.()}>{children}</div>
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

  it("names every panel; only each card's main panel is a tab stop, and it speaks the active period", () => {
    render(<Harness volume={reportVolume()} />);
    const charts = screen.getAllByTestId("trend-chart");
    expect(charts.map((c) => [c.dataset.name, c.dataset.focusable])).toEqual([
      ["Policies sold by day", "true"], ["Known annual premium by day", "false"],
      ["Outbound calls by day", "true"], ["Call contact rate by day", "false"],
    ]);
    for (const chart of charts.filter((c) => c.dataset.focusable === "true")) expect(chart.dataset.desc).toBe("Use the left and right arrow keys to move between periods.");
    const [production, calling] = Array.from(trends().querySelectorAll<HTMLElement>("[data-report-section]"));
    const readout = (card: HTMLElement) => within(card).getByRole("status");
    for (const card of [production, calling]) {
      expect(readout(card)).toHaveAttribute("aria-live", "polite");
      expect(readout(card)).toHaveClass("sr-only");
      expect(readout(card).textContent).toBe(""); // nothing active yet
    }
    const point = (chart: HTMLElement, index: number) => { chart.dataset.index = String(index); fireEvent.mouseMove(chart); };
    point(charts[0], 14);
    expect(readout(production).textContent).toBe("2026-07-15: 2 policies sold; known annual premium $0.00; 2 of 2 policies known, 0 unknown.");
    point(charts[2], 9);
    expect(readout(calling).textContent).toBe("2026-07-10: 2 outbound calls, 1 contacted, call contact rate 50.0%; 0 inbound.");
    point(charts[2], 0);
    expect(readout(calling).textContent).toBe("2026-07-01: 0 outbound calls, 0 contacted, call contact rate unavailable; 0 inbound.");
    fireEvent.mouseLeave(charts[2]);
    expect(readout(calling).textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    expect(screen.getAllByTestId("trend-chart").map((c) => c.dataset.name)).toEqual(["Policies sold by week", "Known annual premium by week", "Outbound calls by week", "Call contact rate by week"]);
  });

  it("renders the production card alone when no calling section was built", () => {
    render(<Harness volume={reportVolume()} withCalling={false} />);
    expect(Array.from(trends().querySelectorAll("[data-report-section]")).map((card) => card.getAttribute("data-report-section"))).toEqual(["policies_sold"]);
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(labelsOf()).toEqual(["Jul 2026", "Jul 2026"]);
  });
});
