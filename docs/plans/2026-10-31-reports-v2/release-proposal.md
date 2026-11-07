# Reports V2 — Package B backend preparation

## Current decision — November 7, 2026 Pacific

**Prepared locally; not published, merged or applied.** Chris approved the eight-file documentation scope and read-only review. Base main: `15d967320af7a0bd9774e09bc57e0dd31f97900c`; branch: `docs/reports-package-b-preparation-20261107`. Package A is enabled and recorded; Reports UI is not released. This document supersedes earlier proposal status below.

Package B provides an append-only audit trail for correcting the premium attributed to an original sale. A correction restates the original seller's original Sold Date period. Installation creates an empty ledger and proves sale amounts unchanged before committing. The correction RPC can later update the current policy only through its explicit `match_sale` mode and conflict checks; publishing this documentation does not authorize any correction.

## Prepared change and publication request

Exactly eight documentation paths are changed:

- `implementation_plan.md`
- `WORK_LOG.md`
- `docs/plans/2026-10-31-reports-v2/implementation_plan.md`
- `docs/plans/2026-10-31-reports-v2/release-proposal.md`
- `docs/plans/2026-10-31-reports-v2/production-release.md`
- `docs/plans/2026-10-31-reports-v2/verification.md`
- `docs/plans/2026-10-31-reports-v2/context-snapshot.md`
- `AGENT_RULES.md`

AGENT_RULES adds only the planned A-40, A-34 and A-851 backend rules, clearly marked prepared/not deployed, and redirects the older snapshot sentence to the conditional rule. No SQL, runner, workflow, application, test, dependency, or frontend file changes.

**Next approval requested: publish the prepared local documentation commit to its new branch and open a draft Package B backend PR against main.** This includes any existing automatic GitHub/Vercel integration checks or previews. Current GitHub push/pull_request path filters do not match these eight documents. Recheck integration behavior before publication and observe any external checks; do not disable integrations. Production merge and every database stage remain excluded. Before a later merge, recheck main, exact diff, conflicts, required checks and Supabase automatic production deployment OFF. The linked Vercel projects may rebuild the existing frontend on that later approved merge.

## Read-only preflight and overlap

Production `jncvvsvckxhqgqvkppmj`: history 364/head 20261105120017, all eight Package A versions recorded; contract 3.0.0; nine v3 readers enabled. Package B ledger, writer, history RPC and three new helper functions are absent. All five required preimage hashes match; see verification.md. Advisors: 276 security / 463 performance / 0 health findings. Existing findings are not remediated by this scope.

PR #486 is still open at `2de28c320547983f68bed5f77d8ec9684ea3643d`. Inspection of its current 23-file diff corrects the older direct-overlap warning: it changes commission valid-slot/grid-facts helpers, not performance_sale_monthly. Its proposed historical preview/batch derives source premium independently (positive immutable snapshot, otherwise current client premium); it must not silently start using corrected reporting AP or be treated as validated by this release. Do not execute or merge its five-sale backfill. Preserve its separate exact-manifest approvals. Shared AGENT_RULES/WORK_LOG edits must be reconciled on fresh main. PR #514 at `3c54f4d13de7b6901db33c111d94fb70d4f42f6a` remains an unrelated documentation change.

## Frozen backend package already on main

These existing files are not edited or re-created by this PR. Versions exceed production head. Stop if production history or a source pin drifts; do not renumber or amend frozen bytes without a new reviewed scope.

| File | Bytes | SHA-256 |
|---|---:|---|
| `20261105120020_policy_sale_premium_corrections.sql` | 28,112 | `66c8c5963cdf73a232c1c1081888bd4e1ee0de2f6605117bc7176f7c32cf6b56` |
| `20261105120021_reports_v3_sale_premium_basis.sql` | 9,302 | `df9a1e49eb626e7e4ddf50350d2d245e0c963ecf910932869deb4e2b398bd273` |
| `20261105120022_reports_v3_release_enable_pkg_b.sql` | 24,080 | `16ffbe8eca6e0e18bf25095eb1da888793b1035cc5a94a43ce46852d96b8f7ac` |

## Later production sequence — not authorized by preparation or publication

Each dispatch uses `reports-release.yml` on approved main, `confirm` equal to `stage`, and the existing protected environment review. One stage per separately approved action; stop on failure.

| Stage | Effect and verification |
|---|---|
| `check` | Recheck pinned source and installed state. |
| `disable-v3` | Revoke v3 reader access for the transition; v2 remains available; no table data changes. |
| `apply-20261105120020` | Create private ledger with RLS and no client table grants; three audit guards; sealed helpers/RPCs; replace shared effective-premium calculation with exact preimage guard and per-sale equality check. |
| `apply-20261105120021` | Replace v3 premium/basis helpers, contract 3.1.0; prove every sale's amount/source/state/revision unchanged; grant exactly two application RPCs to authenticated only. The correction API becomes callable at this stage even before its UI exists; server authorization is the security boundary. |
| `apply-enable-20261105120022` | Full closure/pin/privilege verification; restore exactly 15 report readers to authenticated and service_role. |
| `read-back` | Role-simulated read-only production verification. Independently verify ledger RLS, zero rows, three triggers, RPC ACLs, per-sale identity and advisors (expected +2 authenticated SECURITY DEFINER warnings). Any extra reconciliation query requiring actor simulation needs explicit scope. |
| `record-history` | Repeat read-back; record only the three installed migrations with pinned CLI digests. Expected history 367/head 20261105120022 if no drift. |

The existing v2 Reports screen is unaffected by disable-v3. The shared performance calculation serves Leaderboard/Dashboard, so the unchanged-value and permission checks are required even though the new Reports UI is absent. No policy correction, Sold Date change, commission update, SMS/email, call or Edge deployment belongs to this sequence.

## Security review and recovery

Source review and live preimage checks are recorded in verification.md. This is technical review, not independent human sign-off. Chris waived that human gate only. The ledger has RLS with no client policies/grants; postgres-owned SECURITY DEFINER RPCs enforce home-organization and actor checks. The writer permits active Admin/Super Admin only. Team Leaders/original sellers get scoped history reads, not write authority. Neither anon nor service_role receives the two application RPC grants.

Recovery is separately approved. The frozen rollback always seals both application RPCs. Only an empty ledger and matching postimages permit exact preimage restoration; otherwise corrections remain effective and the writers stay sealed. The ledger/guards are never dropped. Re-forward requires a new reviewed migration, not replay of ...20. Never test rollback on production.

## Remaining owner gates

Owner visual/CSV/map acceptance remains open. The two B6 discrepancies retain separate unclassified premium and Sold Date differences; no correction, classification, or bounded-deferral acceptance is inferred from this preparation approval. Historical 144/147 performance results retain three accepted agency/366-day exceptions. The original candidate remains `38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c`. Packages C/D and frontend F remain separately gated.

---

## Historical Package A proposal (superseded status)

# Reports V2 backend release proposal

## Current review decision — November 6, 2026 Pacific

PR #517 is published as a draft, with 48 approved paths: the original 44 below and the four expressly approved Havana tests. Its implementation source is `62a5430251113b0bd6fb93c9811dda8773371fbf`; this closeout changes only six existing documentation files. Main and both READY production deployments remain `09ec29a4e6a22f9679d1cfa44b2f1cf57c874e2d`. All 36 frozen SQL/runner/workflow files match the candidate. The Reports V2 frontend is still excluded.

The independent reviewer requirement was explicitly **waived by Chris**, not signed off. The three Pacific organization settings are saved and verified; preflight now reports **4 active-user organizations / 0 invalid zones**. The unchanged read-only preflight passes the function and permission guards, with **356 migrations / head 20261105051037**, matching B/C preimages and the **36 locked / 0 custom** appointment baseline. See the readiness record for the fresh assembled native rehearsal.

### Next approval: exact backend-only merge, followed separately by production stages

After reviewing the final documentation SHA in PR #517, approve that exact head's merge only. The merge adds the pinned backend release files, approved test corrections and documentation; it includes no `src/`, package manifest, build configuration, Edge Function or runtime frontend change. It will rebuild the existing frontend in both Vercel projects. Immediately before merge, recheck main, source hashes, conflicts, and that Supabase automatic production deployment is still OFF; stop on drift. Do not merge the integration branch wholesale.

The merge approval does **not** authorize any SQL stage, read-back impersonation, category write, policy correction, frontend release or settings change. Subsequent Package A execution follows the sequence table below. Preserve the stop after the sealed objects/index for independent tool verification before enabling. Each dispatch retains its exact-stage confirmation and protected environment review. The owner waiver removes only the human independent-review requirement, not these technical checks or approvals.

### B6 proposal for owner decision — no correction

The approved redacted inventory found two events in organization `a0000000-0000-0000-0000-000000000001`:

| Policy ID | Premium observation | Sold Date observation | Current decision |
|---|---|---|---|
| `65861ec9-bf10-41a8-a22b-cc0279293375` | Differs | Differs | Unclassified; unchanged |
| `958e9679-2059-4ce0-9273-9f0f48101478` | Differs | Differs | Unclassified; unchanged |

Recommended owner decision: explicitly accept launching with these historical differences unchanged and defer each premium/Sold Date classification until business evidence is available. Reports will retain their defined sale-event basis; current policy-book values may differ. This does not label either item an entry error or a genuine later change, write any audit correction, or claim the existing manifest check passed. Until Chris accepts this bounded exception or supplies the four classifications, the B6 completion gate remains open. No additional production records were retrieved.

### Owner acceptance still needed

Review the [contract-3.3.0 viewer](https://chatgpt.com/library?file_id=libfile_db1f1d15c8548191b7e59f68eab82775&account_id=personal) and [actual evidence ZIP](https://chatgpt.com/library?file_id=libfile_68bd714facf08191bd91b362877e86a9&account_id=personal): 44 screenshots, 37 CSV exports and map provenance. Automated capture is complete; owner visual, CSV and map acceptance is not inferred from “Finish this build.” The existing accepted 366-day performance exception is not converted into a passing performance result. Final production availability still requires A+B+C+D+F and their separately approved verification.

## Historical approved backend-only preparation scope

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

Last inspected integration settings: Supabase GitHub **Deploy to production OFF**; automatic preview branching **ON**, limit 3, Supabase changes only. Reverify before merge; this is not a fresh settings inspection. A PR with Supabase files may create a preview branch under those settings. No setting changed.

Both Vercel projects deploy main and are READY at `09ec29a4e6a22f9679d1cfa44b2f1cf57c874e2d`. A backend-only merge may rebuild/deploy the existing frontend. Prove no production entry-graph/build-config changes and include that rebuild in later explicit merge approval.

GitHub environment `google-sheets-production` requires cgarness, permits only main and disallows administrator bypass. Main itself was reported unprotected; that does not remove the environment or owner approval gates.

## Before requesting merge

1. Refresh main, open PR conflicts and database history. Reports preparation is draft PR #517. Draft #486 overlaps the premium function and #514 overlaps shared documentation; do not mix their work into this release.
2. Match every copied byte to Frozen_release_manifest.md. Changed SQL/runner/workflow bytes supersede prior verification.
3. Check the assembled diff against this allowlist. Run existing branch CI, `npx tsc --noEmit`, app typecheck/build and baseline comparisons.
4. Rehearse assembled release files with the frozen PostgreSQL 17.6 harness in a temporary test checkout. Keep full synthetic test dependencies outside the production diff. Do not copy the frontend-dependent integration CI workflow into this minimal PR. Missing test support does not authorize widening the PR.
5. Preserve Chris's explicit waiver of the independent reviewer requirement without claiming sign-off. Complete technical verification and request the exact merge SHA, followed by each protected stage separately. Owner visual/CSV/map acceptance and B6 disposition remain separate release gates.

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

## Historical publication approval packet — subsequently approved and published

The following packet described the original publication request. Chris subsequently approved publication and the two test follow-ups; PR #517 now exists. The effects and production boundaries remain relevant to later updates:

| Service | Automatic effect | Boundary |
|---|---|---|
| Supabase | Automatic preview branching is ON (limit 3; Supabase-file changes only). These changes match. A PR can create a preview database and attempt repository migrations/configuration/seed. Pinned production preconditions may make that preview fail. | GitHub Deploy to production is OFF. No settings were changed. A preview result does not authorize production application. |
| GitHub Actions | Six existing pull_request workflows match: `dialer-dnc-backend.yml`, `reporting-integrity.yml`, `reports-backend.yml`, `reports-frontend.yml`, `sms-consent.yml`, `uv-profile-sync.yml`. Jobs install dependencies and run builds/tests; several create disposable databases or browsers and upload evidence. | No new dispatch. `reports-release.yml` remains workflow_dispatch-only, main-only and protected by the cgarness environment review. This minimal branch does not add the integration branch's v3 workflow/test files. |
| Vercel | The linked `agentflow` and `agentflow-life-insure` projects can queue preview builds from branch publication/PR activity. The backend-only branch builds the existing main frontend. | No production merge/deploy requested. A later main merge may rebuild both production projects and needs separate exact-SHA approval. |

No matching GitHub push workflow is triggered by the 44-file scope. This does not suppress Vercel integration behavior on a push. Treat publishing the branch and opening the draft PR as one separately approved action, with hosted execution explicitly disclosed. Do not disable integrations to avoid the gate.

The original publication request is complete. The current next request is the exact backend-only merge described at the top of this document. Production actions, workflow dispatches, read-back impersonation and release stages remain separately approved.
