/**
 * reports-schemas.ts — runtime contracts for the secured Reports v2 RPCs
 * (supabase/migrations/20261006043738_reports_scopes_and_policy_premium.sql).
 *
 * Every payload is parsed before it reaches the UI. A payload that does not match is treated as an
 * UNAVAILABLE report, never as zeros: a silently mis-shaped response is how a failed report used to
 * render as a confident "0".
 *
 * Rates are `number | null` — `null` means the denominator was zero and renders as "—", never "0%".
 * There is deliberately no conversion-rate field anywhere (plan rev 2 §R2.2).
 *
 * Policy fields follow supabase/migrations/20261002160849_reports_policies_sold_normalized_source.sql.
 */
import { z } from "zod";

const count = z.number().int().nonnegative();
const rate = z.number().nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// The server never reports in a guessed zone: an unconfigured agency time zone is an error (55000),
// so the only source a payload can carry is the organization's own setting.
const timeZoneSource = z.literal("agency_settings");

export const reportWindowSchema = z.object({
  time_zone: z.string().min(1),
  time_zone_source: timeZoneSource,
  start_date: isoDate,
  end_date: isoDate,
  start_at: z.string(),
  end_at: z.string(),
});

export const reportScopeKindSchema = z.enum(["own", "team", "organization"]);

/**
 * Policies Sold comes from NORMALIZED STORED POLICIES (clients + additional_policies, by the policy's
 * sale date), never from wins (migration 20261002160849). The marker is REQUIRED: a payload without it
 * is a win-based function (not yet migrated, or a recovery state) and is treated as UNAVAILABLE, never
 * shown under the policy labels.
 */
const policySource = z.literal("normalized_policies");

/** Scope-wide, ALL-TIME data-quality counts — never implied to belong to the selected period. */
export const policyQualitySchema = z.object({
  basis: z.literal("scope_wide_all_time"),
  undated_policies: count,
  malformed_additional_policies: count,
});

export const requestedScopeSchema = z.enum(["personal", "team", "agency"]);
export type ReportRequestedScope = z.infer<typeof requestedScopeSchema>;
export const reportPremiumSchema = z.object({
  policy_count: count, known_count: count, unknown_count: count,
  monthly_premium: z.number().nonnegative().nullable(), annual_premium: z.number().nonnegative().nullable(),
  average_annual_premium: z.number().nonnegative().nullable(), coverage_pct: rate,
  invalid_count: count, ambiguous_zero_count: count, missing_identity_count: count,
  basis: z.literal("current_stored_monthly_x12"),
});
export type ReportPremium = z.infer<typeof reportPremiumSchema>;
export const reportQualitySchema = z.object({
  basis: z.literal("reports_integrity_v2"), as_of: z.string().datetime({ offset: true }),
  duration: z.object({ outbound_calls: count, estimated_calls: count, unknown_calls: count, conflicting_calls: count }),
  duplicates: z.object({ excluded_outbound_calls: count, excluded_bookings: count, basis: z.literal("reviewed_mappings_only") }),
  bookings: z.object({ all_types: count, appointment_kind: count, callback_kind: count, unknown_kind: count }),
  sessions: z.object({ stale_capped: count, missing_evidence: count, overlapping_rows: count, overlap_seconds_removed: count }),
});
export type ReportQuality = z.infer<typeof reportQualitySchema>;
const integrityMeta = { basis_version: z.literal("reports_integrity_v2"), as_of: z.string().datetime({ offset: true }), requested_scope: requestedScopeSchema };
const sessionCohort = { session_matched_calls: count, session_matched_contacted: count, session_matched_talk_seconds: count, session_unmatched_calls: count };

const reportMetaSchema = z.object({
  ...integrityMeta, quality: reportQualitySchema,
  scope: reportScopeKindSchema,
  filter_agent_id: z.string().uuid().nullable(),
  window: reportWindowSchema,
});

export const reportScopeSchema = z.object({
  ...integrityMeta, available_scopes: z.array(requestedScopeSchema).min(1),
  scope: reportScopeKindSchema,
  role: z.string(),
  can_export: z.boolean(),
  self_id: z.string().uuid(),
  time_zone: z.string().min(1),
  time_zone_source: timeZoneSource,
  today: isoDate,
  max_range_days: z.number().int().positive(),
  agents: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      status: z.string().nullable(),
    }),
  ),
});

export const reportAgentRowSchema = z.object({
  ...sessionCohort, premium: reportPremiumSchema,
  agent_id: z.string().uuid(),
  name: z.string(),
  status: z.string().nullable(),
  calls_made: count,
  inbound_calls: count,
  contacted: count,
  contact_rate_pct: rate,
  talk_time_seconds: count,
  converted: count,
  policies_sold: count,
  appointments_set: count,
  session_seconds: count,
});

export const reportSummarySchema = reportMetaSchema.extend({
  totals: z.object({
    ...sessionCohort, premium: reportPremiumSchema,
    calls_made: count,
    inbound_calls: count,
    other_calls: count,
    total_calls: count,
    contacted: count,
    contact_rate_pct: rate,
    talk_time_seconds: count,
    avg_talk_per_dial_seconds: rate,
    inbound_talk_seconds: count,
    converted: count,
    policies_sold: count,
    appointments_set: count,
    dnc_calls: count,
    callback_calls: count,
    session_seconds: count,
  }),
  by_agent: z.array(reportAgentRowSchema),
  unattributed: z.object({
    premium: reportPremiumSchema,
    calls_made: count,
    inbound_calls: count,
    talk_time_seconds: count,
    policies_sold: count,
    appointments_set: count,
  }),
  policy_source: policySource,
  /** Per-agent policy counts are the client's CURRENT assignment — not original seller credit. */
  policy_basis: z.object({
    sale_date: z.literal("policy_sold_date"),
    agent_attribution: z.literal("current_assignment"),
  }),
  policy_quality: policyQualitySchema,
});

export const reportVolumeSchema = reportMetaSchema.extend({
  by_date: z.array(
    z.object({
      date: isoDate,
      premium: reportPremiumSchema,
      calls_made: count,
      contacted: count,
      inbound_calls: count,
      talk_time_seconds: count,
      policies_sold: count,
    }),
  ),
  by_hour: z.array(z.object({ hour: z.number().int().min(0).max(23), calls_made: count, contacted: count })).length(24),
  by_day_of_week: z
    .array(z.object({ dow: z.number().int().min(0).max(6), dow_name: z.string(), calls_made: count, contacted: count }))
    .length(7),
  heatmap: z
    .array(z.object({ dow: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23), calls_made: count, contacted: count }))
    .length(168),
  policy_source: policySource,
  policy_quality: policyQualitySchema,
});

const dispositionCounts = z.record(z.string(), count);

export const reportDispositionsSchema = reportMetaSchema.extend({
  campaign_visibility: z.literal("caller_authorized"),
  campaign_attribution_unavailable_calls: count,
  total_calls: count,
  by_disposition: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      color: z.string(),
      calls: count,
      avg_duration_seconds: z.number().nonnegative(),
      counts_as_contacted: z.boolean(),
      converts: z.boolean(),
      dnc: z.boolean(),
      callback: z.boolean(),
      appointment: z.boolean(),
    }),
  ),
  by_agent: z.array(z.object({ agent_id: z.string().uuid(), name: z.string(), total: count, counts: dispositionCounts })),
  by_campaign: z.array(z.object({ campaign_id: z.string().uuid(), name: z.string(), total: count, counts: dispositionCounts })),
  duration_histogram: z.array(z.object({ range: z.string(), calls: count })).length(5),
});

export const reportCampaignsSchema = reportMetaSchema.extend({
  campaign_visibility: z.literal("caller_authorized"),
  calls_attribution_unavailable: count,
  campaigns: z.array(
    z.object({
      campaign_id: z.string().uuid(),
      name: z.string(),
      type: z.string(),
      calls_made: count,
      contacted_calls: count,
      contact_rate_pct: rate,
      leads_dialed: count,
      contacted_leads: count,
      converted_leads: count,
      /** Normalized policies attributed by CONVERSION LINEAGE only (never COUNT(wins)). */
      attributed_policies: count,
      premium: reportPremiumSchema,
    }),
  ),
  unattributed_calls: count,
  policy_source: policySource,
  policy_attribution: z.literal("conversion_lineage_only"),
  premium: reportPremiumSchema, premium_attribution_unavailable: reportPremiumSchema,
  policies_in_period: count,
  policies_attribution_unavailable: count,
});

export const reportLeadSourcesSchema = reportMetaSchema.extend({
  sources: z.array(
    z.object({
      lead_source: z.string(),
      calls_made: count,
      contacted_calls: count,
      contact_rate_pct: rate,
      leads_dialed: count,
      contacted_leads: count,
      new_leads: count,
      converted: z.null(),
    }),
  ),
  converted_available: z.literal(false),
  converted_unavailable_reason: z.string(),
  unattributed_calls: count,
});

export type ReportWindow = z.infer<typeof reportWindowSchema>;
export type ReportScopeKind = z.infer<typeof reportScopeKindSchema>;
export type ReportScope = z.infer<typeof reportScopeSchema>;
export type ReportAgentRow = z.infer<typeof reportAgentRowSchema>;
export type ReportSummary = z.infer<typeof reportSummarySchema>;
export type ReportVolume = z.infer<typeof reportVolumeSchema>;
export type ReportDispositions = z.infer<typeof reportDispositionsSchema>;
export type ReportCampaigns = z.infer<typeof reportCampaignsSchema>;
export type ReportLeadSources = z.infer<typeof reportLeadSourcesSchema>;
export type ReportPolicyQuality = z.infer<typeof policyQualitySchema>;
