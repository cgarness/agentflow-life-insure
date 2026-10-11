# System-wide UI copy cleanup — V2 takeover and reconciliation plan (PLAN ONLY; awaiting Chris's approval)

**Status (2026-10-11):** plan only, on local branch `claude/ui-copy-cleanup-v2-20261011` (base `main` `e11c8bea8bb546023da3fc6489140be2cd464a3e`). The only changes are this folder and a pointer section in the root `implementation_plan.md`. Nothing else has changed:

- No application, test, rule or gate file has been edited.
- No backend command has been run. No migration, Edge Function, secret, cron job or deployment setting was touched.
- Nothing was pushed, and no PR or preview was created.
- Supabase was not contacted. Vercel was read only (named-sandbox and snapshot metadata); two sandbox-start requests were refused (§2).

**Scope of this plan:**

- **Part A — V2 simple metric labels (Chris's 2026-10-11 direction).** Fully reconciled against current `main` and ready for approval: §4–§9.
- **Part B — carry-over of the approved four-batch cleanup.** Blocked because the private recovery source is unreachable from this session (§2). The file-level overlap with current `main` is already mapped (§3). The method for finishing Part B once the archive is available is in §11.

---

## §0. TL;DR

- **Base.** `main` is `e11c8bea` (fetched 2026-10-11, the same as the handoff checkpoint). It has 49 commits since the cleanup base `be2690d8`. The `src` changes in that range come from three PRs only: #433 (Campaigns table), #436 (Reports refresh) and #439 (onboarding preference mount and unsubscribe page).
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
  - make the sheet-only bookings note state the equivalence with the CSV term.

---

## §1. Inputs and current base

| Item | Finding |
|---|---|
| Latest `main` | `e11c8bea` "Merge pull request #439: inactive onboarding email series", fetched 2026-10-11. |
| Since cleanup base `be2690d8` | 49 commits. First-parent PRs: #433 Campaigns table (`d88982d`), #434 docs, #436 Reports refresh (`b00bfed`), #435 SQL/docs, #437 docs, #438 backend/docs, #439 onboarding (`e11c8be`). #434, #435, #437 and #438 change no `src` files. |
| Open PRs | None is the cleanup. #429 (START draft, codex/sms-start-20261008) is unapproved and **excluded**. #425, #398, #383, #382, #381, #378 and #294 are unrelated. None is imported. |
| `origin/codex/ui-copy-cleanup-20261006` | Points at `1a87753`, an ancestor of `main`, with 0 unique commits. It is not the cleanup. Fetched read-only to `refs/recovery/codex-ui-copy-cleanup-20261006`. |
| Saved cleanup commits | GitHub refuses `def6d528` and `0db516ce` ("not our ref"), as the handoff warned. `refactor/ui-copy-cleanup-20261007` does not exist on the remote. |
| Docs read | `AGENT_RULES.md` (§4 #38, §8–§10, the Reports personal-layout invariant and refresh amendment, the Campaigns table invariant, the manual SMS UI rule); `VISION.md`; the newest `WORK_LOG.md` and `implementation_plan.md` entries; `docs/plans/2026-10-09-reports-refresh-audit/` (`data-basis-wording.md`, `production-release.md`, `implementation_plan.md`, `verification.md`). There is no `CLAUDE.md` or `AGENTS.md` in the repository. |
| Not received | The archive and the five handoff documents (`AgentFlow_UI_Copy_Audit.md`, `AgentFlow_UI_Cleanup_Implementation_Plan.md`, `AgentFlow_UI_Cleanup_Verification_and_Handoff_20261009.md`, `CURRENT_RECONCILIATION_NOTES.md`, `METRIC_LABEL_ADDENDUM.md`). The session's uploads directory is empty. |

---

## §2. Recovery status — BLOCKED (exact missing item)

**Named sandbox.** `ui-copy-cleanup-20261007-7e5caef` (team `team_iPboOWpwdIQRwdxmA5GJp5Rq`, project `prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc`) exists and is **stopped**. Its cwd is `/vercel/sandbox`.

| Snapshot | Status | Created (UTC) | Expires (UTC) |
|---|---|---|---|
| `snap_NLNxyouDyIOKaNHBk9Elg8nge1iz` (current, automatic, parent `snap_E9Lz…`) | created | 2026-10-11 02:52 | 2026-11-10 02:52 |
| `snap_E9LzZeDV5vYzaN2WszrzqzToDL8v` (previous verified, manual) | created | 2026-10-10 | **2026-10-18 02:48** (7 days after last use) |
| `snap_sSJ0…`, `snap_DfGE…`, `snap_Vw08…` (older) | created | 2026-10-08/09 | 2026-11-08, 2026-11-07, 2026-10-14 |

**What was attempted. Both requests were refused and nothing changed.**
1. `create sandbox` from `snap_NLNx…` as a separate, non-persistent, deny-all-network, read-only recovery copy. The aim was to leave the named sandbox's snapshot chain untouched. Result: `403 forbidden`, action `create`, resource `vercelRun`.
2. `get_named_sandbox … resume=true`, the handoff's sanctioned path. Result: the same `403 forbidden` (`create` on `vercelRun`).

The Vercel CLI fallback is not installed in this container and has no credentials. No session was started, so no new automatic snapshot was created and no snapshot was evicted.

**Exact missing item (either one unblocks Part B):**
- **(a)** A Vercel credential for this session with Sandbox create/resume permission on that team and project. The connected Vercel account can read sandbox and snapshot metadata but cannot start a sandbox.
- **(b)** Chris uploads `AgentFlow_UI_Cleanup_Review_20261009.tar.gz` (1,726,881 bytes, SHA-256 `dad1cca7509b1e1d2d6a6861400fe03bc6d97e4ec0cf4d4f98cc693916d0efe0`), plus the four reference documents, into this session.

**Recovery procedure once available.** No step publishes the archive, touches `main` or the working checkout, or modifies the source sandbox or branch.
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
| Policies (current assignment) | **Policies sold** | Agent performance and agent efficiency screen headers (`AgentPerformanceCards.tsx:26`, `AgentEfficiency.tsx:33`) | Stored policies by sale date in the period, credited to the client's **current** agent. This is not seller credit; the Data basis "Agent credit" section states it. The CSV header stays "Policies (current assignment)". |
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
| Appointments Set (selector, TV and podium) | **Appointments** (D8) | Same display map, plus `metricLabel` at `leaderboardTypes.ts:104` ("appointments") | The same created-date, setter-credit, all-types metric as the Reports "Appointments". The CSV header "Appointments Set" stays. |
| annualized premium (podium caption) | **annual premium** | `metricLabel` (`leaderboardTypes.ts:110`) | Same. |
| " · Annualized premium (N policies with unknown premium)" | **" · Annual premium (N policies with unknown premium)"** | Shared on-screen caption `performanceCaption` (`leaderboardExport.ts:31`). The CSV headers at :12-15 stay. | The conditional unknown-premium count stays. |
| "Outside active roster: N calls, N bookings, N policies" | "… N calls, N **appointments**, N policies" (only with D8) | `leaderboardExport.ts:34` | The disclosure itself stays (AGENT_RULES). |
| Latest 20 · all periods · annualized premium / title "Annualized premium" | "… · **annual premium**" / title "**Annual premium**" | `RecentWinsPanel.tsx:119,236` | Same. "Premium unknown" stays. |
| Policies / Appts (main leaderboard table headers) | **Policies Sold** / **Appointments** | `LeaderboardRankingsTable.tsx:103,109` | Period sold count and created-date appointments. The table's `overflow-x-auto` wrapper and the normal-view gate (`leaderboard-visual/verify.mjs:129-131`) contain the width. |
| Policies / Appts / Talk / Calls (TV compact headers and totals strip) | **Unchanged** (D9) | `TVRankingsTable.tsx:60-64`, `TVAgencyTotalsStrip.tsx:63,77` | They stay compact for the TV layout budget (`leaderboard-visual/verify.mjs:63-66`). The ranking title names the full metric. |
| Appointments Set (month) | **Appointments** | `UserPerformanceTab.tsx:32` | Month to date; the existing "Month to date" line carries the period. |
| Monthly Appt. Goal | **Monthly Appointments Goal** | `AgentModal.tsx:161` | This matches `UserGoalsTab`. |
| Calls (CampaignDetail Stats tile) | **Called** (D10) | `CampaignDetail.tsx:1023` | It counts **leads** with `call_attempts > 0`, matching the Campaigns "Called" vocabulary. The heatmap "Calls Made" (:1040) stays. |

### §4.3 Already satisfied or kept (no change)

- **Already simple:** Dashboard "Calls Made", "Policies Sold", "Scheduled Appointments", "Monthly Premium" and "Monthly Appointments"; the Leaderboard and TV "Annual Premium" column and total, "Talk Time", "Calls Made", "Policies Sold" and "Policies / 100 Calls"; the Dialer's "Calls Made", "Contacted", "Contact Rate" and "Policies Sold"; `UserPerformanceTab` "Calls Made", "Policies Sold" and "Talk Time"; the profile "Monthly Premium" (lifetime current book, not annualized) and "Carrier appointments" (licensing, excluded from the appointments vocabulary); the Campaigns table columns.
- **"Call contact rate" stays (D2)**, in the strip, Trends, Call flow, Heatmap, tables and Call summary. The Reports customizer also lists the lead-level placeholders "First dial contact rate" and "Follow-up contact rate", and the campaign and lead-source tables show "Contacted leads" beside it. "Call" is therefore a genuinely differentiating word. AGENT_RULES #38 and `reportsContracts.test.ts:155-168` require it.
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
- **CSV-only text stays byte-identical.** This covers the `Reports.tsx:99-106` summary rows, every component `EXPORT_HEADERS` array, the inline chart CSV header arrays, `CommunicationsStats` `exportLabel`/`premiumRows`, `leaderboardExport.ts:12-15`, `PREMIUM_BASIS`, `premiumNote`, `qualityNotes`, `integrityExportNotes`, `reports-policy-text.ts` and `CAMPAIGN_LINEAGE_NOTE`.
- **The Data basis live list is unchanged.** It deliberately shows the CSV Note sentences verbatim ("Known annual premium $…; k/n policies known…", "Bookings created (all types): N; recorded kind: …"). Screen and CSV stay identical by design.
- **Unmounted or unrendered strings are not edited:**
  - `AgentScorecardModal.tsx` (no importers; a documented follow-up);
  - `DayAgendaPanel.tsx` (unmounted);
  - `stat_annual_premium` and `stat_policies_sold` labels, which are fixed stats that are never rendered (`report-layout-constants.ts:25`); changing them is optional, and they are left as is.

---

## §5. Presentation boundary and display-only mappings

- **Reports.** Every change is a string literal in:
  - JSX (`ReportsOverview`, `ReportsActivityFlow`, `PoliciesSoldChart`);
  - a screen-only header array (`HEADERS`/`COLUMNS` in `AgentPerformanceCards`, `AgentEfficiency` and `CampaignPerformance`);
  - a `STAT_DEFINITIONS.label`, which flows to `StatCard`, its "Loading {label}" name, the customizer text and the "Show/Move {label}" names, with no component edit;
  - a `dataBasisSections()` title, which is screen-only and used only by `DataBasisSections.tsx:34`.

  Saved `report_layouts` rows store `{id, visible}` only, so a label never persists. Every component stays under the 200-line contract.
- **Display-only mapping 1.** In `CampaignTotalsFoot.tsx:19-24`, the `values` record keys move in lockstep with the renamed `CampaignPerformance` COLUMNS. Otherwise the tfoot renders blank cells silently. A stable-id refactor is not proposed.
- **Display-only mapping 2.** Add `METRIC_DISPLAY_LABEL: Record<Metric,string>` in `leaderboardTypes.ts`, where every entry equals its id except the two renames. Because `LeaderboardFilters.tsx:76` renders `<option>{m}</option>` with no `value`, and `onChange` reads the option text, the option must become `<option value={m}>{METRIC_DISPLAY_LABEL[m]}</option>`. Its `<select>` gets `aria-label="Metric"`; today it has no accessible name.
- **Not touched:** shared or byte-pinned constants, CSV builders, `reports-export.ts`, payload schemas, RPCs and migrations.

---

## §6. Part A — exact intended files

### Application files

23 files: 9 Reports and 14 CRM.

| File | Change |
|---|---|
| `src/components/reports/ReportsOverview.tsx` | :54 leader `dt` (D3); :65-66 unchanged (sentence case); :75 and :78 → "Annual premium" (`aria-label` and `h2` together); :87 → "Monthly premium"; :92-93 → "Avg annual premium" (phone) and "Average annual premium" (sm+); the :46 comment follows. |
| `src/components/reports/ReportsActivityFlow.tsx` | :32 label → "Appointments". The basis caption is unchanged. |
| `src/components/reports/PoliciesSoldChart.tsx` | :47 tooltip `dt`, :63 readout ("annual premium $X"; the coverage clause is unchanged), :111 caption, :112 `aria-label` "Annual premium by {unit}", :117 series name, :122 key-list `aria-label` "Annual premium key". **Unchanged:** :51, :126 and :129 (limitations) and the :90 CSV header. |
| `src/components/reports/AgentPerformanceCards.tsx` | `HEADERS` :26-27 only: "Policies sold", "Annual premium", "Appointments". `EXPORT_HEADERS` is unchanged. |
| `src/components/reports/AgentEfficiency.tsx` | `HEADERS` :33 → "Policies sold". `EXPORT_HEADERS` :35-43, including its "Policies (current assignment)" at :42, is unchanged. |
| `src/components/reports/CampaignPerformance.tsx` | `COLUMNS` :17 only: "Attributed policies", "Annual premium", "Premium coverage". `EXPORT_HEADERS` is unchanged. |
| `src/components/reports/CampaignTotalsFoot.tsx` | The :20-22 keys follow the new column labels. The values are unchanged. |
| `src/lib/stat-computations.ts` | Labels :94 "Average annual premium", :104 "Appointments", :122 "Most policies sold" (D3); subtitle :259 "{n} policies" (D3); the :16 comment follows D3. **No id, calculation or other subtitle changes.** |
| `src/lib/reports-basis-text.ts` | Titles :109 "Annual premium" and :112 "Appointments". `BOOKINGS_NOTE` :29 is reworded per D7; it is screen-only. The :56 comment follows D3. Every other constant is byte-identical. |
| `src/components/dashboard/StatCards.tsx` | :79 → "Annual Premium". |
| `src/components/dashboard/DashboardDetailModal.tsx` | :146, :156 and the :635 row text (§4.2). |
| `src/components/leaderboard/leaderboardTypes.ts` | Add `METRIC_DISPLAY_LABEL`. `metricLabel` :104 (D8) and :110. |
| `src/components/leaderboard/LeaderboardFilters.tsx` | :70 `aria-label="Metric"`; :76 `value={m}` plus the display label. |
| `src/components/leaderboard/TVMode.tsx`, `TVPodium.tsx`, `TVDeepRankPanel.tsx`, `TVRankingsTable.tsx` | Render `METRIC_DISPLAY_LABEL[metric]` (TVMode :319, TVPodium :98, TVDeepRankPanel :36, TVRankingsTable :50). The TV compact column headers are unchanged (D9). |
| `src/components/leaderboard/LeaderboardRankingsTable.tsx` | :103 "Policies Sold", :109 "Appointments". |
| `src/components/leaderboard/RecentWinsPanel.tsx` | :119 and :236. |
| `src/lib/leaderboardExport.ts` | `performanceCaption` :31 ("Annual premium"), and :34 ("appointments") with D8. **CSV headers :12-15 are unchanged.** |
| `src/components/settings/user-management/UserPerformanceTab.tsx` | :32 → "Appointments". |
| `src/components/contacts/AgentModal.tsx` | :161 → "Monthly Appointments Goal". |
| `src/pages/CampaignDetail.tsx` | :1023 → "Called" (D10). Nothing else, including the stored-counter data issue in §9. |

The TV row covers four files. No other application file is touched; code comments are edited only where they quote a renamed label.

### Tests: update literal-copy and accessible-name queries; keep every semantic assertion

Exact-label negatives must be retargeted to the new label so they cannot pass vacuously.

- `src/components/reports/__tests__/ReportsOverview.test.tsx`: :16, :19 (article name), :37-39 (monthly and average labels, phone and desktop), :55, :63, :107 (comment), the leader helper and describe block at :122-165 (D3), and :175 (Period totals `dt` list).
- `src/pages/__tests__/reportsPage.test.tsx`:
  - :80 and :484-514 (leader label; the :487 negative is retargeted);
  - :508 ("Annual premium");
  - :534-541 ("Attributed policies"; :536 keeps asserting **no** "Policies sold" column in the campaign table);
  - :542 (the unchanged "Calls made" key);
  - :549-551 ("Policies sold" agent header);
  - :615 (renamed tfoot keys).
  - The CSV assertions at :617 and :622-623 are unchanged.
- `src/lib/__tests__/reportsRegistrySnapshot.test.ts`: :71 "Most policies sold" (D3) and :72 "Appointments". The 38 ids, groups, `teamOnly`, order, `DEFAULT_LAYOUT`, the six-metric cap, "Dials per booking", "Call contact rate", "Dials per policy sold" and the `/dials per appointment/` negative are all **unchanged**.
- `src/lib/__tests__/reportStatComputations.test.ts`: :87-88 and :99-106 (D3 label and subtitle). The `/top performer|seller/i` negative at :208 stays.
- `src/lib/__tests__/reportsBasisText.test.ts`: :95 (title), :105-107 (title and the D7 `BOOKINGS_NOTE`). Every paragraph, CSV Note and golden assertion is unchanged, including the :147-153 "no sheet-only sentence reaches a CSV Note" guard.
- `src/components/reports/__tests__/reportCustomizer.test.tsx`: :36 (the negative is retargeted to "Annual premium").
- `src/components/reports/__tests__/reportTrendCharts.test.tsx`: the caption, legend, readout and `aria-label` assertions (:57, :69, :72, :103, :107, :144, :161, :173, :178, verified at edit time). The :61 CSV and the :67/:93 limitation assertions are unchanged.
- `src/components/reports/__tests__/reportsTrends.test.tsx`: :94-95, :107-116 (`aria-label` and readout).
- `src/components/reports/__tests__/agentPerformanceTable.test.tsx`: :66-67 (screen headers); the :75 comment. The :48 CSV assertion is unchanged.
- `src/components/reports/__tests__/reportsTables.test.tsx`: :76-79, :101-105, :215-216. The CSV assertions at :83, :153 and :226 are unchanged.
- **New CRM label assertions.** Today nothing pins these, so they are added to the existing suites:
  - `src/pages/__tests__/leaderboardPage.test.tsx`: the selector shows "Annual Premium" and "Appointments"; selecting either still sets the `Premium Sold` / `Appointments Set` metric id; the CSV header row is unchanged (the existing :174 pin).
  - `src/components/dashboard/__tests__/dashboardSections.test.tsx`: the "Annual Premium" card label.
  - `src/components/dashboard/__tests__/dashboardDetailModalVoicemail.test.tsx`, or a sibling in that folder: an unknown-premium win row reads "Premium unknown" with no "annualized", and a known row reads "$X annual premium".
  - `src/lib/__tests__/performanceContract.test.ts`: the caption reads "Annual premium (N policies with unknown premium)", and the conditional parts are unchanged.
  - Optional: a `UserPerformanceTab` render check. There is currently no suite for it.
- **Leaderboard and TV regressions:** `leaderboardStatusSurfaces.test.tsx`, `tvModeRegression.test.tsx` (the "Calls Made" pin is unaffected) and `useLeaderboardData.test.tsx` run unchanged.

### Gates and docs (amendments are listed in §7)

- `scripts/tests/reports-visual/verify.mjs`: :48, :52-53 (IMPORTANT_COLUMNS), :203, :295, :298-305 (D3), :322, :362, :601, :686, :692, :697, :709, :716-723 (tfoot keys) and :737 (readout). The CSV checks (:756, :775), the budgets, axe, the one-line checks and the R-4 probe are unchanged. `scripts/tests/reports-visual/README.md`: :44 and :46.
- `AGENT_RULES.md`: three narrow wording amendments (§7).
- `docs/plans/2026-10-09-reports-refresh-audit/data-basis-wording.md`: **append** a dated "V2 simple-label amendment (2026-10-11)" section that supersedes rows C8/C9, C10, C30 (bookings label), B2.1 (section name) and B5.1 (`BOOKINGS_NOTE`). The shipped rows are left as history.
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
5. **`data-basis-wording.md`.** An appended V2 section supersedes C8/C9, C10, C30, B2.1 and B5.1. It records that `PREMIUM_BASIS`, the CSV Notes and the 74-file CSV set are unchanged.
6. **Not proposed.**
   - AGENT_RULES :472 "Call contact rate" stays (D2).
   - The `reportsContracts.test.ts` call-contact-rate scan stays.
   - AGENT_RULES :476 "Campaign Performance has no Policies Sold" stays.
   - AGENT_RULES :510 keeps "Bookings created (all types)" as the metric's definition text.
   - The refresh `implementation_plan.md` "Kept verbatim" list stays as history.

---

## §8. Decisions for Chris (recommendation first)

- **D1 — Letter case.** *Recommended:* change the words and keep each surface's existing case. Reports was deliberately moved to sentence case in #436 (`reportTableStyles.ts:2`, `ReportSection.tsx:7`), and the CRM already uses Title Case. The words become identical ("Annual premium" / "Annual Premium"), the diff stays small, and about 40 case-only test rewrites are avoided. *Alternative:* Title Case for every Reports metric label, including "Calls Made", "Contacted Calls", "Converted Leads/Clients", "Dialer Session Time" and so on. That adds roughly 25 case-only label edits and their test and gate updates, and the case-sensitive negatives must be retargeted (for example `reportsPage.test.tsx:114/125/136/172/183/218/297/536/593`).
- **D2 — "Call contact rate" vs "Contact Rate" on Reports.** *Recommended:* keep "Call contact rate". Reports shows lead-level "contact rate" placeholders and "Contacted leads" beside this call-level rate, so a bare "Contact rate" would invite a lead-level reading. *Alternative:* "Contact rate" on screens only. That needs AGENT_RULES :472 reworded and the `reportsContracts.test.ts:155-168` and `reportsPage.test.tsx:227-234` guards rewritten, which weakens a semantic guard.
- **D3 — Leader label.** *Recommended:* "Most policies sold", on the band and the strip tile together (the AGENT_RULES one-name rule). Change the tile subtitle "{n} policies currently assigned" to "{n} policies". The attribution stays in the Data basis "Agent credit" section. *Alternatives:* "Most policies", or keep the current text.
- **D4 — Campaign table policy column.** *Recommended:* "Attributed policies". *Alternative:* keep "Policies (campaign-attributed)". It can never be "Policies sold".
- **D5 — Campaign coverage column.** *Recommended:* "Premium coverage", with the k/n values unchanged. *Alternative:* keep "Known / total policies". Note that "Premium coverage" in the Production trend tooltip is a percentage.
- **D6 — "Dials per booking" beside "Appointments".** *Recommended:* keep it. It is the R-1 owner-approved name, it is not a V2 target, and it is hidden by default. *Alternative:* "Dials per appointment". That reverses R-1 and needs the snapshot negative, `reportStatComputations.test.ts:63-66`, `verify.mjs:207-208` and `DIALS_PER_BOOKING_NOTE` amended.
- **D7 — Data basis bookings wording.** This is screen-only; `BOOKINGS_NOTE` is not a CSV Note. *Recommended text:* "Appointments counts every booking of any type by the date it was created and credits the person who created it (older bookings with no recorded creator credit the booking's user). Exports call it "Bookings created (all types)"." Without it, the sheet would show the "Appointments" heading above the unchanged live CSV line "Bookings created (all types): 4; recorded kind: 0 appointment, …" with nothing connecting the two names. *Alternative:* retitle only, and rely on the note's current opening words.
- **D8 — "Appointments Set" on Leaderboard, TV and the user tab.** *Recommended:* "Appointments", which is the same metric as on Reports. The CSV header "Appointments Set" stays. *Alternative:* keep "Appointments Set".
- **D9 — TV compact headers "Policies", "Appts", "Talk", "Calls".** *Recommended:* keep them compact on TV only, for the TV layout budget. The main Leaderboard table expands them. *Alternative:* expand on TV too and re-run the TV layout gate.
- **D10 — CampaignDetail "Calls" tile, which counts leads called.** *Recommended:* "Called". *Alternative:* leave it.
- **D11 — Description items outside the label pass.** These are:
  - the band basis bar "Current book · stored policies by sale date · monthly premium ×12 · client's current agent" (approved C2/C3; it hosts the Data basis button);
  - formula subtitles: "calls in period ÷ dated stored policies in period", "talk minutes in period ÷ dated stored policies in period", Call summary "Contacted calls ÷ calls made", and the Agent efficiency footnote;
  - the profile hint "Sum of the monthly premium recorded on each policy. Not annualized."

  *Recommended:* none changes in Part A. Decide them in Part B against the approved audit inventory, and remove them without replacement only if the audit already approved that.
- **D12 — Band average on phones.** *Recommended:* "Avg annual premium" below sm and "Average annual premium" from sm, measured by the 390 px budget and the one-line gates.
- **D13 — Conditional Trends limitation lines.** *Recommended:* keep them verbatim ("Known premium unavailable for this period.", "Gap = known premium unavailable, not $0"). They are genuine conditional limitations, not titles, and C25 tightened them deliberately.

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

Once the archive is recovered and verified:
1. **Diff the old work against today.** Produce `git diff be2690d8 def6d528` per file. Map each hunk to the current owning file, using `git log --follow` and content search for files that moved.
2. **Classify every applicable audit group** from the approved inventory (`AgentFlow_UI_Copy_Audit.md`; no new broad inventory). Each group is still needed, already satisfied, superseded by newer UI, or retained for safety or meaning. Record evidence and the current owner in a reconciliation table (`reconciliation.md` in this folder).
3. **Treat batches by overlap:**
   - batch 1 Dashboard, Leaderboard and TV, batch 2 except Campaigns, batch 3 except `ProfileNotificationsSection`, and batch 4 target unchanged files: reapply per hunk after a context review;
   - Reports and Campaigns hunks are superseded: reapply only the surviving intent, to today's components;
   - Part A already covers every metric title.
4. **Present the Part B file list and conflicts for approval,** then implement. Never wholesale-copy old files or accept old conflict hunks.

---

## §12. Verification plan (against the exact pinned base)

Nothing below reuses historical counts as a baseline.

1. **Install and verify script.** Run `npm ci`. Then run `scripts/verify_reports_frontend.py` with a detached base worktree at the pinned `main`, as CI does:
   - root and `tsconfig.app.json` typecheck, comparing diagnostic identity and multiplicity;
   - full vitest on base and candidate, comparing failed suites and tests and unhandled runtime-error signatures;
   - the strict Reports file set, which must all pass;
   - changed-file ESLint;
   - the production build.
2. **Run directly as well:** `npx tsc --noEmit`, `npx tsc -p tsconfig.app.json --noEmit` and `git diff --check`.
3. **Targeted suites:**
   - all Reports suites;
   - Leaderboard and TV (`leaderboardPage`, `leaderboardStatusSurfaces`, `tvModeRegression`, `useLeaderboardData`, `performanceContract`);
   - Dashboard (`dashboardSections`, `dashboardDetailModal*`, `goalProgressAppointmentsSet`, `dashboardRefreshWiring`);
   - contacts (`AgentModal` suites);
   - `campaignDetailImportRetry`;
   - the Campaigns, SMS and permission suites as a shared-surface regression.
4. **Reports browser gate** (`scripts/tests/reports-visual/verify.mjs`, with SQL payloads via the documented embedded-SQL path where possible). It covers the 390 px and 1440 px first-screen budgets, axe, one-line values, the R-4 probe, renamed accessible names, and complete, partial, all-unknown, zero, loading and error states.
5. **CSV byte identity.** `exportAll()` writes per-file normalized SHA-256 to `csv/manifest.json`. Generate the manifest on the base and on the candidate with the same fixed clock, and require them to be identical. This is the repeatable form of the 74-file comparison.
6. **Leaderboard visual gate** (`scripts/tests/leaderboard-visual/verify.mjs`): the TV fixture layout and the normal-view overflow.
7. **Diff review.** Review the full diff against `main` for any id, payload, RPC, calculation, CSV, permission, View As, dialer or onboarding change. Confirm that missing data never becomes zero and that current assignment never becomes seller credit.
8. **Local visual checks** at desktop and 390 px, in light and dark, by role (Personal, Team, Agency) and in View As, using local fixtures. These are labelled as local fixture checks, distinct from signed-in acceptance. Signed-in acceptance needs a published preview, which needs a separate approval.

---

## §13. Explicit non-actions

The following do not happen in this task:

- No database, RLS, migration, Edge Function, secret, cron, deployment-setting, RPC, hook, calculation, export, authorization, queue, call, disposition or workflow change.
- No Supabase production access.
- No push, PR, preview, merge, bypass or share link, or protection change without Chris's separate approval. A branch push can trigger a deployment.
- No onboarding activation.
- No import of #429 or any other open PR.
- No change to a user-authored field name or content.
- No global replacement of "known".
- No new subtitle, paragraph or information icon to compensate for a removed qualifier.

---

## §14. Risks

| Risk | Mitigation |
|---|---|
| A label rename leaves an exact-text negative passing vacuously. | Every negative is retargeted to the new label (§6). The browser gate fails closed on stale selectors. |
| The tfoot goes blank after a header rename. | Its keys move in the same edit, and the tfoot tests and `verify.mjs:716-723` assert the values under the new keys. |
| The Leaderboard selector breaks when its option text changes. | `value={m}` keeps the id. A new test selects by label and asserts the id. |
| "Monthly premium" or "Average annual premium" wraps on phones. | D12 uses a phone form, and the 390 px budgets are re-run. |
| The two vocabularies inside Data basis confuse readers. | D7 states the equivalence. The live list stays verbatim by design. |
| The previous snapshot expires on 2026-10-18. | §2: restore recovery access before then. |
