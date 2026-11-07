## November 7, 2026 UTC — Assembled native verification complete; production release pending

This current status supersedes historical reviewer, time-zone and rehearsal statements below. Technical preparation is complete for implementation source `62a5430251113b0bd6fb93c9811dda8773371fbf`. This follow-up changes only the six documentation paths listed in root `implementation_plan.md`; total PR #517 scope remains 48 paths. Main and both READY production deployments remain `09ec29a4e6a22f9679d1cfa44b2f1cf57c874e2d`. All 36 frozen release files still byte-match `38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c`. No application, test or release-file bytes changed in this follow-up.

### Fresh assembled native rehearsal

Passed using native PostgreSQL **17.6**, TLS and checksum-verified Supabase CLI **2.121.0**, in a disposable loopback-only database with synthetic fixtures. The frozen candidate supplies the unchanged harness; the assembled review branch supplies all 36 identical release files plus the four already-approved Havana test overlays. The harness refuses production/platform roles, pins history at 356 / `20261105051037`, and verifies every migration digest. No production credential or database was used.

- `python3 -I scripts/tests/reports_release_test.py`: **17/17 passed**. Covers all A/B/C/D release stages, native concurrent index, 36-row synthetic category baseline, all 20 CLI history digests, role/confirmation/order/drift refusals, disable/re-enable and reverse recovery.
- `REPORTS_V3_PERF=0 bash scripts/run_reports_v3_tests.sh`: **passed**, including security/scope/organization isolation, contracts, registry/seal/refusal proofs, native index negative controls, correction concurrency in both orders and concurrent appointment links. The appointment race proves one first-link result and one already-linked result under the policy lock.
- `npx vitest run src/lib/__tests__/reportsV3Contracts.test.ts`: **86/86 passed** in the frozen checkout with approved test overlays.
- The initial test-engine build lacked XML support used by the unchanged preflight. Rebuilt PostgreSQL with OpenSSL and libxml, performed a clean rebuild and XML smoke query, then reran both unchanged native harnesses successfully. No release SQL or test bypass was introduced.
- Full scale/performance benchmarks were not rerun. Historical 144/147 performance results and the accepted three agency/366-day exceptions remain as recorded; this is not a new performance pass.

Actual log SHA-256 values: `release-rehearsal.log` = `3955075c9f0097beae3e861a014bb951af29cb60c09596ada32961c2edd39294`; `v3-suites.log` = `c5c560008e702b6622aa2c250b4fc013d0767b53023714ba64fe67c3f4cb122d`. Logs, engine configuration, checksum results and source manifest were downloaded and archive-hash verified before the disposable test VM was explicitly stopped. Native evidence archive SHA-256: `cf407fb42fa2a7343ad4e9ed2883d16b6e2c119289591cb37c2dae82c64454fb`.

### Application and production inspection

Fresh local root TypeScript and build pass. Reports/stat-computation selection: **384 passed / 1 skipped**. App TypeScript **79 errors** and lint **11 errors / 142 warnings** match current main by diagnostic identity; no new finding. Existing exact implementation-head CI has all six workflows passed (run IDs 42306494059, 42306494071, 42306494331, 42306494271, 42306494081, 42306494111), including 606 dialer tests and baseline comparisons. This does not claim the entire repository is failure-free. Documentation-head hosted results will be observed after publication and recorded on PR #517.

The unchanged frozen production preflight passed read-only: all 27 function preimages and ACL guards, **356 migrations / head 20261105051037**, zero Reports v3 migrations, matching B/C preimages and **36 locked / 0 custom** appointment types. Four active-user organizations have zero invalid reporting zones. The three separately authorized settings and resolver outputs again equal `America/Los_Angeles`, source `agency_settings`. Security advisors remain 267 findings with unchanged category counts; no unrelated remediation. No production-user impersonation.

### Decisions and remaining release gates

Chris explicitly **waived** the independent reviewer requirement; no independent reviewer/sign-off is claimed. Pacific settings are complete. The fresh native rehearsal gate is now complete. Owner visual/CSV/map acceptance remains pending for the actual contract-3.3.0 evidence (44 screenshots, 37 exports; 474 frozen browser checks plus 30 supplemental checks). The two B6 events retain separate unclassified premium/Sold Date differences; preserve them unchanged pending owner classification or explicit acceptance of the proposed bounded deferral. No correction or false manifest pass.

Next: review the final exact PR head and approve its backend-only merge, including rebuilds of the existing frontend in both Vercel projects. Recheck main/conflicts and Supabase automatic production deployment OFF immediately before merging. Each production runner stage, read-back impersonation, category write and final Reports frontend release remains separately controlled. PR #486 premium-function overlap and #514 shared-documentation work are not incorporated. No merge, release dispatch, migration, data write, Edge deployment, integration-setting change or production deployment occurred in this follow-up.

---

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
