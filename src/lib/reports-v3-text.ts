// Reports v3 copy (D6 §4.3, §4.4, §4.6). Keys of REASON_NOTICES and SHORT_CUES equal REPORT_V3_REASON_CODES,
// in registry order (reportsV3Schemas.test.ts). Placeholders: {n} count, {a} assessable, {e} eligible, {date}.

export const REASON_NOTICES = {
  evidence_not_captured: "Not tracked yet",
  sale_call_link_not_captured: "Sale-call link not recorded yet",
  classification_not_configured: "Sales appointment type not set up",
  outcome_capture_not_started: "Appointment outcomes not recorded for this period",
  journey_scope_restricted: "Available at agency scope",
  no_policies_sold: "No policies sold in this period",
  no_calls_made: "No calls made in this period",
  no_lead_calls: "No lead calls in this period",
  no_first_time_buyers: "No first-time buyers in this period",
  no_first_contacts: "No first contacts in this period",
  no_due_sales_appointments: "No sales appointments due in this period",
  no_held_sales_appointments: "No completed sales appointments in this period",
  no_attributed_policies: "No policies linked to these appointments",
  premium_not_entered: "Premium not entered",
  capture_gap: "Some appointment changes were not recorded",
  outcome_capture_partial_period: "Outcomes recorded from {date}",
  appointment_type_unclassified: "{n} appointments with an unclassified type",
  outcomes_unresolved: "{n} due appointments without an outcome",
  attribution_unresolved: "{n} completed appointments not resolved",
  legacy_booking_basis: "Includes {n} bookings classified from older records",
  attempt_unverified: "{n} calls not verified as dialed",
  unlinked_contacted_calls: "{n} contacted calls without a tracked contact",
  unlinked_calls_excluded: "{n} calls not linked to a lead",
  history_incomplete: "Based on {a} of {e}",
  lead_receipt_unknown: "{n} without a recorded lead start",
  sale_call_link_missing: "{n} first-time buyers unclassified",
  premium_invalid: "{n} premiums need review",
  premium_missing: "{n} policies missing premium",
  panel_not_loaded: "",
} as const;

export const SHORT_CUES: Record<keyof typeof REASON_NOTICES, string> = {
  evidence_not_captured: "Not tracked yet",
  sale_call_link_not_captured: "Not tracked yet",
  classification_not_configured: "Not set up",
  outcome_capture_not_started: "Not recorded",
  journey_scope_restricted: "Agency only",
  no_policies_sold: "No policies",
  no_calls_made: "No calls",
  no_lead_calls: "No lead calls",
  no_first_time_buyers: "No first-time buyers",
  no_first_contacts: "No first contacts",
  no_due_sales_appointments: "None due",
  no_held_sales_appointments: "None completed",
  no_attributed_policies: "No linked policies",
  premium_not_entered: "Premium not entered",
  capture_gap: "Partial",
  outcome_capture_partial_period: "Partial",
  appointment_type_unclassified: "Partial",
  outcomes_unresolved: "Partial",
  attribution_unresolved: "Partial",
  legacy_booking_basis: "Partial",
  attempt_unverified: "Partial",
  unlinked_contacted_calls: "Partial",
  unlinked_calls_excluded: "Partial",
  history_incomplete: "Partial",
  lead_receipt_unknown: "Partial",
  sale_call_link_missing: "Partial",
  premium_invalid: "Partial",
  premium_missing: "Partial",
  panel_not_loaded: "",
};

export const CHIP_PARTIAL = "Partial";
export const CHIP_IN_PROGRESS = "In progress";
export const CUE_NOT_ENOUGH_DATA = "No eligible data";
export const NOT_LOADED = "not loaded";

export const HOW_CALCULATED_TITLE = "How it's calculated";
export const HOW_CALCULATED_DESCRIPTION = "How each metric is calculated, dated and credited.";
export const COVERAGE_TITLE = "Coverage in this report";
export const PERIOD_AVERAGES_NOTE = "Calls, contacted calls and prospects reached per policy are period averages.";
export const NOT_A_FUNNEL_NOTE =
  "Activity figures are independent period totals with their own dates; they are not steps of a funnel.";
export const BREAKDOWN_CALLS_NOTE =
  "Campaign and lead-source breakdowns show call activity only. Calls without a campaign, calls on campaigns you can't see and calls not linked to a current lead have their own rows, so each breakdown adds up to Calls.";
export const CALLS_MADE_BASIS_NOTE =
  "Calls counts valid initiated outbound attempts, including unsuccessful attempts. Explicit refusals, attempts marked not sent and records without sufficient attempt evidence are excluded.";
export const SALE_SOURCE_NOTE = "Policies sold counts recorded policy sales by Sold Date.";
export const ORIGINAL_SELLER_NOTE = "Each sale is credited to the agent who originally sold it.";
export const EFFECTIVE_PREMIUM_BASIS = "AP uses the original sale’s effective monthly premium × 12, including audited corrections.";

export const CREDIT_LABELS = {
  original_seller: "Original seller",
  placing_agent: "Agent who placed the call",
  setter: "Agent who booked the appointment",
  assigned_agent_at_start: "Assigned agent at the appointment time",
  first_contact_agent: "Agent who made first contact",
  session_agent: "Agent in the dialer session",
  placing_agent_and_original_seller: "Calls by the placing agent; policies by the original seller",
} as const;

export const ASSIGNED_AT_START_NOTE = "AgentFlow does not record who attended an appointment.";

/** Mature-only counts are labelled on their own, never as a second rate under the metric's name. */
export const MATURE_ONLY_LABEL = "Mature groups only";
export const fullyMatureOn = (date: string) => `Fully mature on ${date}`;
export const pendingLine = (n: number) => `${n} still within 30 days`;
export const basedOnLine = (a: number, e: number) => `Based on ${a} of ${e}`;

export function fillNotice(template: string, values: { n?: number; a?: number; e?: number; date?: string | null }): string {
  return template
    .replace("{n}", String(values.n ?? 0))
    .replace("{a}", String(values.a ?? 0))
    .replace("{e}", String(values.e ?? 0))
    .replace("{date}", values.date ?? "the capture start");
}

// Regional performance (D5 §4).
export const UNMAPPED_REASON_LABELS = {
  missing_state: "No state recorded", invalid_state: "Unrecognized state", unresolved_identity: "No linked contact",
  source_conflict: "Conflicting state records", unsupported_geography: "Outside the 50 states and DC", non_prospect_contact: "Recruit calls",
} as const;
export const STATE_BASIS_NOTE = "Grouped by the prospect's or client's current recorded state, not their location at the time of the call or sale.";
export const STATE_MAP_SOURCE_NOTE = "Map boundaries: U.S. Census Bureau cartographic boundary files, 2017 edition, via us-atlas 3.0.1 (ISC licence).";
