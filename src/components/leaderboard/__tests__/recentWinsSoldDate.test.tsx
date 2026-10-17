import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { format, parseISO } from "date-fns";
import type { Win } from "@/components/leaderboard/leaderboardTypes";

/**
 * Recent Wins keeps latest-entered ordering but shows the Sold Date (a calendar date) distinctly from the entry
 * time, and never presents the entry time as the time of sale. Same formats as BrandingContext (MM/dd/yyyy, 12h).
 */
vi.mock("@/contexts/BrandingContext", () => {
  const at = (d: string | Date) => (typeof d === "string" ? parseISO(d) : d);
  return { useBranding: () => ({ formatDate: (d: string | Date) => format(at(d), "MM/dd/yyyy"), formatTime: (d: string | Date) => format(at(d), "h:mm a") }) };
});
import RecentWinsPanel from "@/components/leaderboard/RecentWinsPanel";

const win = (over: Partial<Win>): Win => ({ id: "aaaaaaaa-0000-4000-8000-000000000001", agent_id: null, agent_name: "Teo S.", contact_name: "Client",
  campaign_name: "", policy_type: "Final Expense", premiumSold: 701.4, premium_known: true, celebrated: true,
  created_at: "2026-10-16T19:48:00+00:00", entered_at: "2026-10-16T19:48:00+00:00", sold_date: "2026-10-15", ...over });
const show = (wins: Win[]) => render(<RecentWinsPanel wins={wins} agents={[]} flashingWinId={null} />);
const enteredDay = (iso: string) => format(parseISO(iso), "MM/dd/yyyy");
const enteredTime = (iso: string) => format(parseISO(iso), "h:mm a");

afterEach(cleanup);

describe("Recent Wins — Sold Date display", () => {
  it("shows a late-entered sale on its Sold Date with the entry date labelled separately", () => {
    show([win({})]);
    expect(screen.getByText("Sold 10/15/2026")).toBeTruthy();
    expect(screen.getByText(`Entered ${enteredDay("2026-10-16T19:48:00+00:00")}`)).toBeTruthy();
    expect(screen.getByTitle(`Entered ${enteredDay("2026-10-16T19:48:00+00:00")} ${enteredTime("2026-10-16T19:48:00+00:00")}`)).toBeTruthy();
  });

  it("shows the entry time only when the sale was entered on its Sold Date", () => {
    const entered = "2026-10-16T19:48:00+00:00";
    const soldDate = format(parseISO(entered), "yyyy-MM-dd"); // the browser's own date of the entry
    show([win({ sold_date: soldDate })]);
    expect(screen.getByText(`Sold ${enteredDay(entered)}`)).toBeTruthy();
    expect(screen.getByText(`Entered ${enteredTime(entered)}`)).toBeTruthy();
  });

  it("never shifts a Sold Date by the browser's UTC offset", () => {
    show([win({ sold_date: "2026-10-01", entered_at: "2026-10-01T06:30:00+00:00", created_at: "2026-10-01T06:30:00+00:00" })]);
    expect(screen.getByText("Sold 10/01/2026")).toBeTruthy();
    expect(screen.queryByText(/Sold 09\/30\/2026/)).toBeNull();
  });

  it("says the Sold Date is unknown rather than dating the sale by its entry", () => {
    show([win({ sold_date: null })]);
    expect(screen.getByText("Sold date unknown")).toBeTruthy();
    expect(screen.getByText(`Entered ${enteredDay("2026-10-16T19:48:00+00:00")}`)).toBeTruthy();
  });

  it("never labels a clock time as the time of sale", () => {
    const { container } = show([win({}), win({ id: "aaaaaaaa-0000-4000-8000-000000000002", sold_date: null })]);
    expect(container.textContent).not.toMatch(/Sold[^·]*\d{1,2}:\d{2}/);
  });

  it("keeps the server's latest-entered order even when an older Sold Date is entered last", () => {
    show([
      win({ id: "aaaaaaaa-0000-4000-8000-000000000003", agent_name: "Late Entry", sold_date: "2026-10-08", entered_at: "2026-10-16T20:03:00+00:00", created_at: "2026-10-16T20:03:00+00:00" }),
      win({ id: "aaaaaaaa-0000-4000-8000-000000000004", agent_name: "Earlier Entry", sold_date: "2026-10-15" }),
    ]);
    const names = screen.getAllByText(/Entry$/).map((n) => n.textContent);
    expect(names).toEqual(["Late Entry", "Earlier Entry"]);
    expect(screen.getByText("Sold 10/08/2026")).toBeTruthy();
  });

  it("falls back to created_at as the entry time for a win without entered_at", () => {
    show([win({ entered_at: undefined, created_at: "2026-10-16T19:48:00+00:00" })]);
    expect(screen.getByText(`Entered ${enteredDay("2026-10-16T19:48:00+00:00")}`)).toBeTruthy();
  });
});
