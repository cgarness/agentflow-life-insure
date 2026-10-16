import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IDS, syntheticContext } from "@/lib/commission/__tests__/syntheticGrid";
import { useCalculatorInputs } from "../useCalculatorInputs";

const setup = (context = syntheticContext()) => renderHook(({ ctx }) => useCalculatorInputs(ctx), { initialProps: { ctx: context } });

describe("calculator inputs (order, options and resets)", () => {
  it("offers only policy types, carriers and products of ACTIVE products in the selected grid", () => {
    const { result } = setup();
    expect(result.current.categories).toEqual(["term", "whole_life", "iul"]);
    act(() => result.current.setCategory("whole_life"));
    expect(result.current.carriers).toEqual(["Synthetic Carrier North", "Synthetic Carrier South"]);
    act(() => result.current.setCarrier("Synthetic Carrier South"));
    expect(result.current.products.map((p) => p.productName)).toEqual(["South Zero Plan"]);
  });

  it("a new policy type or carrier clears every downstream input", () => {
    const { result } = setup();
    act(() => result.current.setCategory("term"));
    act(() => result.current.setCarrier("Synthetic Carrier North"));
    act(() => result.current.setProduct(IDS.levelTerm));
    act(() => result.current.setAge("40"));
    act(() => result.current.setMonthlyPremium("100"));
    act(() => result.current.setTerm("20"));
    act(() => result.current.setCarrier("Synthetic Carrier South"));
    expect(result.current.values).toEqual({
      category: "term", carrier: "Synthetic Carrier South", productId: "", age: "", monthlyPremium: "", term: "",
    });
    act(() => result.current.setCategory("iul"));
    expect(result.current.values).toEqual({ category: "iul", carrier: "", productId: "", age: "", monthlyPremium: "", term: "" });
  });

  it("a new product keeps a compatible age, premium and term but clears an incompatible age or term", () => {
    const { result } = setup();
    act(() => result.current.setCategory("term"));
    act(() => result.current.setCarrier("Synthetic Carrier North"));
    expect(result.current.products.map((p) => p.productName)).toEqual(["North Level Term", "North Return Term"]);
    act(() => result.current.setProduct(IDS.levelTerm));
    expect(result.current.terms).toEqual([10, 15, 20, 30]);
    act(() => result.current.setAge("40"));
    act(() => result.current.setMonthlyPremium("75"));
    act(() => result.current.setTerm("10"));
    act(() => result.current.setProduct(IDS.returnTerm)); // ages 20-60, terms 20 and 30
    expect(result.current.values).toMatchObject({ productId: IDS.returnTerm, age: "40", monthlyPremium: "75", term: "" });
    expect(result.current.terms).toEqual([20, 30]);
    act(() => result.current.setTerm("30"));
    act(() => result.current.setAge("62"));
    act(() => result.current.setProduct(IDS.levelTerm)); // 62 is inside 18-65; 30 is offered
    expect(result.current.values).toMatchObject({ productId: IDS.levelTerm, age: "62", monthlyPremium: "75", term: "30" });
    act(() => result.current.setAge("64"));
    act(() => result.current.setProduct(IDS.returnTerm)); // 64 is outside 20-60
    expect(result.current.values).toMatchObject({ productId: IDS.returnTerm, age: "", monthlyPremium: "75", term: "30" });
  });

  it("clears age and term the new product cannot use", () => {
    const { result } = setup();
    act(() => result.current.setCategory("whole_life"));
    act(() => result.current.setCarrier("Synthetic Carrier North"));
    act(() => result.current.setProduct(IDS.finalPlan));
    act(() => result.current.setAge("90")); // outside every Final Plan band (50-85)
    act(() => result.current.setMonthlyPremium("60"));
    act(() => result.current.setProduct(IDS.finalPlan));
    expect(result.current.values).toMatchObject({ productId: IDS.finalPlan, age: "", monthlyPremium: "60", term: "" });
    expect(result.current.terms).toEqual([]);
  });

  it("starts the product choice over when a refreshed grid no longer has the chosen product", () => {
    const { result, rerender } = setup();
    act(() => result.current.setCategory("whole_life"));
    act(() => result.current.setCarrier("Synthetic Carrier North"));
    act(() => result.current.setProduct(IDS.finalPlan));
    act(() => result.current.setAge("60"));
    const refreshed = syntheticContext();
    refreshed.products = refreshed.products.filter((p) => p.id !== IDS.finalPlan);
    rerender({ ctx: refreshed });
    expect(result.current.values).toEqual({ category: "whole_life", carrier: "", productId: "", age: "", monthlyPremium: "", term: "" });
  });
});
