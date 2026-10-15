import type { CalculatorVariant } from "./types";

/**
 * Variant matching for one product: inclusive age bounds (null = unbounded side) and, for products
 * defined by term lengths, explicit membership of the chosen term. A variant without term lengths never
 * matches a chosen term ("blank" is not a fallback for every length). Several matches are a grid
 * configuration error, never resolved by row order or the largest rate.
 */
export type VariantMatch =
  | { kind: "matched"; variant: CalculatorVariant }
  | { kind: "term_required" }
  | { kind: "no_age" }
  | { kind: "no_term" }
  | { kind: "no_age_term_combination" }
  | { kind: "ambiguous" };

export function usesTermLengths(variants: CalculatorVariant[]): boolean {
  return variants.some((variant) => variant.termYears !== null);
}

/** Distinct supported term lengths of a product, shortest first (empty when terms do not apply). */
export function supportedTermLengths(variants: CalculatorVariant[]): number[] {
  return [...new Set(variants.flatMap((variant) => variant.termYears ?? []))].sort((a, b) => a - b);
}

const ageMatches = (variant: CalculatorVariant, age: number) =>
  (variant.minAge === null || age >= variant.minAge) && (variant.maxAge === null || age <= variant.maxAge);

export function matchVariant(variants: CalculatorVariant[], age: number, term: number | null): VariantMatch {
  const termed = usesTermLengths(variants);
  if (termed && term === null) return { kind: "term_required" };
  const termMatches = (variant: CalculatorVariant) =>
    termed ? (variant.termYears ?? []).includes(term as number) : true;
  const matches = variants.filter((variant) => ageMatches(variant, age) && termMatches(variant));
  if (matches.length > 1) return { kind: "ambiguous" };
  if (matches.length === 1) return { kind: "matched", variant: matches[0] };
  if (termed && !variants.some(termMatches)) return { kind: "no_term" };
  if (!variants.some((variant) => ageMatches(variant, age))) return { kind: "no_age" };
  return { kind: "no_age_term_combination" };
}
