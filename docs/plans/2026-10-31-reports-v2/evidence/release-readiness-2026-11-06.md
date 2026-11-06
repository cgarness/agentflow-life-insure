## Remaining Havana correction — November 6 approved follow-up

This supersedes earlier 44/46-path scope snapshots: the PR now includes 48 changed paths. The five paths in this follow-up are `supabase/tests/reports_integrity.sql`, `supabase/tests/performance_sold_date.sql`, `implementation_plan.md`, `WORK_LOG.md` and this record. The two tests use the historical November 2, 2025 Havana transition with unchanged counts and boundary/weekday expectations. T-2 sessions and frozen release files are unchanged. No further test still assumes a 2026 Havana fall-back after the repository search.

Root TypeScript/build pass; configured selected tests 974 pass/1 skip. App TypeScript 79 errors and lint 11 errors/142 warnings match main by identity. All 36 frozen files byte-match 38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c. Existing disposable PGlite counts harness passes all three groups: performance/Sold Date regressions, Reports v2 regression/admission inclusion, and exact versioned recovery. Native concurrency and final-head checks remain separately observed in automatic CI.

Publication and automatic CI/preview attempts are approved; final hosted results will be recorded on PR #517. No manual dispatch, production operation, integration setting change, merge or release stage. Prior head 9b673e06 had five passing workflows and DNC blocked by T-1; both Vercel previews passed and Supabase preview was skipped. All independent review, owner acceptance, reporting-zone and fresh assembled-v3 native rehearsal gates remain open. B6 and the actual frozen 3.3.0 evidence package are unchanged.

---

## November 6 follow-up — approved historical Havana fixture correction

This addendum supersedes historical not-published/44-file statements below. Draft PR #517 was published at 7400de623f96737f84dd638220dc1e564e173392. Chris then approved two additional test paths, the existing plan/work-log/readiness updates, local checks and publication with automatic CI/preview attempts. The PR has 46 changed paths after this follow-up. No production release authorization.

Additional paths: `supabase/tests/reports_fixtures.sql` and `supabase/tests/reports_rpc.sql`. Only those two tests and `implementation_plan.md`, `WORK_LOG.md`, this readiness record change in the follow-up. All 36 frozen release files still match candidate 38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c.

The obsolete 2026 Havana fall-back assertion is replaced with the historical November 2, 2025 transition. Samples at 04:30Z and 05:30Z prove both local 00:30 occurrences; exact bounds remain 04:00Z to next-day 05:00Z. Prior-day count is 1, fall-back-day and midnight-hour counts are 2. Los Angeles/spring-forward/day-boundary coverage remains. References: https://www.iana.org/time-zones/releases/2026f and https://data.iana.org/time-zones/tzdb-2026f/northamerica.

Local verification: root TypeScript/build pass; 974 selected Vitest tests pass/1 skip. App TypeScript 79 errors and lint 11 errors/142 warnings match main by identity. Two initial suites failed identically on main/candidate when synthetic Supabase environment values were omitted; all selected suites pass with the workflow's existing loopback-only values. Existing `scripts/tests/dialer-reliability/counts.mjs` passes all three groups under disposable PGlite: performance counts, Reports v2 assertions/admission inclusion, and exact versioned recovery. This embedded run does not establish native concurrency or an assembled v3 release rehearsal.

Initial hosted checks: five workflows and both Vercel checks passed; DNC failed at the obsolete T9 assertion. PostgreSQL 17.6 image passed the assertion; PostgreSQL 16.15 image produced the current-rule 04:00Z result. Exact installed tzdata package versions were not logged. Supabase preview was cancelled for the concurrent-branch limit; no settings or branch deletion. New final-head automatic results will be recorded on PR #517. No manual dispatch.

Review artifacts remain the frozen 3.3.0 evidence package (44 screenshots/37 exports), with this test-only correction reviewed in the PR diff. Native assembled v3 rehearsal, independent security review, owner acceptance and confirmed organization zones remain open. B6 output is unchanged; no new production query or mutation.

---

# Reports V2 preparation closeout — November 6, 2026 UTC

Local branch: `docs/reports-v2-review-20261105`, based on current main `09ec29a4e6a22f9679d1cfa44b2f1cf57c874e2d`. Main was rechecked and remains unchanged. Frozen candidate `38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c` is preserved. No branch publication or PR creation.

## Exact scope

44 files only: 34 pinned SQL files, unchanged release runner and unchanged release workflow, plus eight approved documentation files. Every frozen file is byte-equal to the candidate; the runner's local files_gate passes all 34 pins. No src, package, Vercel, Supabase configuration or existing workflow edit. The exact file list is below. Root AGENT_RULES stages Package A clauses only; later-package clauses remain in the focused plan. The Package B FullScreenContactView exception permits only the existing single `onPolicyRecordChanged` prop; it does not authorize another component mount or unrelated refactoring.

Conflicts: draft PR #486 overlaps private.performance_sale_monthly; do not combine it. Other active documentation work, including #514, overlaps shared rules/work log. Preserve #515/#516 telephony changes and refresh conflicts before publication/merge.

## Verification

- `npx tsc --noEmit`: passed. `npm run build`: passed, with existing chunk-size/import warnings.
- App typecheck: 79 existing errors, identical by file/line/code/message to main.
- Lint: 11 existing errors and 142 warnings, identical by file/line/column/rule/message/severity to main. No new finding.
- Existing Reports tests on both main and prepared branch: 384 passed, 1 skipped, 0 failed.
- 36 frozen release files byte-equal; all 34 SQL pins pass the unchanged runner's local files_gate. No runner backend stage or workflow dispatch.
- B6: exact approved hash; 55/55 synthetic checks before unchanged read-only production execution. Actual result: 44 sale events, 2 distinct discrepant events, each with premium and Sold Date flags. Only redacted approved output returned; classifications remain pending.
- Contract-3.3.0 synthetic evidence: 44 screenshots and 37 CSV downloads; frozen browser suite 474/474, supplemental 30/30. No app edits. Embedded-database concurrency limits are disclosed in the visual review; native assembled-branch rehearsal was not rerun locally. Historical exact-candidate native 17/17 evidence is preserved separately.

## Remaining gates

Independent security reviewer NOT APPOINTED; sign-off OPEN. Owner visual, CSV and map-provenance acceptance OPEN. Three organizations each have one active user and a missing company_settings row: 525671d1-f6cd-4289-b415-1ec2f06b2472; b90dccbf-f320-4b62-ade3-38b793f666cb; cda13104-307c-4d2c-b804-d623d0e34886. Exact IANA zones require owner/admin confirmation before any exact organization/value change is proposed. No all-users availability claim. B6 classifications and any corrections remain separate.

The attached review package contains actual screenshots, exports, redacted B6 result, time-zone worklist, narrow rule diff, independent-review packet, exact frozen sources/hashes, verification comparison and hosted-effects report.

Next approval: publish the exact committed preparation SHA and open a draft PR, accepting possible automatic Supabase preview creation, six existing GitHub Actions workflows and Vercel previews. This is not merge, production deployment, backend release-stage, workflow-dispatch or production-user read-back approval. No integration settings were changed.

## Changed files

- `supabase/migrations/20261105120010_reports_v3_foundation.sql`
- `supabase/migrations/20261105120011_reports_v3_sale_facts.sql`
- `supabase/migrations/20261105120012_reports_v3_call_journey_helpers.sql`
- `supabase/migrations/20261105120013_reports_v3_appointment_facts_stub.sql`
- `supabase/migrations/20261105120014_reports_v3_state_helpers.sql`
- `supabase/migrations/20261105120015_reports_v3_readers.sql`
- `supabase/migrations/20261105120016_reports_v3_calls_campaign_lead_index.sql`
- `supabase/migrations/20261105120017_reports_v3_release_enable.sql`
- `supabase/migrations/20261105120020_policy_sale_premium_corrections.sql`
- `supabase/migrations/20261105120021_reports_v3_sale_premium_basis.sql`
- `supabase/migrations/20261105120022_reports_v3_release_enable_pkg_b.sql`
- `supabase/migrations/20261105120030_policy_sale_call_links.sql`
- `supabase/migrations/20261105120031_policy_sale_call_link_capture.sql`
- `supabase/migrations/20261105120032_reports_v3_sale_call_links.sql`
- `supabase/migrations/20261105120033_reports_v3_release_enable_pkg_c.sql`
- `supabase/migrations/20261105120040_appointment_type_categories.sql`
- `supabase/migrations/20261105120041_appointment_occurrence_evidence.sql`
- `supabase/migrations/20261105120042_policy_appointment_attributions.sql`
- `supabase/migrations/20261105120043_reports_v3_appointment_facts.sql`
- `supabase/migrations/20261105120044_reports_v3_release_enable_pkg_d.sql`
- `supabase/ops/appointment_type_category_baseline.sql`
- `supabase/migrations/rollback/20261105120043_reports_v3_appointment_facts.rollback.sql`
- `supabase/migrations/rollback/20261105120042_policy_appointment_attributions.rollback.sql`
- `supabase/migrations/rollback/20261105120041_appointment_occurrence_evidence.rollback.sql`
- `supabase/migrations/rollback/20261105120040_appointment_type_categories.rollback.sql`
- `supabase/migrations/rollback/20261105120032_reports_v3_sale_call_links.rollback.sql`
- `supabase/migrations/rollback/20261105120031_policy_sale_call_link_capture.rollback.sql`
- `supabase/migrations/rollback/20261105120020_policy_sale_premium_corrections.rollback.sql`
- `supabase/ops/reports_v3_disable.sql`
- `supabase/ops/reports_all_disable.sql`
- `supabase/ops/reports_v3_readback.sql`
- `supabase/ops/reports_v3_preflight.sql`
- `supabase/ops/appointment_type_category_baseline_revert.sql`
- `supabase/ops/reports_v3_enable.sql`
- `scripts/reports_release.py`
- `.github/workflows/reports-release.yml`
- `AGENT_RULES.md`
- `implementation_plan.md`
- `WORK_LOG.md`
- `docs/plans/2026-10-31-reports-v2/implementation_plan.md`
- `docs/plans/2026-10-31-reports-v2/release-proposal.md`
- `docs/plans/2026-10-31-reports-v2/evidence/map-provenance.md`
- `docs/plans/2026-10-31-reports-v2/evidence/security-review-2026-11-06.md`
- `docs/plans/2026-10-31-reports-v2/evidence/release-readiness-2026-11-06.md`
