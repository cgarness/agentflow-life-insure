import type { CalculatorRate, CalculatorVariant, ReadyCalculatorContext } from "../types";

/**
 * A clearly synthetic calculator context for tests. Every carrier, product, label and rate is invented;
 * nothing here resembles the private reference source.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const IDS = {
  grid: id(1),
  levelTerm: id(101),
  finalPlan: id(102),
  juvenile: id(103),
  zeroPlan: id(104),
  overlapping: id(105),
  returnTerm: id(106),
  levelTerm10: id(201),
  levelTerm30: id(202),
  finalPlanYoung: id(203),
  finalPlanOld: id(204),
  juvenileAll: id(205),
  zeroPlanAll: id(206),
  overlapA: id(207),
  overlapB: id(208),
  returnTermAll: id(209),
};

const variant = (v: Partial<CalculatorVariant> & Pick<CalculatorVariant, "id" | "productId">): CalculatorVariant => ({
  label: "",
  minAge: null,
  maxAge: null,
  termYears: null,
  ...v,
});

const rates = (variantId: string, byLevel: Record<number, string>): CalculatorRate[] =>
  Object.entries(byLevel).map(([level, ratePercent]) => ({ variantId, contractLevel: Number(level), ratePercent }));

export function syntheticContext(commissionLevel: string | null = "100"): ReadyCalculatorContext {
  return {
    status: "ready",
    commissionLevel,
    grid: {
      id: IDS.grid,
      name: "Synthetic Test Grid",
      effectiveDate: "2025-03-01",
      contractLevels: [145, 140, 135, 130, 125, 120, 115, 110, 105, 100, 95, 90, 85, 80, 75, 70, 65],
      revision: 3,
    },
    products: [
      { id: IDS.levelTerm, category: "term", carrier: "Synthetic Carrier North", productName: "North Level Term" },
      { id: IDS.finalPlan, category: "whole_life", carrier: "Synthetic Carrier North", productName: "North Final Plan" },
      { id: IDS.juvenile, category: "iul", carrier: "Synthetic Carrier South", productName: "South Junior Builder" },
      { id: IDS.zeroPlan, category: "whole_life", carrier: "Synthetic Carrier South", productName: "South Zero Plan" },
      { id: IDS.overlapping, category: "term", carrier: "Synthetic Carrier South", productName: "South Overlap Term" },
      { id: IDS.returnTerm, category: "term", carrier: "Synthetic Carrier North", productName: "North Return Term" },
    ],
    variants: [
      variant({ id: IDS.levelTerm10, productId: IDS.levelTerm, label: "10-20 yr", minAge: 18, maxAge: 65, termYears: [10, 15, 20] }),
      variant({ id: IDS.levelTerm30, productId: IDS.levelTerm, label: "30 yr", minAge: 18, maxAge: 50, termYears: [30] }),
      variant({ id: IDS.finalPlanYoung, productId: IDS.finalPlan, label: "50-70", minAge: 50, maxAge: 70 }),
      variant({ id: IDS.finalPlanOld, productId: IDS.finalPlan, label: "71-85", minAge: 71, maxAge: 85 }),
      variant({ id: IDS.juvenileAll, productId: IDS.juvenile, label: "", minAge: 0, maxAge: 17 }),
      variant({ id: IDS.zeroPlanAll, productId: IDS.zeroPlan, label: "" }),
      variant({ id: IDS.overlapA, productId: IDS.overlapping, label: "A", minAge: 18, maxAge: 60, termYears: [20] }),
      variant({ id: IDS.overlapB, productId: IDS.overlapping, label: "B", minAge: 55, maxAge: 70, termYears: [20] }),
      variant({ id: IDS.returnTermAll, productId: IDS.returnTerm, label: "", minAge: 20, maxAge: 60, termYears: [20, 30] }),
    ],
    rates: [
      ...rates(IDS.levelTerm10, { 100: "92.5", 95: "77.25", 130: "83.5" }),
      ...rates(IDS.levelTerm30, { 110: "66", 100: "60" }),
      ...rates(IDS.finalPlanYoung, { 120: "88", 100: "71.5" }),
      ...rates(IDS.finalPlanOld, { 120: "70", 100: "55" }),
      ...rates(IDS.juvenileAll, { 125: "83.40", 100: "64" }),
      ...rates(IDS.zeroPlanAll, { 100: "0" }),
      ...rates(IDS.overlapA, { 100: "50" }),
      ...rates(IDS.overlapB, { 100: "51" }),
      ...rates(IDS.returnTermAll, { 100: "58" }),
    ],
  };
}
