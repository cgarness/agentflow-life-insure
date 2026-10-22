import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import LeaderboardYourPerformance from "../LeaderboardYourPerformance";
import type { AgentStats } from "../leaderboardTypes";

const ME = "aaaa0000-0000-0000-0000-000000000001";
const agent = (id: string, over: Partial<AgentStats> = {}): AgentStats => ({
  id, first_name: "Blake", last_name: "Brooks", callsMade: 12, policiesSold: 1, appointmentsSet: 4, talkTime: 300,
  conversionRate: null, premiumSold: 600, unknownPremiums: 0, recentWins7d: 0, rank: 1, ...over,
});
const board = (me: Partial<AgentStats> = {}) => [
  agent("other-1", { rank: 1, premiumSold: 9000 }),
  agent(ME, { first_name: "Avery", last_name: "Adams", rank: 2, premiumSold: 4800.5, policiesSold: 4, callsMade: 37, ...me }),
  agent("other-3", { rank: 3, premiumSold: 100 }),
];
const card = () => screen.getByRole("region", { name: "Your Performance" });
const stat = (label: string) => within(card()).getByText(label).nextElementSibling as HTMLElement;

afterEach(cleanup);

describe("Your Performance", () => {
  it("shows the signed-in agent's AP, rank of N, Policies and Calls for the period and scope", () => {
    render(<LeaderboardYourPerformance agents={board()} userId={ME} period="This Week" view="org" />);
    expect(card()).toHaveTextContent("This Week · My Agency");
    expect(within(card()).getByText("Annual Premium").nextElementSibling).toHaveTextContent("$4,800.50");
    expect(stat("Rank")).toHaveTextContent("#2 of 3");
    expect(stat("Policies")).toHaveTextContent("4");
    expect(stat("Calls")).toHaveTextContent("37");
    expect(card().textContent).not.toMatch(/appointment|talk/i);
  });

  it("shows movement only when a real rank change is reported", () => {
    const { rerender } = render(<LeaderboardYourPerformance agents={board()} userId={ME} period="Today" view="org" />);
    expect(within(card()).queryByText(/Moved/)).toBeNull();
    rerender(<LeaderboardYourPerformance agents={board()} userId={ME} period="Today" view="org" movement={{ direction: "down", spots: 1 }} />);
    expect(within(card()).getByText("Moved down 1 spot since the last leaderboard update")).toBeInTheDocument();
    expect(card()).toHaveTextContent("1 since last update");
  });

  it("every premium unknown: AP reads — with the count spelled out, never $0", () => {
    render(<LeaderboardYourPerformance agents={board({ premiumSold: 0, policiesSold: 2, unknownPremiums: 2 })} userId={ME} period="Today" view="org" />);
    expect(card()).toHaveTextContent("—");
    expect(card()).not.toHaveTextContent("$0.00");
    expect(card()).toHaveTextContent("Premium unknown for 2 policies");
  });

  it("partly unknown keeps the known subtotal and says how many are unknown", () => {
    render(<LeaderboardYourPerformance agents={board({ policiesSold: 4, unknownPremiums: 1 })} userId={ME} period="Today" view="org" />);
    expect(card()).toHaveTextContent("$4,800.50");
    expect(card()).toHaveTextContent("Includes 1 policy with unknown premium");
  });

  it("a genuine $0 (no sale yet) reads $0.00 — the agent is on the board", () => {
    render(<LeaderboardYourPerformance agents={board({ premiumSold: 0, policiesSold: 0, callsMade: 0 })} userId={ME} period="Today" view="org" />);
    expect(card()).toHaveTextContent("$0.00");
    expect(stat("Calls")).toHaveTextContent("0");
  });

  it("not on the board: an unavailable state with no figures, naming the Group in Group view", () => {
    const { rerender } = render(<LeaderboardYourPerformance agents={board().filter((a) => a.id !== ME)} userId={ME} period="Today" view="org" />);
    expect(card()).toHaveTextContent("Your stats aren't on this board");
    expect(card()).toHaveTextContent("Only active agents in your agency are ranked.");
    expect(card().textContent).not.toMatch(/\$|\d/);

    rerender(<LeaderboardYourPerformance agents={[]} userId={ME} period="This Month" view="group" groupName="FFL National" />);
    expect(card()).toHaveTextContent("This Month · FFL National");
    expect(card()).toHaveTextContent("Only active agents in FFL National are ranked.");
  });

  it("no signed-in id is treated as not on the board (never another agent's numbers)", () => {
    render(<LeaderboardYourPerformance agents={board()} period="Today" view="org" />);
    expect(card()).toHaveTextContent("Your stats aren't on this board");
    expect(card().textContent).not.toMatch(/\$/);
  });
});
