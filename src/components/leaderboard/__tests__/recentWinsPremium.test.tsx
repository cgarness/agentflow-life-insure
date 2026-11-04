import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { format, parseISO } from "date-fns";
import type { Win } from "@/components/leaderboard/leaderboardTypes";

/**
 * Recent Wins renders premiumSold (the effective sale premium × 12 from get_leaderboard_recent_wins), never the raw
 * wins.premium_amount that stays in the payload for compatibility (Reports V2 PKG-B, D2 §4.2, §6.4).
 */
vi.mock("@/contexts/BrandingContext", () => {
  const at = (d: string | Date) => (typeof d === "string" ? parseISO(d) : d);
  return { useBranding: () => ({ formatDate: (d: string | Date) => format(at(d), "MM/dd/yyyy"), formatTime: (d: string | Date) => format(at(d), "h:mm a") }) };
});
import RecentWinsPanel from "@/components/leaderboard/RecentWinsPanel";

const win = (over: Partial<Win> & Record<string, unknown>): Win => ({ id: "aaaaaaaa-0000-4000-8000-000000000001", agent_id: null,
  agent_name: "Teo S.", contact_name: "Client", campaign_name: "", policy_type: "Term", premiumSold: 1440, premium_known: true,
  celebrated: true, created_at: "2026-10-16T19:48:00+00:00", entered_at: "2026-10-16T19:48:00+00:00", sold_date: "2026-10-15",
  ...over } as Win);
afterEach(cleanup);

describe("Recent Wins premium", () => {
  it("shows the corrected sale's premiumSold ($120/mo → $1,440.00), not its raw premium_amount (100)", () => {
    render(<RecentWinsPanel wins={[win({ premium_amount: 100 })]} agents={[]} flashingWinId={null} />);
    expect(screen.getByText("$1,440.00")).toBeTruthy();
    for (const raw of ["$100.00", "$1,200.00", "$100"]) expect(screen.queryByText(raw)).toBeNull();
  });

  it("a win whose premiumSold is null shows no premium badge", () => {
    const { container } = render(<RecentWinsPanel wins={[win({ premiumSold: null, premium_known: false, premium_amount: 100 })]} agents={[]} flashingWinId={null} />);
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});
