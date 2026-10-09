/**
 * reports-basis-text.ts — the Data basis sheet's wording (docs/plans/2026-10-09-reports-refresh-audit/
 * data-basis-wording.md), composed from the existing policy and premium constants verbatim so the sheet
 * and the CSV notes can never describe different rules. policyExportNotes and integrityExportNotes never
 * read anything defined here, so the CSV Note rows are unchanged.
 */
import type { ReportPremium, ReportSummary } from "@/lib/reports-schemas";
import { formatCount } from "@/lib/reports-format";
import { PREMIUM_BASIS, integrityExportNotes } from "@/lib/reports-integrity-text";
import {
  CAMPAIGN_ATTRIBUTION_NOTE, CURRENT_ASSIGNMENT_NOTE, LEADERBOARD_CREDIT_NOTE, POLICY_ISSUE_DATE_NOTE,
  POLICY_SEVERAL_PER_CLIENT_NOTE, POLICY_SOURCE_NOTE, POLICY_UNDATED_NOTE, policyQualityNote,
} from "@/lib/reports-policy-text";

export const DATA_BASIS_TITLE = "Data basis";
export const DATA_BASIS_DESCRIPTION = "How Reports counts and credits these numbers.";

export const PREMIUM_UNKNOWN_NOTE = "Unknown premiums are left out of the amount, never counted as $0; if every premium is unknown, the amount shows Unavailable.";
export const PREMIUM_AVERAGE_NOTE = "The average divides by the number of policies with a known premium.";
export const ADDITIONAL_PREMIUM_NOTE = "An additional policy's premium comes only from that policy; a missing one is unknown and never borrows the primary premium.";
export const ZERO_PREMIUM_NOTE = "A $0 primary premium counts as a known zero only when the sale recorded an explicit $0; otherwise it is unknown.";

export const CALLS_DATE_NOTE = "Calls made, contacted calls and talk time count outbound calls by the date each call was created.";
export const CONTACTED_RULE_NOTE = "An outbound call is contacted when its stored duration is more than 45 seconds or its disposition counts as contacted; a No Answer disposition never counts.";
export const CALL_CONTACT_RATE_NOTE = "Call contact rate = contacted outbound calls ÷ outbound calls; with no outbound calls it shows —.";
export const INBOUND_NOTE = "Inbound calls are shown separately and are not in calls made, talk time or the call contact rate.";
export const DISPOSITION_SHARE_NOTE = "Disposition shares are of all outbound calls in the period, including calls with no disposition.";

export const BOOKINGS_NOTE = "Bookings created (all types) counts every booking, of any type, by the date it was created and credits the person who created it (older bookings with no recorded creator credit the booking's user).";
export const BOOKING_STATUS_NOTE = "A later status change, such as cancellation, does not remove a booking.";
export const CALLBACK_DISPOSITIONS_NOTE = "Callback dispositions count calls, not callback bookings.";
export const DIALS_PER_BOOKING_NOTE = "Dials per booking = calls made ÷ bookings created (all types).";

export const CONVERTED_NOTE = "Converted leads/clients counts distinct people given an outbound call with a converting disposition (one whose pipeline stage converts the lead to a client).";
export const NOT_A_POLICY_COUNT_NOTE = "It is not a policy count, and Reports has no conversion rate.";

/** The production band's basis bar (data-basis C2; C3 is the phone form). The full rules are in the sheet. */
export const PRODUCTION_BASIS_BAR = "Current book · stored policies by sale date · monthly premium ×12 · client's current agent";
export const PRODUCTION_BASIS_BAR_SHORT = "Current book · sale date · monthly ×12 · current agent";

/** Some, but not all, premiums are known: the amount is real but covers only part of the cohort (C7 "Partial"). */
export const isPartialPremium = (p: ReportPremium) => p.known_count > 0 && p.known_count < p.policy_count;

/** "3 of 8 premiums known · 5 unknown excluded" (C6): coverage in words, never a percentage. */
export function premiumCoverageText(p: ReportPremium): string {
  const known = `${formatCount(p.known_count)} of ${formatCount(p.policy_count)} ${p.policy_count === 1 ? "premium" : "premiums"} known`;
  return p.unknown_count > 0 ? `${known} · ${formatCount(p.unknown_count)} unknown excluded` : known;
}

const policyCount = (n: number) => `${formatCount(n)} ${n === 1 ? "policy" : "policies"}`;

/**
 * The "Most policies — current assignments" value (C10) from the summary's own agent rows, ranked by policies
 * then name (current assignment, never seller credit). A shared top count names no one (D-5):
 * "2 agents tied · 3 policies each". Null when no agent has a policy.
 */
export function policyLeaderText(byAgent: ReportSummary["by_agent"]): string | null {
  const ranked = byAgent.filter((a) => a.policies_sold > 0)
    .sort((a, b) => b.policies_sold - a.policies_sold || a.name.localeCompare(b.name));
  const top = ranked[0];
  if (!top) return null;
  const tied = ranked.filter((a) => a.policies_sold === top.policies_sold).length;
  return tied > 1 ? `${formatCount(tied)} agents tied · ${policyCount(top.policies_sold)} each` : `${top.name} · ${policyCount(top.policies_sold)}`;
}

/** The one line Period totals keeps on screen (data-basis C29: the first sentence of PERIOD_TOTALS_NOTE). */
export const PERIOD_TOTALS_LINE = "Independent period totals, not one cohort.";

/** Moved verbatim from the Period totals (formerly "Activity and production") card. */
export const PERIOD_TOTALS_NOTE = "These are independent period totals, not one cohort moving through a funnel. Calls and conversions use call creation dates; bookings use booking creation dates; policies use their sale dates. Conversions count distinct identities on converting outbound calls, with campaign-lead or call identity used when a contact identity is missing. No stage-to-stage conversion rate is implied.";

export const TALK_TIME_NOTE = "Talk time is the stored duration of outbound calls; a missing duration counts as 0 seconds and is listed as unknown.";
export const SESSION_TIME_NOTE = "Dialer session time comes from the Dialer's session records (start, heartbeat and end), clipped to the period. An agent's overlapping sessions count once.";
export const SESSION_END_NOTE = "A session counts until its recorded end, even when that end was recorded long after the last heartbeat. A session still marked active stops at its last heartbeat once no heartbeat has arrived for 3 minutes; a live session counts up to the as-of time.";
export const SESSION_RATE_NOTE = "Calls per session hour and talk time share of session use only session-matched calls: outbound calls by the same agent on the same campaign during a session. They divide by all of that agent's session time. Other calls stay in Calls made.";

export const CAMPAIGN_COUNTS_NOTE = "Campaign performance counts outbound calls; its converted leads are unique campaign leads given a converting disposition.";
export const ATTRIBUTION_UNAVAILABLE_NOTE = "Attribution unavailable covers calls with no visible campaign and policies without one unambiguous, visible campaign lineage.";
export const LEAD_SOURCE_NOTE = "Lead sources use each call's current lead; calls not linked to a current lead (for example, after conversion) are not attributed to a source.";
export const COST_ROI_NOTE = "Cost and ROI tracking are not available yet.";
/** The server's own reason (lead-source payload), shown only when that payload is current. */
export const convertedBySourceNote = (reason: string) => `Converted by source isn't available: ${reason}`;

export const timeZoneNote = (timeZone: string) =>
  `Times use the agency time zone, ${timeZone}: days run midnight to midnight and weeks start Monday. Sale dates are calendar dates, used as entered.`;
export const INDEPENDENT_PANELS_NOTE = "Each panel is calculated independently.";
export const FRESHNESS_TITLE = "Time zone and freshness";

export const DATA_QUALITY_TITLE = "Data quality in this summary";
export const DATA_QUALITY_LOADING = "Data-quality counts appear when the summary has loaded.";
export const DATA_QUALITY_UNAVAILABLE = "Live data-quality counts are unavailable because the summary didn't load.";

export interface BasisSection { key: string; title: string; paragraphs: string[] }

/** The static methodology, in sheet order. It needs no payload, so it renders even when a panel failed. */
export function dataBasisSections(convertedReason: string | null): BasisSection[] {
  return [
    { key: "policies", title: "Policies sold", paragraphs: [POLICY_SOURCE_NOTE, POLICY_SEVERAL_PER_CLIENT_NOTE, POLICY_ISSUE_DATE_NOTE, POLICY_UNDATED_NOTE] },
    { key: "premium", title: "Known annual premium", paragraphs: [PREMIUM_BASIS, PREMIUM_UNKNOWN_NOTE, PREMIUM_AVERAGE_NOTE, ADDITIONAL_PREMIUM_NOTE, ZERO_PREMIUM_NOTE] },
    { key: "credit", title: "Agent credit", paragraphs: [CURRENT_ASSIGNMENT_NOTE, LEADERBOARD_CREDIT_NOTE] },
    { key: "calls", title: "Calls and contacted calls", paragraphs: [CALLS_DATE_NOTE, CONTACTED_RULE_NOTE, CALL_CONTACT_RATE_NOTE, INBOUND_NOTE, DISPOSITION_SHARE_NOTE] },
    { key: "bookings", title: "Bookings created (all types)", paragraphs: [BOOKINGS_NOTE, BOOKING_STATUS_NOTE, CALLBACK_DISPOSITIONS_NOTE, DIALS_PER_BOOKING_NOTE] },
    { key: "converted", title: "Converted leads/clients", paragraphs: [CONVERTED_NOTE, NOT_A_POLICY_COUNT_NOTE] },
    { key: "totals", title: "Period totals", paragraphs: [PERIOD_TOTALS_NOTE] },
    { key: "sessions", title: "Talk time and dialer sessions", paragraphs: [TALK_TIME_NOTE, SESSION_TIME_NOTE, SESSION_END_NOTE, SESSION_RATE_NOTE] },
    {
      key: "attribution", title: "Campaign and lead-source attribution",
      paragraphs: [CAMPAIGN_ATTRIBUTION_NOTE, CAMPAIGN_COUNTS_NOTE, ATTRIBUTION_UNAVAILABLE_NOTE, LEAD_SOURCE_NOTE,
        ...(convertedReason ? [convertedBySourceNote(convertedReason)] : []), COST_ROI_NOTE],
    },
  ];
}

/**
 * The live data-quality list: the summary CSV's own Note sentences (duration, duplicates, bookings, sessions,
 * premium coverage, session cohort) without the response stamp and PREMIUM_BASIS (both shown elsewhere in the
 * sheet), then the scope-wide policy note when there is one. Screen and CSV therefore read the same.
 */
export function liveQualityNotes(summary: ReportSummary): string[] {
  const notes = integrityExportNotes(summary).filter((n) => !n.startsWith("Response as of ") && n !== PREMIUM_BASIS);
  const policy = policyQualityNote(summary.policy_quality);
  return policy ? [...notes, policy] : notes;
}
