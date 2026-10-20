import { z } from "zod";
import { INSTALLMENT_KINDS, openPolicySchema, type OpenPolicyCommission } from "./trackingSchemas";

/**
 * Commissions center reads (migration 20261020180000): strict parsers. Any unexpected shape throws, so the page shows
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
