import { z } from "zod";

/**
 * Phase 2A saved policy commissions: strict parsers for the contact read and the tracking functions. Estimates
 * are illustrative; receipts are manually recorded by the agent or an admin. Neither is carrier-verified.
 */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int().nonnegative();

export const INSTALLMENT_KINDS = ["advance", "month_10", "month_11", "month_12"] as const;
export type InstallmentKind = (typeof INSTALLMENT_KINDS)[number];
export type TimingPrecision = "unknown" | "month" | "date";

const receiptSchema = z.object({
  id: uuid,
  amount_cents: z.number().int().positive(),
  received_on: isoDate,
  reference: z.string().nullable(),
  recorded_by: uuid,
  recorded_at: z.string(),
  replaces_receipt_id: uuid.nullable(),
  voided_at: z.string().nullable(),
  void_reason: z.string().nullable(),
});

const installmentSchema = z.object({
  id: uuid,
  kind: z.enum(INSTALLMENT_KINDS),
  expected_cents: cents,
  timing_precision: z.enum(["unknown", "month", "date"]),
  expected_on: isoDate.nullable(),
  timing_source: z.enum(["unset", "schedule_basis", "manual"]),
  receipts: z.array(receiptSchema),
});

const estimateSchema = z.object({
  id: uuid,
  status: z.enum(["active", "on_hold"]),
  status_reason: z.string().nullable(),
  capture_mode: z.enum(["sale_entry", "recorded_later"]),
  captured_by: uuid.nullable(),
  recorded_by: uuid,
  recorded_at: z.string(),
  grid_name: z.string(),
  grid_revision: z.number().int().positive(),
  grid_effective_date: isoDate,
  product_name: z.string(),
  product_carrier: z.string(),
  variant_label: z.string(),
  insured_age: z.number().int(),
  term_years: z.number().int().nullable(),
  contract_level: z.number().int(),
  rate_percent: z.string(),
  monthly_premium: z.string(),
  premium_source: z.enum(["sale_snapshot", "policy_record"]),
  first_year_cents: cents,
  advance_cents: cents,
  schedule_start_on: isoDate.nullable(),
  schedule_start_source: z.enum(["effective_date", "manual"]).nullable(),
  state_revision: z.number().int().positive(),
  installments: z.array(installmentSchema).length(4),
});

const captureSchema = z.object({
  id: uuid,
  status: z.enum(["awaiting_confirmation", "needs_attention"]),
  attention_code: z.string().nullable(),
  first_year_cents: cents,
  advance_cents: cents,
  captured_by: uuid,
  captured_at: z.string(),
  product_id: uuid,
  insured_age: z.number().int(),
  term_years: z.number().int().nullable(),
});

const basisSchema = z.object({
  policy_type: z.string().nullable(),
  carrier: z.string().nullable(),
  monthly_premium: z.string().nullable(),
  premium_source: z.enum(["sale_snapshot", "policy_record"]).nullable(),
  effective_date: isoDate.nullable(),
});

const closedPolicySchema = z.object({
  policy_id: uuid,
  source: z.enum(["primary", "additional"]),
  state: z.enum(["hidden", "unavailable"]),
});

const openPolicySchema = z.object({
  policy_id: uuid,
  source: z.enum(["primary", "additional"]),
  state: z.enum(["not_recorded", "recorded", "awaiting_confirmation", "needs_attention"]),
  access: z.enum(["write", "read"]),
  credited_agent_id: uuid,
  win_id: uuid,
  basis: basisSchema,
  estimate: estimateSchema.nullable(),
  capture: captureSchema.nullable(),
});

const responseSchema = z.object({
  client_id: uuid,
  policies: z.array(z.union([closedPolicySchema, openPolicySchema])),
});

export type CommissionReceipt = z.infer<typeof receiptSchema>;
export type CommissionInstallment = z.infer<typeof installmentSchema>;
export type CommissionEstimateRecord = z.infer<typeof estimateSchema>;
export type CommissionCapture = z.infer<typeof captureSchema>;
export type PolicyCommissionBasis = z.infer<typeof basisSchema>;
export type ClosedPolicyCommission = z.infer<typeof closedPolicySchema>;
export type OpenPolicyCommission = z.infer<typeof openPolicySchema>;
export type PolicyCommission = ClosedPolicyCommission | OpenPolicyCommission;
export interface ClientPolicyCommissions {
  clientId: string;
  policies: PolicyCommission[];
}

/** Throws on any unexpected shape: the contact view then shows nothing rather than a wrong figure. */
export function parseClientPolicyCommissions(raw: unknown): ClientPolicyCommissions {
  const parsed = responseSchema.parse(raw);
  for (const policy of parsed.policies) {
    if (policy.state === "recorded" && !("estimate" in policy && policy.estimate)) throw new Error("Recorded commission without an estimate");
  }
  return { clientId: parsed.client_id, policies: parsed.policies };
}

export const isOpenPolicy = (policy: PolicyCommission): policy is OpenPolicyCommission =>
  policy.state !== "hidden" && policy.state !== "unavailable";

const stateResult = z.object({ estimate_id: uuid, state_revision: z.number().int().positive(), status: z.literal("ok") }).passthrough();
const recordedResult = z.object({ estimate_id: uuid, status: z.literal("recorded") }).passthrough();

export const trackingResultSchemas = {
  state: stateResult,
  void: stateResult.extend({ replacement_receipt_id: uuid.nullable() }),
  receipt: z.object({ receipt_id: uuid, status: z.literal("recorded"), idempotent: z.boolean() }),
  confirm: z.union([recordedResult, z.object({ status: z.literal("needs_attention"), code: z.string() })]),
  dismiss: z.object({ status: z.literal("dismissed"), capture_id: uuid }),
  later: z.union([recordedResult, z.object({ status: z.literal("changed"), code: z.string() })]),
};
