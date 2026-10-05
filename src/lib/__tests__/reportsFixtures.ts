/**
 * Synthetic, schema-valid Reports payloads for frontend tests. No production data.
 * Values mirror the SQL suite's hand-computed organization totals where convenient.
 */
import type {
  ReportPremium,
  ReportQuality,
  ReportCampaigns,
  ReportDispositions,
  ReportLeadSources,
  ReportPolicyQuality,
  ReportScope,
  ReportSummary,
  ReportVolume,
  ReportWindow,
} from "@/lib/reports-schemas";

export const AGENT_A = "11000000-0000-0000-0000-0000000000c1";
export const AGENT_B = "11000000-0000-0000-0000-0000000000c2";
export const TEAM_LEAD = "11000000-0000-0000-0000-0000000000b1";
export const OUTSIDER = "11000000-0000-0000-0000-0000000000c3";
export const CAMPAIGN_1 = "11000000-0000-0000-0000-0000000000f1";

export const AS_OF = "2026-07-20T18:00:00Z";
export function premium(policy_count = 0, known_count = policy_count, monthly = 0): ReportPremium {
  return { policy_count, known_count, unknown_count: policy_count-known_count, monthly_premium: policy_count && !known_count ? null : monthly,
    annual_premium: policy_count && !known_count ? null : monthly*12, average_annual_premium: known_count ? monthly*12/known_count : null,
    coverage_pct: policy_count ? 100*known_count/policy_count : null, invalid_count: 0, ambiguous_zero_count: 0, missing_identity_count: 0, basis: "current_stored_monthly_x12" };
}
export function quality(): ReportQuality {
  return { basis: "reports_integrity_v2", as_of: AS_OF, duration: { outbound_calls: 19, estimated_calls: 0, unknown_calls: 19, conflicting_calls: 0 },
    duplicates: { excluded_outbound_calls: 0, excluded_bookings: 0, basis: "reviewed_mappings_only" },
    bookings: { all_types: 4, appointment_kind: 0, callback_kind: 0, unknown_kind: 4 },
    sessions: { stale_capped: 0, missing_evidence: 0, overlapping_rows: 0, overlap_seconds_removed: 0 } };
}
const cohort = { session_matched_calls: 13, session_matched_contacted: 7, session_matched_talk_seconds: 449, session_unmatched_calls: 6 };

export function reportWindow(overrides: Partial<ReportWindow> = {}): ReportWindow {
  return {
    time_zone: "America/Los_Angeles",
    time_zone_source: "agency_settings",
    start_date: "2026-07-01",
    end_date: "2026-07-31",
    start_at: "2026-07-01T07:00:00Z",
    end_at: "2026-08-01T07:00:00Z",
    ...overrides,
  };
}

export function reportScope(overrides: Partial<ReportScope> = {}): ReportScope {
  return {
    scope: "team", requested_scope: "team", available_scopes: ["personal", "team"], basis_version: "reports_integrity_v2", as_of: AS_OF,
    role: "Team Leader",
    can_export: true,
    self_id: TEAM_LEAD,
    time_zone: "America/Los_Angeles",
    time_zone_source: "agency_settings",
    today: "2026-07-20",
    max_range_days: 366,
    agents: [
      { id: AGENT_A, name: "Alice Agent", status: "Active" },
      { id: AGENT_B, name: "Bob Agent", status: "Active" },
      { id: TEAM_LEAD, name: "Tina Leader", status: "Active" },
    ],
    ...overrides,
  };
}

const meta = (scope: ReportSummary["scope"] = "team") => ({ scope, requested_scope: "team" as const, basis_version: "reports_integrity_v2" as const, as_of: AS_OF, quality: quality(), filter_agent_id: null, window: reportWindow() });

export function reportSummary(overrides: Partial<ReportSummary["totals"]> = {}, byAgent?: ReportSummary["by_agent"]): ReportSummary {
  return {
    ...meta(),
    totals: {
      ...cohort, premium: premium(5, 4, 123.45),
      calls_made: 19,
      inbound_calls: 2,
      other_calls: 1,
      total_calls: 22,
      contacted: 11,
      contact_rate_pct: 57.9,
      talk_time_seconds: 740,
      avg_talk_per_dial_seconds: 38.9,
      inbound_talk_seconds: 340,
      converted: 2,
      policies_sold: 5,
      appointments_set: 4,
      dnc_calls: 1,
      callback_calls: 1,
      session_seconds: 9600,
      ...overrides,
    },
    by_agent: byAgent ?? [
      { agent_id: AGENT_A, name: "Alice Agent", status: "Active", calls_made: 10, inbound_calls: 0, contacted: 4, contact_rate_pct: 40, talk_time_seconds: 264, converted: 0, policies_sold: 1, appointments_set: 1, session_seconds: 9000, ...cohort, premium: premium(1) },
      { agent_id: AGENT_B, name: "Bob Agent", status: "Active", calls_made: 3, inbound_calls: 1, contacted: 3, contact_rate_pct: 100, talk_time_seconds: 185, converted: 2, policies_sold: 2, appointments_set: 1, session_seconds: 600, ...cohort, premium: premium(2) },
    ],
    unattributed: { premium: premium(1), calls_made: 0, inbound_calls: 1, talk_time_seconds: 0, policies_sold: 1, appointments_set: 1 },
    policy_source: "normalized_policies",
    policy_basis: { sale_date: "policy_sold_date", agent_attribution: "current_assignment" },
    policy_quality: policyQuality(),
  };
}

/** Scope-wide, all-time policy data-quality counts (clean by default). */
export function policyQuality(undated = 0, malformed = 0): ReportPolicyQuality {
  return { basis: "scope_wide_all_time", undated_policies: undated, malformed_additional_policies: malformed };
}

export function emptySummary(): ReportSummary {
  return reportSummary(
    {
      ...cohort, session_matched_calls: 0, session_matched_contacted: 0, session_matched_talk_seconds: 0, session_unmatched_calls: 0, premium: premium(),
      calls_made: 0, inbound_calls: 0, other_calls: 0, total_calls: 0, contacted: 0, contact_rate_pct: null,
      talk_time_seconds: 0, avg_talk_per_dial_seconds: null, inbound_talk_seconds: 0, converted: 0,
      policies_sold: 0, appointments_set: 0, dnc_calls: 0, callback_calls: 0, session_seconds: 0,
    },
    [],
  );
}

export function reportVolume(): ReportVolume {
  const by_date = Array.from({ length: 31 }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, "0")}`,
    calls_made: i === 9 ? 2 : i === 19 ? 3 : 0,
    contacted: i === 9 ? 1 : 0,
    inbound_calls: 0,
    talk_time_seconds: i === 9 ? 70 : 0,
    policies_sold: i === 14 ? 2 : 0, premium: premium(i === 14 ? 2 : 0),
  }));
  return {
    ...meta(),
    by_date,
    by_hour: Array.from({ length: 24 }, (_, hour) => ({ hour, calls_made: hour === 10 ? 5 : 0, contacted: hour === 10 ? 1 : 0 })),
    by_day_of_week: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dow_name, dow) => ({
      dow, dow_name, calls_made: dow === 5 ? 5 : 0, contacted: dow === 5 ? 1 : 0,
    })),
    heatmap: Array.from({ length: 168 }, (_, i) => ({
      dow: Math.floor(i / 24), hour: i % 24,
      calls_made: Math.floor(i / 24) === 5 && i % 24 === 10 ? 5 : 0,
      contacted: Math.floor(i / 24) === 5 && i % 24 === 10 ? 1 : 0,
    })),
    policy_source: "normalized_policies",
    policy_quality: policyQuality(),
  };
}

export function reportDispositions(): ReportDispositions {
  return {
    campaign_visibility: "caller_authorized",
    campaign_attribution_unavailable_calls: 2,
    ...meta(),
    total_calls: 6,
    by_disposition: [
      { key: "d-ni", name: "Not Interested", color: "#EF4444", calls: 3, avg_duration_seconds: 30, counts_as_contacted: false, converts: false, dnc: false, callback: false, appointment: false },
      { key: "d-sold", name: "=Sold", color: "#22C55E", calls: 2, avg_duration_seconds: 90, counts_as_contacted: true, converts: true, dnc: false, callback: false, appointment: false },
      { key: "none", name: "(No disposition)", color: "#6B7280", calls: 1, avg_duration_seconds: 46, counts_as_contacted: false, converts: false, dnc: false, callback: false, appointment: false },
    ],
    by_agent: [{ agent_id: AGENT_A, name: "Alice Agent", total: 6, counts: { "d-ni": 3, "d-sold": 2, none: 1 } }],
    by_campaign: [{ campaign_id: CAMPAIGN_1, name: "Spring Team", total: 4, counts: { "d-ni": 2, "d-sold": 2 } }],
    duration_histogram: [
      { range: "0-30s", calls: 2 }, { range: "30s-1m", calls: 2 }, { range: "1-2m", calls: 2 }, { range: "2-5m", calls: 0 }, { range: "5m+", calls: 0 },
    ],
  };
}

export function reportCampaigns(): ReportCampaigns {
  return {
    campaign_visibility: "caller_authorized",
    calls_attribution_unavailable: 13,
    ...meta(),
    campaigns: [
      { campaign_id: CAMPAIGN_1, name: "Spring Team", type: "Team", calls_made: 4, contacted_calls: 3, contact_rate_pct: 75, leads_dialed: 2, contacted_leads: 2, converted_leads: 1, attributed_policies: 2, premium: premium(2) },
    ],
    unattributed_calls: 13,
    policy_source: "normalized_policies",
    policy_attribution: "conversion_lineage_only",
    premium: premium(5), premium_attribution_unavailable: premium(3),
    policies_in_period: 5,
    policies_attribution_unavailable: 3,
  };
}

export function reportLeadSources(): ReportLeadSources {
  return {
    ...meta(),
    sources: [
      { lead_source: "Facebook", calls_made: 6, contacted_calls: 3, contact_rate_pct: 50, leads_dialed: 2, contacted_leads: 2, new_leads: 2, converted: null },
      { lead_source: "Referral", calls_made: 0, contacted_calls: 0, contact_rate_pct: null, leads_dialed: 0, contacted_leads: 0, new_leads: 1, converted: null },
    ],
    converted_available: false,
    converted_unavailable_reason: "Conversion removes the source lead and clients carry no lead source, so conversions cannot be attributed to a lead source.",
    unattributed_calls: 10,
  };
}
