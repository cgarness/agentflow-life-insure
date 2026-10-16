import {
  LEVEL_MALFORMED_MESSAGE,
  LEVEL_MISSING_MESSAGE,
  LEVEL_NOT_ON_GRID_MESSAGE,
  parseContractLevel,
} from "./contractLevel";
import { estimateCommission, type CommissionEstimate } from "./estimate";
import { matchVariant } from "./matching";
import type { ReadyCalculatorContext } from "./types";

/** The caller's own level against the selected grid. Only "valid" can produce an estimate. */
export type LevelState =
  | { kind: "valid"; level: number }
  | { kind: "missing"; message: string }
  | { kind: "malformed"; message: string }
  | { kind: "not_on_grid"; level: number; message: string };

export function resolveLevel(context: ReadyCalculatorContext): LevelState {
  const parsed = parseContractLevel(context.commissionLevel);
  if (parsed.kind === "missing") return { kind: "missing", message: LEVEL_MISSING_MESSAGE };
  if (parsed.kind === "malformed") return { kind: "malformed", message: LEVEL_MALFORMED_MESSAGE };
  if (!context.grid.contractLevels.includes(parsed.level)) {
    return { kind: "not_on_grid", level: parsed.level, message: LEVEL_NOT_ON_GRID_MESSAGE };
  }
  return { kind: "valid", level: parsed.level };
}

export interface CalculatorRequest {
  productId: string;
  age: number;
  /** Required for products defined by term lengths; null otherwise. */
  term: number | null;
  /** Validated plain decimal text, > 0. */
  monthlyPremium: string;
}

export type CalculatorResult =
  | { kind: "estimate"; estimate: CommissionEstimate; variantId: string }
  | { kind: "unavailable"; message: string }
  | { kind: "configuration_error"; message: string };

export const AMBIGUOUS_GRID_MESSAGE =
  "This product has overlapping age or term ranges in your agency's comp grid, so no estimate is shown. Ask your admin to fix the grid.";

const unavailable = (message: string): CalculatorResult => ({ kind: "unavailable", message });

/** One estimate from the selected grid, the agent's valid level and complete, validated inputs. */
export function calculateEstimate(
  context: ReadyCalculatorContext,
  level: number,
  request: CalculatorRequest,
): CalculatorResult {
  const product = context.products.find((candidate) => candidate.id === request.productId);
  if (!product) return unavailable("This product isn't available in your agency's comp grid.");
  const variants = context.variants.filter((variant) => variant.productId === product.id);
  const match = matchVariant(variants, request.age, request.term);
  switch (match.kind) {
    case "no_age":
      return unavailable("Not available for this age.");
    case "no_term":
      return unavailable("Not available for this term length.");
    case "no_age_term_combination":
      return unavailable(`Not available for a ${request.term}-year term at age ${request.age}.`);
    case "term_required":
      return unavailable("Choose a term length.");
    case "ambiguous":
      return { kind: "configuration_error", message: AMBIGUOUS_GRID_MESSAGE };
    case "matched":
      break;
  }
  const rate = context.rates.find(
    (candidate) => candidate.variantId === match.variant.id && candidate.contractLevel === level,
  );
  if (!rate) return unavailable("Not available at your contract level.");
  const estimate = estimateCommission(request.monthlyPremium, rate.ratePercent);
  if (!estimate) return { kind: "configuration_error", message: "This estimate couldn't be calculated." };
  return { kind: "estimate", estimate, variantId: match.variant.id };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];

/** "2025-11-20" -> "November 20, 2025" without any time-zone shift. */
export function formatEffectiveDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}

export function disclaimerText(gridName: string, effectiveDate: string): string {
  return `Estimate only. Assumes a 75% advance. Actual commission and payment timing may vary by age, plan type and carrier rules. Based on the ${gridName} effective ${formatEffectiveDate(effectiveDate)}.`;
}
