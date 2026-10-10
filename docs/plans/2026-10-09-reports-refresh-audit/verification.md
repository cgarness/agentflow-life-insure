# Reports refresh — verification record (2026-10-10)

**Candidate:** PR-A, branch `claude/reports-refresh-audit-20261009`. Verified head `6138978ddfedaf816f1da9b0acc88ae0b9b2a17b`, which is the implementation plus a merge of current `main`.

**Base:** `main` `a41ed8eaabf212d9c60726d04ba227769d9ed20a` (production). It differs from the branch's original base `8d53531d` only by #432–#434 (Google OAuth pages, Campaigns table). Those commits touch no Reports file. `src/lib/reports-queries.ts`, `stubs.ts` and the Supabase types are identical in all three trees.

**Evidence labels:**
- **[static]**: git and source reading
- **[local synthetic]**: isolated fixture, synthetic data
- **[native PG16]**: disposable PostgreSQL 16.15 on loopback
- **[DB-sim]**: production read-only role simulation inside `begin read only … rollback`
- **[CATALOG]**: production read-only catalog
- **[CI]**: GitHub Actions on an exact head

**Not done:** nothing was merged, deployed, or applied to production, and no production row was written. S-1 and S-3 are untouched.

## 1. Summary

| Gate (plan §9.2) | Result |
|---|---|
| 1. `npx tsc --noEmit`; app `tsc -p tsconfig.app.json` | **Pass.** Root exits 0. App: 85 diagnostics at base and 85 at head. Same 66 file:code:message signatures; 0 added, 0 removed; none in a Reports file. |
| 2. Reports vitest; full-suite base comparison; ESLint; build | **Pass.** Strict set 22 files, 358/358 with `REPORTS_SQL_PAYLOADS`. All 29 Reports files 436/436. Full suite: the same 10 failing files and 1 failing test as base, 0 new, 0 runtime errors. ESLint on 73 changed files: 0 errors and 0 warnings. `vite build` exits 0. `scripts/verify_reports_frontend.py`, run as CI runs it, exits 0. |
| 3. Assertion diff review and guard grep | See §4 |
| 4. Native SQL (PG16 here, 17.6 in CI) | **Pass.** All four runners pass. 17 Reports integrity negative controls (6 at base), payload identical to baseline once clock fields are masked. PR-B (#435): five workflows green, including the 17.6 CI job. |
| 5. Real Chromium gate | **Pass.** `verify.mjs` prints 22 PASS lines. axe-core 4.10.2 finds 0 violations in light and dark at 390 and 1440. Every first-screen budget is met. |
| 6. CSV byte comparison | **Pass.** 74/74 files byte-identical to the golden baseline (raw and normalized sha256) |
| 7. Read-only production recheck | **Pass.** 38/38 function bodies match the Phase 1 record. W1/W2/W3/W5 values are identical. RPC names and argument shapes are unchanged. The R-3 guard prints 0 on live W1 |
| 8. Independent code review | **Done.** 3 lenses, 6 should-fix findings confirmed and fixed in `134a6360`; 17 nits dropped. |

## 2. Frontend gates [local synthetic, static]

Node 22.22.0 locally; CI uses 22.16.0. tsc 5.8.3, vitest 3.2.4.

- **Typecheck.** Root `tsc --noEmit` exits 0 at base and head. It is vacuous: the root config has `files: []` and is run without `-b`.
  - `tsc --noEmit -p tsconfig.app.json` exits 2 on both sides, with 85 `error TS` lines in 54 files and 66 distinct signatures.
  - The header lines, line and column included, are identical. The only text difference is tsc's print order of union members in one pre-existing `CallScripts.tsx` TS2769 continuation line.
  - No diagnostic is in a Reports file. Sidebar.tsx TS2367 (`/reports`) exists on both sides.
- **Full vitest.**
  - Base: 304 files, 4,840 tests, 4,807 passed, 1 failed, 32 skipped.
  - Head: 314 files, 5,058 tests, 5,025 passed, 1 failed, 32 skipped.
  - The 10 failing files are identical on both sides and pre-existing:
    - 9 fail at import with "supabaseUrl is required.": addLeadAssignmentGate, dialerCampaignPresenceHook, contactName, contactScope, leadDisposition, userLocalDayBounds, caller-id-selection, runtimeEventLogger, custom-fields-settings.
    - 1 is the `recordingRetentionVoicemail` v29 byte assertion.
  - Head adds 10 Reports test files and 218 tests, all in Reports files. No existing file lost a test. The skipped set is the same on both sides.
- **Reports sets.**
  - Strict CI set (22 files): 357 passed + 1 `runIf` skip without payloads; 358/358 with `REPORTS_SQL_PAYLOADS`.
  - All 29 Reports files: 436/436 with payloads.
- **CI-equivalent script.** `REPORTS_BASE_SHA=a41ed8ea… python3 scripts/verify_reports_frontend.py`: exit 0, with every check 0 or matching base.
- **ESLint:** 73 existing changed `.ts`/`.tsx` files, 0 errors, 0 warnings.
- **Build.** 4,758 modules; entry `index-BoRxJaDf.js`, sha256 `c3065d91…6af1891`.
  - The bundle calls only the six `get_report_*_v2` RPCs and contains no `rpc_report_` or v1 call names.
- **Size rule.** All 40 `src/components/reports/*.tsx` files are under 200 lines; the largest is `DispositionDeepDive.tsx` at 174. `src/pages/Reports.tsx` is 165.
- **Do-not-touch list (§7.6).** `git diff a41ed8ea..HEAD` is empty for:
  - `report-layout-constants.ts`, `report-layout.ts`, `useReportLayout.ts`
  - `reports-queries.ts`, `reports-schemas.ts`, `reports-export.ts`
  - `index.css`, `tailwind.config.ts`, `TwilioContext.tsx`
  - `supabase/migrations`, `supabase/functions`

## 3. Native SQL and browser gate [native PG16, local synthetic]

**SQL runners.** PostgreSQL 16.15 on 127.0.0.1:55471 (TCP only), from a `git archive` of the head. The cluster was stopped afterwards.

| Runner | Result |
|---|---|
| `run_reports_integrity_tests.sh` | exit 0. 27 OK steps (T0–T15, P0, A–K, R, Z). "Reports v2 integrity assertions passed"; **"Seventeen Reports integrity negative controls passed"** (T-1..T-6 add 11 to the base 6); recovery fingerprint, disable/enable and drift refusals pass. The 2 transaction warnings are the same as at base. |
| `run_reports_rpc_tests.sh` | exit 0. "ALL REPORTS RPC PROOFS PASSED (suite + 6 negative controls + drift + replay + disable/enable + rollback) AND POLICY PROOFS" |
| `run_profile_rpc_tests.sh` | exit 0. "ALL PROFILE RPC PROOFS PASSED" |
| `run_reporting_integrity_tests.sh` | exit 0. 50,000-row fixture; native policy and booking SQL, permissions and contention |

**Payloads.** The regenerated browser payload equals the Phase 1 baseline once 33 `as_of` and 3 `scope.today` values are masked; both kinds of field come from the clock. `reportsIntegrity.test.ts` with those payloads: 13/13 passed, 0 skipped.

**Browser gate.** `verify.mjs`, real Chromium 1194, Playwright 1.56.1, axe-core 4.10.2: **22 PASS lines.**
- First screen, Custom-range state (the date row is 48 px):

  | Width | Header | Production values bottom | 6th tile bottom | Trends title |
  |---|---|---|---|---|
  | 390 | 253 | 422 / 414 | 868 | |
  | 1440 | 133 | 354 / 338 | 609 | 664 |

  The gate's preset-state budgets (date row removed) all pass: 390 filter **205 ≤ 216**, production values **374 ≤ 380**, six tiles **820 ≤ 844**; 1440 header **133 ≤ 150**.
- Measured at 390, 768, 1024 and 1440:
  - no page overflow
  - no clipped or wrapped money
  - production values on one line
  - the right-edge table fade shows exactly while columns remain
  - heatmap values are visible
- axe: **0 violations** at 390 and 1440, in light and dark. "Needs review" items, not failures:
  - color-contrast: 106 nodes at 390, 88 at 1440
  - aria-valid-attr-value: 4 Radix triggers whose popovers are not mounted
- Charts. The three keyboard charts are named "Policies sold by day", "Outbound calls by day" and "Calls made by agency hour". Pressing ArrowRight produces a polite live readout.
- Remaining PASS lines cover:
  - 13 paced CSV downloads with their file names unchanged
  - CSV values, blank unknowns, formula protection, and parity with the Data basis text
  - customization: keyboard and mobile, save, cancel, reset, and failed-save recovery (U-6/U-8/U-9)
  - Personal / Team / Agency transitions, the leader row, and stale-export withholding
  - the **R-4 frame probe `[true,true,false,…]`**
  - partial failure and retry, the keyboard period select, and stale-window protection

## 4. Assertion diff review [static]

`git diff a41ed8ea..HEAD`: 23 test files changed. 49 `expect` lines were removed from 6 modified test files, and 745 were added. No test file was deleted.

**Guard grep** (count of test-file lines):

| Text | Base | Head |
|---|---|---|
| "This is not a zero" | 6 | 7 |
| "Unavailable" | 17 | 21 |
| "not a zero" | 8 | 12 |
| `'—'` | 1 | 1 |

Each removed assertion is mapped to its replacement, or to the plan section that removed its UI, in `assertion-diff.md`.

## 5. CSV byte comparison [local synthetic, real Chromium]

The golden capture (fixed clock 2026-10-09T04:00Z, 1,100 ms pacing, America/Los_Angeles) ran against the head. Three selectors were adapted, and only for renamed controls: the as-of test id, the "Report period" select, and "Group trends by".

- **74/74 files are identical**, raw and normalized sha256, 118,453 bytes on both sides. 0 different, missing or new.
- Every CSV's suggested file name and report name are unchanged. Only the button labels changed, to sentence case, for example "Export Lead sources CSV".
- The R-3 guard and R-6 do not change these fixtures' text, as the plan predicted:
  - agency reads "2 overlapping rows; 1800 duplicate seconds removed"
  - team and personal read "0 overlapping rows; 0 duplicate seconds removed"
- R-6 exhaustive check: base and head `qualityNotes` were compared over 26,244 count combinations. The only differences are R-3 (0 overlapping rows → 0 seconds) and R-6 ("1 estimate", "1 conflict").
- **On live data:** the "Sessions assessed …" Note changes "3" → "0" in windows like W1, the approved R-3 change. "1 estimate" and "1 conflict" appear only when a count is exactly 1.

## 6. Read-only production recheck [CATALOG, DB-sim]

Production `jncvvsvckxhqgqvkppmj`, PostgreSQL 17.6, read-only throughout (`transaction_read_only = on`). Only aggregates and UUIDs were read.

**Catalog.**
- The newest migration is still `20261008151523`.
- 34 Reports functions; 38/38 recorded bodies match the Phase 1 md5 record (`report_integrity_quality` `d330c5be…`, `report_session_facts` `245c7ce4…`).
- Exactly the six v2 RPCs are executable by `authenticated` and `service_role`; `anon` can execute none of them.

**Values** as Chris, agency scope:

| Window | Calls made | Contacted | Talk s | Bookings | Session s | Policies | Known annual premium | Known |
|---|---|---|---|---|---|---|---|---|
| W1 Oct 1–7 | 1,833 | 135 | 39,893 | 25 | 95,862 | 1 | $1,281.60 | 1/1 |
| W2 Sep | 2,946 | 232 | 67,374 | 43 | 417,083 | 4 | $3,205.32 | 4/4 |
| W3 Sep 8–Oct 7 | 4,136 | 310 | 93,237 | 60 | 396,827 | 4 | $3,831.72 | 4/4 |
| W5 12 months | 5,639 | 452 | 120,246 | 99 | 809,767 | 9 | $10,655.52 | 9/9 |

All values are identical to Phase 1. `quality.sessions.overlap_seconds_removed` is still 3/4/2/5 with 0 overlapping rows. That is R-3, which PR-B corrects on the server.

**Request shapes.** The fixture's RPC log has the same 12 distinct shapes at base and head, with the same RPC names, argument keys, order and types. Only the default dates differ, because they follow the run date. Head makes one more request round, consistent with the new R-4 frame probe.

**R-3 guard on live data.** The live W1 quality object was run through the bundled base and head code:
- base prints "0 overlapping rows; **3** duplicate seconds removed"
- head prints "**0**"
- with 2 overlapping rows and 1,800 s, both print 1,800

## 7. Before and after [local synthetic]

Both builds were captured in the same frame: 64 px top bar and 240 px sidebar stand-ins, the fixture's Inter, and the same SQL payloads. Before is `main` `a41ed8ea`; after is head `6138978d`. All 17 PNGs reproduced byte-identically in independent runs. They are palette-compressed copies in `screenshots/{before,after,compare}/`.

| Metric | Before | After |
|---|---|---|
| 390: header + filters (default / Custom) | 427 / 479 px | **205 / 253 px** |
| 390: Policies sold value bottom | 710 | **374** (preset) / 422 (Custom) |
| 390: Known annual premium value bottom | 982 (below the fold) | **366** / 414 |
| 390: 6th strip tile bottom | 1,723 | **820** / 868 |
| 390: Agent table important columns hidden at scroll 0 | both | premium only (92 px scroll, row label pinned, fade cue) |
| 1440: header + filters (default / Custom) | 223 / 275 | **133 / 133** |
| 1440: production values bottom | 552 / 542 | **354 / 338** |
| 1440: 6th tile bottom | 910 (below the fold) | **609** |
| 1440: Campaign table important columns hidden | both (half-width card) | **none** (7/11 visible, label pinned) |
| Page overflow (390 / 1440) | 0 / 0 | 0 / 0 |
| Full page height (390 / 1440) | 7,834 / 4,396 | 4,181 / 3,233 |

The full page heights also reflect different default expand and collapse states.

Files:
- `compare/`: before and after side by side, first screen at 390 light and dark, and 1440 dark
- `before/` and `after/`: full page and first screen at 1440 and 390, light and dark
- `after/` also has the Data basis sheet (desktop right sheet, mobile bottom sheet) and the Customize editor

At 390×844 in the Custom-range state, the 6th tile ends 24 px below the fold (868). The budgeted preset state ends at 820. Both production values are on the first screen in every state.

## 8. Review [static, local synthetic]

Three review lenses ran over the full diff: correctness, contracts, and UX/accessibility. Adversarial confirmation found 6 findings, all confirmed and fixed in `134a6360`:
1. **D-5 tie.** The strip tile now uses the same tie rule as the band.
2. **R-6 scope.** Singular only for estimate and conflict; other nouns keep their base CSV bytes.
3. **U-11.** The table fade shows at every width.
4. **U-7.** Heatmap numbers are visible on phones again.
5. **Charts.** Named charts, with no unnamed tab stops.
6. **axe.** The planned axe pass is now in `verify.mjs`, and the two pre-existing violations are fixed.

Negative controls: reverting each fix makes the new gate fail.

## 9. CI

- **PR-B** (#435, `claude/reports-overlap-sql-20261009`, head `646bb7fd`): all five workflows pass.
  - Reports backend verification: native PostgreSQL 17.6 plus browser, which runs the correction DDL on 17.6.
  - Reports frontend verification, Reporting integrity, Dialer DNC integrity, SMS consent integration.
  - The Supabase Preview check was cancelled by the integration's concurrent preview-branch limit. It is not a CI gate.
- **PR-A:** the PR records exact-head CI.

## 10. Not verified, and why

- **Hosted signed-in walkthrough (plan §9.4).** Not possible from this environment: the proxy denies `www.fflagent.com`, and there are no user credentials. It stays **Unverified** until Chris runs the checklist on desktop and a real iPhone.
- **iOS Safari** sticky cells inside overflow regions; real screen readers. The live readout was checked in Chromium only.
- **Heatmap busiest-cell contrast.** White 11 px text on full primary is about 3.68:1, the same as at base. axe does not flag it because the numbers are `aria-hidden` with sr-only text. Fixing it needs a palette decision.
- **Not certified, unchanged from Phase 1:** 277 call and 12 booking unreviewed duplicate candidates; legacy duration provenance.
- **R-3 server correction.** Not applied (PR-B). Until it is, the server still returns 1–5 s, and the frontend guard displays 0.
