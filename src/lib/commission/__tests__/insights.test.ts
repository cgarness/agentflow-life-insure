import { describe, expect, it } from "vitest";
import { carrierBars, change, comparisonLabel, goalFormSchema, goalProgress, singleMonth } from "../insights";
import type { CarrierGroup } from "../centerSchemas";

const group = (carrier: string | null, policies: number, estimate = 0, received = 0): CarrierGroup => ({
  carrier, policies, with_estimate_count: estimate > 0 ? 1 : 0, estimate_cents: estimate, on_hold_count: 0, on_hold_cents: 0,
  without_estimate_count: estimate > 0 ? policies - 1 : policies, received_cents: received, receipt_count: received > 0 ? 1 : 0,
});
const window = (from: string, to: string) => ({ from, to, policies: 0, with_estimate_count: 0, estimate_cents: 0, received_cents: 0, receipt_count: 0 });

describe("commission insights", () => {
  it("a goal belongs only to exactly one whole calendar month (leap years included)", () => {
    expect(singleMonth("2026-10-01", "2026-10-31")).toBe("2026-10-01");
    expect(singleMonth("2028-02-01", "2028-02-29")).toBe("2028-02-01");
    expect(singleMonth("2027-02-01", "2027-02-28")).toBe("2027-02-01");
    expect(singleMonth("2027-02-01", "2027-02-29")).toBeNull();
    expect(singleMonth("2026-10-01", "2026-10-30")).toBeNull();
    expect(singleMonth("2026-10-02", "2026-10-31")).toBeNull();
    expect(singleMonth("2026-10-01", "2026-11-30")).toBeNull();
    expect(singleMonth("2026-01-01", "2026-12-31")).toBeNull();
  });

  it("top carriers by the chosen metric, Other summing the rest, Unknown always its own bar", () => {
    const groups = [group("Alpha Life", 1, 900, 0), group("Beta Mutual", 6, 100, 50), group("Gamma", 3), group("Delta", 3), group("Epsilon", 2),
      group("Zeta", 2), group("Eta", 1), group(null, 4)];
    const bars = carrierBars(groups, "policies", false);
    expect(bars.shown.map((g) => g.carrier)).toEqual(["Beta Mutual", "Delta", "Gamma", "Epsilon", "Zeta"]);
    expect(bars.other).toEqual({ count: 2, value: 2 });
    expect(bars.unknown?.policies).toBe(4);
    expect(carrierBars(groups, "policies", true).shown).toHaveLength(7);
    expect(carrierBars(groups, "policies", true).other).toBeNull();
    expect(carrierBars(groups, "estimate", false).shown[0].carrier).toBe("Alpha Life");
    expect(carrierBars(groups, "received", false).shown[0].carrier).toBe("Beta Mutual");
    // Six named carriers fit without an Other bar of one.
    expect(carrierBars(groups.slice(0, 6), "policies", false).other).toBeNull();
  });

  it("changes: the difference always, a percentage only from an earlier value above zero", () => {
    expect(change(12, 10)).toEqual({ delta: 2, percent: 20 });
    expect(change(8, 10)).toEqual({ delta: -2, percent: -20 });
    expect(change(5, 0)).toEqual({ delta: 5, percent: null });
    expect(change(0, 0)).toEqual({ delta: 0, percent: null });
    expect(change(0, 7)).toEqual({ delta: -7, percent: -100 });
  });

  it("comparison labels name both windows when the current one differs from the selected range", () => {
    expect(comparisonLabel({ from: "2026-09-01", to: "2026-09-30" }, window("2026-09-01", "2026-09-30"), window("2026-08-01", "2026-08-31")))
      .toBe("vs Aug 2026");
    expect(comparisonLabel({ from: "2026-10-01", to: "2026-10-31" }, window("2026-10-01", "2026-10-20"), window("2026-09-01", "2026-09-20")))
      .toBe("Oct 1 – 20, 2026 vs Sep 1 – 20, 2026");
    expect(comparisonLabel({ from: "2026-03-10", to: "2026-03-19" }, window("2026-03-10", "2026-03-19"), window("2026-02-28", "2026-03-09")))
      .toBe("vs Feb 28 – Mar 9, 2026");
  });

  it("goal progress: floored figure that may pass 100 %, bar capped at 100 %", () => {
    expect(goalProgress(316225, 500000)).toEqual({ percent: 63, bar: 63 });
    expect(goalProgress(499999, 500000)).toEqual({ percent: 99, bar: 99 });
    expect(goalProgress(500000, 500000)).toEqual({ percent: 100, bar: 100 });
    expect(goalProgress(750000, 500000)).toEqual({ percent: 150, bar: 100 });
    expect(goalProgress(0, 1)).toEqual({ percent: 0, bar: 0 });
  });

  it("goal form: dollars to whole cents within the server's limits", () => {
    expect(goalFormSchema.parse({ amount: "5,000" }).amount).toBe(500000);
    expect(goalFormSchema.parse({ amount: "$1,250.50" }).amount).toBe(125050);
    expect(goalFormSchema.parse({ amount: "0.01" }).amount).toBe(1);
    expect(goalFormSchema.parse({ amount: "1000000" }).amount).toBe(100000000);
    for (const bad of ["0", "", "abc", "-5", "1000000.01", "12.345"]) expect(goalFormSchema.safeParse({ amount: bad }).success).toBe(false);
  });
});
