# Proposed backend-only PR scope

Local review-branch preparation is approved. Publishing/opening a PR and hosted execution require separate approval. No merge, dispatch, deployment or production writes are authorized.

The frozen runner verifies all 34 pinned SQL files before connecting, including for Package A. Carrying B/C/D files does not authorize their execution. No runtime frontend, src/, package manifest, Vercel setting, Edge Function, Twilio code or Supabase configuration is included. Do not merge the integration branch wholesale.

## Files copied byte-for-byte from the frozen candidate

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

## Documentation files only

- `AGENT_RULES.md`
- `implementation_plan.md`
- `WORK_LOG.md`
- `docs/plans/2026-10-31-reports-v2/implementation_plan.md`
- `docs/plans/2026-10-31-reports-v2/release-proposal.md`
- `docs/plans/2026-10-31-reports-v2/evidence/map-provenance.md`
- `docs/plans/2026-10-31-reports-v2/evidence/security-review-2026-11-06.md`
- `docs/plans/2026-10-31-reports-v2/evidence/release-readiness-2026-11-06.md`

Only Package A's approved AGENT_RULES clauses land in this first PR. Preserve historical plans/logs; prepend the approved work-log entry, add the readiness addendum, and replace the stale release proposal.

B6 is a separately approved proposed file: `supabase/ops/reporting-accuracy/reconcile_sale_book_divergence.sql`. Do not add it to the runner's pins or change the runner. Its query and execution require separate approval.

## Deployment behavior

Supabase GitHub **Deploy to production OFF**; automatic preview branching **ON**, limit 3, Supabase changes only. A PR with Supabase files may create a preview branch under current settings. No setting changed.

Both Vercel projects deploy main and are READY at `09ec29a4e6a22f9679d1cfa44b2f1cf57c874e2d`. A backend-only merge may rebuild/deploy the existing frontend. Prove no production entry-graph/build-config changes and include that rebuild in later explicit merge approval.

GitHub environment `google-sheets-production` requires cgarness, permits only main and disallows administrator bypass. Main itself was reported unprotected; that does not remove the environment or owner approval gates.

## Before requesting merge

1. Refresh main, open PR conflicts and database history. This inspection found 16 open PRs, no Reports release PR. Draft #486 overlaps the premium function; do not mix it into this release.
2. Match every copied byte to Frozen_release_manifest.md. Changed SQL/runner/workflow bytes supersede prior verification.
3. Check the assembled diff against this allowlist. Run existing branch CI, `npx tsc --noEmit`, app typecheck/build and baseline comparisons.
4. Rehearse assembled release files with the frozen PostgreSQL 17.6 harness in a temporary test checkout. Keep full synthetic test dependencies outside the production diff. Do not copy the frontend-dependent integration CI workflow into this minimal PR. Missing test support does not authorize widening the PR.
5. Obtain independent exact-SQL security sign-off; then request exact merge SHA, followed by each protected stage separately.

## Proposed stages

| Package | Sequence | History after record-history |
|---|---|---:|
| A | check; apply-20261105120010 through ...15 individually; apply-index-concurrently; STOP for independent function/index verification; apply-enable-20261105120017; separately approved read-back; record-history | 364 |
| B | disable-v3; apply-20261105120020; apply-20261105120021; apply-enable-20261105120022; read-back; record-history | 367 |
| B6 | Approved inventory; independent premium/Sold Date decisions; specifically approved audited corrections if needed; divergence manifest/check | 367 |
| C | apply-20261105120030; apply-20261105120031; disable-v3; apply-20261105120032; apply-enable-20261105120033; read-back; record-history | 371 |
| D | apply-20261105120040; category-baseline; apply-20261105120041; apply-20261105120042; disable-v3; apply-20261105120043; apply-enable-20261105120044; read-back; record-history | 376 |
| F | Separate frontend scope/preview; exact merge approval; both Vercel projects READY at approved SHA; served-app verification | 376 |

Every dispatch repeats the full stage name in confirm. Counts assume no intervening migration; stop on drift. Appropriate B/C/D frontend portions remain separately gated.

## Recovery

disable-v3 seals v3 readers; disable-all seals report readers, leaving class-W application RPCs on unless their package recovery seals them. Re-enable uses the installed package's pinned enable file.

Tested reverse recovery undoes D, then C ...32/...31; retains ...30 and clients_lead_id_guard; can re-enable at B. It cannot fully roll B back after C starts. Never remove the guard or drop the premium ledger. A full A structural teardown is not a runner stage. Emergency disable is the reviewed immediate response. Never perform a destructive rollback merely to test production.

## Hosted effects — publication remains unapproved

The local review branch is not pushed and no PR exists. With the inspected integrations unchanged, publication/opening a PR can start the following hosted execution:

| Service | Automatic effect | Boundary |
|---|---|---|
| Supabase | Automatic preview branching is ON (limit 3; Supabase-file changes only). These changes match. A PR can create a preview database and attempt repository migrations/configuration/seed. Pinned production preconditions may make that preview fail. | GitHub Deploy to production is OFF. No settings were changed. A preview result does not authorize production application. |
| GitHub Actions | Six existing pull_request workflows match: `dialer-dnc-backend.yml`, `reporting-integrity.yml`, `reports-backend.yml`, `reports-frontend.yml`, `sms-consent.yml`, `uv-profile-sync.yml`. Jobs install dependencies and run builds/tests; several create disposable databases or browsers and upload evidence. | No new dispatch. `reports-release.yml` remains workflow_dispatch-only, main-only and protected by the cgarness environment review. This minimal branch does not add the integration branch's v3 workflow/test files. |
| Vercel | The linked `agentflow` and `agentflow-life-insure` projects can queue preview builds from branch publication/PR activity. The backend-only branch builds the existing main frontend. | No production merge/deploy requested. A later main merge may rebuild both production projects and needs separate exact-SHA approval. |

No matching GitHub push workflow is triggered by the 44-file scope. This does not suppress Vercel integration behavior on a push. Treat publishing the branch and opening the draft PR as one separately approved action, with hosted execution explicitly disclosed. Do not disable integrations to avoid the gate.

Prepared next approval request: publish the exact committed preparation SHA and open a draft backend-review PR, accepting the automatic Supabase preview, six GitHub Actions workflows and possible Vercel previews. This approval must not include merge, production actions, workflow dispatches, read-back impersonation or release stages.
