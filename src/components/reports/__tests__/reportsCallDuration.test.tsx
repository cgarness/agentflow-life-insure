/**
 * R-5: Call duration and the Call summary show the payload's 0.1 s averages as sent ("2m 32.5s"),
 * never rounded a second time ("2:33"). CSV rows keep the raw seconds.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReportDispositions } from "@/lib/reports-schemas";
import { reportDispositions, reportSummary } from "@/lib/__tests__/reportsFixtures";
import CallDurationAnalysis from "../CallDurationAnalysis";
import CommunicationsStats from "../CommunicationsStats";

type Row = Record<string, unknown>;
type TooltipFormatter = (v: number, name: string, item: { payload?: Row }) => [string, string];
const chart = vi.hoisted(() => ({
  data: [] as Row[],
  tooltip: [] as TooltipFormatter[],
  ticks: [] as Array<(v: number) => string>,
}));

// Capture the real component's formatters; SVG geometry belongs to the browser fixture.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  BarChart: ({ data, children }: { data: Row[]; children: React.ReactNode }) => {
    chart.data = data;
    return <div>{children}</div>;
  },
  CartesianGrid: () => null,
  YAxis: () => null,
  XAxis: ({ tickFormatter }: { tickFormatter?: (v: number) => string }) => {
    if (tickFormatter) chart.ticks.push(tickFormatter);
    return null;
  },
  Tooltip: ({ formatter }: { formatter?: TooltipFormatter }) => {
    if (formatter) chart.tooltip.push(formatter);
    return null;
  },
  Bar: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  LabelList: ({ dataKey, formatter }: { dataKey: string; formatter: (v: number) => string }) => (
    <ul aria-label="Bar labels">{chart.data.map((row, i) => <li key={i}>{formatter(row[dataKey] as number)}</li>)}</ul>
  ),
}));

function dispositions(): ReportDispositions {
  const base = reportDispositions();
  // The live Phase-1 shape: exact mean 152.487 s arrives as round(avg, 1) = 152.5 over 78 calls.
  return {
    ...base,
    total_calls: 98,
    by_disposition: [
      { ...base.by_disposition[0], name: "Interested", calls: 78, avg_duration_seconds: 152.5, converts: true },
      { ...base.by_disposition[1], name: "No Answer", calls: 20, avg_duration_seconds: 25.3, converts: false },
    ],
  };
}

beforeEach(() => { cleanup(); chart.data = []; chart.tooltip = []; chart.ticks = []; });

describe("Call duration (R-5)", () => {
  it("bar labels, tooltip and insight keep the payload's 0.1 s; never '2:33' or '2m 33s'", () => {
    const { container } = render(<CallDurationAnalysis dispositions={dispositions()} />);
    fireEvent.click(screen.getByRole("button", { name: "Call duration" }));

    const labels = screen.getByRole("list", { name: "Bar labels" });
    expect(Array.from(labels.querySelectorAll("li"), (li) => li.textContent)).toEqual(["2m 32.5s", "25.3s"]);

    const tooltip = chart.tooltip[chart.tooltip.length - 1]!;
    expect(tooltip(152.5, "Avg duration", { payload: chart.data[0] })).toEqual(["2m 32.5s across 78 calls", "Avg duration"]);
    expect(tooltip(25.3, "Avg duration", { payload: chart.data[1] })[0]).toBe("25.3s across 20 calls");

    expect(screen.getByText(
      "Calls with a converting disposition averaged 2m 32.5s, versus 25.3s for all other dispositions.",
    )).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/2:33|2m 33s|\b\d+:\d\d\b/);
  });

  it("x-axis ticks are whole seconds in the same elapsed format", () => {
    render(<CallDurationAnalysis dispositions={dispositions()} />);
    fireEvent.click(screen.getByRole("button", { name: "Call duration" }));
    const tick = chart.ticks[chart.ticks.length - 1]!;
    expect([0, 30, 60, 120, 150].map(tick)).toEqual(["0s", "30s", "1m 0s", "2m 0s", "2m 30s"]);
  });

  it("the CSV keeps the raw 0.1 s averages (unchanged rows)", () => {
    const onExport = vi.fn();
    render(<CallDurationAnalysis dispositions={dispositions()} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: "Export Call duration CSV" }));
    expect(onExport).toHaveBeenCalledWith(
      "Call Duration by Disposition",
      ["Disposition", "Calls", "Avg duration (s)"],
      [["Interested", 78, 152.5], ["No Answer", 20, 25.3]],
    );
  });
});

describe("Call summary durations", () => {
  // Call summary is collapsed by default (the metric strip already leads with these totals).
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Call summary" }));

  it("shows talk time in the elapsed format and the per-dial average at 0.1 s", () => {
    render(<CommunicationsStats summary={reportSummary()} dayCount={31} />);
    open();
    expect(screen.getByText("38.9s")).toBeInTheDocument(); // avg talk per dial, not "0:39"
    expect(screen.getByText("12m 20s")).toBeInTheDocument(); // 740 s talk time, not "0h 12m 20s"
    expect(screen.getByText("5m 40s")).toBeInTheDocument(); // 340 s inbound talk time
    expect(screen.queryByText("0:39")).not.toBeInTheDocument();
    expect(screen.queryByText(/^0h /)).not.toBeInTheDocument();
  });

  it("an unknown per-dial average is a dash, never 0s", () => {
    const summary = reportSummary({ avg_talk_per_dial_seconds: null });
    render(<CommunicationsStats summary={summary} dayCount={31} />);
    open();
    const tile = screen.getByText("Avg talk time per dial").closest("div")!;
    expect(tile).toHaveTextContent("—");
    expect(tile).not.toHaveTextContent(/\ds/);
  });

  it("the Call Summary CSV keeps raw seconds", () => {
    const onExport = vi.fn();
    render(<CommunicationsStats summary={reportSummary()} dayCount={31} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: "Export Call summary CSV" }));
    const rows = onExport.mock.calls[0]![2] as Array<[string, unknown]>;
    expect(rows).toContainEqual(["Talk time (seconds)", 740]);
    expect(rows).toContainEqual(["Avg talk time per dial (seconds)", 38.9]);
    expect(rows).toContainEqual(["Inbound talk time (seconds)", 340]);
  });
});
