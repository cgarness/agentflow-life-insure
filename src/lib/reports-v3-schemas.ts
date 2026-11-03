// Reports v3 contract (D1 §4, D6 §3, §4.3). Parses the SQL shape verbatim; nothing is renamed. Any violation fails
// only that panel, closed. There is no v2 fallback.
import { z } from "zod";
import { reportWindowSchema, requestedScopeSchema } from "@/lib/reports-schemas";

export const REPORT_V3_REASON_CODES = [
  "evidence_not_captured", "sale_call_link_not_captured", "classification_not_configured",
  "outcome_capture_not_started", "journey_scope_restricted",
  "no_policies_sold", "no_calls_made", "no_lead_calls", "no_first_time_buyers", "no_first_contacts",
  "no_due_sales_appointments", "no_held_sales_appointments", "no_attributed_policies", "premium_not_entered",
  "capture_gap", "outcome_capture_partial_period", "appointment_type_unclassified", "outcomes_unresolved",
  "attribution_unresolved", "legacy_booking_basis", "attempt_unverified", "unlinked_contacted_calls",
  "unlinked_calls_excluded", "history_incomplete", "lead_receipt_unknown", "sale_call_link_missing",
  "premium_invalid", "premium_missing",
  "panel_not_loaded",
] as const;
export type ReasonCode = (typeof REPORT_V3_REASON_CODES)[number];
export type ReasonKind = "config" | "zero" | "coverage" | "export";
export const REASON_KIND = Object.fromEntries(REPORT_V3_REASON_CODES.map((code, i) => [code,
  i < 5 ? "config" : i < 14 ? "zero" : i < 28 ? "coverage" : "export"])) as Record<ReasonCode, ReasonKind>;

/** Window-level conditions: Partial without per-item unassessable counts (§2.2 rule 3, RL-2, RL-29). */
const WINDOW_LEVEL: ReadonlySet<ReasonCode> = new Set(["outcome_capture_partial_period", "capture_gap", "history_incomplete", "legacy_booking_basis"]);

export const READER_KPI_IDS = {
  summary: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 24, 25, 34],
  journey: [14, 19, 21, 38],
  sales_appointments: [12, 15, 16, 17, 18],
} as const;
export const REPORT_V3_KPI_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 21, 24, 25, 34, 38] as const;
const COHORT_KPIS = new Set([12, 18, 19]);

const reasonSchema = z.enum(REPORT_V3_REASON_CODES).refine(c => c !== "panel_not_loaded", "panel_not_loaded is a CSV status only");
const count = z.number().int().nonnegative();

export const coverageSchema = z.object({
  eligible: count, assessable: count, unassessable: count, reasons: z.record(z.enum(REPORT_V3_REASON_CODES), count),
}).strict();

export const maturitySchema = z.object({
  window_days: z.literal(30), state: z.enum(["in_progress", "complete"]), members: count, pending: count,
  successes_to_date: count, mature_members: count, mature_successes: count, fully_mature_on: z.string().nullable(),
}).strict().refine(m => (m.state === "in_progress") === (m.pending > 0), "in_progress iff pending > 0");

// Standard detail fields (§2.4 names, X6, RL-34): each KPI's detail accepts exactly its keys.
const premiumDetail = z.object({ known: count, missing: count, invalid: count, legacy_record_fallback: count }).strict();
const callPopulationSchema = z.object({ attempts: count, non_attempts: count, unverified: count, duplicates_excluded: count }).strict();
const historyDetail = z.object({
  assessable: count, unassessable_by: z.record(z.string(), count), numberless_unresolved_calls: count.nullable(),
}).strict();
const journeyDetail = z.object({
  history: historyDetail, unresolved_activity: z.record(z.string(), count).optional(), classification: z.unknown().optional(),
}).strict();
const appointmentDetail = z.object({
  capture: z.object({ outcomes_started_on: z.string().nullable() }).passthrough().optional(),
  disclosures: z.record(z.string(), count).optional(), basis_counts: z.record(z.string(), count).optional(),
  due_outcomes: z.unknown().optional(), attribution: z.unknown().optional(), unresolved_breakdown: z.unknown().optional(),
  policies: z.unknown().optional(), classes: z.unknown().optional(), unattributed: z.unknown().optional(),
}).strict();

const DETAIL: Record<number, z.ZodTypeAny> = {
  1: z.object({ premium: premiumDetail, premium_sources: z.record(z.string(), count).optional(),
    corrections_applied: count.optional(), unattributed_annual_premium: z.number().nonnegative().nullable().optional() }).strict(),
  2: z.object({ quality: z.object({ undated_policies: count, unattributed_policies: count.nullable(), missing_policy_identity: count.nullable() }).strict(),
    stored_without_sale: count.nullable().optional() }).strict(),
  3: z.object({ client_record_deleted: count }).strict(),
  4: z.object({ premium: premiumDetail }).strict(),
  5: z.object({ call_population: callPopulationSchema }).strict(),
  24: z.object({ quality: z.object({ estimated: count, unknown: count, conflicting: count, inconsistent: count,
    provider_confirmed: count, duplicates_excluded: count }).strict() }).strict(),
  25: z.object({ quality: z.object({ stale_capped: count, late_ended: count }).strict() }).strict(),
  14: journeyDetail, 19: journeyDetail, 21: journeyDetail, 38: journeyDetail,
  12: appointmentDetail, 15: appointmentDetail, 16: appointmentDetail, 17: appointmentDetail, 18: appointmentDetail,
};

export const kpiEnvelopeSchema = z.object({
  id: z.number().int(),
  value: z.number().nullable(),
  status: z.enum(["available", "partial", "unavailable"]),
  reason: reasonSchema.nullable(),
  numerator: z.number().nullable(),
  denominator: z.number().nullable(),
  coverage: coverageSchema.nullable(),
  maturity: maturitySchema.nullable(),
  detail: z.unknown(),
}).strict().superRefine((e, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: `KPI ${e.id}: ${message}` });
  if (!(REPORT_V3_KPI_IDS as readonly number[]).includes(e.id)) return bad("unknown KPI id");
  const detail = DETAIL[e.id];
  if (e.detail !== null && e.detail !== undefined) {
    if (!detail) bad("detail not allowed");
    else if (!detail.safeParse(e.detail).success) bad("detail shape");
  }
  const cov = e.coverage;
  if (cov) {
    if (cov.assessable + cov.unassessable !== cov.eligible) bad("assessable + unassessable must equal eligible");
    for (const code of Object.keys(cov.reasons) as ReasonCode[]) if (REASON_KIND[code] !== "coverage") bad(`${code} is not a coverage code`);
  }
  const windowLevel = !!cov && Object.keys(cov.reasons).some(c => WINDOW_LEVEL.has(c as ReasonCode));
  if (e.status === "unavailable") {
    if (e.value !== null) bad("unavailable needs a null value");
    if (!e.reason) return bad("unavailable needs a reason");
    if (REASON_KIND[e.reason] === "coverage") {
      const noneKnown = cov && (cov.assessable === 0 || (e.denominator === 0 && cov.unassessable > 0));
      if (!noneKnown) bad("a coverage reason makes a KPI unavailable only when nothing on the deciding side is known");
    }
  } else {
    if (e.value === null) bad(`${e.status} needs a value`);
    if (e.denominator === 0) bad("a known denominator of 0 is unavailable, never a ratio");
    if (e.status === "partial") {
      if (!e.reason || REASON_KIND[e.reason] !== "coverage") bad("partial needs a coverage reason");
      if (!cov || (cov.unassessable === 0 && !windowLevel)) bad("partial needs unassessable items or a window-level condition");
    } else {
      if (e.reason !== null) bad("available has no reason");
      if (cov && cov.unassessable > 0) bad("available has no unassessable items");
    }
  }
  if (e.maturity) {
    if (!COHORT_KPIS.has(e.id)) bad("maturity only on KPIs 12, 18 and 19");
  } else if (COHORT_KPIS.has(e.id) && e.status !== "unavailable") bad("an available or partial 12, 18 or 19 carries maturity");
});
export type KpiEnvelope = z.infer<typeof kpiEnvelopeSchema>;

const basisSchema = z.object({
  corrections: z.enum(["not_installed", "audited_ledger"]),
  sale_call_links: z.enum(["not_installed", "installed"]),
  appointment_evidence: z.enum(["not_installed", "installed"]),
}).strict();
const metaFields = {
  basis_version: z.literal("reports_v3"),
  contract_version: z.string().regex(/^3\.\d+\.\d+$/),
  scope: z.enum(["own", "team", "organization"]),
  requested_scope: requestedScopeSchema,
  filter_agent_id: z.string().uuid().nullable(),
  window: reportWindowSchema,
  as_of: z.string(),
  agency_today: z.string(),
  period_open: z.boolean(),
  basis: basisSchema,
};
const policyBasisSchema = z.object({
  source: z.literal("original_policy_sales"), credit: z.literal("original_seller"), date: z.literal("sold_date"), premium: z.string(),
}).strict();

const metricsFor = (ids: readonly number[]) => z.array(kpiEnvelopeSchema).refine(
  ms => ms.length === ids.length && ms.every((m, i) => m.id === ids[i]), `metrics must be exactly ${ids.join(", ")} in order`);

const CREDIT = z.enum(["original_seller", "placing_agent", "setter", "assigned_agent_at_start", "first_contact_agent",
  "session_agent", "placing_agent_and_original_seller"]);
const byAgentFor = (ids: readonly number[]) => z.array(z.object({
  agent_id: z.string().uuid(), name: z.string(), status: z.string().nullable(),
  credit: z.record(z.string(), CREDIT), metrics: metricsFor(ids),
}).strict().refine(r => ids.every(id => r.credit[String(id)]), "a credit key for every metric (X5)"));

export const reportScopeV3Schema = z.object({
  basis_version: z.literal("reports_v3"), contract_version: z.string().regex(/^3\.\d+\.\d+$/), reader: z.literal("scope"),
  role: z.string(), scope: z.enum(["own", "team", "organization"]), requested_scope: requestedScopeSchema.nullable(),
  available_scopes: z.array(requestedScopeSchema), self_id: z.string().uuid(), filter_agent_id: z.string().uuid().nullable(),
  agents: z.array(z.object({ id: z.string().uuid(), name: z.string(), status: z.string().nullable() }).strict()),
  can_export: z.boolean(), max_range_days: z.number().int().positive(), today: z.string(), time_zone: z.string(),
  time_zone_source: z.string(), as_of: z.string(), basis: basisSchema,
}).strict();

export const reportSummaryV3Schema = z.object({
  ...metaFields, reader: z.literal("summary"), policy_basis: policyBasisSchema,
  metrics: metricsFor(READER_KPI_IDS.summary), by_agent: byAgentFor(READER_KPI_IDS.summary),
  production_by_date: z.array(z.object({
    date: z.string(), policies_sold: count, annual_premium: z.number().nonnegative(), premium_known: count, premium_missing: count, premium_invalid: count,
  }).strict()),
  call_population: callPopulationSchema,
}).strict();

export const reportJourneyV3Schema = z.object({
  ...metaFields, reader: z.literal("journey"), policy_basis: policyBasisSchema,
  metrics: metricsFor(READER_KPI_IDS.journey), by_agent: byAgentFor(READER_KPI_IDS.journey),
}).strict();

export const reportSalesAppointmentsV3Schema = z.object({
  ...metaFields, reader: z.literal("sales_appointments"),
  metrics: metricsFor(READER_KPI_IDS.sales_appointments), by_agent: byAgentFor(READER_KPI_IDS.sales_appointments),
}).strict();

const callRow = { calls_made: count, contacted_calls: count, contact_rate_numerator: count, contact_rate_denominator: count };
const callMeta = { ...metaFields, metrics: z.array(z.never()).length(0), call_population: callPopulationSchema };

export const reportCallVolumeV3Schema = z.object({
  ...callMeta, reader: z.literal("call_volume"), inbound_calls: count,
  heatmap: z.array(z.object({ dow: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23), calls_made: count, contacted: count }).strict()).length(168),
  by_date: z.array(z.object({ date: z.string(), calls_made: count, contacted: count, inbound_calls: count, talk_time_seconds: count }).strict()),
  by_hour: z.array(z.object({ hour: z.number().int(), calls_made: count, contacted: count }).strict()),
  by_weekday: z.array(z.object({ dow: z.number().int(), calls_made: count, contacted: count }).strict()),
}).strict();

export const reportDispositionsV3Schema = z.object({
  ...callMeta, reader: z.literal("disposition_breakdown"),
  by_disposition: z.array(z.object({
    key: z.string(), name: z.string(), color: z.string().nullable(), calls: count, duration_seconds: count,
    counts_as_contacted: z.boolean(), converts: z.boolean(), dnc: z.boolean(), callback: z.boolean(), appointment: z.boolean(),
  }).strict()),
  duration_buckets: z.array(z.object({ range: z.string(), calls: count }).strict()),
  deep_dive: z.record(z.string(), z.unknown()),
}).strict();

export const reportCampaignCallsV3Schema = z.object({
  ...callMeta, reader: z.literal("campaign_calls"),
  campaigns: z.array(z.object({ campaign_id: z.string().uuid(), name: z.string(), type: z.string().nullable(), ...callRow }).strict()),
  calls_without_campaign: z.object(callRow).strict(),
  other_campaigns: z.object(callRow).strict(),
}).strict();

export const reportLeadSourceCallsV3Schema = z.object({
  ...callMeta, reader: z.literal("lead_source_calls"),
  sources: z.array(z.object({ lead_source: z.string(), new_leads: count, ...callRow }).strict()),
  not_linked: z.object(callRow).strict(),
}).strict();

// D5 owns the state breakdown's detailed schema; the page reads its documented keys and fails closed on the marker.
export const reportStateBreakdownV3Schema = z.object({
  ...callMeta, reader: z.literal("state_breakdown"), policy_basis: policyBasisSchema,
  modes: z.record(z.string(), z.object({ metric_id: z.number().int(), status: z.enum(["available", "partial", "unavailable"]), reason: reasonSchema.nullable() }).strict()),
  jurisdictions: z.array(z.object({ state: z.string().length(2) }).passthrough()).length(51),
  unmapped: z.object({ reasons: z.array(z.object({ reason: z.string() }).passthrough()).length(6) }).passthrough(),
  totals: z.record(z.string(), z.unknown()),
  state_basis: z.record(z.string(), z.unknown()),
}).strict();

export type ReportScopeV3 = z.infer<typeof reportScopeV3Schema>;
export type ReportSummaryV3 = z.infer<typeof reportSummaryV3Schema>;
export type ReportJourneyV3 = z.infer<typeof reportJourneyV3Schema>;
export type ReportSalesAppointmentsV3 = z.infer<typeof reportSalesAppointmentsV3Schema>;
export type ReportCallVolumeV3 = z.infer<typeof reportCallVolumeV3Schema>;
export type ReportDispositionsV3 = z.infer<typeof reportDispositionsV3Schema>;
export type ReportCampaignCallsV3 = z.infer<typeof reportCampaignCallsV3Schema>;
export type ReportLeadSourceCallsV3 = z.infer<typeof reportLeadSourceCallsV3Schema>;
export type ReportStateBreakdownV3 = z.infer<typeof reportStateBreakdownV3Schema>;
export type ByAgentRow = ReportSummaryV3["by_agent"][number];
