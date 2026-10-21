import { z } from "zod";
import { INSTALLMENT_KINDS, openPolicySchema, type OpenPolicyCommission } from "./trackingSchemas";

/**
 * Commissions center reads (migration 20261020212000): strict parsers. Any unexpected shape throws, so the page shows
 * an error instead of a wrong or partial figure. Amounts are whole cents from saved estimates and manual receipts;
 * neither is carrier-verified.
 */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int().nonnegative();
const count = z.number().int().nonnegative();

export const ROW_STATUSES = ["upcoming", "check_payment", "received", "date_needed", "on_hold", "none"] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];

const contactSchema = z.object({ client_id: uuid, name: z.string().nullable() }).nullable();
export type CenterContact = z.infer<typeof contactSchema>;

const metaSchema = z.object({ today: isoDate, time_zone: z.string().min(1), as_of: z.string() }).passthrough();
const rangeMeta = metaSchema.extend({ from: isoDate, to: isoDate });

const scheduledRowSchema = z.object({
  installment_id: uuid,
  estimate_id: uuid,
  policy_id: uuid,
  kind: z.enum(INSTALLMENT_KINDS),
  expected_cents: cents,
  received_cents: cents,
  remaining_cents: cents,
  excess_cents: cents,
  receipt_count: count,
  timing_precision: z.enum(["unknown", "month", "date"]),
  expected_on: isoDate.nullable(),
  expected_until: isoDate.nullable(),
  window_end: isoDate.nullable(),
  status: z.enum(ROW_STATUSES),
  estimate_status: z.enum(["active", "on_hold"]),
  carrier: z.string(),
  product: z.string(),
  contact: contactSchema,
});
export type ScheduledRow = z.infer<typeof scheduledRowSchema>;

const bucketSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  from: isoDate,
  to: isoDate,
  in_period: z.boolean(),
  received_cents: cents,
  receipt_count: count,
  expected_advance_cents: cents,
  expected_later_cents: cents,
  installment_count: count,
});
export type TimelineBucket = z.infer<typeof bucketSchema>;

export const overviewSchema = z.object({
  meta: rangeMeta.extend({ period: z.string() }),
  summary: z.object({
    expected_cents: cents, expected_count: count, received_cents: cents, received_count: count, remaining_cents: cents,
    excess_cents: cents, held_expected_cents: cents, held_count: count,
  }),
  next_90: z.object({ from: isoDate, to: isoDate, remaining_cents: cents, count }),
  timeline: z.array(bucketSchema),
  review: z.object({
    check_payment: z.object({ count, remaining_cents: cents }),
    date_needed: z.object({ count, remaining_cents: cents }),
    needs_review: z.object({ count }),
    missing_estimate: z.object({ count }),
  }),
  upcoming: z.object({ total_count: count, rows: z.array(scheduledRowSchema) }),
  setup: z.object({ eligible_count: count, with_estimate_count: count }),
});
export type CommissionOverview = z.infer<typeof overviewSchema>;

export const scheduledPageSchema = z.object({
  meta: rangeMeta,
  total_count: count,
  totals: z.object({ expected_cents: cents, received_cents: cents, remaining_cents: cents, excess_cents: cents }),
  held_count: count,
  carriers: z.array(z.string()),
  rows: z.array(scheduledRowSchema),
});
export type ScheduledPage = z.infer<typeof scheduledPageSchema>;

const historyRowSchema = z.object({
  receipt_id: uuid,
  received_on: isoDate,
  recorded_at: z.string(),
  amount_cents: z.number().int().positive(),
  voided: z.boolean(),
  void_reason: z.string().nullable(),
  replaces_receipt_id: uuid.nullable(),
  replaced_by_receipt_id: uuid.nullable(),
  policy_id: uuid,
  installment_id: uuid,
  estimate_id: uuid,
  kind: z.enum(INSTALLMENT_KINDS),
  estimate_status: z.enum(["active", "on_hold", "superseded"]),
  carrier: z.string(),
  product: z.string(),
  contact: contactSchema,
});
export type HistoryRow = z.infer<typeof historyRowSchema>;

export const historyPageSchema = z.object({
  meta: rangeMeta,
  total_count: count,
  totals: z.object({ received_cents: cents, valid_count: count, voided_count: count }),
  rows: z.array(historyRowSchema),
});
export type HistoryPage = z.infer<typeof historyPageSchema>;

export const SETUP_STATES = ["recorded", "on_hold", "needs_review", "missing"] as const;
export type SetupState = (typeof SETUP_STATES)[number];

const policyRowSchema = z.object({
  policy_id: uuid,
  setup: z.enum(SETUP_STATES),
  contact: contactSchema,
  source: z.enum(["primary", "additional"]).nullable(),
  carrier: z.string().nullable(),
  product: z.string().nullable(),
  effective_date: isoDate.nullable(),
  estimate_cents: cents.nullable(),
  received_cents: cents.nullable(),
  remaining_cents: cents.nullable(),
  excess_cents: cents.nullable(),
  date_needed_count: count,
  next_payment: z.object({
    kind: z.enum(INSTALLMENT_KINDS),
    timing_precision: z.enum(["unknown", "month", "date"]),
    expected_on: isoDate.nullable(),
    expected_until: isoDate.nullable(),
    remaining_cents: cents,
    status: z.enum(ROW_STATUSES),
  }).nullable(),
});
export type PolicyRow = z.infer<typeof policyRowSchema>;

export const policiesPageSchema = z.object({
  meta: metaSchema,
  total_count: count,
  counts: z.object({ eligible_count: count, with_estimate_count: count, missing_count: count, needs_review_count: count, on_hold_count: count }),
  carriers: z.array(z.string()),
  rows: z.array(policyRowSchema),
});
export type PoliciesPage = z.infer<typeof policiesPageSchema>;

/**
 * The drawer read: one policy in exactly the contact read's per-policy shape. `source` is unknown (null) for a contact
 * the viewer can no longer open; the reused tracking controls never read it.
 */
const drawerPolicySchema = openPolicySchema.extend({ source: z.enum(["primary", "additional"]).nullable() });
const drawerSchema = z.object({ policy: drawerPolicySchema, contact: contactSchema, meta: metaSchema });
export type DrawerPolicy = z.infer<typeof drawerPolicySchema>;
export interface CommissionDrawerData { policy: DrawerPolicy; contact: CenterContact }

/**
 * The reused Phase 2A controls take the contact read's policy type; they never read `source`, which is the only field
 * that can differ (unknown for a restricted contact).
 */
export const asTrackedPolicy = (policy: DrawerPolicy) => policy as Omit<DrawerPolicy, "source"> as OpenPolicyCommission;

export function parseDrawer(raw: unknown): CommissionDrawerData {
  const parsed = drawerSchema.parse(raw);
  if (parsed.policy.state === "recorded" && !parsed.policy.estimate) throw new Error("Recorded commission without an estimate");
  return { policy: parsed.policy, contact: parsed.contact };
}

/**
 * Commissions insights (migration 20261021180000). The sales cohort is by Sold Date; Est. commission is the saved
 * first-year figure of ACTIVE estimates (held ones are disclosed separately); Received is receipts by received date.
 * Groups must add up to their totals, or the response is refused (no partial or inconsistent figure is drawn).
 */
export const PRODUCT_CATEGORIES = ["term", "whole_life", "iul", "final_expense", "other", "unknown"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
const cohort = {
  policies: count, with_estimate_count: count, estimate_cents: cents, on_hold_count: count, on_hold_cents: cents, without_estimate_count: count,
};
const carrierGroupSchema = z.object({ carrier: z.string().min(1).nullable(), ...cohort, received_cents: cents, receipt_count: count });
const productGroupSchema = z.object({ category: z.enum(PRODUCT_CATEGORIES), ...cohort });
export type CarrierGroup = z.infer<typeof carrierGroupSchema>;
export type ProductGroup = z.infer<typeof productGroupSchema>;
const windowSchema = z.object({ from: isoDate, to: isoDate, policies: count, with_estimate_count: count, estimate_cents: cents,
  received_cents: cents, receipt_count: count });
export type ComparisonWindow = z.infer<typeof windowSchema>;
export const COMPARISON_BASES = ["months", "months_to_date", "days", "days_to_date"] as const;
const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);

export const breakdownSchema = z.object({
  meta: rangeMeta.extend({ period: z.string() }),
  sold: z.object({ ...cohort, needs_review_count: count, undated_count: count }),
  received: z.object({ received_cents: cents, receipt_count: count }),
  carriers: z.array(carrierGroupSchema),
  products: z.array(productGroupSchema),
  comparison: z.object({ basis: z.enum(COMPARISON_BASES), current: windowSchema, previous: windowSchema }).nullable(),
  months_10_12: z.object({ from: isoDate, to: isoDate, remaining_cents: cents, payment_count: count, policy_count: count }),
}).superRefine((b, ctx) => {
  const ok = sum(b.carriers, (g) => g.policies) === b.sold.policies && sum(b.products, (g) => g.policies) === b.sold.policies
    && sum(b.carriers, (g) => g.estimate_cents) === b.sold.estimate_cents && sum(b.products, (g) => g.estimate_cents) === b.sold.estimate_cents
    && sum(b.carriers, (g) => g.received_cents) === b.received.received_cents
    && new Set(b.products.map((g) => g.category)).size === b.products.length
    // Each server group is labelled by one of its own names, so distinct groups never share a label. The key itself is
    // not re-derived here: JS case folding is not Postgres lower() for every character.
    && new Set(b.carriers.map((g) => g.carrier)).size === b.carriers.length;
  if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Breakdown groups do not add up" });
});
export type CommissionBreakdown = z.infer<typeof breakdownSchema>;

const policyListRowSchema = policyRowSchema.extend({ category: z.enum(PRODUCT_CATEGORIES), sold_date: isoDate.nullable() });
export type PolicyListRow = z.infer<typeof policyListRowSchema>;
export const policyListSchema = policiesPageSchema.extend({
  totals: z.object(cohort),
  has_unknown_carrier: z.boolean(),
  rows: z.array(policyListRowSchema),
});
export type PolicyListPage = z.infer<typeof policyListSchema>;

export const receiptListSchema = historyPageSchema.extend({ carriers: z.array(z.string()), has_unknown_carrier: z.boolean() });
export type ReceiptListPage = z.infer<typeof receiptListSchema>;

/** A monthly goal in whole cents ($0.01 to $1,000,000.00, the server's limits); null when none is set. */
export const GOAL_MAX_CENTS = 100_000_000;
const goalCents = z.number().int().min(1).max(GOAL_MAX_CENTS);
export const goalSchema = z.object({ month: isoDate, target_cents: goalCents.nullable(), updated_at: z.string().nullable(), meta: metaSchema });
export type CommissionGoal = z.infer<typeof goalSchema>;
export const goalSetSchema = z.object({ month: isoDate, target_cents: goalCents, updated_at: z.string() });
export const goalClearSchema = z.object({ month: isoDate, cleared: z.boolean() });
