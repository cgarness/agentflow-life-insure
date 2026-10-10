# Data basis and caption wording (traced)

**Purpose:** the final wording for the Data basis sheet and the new on-screen captions in the Reports refresh. Every sentence is traced to an existing text constant, a deployed SQL line, or an AGENT_RULES clause.

**Sources** (relative to the review evidence):
- `SD/` = deployed function bodies captured from production. Their `md5(prosrc)` equals the repository migration bodies.
- `PT` = `src/lib/reports-policy-text.ts`
- `IT` = `src/lib/reports-integrity-text.ts`
- `AR#n` = AGENT_RULES invariant

Rows marked **N** (new) or **O** (optional) need Chris's sign-off; the rest keep or tighten existing wording.

**CSV notes.** CSV `Note` rows stay byte-identical. The one exception is the owner-approved session-rounding correction (R-3), which changes the digit in the "Sessions assessed …" note when no sessions overlap.

## Wording table

Key to the source column:
- `SD/` = deployed body under `scratchpad/phase1/sql-deployed/`. md5 = production.
- `PT` = `src/lib/reports-policy-text.ts`.
- `IT` = `src/lib/reports-integrity-text.ts`.
- `AR#n` = AGENT_RULES clause.

Key to the method column:
- `S` = static.
- `DB` = database-role simulation (production, read-only).
- `SQ` = independent source query (production, read-only, aggregates).
- `EX` = expression check.
- `LS` = local synthetic (baseline PASS, not re-run here).

Key to the verdict column:
- **K** = kept.
- **T** = tightened, because the earlier draft was imprecise.
- **N** = new; needs Chris's sign-off.
- **O** = optional; needs Chris's sign-off.

Module placement:
- Rows B1.x and B3.2 become new constants in `PT`.
- Every other row goes in the new `src/lib/reports-basis-text.ts`.
- Neither group is referenced by `policyExportNotes` or `integrityExportNotes`.

**Data basis sheet (static; the content mounts only when the sheet is open)**

| ID | Section | Final wording | Was (plan §5.9 / design §4.9) | Source | Method | Verdict |
|---|---|---|---|---|---|---|
| B0.1 | Title | Data basis | same | UI label | S | K |
| B0.2 | Description | How Reports counts and credits these numbers. | same | UI label | S | K |
| B1.1 | 1 Policies sold | `POLICY_SOURCE_NOTE` verbatim: "Policies are stored client policies (primary and additional), counted on each policy's sale date." | same | PT:11-12; SD/private.report_policy_facts.sql:15-50; SD/public.get_report_call_summary_v2.sql:15-20; AR#38 | S | K |
| B1.2 | 1 | One client can hold several policies. | same | existing PoliciesSoldChart.tsx:178, ReportsOverview.tsx:46; report_policy_facts.sql:48-50 (UNION ALL of primary and each additional object) | S | K |
| B1.3 | 1 | Older additional policies with no sold-date field are dated by their issue date. | "An additional policy uses its sold date, or its issue date when no sold date is recorded." **Imprecise:** an empty or unreadable sold date does NOT fall back. | report_policy_facts.sql:33-36; SD/private.profile_parse_iso_date.sql:5-13; AR#38 ("issueDate only when soldDate is ABSENT"). Results: absent→issue date; JSON null→issue date; ""→undated; "01/05/2026"→undated. | S + EX | T |
| B1.4 | 1 | A policy without a readable sale date is not counted in any period. | "Undated policies are never placed in a period." | summary_v2:18-19; SD/private.report_policy_quality.sql:9-11; `policyQualityNote` PT:31; AR#38 ("never dated by created_at or a guess") | S | T |
| B1.5 | 1 | A client record counts as a primary policy only when it has a carrier, policy number, premium, face amount or sale date. | — | report_policy_facts.sql:21-27; AR#34, AR#38 | S | O |
| B2.1 | 2 Known annual premium | `PREMIUM_BASIS` verbatim | same | IT:3; SD/private.report_premium_totals.sql:3-4,8; AR#41 | S | K |
| B2.2 | 2 | Unknown premiums are left out of the amount, never counted as $0; if every premium is unknown, the amount shows Unavailable. | "Unknown premiums are excluded, never counted as $0." | report_premium_totals.sql:2-4 (sum of known only; all-NULL→NULL); ReportsOverview.tsx:22-28; AR#41 ("all-unknown sums unavailable") | S | T |
| B2.3 | 2 | The average divides by the number of policies with a known premium. | same in substance | report_premium_totals.sql:5; AR#41 | S | K |
| B2.4 | 2 | An additional policy's premium comes only from that policy; a missing one is unknown and never borrows the primary premium. | — | SD/private.report_policy_value_facts.sql:9-11,17; AR#40 ("additional-policy unknowns never borrow primary premium"); new test T-3 | S | N (pairs with the owner's T-3) |
| B2.5 | 2 | A $0 primary premium counts as a known zero only when the sale recorded an explicit $0; otherwise it is unknown. | — | report_policy_value_facts.sql:5-6,16-17; AR#41 ("Primary legacy zero needs same-policy explicit zero evidence; explicit additional zero is known"). Explains "ambiguous legacy zero" in `premiumNote`. | S | N |
| B3.1 | 3 Agent credit | `CURRENT_ASSIGNMENT_NOTE` verbatim | same | PT:14-15; report_policy_facts.sql:4,17; summary_v2:166-169; AR#38 | S | K |
| B3.2 | 3 | The Leaderboard instead credits each original sale event to its original seller on the event date, so its totals can differ. | "…by the original seller with sale-time premium…" **Imprecise:** legacy events without a premium snapshot use the current client premium (live policy `0d9a147d`); the date basis is what actually differs today. | AR#40 bullets 3-4; evidence-matrix.md:356-360 and B.3 | S + DB (prior) | T |
| B4.1 | 4 Calls | Calls made, contacted calls and talk time count outbound calls by the date each call was created. | same in substance | SD/private.report_call_facts.sql:6-10,55-56; summary_v2:48,51-52; AR#38 | S | K |
| B4.2 | 4 | An outbound call is contacted when its stored duration is more than 45 seconds or its disposition counts as contacted; a No Answer disposition never counts. | "…lasts over 45 seconds…" | report_call_facts.sql:85-92 (No Answer tested first, then >45, then flag); plan §3.2 (45 s→no, 46 s→yes) | S + DB (prior) | T |
| B4.3 | 4 | Call contact rate = contacted outbound calls ÷ outbound calls; with no outbound calls it shows —. | "Call contact rate = contacted calls ÷ calls made ("—" with no calls)." | existing CallVolumeChart.tsx:143; summary_v2:126; AR#38 | S | K (reuses existing wording) |
| B4.4 | 4 | Inbound calls are shown separately and are not in calls made, talk time or the call contact rate. | "Inbound calls are shown separately." | summary_v2:48-53,102-108; report_call_facts.sql:87 | S | T |
| B4.5 | 4 | Disposition shares are of all outbound calls in the period, including calls with no disposition. | footnote moved by design §5 but missing from §4.9 | existing DispositionsPieChart.tsx:169; SD/public.get_report_disposition_breakdown_v2.sql:13-31; report_call_facts.sql:72-78 | S | T (gap closed) |
| B5.1 | 5 Bookings | Bookings created (all types) counts every booking, of any type, by the date it was created and credits the person who created it (older bookings with no recorded creator credit the booking's user). | "By creation date, all types, credited to the person who created them" | summary_v2:24-32 (`coalesce(created_by,user_id)`, `created_at`); AR#23 (user_id legacy rescue), AR#41 | S | T |
| B5.2 | 5 | A later status change, such as cancellation, does not remove a booking. | "later cancellation or completion never removes them" | summary_v2:24-32 (no status predicate); supabase/tests/reports_integrity.sql:52-55,79 and reports_rpc.sql:181 (Cancelled/Completed counted); AR#40, AR#41. Live data has no cancelled bookings (plan §3.4). | S + LS | K (supported; not exercisable live) |
| B5.3 | 5 | Callback dispositions count calls, not callback bookings. | "…count calls, not bookings." | IT:11 (verbatim); summary_v2:56,113 | S | K |
| B5.4 | 5 | Dials per booking = calls made ÷ bookings created (all types). | — (R-1) | stat-computations.ts:261-262; summary_v2:111 | S | N (owner-approved rename) |
| B6.1 | 6 Converted | Converted leads/clients counts distinct people given an outbound call with a converting disposition (one whose pipeline stage converts the lead to a client). | "Distinct people with a converting outbound call." | report_call_facts.sql:24,37-39,69,93; summary_v2:54,109; AR#38 | S | T |
| B6.2 | 6 | It is not a policy count, and Reports has no conversion rate. | same in substance | AR#38 ("There is no conversion rate of any kind") | S | K |
| B7.1 | 7 Period totals | ReportsActivityFlow.tsx:43 paragraph **verbatim**, moved to a constant | same | each clause checked: call dates (report_call_facts.sql:55-56), booking creation (summary_v2:29-30), sale dates (:18-19), identity fallback (report_call_facts.sql:69) | S | K |
| B8.1 | 8 Talk time and sessions | Talk time is the stored duration of outbound calls; a missing duration counts as 0 seconds and is listed as unknown. | "Talk time is the stored call duration." | report_call_facts.sql:12; summary_v2:52,107; SD/private.report_integrity_quality.sql:17; AR#41 | S | T |
| B8.2 | 8 | Dialer session time comes from the Dialer's session records (start, heartbeat and end), clipped to the period. An agent's overlapping sessions count once. | "server dialer sessions…; overlaps count once" **Imprecise:** overlaps are merged per agent only; "server" is not enforced (see defect). | SD/private.report_session_facts.sql:2-3,9-12; SD/private.report_session_seconds.sql:2-8; AR#38, AR#41 ("union overlaps per agent"); catalog read of dialer_sessions grants/RLS | S + catalog | T |
| B8.3 | 8 | A session counts until its recorded end, even when that end was recorded long after the last heartbeat. A session still marked active stops at its last heartbeat once no heartbeat has arrived for 3 minutes; a live session counts up to the as-of time. | "stale sessions are capped at the last heartbeat" **Imprecise:** omitted the 3-minute rule and D-1. | report_session_facts.sql:3-6; SD/public.end_dialer_session.sql:42-51; SD/private.close_stale_dialer_sessions.sql:13-21; SD/public.heartbeat_dialer_session.sql:18; AR#41. Live W1: deployed rule recomputed = 95,862 s = RPC (a heartbeat+3 min cap would give 89,829 s). | S + SQ + DB | T (owner D-1 a: keep, describe) |
| B8.4 | 8 | If a stale session is ended later, its recorded end replaces the heartbeat cap, so an earlier period's session time can rise. | — | report_session_facts.sql:3; end_dialer_session.sql:29,42-51; critic G05 | S | O |
| B8.5 | 8 | Calls per session hour and talk time share of session use only session-matched calls: outbound calls by the same agent on the same campaign during a session. They divide by all of that agent's session time. Other calls stay in Calls made. | "Calls per session hour uses session-matched calls only; other calls stay in Calls made." **Imprecise:** didn't state the denominator; sessions with no campaign add time but can never match (G12). | summary_v2:36-45,114,136; stat-computations.ts:200-201,211-213; AgentEfficiency.tsx:73; AR#41 | S | T |
| B9.1 | 9 Attribution | `CAMPAIGN_ATTRIBUTION_NOTE` verbatim (= LINEAGE + " " + VISIBILITY) | same | PT:17-18; SD/public.get_report_campaign_performance_v2.sql:10-12,27,30-46; AR#38 | S + local byte check | K |
| B9.2 | 9 | Campaign performance counts outbound calls; its converted leads are unique campaign leads given a converting disposition. | "Converted leads in Campaign performance are distinct campaign leads…" | existing CampaignPerformance.tsx:154; campaign_v2.sql:16,24 | S | K (reuses existing wording) |
| B9.3 | 9 | Attribution unavailable covers calls with no visible campaign and policies without one unambiguous, visible campaign lineage. | — (explains the new tfoot row) | campaign_v2.sql:88-90,94-95; existing CampaignPerformance.tsx:162,171; AR#38 | S | N |
| B9.4 | 9 | Lead sources use each call's current lead; calls not linked to a current lead (for example, after conversion) are not attributed to a source. | "Lead sources use current leads only." | report_call_facts.sql:45-52; SD/public.get_report_lead_source_performance_v2.sql:22,72; existing LeadSourceTable.tsx:126-128; AR#38 | S | T |
| B9.5 | 9 | Converted by source isn't available: {converted_unavailable_reason} | "Converted by source: {reason}." | lead_v2.sql:69-71 (server reason) | S | K |
| B9.6 | 9 | Cost and ROI tracking are not available yet. | "Cost and ROI are not tracked yet." | existing LeadSourceTable.tsx:68 (verbatim) | S | K |
| B11.1 | 11 Time zone | Times use the agency time zone, {tz}: days run midnight to midnight and weeks start Monday. Sale dates are calendar dates, used as entered. | "Agency time zone {tz}; days run midnight to midnight; weeks start Monday." | SD/private.report_window.deployed.sql:17-30; call_volume_v2.sql:11,14-20,42-43; reports-format.ts:120-124; AR#38, AR#41 | S | T |
| B11.2 | 11 | Each panel is calculated independently. | same | existing ReportDataQuality.tsx:10; IT:16; AR#41 | S | K |
| B11.3 | 11 | Summary as of {Oct 8, 2026, 8:44:11 PM PDT} (ISO in `<time>`) | same | summary_v2:182 (`as_of` now()) | S | K |

**Live data quality (§10; only for a ready, current, non-withheld summary). Each line is the existing export sentence, so screen = CSV.**

| ID | Final wording | Source | Verdict |
|---|---|---|---|
| L1–L3 | `qualityNotes(summary.quality)[0..2]` verbatim | IT:9-11; report_integrity_quality.sql:15-24 | K |
| L4 | `qualityNotes[3]` with the R-3 correction. When `overlapping_rows = 0`, print 0 seconds. Live W1 becomes: "Sessions assessed for this window: 2 stale open sessions capped at heartbeat, 0 with missing/invalid end evidence, 0 overlapping rows; 0 duplicate seconds removed." (today it says "3"). | IT:12; report_integrity_quality.sql:27-31; DB W1/W2/W3/W5 = 3/4/2/5 s with 0 rows | T (owner-approved; changes CSV Note bytes only in this case) |
| L5 | `premiumNote(totals.premium)` verbatim | IT:4-6 | K |
| L6 | "Session rate cohort: {m} matched calls, {u} unmatched calls retained in Calls Made; same agent/campaign and half-open session interval." This replaces the screen-only ReportDataQuality.tsx:9 sentence. | IT:20; summary_v2:36-45,136 | T (one wording) |
| L7 | `policyQualityNote(policy_quality)` verbatim, when non-null | PT:28-38 | K |
| L8 | Loading: "Data-quality counts appear when the summary has loaded." | new; no digits | N |
| L9 | Error: "Live data-quality counts are unavailable because the summary didn't load." | new; no digits | N |

**On-screen captions**

| ID | Where | Final wording | Was | Source | Verdict |
|---|---|---|---|---|---|
| C1 | Context line | {start} – {end} · {tz} · Summary as of {h:mm TZ} · ⓘ Data basis | same | report_meta.deployed.sql:6-12; summary_v2:182; AR#41 | K |
| C2 | Basis bar (≥sm) | Current book · stored policies by sale date · monthly premium ×12 · client's current agent | same | PT:11-15; IT:3 | K |
| C3 | Basis bar (<sm) | Current book · sale date · monthly ×12 · current agent | same | as C2 | K |
| C4 | Band, policies meta | Primary + additional policies (zero: "No policies sold in this period." verbatim) | same | existing ReportsActivityFlow.tsx:23, ReportsOverview.tsx:43 | K |
| C6 | Band coverage | "4 of 4 premiums known" / "3 of 8 premiums known · 5 unknown excluded" / "0 of 5 premiums known · 5 unknown excluded". Use the singular "premium" when the total is 1. | "…policies known…" **Imprecise:** reads as if the policies were unknown. | report_premium_totals.sql:2; existing ReportsOverview.tsx:62,73 | T |
| C7 | Partial chip | Partial (only when 0 < known < count; `aria-describedby` points at C6) | same | report_premium_totals.sql:2,6 | K |
| C8 / C9 | Band secondary | "Known monthly" / "Avg per known policy" (mobile: "Avg / known policy"); "Unavailable" when all are unknown; "—" when known = 0 | same | report_premium_totals.sql:3,5 | K |
| C10 | Leader row | "Most policies — current assignments" (contract) · "{name} · {n} policies". A tie variant waits on D-5. | same | AR#38; summary_v2:150,166-169 | K (D-5 pending) |
| C11 | Band quality | `policyQualityNote` verbatim | same | PT:28-38 | K |
| C12 | Strip label | Contacted calls | same | summary_v2:51,106 | K |
| C13 | Strip label and subtitle | "Dials per booking", with subtitle "all booking types" | "Dials per appointment" (no subtitle) | stat-computations.ts:127,261-262; summary_v2:111 | N (rename owner-approved; subtitle needs sign-off) |
| C14 | Caution note on Talk time and Avg talk time per dial | "Durations: {e} estimated · {u} unknown source or amount · {c} conflicting" (zero parts omitted). Live W1: "Durations: 1,263 unknown source or amount · 484 conflicting". **Do not show it on "Talk time share of session":** that numerator is session-matched talk, while the counts describe all calls made. | "{e} estimated · {u} unknown · {c} conflicting durations" **Imprecise:** most "unknown" calls have a stored duration and unknown provenance. | report_integrity_quality.sql:15-18; IT:9 ("unknown provenance or amount"); DB (outbound_calls = calls_made) | T |
| C15 | Note on Dialer session time | "{n} stale, capped at last heartbeat · {m} missing/invalid end evidence" (only parts > 0). Live W1: "2 stale, capped at last heartbeat". | "{n} stale capped · {m} missing end" **Imprecise:** missing_evidence also covers no start and an end before the start. | report_integrity_quality.sql:25-26; report_session_facts.sql:6-8; IT:12 | T |
| C16 | Subtitle on Calls per session hour | session-matched calls ÷ all session hours | "session-matched calls only" | stat-computations.ts:200-201; summary_v2:114,136 | T |
| C17 | Subtitle on Talk time share of session | session-matched talk ÷ all session time | "session-matched calls only" | stat-computations.ts:211-213 | T |
| C18 | Subtitle on DNC per 100 dials | DNC dispositions per 100 calls | "per 100 calls" (drops "DNC dispositions", which says what is counted) | stat-computations.ts:223; summary_v2:55,112 | T (keep today's text) |
| C19 | Subtitle on Converted | distinct people | "unique contacts" | AR#38 | K |
| C22 | Trend panel captions | Policies sold · Known annual premium · Outbound calls · Call contact rate | same | call_volume_v2.sql:31-34,38 | K |
| C23 | Production trend meta (when unknown > 0) | {k} of {n} premiums known · {u} unknown | "{k} of {n} known · {u} unknown" | as C6 | T |
| C24 | Legend (partial bucket exists) | ○ Some premiums unknown | same | PoliciesSoldChart.tsx:28-31 | K |
| C25 | Legend (null bucket with policies) | Gap = known premium unavailable, not $0 | "Gap = premium unavailable" | PoliciesSoldChart.tsx:28-31,50,183 ("Missing premium is a gap, not zero.") | T |
| C26 | Calling trend meta (inbound > 0) | {n} inbound calls (not in call contact rate) | "121 inbound (not in call contact rate)" | call_volume_v2.sql:33; summary_v2:49 | K |
| C27 | Tooltip | "No outbound calls; rate unavailable." and the ProductionTooltip strings, verbatim | same | existing | K |
| C29 | Period totals line | Independent period totals, not one cohort. | same | first sentence of B7.1 | K |
| C30 | Period totals captions | Calls made "by call date" · Contacted calls "by call date" · Bookings created (all types) **"by date created"** · Converted leads/clients "distinct people · by call date" · Policies sold "by sale date" | Bookings: "by booking date" **Imprecise:** reads as the appointment's scheduled date; the SQL uses `created_at`. | summary_v2:29-30; report_call_facts.sql:55-56; summary_v2:18-19 | T |
| C31 | Agent tfoot | "Unattributed" + "{n} inbound calls" verbatim | same | AgentPerformanceCards.tsx:100-102; summary_v2:158-163 | K |
| C32 | Agent efficiency footnote | Calls per session hour = session-matched calls ÷ session hours. | same | AgentEfficiency.tsx:73 | K |
| C33 | Campaign tfoot | "Attribution unavailable" · sub-line "Missing, ambiguous or restricted". This is the union: calls can only be missing or restricted; B9.3 gives the per-measure precision. | same | campaign_v2.sql:88-90,94-95 | K |
| C34 | Campaign note | `CAMPAIGN_LINEAGE_NOTE` = "Campaign-attributed policies use conversion lineage only: not complete campaign sales attribution and not proof the campaign caused the sale." | same | PT:17-18; byte check true | K |
| C36 | Lead-source note | Converted by source isn't available: {reason} | "is not available" | lead_v2.sql:69-71 | K |
| C37 | Lead-source tfoot | Not linked to a current lead · {n} calls. The CSV row stays "Attribution unavailable" (LeadSourceTable.tsx:60); CSV unchanged. | same | lead_v2.sql:72 | K |
| C39 | Heatmap caption | Agency time ({tz}) | same | call_volume_v2.sql:11,42-43 | K |
| C40 | Call flow footnote | Hours and days are in the agency time zone; a bucket with no calls shows no call contact rate. | condensed from CallFlowAnalysis.tsx:135-137 | same | K |
| C41 | Call duration footnote | Stored outbound call durations; estimates and unknown provenance are listed in Data basis. | condensed from CallDurationAnalysis.tsx:153 | report_integrity_quality.sql:15-18 | K |

**Rules (checked locally on all 72 strings: 0 violations)**
- **"Call contact rate".** Every "contact rate" is preceded by "call ", on one source line (`reportsContracts.test.ts:148-161`). Extend that scan to `reports-basis-text.ts`, `reports-policy-text.ts` and `reports-integrity-text.ts`.
- **No conversion rate.** "conversion rate" appears only as "Reports has no conversion rate." and "No stage-to-stage conversion rate is implied." Add a negation-only scan. "Dials per booking" passes `reportStatComputations.test.ts:158-160`.
- **No "%" in the production band** (`ReportsOverview.test.tsx:48-53`).

**CSV Note rows**
- `policyExportNotes` and `integrityExportNotes` bodies are untouched, and the campaign-note split is byte-identical.
- **One exception, owner-approved:** the R-3 correction inside `qualityNotes` (IT:12) changes the "Sessions assessed…" Note in every panel's CSV whenever `overlapping_rows = 0` and seconds > 0. That is true today in every window: 3 → 0 for W1.
- A new must-pass test, `src/lib/__tests__/reportsBasisText.test.ts`, pins the SHA-256 of POLICY_SOURCE_NOTE, CURRENT_ASSIGNMENT_NOTE, CAMPAIGN_ATTRIBUTION_NOTE and PREMIUM_BASIS, plus golden `policyExportNotes`/`integrityExportNotes` outputs for the existing fixtures (unchanged) and one new rows-0/seconds-3 fixture (corrected).
