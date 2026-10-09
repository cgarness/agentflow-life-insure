import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReportPremium, ReportVolume } from "@/lib/reports-schemas";
import { premium, reportVolume } from "@/lib/__tests__/reportsFixtures";
import PoliciesSoldChart from "../PoliciesSoldChart";
import CallVolumeChart from "../CallVolumeChart";
import { partialDot, rateAxisMax } from "../reportChartTheme";

const chart = vi.hoisted(() => ({ data: [] as Record<string, unknown>[], tooltipIndex: 0 }));

// Inspect the real components' transformed data, tooltip content and exported cells. Actual SVG
// geometry/responsiveness belongs to the native-backed browser fixture, not this jsdom harness. Both
// stacked panels render the same series; only the main panel carries a readout (the companion's
// NoTooltip renders nothing), so each tooltip string appears once.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ComposedChart: ({ data, children }: { data: Record<string, unknown>[]; children: React.ReactNode }) => {
    chart.data = data;
    return <div>{children}</div>;
  },
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: ({ yAxisId, domain }: { yAxisId: string; domain?: number[] }) => <div data-testid={`axis-${yAxisId}`} data-domain={JSON.stringify(domain)} />,
  Bar: ({ dataKey, yAxisId }: { dataKey: string; yAxisId: string }) => <div data-testid={`bar-${dataKey}`} data-axis={yAxisId} />,
  Line: ({ dataKey, yAxisId, connectNulls }: { dataKey: string; yAxisId: string; connectNulls: boolean }) => <div data-testid={`line-${dataKey}`} data-axis={yAxisId} data-connect-nulls={String(connectNulls)} />,
  Tooltip: ({ content }: { content: React.ReactElement }) => React.cloneElement(content, {
    active: true, payload: [{ payload: chart.data[chart.tooltipIndex] }],
  }),
}));

function daily(date: string, p: ReportPremium, calls = 0, contacted = 0, inbound = 0): ReportVolume["by_date"][number] {
  return { date, premium: p, policies_sold: p.policy_count, calls_made: calls, contacted, inbound_calls: inbound, talk_time_seconds: 0 };
}

function volumeWith(rows: ReportVolume["by_date"]): ReportVolume {
  return { ...reportVolume(), by_date: rows };
}

beforeEach(() => { cleanup(); chart.data = []; chart.tooltipIndex = 0; });

describe("Production trend", () => {
  it("groups precise known cents and policy coverage while preserving a clipped agency week", () => {
    const onExport = vi.fn();
    const volume = volumeWith([
      daily("2026-07-01", { ...premium(2, 1), annual_premium: 0.1 }),
      daily("2026-07-02", { ...premium(1, 1), annual_premium: 0.2 }),
      daily("2026-07-03", premium(1, 0)),
    ]);
    render(<PoliciesSoldChart volume={volume} grouping="weekly" onExport={onExport} />);
    expect(chart.data).toHaveLength(1);
    expect(chart.data[0]).toMatchObject({ label: "Jul 01 – Jul 03", policies_sold: 4, annual_premium: 0.3, known_count: 2, unknown_count: 2, coverage_pct: 50, partial: true });
    expect(screen.getByText("$0.30")).toBeInTheDocument();
    expect(screen.getByText("2 of 4 policies known · 2 unknown")).toBeInTheDocument(); // tooltip, once
    expect(screen.getByText("2 of 4 premiums known · 2 unknown")).toBeInTheDocument(); // header meta
    expect(screen.getByText("Some premiums unknown")).toBeInTheDocument();
    expect(screen.queryByText(/Gap = known premium unavailable/)).not.toBeInTheDocument();
    expect(screen.getByTestId("bar-policies_sold")).toHaveAttribute("data-axis", "policies");
    expect(screen.getByTestId("line-annual_premium")).toHaveAttribute("data-axis", "premium");
    fireEvent.click(screen.getByRole("button", { name: /csv/i }));
    expect(onExport).toHaveBeenCalledWith("Policies Sold", ["Period", "Policies sold", "Known annual premium", "Policies with known premium", "Policies with unknown premium", "Premium coverage (%)"], [["2026-07-01 to 2026-07-03", 4, 0.3, 2, 2, 50]]);
  });

  it("keeps all-unknown premium null through zero-policy days and exports an empty amount", () => {
    const onExport = vi.fn();
    const volume = volumeWith([daily("2026-07-01", premium(2, 0)), daily("2026-07-02", premium())]);
    render(<PoliciesSoldChart volume={volume} grouping="weekly" onExport={onExport} />);
    expect(chart.data[0]).toMatchObject({ annual_premium: null, coverage_pct: 0, policies_sold: 2, unknown_count: 2, partial: false });
    expect(screen.getByText("Known premium unavailable for this period.")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.getByText("0 of 2 premiums known · 2 unknown")).toBeInTheDocument();
    expect(screen.getByText("Gap = known premium unavailable, not $0")).toBeInTheDocument();
    expect(screen.queryByText("Some premiums unknown")).not.toBeInTheDocument();
    expect(screen.getByTestId("line-annual_premium")).toHaveAttribute("data-connect-nulls", "false");
    fireEvent.click(screen.getByRole("button", { name: /csv/i }));
    expect(onExport.mock.calls[0][2]).toEqual([["2026-07-01 to 2026-07-02", 2, null, 0, 2, 0]]);
  });

  it("distinguishes explicit known zero, unavailable premium and a successful empty day", () => {
    const volume = volumeWith([
      daily("2026-07-01", premium(1, 1, 0)), daily("2026-07-02", premium(1, 0)), daily("2026-07-03", premium()),
    ]);
    render(<PoliciesSoldChart volume={volume} grouping="daily" />);
    expect(chart.data.map((row) => [row.annual_premium, row.coverage_pct])).toEqual([[0, 100], [null, 0], [0, null]]);
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /csv/i })).not.toBeInTheDocument();
  });

  it("does not manufacture a known subtotal from an inconsistent null known amount", () => {
    const volume = volumeWith([daily("2026-07-01", { ...premium(1, 1), annual_premium: null }), daily("2026-07-02", premium(1, 1, 10))]);
    render(<PoliciesSoldChart volume={volume} grouping="monthly" />);
    expect(chart.data[0].annual_premium).toBeNull();
    expect(screen.getByText("Known premium unavailable for this period.")).toBeInTheDocument();
  });

  it("stacks two single-axis panels with no axis legend, tiles or ranking, and no meta when every premium is known", () => {
    const volume = volumeWith([daily("2026-07-01", premium(2, 2, 100)), daily("2026-07-02", premium())]);
    render(<PoliciesSoldChart volume={volume} grouping="daily" />);
    expect(screen.getByTestId("axis-policies")).toBeInTheDocument();
    expect(screen.getByTestId("axis-premium")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^axis-/)).toHaveLength(2);
    expect(screen.queryByText(/left axis|right axis/)).not.toBeInTheDocument();
    for (const gone of ["Total policies sold", "Peak period", "Most policies — current assignments", "Agent summary not loaded"]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/premiums? known ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Known annual premium key" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument(); // grouping lives in Trends, not in the card
  });

  it("shows only the empty message for a period with no policies", () => {
    render(<PoliciesSoldChart volume={volumeWith([daily("2026-07-01", premium())])} grouping="daily" />);
    expect(screen.getByText("No policies sold in this period.")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-policies_sold")).not.toBeInTheDocument();
    expect(screen.queryByText(/known ·|Some premiums unknown|Gap =/)).not.toBeInTheDocument();
  });

  it("draws a filled dot for a known bucket, a hollow one for a partial bucket and nothing in a gap", () => {
    const { container } = render(
      <svg>
        {partialDot({ key: "a", cx: 1, cy: 2, payload: { partial: false } })}
        {partialDot({ key: "b", cx: 3, cy: 4, payload: { partial: true } })}
        {partialDot({ key: "c", cx: null, cy: null, payload: { partial: false } })}
      </svg>,
    );
    const dots = container.querySelectorAll("circle");
    expect(dots).toHaveLength(2);
    expect(dots[0]).toHaveAttribute("fill", "hsl(var(--primary))");
    expect(dots[1]).toHaveAttribute("fill", "hsl(var(--card))");
    expect(dots[1]).toHaveAttribute("stroke", "hsl(var(--primary))");
  });
});

describe("Calling trend", () => {
  it("uses the combined outbound denominator, not averaged daily rates or inbound calls", () => {
    const onExport = vi.fn();
    const volume = volumeWith([
      daily("2026-07-01", premium(), 1, 1, 40), daily("2026-07-02", premium(), 9, 0, 20),
    ]);
    render(<CallVolumeChart volume={volume} grouping="weekly" onExport={onExport} />);
    expect(chart.data[0]).toMatchObject({ calls_made: 10, contacted: 1, inbound_calls: 60, contact_rate_pct: 10 });
    expect(screen.getByText("1 contacted ÷ 10 outbound calls")).toBeInTheDocument();
    expect(screen.getByTestId("axis-rate")).toHaveAttribute("data-domain", "[0,10]"); // zero-based nice max, not 0–100
    expect(screen.getByText("60 inbound calls (not in call contact rate)")).toBeInTheDocument();
    expect(screen.queryByText(/outbound calls · .* call contact rate/)).not.toBeInTheDocument(); // no duplicate totals line
    expect(screen.queryByText(/left axis|right axis|do not enter the rate/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getByTestId("bar-calls_made")).toHaveAttribute("data-axis", "calls");
    expect(screen.getByTestId("line-contact_rate_pct")).toHaveAttribute("data-axis", "rate");
    fireEvent.click(screen.getByRole("button", { name: /csv/i }));
    expect(onExport).toHaveBeenCalledWith("Call Volume", ["Period", "Calls made", "Contacted", "Inbound", "Call contact rate (%)"], [["2026-07-01 to 2026-07-02", 10, 1, 60, 10]]);
  });

  it("leaves the rate unavailable for an inbound-only day and preserves inbound CSV counts", () => {
    const onExport = vi.fn();
    const volume = volumeWith([daily("2026-07-01", premium(), 0, 0, 4)]);
    render(<CallVolumeChart volume={volume} grouping="daily" onExport={onExport} />);
    expect(chart.data[0].contact_rate_pct).toBeNull();
    expect(screen.getByText("No outbound calls; rate unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
    expect(screen.getByText("4 inbound calls (not in call contact rate)")).toBeInTheDocument();
    expect(screen.getByTestId("axis-rate")).toHaveAttribute("data-domain", "[0,10]");
    fireEvent.click(screen.getByRole("button", { name: /csv/i }));
    expect(onExport.mock.calls[0][2]).toEqual([["2026-07-01", 0, 0, 4, null]]);
  });

  it("shows genuine zero-contact rates as zero and keeps no-call gaps disconnected", () => {
    const volume = volumeWith([daily("2026-07-01", premium(), 2), daily("2026-07-02", premium())]);
    render(<CallVolumeChart volume={volume} grouping="daily" />);
    expect(chart.data.map((row) => row.contact_rate_pct)).toEqual([0, null]);
    expect(screen.getByText("0.0%")).toBeInTheDocument();
    expect(screen.getByTestId("line-contact_rate_pct")).toHaveAttribute("data-connect-nulls", "false");
    expect(screen.queryByText(/inbound calls? \(not in call contact rate\)/)).not.toBeInTheDocument();
  });

  it("names a single inbound call in the singular", () => {
    render(<CallVolumeChart volume={volumeWith([daily("2026-07-01", premium(), 3, 1, 1)])} grouping="daily" />);
    expect(screen.getByText("1 inbound call (not in call contact rate)")).toBeInTheDocument();
  });

  it("puts the rate axis on a zero-based nice maximum between 10% and 100%", () => {
    expect([0, 3, 7.4, 10, 12, 57.9, 60.1, 99, 100].map(rateAxisMax)).toEqual([10, 10, 10, 10, 15, 60, 65, 100, 100]);
    render(<CallVolumeChart volume={volumeWith([daily("2026-07-01", premium(), 19, 11), daily("2026-07-02", premium(), 1, 0)])} grouping="daily" />);
    expect(screen.getByTestId("axis-rate")).toHaveAttribute("data-domain", "[0,60]"); // 57.9% → 60%
  });
});
