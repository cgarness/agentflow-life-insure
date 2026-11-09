## November 8, 2026 Pacific — PR #521 hosted whitespace correction

Published frontend head f27c0b9ecb8db8eff006f2e8464c22826c308138 (tree 909cb2e9b1cc2d94b3351611009e82d765ec514d) exactly matched verified local commit 5097a270. Both Vercel previews are READY at that head. Preview /reports and the actual lazy Reports bundle return HTTP 200; the bundle contains the v3 summary/state readers and approved calculation/appointment labels. This is asset verification, not signed-in live-user acceptance. Supabase Preview is cancelled because its concurrent branch limit is reached; no preview DB pass or settings change.

The onboarding workflow 42563655073 passed its database, 43 tests, lint and TypeScript, then failed only on the preserved frozen test's extra EOF blank line. Remove exactly one final newline from `src/components/reports/__tests__/reportsDialerIntelligence.test.tsx`; assertions and runtime application bytes are unchanged. All 170 prepared source/support paths still match the frozen candidate except this test-only whitespace normalization. Existing 6,958-pass comparison, 86 contract checks and 504 visual checks retain validity; rerun the affected test and required whitespace/root-type checks, then observe all exact-final-head hosted results. This supersedes earlier claims of complete source/support byte equality by the explicitly named one-byte test exception.

Total PR scope remains 214 paths. No production deployment, merge, SQL execution or settings change. Final frontend merge/release still requires Chris's approval after hosted verification. Initial failed workflow evidence is retained; no gate is skipped or weakened.

Verification completed: affected test 12/12, root TypeScript and full main-to-candidate whitespace check all pass.

---

## November 8, 2026 Pacific — Frontend dependency completion

Resumed local preparation commit `052b1d90af044dfc0146b8a6debc0bab314251ae` after Chris's “Proceed.” Base main remains `3865fa9783c3743354d750fbfe36ed8f87c2c193`; open #486 and #514 retain their previously recorded heads. The approved frontend source and visual presentation remain frozen. No new feature, production SQL execution, deployment or merge.

The original 36-path dependency list omitted four SQL source references required by the contract/fixture harness. Recorded the additional paths before restoring their exact frozen bytes: `supabase/ops/appointment_evidence_disable.sql`, `supabase/ops/appointment_evidence_enable.sql`, `supabase/ops/reporting-accuracy/appointment_evidence_preflight.sql`, and `supabase/ops/reporting-accuracy/check_sale_correction_manifest.sql`. These are source-only restorations for verification, not approval to execute operational scripts in production. Of the original 36 paths, four Havana fixture files already contain approved newer corrections and were preserved verbatim. The resulting candidate changes 214 paths from main (178 prepared paths plus 36 actual dependency changes).

Verification so far: Reports contract 86/86; focused Reports tests 447 pass/two skip across 30 files; root `npx tsc --noEmit` pass; app TypeScript matches all 79 baseline diagnostics by identity/multiplicity. Shell/Node/Python syntax, fixture construction for policy/booking/appointments and complete v3 setup/rollback/retained-package variants, and all pinned differential reference source/generated hashes pass. No new native database execution or performance claim. Existing native 17/17 and corrected C/D regression evidence retain their original limits. Full frontend comparison completed: exact-main baseline 6,831 passing tests; candidate 6,958 passing tests, same one failed assertion and same nine failed suite files (eight missing-supabaseUrl collections plus recordingRetentionVoicemail). No new test/suite failures and zero unhandled runtime errors, verified with the existing comparator and explicit runtime reporter. Baseline was reused from the saved exact-main run with identical dependency lockfile; candidate was freshly rerun. Root TypeScript passes; app TypeScript remains exactly 79 diagnostic identities. Focused Reports 447 pass/two skips; contract 86/86. Previous build and 504 visual checks remain valid for unchanged application/dependency bytes. Full-suite initial attempt was stopped because the runtime-report output variable was omitted, then rerun with it configured; no test was skipped or weakened. Fixture-construction probe corrected an invalid requested stage name to the runner's existing payloads/correction-payloads stages. Historical reference blobs were retrieved from the exact pinned commit and verified; no source replacement or reference-pin relaxation.

Exact continuation scope is the 36 actual dependency changes plus six existing documentation updates; total frontend PR 214 paths. All functional application bytes remain unchanged from the approved prepared commit. Publication/hosted verification may proceed under Chris's current instruction; final merge, production rebuilds and live frontend release are not authorized by this preparation. No production SQL, customer data changes, role simulation, setting changes or manual dispatch occurred.

Evidence: local `checks/summary.json`, contract/Reports/full-suite logs and explicit runtime evidence; the saved original frontend preparation evidence remains the visual/CSV source. Native functional/scale CI will be reported only after actual hosted completion; no fresh native/performance claim here.

Preservation checks: all 170 approved application/support paths still match the frozen candidate; all deployed migrations, release runner/workflow, corrected C/D guard tests, TwilioContext and main's Sheets readiness fix match main. Map checksum remains `8743d131d5dc8833a9459fd2ab89a112eeeee346e957d628dd22719b5d858ea2`. Prior 504 browser checks, 44 screenshots and 37 CSV comparisons cover unchanged UI bytes; not represented as a new live-user test. Backend A–D completion, owner visual/CSV/map acceptance, bounded B6 deferral, confirmed Pacific zones and reviewer waiver remain recorded and are not reopened.

Publication will trigger 12 matching PR workflows: onboarding emails, hierarchy stabilization, SMS consent, lead conversion preservation, Reports backend, Reports frontend, Reporting integrity, policy commission tracking, Dialer DNC, A2P registration, policy sale recording and UV profile sync. Reports backend adds its existing isolated native functional/browser and differential jobs; optional performance, long journey cases and release rehearsal remain manual only. Supabase may attempt preview migrations; both Vercel projects may build previews. No integration settings change, manual dispatch or production stage is included. Final frontend merge and production release still require Chris's separate approval of the verified candidate.

---

## November 8, 2026 Pacific — Approved frontend preparation (local, not published)

Branch `prep/reports-frontend-20261108`, base main `3865fa9783c3743354d750fbfe36ed8f87c2c193`. Root implementation_plan.md records the approved exact 178-path allowlist before editing: 163 src paths plus seven support paths from frozen `38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c`, and eight documentation reconciliations. Frozen application/support bytes are preserved. Main's Sheets readiness fix and all backend/runner/workflow bytes are preserved; no wholesale integration merge. FullScreenContactView adds only the existing single onPolicyRecordChanged prop; DialerPage forwards only type and sourceCallId; TwilioContext remains unchanged.

Backend A–D completed in separately approved stages: …42 42506389088; pause 42508342475; …43 42508670513; enable …44 42509009748; read-back 42545080496; history 42547496397. Independent verification: 376 history rows/head …44, all 20 Reports records, contract 3.3.0, exact five D statement digests; prior history and function definitions/ACLs unchanged. These actions are recorded, not replayed here.

Chris accepted the 44 screenshots, 37 CSVs and map provenance in Reports_V2_D_Correction_Review_2026-11-08.zip and explicitly accepted launch with both B6 events' premium and Sold Date discrepancies unchanged/unclassified until business evidence is available. No clean manifest claim; no corrections or classification. Human independent reviewer is waived, not signed off. The three previously confirmed Pacific zones remain valid. Existing three 366-day performance exceptions remain accepted exceptions, not passes.

Local verification complete, with a release blocker retained. Root npx tsc --noEmit and npm run build pass. App typecheck has the same 79 diagnostics by file/code/message/multiplicity as exact main. Whole-repository lint retains the same 11 error identities; 142 baseline warnings become 145, adding only three frozen react-refresh/only-export-components warnings in ReportBreakdowns.tsx, SectionRenderer.tsx and reportSectionMap.tsx. No application bytes were changed to remove these warnings.

Full Vitest comparison: main 6,831 passed / 1 failed / 5 skipped (6,837 tests); candidate 6,872 passed / 1 failed / 8 skipped (6,881 tests). The failing recordingRetentionVoicemail test and eight missing-supabaseUrl collection failures are identical baseline failures. Both runs report zero unhandled runtime errors. One additional candidate collection failure, reportsV3Contracts.test.ts, is caused by the absent supabase/tests/reports_v3_performance.sql and its existing frozen fixture/runner/CI dependencies. The existing verification script correctly stops at this new suite failure. Targeted imported tests: 419 passed, 4 skipped, zero failed assertions, with that same collection blocker. No test was weakened or skipped to obtain a pass.

Fresh isolated browser evidence: 474/474 primary and 30/30 supplementary checks pass, with 44 actual screenshots and 37 actual CSV exports. All 37 CSVs match the retained 3.3.0 review archive excluding generation timestamp rows. The frozen UI ran against retained native A+B+C+D synthetic payloads; no fresh production read or database execution occurred. Mobile export controls were visually inspected. Map module SHA-256 remains 8743d131d5dc8833a9459fd2ab89a112eeeee346e957d628dd22719b5d858ea2. The sole diff-check warning is the frozen reportsDialerIntelligence.test.tsx trailing blank line at EOF, retained to preserve exact bytes.

Scope audit: all 170 source/support paths match the frozen candidate exactly (including intended removals); all 178 changed paths are approved. Backend SQL, release runner, workflows, TwilioContext and main's newer Sheets test remain unchanged. Current remote main rechecked at 3865fa9783c3743354d750fbfe36ed8f87c2c193.

Next approval: the exact 36-file local test/harness/CI scope amendment listed in root implementation_plan.md. None of those paths is modified here. This is required by the explicit file allowlist, not a new architecture project. Publication effects, exact-head PR/hosted execution approval and final frontend release remain later gates. No push, PR, hosted preview, dispatch, backend mutation, settings change, merge or deployment occurred. Frontend availability is not claimed. Actual fresh review evidence is packaged as Reports_V2_Frontend_Preparation_2026-11-09.zip.

---

# November 8, 2026 Pacific — Package D NULL guards corrected; publication pending

Chris approved the targeted correction, regression tests, checksums and plan/work-log updates. This record supersedes the historical Package C preparation status below. Main is `401f758d884677eae0e85ac1acb22adabb393ccd`; local preparation branch is `fix/reports-d-null-guards-20261108`. Open #486/#514 retain heads `2de28c320547983f68bed5f77d8ec9684ea3643d` / `3c54f4d13de7b6901db33c111d94fb70d4f42f6a`; shared documentation still needs coordination.

Unapplied …42 now rejects buyer membership and root-none supersession unless their predicates are explicitly TRUE. Missing buyer/assignee/seller identities cannot supply authority. Organization, appointment visibility, ordinary policy authority, admin correction, append-only history and idempotency remain unchanged. No frontend, schema shape, RLS policy, other migration, workflow, deployment setting or integration setting changed.

| Revised input | Value |
| --- | --- |
| …42 source bytes | 19,047 |
| …42 SHA-256 | `dea3c83cf242304fb1559050bbbb2c0b997a8cea2f65a94532cab406957bc296` |
| CLI 2.121.0 statement count | 34 |
| Recorded statement SHA-256 | `4b71a769746331ee19f2e0c3b6f98a27c2c00077a39091e8e4688f32e282a2e8` |

Original candidate `38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c` is preserved. Exactly three of its 36 release files now differ: previously approved …31, this …42 and scripts/reports_release.py. Relative to current main, only …42 and its two runner pins change among release files. All 34 source pins pass. Report closure, enable/read-back and rollback bytes are unchanged; the two writer helpers are outside the report-definition closure.

## Prior separately approved production state

Package C is installed/enabled and recorded through …33 (history run 42478370891). Package D …40 succeeded in run 42494385667; category-baseline run 42494725586 classified/audited exactly 36 locked defaults (sales 6, follow_up 6, recruiting 6, review 12, other 6); …41 succeeded in run 42495034013. These actions are historical, not replayed by this correction.

Fresh read-only metadata check on November 8 confirms 371 history rows/head …33, category-event and occurrence tables present, and the …42 attribution table/link RPC absent. D history waits for the rest of the package. No production mutation, role simulation, workflow dispatch, PR, merge, push or deployment occurred during this work. Full Reports frontend remains unreleased.

## Verification and limits

Native PostgreSQL 17.6 with TLS and Supabase CLI 2.121.0; synthetic loopback only, no production credentials. Corrected authenticated API tests and canonical attribution suite pass. Each original predicate, restored independently in a temporary test copy, fails the corresponding regression. Full protected-runner rehearsal passes 17/17; the complete non-performance v3 fixture passes including security, contract, refusal, recovery and appointment facts. Canonical E12 concurrency passes: simultaneous first links serialize and only one persists.

Root `npx tsc --noEmit`, build, bash syntax and whitespace checks pass. Existing Reports library tests: 187 pass, one skipped, zero failures. Fresh main/candidate app TypeScript results match exactly at 79 errors; lint matches by diagnostic identity at 11 errors/142 warnings. No all-green app-wide claim. Performance was not rerun; the three accepted historical 366-day exceptions remain. New regression runner requires the frozen harness checkout supplied by HARNESS_ROOT; backend-only main does not contain that entire fixture. No workflow file was changed and this new runner is not automatically wired into hosted CI.

## Remaining gates and next approval

Approve publication of this exact 11-file correction branch and opening a draft PR, including automatic hosted effects. Current path filters match four Actions workflows: UV profile sync verification, Reporting integrity, SMS consent integration and Dialer DNC integrity. Both linked Vercel projects may build previews. Supabase's GitHub integration may attempt an isolated preview and execute its migrations; a prior branch-limit failure is not a guarantee it will skip. Existing branches were inspected read-only; no integration settings were changed. Production release workflow is dispatch-only and will not run from the PR.

Publication approval does not authorize merge, production deployment, …42 execution or later stages. After hosted checks, the exact merge/rebuild decision and each production stage remain separate. Proposed future order: corrected …42 → disable-v3 → …43 → enable …44 → read-back → record-history. Never run the original frozen …42. B6 disposition, owner visual/CSV/map acceptance and frontend release remain pending. Independent human review is waived by Chris, not signed off; automated tests are not independent approval.

## Time-zone worklist (read-only recheck)

| Organization | Active users | Saved and resolved zone | Confirmation evidence |
| --- | ---: | --- | --- |
| 525671d1-f6cd-4289-b415-1ec2f06b2472 | 1 | America/Los_Angeles | Chris's “Use pacific for those 3”; saved value and resolver verified |
| b90dccbf-f320-4b62-ade3-38b793f666cb | 1 | America/Los_Angeles | Same owner confirmation and read-only verification |
| cda13104-307c-4d2c-b804-d623d0e34886 | 1 | America/Los_Angeles | Same owner confirmation and read-only verification |

No time-zone mutation in this work. This prerequisite is resolved for these three organizations; it does not imply the unreleased frontend is available.

B6 is not rerun: approved original SHA-256 `181e8b55e38f787fe3cf567d3b311ee3f56b92901ff9579e0668ed7beb597729` passed 55 isolated checks then unchanged home-organization-only read-only execution. Prior redacted result: 44 sales, **2 distinct discrepant events**, each with separate premium and Sold Date observations. No classification, correction, premium amounts or policy records are disclosed or authorized.

Existing contract-3.3.0 review ZIP contains 44 screenshots and 37 actual CSV exports, including opened controls and agency/team/personal variants. These are synthetic pre-release evidence; owner visual/CSV/map-provenance acceptance remains pending. This correction changes no application code or valid-fixture presentation. Attach that actual archive with the new source diff/native logs; temporary VM paths are not the delivery.

## Exact changed files

- `implementation_plan.md`
- `WORK_LOG.md`
- `docs/plans/2026-10-31-reports-v2/implementation_plan.md`
- `docs/plans/2026-10-31-reports-v2/release-proposal.md`
- `docs/plans/2026-10-31-reports-v2/production-release.md`
- `docs/plans/2026-10-31-reports-v2/verification.md`
- `docs/plans/2026-10-31-reports-v2/context-snapshot.md`
- `supabase/migrations/20261105120042_policy_appointment_attributions.sql`
- `scripts/reports_release.py`
- `supabase/tests/policy_appointment_attributions.sql`
- `scripts/test_policy_appointment_null_guards.sh`

## Native execution evidence

Sandbox `sbx_S55Ol1eWBAabQHqCJtUedZdXr5Gs` was stopped after retrieval. Commands: guards `cmd_f3dc6910272d457ab45af170b85e` (exit 0, 79.658 s); release `cmd_b731ac084e824510bd53f0c822be` (exit 0, 36.509 s); full v3 `cmd_b10ddc4681304b7d80d5e4ffa2ea` (exit 0, 26.910 s); E12 `cmd_485a7f73e60449fb9316b9233f4f` (exit 0). PostgreSQL source checksum and pinned CLI archive checksum passed.

Setup corrections: restored the frozen dialer preimage SQL omitted from the initial transfer; corrected the negative-control runner’s expected assertion-label ordering; used the canonical `reporting_` database prefix required by the E12 guard. No SQL assertion was weakened.

### guards.log

SHA-256 `c222e04ff28b208c5a100d0ce06db2f2c729d1db303510f3532ef68c7fa65ec8`

```text
 PASS D-NULL-IDENTITY and D-NULL-AUTHORITY authenticated API regressions
PASS corrected migration: canonical attribution suite and authenticated NULL regressions
psql:/tmp/tmp.14j4uvBtiG/fixture.sql:45342: ERROR:  D-NULL-IDENTITY missing buyer is rejected FAIL: got [<NULL>] want [different_contact]
PASS negative control: original-contact independently reproduces its regression
psql:/tmp/tmp.14j4uvBtiG/fixture.sql:45388: ERROR:  D-NULL-AUTHORITY missing start assignee rejects non-seller FAIL: got [<NULL>] want [already_linked]
PASS negative control: original-authority independently reproduces its regression
```

### release.log

SHA-256 `3955075c9f0097beae3e861a014bb951af29cb60c09596ada32961c2edd39294`

```text
PASS TEST: local PostgreSQL 17.6 with TLS and no production connection
PASS TEST: only manual dispatches on main; protected environment; only two scoped secrets; one choice per stage
PASS TEST: required reviewer is cgarness; admin bypass and other refs forbidden
PASS TEST: 34 checksum-pinned files (every migration, release enable, ops script and rollback) and the pinned CLI
PASS TEST: a different Supabase CLI version is refused (version drift)
PASS TEST: file tampering, duplicate and pending copies fail before any connection
PASS TEST: wrong confirmation, unknown stage and non-main branch refused
PASS TEST: the verified production history baseline (356 rows, head 20261105051037) and all 20 CLI digests are pinned
PASS TEST: the pinned production baseline (356 rows, head 20261105051037) classifies as pre-PKG-A; any other count refuses
PASS TEST: check (preflight) is read-only; out-of-order, read-back and record-history refuse before PKG-A
PASS TEST: PKG-A: six transactional files, the concurrent index, the enable, read-back and 8 history rows
PASS TEST: PKG-B: disable-v3, …20, …21, the PKG-B enable, read-back, history
PASS TEST: PKG-C: …30, …31, disable-v3, …32, the PKG-C enable, read-back, history
PASS TEST: PKG-D: …40, the 36-row baseline, …41, …42, disable-v3, …43, the PKG-D enable, read-back, 20 history rows; calls, sales and clients unchanged
PASS TEST: disable-all leaves class W on; re-enable restores the PKG-D pins and passes read-back
PASS TEST: recovery: D, C (…32, …31) rolled back in reverse order with history reverted; …30 has no rollback, so PKG-B cannot roll back past it; re-enable at the PKG-B pins passes read-back
PASS TEST: history drift stops every further stage
ALL PASSED: 17 release rehearsal checks
```

### race.log

SHA-256 `3b589d9330d8bc254a564d2025476ecee91b30adf4e196a89e6550bd4e5c767e`

```text
PASS E12: concurrent first links serialize on the policy lock; one linked, the other already_linked
```

Full non-performance log SHA-256 `fc124ea8a15372592d0d8a1289f2a21a6dff2228f7ae7f82859cc76888148d90`; full log is attached in the review archive.

---

# November 7, 2026 Pacific — C-NULL-IDENTITY correction verification

The scoped correction is complete in the candidate; it is not deployed. Chris instructed proceeding after the blocker was disclosed. The exact 14 paths were listed in root implementation_plan.md before editing. Main remains `e2739c26e21f8e159b783ccf59046fed55560b16`; PR #486/#514 heads remain `2de28c320547983f68bed5f77d8ec9684ea3643d` / `3c54f4d13de7b6901db33c111d94fb70d4f42f6a`. This current record supersedes the historical documentation-only status below.

## Change and regression proof

The entire production logic change is `IF NOT (identity predicate)` → `IF (identity predicate) IS NOT TRUE` in unapplied …31. Missing identity is rejected rather than falling through. Existing organization, actor, age, sale operation, exception, retry and receipt checks are unchanged. The authenticated regression covers seven rejection/retry cases and four positive paths: direct client contact, original lead as contact, lead pointer, and same-org campaign membership. It checks persisted sales, no false failure records and one-sale replay. Conversion is exercised through the real companion API. Membership fixtures use retained legacy lineage because the canonical converter deletes its source lead and retains the lead's name; converted clients are addressed by their returned client_id.

The original frozen SQL was reconstructed in an isolated test copy and verified against its exact SHA-256 `35587f385eea207ec2eea9ae84421d1413ebccf1759ac1609bd490dceedc2016`. It fails the new authenticated regression with `FAIL: C-NULL-IDENTITY rejects manual_null`. The corrected SQL passes the entire commission harness, canonical L1–L16 coverage, the six multi-session failure-boundary checks, existing handoff/tracking regressions and rollback. The failure-boundary file remains byte-identical to the frozen candidate. The runner adds only its canonical Package C section; four CI path filters ensure the new migration/tests invoke that harness.

## Native environment and results

Synthetic loopback databases only, native PostgreSQL **17.6**, TLS enabled, Supabase CLI **2.121.0**, no production credentials. PostgreSQL source checksum and pinned CLI archive checksum passed; CLI archive SHA-256 is `4b481189efbdc57cf2d37bdee5f1a0d29574314398564b32a6dfb76c0fcf275f`. Native sandbox `sbx_FoEg6W78MEwylZKOgAAp9eZRci1w` is test infrastructure, not a production deployment.

| Check | Result |
| --- | --- |
| Full commission database harness | PASS, exit 0, 35.564 s; command `cmd_9343373aec884dffb22124b755c0` |
| New NULL/mismatch/positive wrapper regression | PASS; sales persist, rejected replay remains one sale |
| Lock/recover/cancel/replay/double/assert boundaries | 6/6 PASS; synthetic lock case 122 ms |
| Original-SQL negative control | Expected regression failure; verifier exit 0; command `cmd_9ce764e6d8c44854a312af3dc6f7` |
| Full protected release-runner rehearsal | 17/17 PASS, exit 0, 32.645 s; command `cmd_32f2c4dfe2844c1599c4561959e8` |
| Source pins / CLI history | 34/34 source pins pass; …31 recorded as 21 statements with new exact digest |
| Frozen release-file comparison | Exactly 2/36 differ: …31 and scripts/reports_release.py |
| TypeScript / syntax / whitespace | `npx tsc --noEmit`, bash/node syntax checks and `git diff --check` pass |

…31 now has 18,167 bytes, SHA-256 `4bfb733eaefd6bffffd1c6c759e592611eabe78c0157146d9774633f5cfda6d9`. A fresh isolated CLI `migration repair` reproduced statement SHA-256 `6cc671fa5fda16dec6ecaaf69a99642f13231a8ae8e10f3eb4d972d154a4d6a0`. The full release rehearsal independently reproduced it through the runner. Other migration/history/closure pins remain unchanged; capture is outside the report-definition closure.

Rehearsal inputs use the canonical frozen source plus the four previously approved Havana fixture corrections, with this corrected migration/runner/test overlay. They do not replace the backend-only main fixture set. Early setup attempts were stopped by missing archive/fixture dependencies and an uninstalled ltree extension; two new fixture mistakes (deleted lead and converted-client name) were corrected before the successful run. No production schema workaround or relaxed assertion was used. Native commission proof did not enable optional PostgREST integration or performance measurements; hosted CI runs those existing branches. Owner UI/CSV/map review, production smoke tests and independent human sign-off are not inferred from these checks. The human reviewer requirement remains waived, not signed off.

## Retained native output

Log SHA-256: commission-fixed `1d1b9ef3bfa49ea8bd21b98ce5302a54a458db978043b1fd138d672813474100`; commission-original `07de098509709f0f371a90cb663e7fea6ec090b0beb7ddd7adbcd2b37ef5de19`; release-fixed `3955075c9f0097beae3e861a014bb951af29cb60c09596ada32961c2edd39294`.

### commission-fixed.log

```text
PostgreSQL: 17.6
PASS migration guards and existing-object inventory (175 objects unchanged)
 PASS policy commission security
 PASS policy commission handoff
 PASS policy commission tracking
PASS expected windows guards and inventory (8 bodies replaced, 4 writer-only helpers, 175 other objects unchanged)
 PASS policy commission expected windows
PASS commissions center guards and inventory (5 reads, 2 indexes, 175 existing objects unchanged)
 PASS commissions center scenario built
 PASS overview cards, timeline, review and setup reconcile
 PASS statuses, excess, voids, holds, superseded, month timing, unknown dates, non-monthly and zero rates
 PASS card drill-downs reconcile across pagination; filters
 PASS policies list, setup state and completeness
 PASS drawer parity
 PASS reassignment: seller keeps financial history, contact restricted, assignee sees nothing
 PASS same-org admin and team leader, cross-org and Agency Group peer see only their own
 PASS permissions, sign-in, time zone and validation
 PASS commissions center reads
PASS commissions insights guards and inventory (6 functions, goals table, 179 existing objects unchanged)
 PASS commissions insights scenario built
 PASS breakdown cohort, carriers and products
 PASS drill-downs reconcile with every bar and slice; filters compose; released lists unchanged
 PASS comparison windows (month to date, completed months, custom, future, leap years, zero baseline)
 PASS Months 10–12
 PASS monthly goals
 PASS permissions, sign-in, time zone and validation
 PASS commissions insights
 PASS commissions center scenario built
 PASS overview cards, timeline, review and setup reconcile
 PASS statuses, excess, voids, holds, superseded, month timing, unknown dates, non-monthly and zero rates
 PASS card drill-downs reconcile across pagination; filters
 PASS policies list, setup state and completeness
 PASS drawer parity
 PASS reassignment: seller keeps financial history, contact restricted, assignee sees nothing
 PASS same-org admin and team leader, cross-org and Agency Group peer see only their own
 PASS permissions, sign-in, time zone and validation
 PASS commissions center reads
PASS independent-session races and lock contention
PASS existing sale recording, identity, performance, Sold Date and repair suites with both migrations applied
 PASS policy commission security
PASS non-destructive rollback, refusal, replay refusal and reapply
 PASS policy commission expected windows
PASS expected windows rollback: refusal, record-keeping rollback, exact restore (514 commission catalog lines), replay refusal and reapply
PASS commissions center rollback: exact restore, records kept, replay refusal and reapply
PASS commissions insights rollback: goal refusal, exact restore, records kept, replay refusal and reapply
PASS producing-call capture guards: order, replay, handoff preimage drift, dependency column
 PASS L1-L3, L8, L10 record capture, retry, replay, unchanged handoff and PT409 passthrough
 PASS L4, L14 validation rejections and tracked inbound
 PASS L5 conversion capture
 PASS L6, L9 immutability and privileges
 PASS L7, L15, L16 failure record, status read and retry
 PASS L12 lead lineage guard
 PASS L13 reversal
 PASS C-NULL-IDENTITY authenticated record/conversion rejection, valid lineage, sale persistence and retry
 PASS policy sale call links
PASS T-LOCK sale saved, link failure recorded as 55P03 in 122 ms
PASS T-RECOVER open_failure read in a new session, then linked by the retry RPC
PASS T-CANCEL a cancelled call leaves no sale, link or failure row
PASS T-REPLAY the same request afterwards saves the sale and its link
PASS T-DOUBLE one sale and one link for a request sent twice
PASS T-ASSERT an assertion failure is never caught: no sale, link or failure row
 PASS policy commission handoff
 PASS policy commission tracking
PASS the existing handoff and tracking suites with the producing-call capture installed
PASS producing-call capture rollback (L11): disabled capture, sales unaffected, links kept
PASS policy commission tracking database proofs
```

### commission-original.log

```text
PostgreSQL: 17.6
PASS producing-call capture guards: order, replay, handoff preimage drift, dependency column
psql:/vercel/negative/supabase/tests/policy_sale_call_links.sql:252: ERROR:  FAIL: C-NULL-IDENTITY rejects manual_null
CONTEXT:  PL/pgSQL function test_assert(boolean,text) line 2 at RAISE
 PASS L1-L3, L8, L10 record capture, retry, replay, unchanged handoff and PT409 passthrough
 PASS L4, L14 validation rejections and tracked inbound
 PASS L5 conversion capture
 PASS L6, L9 immutability and privileges
 PASS L7, L15, L16 failure record, status read and retry
 PASS L12 lead lineage guard
 PASS L13 reversal
```

### release-fixed.log

```text
PASS TEST: local PostgreSQL 17.6 with TLS and no production connection
PASS TEST: only manual dispatches on main; protected environment; only two scoped secrets; one choice per stage
PASS TEST: required reviewer is cgarness; admin bypass and other refs forbidden
PASS TEST: 34 checksum-pinned files (every migration, release enable, ops script and rollback) and the pinned CLI
PASS TEST: a different Supabase CLI version is refused (version drift)
PASS TEST: file tampering, duplicate and pending copies fail before any connection
PASS TEST: wrong confirmation, unknown stage and non-main branch refused
PASS TEST: the verified production history baseline (356 rows, head 20261105051037) and all 20 CLI digests are pinned
PASS TEST: the pinned production baseline (356 rows, head 20261105051037) classifies as pre-PKG-A; any other count refuses
PASS TEST: check (preflight) is read-only; out-of-order, read-back and record-history refuse before PKG-A
PASS TEST: PKG-A: six transactional files, the concurrent index, the enable, read-back and 8 history rows
PASS TEST: PKG-B: disable-v3, …20, …21, the PKG-B enable, read-back, history
PASS TEST: PKG-C: …30, …31, disable-v3, …32, the PKG-C enable, read-back, history
PASS TEST: PKG-D: …40, the 36-row baseline, …41, …42, disable-v3, …43, the PKG-D enable, read-back, 20 history rows; calls, sales and clients unchanged
PASS TEST: disable-all leaves class W on; re-enable restores the PKG-D pins and passes read-back
PASS TEST: recovery: D, C (…32, …31) rolled back in reverse order with history reverted; …30 has no rollback, so PKG-B cannot roll back past it; re-enable at the PKG-B pins passes read-back
PASS TEST: history drift stops every further stage
ALL PASSED: 17 release rehearsal checks
```

---

## Historical preflight and preparation (superseded where noted above)

# November 7, 2026 Pacific — Package C read-only preflight and Package B closeout

Base main `e2739c26e21f8e159b783ccf59046fed55560b16`; no drift. Production history 367/head …22, contract 3.1.0, sale_call_links/appointment_evidence not_installed. Link/failure tables and all seven new Package C functions are absent. Advisors 279 security/463 performance/0 health.

| Dependency | Definition MD5 | Body MD5 |
| --- | --- | --- |
| record_client_policy_handoff(uuid,uuid,jsonb,boolean,jsonb) | b02760be55132f0be3fa91b04955e839 | d39e03a7dd2cf122a68dc0fefcbfb44a |
| convert_lead_to_client_with_sales_handoff(uuid,uuid,uuid,jsonb,uuid,jsonb) | f331226b398134ea485d5543472d5ccf | 4d6803ff7d94b7735e3f1b3baf18456c |
| private.report_v3_sale_call_links(uuid,timestamptz) | 769d31d180bf61264b0609e87b3ea24f | — |
| private.report_v3_basis_flags() | 67c6a60a1004b4596a4a61487a41d17b | — |

Both handoffs are postgres-owned; all four preimages match frozen SQL. Matching pins do not establish safety; the blocker below overrides release readiness.

## Release blocker C-NULL-IDENTITY — confirmed by read-only predicate check

Frozen `20261105120031_policy_sale_call_link_capture.sql`, private.capture_policy_sale_call_link, uses `IF NOT (ca.contact_id = cl.id OR (cl.lead_id IS NOT NULL AND (...)))`. SQL NULL is not TRUE: a manual client with a call having NULL contact_id, or a converted client with unrelated contact_id and NULL calls.lead_id, can produce NULL and skip the rejection branch. A SELECT over synthetic VALUES confirmed both cases: identity_predicate=NULL, rejection_branch_taken=false; the positive matching control returned TRUE. No production rows were inserted or role-simulated.

The link-table trigger checks same-org sale/client and call/direction, but does not independently establish the call's buyer identity. Other checks (same organization, actor, call age, sale operation) still apply; this is a within-organization attribution integrity gap, not demonstrated cross-tenant access. Source control-flow review identifies a reachable missing-identity case; no complete wrapper exploit or synthetic sale was executed. The capture function is absent in production.

**Do not execute Package C as frozen.** A separately approved correction should make rejection fail closed when the identity predicate is not TRUE, add NULL/mismatch/matching regression cases in the canonical candidate test harness, and rerun the release/security/concurrency rehearsal. Review and update the frozen source/statement digests only under a new exact-file approval; never silently change the old candidate or pins. The current eight-file approval authorizes documentation only. Identify the canonical candidate test/harness paths and exact expanded file list before requesting correction approval. No patch or test file is included here.

## Lineage and frontend review

Live catalog text search for client INSERT/UPDATE with lead_id identified convert_lead_to_client_atomic and create_client_with_sale. Full returned bodies were reviewed: the converter establishes lead_id on INSERT and preserves call telemetry during contact reassignment; the manual writer rejects caller lead_id and uses an explicit column list without it. No direct clients.lead_id UPDATE writer was found. This is a catalog/static audit, not proof against arbitrary privileged/dynamic SQL.

Repository direct-client access search covered src and supabase/functions. clientToRow (supabase-clients.ts) omits lead_id; ordinary update/assignment paths do not set it; conversion passes p_lead_id to the canonical RPC. SMS lineage and contact-message lookups read it. Preserve this mapping and all existing auth/org checks. The proposed guard restricts UPDATE outside postgres, not INSERT or privileged postgres.

Current policySaleRecording uses the existing Phase 2A companions, with no _v2 routing. DialerPage ConvertLeadModal is currently near line 4546, not the historical plan's 4691: future patches must use current JSX context. It does not pass sourceCallId. FloatingDialer modal callbacks retain call-visit/config-version checks. TwilioContext retains isDialingRef and current-attempt guards, creates the call row before twilioMakeCall, and delegates to browser device.connect in src/lib/twilio-voice.ts. No telephony source changed. Future tracked-inbound selection must use server af_call_row_id, clear memory on sign-out/org change, and remain disabled under View As. Existing frozen retry and sale receipt semantics stay intact.

Canonical Package C tests/harness are not present on this backend-only main checkout (policy_sale_call_links.sql and reports_v3_fixture.py are absent). Locate them in the frozen candidate/integration source before any correction approval; do not invent a new production harness or claim it ran here. Prior native 17/17 and contract/concurrency evidence is retained as historical evidence and does not cover the newly identified NULL case.

## Local verification

PASS: root `npx tsc --noEmit`; `git diff --check`; exactly the eight authorized documentation paths; all 34 SQL size/SHA-256 pins; all 36 SQL/runner/workflow files byte-identical to frozen candidate 38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c. No new source tests were written or claimed for this documentation-only change. The newly discovered NULL case remains a release blocker despite historical suite success.

---

## Historical verification

# Reports V2 — Package B preparation verification

November 7, 2026 Pacific. Scope: technical source inspection, read-only production catalog/preimage checks and local documentation verification. No production writes, impersonation, workflow dispatch or independent human sign-off in this preparation.

## Fresh production preflight

| Check | Observed result |
|---|---|
| History | 364 rows; latest 20261105120017; all eight Package A rows recorded |
| Basis | contract 3.0.0; corrections/sale_call_links/appointment_evidence not_installed |
| V3 readers | Nine callable by authenticated |
| performance_sale_monthly function definition MD5 | 51e06b46a13c3a8eec4d672bec158376 — expected |
| performance_sale_monthly body MD5 | deb0d3330a432cd4324ea422856d67a0 — expected |
| performance_monthly body MD5 | 7e7063317a34f37d90faf14914b98827 — expected |
| report_v3_sale_premium definition MD5 | 37800ccc8ada2fae26b86dd5a610eb09 — expected |
| report_v3_basis_flags definition MD5 | e446177c344762bec8caf7d5e9321d9b — expected |
| Package B objects | Ledger, two RPCs, effective/original readers and book parser absent |
| Advisors | Security 276; performance 463; health 0 |

Only aggregate/catalog output was retrieved. Live campaign_actor definition confirms auth.uid is required, JWT organization must equal the database profile organization, profile must be Active, and role/is_super come from the database. No user_metadata authorization or caller-selected organization was introduced.

## Frozen SQL security and write review

Reviewed ...20 correction ledger/writer/history reader, ...21 basis replacement/grants, ...22 report enable, and ...20 rollback. Source bodies stay frozen.

| Area | Observed implementation and release implication |
|---|---|
| Tenant authorization | Writer resolves campaign_actor, requires Admin/Super Admin/is_super, selects sale and client in actor home organization; no organization input. Existing actor helper independently checked live. |
| Ledger isolation | Private schema, organization_id required, RLS enabled; no policies or client table grants. PUBLIC/anon/authenticated/service_role table privileges revoked. SECURITY DEFINER RPCs deliberately mediate access; RLS alone is not their authorization boundary. |
| Audit | Append-only revision chain, unique org/request and org/win/revision, predecessor and sale identity checks; UPDATE/DELETE/TRUNCATE refused by three triggers. No FK to wins so a ticketed reversal retains inert audit rows. |
| RPC exposure | ...20 creates both RPCs sealed; ...21 grants authenticated only and checks effective ACLs. Service role, anon and PUBLIC remain denied. Writer access becomes active before frontend release, so later ...21 approval must expressly include it. |
| History scope | Admin home org, original seller, or Team Leader ancestor of seller. Book values/request IDs/can_correct reserved for Admin. Correction notes/history are intentionally visible to the authorized seller/team reader. |
| Concurrency and idempotency | Organization-scoped request and policy transaction advisory locks; client FOR UPDATE; expected revision/effective amount/raw book value; same actor + identical payload returns prior result; conflicting replay gives PT409. |
| Book writes | keep_current leaves book untouched. match_sale requires a present matching policy and non-diverged book. Primary known-zero write refused; additional numeric zero permitted. Update targets the already locked home-org client. |
| Immutable sale/commissions | No writes to wins or saved commission tables; optional book update and ledger insert share one transaction. Corrected value credits original seller/Sold Date through shared calculation. |
| Input constraints | Required IDs/revision/reason/note/book mode; bounded two-decimal amount or unknown; same-value allowed only to freeze legacy fallback. Server errors distinguish denied, invalid, missing and stale/conflict. |
| Release value identity | ...20 and ...21 collect preimages and compare every sale's values before commit; attributes preserved. Empty ledger means no intentional AP change at installation. |
| Rollback | Always seals application RPCs; restores old functions only with empty ledger and exact compatible postimages. Never drops ledger/guards. If corrections exist, readers retain corrected values. A re-forward is a new reviewed migration. |

No new blocking defect was identified in this bounded source/preimage review. This is not fresh production authenticated-write testing or a claim that all repository security findings are resolved. The frozen native evidence below supplies the synthetic write/concurrency tests; production mutations remain gated.

## Conflicting work and evidence provenance

Current main is 15d967320af7a0bd9774e09bc57e0dd31f97900c. PR #486 is open at 2de28c320547983f68bed5f77d8ec9684ea3643d. Its 23-file diff does not replace or pin performance_sale_monthly; the older direct-function-overlap statement is superseded. It modifies commission validation/grid helpers and has its own historical premium derivation. Keep its backfill and exact financial approvals separate; do not redefine commission basis through this release. PR #514 at 3c54f4d13de7b6901db33c111d94fb70d4f42f6a overlaps shared docs only and was not incorporated.

Prior assembled native verification is retained, not rerun or relabelled as new: PostgreSQL 17.6 + TLS + CLI 2.121.0, release harness 17/17, non-performance security/contract/seal/index suites, premium correction concurrency in both orders, appointment-link race. Source: evidence/release-readiness-2026-11-06.md. Log hashes: release-rehearsal.log 3955075c9f0097beae3e861a014bb951af29cb60c09596ada32961c2edd39294; v3-suites.log c5c560008e702b6622aa2c250b4fc013d0767b53023714ba64fe67c3f4cb122d. Package A production verification and its conditional-scope limitation are recorded in production-release.md.

## Local verification

Passed: root `npx tsc --noEmit` (exit 0); `git diff --check`; exact eight-path allowlist; all 34 pinned SQL byte lengths/SHA-256 hashes and all 36 release files compared byte-for-byte with frozen candidate. The only command warning was npm's existing http-proxy environment-config deprecation; no TypeScript diagnostic. No new runtime tests are necessary for documentation-only changes; prior native/runtime evidence retains its stated limits. Hosted checks are not claimed before publication.

Existing advisors are tracked separately. Relevant remediation references: [authenticated SECURITY DEFINER exposure](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [public RLS disabled](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public). No unrelated hardening is authorized here.

Current GitHub push/pull_request workflow path filters have no match for these eight documentation files. This does not guarantee that Vercel or Supabase integrations will skip their own checks. Publication must observe their results without altering settings.
