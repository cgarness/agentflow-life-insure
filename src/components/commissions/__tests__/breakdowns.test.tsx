/**
 * Overview breakdowns: carrier bars and product slices open exactly matching lists; Unknown stays visible; Other expands
 * into View all; details show policy counts and averages over policies with estimates; comparisons never invent a
 * percentage; Months 10–12 links its list. With amounts hidden, money plots and figures are replaced; counts stay.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { AmountsContext } from "@/components/commission/ui/amountsContext";
import { breakdownSchema, type CommissionBreakdown } from "@/lib/commission/centerSchemas";
import { CarrierBreakdown } from "../overview/CarrierBreakdown";
import { Comparisons } from "../overview/Comparisons";
import { MonthsTenToTwelve } from "../overview/MonthsTenToTwelve";
import { ProductBreakdown } from "../overview/ProductBreakdown";
import { breakdown } from "./centerFixtures";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);
const MONTH = { preset: "this_month", from: null, to: null } as const;
const data = breakdownSchema.parse(breakdown());
function show(node: React.ReactNode, hidden = false) {
  return render(<MemoryRouter><AmountsContext.Provider value={{ hidden, setHidden: () => {} }}>{node}</AmountsContext.Provider></MemoryRouter>);
}
const href = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href");
const noAmounts = (root: HTMLElement) => {
  expect(root.textContent).not.toMatch(/\$\s?\d/);
  for (const el of root.querySelectorAll("[aria-label], [title]")) {
    expect(`${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`).not.toMatch(/\$\s?\d/);
  }
};

function many(): CommissionBreakdown {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"];
  const carriers = names.map((carrier, i) => ({ ...data.carriers[0], carrier, policies: 7 - i, with_estimate_count: 0, estimate_cents: 0,
    on_hold_count: 0, on_hold_cents: 0, without_estimate_count: 7 - i, received_cents: 0, receipt_count: 0 }));
  const policies = carriers.reduce((n, c) => n + c.policies, 0);
  return { ...data, carriers, products: [{ ...data.products[0], policies, with_estimate_count: 0, estimate_cents: 0, on_hold_count: 0,
    on_hold_cents: 0, without_estimate_count: policies }], sold: { ...data.sold, policies, estimate_cents: 0 }, received: { received_cents: 0, receipt_count: 0 } };
}

describe("By carrier", () => {
  it("each bar opens exactly its Sold-period carrier list; Unknown keeps its own bar and filter", () => {
    show(<CarrierBreakdown data={data} period={MONTH} />);
    const list = screen.getByRole("list", { name: "Carriers by Policies" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Synthetic Life5", "Harbor Mutual3", "Unknown1"]);
    expect(href(/^Synthetic Life/)).toBe("/commissions/policies?period=this_month&carrier=Synthetic+Life");
    expect(href(/^Unknown/)).toBe("/commissions/policies?period=this_month&carrier_unknown=1");
  });

  it("Est. commission and Received metrics; Received opens History for the same carrier", () => {
    show(<CarrierBreakdown data={data} period={MONTH} />);
    fireEvent.click(screen.getByRole("button", { name: "Est. commission" }));
    expect(screen.getByRole("list", { name: "Carriers by Est. commission" }).textContent).toContain("$2,292.00");
    fireEvent.click(screen.getByRole("button", { name: "Received" }));
    expect(href(/^Harbor Mutual/)).toBe("/commissions/payments?view=history&carrier=Harbor+Mutual");
    expect(screen.getByRole("list", { name: "Carriers by Received" }).textContent).toContain("$51.57");
  });

  it("top five plus Other, which expands into View all (never a drill-down)", () => {
    show(<CarrierBreakdown data={many()} period={MONTH} />);
    const list = () => screen.getByRole("list", { name: "Carriers by Policies" });
    expect(within(list()).getAllByRole("listitem")).toHaveLength(6);
    expect(within(list()).getByRole("button", { name: /Other carriers \(2\)/ }).textContent).toContain("3");
    fireEvent.click(within(list()).getByRole("button", { name: /Other carriers/ }));
    expect(within(list()).getAllByRole("link")).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: "Show top carriers" }));
    expect(within(list()).getAllByRole("link")).toHaveLength(5);
  });

  it("details: every group with policies, estimates, averages over policies with an estimate (missing is a dash, not $0)", () => {
    show(<CarrierBreakdown data={data} period={MONTH} />);
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rows).toEqual(["Harbor Mutual32$573.00$1,146.00$51.57", "Synthetic Life54$573.00$2,292.00$200.00", "Unknown10——$0.00"]);
    expect(screen.getByText("On hold: 1 not included")).toBeInTheDocument();
  });

  it("hidden amounts: money metrics show a neutral panel; the Policies bars, names and details counts stay", () => {
    const { container } = show(<CarrierBreakdown data={data} period={MONTH} />, true);
    expect(screen.getByRole("list", { name: "Carriers by Policies" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Est. commission" }));
    expect(screen.getByText("Amounts hidden")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /Carriers by/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(within(screen.getByRole("table")).getAllByRole("row")[1].textContent).toBe("Harbor Mutual32••••••••••••");
    noAmounts(container);
  });
});

describe("By product", () => {
  it("mutually exclusive types in a legend of exact links; Final Expense apart from Whole Life; Unknown visible", () => {
    show(<ProductBreakdown data={data} period={MONTH} />);
    const legend = screen.getByRole("list", { name: "Products by policies" });
    expect(within(legend).getAllByRole("link").map((l) => l.textContent)).toEqual(["Term556%", "Whole Life111%", "Final Expense222%", "Unknown111%"]);
    expect(href(/^Final Expense/)).toBe("/commissions/policies?period=this_month&type=final_expense");
    expect(href(/^Whole Life/)).toBe("/commissions/policies?period=this_month&type=whole_life");
    fireEvent.click(screen.getByRole("button", { name: "Est. commission" }));
    expect(within(screen.getByRole("list", { name: "Products by est. commission" })).getAllByRole("link")[0].textContent).toBe("Term$2,292.0067%");
  });

  it("hidden amounts: the Est. commission doughnut is replaced; the Policies doughnut stays", () => {
    const { container } = show(<ProductBreakdown data={data} period={MONTH} />, true);
    expect(screen.getByRole("list", { name: "Products by policies" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Est. commission" }));
    expect(screen.getByText("Amounts hidden")).toBeInTheDocument();
    noAmounts(container);
  });
});

describe("Comparisons and Months 10–12", () => {
  it("names both windows when month-to-date; differences always, a percentage only from an earlier value above zero", () => {
    show(<Comparisons data={data} />);
    expect(screen.getByText("Oct 1 – 20, 2026 vs Sep 1 – 20, 2026")).toBeInTheDocument();
    const tiles = screen.getByRole("region", { name: "Comparison" });
    expect(tiles.textContent).toContain("Policies sold9+3 (+50%)· was 6");
    expect(tiles.textContent).toContain("Est. commission · 3 without estimate$3,438.00+$438.00 (+15%)· was $3,000.00");
    expect(tiles.textContent).toContain("Received$251.57+$251.57· was $0.00");
    expect(tiles.textContent).not.toMatch(/Infinity|NaN/);
  });

  it("no comparison for a future period; hidden amounts keep only the policy comparison", () => {
    const { container } = show(<Comparisons data={{ ...data, comparison: null }} />);
    expect(container.textContent).toBe("");
    cleanup();
    const hidden = show(<Comparisons data={data} />, true);
    expect(screen.getByRole("region", { name: "Comparison" }).textContent).toContain("Policies sold9+3 (+50%)· was 6");
    noAmounts(hidden.container);
  });

  it("Months 10–12: next month's remaining, distinct policies and its exact payment list", () => {
    show(<MonthsTenToTwelve data={data.months_10_12} />);
    expect(screen.getByRole("heading", { name: "Months 10–12 · Nov 2026" })).toBeInTheDocument();
    expect(screen.getByText("$143.25")).toBeInTheDocument();
    expect(screen.getByText("2 policies · 3 payments")).toBeInTheDocument();
    expect(href("View payments")).toBe("/commissions/payments?period=next_month&status=remaining&kind=later");
    cleanup();
    const hidden = show(<MonthsTenToTwelve data={data.months_10_12} />, true);
    expect(screen.getByText("••••")).toBeInTheDocument();
    noAmounts(hidden.container);
  });
});
