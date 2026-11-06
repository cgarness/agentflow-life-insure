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
