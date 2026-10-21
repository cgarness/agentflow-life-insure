import { describe, expect, it } from "vitest";
import {
  type AgentStats,
  compareAgentsByAp,
  displayedAp,
  hasMeaningfulStandings,
  rankAgents,
  rankingValuesEqual,
  snapshotRankingValues,
} from "../leaderboardTypes";

const agent = (id: string, over: Partial<AgentStats> = {}): AgentStats => ({
  id, first_name: "Avery", last_name: "Adams", callsMade: 0, policiesSold: 0, appointmentsSet: 0, talkTime: 0,
  conversionRate: null, premiumSold: 0, unknownPremiums: 0, recentWins7d: 0, rank: 0, ...over,
});
const order = (rows: AgentStats[]) => rankAgents(rows.map((r) => ({ ...r }))).map((r) => r.id);

describe("AP ranking (the Leaderboard's only metric)", () => {
  it("orders by AP descending, whatever Policies, Calls, Talk Time or Appointments say", () => {
    expect(order([
      agent("most-policies", { premiumSold: 100, policiesSold: 9, callsMade: 900, talkTime: 9999, appointmentsSet: 50 }),
      agent("top-ap", { premiumSold: 9000.5, policiesSold: 1 }),
      agent("middle", { premiumSold: 2400 }),
    ])).toEqual(["top-ap", "middle", "most-policies"]);
  });

  it("breaks ties by Policies, then Calls, then last name, first name, then id", () => {
    expect(order([
      agent("calls-5", { premiumSold: 500, policiesSold: 2, callsMade: 5, last_name: "Zane" }),
      agent("pol-3", { premiumSold: 500, policiesSold: 3, callsMade: 0, last_name: "Zane" }),
      agent("calls-9", { premiumSold: 500, policiesSold: 2, callsMade: 9, last_name: "Zane" }),
      agent("name-b", { premiumSold: 500, policiesSold: 2, callsMade: 5, last_name: "Brooks" }),
      agent("name-a-first-b", { premiumSold: 500, policiesSold: 2, callsMade: 5, last_name: "Adams", first_name: "Blake" }),
      agent("id-2", { premiumSold: 500, policiesSold: 2, callsMade: 5, last_name: "adams", first_name: "avery" }),
      agent("id-1", { premiumSold: 500, policiesSold: 2, callsMade: 5, last_name: "Adams", first_name: "Avery" }),
    ])).toEqual(["pol-3", "calls-9", "id-1", "id-2", "name-a-first-b", "name-b", "calls-5"]);
  });

  it("gives every agent a unique rank 1…N, independent of input order", () => {
    const rows = [agent("c", { premiumSold: 1 }), agent("a", { premiumSold: 3 }), agent("b", { premiumSold: 2 })];
    const forward = rankAgents(rows.map((r) => ({ ...r })));
    const backward = rankAgents(rows.reverse().map((r) => ({ ...r })));
    expect(forward.map((r) => [r.id, r.rank])).toEqual([["a", 1], ["b", 2], ["c", 3]]);
    expect(backward.map((r) => [r.id, r.rank])).toEqual([["a", 1], ["b", 2], ["c", 3]]);
    expect(compareAgentsByAp(rows[0], rows[0])).toBe(0);
  });

  it("uses the delivered annual amount as is (never multiplied by 12)", () => {
    const [top] = rankAgents([agent("x", { premiumSold: 1200 }), agent("y", { premiumSold: 1199.99 })]);
    expect(top).toMatchObject({ id: "x", premiumSold: 1200 });
  });

  it("an all-unknown seller (AP 0) ranks after every AP seller and before agents with no sale", () => {
    expect(order([
      agent("idle", { last_name: "Aaron", callsMade: 3 }),
      agent("unknown", { last_name: "Zed", policiesSold: 2, unknownPremiums: 2 }),
      agent("known", { premiumSold: 50, policiesSold: 1 }),
    ])).toEqual(["known", "unknown", "idle"]);
  });
});

describe("displayed AP (D14)", () => {
  it("every premium unknown reads null ('—'), never $0", () => {
    expect(displayedAp(agent("u", { policiesSold: 2, unknownPremiums: 2 }))).toBeNull();
  });
  it("a partly unknown subtotal, a genuine known $0 and an empty period keep their amounts", () => {
    expect(displayedAp(agent("p", { policiesSold: 3, unknownPremiums: 1, premiumSold: 2400 }))).toBe(2400);
    expect(displayedAp(agent("z", { policiesSold: 1, premiumSold: 0 }))).toBe(0);
    expect(displayedAp(agent("e"))).toBe(0);
  });
});

describe("change detection covers the whole sort key", () => {
  const base = [agent("a", { premiumSold: 100, policiesSold: 1, callsMade: 5 }), agent("b", { premiumSold: 100, policiesSold: 1, callsMade: 3 })];

  it("a Calls or Policies change is a change even when AP is unchanged (tie-breaks can reorder)", () => {
    const prev = snapshotRankingValues(base);
    expect(rankingValuesEqual(base.map((a) => ({ ...a })), prev)).toBe(true);
    expect(rankingValuesEqual([base[0], { ...base[1], callsMade: 6 }], prev)).toBe(false);
    expect(rankingValuesEqual([base[0], { ...base[1], policiesSold: 2 }], prev)).toBe(false);
    expect(rankingValuesEqual([base[0], { ...base[1], premiumSold: 101 }], prev)).toBe(false);
    expect(rankingValuesEqual([base[0]], prev)).toBe(false);
  });

  it("Talk Time and Appointments do not affect the order, so they are not a ranking change", () => {
    const prev = snapshotRankingValues(base);
    expect(rankingValuesEqual([{ ...base[0], talkTime: 999, appointmentsSet: 9 }, base[1]], prev)).toBe(true);
  });

  it("a board is frozen only when every agent's AP, Policies and Calls are identical", () => {
    expect(hasMeaningfulStandings([])).toBe(false);
    expect(hasMeaningfulStandings([agent("a"), agent("b", { last_name: "Brooks" })])).toBe(false);
    expect(hasMeaningfulStandings([agent("a", { premiumSold: 5 }), agent("b", { premiumSold: 5 })])).toBe(false);
    // All-$0 AP, but Calls differ: the tie-break orders it, so it is meaningful.
    expect(hasMeaningfulStandings([agent("a", { callsMade: 2 }), agent("b")])).toBe(true);
    expect(hasMeaningfulStandings([agent("a", { premiumSold: 5 }), agent("b")])).toBe(true);
  });
});
