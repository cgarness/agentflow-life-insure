import { describe, expect, it } from "vitest";
import { calculateEstimate, disclaimerText, formatEffectiveDate, resolveLevel } from "../calculator";
import { LEVEL_NOT_ON_GRID_MESSAGE, parseContractLevel } from "../contractLevel";
import { estimateCommission } from "../estimate";
import { matchVariant, supportedTermLengths } from "../matching";
import { formatRatePercent, formatUsd, parseDecimal, toCents } from "../money";
import { IDS, syntheticContext } from "./syntheticGrid";

describe("contract level normalization (strict, read-only)", () => {
  it.each([
    ["120%", 120],
    ["100", 100],
    [" 95% ", 95],
    ["\t80\n", 80],
    ["0%", 0],
  ])("accepts %j as %d", (raw, level) => {
    expect(parseContractLevel(raw)).toEqual({ kind: "valid", level });
  });
  it.each([null, undefined, "", "   "])("treats %j as missing", (raw) => {
    expect(parseContractLevel(raw)).toEqual({ kind: "missing" });
  });
  it.each(["87.5", "120%%", "120 %", "%120", "120abc", "abc", "-100", "+100", "1,000", "12O", "1e2", "١٢٠"])(
    "rejects %j as malformed (no partial parse)",
    (raw) => {
      expect(parseContractLevel(raw)).toEqual({ kind: "malformed" });
    },
  );
  it("never selects a nearby level: a valid level that is not on the grid is reported, not adjusted", () => {
    const state = resolveLevel(syntheticContext("155%"));
    expect(state).toEqual({ kind: "not_on_grid", level: 155, message: LEVEL_NOT_ON_GRID_MESSAGE });
    expect(resolveLevel(syntheticContext("99")).kind).toBe("not_on_grid");
    expect(resolveLevel(syntheticContext("0%")).kind).toBe("not_on_grid");
  });
  it("distinguishes missing and malformed levels from an off-grid level", () => {
    expect(resolveLevel(syntheticContext(null)).kind).toBe("missing");
    expect(resolveLevel(syntheticContext("ten")).kind).toBe("malformed");
    expect(resolveLevel(syntheticContext("130%"))).toEqual({ kind: "valid", level: 130 });
  });
});

describe("exact money arithmetic", () => {
  it("parses decimal text exactly (no binary float)", () => {
    expect(parseDecimal("0.30000000000000004")).toEqual({ num: 7500000000000001n, den: 25000000000000000n }); // reduced, exact
    expect(parseDecimal("87.50")).toEqual({ num: 175n, den: 2n });
    expect(parseDecimal("1e2")).toBeNull();
    expect(parseDecimal("-1")).toBeNull();
    expect(parseDecimal("")).toBeNull();
  });
  it("rounds half-up to cents for display only", () => {
    expect(toCents({ num: 1n, den: 200n })).toBe(1n); // 0.005 -> 0.01
    expect(toCents({ num: 1n, den: 300n })).toBe(0n); // 0.00333…
    expect(toCents({ num: 2n, den: 3n })).toBe(67n); // 0.666…
    expect(formatUsd({ num: 1234567891n, den: 100n })).toBe("$12,345,678.91");
    expect(formatUsd({ num: 0n, den: 1n })).toBe("$0.00");
  });
  it("displays rate text without changing its value", () => {
    expect(formatRatePercent("87.50")).toBe("87.5%");
    expect(formatRatePercent("95")).toBe("95%");
    expect(formatRatePercent("0")).toBe("0%");
    expect(formatRatePercent("0.5")).toBe("0.5%");
    expect(formatRatePercent("300.00")).toBe("300%");
  });
});

describe("estimate formula", () => {
  it("annual × rate, 75% advance, remainder over months 10-12", () => {
    const e = estimateCommission("100", "92.5")!;
    expect(formatUsd(e.firstYearCommission)).toBe("$1,110.00");
    expect(formatUsd(e.advance)).toBe("$832.50");
    expect(formatUsd(e.monthlyRemainder)).toBe("$92.50");
  });
  it("keeps fractional percentages and fractional cents exact until display", () => {
    const e = estimateCommission("33.33", "87.5")!;
    expect(e.firstYearCommission).toEqual({ num: 69993n, den: 200n }); // 349.965 exactly
    expect(formatUsd(e.firstYearCommission)).toBe("$349.97");
    expect(formatUsd(e.advance)).toBe("$262.47"); // 262.47375
    expect(formatUsd(e.monthlyRemainder)).toBe("$29.16"); // 29.16375
    // Displayed lines are rounded independently; the formula is never bent to make them add up.
    expect(262.47 + 3 * 29.16).not.toBeCloseTo(349.97, 2);
  });
  it("a present zero rate is a valid $0 estimate", () => {
    const e = estimateCommission("250", "0")!;
    expect(formatUsd(e.firstYearCommission)).toBe("$0.00");
    expect(formatUsd(e.monthlyRemainder)).toBe("$0.00");
  });
  it("refuses a zero or malformed premium", () => {
    expect(estimateCommission("0", "50")).toBeNull();
    expect(estimateCommission("0.00", "50")).toBeNull();
    expect(estimateCommission("1e3", "50")).toBeNull();
  });
});

describe("variant matching", () => {
  const ctx = syntheticContext();
  const of = (productId: string) => ctx.variants.filter((v) => v.productId === productId);

  it("matches inclusive age bounds at both edges", () => {
    expect(matchVariant(of(IDS.finalPlan), 50, null)).toMatchObject({ kind: "matched", variant: { id: IDS.finalPlanYoung } });
    expect(matchVariant(of(IDS.finalPlan), 70, null)).toMatchObject({ kind: "matched", variant: { id: IDS.finalPlanYoung } });
    expect(matchVariant(of(IDS.finalPlan), 71, null)).toMatchObject({ kind: "matched", variant: { id: IDS.finalPlanOld } });
    expect(matchVariant(of(IDS.finalPlan), 85, null)).toMatchObject({ kind: "matched", variant: { id: IDS.finalPlanOld } });
    expect(matchVariant(of(IDS.finalPlan), 49, null)).toEqual({ kind: "no_age" });
    expect(matchVariant(of(IDS.finalPlan), 86, null)).toEqual({ kind: "no_age" });
  });
  it("treats missing bounds as unbounded and age 0 as a real age", () => {
    expect(matchVariant(of(IDS.zeroPlan), 0, null).kind).toBe("matched");
    expect(matchVariant(of(IDS.zeroPlan), 100, null).kind).toBe("matched");
    expect(matchVariant(of(IDS.juvenile), 0, null).kind).toBe("matched");
    expect(matchVariant(of(IDS.juvenile), 18, null)).toEqual({ kind: "no_age" });
  });
  it("requires an explicit supported term for term products; blank terms never match every length", () => {
    expect(supportedTermLengths(of(IDS.levelTerm))).toEqual([10, 15, 20, 30]);
    expect(supportedTermLengths(of(IDS.finalPlan))).toEqual([]);
    expect(matchVariant(of(IDS.levelTerm), 40, null)).toEqual({ kind: "term_required" });
    expect(matchVariant(of(IDS.levelTerm), 40, 25)).toEqual({ kind: "no_term" });
    expect(matchVariant(of(IDS.levelTerm), 40, 15)).toMatchObject({ kind: "matched", variant: { id: IDS.levelTerm10 } });
    expect(matchVariant(of(IDS.levelTerm), 55, 30)).toEqual({ kind: "no_age_term_combination" });
    expect(matchVariant(of(IDS.levelTerm), 70, 10)).toEqual({ kind: "no_age" });
  });
  it("reports overlapping variants as a configuration error instead of picking one", () => {
    expect(matchVariant(of(IDS.overlapping), 57, 20)).toEqual({ kind: "ambiguous" });
    expect(matchVariant(of(IDS.overlapping), 40, 20)).toMatchObject({ kind: "matched", variant: { id: IDS.overlapA } });
  });
});

describe("calculator outcomes", () => {
  const ctx = syntheticContext();
  const run = (productId: string, age: number, term: number | null, level = 100, premium = "100") =>
    calculateEstimate(ctx, level, { productId, age, term, monthlyPremium: premium });

  it("produces an estimate from the matched variant at the agent's level", () => {
    const result = run(IDS.levelTerm, 40, 20);
    expect(result.kind).toBe("estimate");
    if (result.kind !== "estimate") return;
    expect(result.estimate.ratePercent).toBe("92.5");
    expect(formatUsd(result.estimate.firstYearCommission)).toBe("$1,110.00");
  });
  it("uses the exact level column (no interpolation between levels)", () => {
    const result = run(IDS.finalPlan, 78, null, 120, "60");
    expect(result.kind === "estimate" && result.estimate.ratePercent).toBe("70");
    expect(result.kind === "estimate" && formatUsd(result.estimate.firstYearCommission)).toBe("$504.00");
    expect(result.kind === "estimate" && formatUsd(result.estimate.advance)).toBe("$378.00");
    expect(result.kind === "estimate" && formatUsd(result.estimate.monthlyRemainder)).toBe("$42.00");
    expect(run(IDS.levelTerm, 40, 20, 125)).toEqual({ kind: "unavailable", message: "Not available at your contract level." });
  });
  it("keeps 83.40 as a fractional percentage", () => {
    const result = run(IDS.juvenile, 8, null, 125);
    expect(result.kind === "estimate" && formatRatePercent(result.estimate.ratePercent)).toBe("83.4%");
  });
  it("returns the exact unavailable messages", () => {
    expect(run(IDS.finalPlan, 88, null)).toEqual({ kind: "unavailable", message: "Not available for this age." });
    expect(run(IDS.levelTerm, 40, 25)).toEqual({ kind: "unavailable", message: "Not available for this term length." });
    expect(run(IDS.levelTerm, 55, 30)).toEqual({ kind: "unavailable", message: "Not available for a 30-year term at age 55." });
    expect(run(IDS.levelTerm30, 40, 30)).toEqual({ kind: "unavailable", message: "This product isn't available in your agency's comp grid." });
  });
  it("distinguishes a present zero rate (valid $0) from a missing rate", () => {
    const zero = run(IDS.zeroPlan, 60, null);
    expect(zero.kind === "estimate" && formatUsd(zero.estimate.firstYearCommission)).toBe("$0.00");
    expect(run(IDS.zeroPlan, 60, null, 120)).toEqual({ kind: "unavailable", message: "Not available at your contract level." });
  });
  it("gives no estimate for ambiguous variants", () => {
    expect(run(IDS.overlapping, 57, 20).kind).toBe("configuration_error");
  });
  it("formats the disclaimer with the grid name and a time-zone-safe date", () => {
    expect(formatEffectiveDate("2025-11-20")).toBe("November 20, 2025");
    expect(formatEffectiveDate("2025-01-01")).toBe("January 1, 2025");
    expect(disclaimerText("Synthetic Test Grid", "2025-03-01")).toBe(
      "Estimate only. Assumes a 75% advance. Actual commission and payment timing may vary by age, plan type and carrier rules. Based on the Synthetic Test Grid effective March 1, 2025.",
    );
  });
});
