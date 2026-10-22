import { saleMonthlyPremium } from "@/lib/policySaleRecording";
import { TEAM_LEADER_ROLE } from "@/lib/effectiveViewer";
import { calculateEstimate } from "./calculator";
import type { CommissionEstimate } from "./estimate";
import {
  LEVEL_MALFORMED_MESSAGE,
  LEVEL_MISSING_MESSAGE,
  LEVEL_NOT_ON_GRID_MESSAGE,
  parseContractLevel,
} from "./contractLevel";
import { supportedTermLengths } from "./matching";
import type { Rational } from "./money";
import { validateCalculatorForm } from "./schemas";
import type { CalculatorProduct, CompCategory, ReadyCalculatorContext } from "./types";

/**
 * Policy commission preview (Phase 1): pure helpers around the UNCHANGED calculator engine. An estimate
 * shown while a policy is entered; never saved, earned, booked or paid commission, and never part of a
 * sale payload.
 */

export const OWN_COMMISSION_PERMISSION = "View Own Commission Percentage";
export const OTHERS_COMMISSION_PERMISSION = "View Others' Commission Percentage";

export const PREVIEW_UNAVAILABLE_MESSAGE = "Commission estimate unavailable";
export const NO_ASSIGNED_AGENT_MESSAGE = "No assigned agent";
export const NO_MATCHING_PRODUCT_MESSAGE = "No matching product on your agency's comp grid";

/**
 * CRM policy type -> comp categories whose products are candidates. The grid has no Final Expense
 * category: Final Expense lists the matched carrier's whole-life products as CANDIDATES only, and the
 * agent must choose the actual product (decision P2). Nothing is assumed to be Final Expense.
 */
const POLICY_TYPE_CATEGORIES = new Map<string, readonly CompCategory[]>([
  ["Term", ["term"]],
  ["Whole Life", ["whole_life"]],
  ["IUL", ["iul"]],
  ["Final Expense", ["whole_life"]],
]);

export function policyTypeCategories(policyType: string): readonly CompCategory[] {
  return POLICY_TYPE_CATEGORIES.get(policyType) ?? [];
}

/** Exact carrier identity: surrounding spaces and letter case only. Never fuzzy, never another carrier. */
const carrierKey = (carrier: string) => carrier.trim().toLowerCase();

/** The selected grid's (active) products for this policy type and carrier, by name. Never auto-selected. */
export function candidateProducts(context: ReadyCalculatorContext, policyType: string, carrier: string): CalculatorProduct[] {
  const categories = policyTypeCategories(policyType);
  const key = carrierKey(carrier);
  if (!key || categories.length === 0) return [];
  return context.products
    .filter((product) => categories.includes(product.category) && carrierKey(product.carrier) === key)
    .sort((a, b) => a.productName.localeCompare(b.productName));
}

export function productTermLengths(context: ReadyCalculatorContext, productId: string): number[] {
  return supportedTermLengths(context.variants.filter((variant) => variant.productId === productId));
}

// ── Insured age prefill ────────────────────────────────────────────────────────────────────────────
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function calendarDate(value: string | null | undefined): { y: number; m: number; d: number } | null {
  const match = ISO_DATE.exec((value ?? "").trim());
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Whole years from a strict ISO date of birth to a strict ISO day; null if either is invalid or birth is later. */
export function ageOnDate(dateOfBirth: string | null | undefined, onDate: string | null | undefined): number | null {
  const birth = calendarDate(dateOfBirth);
  const day = calendarDate(onDate);
  if (!birth || !day) return null;
  const birthdayPassed = day.m > birth.m || (day.m === birth.m && day.d >= birth.d);
  const age = day.y - birth.y - (birthdayPassed ? 0 : 1);
  return age >= 0 ? age : null;
}

const isPreviewAge = (age: unknown): age is number =>
  typeof age === "number" && Number.isInteger(age) && age >= 0 && age <= 100;

/**
 * Prefill only valid age information: a real ISO date of birth gives the age on the policy's Sold Date
 * (blank if that is impossible or over 100); otherwise a stored whole-number age 0–100; otherwise blank.
 */
export function prefillAge(source: { dateOfBirth?: string | null; age?: number | null; onDate?: string | null } | undefined): string {
  if (!source) return "";
  if (calendarDate(source.dateOfBirth)) {
    const years = ageOnDate(source.dateOfBirth, source.onDate);
    return isPreviewAge(years) ? String(years) : "";
  }
  return isPreviewAge(source.age) ? String(source.age) : "";
}

// ── Access (decision P1) ───────────────────────────────────────────────────────────────────────────
export type PreviewAccess = { kind: "own" } | { kind: "other"; needsTeamScope: boolean } | { kind: "denied" };

/**
 * Own and others' permissions are evaluated independently. Another agent's estimate also needs the
 * existing hierarchy: organization-wide viewers (Admin / non-impersonating Super Admin) see their
 * organization, Team Leaders only their Contacts Team scope, Agents never anyone else.
 */
export function previewAccess(input: {
  operatorId: string;
  creditedAgentId: string;
  role: string;
  organizationWide: boolean;
  canSeeOwn: boolean;
  canSeeOthers: boolean;
}): PreviewAccess {
  if (input.creditedAgentId === input.operatorId) return input.canSeeOwn ? { kind: "own" } : { kind: "denied" };
  if (!input.canSeeOthers) return { kind: "denied" };
  if (input.organizationWide) return { kind: "other", needsTeamScope: false };
  if (input.role === TEAM_LEADER_ROLE) return { kind: "other", needsTeamScope: true };
  return { kind: "denied" };
}

// ── Credited agent's contract level ────────────────────────────────────────────────────────────────
export type CreditedLevel = { kind: "valid"; level: number } | { kind: "problem"; message: string };

type LevelProblem = "missing" | "malformed" | "not_on_grid";

const OWN_LEVEL_MESSAGES: Record<LevelProblem, string> = {
  missing: LEVEL_MISSING_MESSAGE,
  malformed: LEVEL_MALFORMED_MESSAGE,
  not_on_grid: LEVEL_NOT_ON_GRID_MESSAGE,
};

const OTHER_LEVEL_MESSAGES: Record<LevelProblem, string> = {
  missing: "This agent's contract level isn't set up.",
  malformed: "This agent's contract level isn't a whole number.",
  not_on_grid: "This agent's contract level isn't on your agency's comp grid.",
};

/** Strict, never defaulted, nearest-matched or replaced by anyone else's level. */
export function resolveCreditedLevel(raw: string | null, contractLevels: number[], isOwn: boolean): CreditedLevel {
  const parsed = parseContractLevel(raw);
  if (parsed.kind === "valid" && contractLevels.includes(parsed.level)) return { kind: "valid", level: parsed.level };
  const problem: LevelProblem = parsed.kind === "valid" ? "not_on_grid" : parsed.kind;
  return { kind: "problem", message: (isOwn ? OWN_LEVEL_MESSAGES : OTHER_LEVEL_MESSAGES)[problem] };
}

export function agentDisplayName(profile: { firstName: string; lastName: string; email: string }): string | null {
  const name = `${profile.firstName.trim()} ${profile.lastName.trim()}`.trim();
  return name || profile.email.trim() || null;
}

// ── Outcome ────────────────────────────────────────────────────────────────────────────────────────
/** The exact inputs behind a displayed estimate (Phase 2A sends them with the sale for server re-validation). */
export interface PreviewEstimateBasis {
  productId: string;
  variantId: string;
  age: number;
  term: number | null;
  monthlyPremium: string;
  estimate: CommissionEstimate;
}

export type PreviewOutcome =
  | { kind: "hint"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "estimate"; firstYearCommission: Rational; advance: Rational; basis: PreviewEstimateBasis };

/** The monthly premium the sale writers would record, as exact text (never a float); "" when blank. */
export function previewPremiumText(raw: string): string {
  try {
    return saleMonthlyPremium(raw) === null ? "" : raw.replace(/[,$\s]/g, "");
  } catch {
    return raw.trim();
  }
}

const OWN_LEVEL_UNAVAILABLE = "Not available at your contract level.";

export function previewOutcome(
  context: ReadyCalculatorContext,
  level: number,
  product: CalculatorProduct | null,
  inputs: { term: string; age: string; monthlyPremium: string },
  isOwn: boolean,
): PreviewOutcome {
  if (!product) return { kind: "hint", message: "Choose a product." };
  const terms = productTermLengths(context, product.id);
  const form = validateCalculatorForm(
    {
      category: product.category,
      carrier: product.carrier,
      productId: product.id,
      age: inputs.age,
      monthlyPremium: previewPremiumText(inputs.monthlyPremium),
      term: inputs.term,
    },
    terms,
  );
  if (!form.ok) {
    const { term, age, monthlyPremium } = form.errors;
    return { kind: "hint", message: term ?? age ?? monthlyPremium ?? PREVIEW_UNAVAILABLE_MESSAGE };
  }
  const result = calculateEstimate(context, level, form);
  if (result.kind === "configuration_error") return { kind: "unavailable", message: PREVIEW_UNAVAILABLE_MESSAGE };
  if (result.kind === "unavailable") {
    const message = !isOwn && result.message === OWN_LEVEL_UNAVAILABLE ? "Not available at this agent's contract level." : result.message;
    return { kind: "unavailable", message };
  }
  return {
    kind: "estimate",
    firstYearCommission: result.estimate.firstYearCommission,
    advance: result.estimate.advance,
    basis: {
      productId: form.productId,
      variantId: result.variantId,
      age: form.age,
      term: form.term,
      monthlyPremium: form.monthlyPremium,
      estimate: result.estimate,
    },
  };
}
