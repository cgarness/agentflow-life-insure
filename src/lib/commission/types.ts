/**
 * Commission Calculator + agency comp grids — shared types.
 * An estimate tool only: never a commission ledger, payroll, underwriting or reporting source.
 */

export type CompCategory = "term" | "whole_life" | "iul";

export const CATEGORY_ORDER: readonly CompCategory[] = ["term", "whole_life", "iul"];

export const CATEGORY_LABELS: Record<CompCategory, string> = {
  term: "Term",
  whole_life: "Whole Life",
  iul: "IUL",
};

export interface CalculatorGrid {
  id: string;
  name: string;
  /** ISO date (YYYY-MM-DD). */
  effectiveDate: string;
  /** Highest first. */
  contractLevels: number[];
  revision: number;
}

export interface CalculatorProduct {
  id: string;
  category: CompCategory;
  carrier: string;
  productName: string;
}

export interface CalculatorVariant {
  id: string;
  productId: string;
  label: string;
  /** Inclusive; null = unbounded on that side. */
  minAge: number | null;
  maxAge: number | null;
  /** null = term length does not apply (never "every term"). */
  termYears: number[] | null;
}

export interface CalculatorRate {
  variantId: string;
  contractLevel: number;
  /** Exact decimal text as stored (e.g. "87.5", "87.50", "0"). Never a binary float. */
  ratePercent: string;
}

export interface ReadyCalculatorContext {
  status: "ready";
  /** The caller's OWN raw profiles.commission_level, unmodified (may be missing or malformed). */
  commissionLevel: string | null;
  grid: CalculatorGrid;
  products: CalculatorProduct[];
  variants: CalculatorVariant[];
  rates: CalculatorRate[];
}

export type CalculatorContext = { status: "no_access" } | { status: "not_configured" } | ReadyCalculatorContext;

export type CalculatorStatus =
  | { status: "no_access" }
  | { status: "not_configured" }
  | { status: "ready"; gridId: string; revision: number };
