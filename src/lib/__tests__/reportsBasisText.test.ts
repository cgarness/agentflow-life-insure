/**
 * Data basis wording and CSV Note byte identity (docs/plans/2026-10-09-reports-refresh-audit/data-basis-wording.md).
 *   - the four shared basis constants are pinned by SHA-256, so neither the sheet nor the CSV can drift;
 *   - the campaign note split is byte-identical to the original CSV sentence;
 *   - policyExportNotes / integrityExportNotes outputs for the existing fixtures are golden (unchanged),
 *     plus the owner-approved R-3 correction (0 overlapping rows → 0 duplicate seconds);
 *   - the sheet wording is exactly the approved K/T/N rows (optional B1.5 and B8.4 omitted) and never
 *     reaches the CSV note builders; the live list is the summary CSV's own sentences.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  CAMPAIGN_ATTRIBUTION_NOTE, CAMPAIGN_LINEAGE_NOTE, CAMPAIGN_VISIBILITY_NOTE, CURRENT_ASSIGNMENT_NOTE, POLICY_SOURCE_NOTE,
  policyExportNotes, policyQualityNote,
} from "@/lib/reports-policy-text";
import { PREMIUM_BASIS, integrityExportNotes, premiumNote, qualityNotes } from "@/lib/reports-integrity-text";
import * as basis from "@/lib/reports-basis-text";
import { emptySummary, policyQuality, premium, quality, reportCampaigns, reportDispositions, reportLeadSources, reportSummary, reportVolume } from "./reportsFixtures";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("shared basis constants (SHA-256 golden)", () => {
  it.each([
    ["POLICY_SOURCE_NOTE", POLICY_SOURCE_NOTE, "27a04d1bc7ceb63e630224cd8fe8e1fc9f5e7f02b05b2df98bdb27b2f7369b88", 97],
    ["CURRENT_ASSIGNMENT_NOTE", CURRENT_ASSIGNMENT_NOTE, "949166e1d8b8072243c35e8ad2b75bd76b5f5733c939ac132f19e340a1e65b7e", 138],
    ["CAMPAIGN_ATTRIBUTION_NOTE", CAMPAIGN_ATTRIBUTION_NOTE, "d28776e5bc2fc462f394e9cb70e5e59425975fcea34de1ca5a1297dbf168d393", 250],
    ["PREMIUM_BASIS", PREMIUM_BASIS, "a1c5375f0675bdcbdeaa13ad58d19d9ad6f969ef9b917359597661f6386d54b4", 182],
  ])("%s is unchanged", (_name, value, digest, length) => {
    expect(sha256(value)).toBe(digest);
    expect(value).toHaveLength(length);
  });

  it("splits the campaign note into lineage + visibility, byte-identical to the original CSV sentence", () => {
    expect(CAMPAIGN_LINEAGE_NOTE).toBe("Campaign-attributed policies use conversion lineage only: not complete campaign sales attribution and not proof the campaign caused the sale.");
    expect(CAMPAIGN_VISIBILITY_NOTE).toBe("Campaign breakdowns include only campaigns this viewer may read; unavailable attribution is non-identifying.");
    expect(`${CAMPAIGN_LINEAGE_NOTE} ${CAMPAIGN_VISIBILITY_NOTE}`).toBe(CAMPAIGN_ATTRIBUTION_NOTE);
    expect(Buffer.from(CAMPAIGN_ATTRIBUTION_NOTE, "utf8").equals(Buffer.from(
      "Campaign-attributed policies use conversion lineage only: not complete campaign sales attribution and not proof the campaign caused the sale. Campaign breakdowns include only campaigns this viewer may read; unavailable attribution is non-identifying.",
      "utf8",
    ))).toBe(true);
  });
});

const STAMP = "Response as of 2026-07-20T18:00:00Z. Responses are calculated independently; this is not a shared cross-panel snapshot.";
const SESSIONS_ZERO = "Sessions assessed for this window: 0 stale open sessions capped at heartbeat, 0 with missing/invalid end evidence, 0 overlapping rows; 0 duplicate seconds removed.";
const QUALITY = [
  "Stored outbound duration: 0 estimates, 19 unknown provenance or amount, 0 conflicts across 19 calls. Counts can overlap.",
  "Only reviewed mappings excluded: 0 outbound calls and 0 bookings. Unreviewed historical candidates remain included.",
  "Bookings created (all types): 4; recorded kind: 0 appointment, 0 callback, 4 unknown. Callback dispositions count calls, not callback bookings.",
  SESSIONS_ZERO,
];
const POLICY_SOURCE = "Policies are stored client policies (primary and additional), counted on each policy's sale date.";
const ASSIGNMENT = "Agent policy counts and premiums use the client's current assigned agent, not the original seller; a reassigned client moves its policies.";
const PREMIUM = "Current stored monthly premiums ×12 on the same sold-date/current-owner policy cohort; payment frequency does not scale the amount. These are current book values, not sale snapshots.";
const COHORT = "Session rate cohort: 13 matched calls, 6 unmatched calls retained in Calls Made; same agent/campaign and half-open session interval.";
const SUMMARY_PREMIUM = "Known annual premium $1,481.40; 4/5 policies known, 1 unknown (0 invalid, 0 ambiguous legacy zero); 0 missing stable identities.";
const POLICY_QUALITY = "Data quality across this scope, all dates (not only this period): 2 policies have no usable sale date and are not counted in any period; 1 additional-policy record could not be read.";
const notesFor = (panel: string, data: object) => [...policyExportNotes(panel, data), ...integrityExportNotes(data as Parameters<typeof integrityExportNotes>[0])];

describe("CSV Note rows (golden, unchanged for the existing fixtures)", () => {
  it.each([
    ["summary", "summary", reportSummary(), [POLICY_SOURCE, ASSIGNMENT, STAMP, ...QUALITY, PREMIUM, SUMMARY_PREMIUM, COHORT]],
    ["summary (empty period)", "summary", emptySummary(), [POLICY_SOURCE, ASSIGNMENT, STAMP, ...QUALITY, PREMIUM,
      "Known annual premium $0.00; 0/0 policies known, 0 unknown (0 invalid, 0 ambiguous legacy zero); 0 missing stable identities.",
      "Session rate cohort: 0 matched calls, 0 unmatched calls retained in Calls Made; same agent/campaign and half-open session interval."]],
    ["summary (policy quality)", "summary", { ...reportSummary(), policy_quality: policyQuality(2, 1) }, [POLICY_SOURCE, ASSIGNMENT, POLICY_QUALITY, STAMP, ...QUALITY, PREMIUM, SUMMARY_PREMIUM, COHORT]],
    ["volume", "volume", reportVolume(), [POLICY_SOURCE, STAMP, ...QUALITY, PREMIUM]],
    ["dispositions", "dispositions", reportDispositions(), [STAMP, ...QUALITY, "Campaign attribution unavailable: 2 outbound calls."]],
    ["campaigns", "campaigns", reportCampaigns(), [POLICY_SOURCE,
      "Campaign-attributed policies use conversion lineage only: not complete campaign sales attribution and not proof the campaign caused the sale. Campaign breakdowns include only campaigns this viewer may read; unavailable attribution is non-identifying.",
      STAMP, ...QUALITY, PREMIUM, "Campaign attribution unavailable: 13 outbound calls; 3/5 policies.",
      "Unavailable campaign subset: Known annual premium $0.00; 3/3 policies known, 0 unknown (0 invalid, 0 ambiguous legacy zero); 0 missing stable identities."]],
    ["leadSources", "leadSources", reportLeadSources(), [STAMP, ...QUALITY, "Source attribution unavailable: 10 outbound calls. Source policies, premium and conversions are unavailable."]],
  ])("%s", (_name, panel, data, expected) => {
    expect(notesFor(panel, data)).toEqual(expected);
  });

  it("corrects the rounding residue: 0 overlapping rows with 3 seconds prints 0 duplicate seconds (R-3)", () => {
    const q = quality();
    const data = { ...reportSummary(), quality: { ...q, sessions: { ...q.sessions, stale_capped: 2, overlapping_rows: 0, overlap_seconds_removed: 3 } } };
    expect(notesFor("summary", data)).toEqual([POLICY_SOURCE, ASSIGNMENT, STAMP, ...QUALITY.slice(0, 3),
      "Sessions assessed for this window: 2 stale open sessions capped at heartbeat, 0 with missing/invalid end evidence, 0 overlapping rows; 0 duplicate seconds removed.",
      PREMIUM, SUMMARY_PREMIUM, COHORT]);
  });
});

const REASON = "Conversion removes the source lead and clients carry no lead source, so conversions cannot be attributed to a lead source.";

describe("Data basis wording (approved K/T/N rows)", () => {
  it("is exactly the traced wording, in sheet order", () => {
    expect([basis.DATA_BASIS_TITLE, basis.DATA_BASIS_DESCRIPTION]).toEqual(["Data basis", "How Reports counts and credits these numbers."]);
    expect(basis.dataBasisSections(REASON).map((s) => [s.title, s.paragraphs])).toEqual([
      ["Policies sold", [POLICY_SOURCE, "One client can hold several policies.", "Older additional policies with no sold-date field are dated by their issue date.",
        "A policy without a readable sale date is not counted in any period."]],
      ["Known annual premium", [PREMIUM, "Unknown premiums are left out of the amount, never counted as $0; if every premium is unknown, the amount shows Unavailable.",
        "The average divides by the number of policies with a known premium.",
        "An additional policy's premium comes only from that policy; a missing one is unknown and never borrows the primary premium.",
        "A $0 primary premium counts as a known zero only when the sale recorded an explicit $0; otherwise it is unknown."]],
      ["Agent credit", [ASSIGNMENT, "The Leaderboard instead credits each original sale event to its original seller on the event date, so its totals can differ."]],
      ["Calls and contacted calls", ["Calls made, contacted calls and talk time count outbound calls by the date each call was created.",
        "An outbound call is contacted when its stored duration is more than 45 seconds or its disposition counts as contacted; a No Answer disposition never counts.",
        "Call contact rate = contacted outbound calls ÷ outbound calls; with no outbound calls it shows —.",
        "Inbound calls are shown separately and are not in calls made, talk time or the call contact rate.",
        "Disposition shares are of all outbound calls in the period, including calls with no disposition."]],
      ["Bookings created (all types)", ["Bookings created (all types) counts every booking, of any type, by the date it was created and credits the person who created it (older bookings with no recorded creator credit the booking's user).",
        "A later status change, such as cancellation, does not remove a booking.", "Callback dispositions count calls, not callback bookings.",
        "Dials per booking = calls made ÷ bookings created (all types)."]],
      ["Converted leads/clients", ["Converted leads/clients counts distinct people given an outbound call with a converting disposition (one whose pipeline stage converts the lead to a client).",
        "It is not a policy count, and Reports has no conversion rate."]],
      ["Period totals", ["These are independent period totals, not one cohort moving through a funnel. Calls and conversions use call creation dates; bookings use booking creation dates; policies use their sale dates. Conversions count distinct identities on converting outbound calls, with campaign-lead or call identity used when a contact identity is missing. No stage-to-stage conversion rate is implied."]],
      ["Talk time and dialer sessions", ["Talk time is the stored duration of outbound calls; a missing duration counts as 0 seconds and is listed as unknown.",
        "Dialer session time comes from the Dialer's session records (start, heartbeat and end), clipped to the period. An agent's overlapping sessions count once.",
        "A session counts until its recorded end, even when that end was recorded long after the last heartbeat. A session still marked active stops at its last heartbeat once no heartbeat has arrived for 3 minutes; a live session counts up to the as-of time.",
        "Calls per session hour and talk time share of session use only session-matched calls: outbound calls by the same agent on the same campaign during a session. They divide by all of that agent's session time. Other calls stay in Calls made."]],
      ["Campaign and lead-source attribution", [CAMPAIGN_ATTRIBUTION_NOTE,
        "Campaign performance counts outbound calls; its converted leads are unique campaign leads given a converting disposition.",
        "Attribution unavailable covers calls with no visible campaign and policies without one unambiguous, visible campaign lineage.",
        "Lead sources use each call's current lead; calls not linked to a current lead (for example, after conversion) are not attributed to a source.",
        `Converted by source isn't available: ${REASON}`, "Cost and ROI tracking are not available yet."]],
    ]);
    expect(basis.timeZoneNote("America/Los_Angeles")).toBe("Times use the agency time zone, America/Los_Angeles: days run midnight to midnight and weeks start Monday. Sale dates are calendar dates, used as entered.");
    expect(basis.INDEPENDENT_PANELS_NOTE).toBe("Each panel is calculated independently.");
    expect(basis.DATA_QUALITY_LOADING).toBe("Data-quality counts appear when the summary has loaded.");
    expect(basis.DATA_QUALITY_UNAVAILABLE).toBe("Live data-quality counts are unavailable because the summary didn't load.");
  });

  it("omits the server reason sentence when the lead-source payload is not current", () => {
    const attribution = basis.dataBasisSections(null).find((s) => s.key === "attribution")!;
    expect(attribution.paragraphs.some((p) => p.startsWith("Converted by source"))).toBe(false);
  });

  it("leaves out the optional rows (B1.5 primary-policy evidence, B8.4 later-ended stale session)", () => {
    const all = basis.dataBasisSections(REASON).flatMap((s) => s.paragraphs).join(" ");
    expect(all).not.toMatch(/counts as a primary policy only when/);
    expect(all).not.toMatch(/replaces the heartbeat cap/);
  });

  it("the loading and unavailable texts never carry a digit", () => {
    expect(basis.DATA_QUALITY_LOADING).not.toMatch(/\d/);
    expect(basis.DATA_QUALITY_UNAVAILABLE).not.toMatch(/\d/);
  });

  it("keeps one wording: the callback sentence is the CSV quality note's own tail", () => {
    expect(qualityNotes(quality())[2].endsWith(` ${basis.CALLBACK_DISPOSITIONS_NOTE}`)).toBe(true);
  });

  it("no new basis sentence reaches a CSV Note row", () => {
    const sheetOnly = basis.dataBasisSections(REASON).flatMap((s) => s.paragraphs)
      .filter((p) => ![POLICY_SOURCE_NOTE, CURRENT_ASSIGNMENT_NOTE, CAMPAIGN_ATTRIBUTION_NOTE, PREMIUM_BASIS].includes(p));
    const csv = [["summary", reportSummary()], ["volume", reportVolume()], ["dispositions", reportDispositions()], ["campaigns", reportCampaigns()], ["leadSources", reportLeadSources()]]
      .flatMap(([panel, data]) => notesFor(panel as string, data as object));
    for (const p of [...sheetOnly, CAMPAIGN_LINEAGE_NOTE, CAMPAIGN_VISIBILITY_NOTE]) expect(csv, p).not.toContain(p);
  });
});

describe("live data quality = the summary CSV's own sentences", () => {
  it("lists quality, premium coverage and the session cohort, then the scope-wide policy note", () => {
    const summary = { ...reportSummary(), policy_quality: policyQuality(2, 1) };
    const live = basis.liveQualityNotes(summary);
    expect(live).toEqual([...qualityNotes(summary.quality), premiumNote(summary.totals.premium), COHORT, policyQualityNote(summary.policy_quality)]);
    const csv = notesFor("summary", summary);
    for (const line of live) expect(csv).toContain(line);
    expect(live).not.toContain(STAMP);
    expect(live).not.toContain(PREMIUM_BASIS);
  });

  it("has no policy line when there is nothing to report", () => {
    expect(basis.liveQualityNotes(reportSummary())).toEqual([...QUALITY, SUMMARY_PREMIUM, COHORT]);
  });
});

describe("production band and Period totals captions (C2, C3, C6, C7, C10, C29)", () => {
  it("are the approved wording", () => {
    expect(basis.PRODUCTION_BASIS_BAR).toBe("Current book · stored policies by sale date · monthly premium ×12 · client's current agent");
    expect(basis.PRODUCTION_BASIS_BAR_SHORT).toBe("Current book · sale date · monthly ×12 · current agent");
    expect(basis.PERIOD_TOTALS_LINE).toBe("Independent period totals, not one cohort.");
    expect(basis.PERIOD_TOTALS_NOTE.startsWith("These are independent period totals, not one cohort")).toBe(true);
  });

  it.each([
    [premium(4, 4, 10), "4 of 4 premiums known", false],
    [premium(8, 3, 10), "3 of 8 premiums known · 5 unknown excluded", true],
    [premium(5, 0), "0 of 5 premiums known · 5 unknown excluded", false],
    [premium(1, 1, 0), "1 of 1 premium known", false],
    [premium(1, 0), "0 of 1 premium known · 1 unknown excluded", false],
    [premium(1200, 1199, 10), "1,199 of 1,200 premiums known · 1 unknown excluded", true],
  ])("coverage %#: %s", (p, text, partial) => {
    expect(basis.premiumCoverageText(p)).toBe(text);
    expect(basis.premiumCoverageText(p)).not.toMatch(/%/);
    expect(basis.isPartialPremium(p)).toBe(partial);
  });

  it("names the policy leader by current assignment, or the tie, or nobody", () => {
    const row = reportSummary().by_agent[0];
    const rows = (...counts: [string, number][]) => counts.map(([name, policies_sold]) => ({ ...row, name, policies_sold }));
    expect(basis.policyLeaderText(reportSummary().by_agent)).toBe("Bob Agent · 2 policies");
    expect(basis.policyLeaderText(rows(["Zed", 1], ["Amy", 0]))).toBe("Zed · 1 policy");
    expect(basis.policyLeaderText(rows(["Zed", 3], ["Amy", 3], ["Bo", 1]))).toBe("2 agents tied · 3 policies each");
    expect(basis.policyLeaderText(rows(["Zed", 1], ["Amy", 1], ["Bo", 1]))).toBe("3 agents tied · 1 policy each");
    expect(basis.policyLeaderText(rows(["Zed", 0], ["Amy", 0]))).toBeNull();
    expect(basis.policyLeaderText([])).toBeNull();
  });
});
