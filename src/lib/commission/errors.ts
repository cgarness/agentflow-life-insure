/**
 * Commission RPC errors -> user-facing messages. Server codes: 42501 not permitted · PT404 not available ·
 * PT409 changed by someone else · 22023 invalid request · 23xxx / 22P02 validation. Messages raised by our
 * own functions and triggers are already written for people; generic constraint failures are mapped by
 * constraint name. Never shows raw SQL.
 */
export type CommissionErrorKind = "forbidden" | "not_found" | "conflict" | "invalid" | "validation" | "failed";

export class CommissionApiError extends Error {
  constructor(
    readonly kind: CommissionErrorKind,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "CommissionApiError";
  }
}

interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  comp_rates_rate_valid: "Rates must be between 0 and 300 with at most two decimal places.",
  comp_rates_variant_level_unique: "Each variant has one rate per contract level.",
  comp_grids_name_valid: "Grid names need 1 to 120 characters, without leading or trailing spaces.",
  comp_grids_levels_valid: "Contract levels must be whole numbers from 1 to 999, at most 60 of them.",
  comp_products_carrier_valid: "Carrier names need 1 to 120 characters, without leading or trailing spaces.",
  comp_products_name_valid: "Product names need 1 to 160 characters, without leading or trailing spaces.",
  comp_products_category_valid: "Choose Term, Whole Life or IUL.",
  comp_products_identity: "That carrier already has a product with this name in this category.",
  comp_product_variants_label_valid: "Variant labels can be up to 120 characters, without leading or trailing spaces.",
  comp_product_variants_label_unique: "Each variant of a product needs a different label.",
  comp_product_variants_min_age_valid: "Ages must be whole numbers from 0 to 100.",
  comp_product_variants_max_age_valid: "Ages must be whole numbers from 0 to 100.",
  comp_product_variants_age_order: "A variant's minimum age can't be above its maximum age.",
  comp_product_variants_terms_valid: "Term lengths must be whole numbers from 1 to 100, at most 20 of them.",
  comp_variant_references_source_valid: "The source reference can be up to 2,000 characters.",
  comp_variant_references_notes_valid: "Notes can be up to 4,000 characters.",
};

const OWN_MESSAGE_CODES = new Set(["PT404", "PT409", "22023", "23514", "23P01", "23503", "42501", "XX000"]);
/** PostgreSQL's own wording (never shown): our functions raise plain sentences instead. */
const SYSTEM_MESSAGE = /permission denied|violates|relation "|syntax|column "|function |invalid input|does not exist|null value/i;

function constraintMessage(message: string): string | null {
  const name = /constraint "([a-z0-9_]+)"/.exec(message)?.[1];
  return name ? CONSTRAINT_MESSAGES[name] ?? null : null;
}

export function toCommissionError(error: RpcErrorLike | null | undefined): CommissionApiError {
  const code = error?.code ?? null;
  const raw = error?.message ?? "";
  const mapped = constraintMessage(raw);
  if (mapped) return new CommissionApiError("validation", mapped, code);
  const ownMessage = code && OWN_MESSAGE_CODES.has(code) && raw && !SYSTEM_MESSAGE.test(raw) ? raw : null;
  switch (code) {
    case "42501":
      return new CommissionApiError("forbidden", ownMessage ?? "You don't have permission to do that.", code);
    case "PT404":
      return new CommissionApiError("not_found", ownMessage ?? "That grid isn't available anymore. Reload and try again.", code);
    case "PT409":
      return new CommissionApiError("conflict", ownMessage ?? "Someone else changed this. Reload and try again.", code);
    case "22023":
      return new CommissionApiError("invalid", ownMessage ?? "That request isn't valid. Reload and try again.", code);
    case "22P02":
      return new CommissionApiError("validation", "Enter numbers only where a number is expected.", code);
    case "23505":
      return new CommissionApiError("validation", "That name is already used here.", code);
    case "23503":
    case "23514":
    case "23P01":
      return new CommissionApiError("validation", ownMessage ?? "Some values aren't valid. Check the highlighted fields.", code);
    default:
      return new CommissionApiError("failed", ownMessage ?? "Something went wrong. Try again.", code);
  }
}
