import type { ReportPremium, ReportQuality } from "@/lib/reports-schemas";
import { formatPremium } from "@/lib/reports-format";
export const PREMIUM_BASIS = "Current stored monthly premiums ×12 on the same sold-date/current-owner policy cohort; payment frequency does not scale the amount. These are current book values, not sale snapshots.";
export function premiumNote(p: ReportPremium): string {
  return `Known annual premium ${formatPremium(p.annual_premium)}; ${p.known_count}/${p.policy_count} policies known, ${p.unknown_count} unknown (${p.invalid_count} invalid, ${p.ambiguous_zero_count} ambiguous legacy zero); ${p.missing_identity_count} missing stable identities.`;
}
export function qualityNotes(q: ReportQuality): string[] {
  return [
    `Stored outbound duration: ${q.duration.estimated_calls} estimates, ${q.duration.unknown_calls} unknown provenance or amount, ${q.duration.conflicting_calls} conflicts across ${q.duration.outbound_calls} calls. Counts can overlap.`,
    `Only reviewed mappings excluded: ${q.duplicates.excluded_outbound_calls} outbound calls and ${q.duplicates.excluded_bookings} bookings. Unreviewed historical candidates remain included.`,
    `Bookings created (all types): ${q.bookings.all_types}; recorded kind: ${q.bookings.appointment_kind} appointment, ${q.bookings.callback_kind} callback, ${q.bookings.unknown_kind} unknown. Callback dispositions count calls, not callback bookings.`,
    `Sessions assessed for this window: ${q.sessions.stale_capped} stale open sessions capped at heartbeat, ${q.sessions.missing_evidence} with missing/invalid end evidence, ${q.sessions.overlapping_rows} overlapping rows; ${q.sessions.overlap_seconds_removed} duplicate seconds removed.`,
  ];
}
export function integrityExportNotes(data: Pick<import("@/lib/reports-schemas").ReportSummary, "as_of" | "quality"> & object): string[] {
  const notes = [`Response as of ${data.as_of}. Responses are calculated independently; this is not a shared cross-panel snapshot.`, ...qualityNotes(data.quality)];
  if ("policy_source" in data) notes.push(PREMIUM_BASIS);
  if ("totals" in data) {
    const t = (data as import("@/lib/reports-schemas").ReportSummary).totals;
    notes.push(premiumNote(t.premium), `Session rate cohort: ${t.session_matched_calls} matched calls, ${t.session_unmatched_calls} unmatched calls retained in Calls Made; same agent/campaign and half-open session interval.`);
  }
  if ("calls_attribution_unavailable" in data) {
    const c = data as import("@/lib/reports-schemas").ReportCampaigns;
    notes.push(`Campaign attribution unavailable: ${c.calls_attribution_unavailable} outbound calls; ${c.policies_attribution_unavailable}/${c.policies_in_period} policies.`, `Unavailable campaign subset: ${premiumNote(c.premium_attribution_unavailable)}`);
  }
  if ("campaign_attribution_unavailable_calls" in data) notes.push(`Campaign attribution unavailable: ${data.campaign_attribution_unavailable_calls} outbound calls.`);
  if ("converted_available" in data) notes.push(`Source attribution unavailable: ${(data as import("@/lib/reports-schemas").ReportLeadSources).unattributed_calls} outbound calls. Source policies, premium and conversions are unavailable.`);
  return notes;
}
