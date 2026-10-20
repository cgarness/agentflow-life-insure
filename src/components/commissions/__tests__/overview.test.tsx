import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { overviewSchema } from "@/lib/commission/centerSchemas";
import { SummaryCards } from "../overview/SummaryCards";
import { CommissionTimeline } from "../overview/CommissionTimeline";
import { NeedsReview } from "../overview/NeedsReview";
import { UpcomingList } from "../overview/UpcomingList";
import { overview } from "./centerFixtures";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);
const data = overviewSchema.parse(overview());
const MONTH = { preset: "this_month", from: null, to: null } as const;
const inRouter = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);
const href = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href");

describe("Overview", () => {
  it("cards: four figures with simple labels, each linking to its exact list; notes only when relevant", () => {
    inRouter(<SummaryCards data={data} period={MONTH} />);
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["Expected", "Received", "Remaining", "Next 90 days"]);
    expect(href("Expected")).toBe("/commissions/payments");
    expect(href("Received")).toBe("/commissions/payments?view=history");
    expect(href("Remaining")).toBe("/commissions/payments?status=remaining");
    expect(href("Next 90 days")).toBe("/commissions/payments?dates=next_90");
    expect(screen.getByText("$856.71")).toBeInTheDocument();
    expect(screen.getByText("On hold: $760.32 not included")).toBeInTheDocument();
    expect(screen.getByText("$70.25 above estimate")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^About / })).toHaveLength(4);
    // No explanatory paragraph and no "this month" repeated under each card.
    expect(screen.queryByText(/this month/i)).toBeNull();
  });

  it("Next 90 days explains its own range in its tooltip", () => {
    inRouter(<SummaryCards data={data} period={MONTH} />);
    fireEvent.click(screen.getByRole("button", { name: "About Next 90 days" }));
    expect(screen.getByText("Remaining on payments expected from today through Jan 17, 2027. Not affected by the selected period.")).toBeInTheDocument();
  });

  it("timeline: legend, a month readout with links to exactly that month's records, and a data table", () => {
    inRouter(<CommissionTimeline buckets={data.timeline} />);
    expect(within(screen.getByRole("list", { name: "Timeline key" })).getAllByRole("listitem").map((li) => li.textContent))
      .toEqual(["Received", "Expected · Advance", "Expected · Months 10–12"]);
    expect((screen.getByLabelText("Month") as HTMLSelectElement).value).toBe("2026-10");
    expect(href("Expected (3)")).toBe("/commissions/payments?period=custom&from=2026-10-01&to=2026-10-31");
    expect(href("Received (2)")).toBe("/commissions/payments?view=history&period=custom&from=2026-10-01&to=2026-10-31");
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-11" } });
    expect(href("Expected (0)")).toBe("/commissions/payments?period=custom&from=2026-11-01&to=2026-11-28");
    expect(screen.getByRole("table", { hidden: true }).querySelectorAll("tbody tr")).toHaveLength(12);
  });

  it("needs review: links only for non-zero items; setup completeness from the eligible policies", () => {
    inRouter(<NeedsReview data={data} />);
    expect(href(/Check payment/)).toBe("/commissions/payments?dates=any&status=check_payment");
    expect(href(/Date needed/)).toBe("/commissions/payments?dates=any&status=date_needed");
    expect(href(/Needs review/)).toBe("/commissions/policies?setup=needs_review");
    expect(screen.queryByRole("link", { name: /Missing commission/ })).toBeNull();
    expect(screen.getByText("10 of 12")).toBeInTheDocument();
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it("upcoming: identifies the client (or a restricted contact), window, remaining and a direct action", () => {
    const onOpen = vi.fn();
    inRouter(<UpcomingList rows={data.upcoming.rows} total={data.upcoming.total_count} onOpen={onOpen} />);
    expect(screen.getByText("Client 1")).toBeInTheDocument();
    expect(screen.getByText("Restricted contact")).toBeInTheDocument();
    expect(screen.getAllByText("Nov 2 – 4, 2026")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Record payment" })[0]);
    expect(onOpen).toHaveBeenCalledWith(data.upcoming.rows[0].policy_id, { payment: data.upcoming.rows[0].installment_id });
    expect(href("View all 6")).toBe("/commissions/payments?dates=next_90");
  });
});
