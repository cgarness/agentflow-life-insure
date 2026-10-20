import type { CommissionEstimate } from "./estimate";
import { toCents } from "./money";
import type { ReadyCalculatorContext } from "./types";

/**
 * Phase 2A: what a sale modal sends with the sale when an estimate was DISPLAYED for a policy. These are the
 * presented inputs only; the server re-validates every one against current facts and recomputes the figures,
 * recording an estimate only when they agree. Nothing here is a payment, carrier statement or earned commission.
 */
export const COMMISSION_PAYLOAD_VERSION = "policy-commission-v1";

/** Wire format of one displayed estimate's inputs (snake_case, exactly the server's expected keys). */
export interface CommissionSlotInputs {
  credited_agent_id: string;
  grid_id: string;
  grid_revision: number;
  product_id: string;
  variant_id: string;
  insured_age: number;
  term_years: number | null;
  contract_level: number;
  /** Exact rate text as stored in the grid. */
  rate_percent: string;
  /** The Monthly Premium the sale records, as plain decimal text. */
  monthly_premium: string;
  first_year_cents: number;
  advance_cents: number;
}

/** "primary" = the operation's main policy; a conversion's additional rows use their row UUID. */
export type CommissionSlot = CommissionSlotInputs & { slot: string };

export interface CommissionPayload {
  v: typeof COMMISSION_PAYLOAD_VERSION;
  slots: CommissionSlot[];
}

/** Sent whenever no estimate was displayed: the server still records which operation created the sale. */
export function emptyCommissionPayload(): CommissionPayload {
  return { v: COMMISSION_PAYLOAD_VERSION, slots: [] };
}

export const PRIMARY_SLOT = "primary";

/** Cents as a JSON-safe integer; the server re-derives and compares them exactly. */
function cents(value: CommissionEstimate["firstYearCommission"]): number {
  const result = toCents(value);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Commission amount out of range");
  return Number(result);
}

/** The inputs behind one displayed estimate. Never derived from anything that was not shown. */
export function captureSlotInputs(input: {
  context: ReadyCalculatorContext;
  creditedAgentId: string;
  level: number;
  productId: string;
  variantId: string;
  age: number;
  term: number | null;
  monthlyPremium: string;
  estimate: CommissionEstimate;
}): CommissionSlotInputs {
  return {
    credited_agent_id: input.creditedAgentId,
    grid_id: input.context.grid.id,
    grid_revision: input.context.grid.revision,
    product_id: input.productId,
    variant_id: input.variantId,
    insured_age: input.age,
    term_years: input.term,
    contract_level: input.level,
    rate_percent: input.estimate.ratePercent,
    monthly_premium: input.monthlyPremium,
    first_year_cents: cents(input.estimate.firstYearCommission),
    advance_cents: cents(input.estimate.advance),
  };
}

/** Slots in display order; a slot without a displayed estimate is omitted (never invented). */
export function commissionPayload(entries: Array<{ slot: string; inputs: CommissionSlotInputs | null | undefined }>): CommissionPayload {
  const slots: CommissionSlot[] = [];
  for (const { slot, inputs } of entries) {
    if (inputs) slots.push({ slot, ...inputs });
  }
  return { v: COMMISSION_PAYLOAD_VERSION, slots };
}

/** Stable identity for change detection (key order is fixed by construction). */
export function captureKey(inputs: CommissionSlotInputs | null): string {
  return inputs ? JSON.stringify(inputs) : "";
}
