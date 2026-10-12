# System-wide UI copy cleanup — V2 takeover and reconciliation plan (merged in PR #440 as `f91e4ba` and deployed to production on 2026-10-12; served-asset verification pending)

**Release (2026-10-12):** merged and deployed to production; the cleanup is not yet declared LIVE, because served-asset verification from the production domain is pending. The record is §17.14. The status lines below are the pre-release history, kept as written.

**Status (2026-10-11):** Chris approved the isolated Part A implementation with decisions D1–D14 on 2026-10-11 (§16). It is implemented on branch `claude/ui-copy-cleanup-v2-20261011` (base `origin/main` `e11c8bea8bb546023da3fc6489140be2cd464a3e`), published as draft PR #440 under Chris's 2026-10-11 publication approval. The plan commits come first, followed by:

| Commit | Content |
|---|---|
| `5587d3a` | Reports labels |
| `9fd72ef` | CRM labels |
| `cb14cfa` | Rule and Data basis wording amendments |
| `74219dc` | D14 |
| `f23a987` | D14 follow-up, Settings Goals |
| `0c62756` | D14 test strengthening |
| `cba9e94` | Whitespace only: removes a trailing blank line `f23a987` added |

Verification, decisions and limits are in the newest WORK_LOG entry and §16.1. What has not happened:
- Published as draft PR #440 with its normal protected Vercel preview; CI green at `51fff58`. Nothing is merged, and production is not deployed.
- No backend, migration, Edge Function, secret, cron or deployment setting changed.
- Supabase was not contacted. Vercel only built its automatic protected preview; no bypass or share token, no protection change.
- The onboarding series stays INACTIVE.

**Part B (status 2026-10-12): implemented on the same draft PR #440. Not merged, not released.** Chris approved §17 with the overrides recorded in §17.11 before any edit.
- **What was done.** Every planned item is implemented. Each item's commit is recorded in `reconciliation.md`.
- **Verification.** Combined-branch verification against `e11c8bea` is in the 2026-10-12 WORK_LOG entry, together with one independent final review and a fixture-based visual review. Signed-in acceptance has not been done.
- **Not done.** No backend, migration, Edge Function, export or telephony-logic change. Production is not deployed.

*Earlier status (2026-10-11), kept for history:* Part B (the four-batch carry-over) was blocked (§2, §11). Chris then directed a fresh, targeted plan against current code. That plan is §17, with the per-item table in `reconciliation.md`, and it awaits approval. No Part B app or test file has been edited. Nothing was recovered from the sandbox, and nothing was reconstructed from old files.

The text below, from §0 onward, is the plan as presented for approval, kept as written. Where the two differ, §16 records the approved decisions.

**Scope of this plan:**

- **Part A — V2 simple metric labels (Chris's 2026-10-11 direction).** Fully reconciled against current `main` and ready for approval: §4–§9.
- **Part B — carry-over of the approved four-batch cleanup.** Blocked because the private recovery source is unreachable from this session (§2). The file-level overlap with current `main` is already mapped (§3). The method for finishing Part B once the archive is available is in §11.

---

## §0. TL;DR

- **Base.** `origin/main` is `e11c8bea` (fetched 2026-10-11, the same as the handoff checkpoint). The local `main` ref in this clone is stale at `8d53531` and is never used as a base; every base reference below is the SHA `e11c8bea`. It has 49 commits since the cleanup base `be2690d8`. The `src` changes in that range come from three PRs only: #433 (Campaigns table), #436 (Reports refresh) and #439 (onboarding preference mount and unsubscribe page).
- **Recovery is blocked.** Both resuming the named sandbox and creating an isolated copy from its snapshot return `403 forbidden` ("You don't have permission to create the vercel sandbox"). The documentation pack, including `METRIC_LABEL_ADDENDUM.md`, was not attached to this session. The V2 text in Chris's request is used as the addendum. The previous verified snapshot `snap_E9LzZeDV5vYzaN2WszrzqzToDL8v` **expires 2026-10-18 02:48 UTC**.
- **Part A finding.** Every on-screen metric label already lives in its own screen-only constant or JSX, separate from CSV headers, CSV Note constants, payload keys and saved ids. The V2 renames are therefore narrow string edits at the existing presentation boundary. Only two display-only mappings are needed:
  - `CampaignTotalsFoot` keys its cells by the screen header text, so those keys move in lockstep with the headers.
  - The Leaderboard metric selector renders its id strings as option text, so it gets a `Record<Metric,string>` display map. The ids stay unchanged.
- **Approval points.** Repository rules and tests pin some of the former display wording: AGENT_RULES §4 #38 and the Reports refresh amendment, `reportsRegistrySnapshot.test.ts`, the Reports browser gate, and the approved Data basis wording table. §7 lists each narrow amendment for approval. No functional, semantic or CSV assertion is weakened.
- **Recommended decisions.** These are listed in §8:
  - keep each surface's existing letter case;
  - keep "Call contact rate";
  - rename the leader row to "Most policies sold";
  - use "Attributed policies" and "Premium coverage" in the campaign table;
  - keep "Dials per booking";
  - make the sheet-only bookings note state the equivalence with the CSV term;
  - show "Unavailable" rather than $0.00 when every premium on a Dashboard or Leaderboard surface is unknown (D14).

---

## §1. Inputs and current base

| Item | Finding |
|---|---|
| Latest `main` | `origin/main` = `e11c8bea` "Merge pull request #439: inactive onboarding email series", fetched 2026-10-11. The local `main` ref is stale at `8d53531` (#431, 50 commits behind) and is not used. |
| Since cleanup base `be2690d8` | 49 commits. First-parent PRs: #433 Campaigns table (`d88982d`), #434 docs, #436 Reports refresh (`b00bfed`), #435 SQL/docs, #437 docs, #438 backend/docs, #439 onboarding (`e11c8be`). #434, #435, #437 and #438 change no `src` files. |
| Open PRs | None is the cleanup. #429 (START draft, codex/sms-start-20261008) is unapproved and **excluded**. #425, #398, #383, #382, #381, #378 and #294 are unrelated. None is imported. |
| `origin/codex/ui-copy-cleanup-20261006` | Points at `1a87753`, an ancestor of `main`, with 0 unique commits. It is not the cleanup. Fetched read-only to `refs/recovery/codex-ui-copy-cleanup-20261006`. |
| Saved cleanup commits | GitHub refuses `def6d528` and `0db516ce` ("not our ref"), as the handoff warned. `refactor/ui-copy-cleanup-20261007` does not exist on the remote. |
| Docs read | `AGENT_RULES.md` (§4 #38, §8–§10, the Reports personal-layout invariant and refresh amendment, the Campaigns table invariant, the manual SMS UI rule); `VISION.md`; the newest `WORK_LOG.md` and `implementation_plan.md` entries; `docs/plans/2026-10-09-reports-refresh-audit/` (`data-basis-wording.md`, `production-release.md`, `implementation_plan.md`, `verification.md`). There is no `CLAUDE.md` or `AGENTS.md` in the repository. |
| Not received | The archive and the five handoff documents (`AgentFlow_UI_Copy_Audit.md`, `AgentFlow_UI_Cleanup_Implementation_Plan.md`, `AgentFlow_UI_Cleanup_Verification_and_Handoff_20261009.md`, `CURRENT_RECONCILIATION_NOTES.md`, `METRIC_LABEL_ADDENDUM.md`). The session's uploads directory is empty. |

---

## §2. Recovery status — BLOCKED (exact missing item)

*(2026-10-11: superseded by §17. Chris directed a fresh plan against current code; the sandbox was not retried and nothing was recovered. Kept for history.)*

**Named sandbox.** `ui-copy-cleanup-20261007-7e5caef` (team `team_iPboOWpwdIQRwdxmA5GJp5Rq`, project `prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc`) exists and is **stopped**. Its cwd is `/vercel/sandbox`.

| Snapshot | Status | Created (UTC) | Expires (UTC) |
|---|---|---|---|
| `snap_NLNxyouDyIOKaNHBk9Elg8nge1iz` (current, automatic, parent `snap_E9Lz…`) | created | 2026-10-11 02:52 | 2026-11-10 02:52 |
| `snap_E9LzZeDV5vYzaN2WszrzqzToDL8v` (previous verified, manual) | created | 2026-10-09 21:07 | **2026-10-18 02:48** (7 days after last use) |
| `snap_sSJ0…`, `snap_DfGE…`, `snap_Vw08…` (older) | created | 2026-10-08 | 2026-11-08, 2026-11-07, **2026-10-15** |

**What was attempted. Both requests were refused and nothing changed.**
1. `create sandbox` from `snap_NLNx…` as a separate, non-persistent, deny-all-network, read-only recovery copy. The aim was to leave the named sandbox's snapshot chain untouched. Result: `403 forbidden`, action `create`, resource `vercelRun`.
2. `get_named_sandbox … resume=true`, the handoff's sanctioned path. Result: the same `403 forbidden` (`create` on `vercelRun`).

The Vercel CLI fallback is not installed in this container and has no credentials. No session was started, so no new automatic snapshot was created and no snapshot was evicted.

**Exact missing item (either one unblocks Part B):**
- **(a)** A Vercel credential for this session with Sandbox create/resume permission on that team and project. The connected Vercel account can read sandbox and snapshot metadata but cannot start a sandbox.
- **(b)** Chris uploads `AgentFlow_UI_Cleanup_Review_20261009.tar.gz` (1,726,881 bytes, SHA-256 `dad1cca7509b1e1d2d6a6861400fe03bc6d97e4ec0cf4d4f98cc693916d0efe0`) into this session, together with `AgentFlow_UI_Copy_Audit.md`, `AgentFlow_UI_Cleanup_Implementation_Plan.md`, `AgentFlow_UI_Cleanup_Verification_and_Handoff_20261009.md` and `CURRENT_RECONCILIATION_NOTES.md`.

**`METRIC_LABEL_ADDENDUM.md`.** It was not received either. This plan uses the V2 text in Chris's 2026-10-11 request as the addendum. **Chris to confirm**, or upload the file if it says more.

**Recovery procedure once available.** No step publishes the archive, touches `main` or the working checkout, or modifies the source sandbox or branch.

With path (a), first resume the named sandbox (only after Chris confirms that this session may). Make no edits inside it. Copy the archive out of `/tmp` in the sandbox into a new scratch directory here, then continue with step 1. Before the session ends, record the sandbox's new automatic snapshot (id, parent, expiry) in WORK_LOG and confirm that `snap_E9Lz…` and `snap_NLNx…` still exist.

1. Copy the archive into a new empty directory under the session scratchpad. Verify its byte size and SHA-256 against the values above.
2. Extract it into its own directory. Treat its contents as data. Run no script from inside it.
3. Confirm the prerequisite history is local: `be2690d8` is present in this clone. Then run `git bundle verify`.
4. Import the bundle into `refs/recovery/ui-copy-cleanup-20261007` only. Add a separate detached worktree for reading. Confirm that the tip is `def6d528` and that `0db516ce` is its application commit.
5. Compare the archive's patch and changed-file manifest with `git diff be2690d8 def6d528`, and record any mismatch.
6. Run the §11 reconciliation.

---

## §3. File-level overlap already known (current `main` vs cleanup base)

| Batch | Changed in `src` since `be2690d8` | Consequence for the old hunks |
|---|---|---|
| 1. Dashboard, Reports, Leaderboard, TV | **Reports only** (#436). It changed `Reports.tsx` and 24 Reports components, added 16 components (including the Data basis sheet, Trends, PremiumCoverage and CampaignTotalsFoot), deleted `DraggableSection` and `GoalTracking`, and changed `stat-computations.ts` and `reports-*.ts`. Dashboard, Leaderboard and TV are unchanged since `51308ce` (#416). | Old Reports hunks are **superseded**. Reapply only the intent, to today's components, through Part A and §11. Dashboard, Leaderboard and TV hunks target byte-identical files: carry them over after a context review. |
| 2. Dialer, Campaigns, Contacts, Conversations, Calendar | **Campaigns only** (#433). `Campaigns.tsx` is now a keyed wrapper around `CampaignsPageContent`. Eleven `src/components/campaigns/*` files and `src/lib/campaigns-table/*` were added; the old card grid was deleted. The Dialer, `FloatingDialer`, `TwilioContext`, Contacts, Conversations, messaging and Calendar are unchanged. | Old `Campaigns.tsx` card-grid hunks are **superseded**. Never restore the old file. Reapply the intent in `CampaignsPageContent` and its children only where it is still needed. Other batch 2 hunks target unchanged files. |
| 3. Settings, workflows, administration | **`ProfileNotificationsSection.tsx`** (#439 added the `OnboardingEmailPreference` import at :5 and the mount at :74), plus the new `OnboardingEmailPreference.tsx`, `EmailUnsubscribePage.tsx` and the `App.tsx` route. Workflows, super-admin, control-center and `SettingsPage` are unchanged. | Review any hunk in `ProfileNotificationsSection.tsx` by hand against the new mount. Do not touch the onboarding preference or the unsubscribe page (§10 C). |
| 4. Resources, Training, profiles | None. `AgentProfile`, `agent-profile/*`, Resources and Training are unchanged since `b3c0839` (#386). | Carry over after a context review. |

**Superseded old-cleanup instructions:**
- **"How totals are counted" panel.** It does not exist on `main`, in the base or in any ref. The Data basis sheet (`ReportDataBasis.tsx` and `DataBasisSections.tsx`) is the only reporting-help surface. Never reintroduce the panel.
- **Retaining "Known annual premium", "Known monthly premium" or similar qualified titles.** V2 supersedes this.
- **Edits to the deleted Campaigns card grid.**
- **The old `ReportDataQuality` signature.** The current contract is `{ summary: LiveSummary }`, where `LiveSummary = {status:"loading"} | {status:"unavailable"} | {status:"ready"; data}` (`ReportDataQuality.tsx:5,11`).
- **Any Reports hunk written against pre-#436 components.**

---

## §4. Part A — V2 canonical label mapping

**Rule applied:** change presentation names only, at the existing boundary. Ids, payload keys (including `known_count` and `unknown_count`), RPCs, calculations, denominators, date windows, attribution, CSV headers and values, and CSV Note constants are all unchanged. Each surface keeps its existing letter case (D1). Reports uses sentence case; the Dashboard, Leaderboard, Dialer and profiles use Title Case.

### §4.1 Reports (sentence case)

| Current display text | New display text | Where it appears (current owning file) | Meaning, verified in code; unchanged |
|---|---|---|---|
| Known annual premium | **Annual premium** | Band h2 and article `aria-label` (`ReportsOverview.tsx:75,78`); Trends caption, chart `aria-label` "… by {unit}", series name, key-list `aria-label`, tooltip `dt` and live readout (`PoliciesSoldChart.tsx:47,63,111,112,117,122`); agent table header (`AgentPerformanceCards.tsx:26`); campaign table header and tfoot key (`CampaignPerformance.tsx:17`, `CampaignTotalsFoot.tsx:21`); Data basis section title (`reports-basis-text.ts:109`) | Sum of known current stored monthly premiums ×12, on the sold-date, current-owner cohort. Unknowns are excluded; when all are unknown it shows "Unavailable", never $0. |
| Known monthly | **Monthly premium** | Band (`ReportsOverview.tsx:87`) | `premium.monthly_premium`. "Unavailable" when all premiums are unknown. |
| Avg per known policy / Avg / known policy (phone) | **Average annual premium** / phone **Avg annual premium** | Band (`ReportsOverview.tsx:92-93`) | `average_annual_premium`. The denominator stays the known-premium policy count; "—" when none are known. `PREMIUM_AVERAGE_NOTE` in Data basis states it. |
| Avg annual premium / known policy | **Average annual premium** | Strip and customizer label for `stat_avg_premium` (`stat-computations.ts:94`) | Same as above. The tile's coverage subtitle "k/n known policies" stays. |
| Known annual premium (registry label of the fixed stat) | **Annual premium** | `stat_annual_premium` label (`stat-computations.ts:93`). It is never rendered (a fixed stat). Renaming keeps the vocabulary single and keeps the customizer negatives (`reportCustomizer.test.tsx:36`, `verify.mjs:203`) meaningful. | Same as the band. |
| Policies (current assignment) | **Policies sold** | Agent performance and agent efficiency screen headers (`AgentPerformanceCards.tsx:26`, `AgentEfficiency.tsx:34`) | Stored policies by sale date in the period, credited to the client's **current** agent. This is not seller credit; the Data basis "Agent credit" section states it. The CSV header stays "Policies (current assignment)". |
| Bookings created (all types) | **Appointments** | Period totals tile (`ReportsActivityFlow.tsx:32`), whose "by date created" caption stays; strip and customizer label for `stat_appointments_set` (`stat-computations.ts:104`); agent table header (`AgentPerformanceCards.tsx:27`); Data basis section title (`reports-basis-text.ts:112`) | Every booking of any kind, by `created_at`, credited to `COALESCE(created_by, user_id)`, regardless of status. **Not** scheduled, upcoming, attended or completed appointments. |
| Most policies — current assignments | **Most policies sold** (D3) | Band leader row `dt` (`ReportsOverview.tsx:54`); strip label for `stat_top_performer` (`stat-computations.ts:122`), renamed together | The same single current-assignment ranking and tie rule ("N agents tied · X policies each"). It is never "Top performer". |
| "{n} policies currently assigned" (tile subtitle) | **"{n} policies"** (D3) | `stat-computations.ts:259` | The value is unchanged, and it now matches the band's "Bob Agent · 2 policies". |
| Policies (campaign-attributed) | **Attributed policies** (D4) | Campaign table header and tfoot key (`CampaignPerformance.tsx:17`, `CampaignTotalsFoot.tsx:20`) | Unambiguous conversion-lineage policies. It is never "Policies sold"; AGENT_RULES says "Campaign Performance has no Policies Sold". The CSV header stays. |
| Known / total policies | **Premium coverage** (D5) | Campaign table header and tfoot key (`CampaignPerformance.tsx:17`, `CampaignTotalsFoot.tsx:22`) | The coverage indicator value stays "k/n". The CSV header stays. |

### §4.2 Dashboard, Leaderboard, TV and profiles (Title Case, as today)

| Current display text | New display text | Where it appears | Meaning; unchanged |
|---|---|---|---|
| Annual Premium Sold | **Annual Premium** | Dashboard card (`StatCards.tsx:79`) | Sale-event wins, 12 × sale-time monthly premium, seller credit, period. The card id `premium_sold` stays. |
| Annual Premium Sold Analysis{range} | **Annual Premium{range}** | Drilldown title (`DashboardDetailModal.tsx:156`) | Same. |
| Appointments Detail{range} | **Scheduled Appointments{range}** | Drilldown title (`DashboardDetailModal.tsx:146`). It opens from the "Scheduled Appointments" card. | Workload: `status='Scheduled'`, `start_time`, `user_id`. It stays distinct from created-date appointments. |
| "Closed: {type} • {$X \| Premium unknown} annualized" | **"Closed: {type} • {$X} annual premium"** or **"Closed: {type} • Premium unknown"** | Drilldown row (`DashboardDetailModal.tsx:635`) | This fixes a real display defect: an unknown row currently reads "Premium unknown annualized". |
| Premium Sold (metric selector, TV selector, TV podium, deep-rank header, TV ranking title) | **Annual Premium** | Through a new display-only `METRIC_DISPLAY_LABEL` in `leaderboardTypes.ts`, used at `LeaderboardFilters.tsx:76`, `TVMode.tsx:319`, `TVPodium.tsx:98`, `TVDeepRankPanel.tsx:36` and `TVRankingsTable.tsx:50`. The `Metric` ids, `LEADERBOARD_METRICS`, the TV `localStorage` index and `METRIC_COLUMN` keys stay. | `premiumSold`, which is annualized sold premium. The ranking table column already says "Annual Premium". |
| Policies per 100 Calls (selector, TV ranking title, podium caption, user tab) | **Policies / 100 Calls** | Display map, `metricLabel` (`leaderboardTypes.ts:108`), `UserPerformanceTab.tsx:34` | The same rate the table headers already label "Policies / 100 Calls" (`LeaderboardRankingsTable.tsx:115`, `TVRankingsTable.tsx:65`). The CSV header "Policies per 100 Calls" stays. |
| Appointments Set (selector, TV and podium) | **Appointments** (D8) | Same display map, plus `metricLabel` at `leaderboardTypes.ts:104` ("appointments") | The same created-date, setter-credit, all-types metric as the Reports "Appointments". The CSV header "Appointments Set" stays. |
| annualized premium (podium caption) | **annual premium** | `metricLabel` (`leaderboardTypes.ts:110`) | Same. |
| " · Annualized premium (N policies with unknown premium)" | **" · Annual premium (N policies with unknown premium)"** | Shared on-screen caption `performanceCaption` (`leaderboardExport.ts:31`), rendered by the Leaderboard, TV and the Dashboard `LeaderboardWidget.tsx:132`. The CSV headers at :12-15 stay. | The conditional unknown-premium count stays. |
| "Outside active roster: N calls, N bookings, N policies" | "… N calls, N **appointments**, N policies" (only with D8) | `leaderboardExport.ts:34` | The disclosure itself stays (AGENT_RULES). |
| Latest 20 · all periods · annualized premium / title "Annualized premium" | "… · **annual premium**" / title "**Annual premium**" | `RecentWinsPanel.tsx:119,236` | Same. "Premium unknown" stays. |
| Calls / Policies / Appts (main leaderboard table headers) | **Calls Made** / **Policies Sold** / **Appointments** | `LeaderboardRankingsTable.tsx:100,103,109` | Period sold count and created-date appointments. The table's `overflow-x-auto` wrapper and the normal-view gate (`leaderboard-visual/verify.mjs:129-131`) contain the width. |
| Policies / Appts / Talk / Calls (TV compact headers and totals strip) | **Unchanged** (D9) | `TVRankingsTable.tsx:60-64`, `TVAgencyTotalsStrip.tsx:63,77` | They stay compact for the TV layout budget (`leaderboard-visual/verify.mjs:63-66`). The ranking title names the full metric. |
| Appointments Set (month) | **Appointments** | `UserPerformanceTab.tsx:32` | Month to date; the existing "Month to date" line carries the period. |
| Monthly Call Goal / Monthly Appt. Goal | **Monthly Calls Goal** / **Monthly Appointments Goal** | `AgentModal.tsx:159,161` | These match `UserGoalsTab.tsx:34-36` and `ProfileGoalsCard.tsx:146`. The fields are unchanged. |
| Calls (CampaignDetail Stats tile) | **Leads Called** (D10) | `CampaignDetail.tsx:1023` | It counts **leads** with `call_attempts > 0`. It is not "Called": the same tab's Status Breakdown already has a queue-status row "Called" (:1179) with a different count. The heatmap "Calls Made" (:1040) stays. |
| Leads Contacted Over Time (CampaignDetail chart) | **Leads Called Over Time** (D10) | `CampaignDetail.tsx:1117` | It plots every lead by `last_called_at` with no contacted test (:1092-1098), so it shows called leads. |

*Part B note (2026-10-12) on the two caption rows above ("Annual premium (N policies with unknown premium)" and "Outside active roster").* Both wordings are unchanged. Part B (PB-10, B2-01, B2-04; §17.11) changes what surrounds them:
- The caption no longer opens with "Active agents · {time zone} · As of {time}", and it is empty when nothing is material.
- Its segments, each shown only when non-zero, are:
  - the unknown-premium count;
  - "Talk time includes {e} estimated[ and {c} conflicting] call duration(s)", on the Leaderboard page and TV only;
  - the outside-roster note.
- The Dashboard widget shows only the outside-roster note, through the new `outsideRosterNote()`.

### §4.3 Already satisfied or kept (no change)

- **Already simple:** Dashboard "Calls Made", "Policies Sold", "Scheduled Appointments", "Monthly Premium" and "Monthly Appointments"; the Leaderboard and TV "Annual Premium" column and total, "Talk Time", the selector's "Calls Made" and "Policies Sold", and the "Policies / 100 Calls" headers; the Dialer's "Calls Made", "Contacted", "Contact Rate" and "Policies Sold"; `UserPerformanceTab` "Calls Made", "Policies Sold" and "Talk Time"; the profile "Monthly Premium" (lifetime current book, not annualized) and "Carrier appointments" (licensing, excluded from the appointments vocabulary); the Campaigns table columns.
- **"Call contact rate" stays (D2)**, in the strip, Trends, Call flow, Heatmap, tables and Call summary. The campaign and lead-source tables show the lead-level "Contacted leads" right beside it (`CampaignPerformance.tsx:18`, `LeadSourceTable.tsx:23`), so "Call" is a genuinely differentiating word. AGENT_RULES #38 (:472) and `reportsContracts.test.ts:155-168` require it.
- **"Outbound calls" / "Contacted outbound calls" on the Calling trend stay**, with case per D1. "Inbound calls" is shown alongside, and V2 keeps Inbound/Outbound. `CallVolumeChart.tsx:33-36,107,114`.
- **"Dials per booking" stays (D6).** This is the R-1 owner-approved name, protected by `reportsRegistrySnapshot.test.ts:67-68`.
- **Genuine limitations stay**, all separate from the titles:
  - band coverage text "N of M premiums known · K unknown excluded" and the "Partial" chip (`PremiumCoverage.tsx`);
  - "Unavailable" and "—" (`ReportsOverview.tsx:37-43`);
  - the scope-wide policy-quality note;
  - Trends "Some premiums unknown", "Gap = known premium unavailable, not $0" and "Known premium unavailable for this period." (`PoliciesSoldChart.tsx:51,126,129`; D13);
  - agent-table "k/n known · u unknown";
  - strip duration and session cautions;
  - Leaderboard and TV unknown-premium markers;
  - Dashboard, goal-widget and user-tab "N policies have unknown premium";
  - profile "N policies have no premium recorded".
- **CSV-only text stays byte-identical:** the `Reports.tsx:99-106` summary rows, every component `EXPORT_HEADERS` array, the inline chart CSV header arrays, `CommunicationsStats` `exportLabel`/`premiumRows` and `leaderboardExport.ts:12-15`.
- **Shared screen and CSV constants stay byte-identical:** `PREMIUM_BASIS`, `premiumNote`, `qualityNotes`, `integrityExportNotes` and the `reports-policy-text.ts` constants (including `CAMPAIGN_ATTRIBUTION_NOTE`). They appear both in CSV Note rows and in the Data basis sheet.
- **Screen-only notes stay unchanged:** `CAMPAIGN_LINEAGE_NOTE`, the on-screen campaign note (`CampaignPerformance.tsx:98`; never a standalone CSV Note).
- **The Data basis live list is unchanged.** It deliberately shows the CSV Note sentences verbatim ("Known annual premium $…; k/n policies known…", "Bookings created (all types): N; recorded kind: …"). Screen and CSV stay identical by design.
- **Unmounted or unrendered strings are not edited:**
  - `AgentScorecardModal.tsx` (no importers; a documented follow-up);
  - `DayAgendaPanel.tsx` (unmounted);
  - the `stat_policies_sold` label, a fixed stat that is never rendered (`report-layout-constants.ts:25`); `stat_annual_premium` is renamed only for consistency (§4.1);
  - the unavailable registry placeholders (`stat-computations.ts:79-80` contact-rate placeholders, :99 and :105-110 "Appt …" placeholders), which are filtered out of the registry and never listed or rendered (`report-layout-constants.ts:30`);
  - `CustomReportBuilder.tsx` and `ScheduledReportsModal.tsx`, which are unmounted report components.

---

## §5. Presentation boundary and display-only mappings

- **Reports.** Every change is a string literal in:
  - JSX (`ReportsOverview`, `ReportsActivityFlow`, `PoliciesSoldChart`);
  - a screen-only header array (`HEADERS`/`COLUMNS` in `AgentPerformanceCards`, `AgentEfficiency` and `CampaignPerformance`);
  - a `STAT_DEFINITIONS.label`, which flows to `StatCard`, its "Loading {label}" name, the customizer text and the "Show/Move {label}" names, with no component edit;
  - a `dataBasisSections()` title, which is screen-only and used only by `DataBasisSections.tsx:34`.

  Saved `report_layouts` rows store `{id, visible}` only, so a label never persists. Every component stays under the 200-line contract.
- **Display-only mapping 1.** In `CampaignTotalsFoot.tsx:19-24`, the `values` record keys move in lockstep with the renamed `CampaignPerformance` COLUMNS. Otherwise the tfoot renders blank cells silently. A stable-id refactor is not proposed.
- **Display-only mapping 2.** Add `METRIC_DISPLAY_LABEL: Record<Metric,string>` in `leaderboardTypes.ts`, where every entry equals its id except three: "Premium Sold" → "Annual Premium", "Appointments Set" → "Appointments" (D8) and "Policies per 100 Calls" → "Policies / 100 Calls". Because `LeaderboardFilters.tsx:76` renders `<option>{m}</option>` with no `value`, and `onChange` reads the option text, the option must become `<option value={m}>{METRIC_DISPLAY_LABEL[m]}</option>`. Its `<select>` gets `aria-label="Metric"`; today it has no accessible name.
- **Not touched:** shared or byte-pinned constants, CSV builders, `reports-export.ts`, payload schemas, RPCs and migrations.

---

## §6. Part A — exact intended files

### Application files

23 files: 9 Reports and 14 CRM. If D14 is approved, its guard edits `StatCards.tsx`, `LeaderboardRankingsTable.tsx`, `TVRankingsTable.tsx`, `TVPodium.tsx` and `TVDeepRankPanel.tsx`, which are already listed, plus `TVAgencyTotalsStrip.tsx` and `LeaderboardPodiumCard.tsx`, which are then additional files.

| File | Change |
|---|---|
| `src/components/reports/ReportsOverview.tsx` | :54 leader `dt` (D3); :65-66 unchanged (sentence case); :75 and :78 → "Annual premium" (`aria-label` and `h2` together); :87 → "Monthly premium"; :92-93 → "Avg annual premium" (phone) and "Average annual premium" (sm+); the :46 comment follows. |
| `src/components/reports/ReportsActivityFlow.tsx` | :32 label → "Appointments". The basis caption is unchanged. |
| `src/components/reports/PoliciesSoldChart.tsx` | :47 tooltip `dt`, :63 readout ("annual premium $X"; the coverage clause is unchanged), :111 caption, :112 `aria-label` "Annual premium by {unit}", :117 series name, :122 key-list `aria-label` "Annual premium key". **Unchanged:** :51, :126 and :129 (limitations) and the :90 CSV header. |
| `src/components/reports/AgentPerformanceCards.tsx` | `HEADERS` :26-27 only: "Policies sold", "Annual premium", "Appointments". `EXPORT_HEADERS` is unchanged. |
| `src/components/reports/AgentEfficiency.tsx` | `HEADERS` :34 → "Policies sold". `EXPORT_HEADERS` :36-44, including its "Policies (current assignment)" at :43, is unchanged. |
| `src/components/reports/CampaignPerformance.tsx` | `COLUMNS` :17 only: "Attributed policies", "Annual premium", "Premium coverage". `EXPORT_HEADERS` is unchanged. |
| `src/components/reports/CampaignTotalsFoot.tsx` | The :20-22 keys follow the new column labels. The values are unchanged. |
| `src/lib/stat-computations.ts` | Labels :93 "Annual premium", :94 "Average annual premium", :104 "Appointments", :122 "Most policies sold" (D3); subtitle :259 "{n} policies" (D3); the :16 comment follows D3. **No id, calculation or other subtitle changes.** |
| `src/lib/reports-basis-text.ts` | Titles :109 "Annual premium" and :112 "Appointments". `BOOKINGS_NOTE` :29 is reworded per D7; it is screen-only. The :52 and :56 comments follow D3. Every other constant is byte-identical. |
| `src/components/dashboard/StatCards.tsx` | :79 → "Annual Premium". With D14, the value shows "Unavailable" when `policies > 0` and `unknown_premiums === policies`. |
| `src/components/dashboard/DashboardDetailModal.tsx` | :146, :156 and the :635 row text (§4.2). |
| `src/components/leaderboard/leaderboardTypes.ts` | Add `METRIC_DISPLAY_LABEL`. `metricLabel` :104 (D8), :108 ("policies / 100 calls") and :110. |
| `src/components/leaderboard/LeaderboardFilters.tsx` | :70 `aria-label="Metric"`; :76 `value={m}` plus the display label. |
| `src/components/leaderboard/TVMode.tsx`, `TVPodium.tsx`, `TVDeepRankPanel.tsx`, `TVRankingsTable.tsx` | Render `METRIC_DISPLAY_LABEL[metric]` (TVMode :319, TVPodium :98, TVDeepRankPanel :36, TVRankingsTable :50). The TV compact column headers are unchanged (D9). |
| `src/components/leaderboard/LeaderboardRankingsTable.tsx` | :100 "Calls Made", :103 "Policies Sold", :109 "Appointments". With D14, an all-unknown premium cell shows "—" (its marker stays). |
| `src/components/leaderboard/RecentWinsPanel.tsx` | :119 and :236. |
| `src/lib/leaderboardExport.ts` | `performanceCaption` :31 ("Annual premium"), and :34 ("appointments") with D8. **CSV headers :12-15 are unchanged.** |
| `src/components/settings/user-management/UserPerformanceTab.tsx` | :32 → "Appointments"; :34 → "Policies / 100 Calls". |
| `src/components/contacts/AgentModal.tsx` | :159 → "Monthly Calls Goal"; :161 → "Monthly Appointments Goal". |
| `src/pages/CampaignDetail.tsx` | :1023 → "Leads Called" and :1117 → "Leads Called Over Time" (D10). Nothing else, including the stored-counter data issue in §9. |

The TV row covers four files. No other application file is touched; code comments are edited only where they quote a renamed label.

### Tests: update literal-copy and accessible-name queries; keep every semantic assertion

Exact-label negatives must be retargeted to the new label so they cannot pass vacuously.

- `src/components/reports/__tests__/ReportsOverview.test.tsx`: :16, :19 (article name), :37-39 (monthly and average labels, phone and desktop), :55, :63, :107 (comment), the leader helper and describe block at :122-165 (D3), and :175 (Period totals `dt` list).
- `src/pages/__tests__/reportsPage.test.tsx`:
  - :80 and :484-514 (leader label; the :487 negative is retargeted);
  - :508 ("Annual premium");
  - :534-541 ("Attributed policies"; :536 keeps asserting **no** "Policies sold" column in the campaign table);
  - :542 (the unchanged "Calls made" key);
  - :547-551: the "Policies sold" agent header. The test titled "agent views label policy counts as the current assignment" is rewritten to keep a current-assignment assertion: the header reads "Policies sold" **and** the Data basis "Agent credit" section shows `CURRENT_ASSIGNMENT_NOTE`;
  - :595: the exact-label negative (campaign panel failed) is retargeted to "Attributed policies";
  - :615 (renamed tfoot keys).
  - The CSV assertions at :617 and :622-623 are unchanged.
- `src/lib/__tests__/reportsRegistrySnapshot.test.ts`: :71 "Most policies sold" (D3) and :72 "Appointments". The 38 ids, groups, `teamOnly`, order, `DEFAULT_LAYOUT`, the six-metric cap, "Dials per booking", "Call contact rate", "Dials per policy sold" and the `/dials per appointment/` negative are all **unchanged**.
- `src/lib/__tests__/reportStatComputations.test.ts`: :87-88, :99-106 and :198 (D3 label and subtitle). The `/top performer|seller/i` negative at :208 stays.
- `src/lib/__tests__/reportsBasisText.test.ts`: :95 (title), :105-107 (title and the D7 `BOOKINGS_NOTE`). Every paragraph, CSV Note and golden assertion is unchanged, including the :147-153 "no sheet-only sentence reaches a CSV Note" guard.
- `src/components/reports/__tests__/reportCustomizer.test.tsx`: :36. The negative is retargeted to "Annual premium", which is the renamed label of the fixed `stat_annual_premium`, so it still guards that the fixed stat never appears in the editor.
- `src/components/reports/__tests__/reportTrendCharts.test.tsx`: only :103 (the gone-list, retargeted to "Most policies sold") and :107 (the key-list negative, retargeted to "Annual premium key"). The recharts mock means this file asserts no caption or `aria-label`. The CSV assertion at :61 and the D13 limitation assertions at :57, :69, :72 and :93 are unchanged.
- `src/components/reports/__tests__/reportsTrends.test.tsx`: :94-95, :107-116 (`aria-label` and readout).
- `src/components/reports/__tests__/agentPerformanceTable.test.tsx`: :66-67 (screen headers); the :75 comment. The :48 CSV assertion is unchanged.
- `src/components/reports/__tests__/reportsTables.test.tsx`: :76-79, :101-105, :215-216. The CSV assertions at :83, :153 and :226 are unchanged.
- **New CRM label assertions (all mandatory).** Today nothing pins these, so they are added to the existing suites:
  - `src/pages/__tests__/leaderboardPage.test.tsx`: the selector shows "Annual Premium" and "Appointments"; selecting either still sets the `Premium Sold` / `Appointments Set` metric id; the CSV header row is unchanged (the existing :174 pin).
  - `src/components/dashboard/__tests__/dashboardSections.test.tsx`: the "Annual Premium" card label.
  - `src/components/dashboard/__tests__/dashboardDetailModalVoicemail.test.tsx`, or a sibling in that folder: an unknown-premium win row reads "Premium unknown" with no "annualized", and a known row reads "$X annual premium".
  - `src/lib/__tests__/performanceContract.test.ts`: the caption reads "Annual premium (N policies with unknown premium)", and the conditional parts are unchanged.
  - `tvModeRegression.test.tsx`: the TV selector, podium, deep-rank header and ranking title show "Annual Premium" / "Appointments", and the stored `leaderboardTvMetricIndex` still maps each index to the same metric;
  - `leaderboardStatusSurfaces.test.tsx`: the Recent Wins caption and badge title read "annual premium";
  - a new `UserPerformanceTab` render check (no suite exists today): "Appointments" and "Policies / 100 Calls";
  - `campaignDetailImportRetry.test.tsx`, or a sibling: the Stats tab shows "Leads Called" and the separate "Called" status row with their different values;
  - an existing `AgentModal` suite: "Monthly Calls Goal" and "Monthly Appointments Goal";
  - with D14: complete, partial, all-unknown, zero, loading and error states for the Dashboard premium card, the Leaderboard row and the TV podium and totals. All-unknown shows "Unavailable" or "—", never $0.00.
- **Leaderboard and TV regressions:** `useLeaderboardData.test.tsx` and the existing `tvModeRegression.test.tsx` "Calls Made" pin run unchanged.

### Gates and docs (amendments are listed in §7)

- `scripts/tests/reports-visual/verify.mjs`: :48, :52-53 (IMPORTANT_COLUMNS), :203 (retargeted to "Annual premium"), :295, :298-305 (D3), :322, :362, :601, :686, :692-693 (monthly and average labels), :697, :699-700 (default strip tile `stat_appointments_set` → "Appointments"), :709, :716-723 (tfoot keys) and :737 (readout). The CSV checks (:756, :775), the budgets, axe, the one-line checks and the R-4 probe are unchanged. `scripts/tests/reports-visual/README.md`: :44 and :46.
- `AGENT_RULES.md`: three narrow wording amendments (§7).
- `docs/plans/2026-10-09-reports-refresh-audit/data-basis-wording.md`: **append** a dated "V2 simple-label amendment (2026-10-11)" section that supersedes rows C8/C9, C10, C22 (Trends caption), C27 (tooltip `dt` and readout wording; the limitation lines stay verbatim per D13), C30 (bookings label), B2.1 (section name) and B5.1 (`BOOKINGS_NOTE`). The shipped rows are left as history.
- `WORK_LOG.md` and the root `implementation_plan.md`: newest-first entries.

---

## §7. Rule, test and doc amendments needing Chris's approval

All amendments are display-wording only. None changes a definition, calculation, CSV contract or semantic guard.

1. **AGENT_RULES.md §4 #38, Policies Sold sub-bullet (:474).**
   - Current: `the UI says "Policies (current assignment)" and "Most policies — current assignments" (never "Top performer");`
   - Proposed: `the UI labels them "Policies sold" and "Most policies sold" (never "Top performer"); the Data basis "Agent credit" section (CURRENT_ASSIGNMENT_NOTE) states the current-assignment basis, and CSV headers keep "Policies (current assignment)";`
2. **AGENT_RULES.md Reports refresh amendment (:659).**
   - Current: `the production band (Policies sold, Known annual premium with its coverage bar, and the leader row)`
   - Proposed: `the production band (Policies sold, Annual premium with its coverage bar, and the leader row)`
3. **AGENT_RULES.md Reports refresh amendment (:668).**
   - Current: `Leader ties for "Most policies — current assignments" use one rule everywhere.`
   - Proposed: `Leader ties for "Most policies sold" (the current-assignment ranking) use one rule everywhere.`
   - The tie format sentences are unchanged.
4. **`reportsRegistrySnapshot.test.ts` "contract wording" block (:71-72).** It pins `stat_top_performer` and `stat_appointments_set` labels. The file header already says "Labels may change wording"; the frozen identity assertions are untouched.
5. **`data-basis-wording.md`.** An appended V2 section supersedes C8/C9, C10, C22, C27, C30, B2.1 and B5.1. It states that `PREMIUM_BASIS` and the CSV Notes are unchanged. The 74-file CSV result is recorded only after the §12 capture has passed.
6. **Not proposed.**
   - AGENT_RULES :472 "Call contact rate" stays (D2).
   - The `reportsContracts.test.ts` call-contact-rate scan stays.
   - AGENT_RULES :476 "Campaign Performance has no Policies Sold" stays.
   - AGENT_RULES :510 keeps "Bookings created (all types)" as the metric's definition text.
   - The refresh `implementation_plan.md` "Kept verbatim" list stays as history.

---

## §8. Decisions for Chris (recommendation first)

- **D1 — Letter case.** *Recommended:* change the words and keep each surface's existing case. Reports was deliberately moved to sentence case in #436 (`reportTableStyles.ts:2`, `ReportSection.tsx:7`), and the CRM already uses Title Case. The words become identical ("Annual premium" / "Annual Premium"), the diff stays small, and about 40 case-only test rewrites are avoided. *Alternative:* Title Case for every Reports metric label, including "Calls Made", "Contacted Calls", "Converted Leads/Clients", "Dialer Session Time" and so on. That adds roughly 25 case-only label edits and their test and gate updates, and the case-sensitive negatives must be retargeted (for example `reportsPage.test.tsx:114/125/136/172/183/218/297/536/593`).
- **D2 — "Call contact rate" vs "Contact Rate" on Reports.** *Recommended:* keep "Call contact rate". The campaign and lead-source tables show the lead-level "Contacted leads" beside this call-level rate, so a bare "Contact rate" would invite a lead-level reading. *Alternative:* "Contact rate" on screens only. That needs AGENT_RULES :472 reworded and the `reportsContracts.test.ts:155-168` and `reportsPage.test.tsx:227-234` guards rewritten, which weakens a semantic guard.
- **D3 — Leader label.** *Recommended:* "Most policies sold", on the band and the strip tile together (the AGENT_RULES one-name rule). Change the tile subtitle "{n} policies currently assigned" to "{n} policies". The attribution stays in the Data basis "Agent credit" section. *Alternatives:* "Most policies", or keep the current text.
- **D4 — Campaign table policy column.** *Recommended:* "Attributed policies". *Alternative:* keep "Policies (campaign-attributed)". It can never be "Policies sold".
- **D5 — Campaign coverage column.** *Recommended:* "Premium coverage", with the k/n values unchanged. *Alternative:* keep "Known / total policies". Note that "Premium coverage" in the Production trend tooltip is a percentage.
- **D6 — "Dials per booking" beside "Appointments".** *Recommended:* keep it. It is the R-1 owner-approved name, it is not a V2 target, and it is hidden by default. *Alternative:* "Dials per appointment". That reverses R-1 and needs the snapshot negative, `reportStatComputations.test.ts:63-66`, `verify.mjs:207-208` and `DIALS_PER_BOOKING_NOTE` amended.
- **D7 — Data basis bookings wording.** This is screen-only; `BOOKINGS_NOTE` is not a CSV Note. *Recommended text:* "Appointments counts every booking of any type, including callbacks, by the date it was created and credits the person who created it (older bookings with no recorded creator credit the booking's user). Exports call it "Bookings created (all types)"." Without it, the sheet would show the "Appointments" heading above the unchanged live CSV line "Bookings created (all types): 4; recorded kind: 0 appointment, …" with nothing connecting the two names. *Alternative:* retitle only, and rely on the note's current opening words.
- **D8 — "Appointments Set" on Leaderboard, TV and the user tab.** *Recommended:* "Appointments", which is the same metric as on Reports. The CSV header "Appointments Set" stays. *Alternative:* keep "Appointments Set".
- **D9 — TV compact headers "Policies", "Appts", "Talk", "Calls".** *Recommended:* keep them compact on TV only, for the TV layout budget. The main Leaderboard table expands them. *Alternative:* expand on TV too and re-run the TV layout gate.
- **D10 — CampaignDetail called-lead labels.** The "Calls" tile counts leads called, and the "Leads Contacted Over Time" chart plots called leads. *Recommended:* "Leads Called" and "Leads Called Over Time". Plain "Called" would collide with the Status Breakdown's queue-status row. *Alternative:* leave both.
- **D11 — Description items outside the label pass.** These are:
  - the band basis bar "Current book · stored policies by sale date · monthly premium ×12 · client's current agent" (approved C2/C3; it hosts the Data basis button);
  - formula subtitles: "calls in period ÷ dated stored policies in period" (`stat-computations.ts:245`), "talk minutes in period ÷ dated stored policies in period" (:280), "session-matched calls ÷ all session hours" (:215), "session-matched talk ÷ all session time" (:229), Call summary "Contacted calls ÷ calls made", and the Agent efficiency footnote;
  - the Period totals date-basis captions "by call date", "by date created", "distinct people · by call date" and "by sale date" (`ReportsActivityFlow.tsx:30-34`; approved C30);
  - the Dashboard line "{scope} · {time_zone} · Through {end} · Compared with previous full {range}" (`StatCards.tsx:91`);
  - the profile hint "Sum of the monthly premium recorded on each policy. Not annualized."

  *Recommended:* none changes in Part A. Decide them in Part B against the approved audit inventory, and remove them without replacement only if the audit already approved that.

  *Part B outcome (approved 2026-10-11, implemented 2026-10-12; §17.11, reconciliation.md):*
  - **Band basis bar.** Removed at every width (B3-01, PB-13). The band keeps only its Data basis button, right-aligned in the existing footer row, and the full attribution stays in the sheet's Agent credit section.
  - **Formula subtitles.**
    - "calls in period ÷ …" and "talk minutes in period ÷ …" are deleted (B3-07, B3-08). The new screen-only `POLICY_RATIOS_NOTE` in the sheet defines both ratios as period ratios, available only for the whole organization, and not original-seller efficiency (PB-15).
    - The two session subtitles are deleted (B3-05, B3-06).
    - The Call summary "Contacted calls ÷ calls made" is deleted (B3-23).
    - The Agent efficiency footnote is deleted (B3-26).
    - The sheet already defined these.
  - **Period totals captions.** The heading line `PERIOD_TOTALS_LINE` is removed (B3-03). Only Appointments keeps "by date created", because bookings created are not appointments scheduled (B3-04).
  - **Dashboard line.** The time zone, "Through {end}" and "Compared with previous full {range}" are removed. The line now appears only for the Team view (its scope) or when premiums are unknown (their count) (B1-13).
  - **Profile hint.** Deleted entirely, including "Not annualized." (B7-30, PB-33). The tile title names the unit, and the monthly arithmetic and missing-premium caveat stay.
- **D12 — Band average on phones.** *Recommended:* "Avg annual premium" below sm and "Average annual premium" from sm, measured by the 390 px budget and the one-line gates.
- **D13 — Conditional Trends limitation lines.** *Recommended:* keep them verbatim ("Known premium unavailable for this period.", "Gap = known premium unavailable, not $0"). They are genuine conditional limitations, not titles, and C25 tightened them deliberately.
- **D14 — All-unknown premium on the Dashboard and Leaderboard.** V2 requires "Unavailable", never $0, for a wholly unavailable value. Today `get_performance_summary` and the Leaderboard snapshot return a coalesced 0 (`20261005161626_performance_scoped_summaries.sql:51`; `performanceQueries.ts:12`), so the relabelled "Annual Premium" card shows "$0.00" when every premium is unknown, and an agent row shows "$0.00*". *Recommended:* a display-only guard, with no RPC or calculation change, mirroring the Reports band (`ReportsOverview.tsx:35-41`). It shows "Unavailable" on the Dashboard card and "—" in Leaderboard and TV cells when `policies > 0` and every premium is unknown; the unknown-premium markers stay. *Alternative:* record it as a known limitation and leave it out of this task.

---

## §9. Known data issues observed (not label changes; not fixed here)

- **CampaignDetail Contacted/Converted/Contact Rate** read the unmaintained stored `leads_contacted`/`leads_converted` columns (`CampaignDetail.tsx:811,1008-1010`; AGENT_RULES :126, a deferred fix). They can show 0 for real activity. Fixing this is a separate, approved task.
- **The `stat_avg_premium` tile** relies on the server returning NULL at zero known premiums (verified in migration `20261006043738`, :90). It has no client guard like the band's. No change.
- **Accessibility.** The Leaderboard and TV unknown-premium "*" is title-only, so it is not available to screen-reader or touch users. The Dashboard stat cards are clickable divs without keyboard support. Neither is in this scope; both are recorded for a follow-up.

---

## §10. Newer work preserved (owning files and invariants)

- **A. Reports refresh (#436) and R-3.**
  - The four fixed parts (band, Trends, Period totals, Data basis sheet; `Reports.tsx:154-159`) stay.
  - Registry identity is frozen by `reportsRegistrySnapshot.test.ts`. The six-metric cap (`report-layout-constants.ts:14`), one leader tie rule (`reports-basis-text.ts:61-74`), one-line band values and stacking (`reports-hero-size.ts`) and the 390/1440 budgets and axe (`verify.mjs`) all stay.
  - The scope-drift, refresh and export currency protections (`Reports.tsx:39-94`) stay.
  - The shared byte-pinned constants and the `ReportDataQuality` `LiveSummary` contract stay.
  - Part A changes only label strings, and the browser gate re-proves the budgets.
- **B. Campaigns table (#433).** No Part A edit touches `src/components/campaigns/*` or `src/lib/campaigns-table/*`. The following stay: authoritative `get_campaign_card_stats` metrics (200-id chunks, a failed chunk fails all), unavailable versus zero, preference CAS and version refusal, the View As edit block, and no dial action (`CampaignRowActions.tsx:20`).
- **C. Onboarding series stays INACTIVE.** Nothing touches:
  - `OnboardingEmailPreference.tsx`, which renders nothing unless the server reports `onboarding_program_enabled`, and nothing under View As;
  - its mount in `ProfileNotificationsSection.tsx:74`;
  - `EmailUnsubscribePage.tsx`;
  - `supabase/migrations/pending/*`;
  - workers, secrets or cron.

  No email is sent, and the transactional and admin-registration emails are unchanged.
- **D. Manual SMS.** `MessageComposePanel.tsx` (input, Templates, Send), the Conversations and contact-view send guards (View As refusal, the in-flight ref, the stable `request_id`, the sender select) and the server DNC/STOP checks in `twilio-sms` are untouched. The purpose dropdown and readiness paragraph are not restored, and #429 is not merged.
- **E. Dialer and telephony.** `TwilioContext.tsx` (provider only; its copy is toast strings), `twilio-voice.ts:300` `device.connect()`, the re-entrancy lock and telemetry are untouched. No Part A edit is in the Dialer. Inbound forwarding, caller ID, contact field identity, permissions and the Google disclosures are not in scope.

---

## §11. Part B — four-batch carry-over (blocked until §2 is resolved)

*(2026-10-11: superseded by §17, a fresh plan against current code. Kept for history.)*

Once the archive is recovered and verified:
1. **Diff the old work against today.** Produce `git diff be2690d8 def6d528` per file. Map each hunk to the current owning file, using `git log --follow` and content search for files that moved.
2. **Classify every applicable audit group** from the approved inventory (`AgentFlow_UI_Copy_Audit.md`; no new broad inventory). Each group is still needed, already satisfied, superseded by newer UI, or retained for safety or meaning. Record evidence and the current owner in a reconciliation table (`reconciliation.md` in this folder).
3. **Treat batches by overlap:**
   - batch 1 Dashboard, Leaderboard and TV, batch 2 except Campaigns, batch 3 except `ProfileNotificationsSection`, and batch 4 target unchanged files: reapply per hunk after a context review;
   - Reports and Campaigns hunks are superseded: reapply only the surviving intent, to today's components;
   - Part A already covers every metric title.
4. **Present the Part B file list and conflicts for approval,** then implement. Never wholesale-copy old files or accept old conflict hunks.

---

## §12. Verification plan (against the exact pinned base `e11c8bea`)

Nothing below reuses historical counts as a baseline. The base is always the SHA `e11c8bea8bb546023da3fc6489140be2cd464a3e`, never the stale local `main` ref. Commit the candidate before running the exact-base script: its changed-file ESLint reads `git diff --name-only $REPORTS_BASE_SHA HEAD`, which ignores uncommitted work.

1. **Exact-base comparison (CI's `reports-frontend.yml`).** Run `npm ci`. Add a detached base worktree in the scratchpad with `git worktree add --detach $SCRATCH/base e11c8bea8bb546023da3fc6489140be2cd464a3e`. Then run `REPORTS_BASE_SHA=e11c8bea8bb546023da3fc6489140be2cd464a3e REPORTS_BASE_WORKTREE=$SCRATCH/base REPORTS_EVIDENCE=$SCRATCH/evidence python3 scripts/verify_reports_frontend.py`. It compares base and candidate on:
   - the root and `tsconfig.app.json` typechecks, by diagnostic identity and multiplicity;
   - full vitest, by failed suites, failed tests and unhandled runtime-error signatures;
   - the strict Reports file set, which must all pass;
   - changed-file ESLint;
   - the production build.

   Every touched or retargeted suite must pass outright, not merely add no new failures.
2. **Run directly as well:** `npx tsc --noEmit`, `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint` over `git diff --name-only e11c8bea -- '*.ts' '*.tsx'`, and `git diff --check e11c8bea`, which covers committed and uncommitted changes.
3. **CI workflows these paths trigger, with their local equivalents:**

| Workflow | Triggered by | Local equivalent |
|---|---|---|
| `reports-frontend.yml` | `src/**` | Step 1 |
| `reports-backend.yml` | `src/components/reports/**`, `src/lib/reports-*`, `stat-computations.ts`, `scripts/tests/reports-visual/**` | Native SQL payloads, then the Reports browser gate (step 4) |
| `dialer-dnc-backend.yml` | `src/**` | `npx vitest run dialer twilio teamOpen teamCampaign dncCheck useTeamOpen caller-id-selection convertLeadModalPolicyFields leadDisposition outboundPathPinned`, `bash scripts/run_dialer_dnc_tests.sh` and `npx tsc --noEmit` |
| `sms-consent.yml` | `src/components/contacts/**`, `src/components/settings/**` (`AgentModal`, `UserPerformanceTab`) | `npx vitest run src/components/messaging/smsConsent.test.tsx src/pages/__tests__/conversationsSendContract.test.tsx src/pages/__tests__/conversationsViewAs.test.tsx src/components/conversations/__tests__/conversationThreadIsolation.test.tsx src/components/contacts/__tests__/fullScreenContactViewConversation.test.tsx`, `node scripts/test-sms-consent.mjs`, the dialer DNC script and the SMS visual gate |
| `policy-sale-recording.yml` | `src/components/leaderboard/**` | `bash scripts/run_policy_sale_recording_tests.sh` and the leaderboard/TV visual gate (step 6) |

   A suite that needs native PostgreSQL or Docker and cannot run in this container is reported as **not run locally**; CI evidence then comes from the approved publication.
4. **Targeted suites:**
   - all Reports suites;
   - Leaderboard and TV: `leaderboardPage`, `leaderboardStatusSurfaces`, `tvModeRegression`, `useLeaderboardData` and `performanceContract`;
   - Dashboard: `dashboardSections`, `dashboardDetailModal*`, `goalProgressAppointmentsSet` and `dashboardRefreshWiring`;
   - the contacts `AgentModal` suites, `campaignDetailImportRetry` and the new `UserPerformanceTab` check;
   - the Campaigns table and permission suites, as a shared-surface regression.
5. **Reports browser gate** (`scripts/tests/reports-visual/verify.mjs`). It covers:
   - the 390 px and 1440 px first-screen budgets, axe, one-line values and the R-4 probe;
   - the renamed accessible names;
   - complete, partial, all-unknown, zero, loading and error states.

   Evidence from the documented embedded path is labelled "embedded SQL + real browser, not native PostgreSQL".
6. **Leaderboard and TV visual gate** (`scripts/tests/leaderboard-visual/verify.mjs`): the TV fixture geometry (D9) and the normal-view overflow with the expanded table headers.
7. **CSV byte identity, the 74-file golden comparison.** Re-run the capture on base `e11c8bea` and on the candidate:
   - with the fixed clock 2026-10-09T04:00Z, 1,100 ms pacing and America/Los_Angeles;
   - over all 13 export controls, every view toggle and grouping, in Agency, Team and Personal.

   Require 74/74 identical raw and normalized SHA-256. The capture tool is not committed to the repository, so recover it with the archive, or build it as a recorded scratch tool. The 13-file `csv/manifest.json` from `verify.mjs` `exportAll()` is supplementary only.
8. **Full-diff review against `e11c8bea`.** Look for any id, payload, RPC, calculation, CSV, permission, View As, dialer, SMS or onboarding change. Confirm all four outcomes:
   - missing or unknown data never shows as zero;
   - a failure never renders as empty;
   - stale data is never shown as live;
   - current assignment is never presented as seller credit.

   Confirm that the appointment created-date semantics and the current-owner attribution are still stated in Data basis.
9. **Local visual checks:**
   - all touched surfaces, and in Part B all four batches;
   - at desktop and 390 px, in light and dark;
   - by role (Personal, Team and Agency scopes; Agent, Team Leader and Admin) and in View As;
   - using local fixtures.

   These are labelled as local fixture checks. Signed-in acceptance on a protected preview is a separate step after publication approval. No production user, call or message is created to test copy.

---

## §13. Explicit non-actions and release gates

The following do not happen in this task:

- No database, RLS, migration, Edge Function, secret, cron, deployment-setting, RPC, hook, calculation, export, authorization, queue, call, disposition or workflow change.
- No Supabase production access.
- A **branch push, PR, preview or publication** each needs Chris's explicit approval. A branch push can trigger a Vercel deployment; it is not side-effect-free.
- A **direct push to `main`, merge, bypass or share link, branch-protection change or production deployment** is not done without the corresponding separate approval. None is requested by this plan.
- No onboarding activation.
- No import of #429 or any other open PR.
- No change to a user-authored field name or content.
- No global replacement of "known".
- No new subtitle, paragraph or information icon to compensate for a removed qualifier.

---

## §14. Close-out after approval (Phase 4)

1. **Commits**, each reviewable on its own:
   - (i) Reports label strings and their tests;
   - (ii) CRM labels, `METRIC_DISPLAY_LABEL` and their tests, plus D14 if approved;
   - (iii) the gate, README, AGENT_RULES and `data-basis-wording.md` amendments approved in §7;
   - (iv) the Part B batches, each with its tests, once recovered and approved;
   - (v) `WORK_LOG.md`: a newest-first entry with date and status, files, decisions, verification, migrations and deploys (none), blockers and next steps.
2. **A separate review pass** of the full diff, covering both the visual cleanup and regressions against newer work. Its findings are recorded and fixed before any publication request.
3. **Final context snapshot:**
   - current base, head and branch;
   - recovery status;
   - applied, already-satisfied, superseded and deferred items;
   - newer work preserved;
   - changed files;
   - tests against the base;
   - visual coverage and its limits;
   - migrations and deploys (none);
   - blockers;
   - the single next approval needed.

   It states exactly whether the work is local-only, PR-ready, preview-approved or released.

---

## §15. Risks

| Risk | Mitigation |
|---|---|
| A label rename leaves an exact-text negative passing vacuously. | Every negative is retargeted to the new label (§6). The browser gate fails closed on stale selectors. |
| The tfoot goes blank after a header rename. | Its keys move in the same edit, and the tfoot tests and `verify.mjs:716-723` assert the values under the new keys. |
| The Leaderboard selector breaks when its option text changes. | `value={m}` keeps the id. A new test selects by label and asserts the id. |
| "Monthly premium" or "Average annual premium" wraps on phones. | D12 uses a phone form, and the 390 px budgets are re-run. |
| The two vocabularies inside Data basis confuse readers. | D7 states the equivalence, including callbacks. The live list stays verbatim by design. |
| The base is mistaken for the stale local `main`. | Every command pins `e11c8bea` by SHA (§12). |
| Snapshots expire: `snap_Vw08…` on 2026-10-15 and the previous verified `snap_E9Lz…` on 2026-10-18. | §2: restore recovery access before then. |

---

## §16. Approved Part A implementation (2026-10-11): final intended files, recorded before any edit

**Approval.** Chris approved, on 2026-10-11, the isolated Part A implementation with decisions D1–D14. That decision text supersedes the §8 recommendations where the two differ. The following are **not** approved:
- publication, a push, a PR or a hosted preview;
- merging or deploying;
- any backend, Supabase or migration change;
- email activation, or sending any email, SMS or call.

Part B stays open.

**Base.** `origin/main` was re-fetched on 2026-10-11 and is still `e11c8bea8bb546023da3fc6489140be2cd464a3e`. The newest WORK_LOG and plan entries are unchanged, and the open PRs are unchanged (#429 and the other drafts are excluded). The comparison base is a detached worktree at that SHA in the session scratchpad.

**Attachment not received.** `AgentFlow_Cleanup_References_All_In_One.md` did not reach this session; the uploads and attach directories are empty, and nothing turned up in a filesystem search. Part A follows the decision text in Chris's approval. The Part B audit classification (§11) still needs the file.

**Decisions as approved:**
- **D1.** Keep each screen's existing capitalization; use consistent business wording across equivalent metrics.
- **D2.** Keep "Call contact rate".
- **D3.** "Most policies sold" on the band and the tile. The tie format is preserved, and the Data basis "Agent credit" section carries the current-agent attribution.
- **D4/D5.** "Attributed policies" and "Premium coverage".
- **D6.** Keep "Dials per booking".
- **D7.** A concise Data basis clarification (all booking types, including callbacks, by creation date). No subtitle is added under the metric.
- **D8.** "Appointments" for the booking-created metric; "Scheduled appointments" for workload.
- **D9.** The TV keeps its short headings.
- **D10.** "Leads Called" and "Leads Called Over Time", labels only.
- **D11.** Deferred to Part B; not dropped.
- **D12.** "Avg annual premium" on narrow screens.
- **D13.** Conditional limitation lines stay.
- **D14.** A separately committed, presentation-only guard (below).

### Commit 1: Reports labels (Part A)
- **App:** `src/components/reports/ReportsOverview.tsx`, `ReportsActivityFlow.tsx`, `PoliciesSoldChart.tsx`, `AgentPerformanceCards.tsx` (screen `HEADERS` only), `AgentEfficiency.tsx` (screen `HEADERS` only), `CampaignPerformance.tsx` (screen `COLUMNS` only), `CampaignTotalsFoot.tsx` (header keys move in lockstep), `src/lib/stat-computations.ts` (labels and the `stat_top_performer` subtitle only), and `src/lib/reports-basis-text.ts` (two section titles, the screen-only `BOOKINGS_NOTE`, and comments).
- **Tests:** `src/components/reports/__tests__/ReportsOverview.test.tsx`, `reportCustomizer.test.tsx`, `reportTrendCharts.test.tsx`, `reportsTrends.test.tsx`, `agentPerformanceTable.test.tsx` and `reportsTables.test.tsx`; `src/lib/__tests__/reportsRegistrySnapshot.test.ts` (two label lines), `reportStatComputations.test.ts` and `reportsBasisText.test.ts`; `src/pages/__tests__/reportsPage.test.tsx`.
- **Gate:** `scripts/tests/reports-visual/verify.mjs` (display selectors only) and `scripts/tests/reports-visual/README.md`.

### Commit 2: CRM labels (Part A)
- **App:**
  - Dashboard: `src/components/dashboard/StatCards.tsx` and `DashboardDetailModal.tsx`.
  - Leaderboard and TV: `src/components/leaderboard/leaderboardTypes.ts` (adds `METRIC_DISPLAY_LABEL`; `metricLabel` wording), `LeaderboardFilters.tsx` (`value={m}` plus `aria-label`), `TVMode.tsx`, `TVPodium.tsx`, `TVDeepRankPanel.tsx`, `TVRankingsTable.tsx`, `LeaderboardRankingsTable.tsx` and `RecentWinsPanel.tsx`.
  - Shared caption: `src/lib/leaderboardExport.ts` (`performanceCaption` text only; CSV untouched).
  - Settings, contacts and campaigns: `src/components/settings/user-management/UserPerformanceTab.tsx`, `src/components/contacts/AgentModal.tsx` and `src/pages/CampaignDetail.tsx`.
- **Tests:**
  - `src/pages/__tests__/leaderboardPage.test.tsx`: selector label-to-id mapping; CSV header unchanged.
  - `src/components/leaderboard/__tests__/tvModeRegression.test.tsx`: TV display labels; the stored index maps to the same metric.
  - `src/components/leaderboard/__tests__/leaderboardStatusSurfaces.test.tsx`: Recent Wins wording.
  - `src/components/dashboard/__tests__/dashboardSections.test.tsx`: the card label.
  - `src/components/dashboard/__tests__/dashboardDetailModalVoicemail.test.tsx`, or a new sibling: unknown-premium row text.
  - `src/lib/__tests__/performanceContract.test.ts`: caption.
  - New `src/components/settings/user-management/__tests__/userPerformanceTab.test.tsx`.
  - CampaignDetail and AgentModal label checks, in an existing suite or a new sibling under `src/pages/__tests__/` or `src/lib/__tests__/`.

### Commit 3: approved display-wording amendments
- `AGENT_RULES.md` :474, :659 and :668 (§7 items 1–3).
- `docs/plans/2026-10-09-reports-refresh-audit/data-basis-wording.md`: an appended, dated V2 addendum.

### Commit 4: D14, presentation-only (its own commit)
- **New helper:** `src/lib/premiumAvailability.ts`. It reports a premium amount as wholly unavailable only when the same row or period's own counts show `policies > 0` and every one of those policies has an unknown premium. It never infers from `amount === 0`.

  The evidence is the same unit on both sides. `performance_rows.policies_sold` counts the wins in the window, and `unknown_premiums` counts those wins whose sale-time monthly premium is NULL (`20261005161623_performance_reporting_contract.sql:101-107`). The Dashboard summary sums both (`20261005161626:48-52`).
- **Surfaces:**
  - Dashboard: `StatCards.tsx` (card value "Unavailable"; trend suppressed when either period is wholly unavailable) and `widgets/GoalProgressWidget.tsx` (the Monthly Premium bar shows "Unavailable" rather than $0).
  - Leaderboard and TV, where the cell shows "—":
    - `LeaderboardRankingsTable.tsx`, `TVRankingsTable.tsx`, `TVPodium.tsx` and `TVDeepRankPanel.tsx`;
    - `LeaderboardPodium.tsx` together with `LeaderboardPodiumCard.tsx`, where the value prop becomes nullable;
    - `TVAgencyTotalsStrip.tsx`, using the roster's summed counts.

  Leaderboard and TV use the existing `OdometerValue` null → "—" path. Sorting, ranks, payloads, CSV and calculations are untouched.
- **States preserved:**
  - no policies: the existing $0.00 empty-period display;
  - known premiums totalling $0: a genuine $0.00;
  - partial coverage: the subtotal plus the existing unknown markers and captions;
  - loading, failed and stale: the existing distinct states.
- **Tests:** new `src/lib/__tests__/premiumAvailability.test.ts`; Dashboard card and trend states in `dashboardSections.test.tsx`; the goal-widget premium state in `goalProgressAppointmentsSet.test.tsx` or a sibling; Leaderboard and TV row, podium and totals states in `leaderboardPage.test.tsx`, `tvModeRegression.test.tsx` or a new focused suite.
- **Not covered, and reported instead of expanded:** the profile Business Snapshot "Monthly Premium" (`BusinessSnapshot.tsx:101`). It is a lifetime current-book sum, it uses the different "no premium recorded" evidence from `get_profile_book_stats`, and it is not a reporting period. It needs its own decision.

### Commit 5: records
- `WORK_LOG.md`: a newest-first entry.
- This plan, plus the pointer in the root `implementation_plan.md`.

### §16.1 Review-driven additions, recorded before the edits (2026-10-11)

The separate review pass, covering correctness, V2 compliance, test quality and newer-work preservation, found no blocker. Four minor findings were verified real:

1. **D14 follow-up.** Settings › User Management › Goals still shows a wholly unknown monthly premium as "$0.00 / goal" and "0%". It reads the same `performance_summary.current.monthly_premium` that the Dashboard goal widget now guards, through `usersApi.getPerformance` and `UserProfileModal.tsx:102`. After D14 the two surfaces therefore disagree for the same agent and month.
   - **Addition:** a second, separately reviewable D14 commit. The goal-actuals mapping moves into a pure helper, `goalActualsFrom()`, in the existing `userManagementUtils.ts`. Its premium actual becomes null when `isPremiumWhollyUnknown(policiesMonthly, unknownPremiums)`, and `UserGoalsTab` already renders null as its existing unavailable "—".
   - **Unchanged:** the API adapter, payload, calculation and every other goal.
   - **Files:** `src/components/settings/user-management/userManagementUtils.ts`, `UserProfileModal.tsx`, and a new test `src/components/settings/user-management/__tests__/userGoalActuals.test.tsx`.
   - It falls under the approved D14 rule (wholly unavailable premium amounts, from existing evidence for the same scope and period). It is committed alone, so it can be dropped independently.
2. **Test strengthening, test-only.**
   - The TV D14 test's rank assertion could be satisfied by the calls column (`callsMade: 10`). It now asserts the rank cells.
   - Genuine-$0 cases (policies > 0, all premiums known, total $0) are added for the TV podium, ranking table, ranks 11+ and totals, the Leaderboard podium and the goal widget. An `amount === 0` inference would now fail.
3. **Records.** The plan header and the root pointer still read "PLAN ONLY"; they are updated in the records commit.
4. **Refuted.** The CampaignDetail empty state "No contact activity yet" is outside D10's labels-only scope. It is left unchanged and noted as optional.

**Still not covered, reported instead of expanded:** the profile Business Snapshot "Monthly Premium" (lifetime current-book sum, different evidence; see above). *(Corrected in §17.9: the tile shows "—", not $0.00; the only $0 is the milestone ladder.)*

---

## §17. Part B — fresh targeted plan against current code (2026-10-11; approved with overrides, §17.11; implemented 2026-10-12, §17.12)

*§17.0–§17.10 are the plan as presented for approval and are kept as written. §17.11 records the approved decisions and file list, and §17.12 records how the implementation went. Where they differ from §17.0–§17.10, §17.11 and §17.12 win.*

### §17.0 Status, authority and provenance

- **Authority.** On 2026-10-11 Chris authorized preparing a fresh, targeted Part B plan against current code. This is not approval to edit app or test files. No Part B app or test file has been edited.
- **Not recovered.** The old Part B implementation was not recovered, and nothing here is reconstructed from old files or old conflict hunks. The denied Vercel sandbox operations were not retried. No attachment was required.
- **Base.** Branch `claude/ui-copy-cleanup-v2-20261011` (draft PR #440). Code is identical at `62546df` and `51fff58` apart from a whitespace fix. Base `main` `e11c8bea`.
- **Method.**
  - Seven read-only mapping passes, one per area, each followed by an independent adversarial verification pass.
  - The verifier re-read every cited line, corrected classifications, wording and line numbers, and added items the mapper missed.
  - Verifier corrections win.
- **The full per-item table** is [`reconciliation.md`](reconciliation.md) in this folder. It holds every item with its classification, exact before and after text, tests, rule pins, accessibility notes and the verifier's corrections. This section is the consolidated plan built on it, and §11's batch plan is superseded by it (§11 is kept for history).
- **The audit inventory** `AgentFlow_UI_Copy_Audit.md` is still not in the repository. Items are classified against Chris's Part B standard of 2026-10-11, quoted in §17.1.

### §17.1 The standard being applied (Chris, 2026-10-11)

**Global.**
- Delete rather than shrink. No bulk deletion.
- Keep screen-reader descriptions.
- Surgical, Tailwind-only edits. Components stay under 200 lines; already-oversized files only shrink.
- Respect `organization_id`, RLS and View As. Use `.maybeSingle()` and Zod.
- No frontend secrets, service-role keys or production mocks.
- No DB, RLS, Edge, RPC, calculation, export, authorization, workflow or telephony changes.
- For any Dialer presentation edit, `TwilioContext.tsx` is read, and single-leg `device.connect()`, the re-entrancy guards and telemetry are preserved.
- Onboarding stays INACTIVE.

**By area.**
1. **Dashboard.**
   - "Synchronizing Intelligence…" becomes "Loading records…".
   - "No intelligence found…" becomes an ordinary empty state.
   - Remove the "AgentFlow Analytics Engine • Batch Size…" footer.
   - "Close" replaces "Dismiss View".
   - Remove the persistent "Available at…" sentence beside Refresh, preserving the cooldown, keyboard access and click guards.
   - Remove routine timezone, timestamp and provenance paragraphs.
   - Preserve D14.
2. **Leaderboard and TV.**
   - Remove routine diagnostic paragraphs.
   - Methodology stays only in existing details areas.
   - Preserve stale, offline and error indicators, missing-data indicators, rankings, ties, ids and the TV layout.
   - No export changes.
3. **Reports.**
   - Keep the current structure.
   - Review the D11 formula, basis and helper lines and consolidate them into the existing Data basis sheet.
   - No "How totals are counted" block. Reuse shared constants. Identify rule-pinned amendments.
4. **Dialer and Campaigns.**
   - Remove generic intros.
   - Keep the distinct queue states (no leads, leads in use, retry waiting, licensing, completed, failed loading), preserving next-eligible timing.
   - Remove congratulatory filler but keep session totals.
   - Keep the Campaigns table.
   - No queue or dialing logic changes.
5. **Contacts, Conversations and Calendar.**
   - "Select a conversation".
   - Remove redundant empty-state prose and obvious modal intros.
   - Preserve drafts, feedback, field identity and permissions.
6. **Settings, Phone, workflows and admin.**
   - Remove generic "Manage…/Configure…" intros and shorten necessary explanations.
   - Preserve forwarding, recording, DNC/STOP, permissions, irreversible actions and unavailable-feature notices.
   - No change to user-authored content.
7. **Resources, Training and profiles.**
   - Remove "Fast Access Library", "Knowledge Library", "Viewing X resources…" and descriptions that restate the heading.
   - Keep real content.
   - Do not broaden D14 to Business Snapshot (recorded separately, §17.9).

### §17.2 Cross-area consolidation (one owner per surface)

1. **Dashboard Leaderboard widget caption.** B1-15 and B2-04 cover the same line, so there is one implementation.
   - `performanceCaption`'s existing "Outside active roster: …" segment moves, with unchanged wording, into an exported `outsideRosterNote(snapshot)` helper in `src/lib/leaderboardExport.ts`.
   - The widget renders only that note, and only when it is non-zero.
   - This keeps AGENT_RULES #40's "disclose excluded inactive/unattributed activity" on the widget, so no rule amendment is needed for the widget.
   - Reason: the widget can say "No sales recorded yet this month." while policies were sold outside the active roster, and "View Full Standings" opens the Leaderboard on Today, not this month.
2. **Settings › My Profile** is owned by Area 6. Area 7's items on those cards are pointers.
3. **Shared dialogs** are changed once for every surface that renders them:
   - `MessageTemplatesPickerModal`: contact view and Dialer;
   - `AppointmentModal`: Calendar, contact view and Dialer.
4. **Visible dialog/sheet descriptions that only restate the title** follow the pattern decided in PB-1.

### §17.3 Planned changes by area

The exact before and after text, tests and pins for every ID are in `reconciliation.md`.

#### Area 1 — Dashboard

10 changes in 4 files · retained 9 · already satisfied 6 · superseded 0 · 1 pointer to another area.

  - **B1-01** `components/dashboard/DashboardDetailModal.tsx` — Synchronizing Intelligence... → Loading records...
  - **B1-02** `components/dashboard/DashboardDetailModal.tsx` — No intelligence found in this range / (line 728) Activity will appear here as records are proc… → Line 727: "No records found". Line 728: (delete).
  - **B1-03** `components/dashboard/DashboardDetailModal.tsx` — AgentFlow Analytics Engine • Batch Size: {BATCH_SIZE} (rendered inside <div className="flex it… → (delete) the left-hand div at DashboardDetailModal.tsx:825-830, including the dot at 826. At 824, change `justify-betwe…
  - **B1-04** `components/dashboard/DashboardDetailModal.tsx` — Dismiss View → Close
  - **B1-05** `components/dashboard/DashboardDetailModal.tsx` — `${detail.scope} · ${detail.time_zone} · As of ${new Date(detail.end_at).toLocaleString()}` (e… → setPerformanceSubtitle(detail.scope) at DashboardDetailModal.tsx:274 (the subtitle <p> at 690 is unchanged). Owner note…
  - **B1-07** `components/dashboard/DashboardDetailModal.tsx` — Loading next batch... → Loading more records...
  - **B1-12** `components/dashboard/DashboardRefreshButton.tsx` — <span id="dashboard-refresh-hint" className="hidden text-[10px] text-muted-foreground sm:inlin… → <span id={hintId} className="sr-only">Available at {formatStatusTime(availableAt)}</span>, under the same {!refreshing …
  - **B1-13** `components/dashboard/StatCards.tsx` — {data.performance.scope} · {data.performance.time_zone} · Through {new Date(data.performance.e… → Replace StatCards.tsx:97 with: {data?.performance && (adminToggle === "team" || data.performance.current.unknown_premiu…
  - **B1-14** `components/dashboard/widgets/GoalProgressWidget.tsx` — {data.timeZone} · {data.unknownPremiums ? `${N} policies have unknown premium; premium progres… → {data.unknownPremiums ? `${data.unknownPremiums} policies have unknown premium; premium progress is incomplete.` : "Mon…
  - **B1-M1** `components/dashboard/StatCards.tsx` — vs {data?.prevLabel || "yesterday"} (with stats null and loading false, every card shows "—" p… → Render the chip label only when a comparison basis exists: {data?.prevLabel && <span className="text-[10px] uppercase t…

#### Area 2 — Leaderboard and TV

5 changes in 4 files · retained 17 · already satisfied 2 · superseded 1.

  - **B2-01** `lib/leaderboardExport.ts` — :29 `const asOf = new Intl.DateTimeFormat("en-US", { timeZone: snapshot.time_zone, dateStyle: … → Keep the approach: delete :29 (asOf) and the unconditional prefix "Active agents · {tz} · As of {time} · Annual premium…
  - **B2-02** `pages/Leaderboard.tsx` — {performanceSnapshot && <p className="px-1 text-xs text-muted-foreground">{performanceCaption(… → Conditional render, so an empty <p> never takes a space-y-6 slot (the 1.5rem gap goes with the line). No other spacing …
  - **B2-03** `components/leaderboard/TVMode.tsx` — {performanceSnapshot && <p className="text-xs text-slate-400 text-center">{performanceCaption(… → As proposed: `{caption && <p className="text-xs text-slate-400 text-center">{caption}</p>}`, with `const caption = perf…
  - **B2-04** `components/dashboard/widgets/LeaderboardWidget.tsx` — {performanceSnapshot && <p className="text-center text-[10px] text-muted-foreground">{performa… → Do not delete the disclosure on the widget; reduce it to the one relevant note. In src/lib/leaderboardExport.ts, export…
  - **B2-06** `lib/leaderboardExport.ts` — · Stored call duration: X estimated, Y unknown provenance, Z conflicting [only when any > 0] → (delete) from the on-screen caption: remove the :26-28 reductions and the :32 segment. performanceQueries' schema and v…

#### Area 3 — Reports

19 changes in 8 files · retained 24 · already satisfied 2 · superseded 2.

  - **B3-01** `components/reports/ReportsOverview.tsx` — "Current book · stored policies by sale date · monthly premium ×12 · client's current agent" (… → "Credited to the client's current agent" at every width (PRODUCTION_BASIS_BAR gets this value; PRODUCTION_BASIS_BAR_SHO…
  - **B3-02** `components/reports/ReportsOverview.tsx` — "Primary + additional policies" (shown when policiesSold > 0; zero case: "No policies sold in … → (delete) the non-zero line; keep "No policies sold in this period." verbatim (markup as proposed).
  - **B3-03** `components/reports/ReportsActivityFlow.tsx` — "Independent period totals, not one cohort." → (delete) PERIOD_TOTALS_LINE and its <p>; keep the bare h2 'Period totals' (markup as proposed).
  - **B3-04** `components/reports/ReportsActivityFlow.tsx` — "by call date" (Calls made), "by call date" (Contacted calls), "by date created" (Appointments… → Delete 'by call date' (Calls made), 'by call date' (Contacted calls), 'distinct people · by call date' (Converted leads…
  - **B3-05** `lib/stat-computations.ts` — "session-matched calls ÷ all session hours" → (delete): return { value: num(ratio(sessionPop.calls, sessionPop.secs / 3600)) };
  - **B3-06** `lib/stat-computations.ts` — "session-matched talk ÷ all session time" → (delete): return { value: r === null ? DASH : `${(r * 100).toFixed(1)}%` };
  - **B3-09** `lib/stat-computations.ts` — "all booking types" → (delete): return { value: num(ratio(t.calls_made, t.appointments_set)) };
  - **B3-10** `lib/stat-computations.ts` — "distinct people" → (delete): return { value: formatCount(t.converted) };
  - **B3-11** `lib/stat-computations.ts` — "callback dispositions" (repeats the tile label 'Callback dispositions', stat-computations.ts:… → (delete): return { value: formatCount(t.callback_calls) };
  - **B3-13** `lib/stat-computations.ts` — "agency calendar day" → (delete): return { value: formatCount(row?.calls_made ?? 0) }; keep the :289 reason.
  - **B3-14** `lib/stat-computations.ts` — "Monday to today, agency calendar" → "Monday to today"
  - **B3-21** `components/reports/CommunicationsStats.tsx` — "Outbound dials" → (delete) subtitle 'Outbound dials'; exportLabel unchanged
  - **B3-22** `components/reports/CommunicationsStats.tsx` — "Outbound calls that reached a contact" → (delete)
  - **B3-23** `components/reports/CommunicationsStats.tsx` — "Contacted calls ÷ calls made" → (delete)
  - **B3-24** `components/reports/CommunicationsStats.tsx` — "On calls made" → (delete)
  - **B3-26** `components/reports/AgentEfficiency.tsx` — "Calls per session hour = session-matched calls ÷ session hours." → (delete)
  - **B3-27** `components/reports/CallVolumeChart.tsx` — "{c} contacted ÷ {n} outbound calls" (non-zero buckets; zero buckets show "No outbound calls; … → (delete) the non-zero formula line; keep "No outbound calls; rate unavailable." (markup as proposed: {period.calls_made…
  - **B3-29** `components/reports/CallDurationAnalysis.tsx` — "Stored outbound call durations; estimates and unknown provenance are listed in Data basis." → (delete)
  - **B3-30** `components/reports/CallFlowAnalysis.tsx` — "Hours and days are in the agency time zone; a bucket with no calls shows no call contact rate… → "Hours and days are in the agency time zone."

#### Area 4 — Dialer and Campaigns

28 changes in 10 files · retained 34 · already satisfied 4 · superseded 1.

  - **B4-01** `components/dialer/CampaignSelection.tsx` — [Phone icon] DIALER → (delete)
  - **B4-02** `components/dialer/CampaignSelection.tsx` — Choose an active campaign to start dialing. → (delete)
  - **B4-09** `components/dialer/campaignSettingsSchema.ts` — Matches caller ID to the lead's area code using eligible agency numbers. Personal/direct numbe… → Matches caller ID to the lead's area code using eligible agency numbers. Personal numbers are excluded from rotation; i…
  - **B4-11** `pages/DialerPage.tsx` — There are no remaining leads to dial in this campaign that haven't already been called or mark… → (delete)
  - **B4-13** `components/dialer/QueueExhaustedNotice.tsx` — heading "No Available Contacts In Queue."; detail "Your queue is empty or all contacts have be… → While not loaded: heading "Checking queue…" with no detail. When loaded with no row: heading "Couldn't load queue statu…
  - **B4-14** `components/dialer/QueueExhaustedNotice.tsx` — heading "This Campaign Has No Leads."; detail "Import or assign leads to this campaign to star… → heading "This Campaign Has No Leads." unchanged; detail deleted
  - **B4-15** `components/dialer/QueueExhaustedNotice.tsx` — heading "No leads in your licensed states for this campaign."; detail "This campaign only serv… → heading unchanged; detail "Add licenses in your profile or ask your admin."
  - **B4-17** `components/dialer/QueueExhaustedNotice.tsx` — heading "All Available Leads Are Being Dialed."; detail "{n} lead(s) is/are currently locked b… → `${n} lead${n !== 1 ? "s are" : " is"} locked by ${m} active agent${m !== 1 ? "s" : ""}.`
  - **B4-18** `components/dialer/QueueExhaustedNotice.tsx` — heading "No Eligible Leads Right Now."; detail "Leads exist but aren't callable yet ({n} waiti… → `${bits.join(", ")}.`; fallback "Waiting on retry timing, callbacks, or suppression."
  - **B4-20** `pages/DialerPage.tsx` — Your queue is empty or all contacts have been processed. Additional leads will appear here whe… → (delete)
  - **B4-21** `pages/DialerPage.tsx` — Next Available Contact Is In {formatTimeUntil(...)} → Next eligible in {formatTimeUntil(...)}
  - **B4-23** `components/dialer/QueuePanelLocked.tsx` — {n} agent(s) dialing → (delete)
  - **B4-24** `components/dialer/QueuePanelLocked.tsx` — Queue order is managed by your campaign admin. / Leads are assigned automatically as you dial. → Leads are assigned automatically as you dial.
  - **B4-33** `pages/DialerPage.tsx` — [green dot] Dialer Ready → (delete) — or, as the owner alternative, bind to twilioStatus
  - **B4-35** `pages/DialerPage.tsx` — Queue is now empty. Great work! → Queue is now empty.
  - **B4-36** `pages/DialerPage.tsx` — This lead is scheduled for a future retry or callback and normally shouldn't be called yet. Ar… → This lead is scheduled for a future retry or callback. Override the schedule and call now?
  - **B4-40** `components/layout/FloatingDialer.tsx` — One tap unlocks optional desktop pop-ups for inbound life-insurance calls (Twilio rings in the… → (delete)
  - **B4-41** `components/layout/FloatingDialer.tsx` — Browser notifications are off — you’ll still get the in-app incoming screen and Twilio’s ringt… → Browser notifications are off. Incoming calls still ring in this tab.
  - **B4-42** `components/layout/FloatingDialer.tsx` — Your call history will appear here → (delete)
  - **B4-43** `components/layout/FloatingDialer.tsx` — When recentError is true (set at :394), the panel shows "No recent calls" (:1008-1011), the sa… → recentError: "Couldn't load recent calls."; empty: "No recent calls"
  - **B4-44** `components/layout/FloatingDialer.tsx` — How did it go? → Select Outcome
  - **B4-46** `contexts/TwilioContext.tsx` — Desktop alerts are on for inbound calls. Twilio plays the ringtone in your browser. → Desktop alerts are on for inbound calls.
  - **B4-56** `pages/CampaignDetail.tsx` — You haven't claimed any leads in this campaign yet. Join the Dialer to get started. → You haven't claimed any leads in this campaign yet.
  - **B4-58** `pages/CampaignDetail.tsx` — No leads in this campaign yet. Add leads from the Leads tab to get started. → No leads in this campaign yet.
  - **B4-64** `contexts/TwilioContext.tsx` — Allow notifications in your browser settings if you want desktop pop-ups. Twilio still rings i… → Allow notifications in your browser settings if you want desktop pop-ups. Incoming calls still ring in this tab.
  - **B4-65** `hooks/useDialerSession.ts` — Could not load campaigns. Check your connection or ask an admin to verify database migrations. → Could not load campaigns. Check your connection.
  - **B4-66** `components/campaigns/CampaignHeatmap.tsx` — When the calls query fails, `data` is undefined, totalCalls is 0 (:95-100), and isEmpty is tru… → On error: "Couldn't load call data.", with cells in the existing loading style (muted, no tooltip). "No call data yet" …
  - **B4-67** `pages/CampaignDetail.tsx` — When leadFilter !== "All" (select at :873; filter applied at :598-600) and nothing matches, th… → With leadFilter !== "All": "No leads match this filter." With leadFilter === "All": the role texts unchanged, with B4-5…

#### Area 5 — Contacts, Conversations and Calendar

18 changes in 10 files · retained 28 · already satisfied 9 · superseded 2.

  - **B5-01** `pages/Conversations.tsx` — <h2 className="text-2xl font-bold text-foreground mb-2">Your Unified Inbox</h2> followed by <p… → <h2 className="text-2xl font-bold text-foreground">Select a conversation</h2> (delete the <p> on Conversations.tsx:318-…
  - **B5-09** `components/messaging/MessageTemplatesPickerModal.tsx` — <p className="text-sm font-normal text-muted-foreground">Pick a saved template for this {chann… → (delete MessageTemplatesPickerModal.tsx:118-121; DialogHeader keeps only <DialogTitle>Message templates</DialogTitle>; …
  - **B5-11** `pages/Contacts.tsx` — noDataTitle "No leads yet" + noDataBody "Add your first lead to start building your pipeline."… → "No leads yet" + Add Lead button when permitted (delete Contacts.tsx:2762; 2556 `noDataBody?: string;`; 2575 `{noDataBo…
  - **B5-12** `pages/Contacts.tsx` — "No clients yet" + "Convert leads to clients after policy sales, or add one manually." + 'Add … → "No clients yet" + Add Client button (delete Contacts.tsx:2865)
  - **B5-13** `pages/Contacts.tsx` — "No recruits yet" + "Start building your recruit pipeline." + 'Add Recruit' → "No recruits yet" + Add Recruit button when permitted (delete Contacts.tsx:2962)
  - **B5-15** `pages/Contacts.tsx` — "No {noun}s match your filters" + "Try adjusting or clearing your filters to see more." + 'Cle… → "No {noun}s match your filters" + Clear filters button (delete Contacts.tsx:2566; prepend `mt-3` to the :2567 button)
  - **B5-18** `pages/Contacts.tsx` — "No imports yet" + "When you import leads via CSV, your history will appear here." + 'Import C… → "No imports yet" + Import CSV button when permitted (delete Contacts.tsx:3082; prepend `mt-3` to the :3085 button)
  - **B5-23** `components/contacts/ContactsFilterModal.tsx` — <SheetTitle>Filter {activeTab}</SheetTitle> + <SheetDescription>Narrow down your {activeTab.to… → (delete ContactsFilterModal.tsx:137-139; SheetContent :134 gets aria-describedby={undefined}; remove `SheetDescription,…
  - **B5-25** `components/contacts/FullScreenContactView.tsx` — "No Notes Yet" + "Important details and context will be stored here." (1223-1224), below the n… → "No Notes Yet" (delete FullScreenContactView.tsx:1224)
  - **B5-26** `components/contacts/FullScreenContactView.tsx` — "Not in any campaigns" + "This lead is not currently part of any dialer campaigns." (1277-1278… → "Not in any campaigns" (delete FullScreenContactView.tsx:1278)
  - **B5-27** `components/contacts/TasksPanel.tsx` — "No tasks yet" + "Add a follow-up task to keep track of next steps." (118-119), header has 'Ad… → "No tasks yet" (delete TasksPanel.tsx:119)
  - **B5-28** `components/contacts/FullScreenContactView.tsx` — <DialogTitle>Delete Note</DialogTitle> + <DialogDescription>Are you sure you want to delete th… → (delete FullScreenContactView.tsx:1333; DialogContent :1330 gets aria-describedby={undefined})
  - **B5-37** `components/contacts/ConvertLeadModal.tsx` — <DialogDescription className="text-muted-foreground text-[10px] -mt-0.5">Closing the sale for … → Closing the sale for {lead?.firstName} {lead?.lastName}.
  - **B5-44** `components/contacts/ImportLeadsModal.tsx` — stepTitles subtitles: 1 "Upload a CSV file to import leads into AgentFlow", 2 "Match your CSV … → Titles only: "Import Leads", "Map Your Fields", "Review Your Import", "Importing..." (no subtitles; ImportLeadsModal.ts…
  - **B5-45** `components/contacts/ImportLeadsModal.tsx` — label "Lead status for imported leads" (1757) + helper <p className="text-xs text-muted-foregr… → (delete ImportLeadsModal.tsx:1773; optional owner decision)
  - **B5-51** `pages/CalendarPage.tsx` — <p>No appointments scheduled for today</p> → <p>No appointments</p>
  - **B5-53** `components/calendar/AppointmentModal.tsx` — <DialogDescription className="text-[10px] text-muted-foreground opacity-80">{editing ? "Update… → (delete AppointmentModal.tsx:414-416; DialogContent :407 gets aria-describedby={undefined}; remove DialogDescription fr…
  - **B5-M1** `components/contacts/ImportLeadsModal.tsx` — <p className="text-foreground text-lg font-medium">Importing your leads...</p>. This renders d… → (delete line 1897; keep the Loader2 spinner (:1896), "Please don't close this window" (:1898), the Progress bar (:1899-…

#### Area 6 — Settings, Phone, workflows and admin

86 changes in 48 files · retained 42 · already satisfied 4 · superseded 1.

  - **B6-01** `pages/SettingsPage.tsx` — <h1 className="text-2xl font-bold capitalize text-foreground">{activeSlug.replace(/-/g, " ")} … → {ALL_SETTINGS_SECTIONS.find((s) => s.slug === resolveSettingsPermissionSlug(activeSlug))?.label ?? "Settings"} (drop `c…
  - **B6-02** `components/settings/SettingsRenderer.tsx` — Ready for configuration. → Coming soon — this section is not active yet.
  - **B6-05** `components/settings/profile/ProfileInfoCard.tsx` — Your name, contact details, and availability → (delete)
  - **B6-06** `components/settings/profile/ProfileInfoCard.tsx` — Set from the availability menu in the top bar (Available · On Break · Do Not Disturb). "On a C… → Set from the availability menu in the top bar.
  - **B6-07** `components/settings/profile/ProfileStateLicensesCard.tsx` — Manage your personal state licenses here. → (delete)
  - **B6-08** `components/settings/profile/ProfileStateLicensesCard.tsx` — Admins can manage team-wide licensing under Phone System → State Licenses. [Go to Phone System… → Admins: sentence deleted, button kept. Non-admins keep 'Your licenses are used to route state-based inbound calls to yo…
  - **B6-10** `components/settings/ProfileCarriersSection.tsx` — adminEditing: "Writing numbers for each carrier. Only carriers listed under Settings → Carrier… → adminEditing: "Only carriers listed under Settings → Carriers can be selected." / self: "Only carriers your agency adde…
  - **B6-11** `components/settings/profile/ProfileGoalsCard.tsx` — Dialing and production targets → (delete)
  - **B6-12** `components/settings/profile/ProfilePasswordCard.tsx` — Update the password you use to sign in → (delete)
  - **B6-19** `components/settings/user-management/UserManagementHeader.tsx` — Manage your team members and pending invitations. → (delete)
  - **B6-20** `components/settings/user-management/PendingInvitesTable.tsx` — Invite new users to join your organization. → (delete)
  - **B6-24** `components/settings/Permissions.tsx` — Manage role-based access controls for your team. → (delete)
  - **B6-25** `components/settings/Permissions.tsx` — :779 "Service-role keys are never exposed to the browser." and :781 "Call/telemetry integrity … → (delete :779 and :781; keep :778 and :780 and the heading)
  - **B6-26** `components/settings/Permissions.tsx` — Control Contacts module actions for this role. Conversion (Lead → Client) is always available … → (delete; make AccordionSection description optional at :316 and render :332 only when present)
  - **B6-27** `components/settings/Permissions.tsx` — Control which pages appear in the sidebar for this role. Settings is always available — use Se… → Settings is always available; use Settings Sections below to control its tabs.
  - **B6-28** `components/settings/Permissions.tsx` — :864 "Control which Settings tabs this role can see. Applies only within your organization." :… → (delete :864, :900, :929, :944 descriptions)
  - **B6-31** `components/settings/CompanyBranding.tsx` — Company Branding can only be edited by an Admin. Contact your agency administrator to make cha… → Company Branding can only be edited by an Admin.
  - **B6-33** `components/settings/CustomMenuLinks.tsx` — Add links to your agency sidebar (above Settings). Choose whether each opens in a new browser … → Links appear in your agency sidebar, above Settings.
  - **B6-34** `components/settings/CustomMenuLinks.tsx` — Custom menu links are managed by agency admins. Additional delegation will be handled through … → Custom menu links are managed by agency admins.
  - **B6-35** `components/settings/CustomMenuLinks.tsx` — Add important external tools directly into your sidebar. → No menu links yet.
  - **B6-37** `components/settings/agency-group/AgencyGroupNoGroup.tsx` — Link independent agents under your agency for shared visibility — without merging their data. → (delete) — keep the three bullets
  - **B6-38** `components/settings/agency-group/AgencyGroupNoGroup.tsx` — :54-56 "When a manager invites your agency to their group, you'll see the invitation here." :5… → Invitations appear here and are emailed to your agency's admin.
  - **B6-39** `components/settings/agency-group/AgencyGroupLeaderView.tsx` — Invite your first agent / Enter their email address above to send an invitation. They'll appea… → Invite your first agent / Invited agencies appear here once they accept.
  - **B6-40** `components/settings/agency-group/AgencyGroupResourceList.tsx` — Resources are uploaded by the master agency. You can view and download what they share. → Resources are uploaded by the master agency.
  - **B6-43** `components/settings/phone/TrustHubSection.tsx` — Register your agency to verify your business identity with telecom networks and improve call a… → Verifies your agency's business identity with telecom networks.
  - **B6-44** `components/settings/phone/TrustHubRegistrationPanel.tsx` — "Understanding Trust Hub Status" + bullets: "Business Profile Approved: Your life insurance ag… → Single line: "Neither status guarantees no spam labeling. These verifications authenticate your agency, but telecom net…
  - **B6-45** `components/settings/phone/TrustHubRegistrationPanel.tsx` — SHAKEN/STIR identity attestation, Voice Integrity remediation, and CNAM (Caller ID Name). → (delete)
  - **B6-46** `components/settings/phone/TrustHubRegistrationPanel.tsx` — Complete this form to register your life insurance agency with the telecom Trust Hub. This cre… → (delete the intro box :411-418)
  - **B6-47** `components/settings/phone/TrustHubRegistrationPanel.tsx` — :427 "Verifies caller identity using encrypted digital signatures. Raises your attestation lev… → :427 "Signs your calls so networks can verify caller identity. US phone numbers only." :436 "Registers your numbers wit…
  - **B6-51** `components/settings/phone/a2p/A2pRegistration.tsx` — The secure form includes the full application, required evidence, review, and final submission… → The secure form includes the full application, required evidence, review, and final submission.
  - **B6-54** `components/settings/phone/NumberManagementSection.tsx` — Enter an area code, state, or city to search available numbers. Inventory is limited and chang… → Inventory is limited and changes frequently.
  - **B6-57** `components/settings/phone/LocalPresenceSection.tsx` — Routing, voicemail, and local presence settings are saved as part of your organization's phone… → (delete)
  - **B6-58** `components/settings/phone/LocalPresenceSection.tsx` — Tip: add numbers in additional area codes to improve answer rates when dialing term-life leads… → (delete)
  - **B6-60** `components/settings/phone/NumberGroupsSection.tsx` — Group numbers by geography, team, or purpose to keep campaign caller IDs focused. → (delete)
  - **B6-61** `components/settings/phone/PhoneNumberRoutingModal.tsx` — Determines who rings when this specific number is called. → (delete)
  - **B6-63** `components/settings/NumberReputation.tsx` — Monitor caller ID health, attestation, spam-label signals, and recent outbound activity. These… → These are signals, not guarantees.
  - **B6-64** `components/settings/NumberReputation.tsx` — "AgentFlow // Reputation shield" / "AI line monitor" / "Continuous watch on your agency's call… → (remove mount :470 and import :12) — or strip promotional strings
  - **B6-65** `components/settings/NumberReputation.tsx` — Guide :472-512 (Spam Heuristics, Attestation levels, Network Specific Signals) duplicated by h… → Keep guide text; delete five header HelpCircle tooltips; make guide toggle a <button type="button" aria-expanded>
  - **B6-67** `components/settings/InboundRoutingManager.tsx` — Configure how every inbound call is answered, routed, and handled when no agent picks up. → (delete)
  - **B6-68** `components/settings/InboundRoutingManager.tsx` — How should incoming calls be distributed during business hours? → Applies during business hours.
  - **B6-69** `components/settings/InboundRoutingManager.tsx` — If no agents are available, or the call goes unanswered, what happens next? → (delete)
  - **B6-70** `components/settings/InboundRoutingManager.tsx` — Set your organization's availability. → (delete)
  - **B6-72** `components/settings/inbound-routing/InboundV2Section.tsx` — Contact's assigned agent first (direct lines take precedence), 20-second browser ring, mobile … → Contact's assigned agent first (direct lines take precedence), browser ring, mobile forwarding with Press 1, agent voic…
  - **B6-73** `components/settings/inbound-routing/InboundV2Section.tsx` — Provider setting (integer). Twilio may hold the ring up to ~5 s longer; measured timings show … → Twilio may hold the ring up to ~5 s longer.
  - **B6-75** `components/settings/state-licenses/StateLicensesSection.tsx` — Track which states each agent is licensed in. Used by state-based inbound call routing. → Used by state-based inbound call routing.
  - **B6-77** `components/settings/CallRecordingSettings.tsx` — <h3>Call Recording</h3> followed by CardTitle "Call Recording" (:137-140) → (delete outer h3 :134)
  - **B6-78** `components/settings/CallRecordingSettings.tsx` — Control how browser-side call recordings are captured and stored. When you set a retention per… → When you set a retention period, recordings older than that limit are eligible for automatic cleanup.
  - **B6-81** `components/settings/CallMonitoring.tsx` — Listen, Whisper, and Barge require Twilio Call Control integration. Full functionality coming … → Listen, Whisper, and Barge are coming soon.
  - **B6-82** `components/settings/CallMonitoring.tsx` — Live via Realtime → Updates automatically
  - **B6-84** `components/settings/CallScripts.tsx` — Write and manage scripts for your agents to use during calls → (delete)
  - **B6-85** `components/settings/CallScripts.tsx` — Call scripts are managed by agency admins. Additional delegation will be handled through Permi… → Call scripts are managed by agency admins.
  - **B6-86** `components/settings/call-scripts/CallScriptsList.tsx` — No scripts yet. Click Add Script to get started. → No scripts yet.
  - **B6-88** `components/settings/DispositionsManager.tsx` — Manage call outcome categories used after every call. → (delete)
  - **B6-90** `components/settings/ContactManagement.tsx` — Configure pipeline stages, custom fields, lead sources, and contact behavior. → (delete)
  - **B6-91** `components/settings/ContactManagement.tsx` — :396 "Manage the status options that appear on lead records and the Kanban board." :406 "Manag… → :396 "Status options on lead records and the Kanban board." :406 "Stages on the recruit Kanban board."
  - **B6-92** `components/settings/ContactManagement.tsx` — Add your first custom field to capture information specific to your agency. → (delete)
  - **B6-93** `components/settings/ContactManagement.tsx` — Enforcement on contact forms ships in a later release; this toggle saves your intent now. → Enforced where custom-field inputs appear (e.g. the contact view). — or plain deletion (owner)
  - **B6-94** `components/settings/ContactManagement.tsx` — Manage the lead source options that appear when adding or importing contacts. → Options shown when adding or importing contacts.
  - **B6-95** `components/settings/ContactManagement.tsx` — :1153 "Control how the system identifies and handles duplicate contacts." :1166 "Choose what f… → (delete all four)
  - **B6-96** `components/settings/ContactManagement.tsx` — :1316 "Choose which fields agents must fill in before a contact record can be saved." :1370-13… → (delete both)
  - **B6-99** `components/settings/CalendarSettings.tsx` — Control how your team's calendar looks and behaves → (delete)
  - **B6-100** `components/settings/CalendarSettings.tsx` — :583 "Choose the default view agents see when they open the calendar" :610 "Controls how the c… → (delete :583, :610, :707, :747 CardDescriptions)
  - **B6-101** `components/settings/CalendarSettings.tsx` — Manage the types of appointments your team can schedule. Default types are locked and cannot b… → Default types are locked and cannot be renamed or removed.
  - **B6-102** `components/settings/CalendarSettings.tsx` — :944 "Configure popups and alerts for your upcoming appointments and callbacks" :951 "How many… → :944 "Popups for your upcoming appointments and callbacks." :951 (delete)
  - **B6-104** `components/workflows/WorkflowList.tsx` — Visual automations triggered by lead activity, dispositions, and more. → (delete)
  - **B6-105** `components/workflows/WorkflowList.tsx` — Workflows let you automate follow-ups, tag leads, send messages, and more — without writing co… → (delete no-workflows text; keep folder-empty text)
  - **B6-106** `components/workflows/panels/ActionConfigPanel.tsx` — ActionConfigPanel.tsx:106 subtitle="Configure this step"; WaitConfigPanel.tsx:71 subtitle="Pau… → (remove subtitle on Action/Wait/Condition panels)
  - **B6-109** `components/settings/EmailSMSTemplates.tsx` — Manage templates for automated and manual messaging. Agency templates are shared with your org… → Agency templates are shared with your organization; Personal templates are visible only to you.
  - **B6-111** `components/settings/Carriers.tsx` — Manage your insurance carrier appointments, logos, and contact numbers → (delete)
  - **B6-112** `components/settings/Carriers.tsx` — Add your first insurance carrier to begin tracking appointments. → (delete)
  - **B6-114** `components/settings/ActivityLog.tsx` — View recent system actions and user activity → (delete)
  - **B6-116** `pages/SuperAdminDashboard.tsx` — Manage all agencies on the platform → (delete)
  - **B6-118** `pages/SuperAdminOrgDetail.tsx` — Manage team members and their platform permissions → (delete)
  - **B6-119** `pages/SuperAdminOrgDetail.tsx` — Agency configuration / Administrative settings and limits for {org.name} / [Configure agency] … → Agency configuration / Coming soon — agency configuration is not active yet. (recommended: disable the no-op button)
  - **B6-121** `components/super-admin/provisioning/ProvisioningPanel.tsx` — Subaccount status per organization. Retry failed or stuck provisioning. → Subaccount status per organization.
  - **B6-122** `components/super-admin/system/SystemMonitoringTab.tsx` — Live registry of cloud infrastructure, integrations, and daemon performance. → (delete)
  - **B6-123** `components/super-admin/system/SystemMonitoringTab.tsx` — Platform outages detected. Engineering is actively investigating. → Platform outages detected.
  - **B6-124** `pages/control-center/ControlCenterOverviewPage.tsx` — Welcome back{, first_name}. Internal AgentFlow platform status. → (delete)
  - **B6-125** `pages/control-center/ControlCenterFeaturesPage.tsx` — :103 "Build status across the platform." :186 EmptyState description "Add the first feature to… → (delete both)
  - **B6-126** `pages/control-center/ControlCenterIssuesPage.tsx` — :100-102 "Broken areas, known problems, blockers, and risks." :167 "Log the first issue to sta… → (delete both)
  - **B6-127** `pages/control-center/ControlCenterRuntimePage.tsx` — Track frontend crashes, unhandled rejections, and runtime system telemetry. → (delete)
  - **B6-128** `pages/control-center/ControlCenterTrackerPage.tsx` — Launch-readiness command center for AgentFlow — systems, items, issues, and marketing reality. → (delete)
  - **B6-129** `pages/control-center/ControlCenterHealthPage.tsx` — :67 "Registry of probes. Live execution is not wired in v1; status is manual." :85 "Add the fi… → :67 "Live execution is not wired in v1; status is manual." :85 (delete description)
  - **MB6-01** `components/settings/CalendarSettings.tsx` — Automatically send a confirmation to contacts when an appointment is created → (delete)
  - **MB6-02** `components/settings/CalendarSettings.tsx` — Play a chime when the reminder popup appears → (delete)
  - **MB6-03** `components/settings/DispositionsManager.tsx` — :663 "Trigger an automation when this disposition is selected." / :726 "What happens to the le… → (delete both)

#### Area 7 — Resources, Training and profiles

21 changes in 14 files · retained 34 · already satisfied 1 · superseded 0 · 11 pointers to another area.

  - **B7-01** `pages/Resources.tsx` — Fast Access Library → (delete)
  - **B7-02** `pages/Resources.tsx` — {filteredDocuments.length} resources available → (delete)
  - **B7-03** `components/resources/AgencyResourceCard.tsx` — [FileText icon] DOCUMENT → (delete)
  - **B7-06** `pages/Resources.tsx` — No script selected / Select a script from the sidebar to view its contents. → Delete the <p> at Resources.tsx:243-245 ('Select a script from the sidebar to view its contents.'). Keep the h3 'No scr…
  - **B7-12** `pages/Training.tsx` — Knowledge Library → (delete)
  - **B7-13** `pages/Training.tsx` — Viewing {filteredResources.length} resources in {activeCategoryName} → (delete)
  - **B7-14** `pages/Training.tsx` — We couldn't find any resources matching your criteria in this category. → (delete) the <p> at Training.tsx:178-180; the h3 'No results found' at L177 stays.
  - **B7-17** `components/training/ResourceCard.tsx` — {resource.file_size || resource.duration || "5 min"} → Remove the "5 min" fallback. Render the meta <span> (L105-108) only when a value exists: {(resource.file_size || resour…
  - **B7-23** `components/agent-profile/AgentProfileTab.tsx` — Lifetime totals across everything you have written. → Lifetime totals across your book of business.
  - **B7-24** `components/agent-profile/BusinessSnapshot.tsx` — Lifetime totals from the [book of business, with DefinitionHint tooltip: 'A policy is the prim… → (delete)
  - **B7-28** `components/agent-profile/BusinessSnapshot.tsx` — People on the book. → (delete the hint prop)
  - **B7-29** `components/agent-profile/BusinessSnapshot.tsx` — Primary policy per client, plus any additional policies recorded. → hint={stats.additionalPolicyCount > 0 ? `Includes ${...} beyond the primary one.` : undefined}
  - **B7-30** `components/agent-profile/BusinessSnapshot.tsx` — Sum of the monthly premium recorded on each policy. Not annualized. → Not annualized.
  - **B7-35** `components/agent-profile/ReadinessCard.tsx` — What it takes to be fully set up to write business. → (delete the description prop)
  - **B7-36** `components/agent-profile/PolicyTypeMixCard.tsx` — Share of the book by product type. → <ProfileSection title={title}>
  - **B7-38** `components/agent-profile/LicensingCard.tsx` — Recorded state licences, the source of truth for where you can write. → (delete the description prop)
  - **B7-39** `components/agent-profile/CarrierAppointmentsCard.tsx` — Carriers on file for you, with writing numbers where recorded. → (delete the description prop)
  - **B7-40** `components/agent-profile/AchievementsCard.tsx` — Career records, derived from recorded policy and dialing history. → (delete the description prop) — on the Agent tab unconditionally; on the Team tab only if B7-26's page-level lifetime s…
  - **B7-41** `components/agent-profile/team/TeamReadinessCard.tsx` — How much of the team is fully set up to write business. → (delete the description prop)
  - **B7-42** `components/agent-profile/team/TeamCoverageCard.tsx` — Where the team is licensed to write. → (delete the description prop)
  - **B7-44** `components/agent-profile/ProfilePrimitives.tsx` — (no copy) <div className="mb-5 flex flex-wrap items-start justify-between gap-3"> → <div className={cn("mb-5 flex flex-wrap justify-between gap-3", description ? "items-start" : "items-center")}>

### §17.4 Rule, record and gate amendments the plan needs (presentation only)

All are display wording or records. None changes behavior.

1. **`AGENT_RULES.md`, after :494 (#40): one new bullet**, needed for PB-9 to PB-11. It is the verifier's corrected text from B2-01, and it uses the date of Chris's approval.
   - `performanceCaption` returns only the conditional notes "Annual premium (N policies with unknown premium)" and "Outside active roster: N calls, N appointments, N policies", or "" when neither applies.
   - The Leaderboard and TV render it only when it is non-empty. The Dashboard widget renders only the outside-roster note, only when it is non-empty.
   - The on-screen notes do not show stored call-duration provenance (if PB-10 is approved). The snapshot still carries and validates those fields.
   - The snapshot contract, its validation and the CSV export are unchanged.
   - For on-screen display only, the bullet supersedes docs/plans/2026-10-04-leaderboard-accuracy/implementation_plan.md:139 and :46. The historical evidence lines (verification.md:56, implementation_progress.md:33) are not rewritten.
2. **`AGENT_RULES.md`, after :666 (optional, recommended in PB-18): one sentence.** "Part B (approved {date}): Reports screens carry no permanent formula or provenance helper lines; those definitions live only in the Data basis sheet, from the shared constants. Conditional data-quality notes, unavailable reasons, coverage counts and the band's attribution line stay on screen. Do not add a second explanation surface."
3. **`docs/plans/2026-10-09-reports-refresh-audit/data-basis-wording.md`: a dated "Part B formula-line amendment" table after the V2 addendum.** It has rows for C2/C3 (basis bar), C4, C13, C16, C17, C19, C27, C29, C30, C32, C40 and C41.
   - The C30 row records that only "by date created" (Appointments) remains.
   - Each row's text is in its reconciliation item.
   - C18, C26, C39, C34, C31/C33, C36 and C23–C25 stay unchanged.
4. **`docs/plans/2026-10-09-reports-refresh-audit/assertion-diff.md`: a dated note at O21 (:45).** It says O21's equivalence now rests on the sheet assertions (reportsBasisText.test.ts:110 and :177, reportsDataBasis.test.tsx:97) once PERIOD_TOTALS_LINE and the "by sale date" caption leave the screen. Nothing historical is rewritten.
5. **This plan.**
   - The D11 outcomes are recorded in §8 for the StatCards line (B1-13), the Reports lines (B3) and the profile hint (B7-30).
   - A Part B note is added to the Part A caption rows (§4.2, :149-150).
   - If PB-31 is approved, the mount reference changes from :74 to :73 (:105, :348).
6. **Browser gates.** These are test harness files, not app code.
   - `scripts/tests/reports-visual/verify.mjs:696` keeps the "8" hero check but no longer requires "Primary + additional policies" (B3-02).
   - `scripts/tests/leaderboard-visual/verify.mjs:19` asserts the material-only caption, plus `doesNotMatch(/Active agents · |As of /)`.
   - `scripts/tests/leaderboard-visual/entry.tsx` gets a routine `?routine=1` variant, and verify.mjs measures TV at 1366×768 with no caption line (B2-03).
   - `scripts/tests/leaderboard-visual/README.md:24` gets a dated line.
7. **No other rule needs changing.** The queue rules (:116-118), Manual SMS (:648), the Campaigns table (:670-678), View As (:369-375), DNC/STOP, forwarding and recording rules are all unchanged.

### §17.5 Decisions for Chris (recommendation first)

**Approving "all recommendations" approves the first option of every item below.**

*Cross-cutting*
- **PB-1. Visible dialog or sheet descriptions that only restate the title.**
  - Recommended: delete the text and pass `aria-describedby={undefined}` on that Radix DialogContent/SheetContent. Radix 1.1.14 documents this opt-out; it leaves no dangling id and no dev warning. It applies to B5-09, B5-23, B5-28 and B5-53.
  - Existing sr-only descriptions are never removed.
  - Alternative: keep each as an sr-only description, so screen readers hear the title twice.
- **PB-2. Shared dialogs** change once on every surface: `MessageTemplatesPickerModal` (contact view and Dialer) and `AppointmentModal` (Calendar, contact view and Dialer).
- **PB-3. Size rule.** Files that are already over 200 lines are edited in place, with net-negative or neutral line counts and no splits: DashboardDetailModal, Dashboard, GoalProgressWidget, Leaderboard, TVMode, DialerPage, FloatingDialer, CampaignDetail, QueuePanelLocked, Contacts, ImportLeadsModal, ContactManagement and others. Please acknowledge.

*Area 1 — Dashboard*
- **PB-4. StatCards line (B1-13).**
  - Recommended: keep the server scope only in the Team perspective, and keep the conditional "{N} policies with unknown premium".
  - Delete the time zone, "Through {time}" and "Compared with previous full {range}"; the last duplicates each card's chip. This records the D11 outcome.
  - Alternative: always show the scope.
- **PB-5. Drill-down subtitle (B1-05).** Recommended: the server scope only. Alternative: show it only in the Team perspective.
- **PB-6. Refresh "Available at…" (B1-12).**
  - Recommended: make the existing hint `sr-only`, so `aria-describedby` still announces it.
  - The cooldown, `aria-disabled`, keyboard access and the click-time guard are unchanged.
- **PB-7.** Add `aria-label="Close"` to the modal's unnamed header icon button (B1-04).
- **PB-8. Small edits.**
  - "Loading next batch..." becomes "Loading more records..." (B1-07).
  - Drop the false "vs yesterday" chip when no stats loaded (B1-M1).
  - Goal Progress drops only its time zone (B1-14).

*Area 2 — Leaderboard and TV*
- **PB-9. Caption.**
  - Recommended: remove "Active agents · {tz} · As of {time} · Annual premium" everywhere.
  - Keep the conditional unknown-premium and outside-roster notes, and render nothing when neither applies.
  - The widget gets only the outside-roster note, through the shared helper. This needs amendment §17.4-1.
- **PB-10. "Stored call duration: …" note.**
  - Recommended: delete it from the screen. It fires for every in-flight and pre-release call, because 'legacy_unknown' is the column default (verified). The snapshot fields and validation are unchanged.
  - Alternative: show it only for estimates or conflicts. Second alternative: keep it.
- **PB-11. Group view time zone.**
  - Recommended: drop it with the rest; the CSV keeps "Agency Timezone".
  - Alternative: keep a "{tz}" segment only when a group is shown.
- **PB-12.** Keep "Latest 20 · all periods · annual premium" (Recent Wins) and the Part A unknown-premium wording verbatim.

*Area 3 — Reports*
- **PB-13. Basis bar (B3-01).**
  - Recommended: "Credited to the client's current agent" at every width.
  - Alternative: delete the text and keep only the band's Data basis button.
- **PB-14. Period totals.**
  - Recommended: delete "Independent period totals, not one cohort." and four date captions. Keep "by date created" on Appointments; the verifier found it is the only on-screen cue to what the Part A "Appointments" label counts.
  - Alternative: also keep PERIOD_TOTALS_LINE as the anti-funnel cue.
- **PB-15. "Dials per policy sold" and "Talk minutes per policy sold" subtitles (B3-07/08).**
  - Recommended: retained. The Data basis sheet defines them only by composition (AGENT_RULES.md:472, :474).
  - Alternative: delete them.
- **PB-16.** Delete the session-rate subtitles (B3-05/06) and the Call duration footnote (B3-29). The #41 disclosure stays in the sheet's live data-quality line and in the conditional strip caution. Alternative: keep the footnote.
- **PB-17.** Approve as a group the small strip, summary and panel removals: B3-09, B3-10, B3-11, B3-13, B3-14, B3-21 to B3-24, B3-26, B3-27 and B3-30.
- **PB-18. Records.**
  - Recommended: the data-basis-wording.md table, the O21 note and the optional AGENT_RULES sentence (§17.4-2 to -4).
  - The never-rendered stat subtitles (B3-19) stay as they are.

*Area 4 — Dialer and Campaigns*
- **PB-19. Team/Open queue notice (B4-13).**
  - Recommended: "Checking queue…" while loading and "Couldn't load queue status." on failure, from the existing `loaded`/`row` state. The RPC is unchanged.
  - Alternative: delete only the generic sentence.
- **PB-20. The always-on "Dialer Ready" pill (B4-33).** Recommended: delete it. Alternative: bind it to the existing `twilioStatus`.
- **PB-21. String-only toast edits in `TwilioContext.tsx` (B4-46, B4-64)**, in their own commit.
  - Telephony logic, `device.connect()`, the guards and telemetry are untouched.
  - The seven source-pinned suites run.
  - Alternative: retain both toasts.
- **PB-22. Empty-versus-failed accuracy fixes**, in a separate commit:
  - "Couldn't load recent calls." in FloatingDialer (B4-43);
  - a CampaignHeatmap error state (B4-66);
  - "No leads match this filter." in CampaignDetail (B4-67);
  - the campaigns-fetch toast (B4-65).
  - Alternative: record them separately instead.
- **PB-23. Wording.**
  - The FloatingDialer heading becomes "Select Outcome", the main Dialer's existing label (B4-44).
  - The Local Presence helper drops "/direct" (B4-09).
  - The Personal empty queue becomes heading-only (B4-11).
  - Delete the "DIALER" eyebrow (B4-01).
  - Keep "Select a Campaign" and "Start Dialing"; the onboarding email and the e2e harness quote them.

*Area 5 — Contacts, Conversations and Calendar*
- **PB-24.**
  - Delete the Clients empty-state guidance (B5-12) and the two redundant import lines (B5-45, B5-M1).
  - Conversations keeps its h2 style with the new text "Select a conversation".
  - The duplicate-prompt lead-in stays (B5-22).

*Area 6 — Settings, Phone, workflows and admin*
- **PB-25. Settings page heading (B6-01).**
  - Recommended: use the sidebar label. This fixes "Email Settings Settings", "Calendar Settings Settings", "Dnc Settings" and "A2p Registration Settings".
  - Then delete Phone System's duplicate h3 (B6-42).
  - Inner headings that anchor action buttons stay.
- **PB-26. Number Reputation (B6-64).**
  - Recommended: remove the decorative "AI line monitor / LIVE NEURAL FILTER" scanner mount; its own code comment calls it a decorative watch state.
  - Alternative: keep it and strip its strings.
- **PB-27. Number Reputation (B6-65).**
  - Recommended: keep the Signal Guide as the one reference and delete the five unfocusable header tooltips.
  - Make the guide toggle a keyboard-operable `<button aria-expanded>`.
  - Alternative: leave it.
- **PB-28. The stale custom-field Required helper (B6-93).**
  - Recommended: replace "ships in a later release" with "Enforced where custom-field inputs appear (e.g. the contact view)."
  - Alternative: delete it.
- **PB-29. Super Admin agency Settings tab (B6-119).**
  - Recommended: "Coming soon — agency configuration is not active yet." and disable the no-op "Configure agency" button.
  - Alternative: text only.
- **PB-30. Verifier wording.**
  - Trust Hub keeps "select US telecom networks" (B6-47).
  - The A2P notification sentence stays (B6-50).
  - Call Monitoring reads "Updates automatically" (B6-82).
  - Inbound v2 drops only the stale "20-second" (B6-72).
- **PB-31.** ProfileNotificationsSection's helper is retained by default, because it sits beside the INACTIVE onboarding mount (B6-14). Alternative: delete the one line and update this plan's mount references.

*Area 7 — Resources, Training and profiles*
- **PB-32. Business snapshot.**
  - Delete the footer and its tooltip (B7-24), and set the Agent description to "Lifetime totals across your book of business." (B7-23).
  - Keep the Team sentence "Business figures are lifetime totals, not activity." (B7-26).
  - Delete the achievements description on both tabs (B7-40).
- **PB-33. D11 profile premium hint (B7-30).**
  - Recommended: shorten it to "Not annualized.".
  - Alternative: delete it, with the two presentation-only test amendments.
- **PB-34. Beyond the named targets:**
  - delete the Resources card "DOCUMENT" label (B7-03);
  - delete the fabricated Training "5 min" fallback (B7-17);
  - delete the inaccurate "Select a script…" line (B7-06);
  - delete the Training no-match paragraph (B7-14).
  - Alternative: drop any of these.
- **PB-35.** Delete the tile hints "People on the book." (B7-28) and the no-additional-policies definition (B7-29). Alternative: keep them.

### §17.6 Explicitly retained (safety, meaning, rules, accessibility)

There are 188 retained items. Every one is listed with its reason in `reconciliation.md`. They fall into these groups.

- **Loading, empty, failed, stale and offline states and their timestamps.** These stay distinct (AGENT_RULES #22, :250).
  - Dashboard: B1-09, B1-16 to B1-18.
  - Leaderboard and TV: B2-12 to B2-16, B2-20, B2-21, B2-24, B2-25.
  - Dialer: B4-04 to B4-06, B4-10, B4-12, B4-16, B4-19, B4-22, B4-25 to B4-28.
  - Contacts and Conversations: B5-02, B5-16, B5-19.
  - Settings: B6-03, B6-83.
  - Profiles: B7-45, B7-46.
- **Queue states and next-eligible timing** (B4-16, B4-19, B4-25). Every Team/Open branch keeps its own heading: no leads, licensing, completed, locked by others, retry or callback waiting, and the new failed and loading states.
- **Safety, compliance and irreversible actions.**
  - DNC: B6-98.
  - Call forwarding: B6-17.
  - Recording: B6-79.
  - Dialer orphan-call, caller ID and DNC surfaces: B4-34.
  - Telephony toasts: B4-47.
  - Destructive confirmations: B4-62, B5-21, B5-29, B5-40, B6-23, B6-55, B6-89.
  - View As: B5-05, B5-17.
  - Permissions banners: B6-29.
  - A2P: B6-49, B6-50, B6-52.
  - Trust Hub states: B6-48.
- **Missing-data and coverage indicators.**
  - D14 surfaces: B1-10, B1-23, B2-05, B2-10, B2-11.
  - Coverage: B3-18, B3-33, B3-M1.
  - Conditional cautions: B3-20.
  - Production trend gaps: B3-32.
  - Lineage and attribution: B3-34, B3-35, B3-37.
  - Business snapshot caveats: B7-31.
- **Unavailable-feature notices.** These are never hidden.
  - Reports: B3-36.
  - Campaigns: B4-60.
  - Settings: B6-15, B6-79, B6-103, B6-107, B6-120.
- **Meaningful scope, period and units.**
  - Dashboard: B1-06.
  - Leaderboard and TV: B2-09, B2-17.
  - Reports: B3-12, B3-15, B3-16, B3-17, B3-25, B3-28, B3-31, B3-39.
  - Contacts: B5-14.
  - Settings: B6-21.
  - Profiles: B7-25, B7-26, B7-27, B7-32 to B7-34.
- **Screen-reader text.** B2-21, B2-25, B3-M3, B4-05, B7-51. No sr-only text, aria-label or aria-describedby target is removed anywhere.
- **User-authored content.** Ticker (B2-19), campaign descriptions (B4-05), scripts, templates and resource descriptions (B7-16, B7-19).

### §17.7 Tests and gates

**Rule for every test edit.** Retarget, never delete.
- A negative assertion that guarded an old string is pointed at the new string, so failure-versus-empty and loading-ownership guards keep their meaning. For example, the eight `dashboardCallbacks.test.ts` sites move to "No records found" and "Loading records...".
- Accessible-name queries are kept.

**Test and gate files to change or extend, from the reconciliation items:**
- **Dashboard:** `dashboardCallbacks.test.ts`, `dashboardRefresh.test.tsx`, `dashboardPremiumAvailability.test.tsx`, `dashboardPremiumLabels.test.tsx`, `leaderboardWidget.test.tsx`.
- **Leaderboard and TV:** `performanceContract.test.ts`, which gets exact `toBe` cases, a routine "" case and `outsideRosterNote` units. Also `leaderboardPage.test.tsx` and `tvModeRegression.test.tsx`, plus `scripts/tests/leaderboard-visual/{verify.mjs,entry.tsx,README.md}`.
- **Reports:** `ReportsOverview.test.tsx`, `reportsBasisText.test.ts`, `reportStatComputations.test.ts`, `reportTrendCharts.test.tsx` (keeps an on-screen "10.0%" combined-rate check), `reportsDialerIntelligence.test.tsx`, `reportsTables.test.tsx`, `scripts/tests/reports-visual/verify.mjs:696`.
- **Dialer and Campaigns:**
  - `campaignSelectionTable.test.tsx:125` becomes a negative assertion.
  - `floatingDialerDisposition.test.tsx:98,:267` change to "Select Outcome".
  - A new `src/components/dialer/__tests__/queueExhaustedNotice.test.tsx` covers every branch, including loading and failed.
- **Contacts, Conversations and Calendar:** `conversationsViewAs.test.tsx:326`, plus new assertions for the edited empty states and dialogs.
- **Settings and profiles:** no current test pins a still-needed string. The B7-30 shortening keeps `profileStates.test.tsx:206` and `profileContracts.test.ts:104-106` green.
  - *Superseded (2026-10-12):* PB-33 deleted the hint outright, so those two copy assertions were retargeted to negative checks. The arithmetic guards are unchanged ($681.07 shown; $8,172.84, the ×12 value, absent).

**Left unedited.** These files contain old strings but must not be rewritten: `e2e/team-open-local/evidence/final-run/evidence.sanitized.json:254`, the historical verification lines in other plans, and WORK_LOG history.

### §17.8 Implementation order, commits and verification on the combined branch

Part B is implemented only after Chris approves this plan. Commits are separately reviewable, each with its own tests:

1. Area 1, Dashboard.
2. Area 2, Leaderboard and TV: `outsideRosterNote`, the caption, the widget, and the gate fixture variant.
3. Area 3, Reports, in three commits: the band and Period totals; the strip subtitles; the panel lines and the gate.
4. Area 4, Dialer and Campaigns copy.
   - 4a: the `TwilioContext.tsx` string-only toasts (PB-21).
   - 4b: the empty-versus-failed fixes (PB-22).
5. Area 5, Contacts, Conversations and Calendar.
6. Area 6, Settings, in two commits: (a) profile, users, permissions, branding, menu links, agency group, phone, inbound, recording and monitoring; (b) scripts, dispositions, contact flow, calendar, workflows, templates, carriers, activity log, Super Admin and Control Center.
7. Area 7, Resources, Training and profiles.
8. Rule and record amendments (§17.4), docs only.
9. Verification record, WORK_LOG entry and context snapshot, docs only.

**Before each commit:** ESLint on the changed files, the changed suites, and `git diff --check`.

**Combined-branch verification, against the exact base `e11c8bea` (no new regressions):**
- **TypeScript.** `npx tsc --noEmit` (0) and `npx tsc -p tsconfig.app.json --noEmit`, with an identical diagnostic set, 85 today.
- **Full vitest** compared with base: the same failing set and no new unhandled errors.
- **CI-equivalent suites, with synthetic env:**
  - dialer and telephony;
  - the seven `TwilioContext` source-reading suites (`inbound*`, `outboundAnswerSignalPinned`, `outboundPathPinned`, `realtimeExactRowScope`);
  - `floatingDialerDisposition` and `floatingDialerRecent`;
  - `campaigns/__tests__` and `campaignsPage`;
  - SMS consent and onboarding (still INACTIVE);
  - Reports, both the strict and full sets;
  - Leaderboard, TV and Dashboard;
  - profile;
  - `performanceContract` under the TZ=America/Los_Angeles, America/New_York and UTC matrix.
- **Static checks.** ESLint on every changed `.ts`/`.tsx`, `npm run build`, `git diff --check e11c8bea`, and `scripts/verify_reports_frontend.py` with `REPORTS_BASE_SHA`.
- **Browser gates.** Base and candidate are each served alone on strict ports, with the served root proven.
  - Reports gate: 22/22, with axe at 0 violations in light and dark at 390 and 1440 px.
  - The 61-download pinned-clock CSV capture must stay byte-identical with no normalization; Part B changes no export.
  - The Leaderboard/TV gate, including the new routine TV variant.
- **One independent review** of the combined diff.
- **WORK_LOG entry and context snapshot.**
- The overall cleanup is marked complete only after Part B and this verification finish.
- Signed-in or production acceptance is not part of this plan and needs Chris. The protected preview updates automatically when Part B is pushed to the PR branch.

### §17.9 Found while mapping and recorded separately (not changed in Part B)

These are not copy cleanup. Each needs its own decision or task; nothing here is changed in Part B.

- **Profile Business snapshot (correction to the 2026-10-11 WORK_LOG and PR #440 text).**
  - The "Monthly Premium" tile shows "—" with "{n} policies have no premium recorded", not $0.00 (`formatMonthlyCurrency` renders 0 as "—").
  - The only $0 for an empty or all-unknown book is the milestone ladder "Monthly premium $0 / $1,000" (team $10,000; `profile-milestones.ts:66-71`).
  - D14 is not broadened to it.
- **Licence status.** State Licenses shows a green "Active" for a licence with no expiration date (B7-62; AGENT_RULES.md:541).
- **Licensed-state gating** never reads `expiration_date`, so "active license" wording elsewhere (`requireLicensedStateHelper`) overstates it.
- **Queue metrics.**
  - The deployed `get_queue_metrics` now applies licensing and manager filters inside `eligible_leads`. That makes the QueueExhaustedNotice comment (:63-66) stale and AGENT_RULES.md:116 out of date.
  - "Campaign Complete." can appear when filters exclude every lead.
- **Failed loads that read as empty:**
  - Dialer lead fetch: a toast, then the empty screen;
  - the campaigns fetch;
  - FloatingDialer contact search;
  - `CampaignDetail.fetchLeads` (errors discarded);
  - the templates picker;
  - contact-view notes and campaigns;
  - TasksPanel;
  - Resources and Training (no error branch);
  - QueuePanelLocked (zeros before the first fetch).
  - The Calendar List view has no empty state.
- **Stored counters and dead code.**
  - CampaignDetail Contacted/Converted read stored counters (AGENT_RULES.md:126).
  - The Dialer End-of-Session modal is unreachable.
  - `SmsReadiness.tsx`, six calendar view components, `ConnectionDiagnostics.tsx` and `CarrierReputationPanel.tsx` are unmounted.
- **Wording that contradicts itself or the product.**
  - The DNC header says manual calls get a warning, but the Compliance Notice says those numbers cannot be dialed (B6-98).
  - Agency Group says "Invite your first agent", although invites go to agencies (B6-39).
  - The Contact Flow inner heading reads "Contact Management".
  - "1 policies with unknown premium" is ungrammatical and pinned.
  - The production tooltip says "policies known" while elsewhere it is "premiums known" (pinned, C27).
- **Accessibility follow-ups.**
  - The TV ticker Label is not linked to its field.
  - The TV-mode icon button has no accessible name.
  - The "*" unknown-premium marker is title-only.
  - The Dashboard stat cards are not keyboard-operable.
  - The Dashboard detail overlay has no dialog role, focus trap or Escape handling.
  - Several Radix dialogs have no Description (NumberManagementSection, CustomMenuLinks, AddCallScriptDialog, Carriers, CalendarSettings, ContactManagement, TemplateModal).
- **Other.**
  - The agenda "Schedule One" button is not permission-gated.
  - The Conversations Templates button is a no-op.
  - Every video gets a hardcoded stock thumbnail (`AddResourceModal.tsx:66`).
  - A Training duration appears twice when set.
  - ProfileHero shows "Licensed states: Unavailable" while loading.
- **Carried from Part A.** "Avg annual premium" wraps at 390 px, and the CampaignDetail "No contact activity yet" empty state is optional copy.

**Added 2026-10-12, from the final review and the fixture-based visual review of the implemented Part B.** None of these was changed. Items marked *(nit)* are cosmetic.

- **Required custom fields (functional; needs its own decision).**
  - The Dialer Personal inline edit renders custom-field inputs but does not enforce `custom_fields.required` on save.
  - Lead CSV import only requires that a column is mapped for a required custom field. Blank cells still import.
  - The retained `REQUIRED_FIELDS_ACTIVE_NOTE` (`ContactManagement.tsx:68`) still says custom required fields "are enforced where custom-field inputs are surfaced". The Dialer inline edit contradicts that.
  - The B6-93 helper was corrected to match the code (§17.12). The retained note, AGENT_RULES "Required-field enforcement", and the enforcement gap itself are left for that decision.
  - *Update (2026-10-12, §17.13, `9010612`):* the retained note is corrected. It now reads "Enforced on the Add and Edit forms in Contacts and in the contact view. Lead CSV imports check only first name, last name and phone on each row."
    - The enforcement gap is unchanged and still needs its own decision.
    - Also found: lead-to-client conversion (`ConvertLeadModal`) does not check the client Required Fields.
    - `AGENT_RULES.md:460` says `FullScreenContactView.handleSave` passes `enforceCustomFields: true`. The code passes `false` and checks custom fields through `missingRequiredCustomDetails`, so the behavior is equivalent and only the wording is stale.
    - AGENT_RULES is unchanged.
- **Settings headings after B6-01** *(nit)*.
  - Permissions shows h1 "Permissions" followed directly by h3 "Permissions".
  - Zapier & Webhooks repeats its h1 in the card h3.
  - An unknown `?section=` shows "Settings" twice, and the B6-02 notice "Coming soon — this section is not active yet." Base said "Ready for configuration." Telling a known unbuilt section apart from an unknown slug would be a small logic change.
  - *Update (2026-10-12, §17.13, `9010612`):* the Permissions inner h3 and the coming-soon card h3 are removed, so each of these three screens shows its title once. The unknown-slug notice wording is unchanged.
  - **Not in this list, and so not changed:**
    - Activity Log still shows h1 "Activity Log" directly above an inner h3 "Activity Log".
    - Call Scripts and Carriers do the same for users who cannot manage them; for managers the inner heading anchors the Add action.
  - Permissions now steps from the page h1 to the h4 "System rules". That is no more level-skipping than before.
- **Number Reputation empty branch (B6-63)** *(nit)*. With no active numbers, the header reads only "These are signals, not guarantees.", and "These" has no referent. It reads correctly in the populated branch.
- **Calendar settings** *(nit)*.
  - Every card is now title-only except Appointment Reminders and Working Hours, which keep their descriptions.
  - Record conflict: B6-103 (Retained) lists the :876 description as kept, while the verifier-added MB6-01 deletes it. The implementation followed MB6-01. The not-active notice stays.
- **Conversations (B5-01)** *(nit)*. The "Select a conversation" h2 raises the empty pane's minimum width from 194 px to 250 px. Below 1024 px that takes space from the conversation list.
- **Dashboard** *(nit)*.
  - The B1-13 line now renders only for the Team view or unknown premiums, so switching Team and Personal moves the stat cards about 24 px. Reserving space would add spacing, which the plan rules out.
  - The valid-empty state still uses a static `Loader2` glyph, which B1-02 left as an owner option.
  - Pre-existing and identical on base: the Admin and Team Leader controls row overflows at 390 px (scrollWidth 550).
- **Dialer and FloatingDialer** *(nit)*.
  - The heading-only QueueExhaustedNotice states keep the h2's 8 px gap above "Return to Campaigns". That matches base's detail-to-button gap, but the Personal screen has 32 px.
  - B4-40's kept bordered wrapper now holds only the "Enable desktop alerts" button, so it reads as a box inside a box.
  - At the 320 px panel width, B4-41's note leaves the single word "tab." on its second line.
- **Agent Profile** *(nit)*.
  - At 390 px, "Manage licences" stays on the State licensing title line while "Manage carriers" wraps to its own row.
  - On a clean book, the Clients, Policies and Monthly Premium tiles have about 60–70 px of empty space at xl, because sibling tiles keep their hints.
- **Pre-existing, identical on base.**
  - Failed Training and Resources documents loads render as empty (already listed above).
  - A long Training category badge wraps out of its fixed-height border.

### §17.10 Explicit non-actions

- No change to database, RLS, Edge functions, RPCs, migrations, calculations, exports or CSV bytes. The 61-download pinned-clock capture is re-run after Part B, and it must remain byte-identical to base `e11c8bea`.
- No change to authorization, permissions logic, View As, workflows or telephony behavior: not to `device.connect()`, not to the re-entrancy guards, not to telemetry. Any `TwilioContext.tsx` edit is string literals only (PB decision).
- No change to the Campaigns table structure. The onboarding series stays INACTIVE. The manual SMS composer is unchanged, and the purpose dropdown is not restored.
- No change to user-authored content: ticker text, scripts, templates, campaign descriptions and resource descriptions.
- No push of Part B code, merge, production deploy, bypass/share token or access change without its own approval.

### §17.11 Approved Part B (Chris, 2026-10-11): decisions, overrides and the final file list, recorded before any application edit

**Authority.** Chris approved implementing Part B as planned in §17 and `reconciliation.md` (reviewed plan head `572b15487a4fb789e7322ca63c9d5bf72c58173c`), with the overrides below.
- **Also approved:** updating draft PR #440 and its normal protected preview with the completed, locally verified Part B work, plus narrowly scoped CI corrections.
- **Not approved:** a production merge or deploy, backend changes, onboarding activation, a protection bypass, a share token, or an access change.
- **No further mapping or audit round.** Base `main` was re-fetched before this record and is still `e11c8bea`; the PR head is `572b154`. No other open PR changed since the last check, and PR #440 has no reviews or review comments.

**Decisions.** Every PB recommendation in §17.5 is accepted, except for these overrides and clarifications.

- **PB-10 (overrides "delete").** The routine legacy-unknown provenance commentary goes.
  - Real estimate or conflict limitations stay as concise conditional feedback, only where the metric they affect is shown.
  - The shared on-screen notes become, in order and only when non-zero:
    - "Annual premium (N policies with unknown premium)" (Part A wording, unchanged);
    - "Talk time includes {e} estimated[ and {c} conflicting] call duration(s)", shown only when `estimated_duration_calls + conflicting_duration_calls > 0`, on the Leaderboard page and TV (both display Talk Time);
    - "Outside active roster: …" (unchanged).
  - `unknown_duration_calls`, which counts the `legacy_unknown` default, never triggers or appears in any note.
  - The Dashboard widget (no Talk Time) gets only the outside-roster note.
  - The snapshot fields, validation, calculations and `leaderboardCsv` are unchanged.
- **PB-13 (overrides "Credited to…").** The permanent basis sentence is removed from the production band at every width. `PRODUCTION_BASIS_BAR` and `PRODUCTION_BASIS_BAR_SHORT` are deleted; they are screen-only constants.
  - The band keeps its existing Data basis button, right-aligned, in the existing compact footer row. There is no text, no empty row and no added spacing.
  - The full current-agent attribution stays in the sheet's Agent credit section (`CURRENT_ASSIGNMENT_NOTE`).
- **PB-15 (overrides "retained").** One screen-only definition is added to the Policies sold section of the CURRENT Data basis sheet, as a new constant in `src/lib/reports-basis-text.ts` rendered by the existing `dataBasisSections()`. It states that:
  - "Dials per policy sold" and "Talk minutes per policy sold" divide the period's calls made or talk minutes by the dated stored policies sold in the same period;
  - they are period ratios, available only for the whole organization with no agent filter;
  - they are not original-seller efficiency.
  - The two formula subtitles are then deleted (B3-07, B3-08). The organization-only restriction (`POLICY_RATIO_SCOPE_REASON`), the unavailable reasons, the denominators and the values are unchanged.
  - No CSV-shared or SHA-pinned constant changes, and export output is unchanged.
- **PB-33 (overrides "shorten").** The Monthly Premium tile hint is deleted entirely; "Not annualized." goes too.
  - The title names the unit.
  - Monthly arithmetic (no ×12), the "{n} policies have no premium recorded" caveat and the lifetime-scope text stay.
  - The two copy assertions are retargeted to negatives, and the arithmetic guards stay.
- **PB-1 (scope).** The `aria-describedby={undefined}` opt-out applies only to the four redundant descriptions: B5-09, B5-23, B5-28 and B5-53.
  - Accessible titles, existing screen-reader text, meaningful context and destructive-action consequences are preserved.
  - There is no change to the shared `dialog.tsx` or `sheet.tsx` primitives.
- **PB-19 and PB-22 (separately reviewable UI-state bugfixes).**
  - **`QueueExhaustedNotice`** gets local state ownership. State is keyed by `campaignId` (loading / ready / error), and a previous campaign's row or response never drives the new campaign's heading, error state or next-eligible time.
    - Tests cover: initial loading; successful empty and non-empty diagnostics; failure after a previous success; a campaign switch while mounted; a late response from the previous campaign; and preservation of the distinct queue states and next-eligible time.
    - No change to eligibility, claiming, locks, retry rules, licensing, the RPC contract, polling or dialing.
  - **The other listed fixes** each distinguish a failed load from a successful empty result without inventing data: B4-43 FloatingDialer Recent, B4-66 CampaignHeatmap, B4-67 the CampaignDetail filtered-empty message, and B4-65 the campaigns-fetch toast.
  - The broader deferred loading defects in §17.9 are not bundled in.
- **PB-21 (scope).** Only the two user-facing toast strings in `TwilioContext.tsx` change (B4-46, B4-64), in their own commit.
  - `device.connect()`, every re-entrancy guard, call creation/status/disposition, telemetry, logs, error codes and connection logic are untouched.
  - The source-pinned and telephony suites run.
- **PB-26 (scope).** Only the decorative `ReputationAiScanner` mount and its import are removed. Signal and status data are untouched.

**Final file list.** Edits stay inside it. If an existing test turns out to pin approved copy, its file is added to a dated deviation list in this section before the commit that touches it.

*Application source, 102 files (98 from the inventory, plus 4 implied by the decisions):*
- **Area 1.** `src/components/dashboard/{DashboardDetailModal,DashboardRefreshButton,StatCards}.tsx` and `src/components/dashboard/widgets/GoalProgressWidget.tsx`.
- **Area 2.** `src/lib/leaderboardExport.ts`, `src/pages/Leaderboard.tsx`, `src/components/leaderboard/TVMode.tsx` and `src/components/dashboard/widgets/LeaderboardWidget.tsx`.
- **Area 3.**
  - `src/components/reports/{ReportsOverview,ReportsActivityFlow,CommunicationsStats,AgentEfficiency,CallVolumeChart,CallDurationAnalysis,CallFlowAnalysis}.tsx`;
  - `src/lib/stat-computations.ts`;
  - **`src/lib/reports-basis-text.ts`** (implied by B3-01, B3-03 and PB-15).
- **Area 4.**
  - `src/components/dialer/{CampaignSelection,QueueExhaustedNotice,QueuePanelLocked}.tsx` and `src/components/dialer/campaignSettingsSchema.ts`;
  - `src/pages/{DialerPage,CampaignDetail}.tsx`;
  - `src/components/layout/FloatingDialer.tsx`;
  - `src/contexts/TwilioContext.tsx` (two strings);
  - `src/hooks/useDialerSession.ts`;
  - `src/components/campaigns/CampaignHeatmap.tsx`.
- **Area 5.**
  - `src/pages/{Conversations,Contacts,CalendarPage}.tsx`;
  - `src/components/messaging/MessageTemplatesPickerModal.tsx`;
  - `src/components/contacts/{ContactsFilterModal,FullScreenContactView,TasksPanel,ConvertLeadModal,ImportLeadsModal}.tsx`;
  - `src/components/calendar/AppointmentModal.tsx`.
- **Area 6a** (profile, users, permissions, branding, menu links, agency group, phone, inbound, recording, monitoring).
  - `src/pages/SettingsPage.tsx` and `src/components/settings/SettingsRenderer.tsx`;
  - `src/components/settings/profile/{ProfileInfoCard,ProfileStateLicensesCard,ProfileGoalsCard,ProfilePasswordCard}.tsx` and `src/components/settings/ProfileCarriersSection.tsx`;
  - `src/components/settings/user-management/{UserManagementHeader,PendingInvitesTable}.tsx`;
  - `src/components/settings/{Permissions,CompanyBranding,CustomMenuLinks}.tsx`;
  - `src/components/settings/agency-group/{AgencyGroupNoGroup,AgencyGroupLeaderView,AgencyGroupResourceList}.tsx`;
  - **`src/components/settings/PhoneSystem.tsx`** (implied: B6-42 under PB-25);
  - `src/components/settings/phone/{TrustHubSection,TrustHubRegistrationPanel,NumberManagementSection,LocalPresenceSection,NumberGroupsSection,PhoneNumberRoutingModal}.tsx` and `src/components/settings/phone/a2p/A2pRegistration.tsx`;
  - `src/components/settings/{NumberReputation,InboundRoutingManager,CallRecordingSettings,CallMonitoring}.tsx`;
  - `src/components/settings/inbound-routing/InboundV2Section.tsx`;
  - `src/components/settings/state-licenses/StateLicensesSection.tsx`.
- **Area 6b** (scripts, dispositions, contact flow, calendar, workflows, templates, carriers, activity log, Super Admin, Control Center).
  - `src/components/settings/{CallScripts,DispositionsManager,ContactManagement,CalendarSettings,EmailSMSTemplates,Carriers,ActivityLog}.tsx`;
  - `src/components/settings/call-scripts/CallScriptsList.tsx`;
  - `src/components/workflows/WorkflowList.tsx`;
  - `src/components/workflows/panels/ActionConfigPanel.tsx`, plus **`WaitConfigPanel.tsx`** and **`ConditionConfigPanel.tsx`** (implied: B6-106 covers all three panels);
  - `src/pages/{SuperAdminDashboard,SuperAdminOrgDetail}.tsx`;
  - `src/components/super-admin/provisioning/ProvisioningPanel.tsx` and `src/components/super-admin/system/SystemMonitoringTab.tsx`;
  - `src/pages/control-center/ControlCenter{Overview,Features,Issues,Runtime,Tracker,Health}Page.tsx`.
- **Area 7.**
  - `src/pages/{Resources,Training}.tsx`;
  - `src/components/resources/AgencyResourceCard.tsx` and `src/components/training/ResourceCard.tsx`;
  - `src/components/agent-profile/{AgentProfileTab,BusinessSnapshot,ReadinessCard,PolicyTypeMixCard,LicensingCard,CarrierAppointmentsCard,AchievementsCard,ProfilePrimitives}.tsx`;
  - `src/components/agent-profile/team/{TeamReadinessCard,TeamCoverageCard}.tsx`.
- **Not edited.** `ProfileNotificationsSection.tsx` (PB-31, retained), `OnboardingEmailPreference.tsx`, the Campaigns table components, `MessageComposePanel.tsx`, the `ui/` primitives, the hooks other than `useDialerSession.ts`, and everything under `supabase/`.

*Existing tests and test support to change (retarget, never delete or weaken):*
- **Area 1.** `src/components/dashboard/__tests__/{dashboardCallbacks.test.ts,dashboardRefresh.test.tsx,dashboardPremiumAvailability.test.tsx,dashboardPremiumLabels.test.tsx}`.
- **Area 2.**
  - `src/lib/__tests__/performanceContract.test.ts`;
  - `src/components/dashboard/__tests__/leaderboardWidget.test.tsx`;
  - `src/pages/__tests__/leaderboardPage.test.tsx`;
  - `src/components/leaderboard/__tests__/leaderboardStatusSurfaces.test.tsx`;
  - `src/test/fixtures/performance.ts` (an optional `excluded` override, defaulting to zeros).
- **Area 3.**
  - `src/components/reports/__tests__/{ReportsOverview.test.tsx,reportTrendCharts.test.tsx,reportsDialerIntelligence.test.tsx,reportsTables.test.tsx,reportsDataBasis.test.tsx}`;
  - `src/lib/__tests__/{reportsBasisText.test.ts,reportStatComputations.test.ts}`;
  - `src/pages/__tests__/reportsPage.test.tsx`.
- **Area 4.** `src/components/dialer/__tests__/campaignSelectionTable.test.tsx` and `src/components/layout/__tests__/floatingDialerDisposition.test.tsx`.
- **Area 5.** `src/pages/__tests__/{contactsImportHistoryTab.test.tsx,conversationsViewAs.test.tsx}`.
- **Area 7.** `src/components/agent-profile/__tests__/{profileStates.test.tsx,profileContracts.test.ts}`.

*New tests:*
- `src/components/dialer/__tests__/queueExhaustedNotice.test.tsx` (PB-19);
- `src/components/layout/__tests__/floatingDialerRecentStates.test.tsx` (B4-43);
- `src/components/campaigns/__tests__/campaignHeatmapStates.test.tsx` (B4-66);
- `src/pages/__tests__/campaignDetailLeadFilterEmpty.test.tsx` (B4-67);
- `src/components/contacts/__tests__/redundantDialogDescriptions.test.tsx` (PB-1: B5-09, B5-23, B5-28, B5-53);
- `src/pages/__tests__/settingsPageHeading.test.tsx` (B6-01, B6-02, B6-42);
- `src/components/settings/__tests__/numberReputationGuide.test.tsx` (B6-64, B6-65);
- `src/components/training/__tests__/resourceCardMeta.test.tsx` (B7-17).

*Browser-gate harness (test tooling, not app code):*
- `scripts/tests/reports-visual/verify.mjs` (B3-02 at :696; the PB-13 band row);
- `scripts/tests/leaderboard-visual/{verify.mjs,entry.tsx,README.md}` (B2-01, B2-03, and the PB-10 note).

*Docs and records:*
- this plan;
- `reconciliation.md` (implemented status per ID);
- `AGENT_RULES.md` (the #40 on-screen notes bullet after :494, matching PB-10 exactly; the Reports sentence after :666, matching PB-13 and PB-15 exactly);
- `docs/plans/2026-10-09-reports-refresh-audit/data-basis-wording.md` (the Part B formula-line table, with rows matching the final text, including C2/C3 removed and the new PB-15 sheet sentence);
- `docs/plans/2026-10-09-reports-refresh-audit/assertion-diff.md` (a dated O21 note);
- the root `implementation_plan.md`;
- `WORK_LOG.md`;
- `docs/plans/2026-10-11-ui-copy-cleanup-v2/evidence/csv-capture/`: the capture and compare scripts, the fixture identities (payload sha256, served roots and SHAs) and both hash manifests, so the 61-export comparison can be reproduced.

**Commit boundaries.**
1. C0: this record (docs).
2. C1: Area 1.
3. C2: Area 2 and its gate harness.
4. C3a: band and Period totals (PB-13). C3b: strip subtitles and the PB-15 sheet definition. C3c: panel lines and the Reports gate.
5. C4: Dialer and Campaigns copy. C4a: the `TwilioContext.tsx` toast strings. C4b: the UI-state bugfixes (PB-19, PB-22).
6. C5: Area 5.
7. C6a, C6b: Area 6.
8. C7: Area 7.
9. C8: the rule and record amendments.
10. C9: the evidence, the reconciliation status, WORK_LOG and the context snapshot.

Implementation runs in isolated worktrees, area by area. Commits are integrated onto this branch in this order without rewriting existing history.

### §17.12 Implementation record (2026-10-12)

**Commits** on `claude/ui-copy-cleanup-v2-20261011`, applied in order on top of reviewed plan head `572b154`.
- No history was rewritten and nothing was force-pushed.
- Each area was implemented in its own worktree and integrated by cherry-pick.
- The implementing commit for each item is in `reconciliation.md`.

| Commit | Boundary | Content |
|---|---|---|
| `78ff832` | C0 | §17.11 decisions and final file list (docs) |
| `208be52` | C1 | Area 1, Dashboard |
| `12b757c` | C2 | Area 2, Leaderboard and TV, with its gate harness |
| `7429da1` | C3a | Reports band and Period totals (PB-13), with the Reports gate edits |
| `caa3b61` | C3b | Strip subtitles and the PB-15 sheet definition |
| `6cc328a` | C3c | Reports panel lines |
| `8e92099` | C4 | Dialer and Campaigns copy |
| `2c397ff` | C4a | The two `TwilioContext.tsx` toast strings only (PB-21) |
| `e31b002` | C4b | UI-state fixes (PB-19, PB-22) |
| `702960d` | C5 | Area 5 |
| `f0562bb` | C6a | Area 6a |
| `bdfe2b3` | C6b | Area 6b |
| `1381ccf` | C6b fix | Area 6b review: B6-93 wording |
| `b7ab152` | C7 | Area 7 |
| `9094a2d` | Review fix | Final review findings |
| `26d79d3` | Review fix | Visual review findings (classes and one `role` only) |
| `022e7d1` | C8 | Rule and record amendments (docs) |
| C9 | C9 | Evidence, reconciliation status, this record, WORK_LOG and the context snapshot (docs) |

**Dated deviation list (2026-10-12).**
- **Files.** Every file changed against `572b154` is in the §17.11 final file list; a mechanical comparison found none outside it. No unlisted test pinned approved copy.
- **B6-93 wording.** The approved PB-28 text, "Enforced where custom-field inputs appear (e.g. the contact view).", is not accurate: the Dialer Personal inline edit renders custom-field inputs without enforcing them.
  - The Area 6b review changed it to "Enforced in the contact view and CSV imports." (`1381ccf`).
  - The final review then found the CSV half overstated, because a lead import only requires a mapped column. The final text is "Enforced in the contact view. Lead CSV imports must map a column to it." (`9094a2d`).
  - These are copy changes only; no enforcement logic changed. The underlying gap is in §17.9.
- **Commit boundaries.**
  - C3a carries the Reports gate edits for B3-02 and PB-13, so each gate edit lands with the UI change it tracks. C3c has no gate edit, because no gate string tracks its lines.
  - The two review-fix commits sit between C7 and C8, and both stay inside the file list.
- **Not integrated.**
  - `93c0547`: an Area 5 review pass removed four dead `eslint-disable` comments from `Contacts.tsx` and `ImportLeadsModal.tsx`. That is unrelated to copy, so it is out of scope.
  - `684cdfe`: an empty Area 6a review commit.
- **"Already-oversized files only shrink" (§17.1).** Two oversized files grew:
  - `CampaignDetail.tsx`, 1,417 to 1,419 lines: B4-67's approved ternary.
  - `Leaderboard.tsx`, 250 to 251 lines: B2-02 computes the caption once, so an empty caption renders no row.
  - Across the 102 app files the net change is −263 lines: 64 shrank, 9 grew and 29 kept their length.
  - The other seven files that grew are all under 200 lines: `CampaignHeatmap` 178, `StatCards` 171, `LeaderboardWidget` 167, `ResourceCard` 133, `SettingsPage` 128, `QueueExhaustedNotice` 117 and `leaderboardExport.ts` 44.
- **ESLint gate.** The area agents ran `--max-warnings 0`, which fails on pre-existing warnings. CI and `scripts/verify_reports_frontend.py` run plain `eslint`. On the combined branch: 0 errors, and no warning that is not already on base. The apparent new `ControlCenterOverviewPage` warnings are base warnings moved to new line numbers.

**Independent final review** of the combined diff: five lenses, each finding checked by skeptics. Result: 10 confirmed (five distinct issues after de-duplication), 1 disputed, 7 refuted.
- **Fixed in `9094a2d`:**
  - the B6-93 overstatement;
  - stale `BusinessSnapshot` and `ProfilePrimitives` comments;
  - the Google Calendar header alignment;
  - the State Licenses admin link position;
  - the disputed `CampaignHeatmap` finding, judged real: a failed background refetch hid a grid that had already loaded. A new test fails on the old code and passes now.
  - Also in `9094a2d`: the PB-15 sentence capitalises "Talk minutes per policy sold" as the tile is labelled.
- **Out of scope:** the retained `REQUIRED_FIELDS_ACTIVE_NOTE`, recorded in §17.9.

**Fixture-based visual review**, base `e11c8bea` against the candidate:
- **Coverage.** 75 surfaces across the seven areas and both browser gates, at desktop and narrow widths, light and dark, and the role states the fixtures model.
- **Fixed in `26d79d3`, six findings:**
  - the Reports leader row height;
  - the Dashboard modal close button overlapping the title at 390 px;
  - the footer Close contrast, now 6.58:1 (was 3.39:1);
  - FloatingDialer Recent failure announced with `role="alert"`;
  - the Call Monitoring heading no longer wraps;
  - the Number Reputation guide focus ring offset.
- **The rest** is recorded in §17.9.
- **Not acceptance.** Supabase, auth, roles and Twilio were stubbed. Signed-in acceptance was not done.

Verification on the combined branch, the gaps and the next steps are in the 2026-10-12 WORK_LOG entry.

### §17.13 Final targeted polish (Chris, 2026-10-12): two approved presentation fixes, recorded before any edit

**Authority.** On 2026-10-12 Chris approved exactly two narrowly scoped presentation fixes on top of reviewed candidate `d4b72576ebe734471a10d321d512963605101111`.
- **Process.** Both corrections go in one separately reviewable commit. No mapping cycle or audit.
- **Not approved:** a backend command, enforcement, validation, import, query, database-rule or workflow change, a layout redesign, a route change, or anything broader.
- **Accepted deviations.** Chris accepted the documented `CampaignDetail.tsx` (+2 lines) and `Leaderboard.tsx` (+1 line) growth as specific exceptions; that code is not compressed or restructured.
- **CSV.** The 61-export comparison and its limitations stay as recorded; equivalence to the historical 74 is not claimed.
- **Pre-edit checks (2026-10-12 01:23 UTC).** `origin/main` is still `e11c8bea`, and the PR head is `d4b7257`. PR #440 has no reviews or review threads; no other open PR changed. `AGENT_RULES.md`, `VISION.md` and `WORK_LOG.md` were reread.

**Verified enforcement behavior** (read from current code; nothing here changes):
- **Contacts Add and Edit forms.** Every lead, client and recruit Add or Edit modal in `src/pages/Contacts.tsx` calls `enforceContactPreSave` → `computeMissingRequired` with `enforceCustomFields: false`. That enforces the locked core fields plus the Required Fields settings; custom required fields are not checked.
- **The contact view.** `FullScreenContactView.handleSave` (`:637-646`) enforces the standard required fields and the custom required fields (`missingRequiredCustomDetails`), wherever the view opens: Contacts, Calendar, the Dialer and direct links.
- **The Dialer's inline lead edit** (`DialerPage.saveInlineEdit`, and the Team/Open path `useTeamOpenLeadEdit`) runs no required-field check.
- **Lead CSV import** (`ImportLeadsModal.tsx:583-596`).
  - It blocks Continue until Phone, a name column, each required custom field and the required Email, State, Lead Source, Date of Birth, Age and Best Time to Call are mapped. A required Assigned Agent is not checked.
  - The `import-contacts` Edge Function rejects a row only when first name, last name or phone is blank (`:197-206`). Blank cells in other required columns still import.
- **AGENT_RULES.** The "Required-field enforcement" row (frontend save paths; `import-contacts` core fields only) already matches this behavior and is unchanged.

**Correction 1: the Required Fields note** (Settings › Contact Flow › Required Fields).
- **File:** `src/components/settings/ContactManagement.tsx:68-69`, the `REQUIRED_FIELDS_ACTIVE_NOTE` constant, which is rendered once at `:1315`. Only the string changes.
- **Before:** "Required fields are enforced on create/edit forms and CSV imports. Custom required fields are enforced where custom-field inputs are surfaced (e.g. the contact view)."
- **What was wrong with it:**
  - "Create/edit forms" includes the Dialer inline edit, which checks nothing.
  - "CSV imports" claims per-row enforcement that only covers first name, last name and phone.
  - The custom-field sentence is contradicted by the Dialer inline edit, which shows custom-field inputs and does not enforce them.
- **After:** "Enforced on the Add and Edit forms in Contacts and in the contact view. Lead CSV imports check only first name, last name and phone on each row."
- **Why this wording.**
  - It names only the places where the settings are enforced, and it states the one limitation an admin needs: imports do not check the other required fields row by row.
  - Custom required fields are configured, and explained, on the Custom Fields tab. Its accurate B6-93 helper, "Enforced in the contact view. Lead CSV imports must map a column to it.", is unchanged.
  - The green notice box, its icon and its position are unchanged.

**Correction 2: duplicate Settings headings** (the screens identified in §17.9).
- **`src/components/settings/Permissions.tsx:726-728`.** Delete the wrapper `<div><h3 className="text-lg font-semibold text-foreground">Permissions</h3></div>`.
  - It sits directly under the page h1 "Permissions" with no action beside it. This is the same pure-duplicate pattern B6-42 removed from Phone System.
  - The role tabs, banners, accordion section titles (h3), Save and Reset actions, and the loading state are unchanged.
  - `Permissions` is mounted only through `SettingsRenderer` under the Settings page h1.
- **`src/components/settings/SettingsRenderer.tsx:61`.** Delete `<h3 className="font-semibold mb-1">{section?.label || "Settings"}</h3>` from the default, coming-soon card.
  - It repeated the page h1: "Zapier & Webhooks" twice, and "Settings" twice for an unknown `?section=`.
  - The card, its icon and the notice "Coming soon — this section is not active yet." are unchanged. The card has no actions.
  - Nothing is decided here about telling a known unbuilt section apart from an unknown slug; that stays recorded in §17.9.
- **Headings that anchor an action stay**, for example Company Branding with Save and Custom Menu Links with Add.

**Tests** (one commit with the code):
- `src/pages/__tests__/settingsPageHeading.test.tsx`: the B6-02 case is retargeted.
  - The coming-soon card renders no heading of its own, and keeps its notice.
  - On the page, "Zapier & Webhooks" appears once, as the h1.
  - An unknown slug shows "Settings" once.
- `src/lib/__tests__/permissionsSettingsContacts.test.tsx`: one new case. The component renders no "Permissions" heading of its own, while its section headings, role tabs and Save action remain.
- New `src/components/settings/__tests__/contactFlowRequiredFieldsNote.test.tsx`: the exact new note text; the old claims are absent; the B6-93 Custom Field helper is unchanged.

**Verification:**
- `npx tsc --noEmit` and `npx tsc -p tsconfig.app.json --noEmit`, compared with exact base `e11c8bea`;
- the affected suites;
- changed-file ESLint, the build and `git diff --check`;
- `scripts/verify_reports_frontend.py` against `e11c8bea`.

**Publication.** Push to draft PR #440 (no force-push) and wait for exact-head CI. Report the canonical `agentflow` project's protected preview URL for the final SHA, for Chris's signed-in, read-only acceptance.

**Outcome (2026-10-12).** Both corrections are implemented exactly as recorded above, in `9010612` with their tests. The plan record is `2ee237b`, and the records commit follows.
- **Diff.** Three app files:
  - `ContactManagement.tsx`: one string, ±1 line;
  - `Permissions.tsx`: −4 lines;
  - `SettingsRenderer.tsx`: −1 line.
- **Tests.**
  - Each new or retargeted assertion fails on the previous code: 5 tests failed with the three app edits reverted.
  - All pass on the fix.
  - The B6-93 preservation case passes on both.
- **Targeted check.** Three read-only skeptics each tried to refute one claim: the note's accuracy, the safety of the heading removals, and test soundness.
  - None was refuted; their nits are recorded in §17.9 and the closing section of `reconciliation.md`.
  - One vacuous absence assertion they found was removed before the commit.
- **Exact-base verification (code head `9010612`):**
  - `scripts/verify_reports_frontend.py` passed every comparison:
    - root tsc 0 on both sides;
    - app tsc 85 diagnostics on both sides, an identical set;
    - no new failed or skipped test (33 skipped on both, the same set), and no unhandled error;
    - the strict Reports set, changed-file ESLint and the build exit 0.
  - Passing tests: base 5,040, candidate 5,184, which is +5, the new and retargeted cases.
  - All 14 CI-equivalent suite groups pass.
  - ESLint on the three app files matches base: 9 warnings, 0 errors, in `ContactManagement` only.
  - `git diff --check` is clean.
- **Fixture render** (synthetic, not acceptance), at 390 and 1440 px, light and dark:
  - Permissions, Zapier & Webhooks and an unknown section each show their title once; nothing overflows.
  - axe: on Webhooks and the unknown section, `heading-order` is resolved (1 → 0). Permissions keeps the one `heading-order` node it had on base; it is now the "System rules" h4 instead of the removed h3.
  - The new Required Fields note renders for Admin and Agent, the old claim is absent, and the axe results match the Part B render.

### §17.14 Release record (2026-10-12)

**Approval.** Chris accepted the protected preview of `0c3813c` (`https://agentflow-jc1tqftd5-cgarness-projects.vercel.app`): "Looks fine for now". He approved merging PR #440 and releasing it to production after the final safety checks. This was Chris's own preview check. It is not an exhaustive all-role walkthrough, and the automated tests are not signed-in acceptance.

**Accepted code.** The application commit is `9010612`. `9010612..0c3813c` changes docs only, and the `src/` trees are identical.

**Preflight** (all passed before the merge):
- **No drift.** `main` was `e11c8bea8bb546023da3fc6489140be2cd464a3e` and the PR head was `0c3813c74b0b94f2fc0d8fafbc2c7e34116ae16b`.
- **Frontend-only boundary.** `e11c8bea..0c3813c` touches no `supabase/`, `.github/`, package or lock file, `vercel.json`, Vite or tsconfig file.
- **Exact-head CI** on `0c3813c` was green. The Supabase Preview check was skipped, since there is no `supabase/` change.
- **Supabase production** was only read, as listed under Backend and onboarding below.

**Merge.**
- The acceptance was recorded as a PR comment without moving the head: https://github.com/cgarness/agentflow-life-insure/pull/440#issuecomment-6117945068.
- The PR was marked ready, then merged by the normal merge method, with expected head `0c3813c`.
- **Merge commit:** `f91e4ba62e0d4eeeb9baec5e296c3ec5d6beb325`, with parents `e11c8bea` and `0c3813c`. Its tree is `346994da1f6820d4fa769928ed7513f80c6bfeab`, identical to `0c3813c`.

**Production deployments** (Git integration only; nothing created or promoted by hand).

| Project | Deployment | Target, source | State | Aliases |
|---|---|---|---|---|
| `agentflow` (canonical) | `dpl_E7C5dN2ATUhWbTCfrupJfSamkQws` (`agentflow-ktw03arph-cgarness-projects.vercel.app`) | production, `main` `f91e4ba` | READY | `www.fflagent.com`, `fflagent.com` (redirects to www), `agentflow-eta.vercel.app`, `agentflow-cgarness-projects.vercel.app`, `agentflow-git-main-cgarness-projects.vercel.app`; no alias error |
| `agentflow-life-insure` (secondary, configuration unchanged) | `dpl_Hq2kU5arad7qn1da2HtdHziuNsJJ` | production, `main` `f91e4ba` | READY | `agentflow-life-insure.vercel.app` and its team and git-main aliases |

- **Alias and domain records.** The Vercel records for `www.fflagent.com` and `fflagent.com` both name `dpl_E7C5dN2ATUhWbTCfrupJfSamkQws`. The `www.fflagent.com` domain configuration reports `misconfigured: false`. The previous production deployment was `dpl_F5UGVnxAyThBzh5AJ4kf1XD5hZ8y`, built from `e11c8bea`.
- **Build output** (from the canonical build log):
  - `index.html`;
  - `assets/index-D2UnWTns.js`, 4,356.43 kB;
  - `assets/index-0hcdISoo.css`, 239.27 kB;
  - `assets/A2pRegistration-qOBuAdK9.js` and `assets/A2pSession-B_TmC2-B.js`.

**Served-asset verification: NOT DONE.** The cleanup is not declared LIVE until it is done.
- **Blocked.** This session's network policy refuses the production hosts `www.fflagent.com`, `fflagent.com` and `agentflow-eta.vercel.app` (403 on CONNECT). So the HTML served from the domain, and the entry asset it references, could not be fetched.
- **Not used.** Vercel's URL-fetch tool was not used, because it creates a protection-bypass link.
- **Local rebuild (supporting only).** A local build of the merged tree emits the same CSS file, `index-0hcdISoo.css`. The JS hash differs: `index-DV5eMWjy.js`, 4,351.75 kB. There is no `.env` file locally, while the Vercel build includes the project's build-time environment values. So the JS hash is not expected to match, and this rebuild proves nothing about what the domain serves.

**Authenticated production checks: none performed.** Nobody signed in to production. No data was saved, no dialing session was started, no message was sent, no setting was changed, and no active agent was force-refreshed.

**Backend and onboarding.** Supabase production was only read, before the merge and again after the deployment, with the same results both times:
- **Branches:** the production `main` branch has no Git branch and was last updated 2026-08-25T19:24:20Z.
- **Edge Functions:** neither `onboarding-email-worker` nor `email-unsubscribe` exists. The newest function is still `platform-admin-notify` v1.
- **Migrations:** the newest is still `20261010172702`. The onboarding foundation `20261011120000` is not applied.

What this means:
- No Supabase write of any kind was made. No migration, Edge Function, secret, cron job, RLS policy or setting changed.
- The onboarding emails remain INACTIVE.
- The Supabase "Deploy to production" setting cannot be read by any tool available here. The evidence above is consistent with it staying off, but does not prove it. In any case, this merge changed no `supabase/` file.

**Follow-ups.** Two kinds remain.
- **Still open from this release:** served-asset verification from the production domain.
- **Remaining findings:** the items in §17.9 and in the closing section of `reconciliation.md` stay on the follow-up list. The cleanup scope is not expanded.
