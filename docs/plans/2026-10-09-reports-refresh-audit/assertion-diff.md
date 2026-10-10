# Assertion diff review: Reports refresh (plan §9.2 item 3)

- **Base:** `main` `a41ed8eaabf212d9c60726d04ba227769d9ed20a`
- **HEAD:** `claude/reports-refresh-audit-20261009` `6138978ddfedaf816f1da9b0acc88ae0b9b2a17b`
  - During this review the branch advanced to `b939d18f` ("Record Reports refresh verification…"). That commit touches only docs, screenshots, `WORK_LOG.md` and `AGENT_RULES.md`: `git diff --stat 6138978d..b939d18f -- src scripts supabase` is empty, and §1–§11 of the plan are unchanged.
  - Every test, source and `verify.mjs` line cited here is therefore the same at both commits. The test run was on that identical tree.
- **Test files changed:** 23 (13 modified, 10 added, **0 deleted**; `git diff --diff-filter=D -- '*.test.ts' '*.test.tsx'` is empty). The only deleted files are the unreachable `src/components/reports/DraggableSection.tsx` and `GoalTracking.tsx` (plan §7.2). No test imported either one, and the `goal_tracking` id is still covered at `src/lib/__tests__/reportLayoutNormalization.test.ts:10`, which is unchanged.
- **`expect(` lines removed:** 49. ReportsOverview 22, agentPerformanceTable 2, reportTrendCharts 10, reportStatComputations 2, reportsPolicySource 1, reportsPage 12. **Added:** 745.
- **Test titles:** 8 base `it(...)` titles are gone at HEAD. Seven of those tests were renamed and rewritten in place. One was deleted: reportTrendCharts "withholds agent ranking when requested scopes differ despite matching resolved scope and period" (items T1–T5 below).
- **Classification of the 49:** EQUIVALENT 25, STRONGER 18, REMOVED-UI 6, **WEAKENED 0**.
- **Tests at HEAD:** all 23 changed and added test files pass. 356 passed and 1 skipped (§4).

**No assertion is WEAKENED.** Every removed assertion has a replacement at HEAD, or it guarded UI that the plan removed. Those REMOVED-UI items still have coverage of their intent (cited below).

Line references: `B<n>` is the line in the base file. Every other `file:line` is at HEAD. Paths are abbreviated: test files are under `src/components/reports/__tests__/`, `src/lib/__tests__/` or `src/pages/__tests__/`, and `verify.mjs` is `scripts/tests/reports-visual/verify.mjs`.

---

## 1. Removed `expect` lines by file

### 1.1 `src/components/reports/__tests__/ReportsOverview.test.tsx` (22). EQUIVALENT 14, STRONGER 8

| # | Removed assertion (abbreviated) | Class | Replacement | Note |
|---|---|---|---|---|
| O1 | B19 `policies.getByText("5")` | STRONGER | ReportsOverview.test.tsx:27, :91 | Also asserts `data-report-value="hero"` |
| O2 | B20 `policies.getByText(/counted on each policy's sale date/)` | EQUIVALENT | reportsPage.test.tsx:491 (exact sentence in the Data basis sheet); reportsDataBasis.test.tsx:97 (`POLICY_SOURCE_NOTE`); reportsBasisText.test.ts:24 (SHA-256 pin), :93; band basis bar ReportsOverview.test.tsx:40-41 | Moved per §5.3 basis bar, §5.9, §5.11 ("methodology paragraphs → basis bar + Data basis") |
| O3 | B21 `amounts.getByText("$1,481.40")` | STRONGER | ReportsOverview.test.tsx:29-31, :91 | Adds `<p>` tag and hero marker; the money-clipping scan relies on both |
| O4 | B22 `amounts.getByText("$123.45")` | EQUIVALENT | ReportsOverview.test.tsx:37 | Now the "Known monthly" row |
| O5 | B23 `"4 of 5 policies have a known premium."` | EQUIVALENT | ReportsOverview.test.tsx:32 `"4 of 5 premiums known · 1 unknown excluded"`; :33-34 Partial chip; reportsBasisText.test.ts:180-191 | **Coverage-count guard kept.** New copy per §5.3/§5.11; no percentage (:42) |
| O6 | B24 `/excluded from amount/` parent has `"1 policy"` | EQUIVALENT | ReportsOverview.test.tsx:32; :44 (old wording absent) | Unknown count merged into the coverage line |
| O7 | B25 `/current book values, not sale snapshots/` | EQUIVALENT | reportsDataBasis.test.tsx:97 (`PREMIUM_BASIS` rendered in sheet); reportsBasisText.test.ts:27 (SHA-256 pin), :54, :95; basis bar "Current book · …" ReportsOverview.test.tsx:40, reportsBasisText.test.ts:174 | §5.3, §5.9 |
| O8 | B26 `/current assigned agent, not the original seller/` | EQUIVALENT | reportsPage.test.tsx:492 (sheet), :565 (CSV note); reportsDataBasis.test.tsx:97; reportsBasisText.test.ts:25 (SHA pin), :99; bar "client's current agent" ReportsOverview.test.tsx:40 | §5.3, §5.9 |
| O9 | B33 `amounts.getAllByText("Unavailable")` ×2 | STRONGER | ReportsOverview.test.tsx:50 (same), :51-52 (hero reads Unavailable, muted) | **Zero/unknown guard kept** |
| O10 | B34 all-unknown `queryByText("$0.00")` absent | EQUIVALENT | ReportsOverview.test.tsx:53 (identical) | **Unknown is never $0.00**; also verify.mjs:286 |
| O11 | B35 `"0 of 5 policies have a known premium."` | EQUIVALENT | ReportsOverview.test.tsx:54 `"0 of 5 premiums known · 5 unknown excluded"` | New copy, §5.3 |
| O12 | B36 excluded parent has `"5 policies"` | STRONGER | ReportsOverview.test.tsx:54; :55 average "—" (zero denominator); :56 no meter; :57 no Partial chip | Fixture now also sends `average_annual_premium: 0`; display stays "—" |
| O13 | B41 empty period `getAllByText("$0.00")` ×2 | EQUIVALENT | ReportsOverview.test.tsx:62 (identical plus a comment); :63 average "—" | **True zero kept distinct** |
| O14 | B42 `"No policies sold in this period."` ×2 | EQUIVALENT | ReportsOverview.test.tsx:64 (×1); :66 no coverage text for an empty cohort; reportTrendCharts.test.tsx:113 | **True-zero message kept.** The second copy in the premium cell was removed on purpose. The empty cohort shows "$0.00" with average "—" (§5.1 footnote) |
| O15 | B44 known zero `getAllByText("$0.00")` ×2 | STRONGER | ReportsOverview.test.tsx:68 (×3: annual, monthly and the new average); :70 no "Unavailable"; :72 meter | A known zero stays $0.00 |
| O16 | B45 `"1 of 1 policies have a known premium."` | EQUIVALENT | ReportsOverview.test.tsx:69 `"1 of 1 premium known"`; reportsBasisText.test.ts:184 | Now singular |
| O17 | B52 `getByText("$1,234,567,890.12")` | STRONGER | ReportsOverview.test.tsx:78 (scoped to `[data-report-value]`), :80 stacked layout, :82-83 one line, :105-113 nowrap and no overflow-wrap; verify.mjs:607-610 (real-browser clipping and wrapping) | **Large money value kept**, with all cents |
| O18 | B54 `not.toMatch(/previous\|last period\|[0-9]%/i)` | EQUIVALENT | ReportsOverview.test.tsx:84 (identical); :42 no "%" in band | **No-comparison guard kept** |
| O19 | B76 `getByText("9")` | STRONGER | ReportsOverview.test.tsx:177 (ordered `dt + dd` values `["1","1","9","2","15"]`) | |
| O20 | B77 `getByText("15")` | STRONGER | ReportsOverview.test.tsx:177 | |
| O21 | B78 `/independent period totals, not one cohort/` has "policies use their sale dates" | EQUIVALENT | ReportsOverview.test.tsx:180 (`PERIOD_TOTALS_LINE`), :178-179 caption "by sale date", :183 no "%" (unchanged line), :182 no arrows; full statement verbatim in Data basis: reportsBasisText.test.ts:110, :176-177; reportsDataBasis.test.tsx:97 | §5.6 ("the full cohort statement moves verbatim to Data basis"). `PERIOD_TOTALS_NOTE` (`reports-basis-text.ts:80`) is byte-equal to base `ReportsActivityFlow.tsx:43`. **Period-totals "no %" guard kept**; also verify.mjs:701-704 |
| O22 | B79 `/campaign-lead or call identity/` | EQUIVALENT | reportsBasisText.test.ts:110; reportsDataBasis.test.tsx:97 | Same sentence, now in Data basis (§5.6) |

### 1.2 `src/components/reports/__tests__/agentPerformanceTable.test.tsx` (2). STRONGER 2

| # | Removed assertion | Class | Replacement | Note |
|---|---|---|---|---|
| A1 | B32 `within(alice).getByText("0h 4m 24s")` | STRONGER | agentPerformanceTable.test.tsx:32 `"4m 24s"`, :33 no `/^0h /`; reportsTables.test.tsx:220 | One duration format, `formatElapsed` (§5.4) |
| A2 | B51 Unattributed row has `"0/1 known · 1 unknown"` | STRONGER | agentPerformanceTable.test.tsx:52-53 (same text), :55-57 (tfoot, one cell per column, no colSpan), :73-74 | §5.7 item 5 |

### 1.3 `src/components/reports/__tests__/reportTrendCharts.test.tsx` (10). REMOVED-UI 4, EQUIVALENT 2, STRONGER 4

T1–T5 come from the one deleted test, "withholds agent ranking when requested scopes differ despite matching resolved scope and period" (B40-51).

| # | Removed assertion | Class | Replacement | Note |
|---|---|---|---|---|
| T1 | B44 `"Agent summary not loaded"` shown when the summary's requested scope differs | REMOVED-UI | §5.3: "now from the **same summary payload**. This removes today's cross-panel join and its guard." reportTrendCharts.test.tsx:103-105 (the chart has neither a ranking nor this text); the band leader row is absent while loading (ReportsOverview.test.tsx:122) and the band has no digits on error (:127) | **Agent summary not loaded:** the text no longer exists in Reports src (0 matches at HEAD) |
| T2 | B45 `"Bob Agent"` absent on the mismatch | REMOVED-UI | §5.3. The leader is read from the summary itself: ReportsOverview.test.tsx:141-167 (absent in personal scope, :164-166). Page-level scope drift still withholds every panel: reportsPage.test.tsx:167-185, :606-610 | With no join there is nothing to mismatch. `Reports.tsx:66` still compares `requested_scope` (base `:63`). That page check is not unit-tested for a requested-scope-only mismatch at base or HEAD. This gap predates the branch and is outside this diff |
| T3 | B46 chart `policies_sold` total = 2 regardless of summary | REMOVED-UI | The chart no longer takes a `summary` prop (§7.1 `reportSectionMap` drops `summary`). Volume aggregation is still asserted: reportTrendCharts.test.tsx:52, :84; reportsTrends.test.tsx:107 | Independence from the summary now holds by construction |
| T4 | B49 `"Bob Agent"` shown when the summary matches | EQUIVALENT | ReportsOverview.test.tsx:146 `"Bob Agent · 2 policies"`; reportsPage.test.tsx:485; verify.mjs:295-297, :689 | Ranking moved to the band (§5.3) |
| T5 | B50 `"Agent summary not loaded"` absent | REMOVED-UI | reportTrendCharts.test.tsx:103-104 | Text removed (§5.3) |
| T6 | B62 `toMatchObject({… coverage_pct: 50})` | STRONGER | reportTrendCharts.test.tsx:52 (adds `partial: true`), :55-57 | |
| T7 | B64 `"2 of 4 policies known · 2 unknown"` | EQUIVALENT | reportTrendCharts.test.tsx:54 (identical) | Header meta added at :55 |
| T8 | B75 `toMatchObject({annual_premium: null, coverage_pct: 0, …})` | STRONGER | reportTrendCharts.test.tsx:68 (adds `partial: false`), :70-73 (no "$0.00", "Gap = known premium unavailable, not $0") | **Unknown never $0** |
| T9 | B111 `axis-rate` `data-domain` `"[0,100]"` | STRONGER | reportTrendCharts.test.tsx:143 `"[0,10]"`, :162, :181-185 (`rateAxisMax` table over 9 inputs: 0 floor, 100 cap) | **Rate axis domain:** an intended change (§5.5, "rate axis zero-based with a nice maximum"). Still zero-based and never above 100 |
| T10 | B117 `onGroupingChange` called with `"monthly"` | STRONGER | reportsTrends.test.tsx:43 (callback wired to state), :65-81 (Weekly and Monthly regroup all four panels; `aria-pressed` moves), :119-124; reportsPage.test.tsx:569-583 (page level); reportTrendCharts.test.tsx:108, :147 (no control inside a card) | **Grouping callback:** one control for both charts (§5.5). The click is checked through what it changes |

### 1.4 `src/lib/__tests__/reportStatComputations.test.ts` (2). EQUIVALENT 1, REMOVED-UI 1

| # | Removed assertion | Class | Replacement | Note |
|---|---|---|---|---|
| S1 | B30 `stat_total_talk_time` value `"12:20"` | EQUIVALENT | reportStatComputations.test.ts:31 `"12m 20s"`; reportsFormatElapsed.test.ts:16, :27; verify.mjs:698 (no m:ss anywhere on the page) | **Talk-time format:** `formatElapsed` (§5.4). R-5's 0.1 s values are new assertions: reportStatComputations.test.ts:69-76; reportsCallDuration.test.tsx:60-75, :100-117; reportsFormatElapsed.test.ts:61-75 |
| S2 | B42 `stat_dials_per_contact` subtitle `"calls made ÷ contacted calls"` | REMOVED-UI | §5.4 ("subtitles only where they change how a number reads") and §5.11 ("Strip formula subtitles → none"). reportStatComputations.test.ts:52-54 (no subtitle); :43 now pins the value 1.7 (19 ÷ 11) | Base never asserted the value. **R-1** (not removed) is new coverage: :62-66, reportsPage.test.tsx:380, verify.mjs:199-200 |

### 1.5 `src/lib/__tests__/reportsPolicySource.test.ts` (1). EQUIVALENT 1

| # | Removed assertion | Class | Replacement | Note |
|---|---|---|---|---|
| P1 | B175 `CampaignPerformance.tsx` contains `"unavailable campaign attribution"` | EQUIVALENT | reportsPolicySource.test.ts:176-178 (`<CampaignTotalsFoot campaigns={campaigns}`, "Attribution unavailable", "Missing, ambiguous or restricted"); DOM: reportsTables.test.tsx:91-108, :125-132; reportsPage.test.tsx:537-543; verify.mjs:706-711 | **Attribution-unavailable text:** paragraph → tfoot row (§5.7 item 5). The CSV note "Campaign attribution unavailable: 13 outbound calls; 3/5 policies." is golden at reportsBasisText.test.ts:71 |

### 1.6 `src/pages/__tests__/reportsPage.test.tsx` (12). EQUIVALENT 7, STRONGER 4, REMOVED-UI 1

| # | Removed assertion | Class | Replacement | Note |
|---|---|---|---|---|
| G1 | B88 denied scope: `queryByText("Campaign Performance")` absent | EQUIVALENT | reportsPage.test.tsx:126 `"Campaign performance"` | Sentence-case title (§5.11). Matching the current title keeps the check meaningful |
| G2 | B294 `"Most policies — current assignments"` ×1 | STRONGER | reportsPage.test.tsx:484 (×1 in the band), :485 value, :487 not in the Key metrics strip; reportTrendCharts.test.tsx:103 not in the chart | |
| G3 | B296 `/2 policies currently assigned/` | EQUIVALENT | reportsPage.test.tsx:485 `"Bob Agent · 2 policies"`; tile subtitle still pinned at reportStatComputations.test.ts:88, :106 | Band row wording per §5.3 / D-5 |
| G4 | B297 `/Policies are stored client policies … counted on each policy's sale date/` | EQUIVALENT | reportsPage.test.tsx:491 (exact sentence in Data basis); CSV note :566 | §5.9 |
| G5 | B299 `/not the original seller/` | EQUIVALENT | reportsPage.test.tsx:492 (Data basis); CSV note :565 | §5.9 |
| G6 | B304 `queryByText(/Data quality across this scope/)` absent | EQUIVALENT | reportsPage.test.tsx:519 (within the band); ReportsOverview.test.tsx:134 (whole render) | Narrowed to the band. The note now renders only there and in the closed sheet |
| G7 | B308 `/Data quality across this scope, all dates (not only this period): 2 policies…/` | EQUIVALENT | reportsPage.test.tsx:523 (band, anchored), :521 fixture on `summary`; ReportsOverview.test.tsx:136-137 (verbatim, with caution icon); reportsDataBasis.test.tsx:122; reportsBasisText.test.ts:57, :66 (CSV) | **"All dates" sentence kept.** Base fed it through the volume chart's copy, a duplicate that §5.3/§5.11 removed. The band reads `summary.policy_quality` |
| G8 | B316 `/3 of 5 policies sold in this period have unavailable campaign attribution/` | EQUIVALENT | reportsPage.test.tsx:537-543 (tfoot "Attribution unavailable": 3 policies and 13 calls; Spring Team 2; 2 + 3 = 5 reconciles; old paragraph absent); reportsTables.test.tsx:91-108 (sum = `policies_in_period` at :105), :125-132; verify.mjs:706-711 | **Campaign attribution unavailable text** (§5.7 item 5) |
| G9 | B345 `queryByText("Total policies sold")` absent (volume failed) | STRONGER | reportsPage.test.tsx:588-594 (each Trends card is in its error state, "Couldn't load production trend.", no "Policies sold", coverage or inbound text) | The tile itself was removed (§5.11 "Peak/Total tiles" removed; reportTrendCharts.test.tsx:103-104). Checking for the error state means the assertion can actually fail |
| G10 | B346 `queryByText("Peak period")` absent | STRONGER | Same as G9 | |
| G11 | B365 `getByText("Report basis and data quality")` | REMOVED-UI | §5.9/§5.11 (bottom block → top "Data basis" sheet). reportsPage.test.tsx:631-640 (trigger in header, no `<details>`, live quality list, as-of `<time>`), :648-660 (loading, failed, stale and withheld states give words with no digits); reportsDataBasis.test.tsx:43-145; verify.mjs:752-762, :819-824 | |
| G12 | B366 `/Known annual premium in that subset:/` | STRONGER | reportsPage.test.tsx:614-615 (subset values as tfoot cells: `"$0.00"`, `"3/3"`), :617 (summary premium sentence in Data basis); reportsBasisText.test.ts:72 (CSV "Unavailable campaign subset" note) | Base checked only the label prefix; HEAD checks the values |

---

## 2. Assertions changed without a removed `expect(` line

Inputs or harness changes that alter what an existing `expect` means.

| File | Change | Class | Where |
|---|---|---|---|
| reportsControls.test.tsx | `"Today"` dropped from the "disabled while unresolved" loop (base B72) | EQUIVALENT | :97 loop; :99 `periodSelect()` disabled (one "Report period" select, §5.2 / D-3) |
| reportsControls.test.tsx | `ReportScopeTabs` render gains `panelRendered` so the existing `aria-controls` expect still holds | EQUIVALENT | :28, :37; U-8 positive and negative cases at :40-45 |
| reportsContracts.test.ts | "call contact rate" scan widened from `*.tsx` to the `.ts` text modules | STRONGER | `surfaceFiles()` at :149-153 (§7.4); new conversion-rate scan and under-200-lines rule at :170-194 |
| reportsPage.test.tsx | "This Month" button → `choosePeriod("This month")`; the period expect is unchanged | EQUIVALENT | :283-284 (plus Last month at :285-286) |
| reportsPage.test.tsx | "Disposition Deep Dive" → "Disposition deep dive" button | EQUIVALENT | :256 |
| reportsPage.test.tsx | `useReportPanels` mock returns key `null` and loading panels when there is no request, as the real hook does | neutral (harness is more realistic) | :34-36 |
| reportTrendCharts.test.tsx | `summary={null}` and `onGroupingChange` props dropped from renders (props removed, §7.1) | neutral | :50, :67, :83, :91, :140, :157, :169 |

---

## 3. Browser gate `verify.mjs` (supplementary)

This file uses `assert`, not `expect`. It has 9 removed `assert` lines and 119 added. Each removed protection maps to HEAD as follows.

| Base | Removed | Class | HEAD |
|---|---|---|---|
| B65 | `ready()` waits for "Report basis and data quality" | REMOVED-UI §5.9 | :117-122 (`ready()` waits for the current summary's as-of) |
| B76 | anchors checkbox `/Policies Sold\|Known Annual Premium/` count 0 (F-1: could never fail) | STRONGER | :194 positive control, :195 anchored case-insensitive regex, :196-197 id-based check |
| B146 | Personal premium `/Unavailable[\s\S]*0 of 1 policies/` | STRONGER | :285 `/Unavailable…0 of 1 premium known · 1 unknown excluded/`, :286 never $0.00, :287 average "—", :288 no Partial chip |
| B153 | premium contains `$14,406.00` after Team/Agency | EQUIVALENT | :299 (leader rows added at :295-297) |
| B191 | `charts > 0` | STRONGER | :604 (`>= 4`) |
| B192 | `pieSectors >= 2` | REMOVED-UI §5.8 / U-2 / D-4 | :605 ranked `dispositionRows >= 2` (text plus share bar) |
| B193 | `positiveBars >= 1` | STRONGER | :606 (each trend card) |
| B184-185 | money-clipping scan on leaf `<p>` (its assert line is unchanged) | STRONGER (F-1) | :577-582, :607-610 (any leaf in the workspace, measured on its block ancestor, plus wrap and hero-line checks) |
| B196 | hierarchy order | STRONGER | :598 (Period totals added), :611-613 |
| B227-233 | rendered page contains 13 strings | EQUIVALENT | :678 keeps 4; "3 of 8 … known" and "5 unknown" at :683, :696; "1800 duplicate seconds removed", the session cohort, "Each panel is calculated independently" and "Callback dispositions" in Data basis at :759-760; "unavailable campaign attribution" → tfoot :706-711; "5 outbound calls are not linked…" → tfoot :714-715 |
| B246 | summary CSV contains six values | STRONGER | :748-751 (adds the overlap sentence) |
| B266, B274 | heading and button "Campaign Performance" | EQUIVALENT | :784, :792 (sentence case); "This is not a zero" kept at :786 |
| B280 | "Report basis and data quality" count 0 on a failed window | STRONGER | :816-824 (export disabled, no as-of, sheet says unavailable in words, withholds 1800, $14,406.00 and the cohort, no `<time>`) |

---

## 4. Test run at HEAD

`npx --no-install vitest run --maxWorkers=2 --minWorkers=1 <23 files>` covered every modified and added `*.test.ts(x)` in the diff. No other vite process was running, and port 4180 was free and not used.

- **Result:** Test Files 23 passed (23). Tests **356 passed, 1 skipped** (357). Duration 26.1 s. Exit 0.
- **The skip:** the `reportsIntegrity.test.ts` SQL-payload case. It runs only when `REPORTS_SQL_PAYLOADS` is set (`reportsIntegrity.test.ts:12`, the same at base), and it was not set for this run.
- **Console noise:** React Router future-flag warnings and `act(...)` warnings only. No failures.

---

## 5. Guard grep (base `a41ed8ea` vs HEAD `6138978d`)

Each count is the number of matching lines from `git grep -h -F|-E '<text>' <rev> -- <paths> | wc -l`, using three path sets:

- **Tests:** `src/**/*.test.ts` and `src/**/*.test.tsx`
- **verify:** `scripts/tests/reports-visual/verify.mjs`
- **Src:** Reports source only: `:(glob)src/components/reports/*.ts{,x}`, `:(glob)src/lib/reports-*.ts`, `src/lib/stat-computations.ts` and `src/pages/Reports.tsx`

### 5.1 Protected guards named in §9.2 item 3

| Guard | Tests base → HEAD | verify base → HEAD | Src base → HEAD |
|---|---|---|---|
| "This is not a zero" | 6 → 7 | 1 → 1 | 2 → 2 |
| "not a zero" | 8 → 12 | 1 → 1 | 3 → 3 |
| "Unavailable" (case-sensitive) | 17 → 21 | 1 → 1 | 6 → 8 |
| `"—"` (quoted em dash) | 36 → 50 | 0 → 0 | 16 → 21 |
| `'—'` (quoted em dash) | 1 → 1 | 0 → 0 | 0 → 0 |
| `expect(…"—")`-style zero-denominator lines | 24 → 36 | 0 → 1 | n/a |
| Export identity: "no longer the one on screen" | 1 → 1 | 0 → 0 | 0 → 0 |
| Export identity: "stale export" / "never exports stale" | 0 → 0 | 3 → 3 | 0 → 0 |
| Export identity: `isCurrent` | 38 → 38 | 0 → 0 | 1 → 3 |
| Export identity: CSV headers/rows pinned (`onExport).toHaveBeenCalledWith` / `onExport.mock.calls`) | 5 → 17 | 0 → 0 | 0 → 0 |
| Export identity: golden CSV Note builders (`policyExportNotes` / `integrityExportNotes`) | 10 → 17 | 0 → 0 | 5 → 8 |
| Export identity: "filenames are unchanged" / "unchanged file name" | 0 → 1 | 0 → 1 | 0 → 0 |

In the Reports test files alone (17 at base, 27 at HEAD):

- **"This is not a zero":** 1 → 2.
- **"Unavailable":** 2 → 6.
- **`"—"`:** 13 → 27, with 12 → 25 of those inside an `expect`.

**Every base guard line still exists at HEAD**, at these locations:

| Guard | Base → HEAD |
|---|---|
| "This is not a zero" | ReportsOverview.test.tsx B64 → :125; verify.mjs B268 → :786 |
| "not a zero" | reportsPage.test.tsx B165 → :203 |
| "Unavailable" | ReportsOverview.test.tsx B33 → :50, B46 → :70; verify.mjs B146 → :285 |
| `"—"` expects | agentPerformanceTable.test.tsx :31 → :31; reportPresentation.test.tsx B83 → :128; reportStatComputations.test.ts B63/87/127/128/130/131/155 → :114/185/225/226/228/229/253; reportsExportFormat.test.ts :91, :103 (unchanged); reportsIntegrity.test.ts B28 → :29 |
| "Stale export" | verify.mjs B31/B279 → :68/:816 |
| "No longer the one on screen" | reportsPage.test.tsx B270 → :460 |
| "Including exports" | reportsPage.test.tsx B358 → :606 |

### 5.2 Task-specific guards

| Guard | Tests base → HEAD | verify base → HEAD | Src base → HEAD | Comment |
|---|---|---|---|---|
| `queryByText("$0.00")).not` | 3 → 3 | 0 → 0 | n/a | Unknown never $0.00 |
| "never $0.00" / "never presented as zero" | 0 → 0 | 1 → 2 | n/a | |
| "No policies sold in this period." | 1 → 2 | 0 → 0 | 3 → 2 | Src −1 is the premium cell's duplicate copy, removed per §5.1 |
| "premiums known" (coverage words) | 0 → 13 | 0 → 2 | 0 → 1 | New copy |
| "N of M … known" coverage counts | 4 → 15 | 1 → 3 | 0 → 1 | |
| "1,234,567,890.12" | 1 → 2 | 0 → 0 | n/a | |
| `previous\|last period` negative | 1 → 1 | 0 → 0 | n/a | |
| No % in Period totals / band | 4 → 7 | 0 → 3 | n/a | |
| "Attribution unavailable" | 0 → 11 | 1 → 3 | 2 → 5 | Replaces the paragraph text |
| "unavailable campaign attribution" | 2 → 2 | 1 → 0 | 3 → 1 | verify and Src moved to the tfoot "Attribution unavailable"; DispositionDeepDive keeps the sentence |
| "Campaign attribution unavailable" (CSV note) | 1 → 3 | 0 → 0 | 2 → 2 | CSV unchanged |
| "Dials per booking" (R-1) | 0 → 6 | 0 → 1 | 0 → 2 | |
| "Dials per appointment" (old R-1 label) | 0 → 1 | 0 → 1 | 1 → 0 | HEAD hits are absence checks |
| R-5 0.1 s values (`38.9s\|32.5s\|21.4s`) | 0 → 11 | 0 → 0 | 0 → 1 | |
| "Agent summary not loaded" | 2 → 1 | 0 → 0 | 1 → 0 | UI removed (§5.3); the HEAD test is an absence check |
| `data-domain` (rate axis) | 2 → 4 | 0 → 0 | n/a | |
| `rateAxisMax` | 0 → 2 | 0 → 0 | 0 → 5 | |
| "Group trends by" | 0 → 3 | 0 → 0 | 0 → 2 | |
| `onGroupingChange` | 5 → 1 | 0 → 0 | 6 → 4 | Callback moved to `ReportTrends`; tests use one stateful harness |
| "Data quality across this scope" | 2 → 6 | 0 → 0 | 1 → 1 | |
| "Most policies — current assignments" | 3 → 16 | 0 → 4 | 2 → 5 | |

---

## 6. Conclusion

Of the 49 removed `expect` lines, 25 are EQUIVALENT, 18 are STRONGER, 6 are REMOVED-UI and **0 are WEAKENED**.

The six REMOVED-UI items each guarded UI that an approved plan section removed:

- **§5.3**, the trend chart's cross-panel agent ranking: T1, T2, T3, T5.
- **§5.4 / §5.11**, the strip's formula subtitles: S2.
- **§5.9 / §5.11**, the bottom "Report basis and data quality" block: G11.

Each of the six still has coverage of its intent at HEAD. All 23 changed or added test files pass at HEAD (356 passed, 1 env-gated skip). The guard greps show that all the protected guards remain or have grown:

- "This is not a zero"
- "Unavailable"
- "—" for zero denominators
- export identity
- the task's 13 specific guards
