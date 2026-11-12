# Team Commissions release packet

Status: implementation candidate; hosted performance gate BLOCKED. **Not applied, merged, deployed, or live.** Production is not authorized. The approval request/PR description pins the exact published head and hosted check results; do not approve or execute against another head.

## Blocking performance decision — not production approval

The original hosted native run preserved all assertions and failed three 1,000-agent/50,000-policy cases: Overview and all-time Scheduled exceeded20seconds; Policies exceeded its8-second role default. Seven other workflows passed. Earlier local timings are historical evidence and do not override these hosted failures. Profiling attributes most installment-read cost to the existing per-row financial RLS checks. No RLS/auth primitive/security mode, database/role timeout, new index or writer change has been introduced to bypass this cost.

Proposed implementation decision: permit a bounded **40-second request budget only on three affected new public read APIs**: `get_scoped_commission_overview`, `get_scoped_commission_installments`, and `get_scoped_commission_policy_list`. The first two currently declare20seconds; Policies currently inherits8seconds. Breakdown remains at its existing20-second budget. Existing eight My APIs and all role/database/helper settings remain unchanged. This proposal is NOT implemented or production-authorized. It would allow the largest books to complete but would not make their reads faster. If accepted, update the function-specific settings, regenerate hashes, preserve original failures, run unchanged full-ledger/authorization/scale assertions, explicitly test40-second cancellation and pooled default restoration, and finish final-head CI before requesting exact production release approval. If rejected, a separate approved performance architecture/capacity decision is required; do not silently truncate All agents or loosen RLS.

Both production projects are still on main713aa48d. Canonical AgentFlow is configured; the separate legacy Vercel project has a previously documented Supabase environment initialization problem, outside this feature. A READY build alone must not be described as functional acceptance there.

## Target and boundaries

- Repository: `cgarness/agentflow-life-insure`; feature branch `feat/team-commissions-20261110`; inspected main `713aa48d2c71de7da595d74bee878324654e3255`.
- Supabase: `AGENTFLOW CRM`, `jncvvsvckxhqgqvkppmj`; current hosted head `20261111192142`.
- Frontends affected by a merge: Vercel `agentflow` (`prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc`) and `agentflow-life-insure` (`prj_PctERc2MEVcpKkYtBtQYc1ruunKb`), team `team_iPboOWpwdIQRwdxmA5GJp5Rq`.
- Refreshed production rollback candidates at the current base: `agentflow` / `dpl_EfAsR22pWSx88eQFEAgxaXFC4BTT`; `agentflow-life-insure` / `dpl_5C7Dv3f13uW3qQd1GhLi5Dj7xRVq`. Recheck before any approved release; preserve the Carriers release.
- Excludes PR #486, historical corrections, customer data changes, carrier Settings changes, permission settings, Reports metrics, sale writers, contact ownership and telephony.

## Prepared database change

CLI-generated source: `supabase/migrations/20261112165503_policy_commission_scoped_reads.sql`. The exact source, rollback, transaction-package hashes and 29 postimage/security pins are in [release/manifest.json](release/manifest.json). Any SQL change requires regeneration, testing and a new exact approval.

| Artifact | SHA-256 |
| --- | --- |
| Migration | `636b81d3f4ca4977f93fb728ec8dd5141b89debedf46822fa774d92be9d84366` |
| Rollback source | `043a07e09acef78a6b229f471640a0e21944baaccca1a544deafd7489766b079` |
| Apply transaction | `9a0fe4dad8d18b54d78e4d6b985be865b7bab01a96971e2eba86f9c7e780435e` |
| Rollback transaction | `4426445f5a0946619bfc00376c961a71a0e001f41ec57f18f65138fed6daa050` |

The migration creates the non-PostgREST-exposed `policy_commission_scoped` schema, two composite types, twelve shared helpers and seven public readers. It replaces only the bodies of eight existing personal readers and two existing self-only fact helpers, preserving their signatures, defaults, types, owner, ACL and security metadata. All new functions are STABLE SECURITY INVOKER with fixed search paths. New function privileges explicitly exclude PUBLIC, anon and service_role; authenticated receives only intended usage/execute access. No financial writer, authorization primitive, table grant, RLS policy or business row is changed.

The three new public aggregate readers `get_scoped_commission_overview`, `get_scoped_commission_installments` and `get_scoped_commission_breakdown` are prepared with a **20-second function-specific statement timeout**, hoisted by PostgREST for those requests. This is an explicit effect in the production approval. Existing role/database settings, helper settings and all eight My reader metadata remain unchanged at their existing general eight-second behavior. The 50,000-policy diagnostic took 11.436 seconds for Overview and 9.650 seconds for all-time Scheduled after safe optimizations; eight-second refusals remain recorded. Actual HTTP enforcement/restoration passed, including repeated full-ledger reconciliation, 8/20-second cap probes and restoration on one pooled connection. All 36 final native scale cases passed with seven warm samples each. This is not a production capacity or concurrency guarantee.

The SQL Editor apply package embeds the exact migration bytes in one transaction. It checks the operator, exact prior history head, source SHA-256, fresh preimages and security metadata, refuses replay, executes the reviewed source, verifies all postimages and records one exact `schema_migrations` row under version `20261112165503`. Target project identity is checked externally through the dashboard; database name `postgres` is not treated as proof of project identity. The migration API's apply-time timestamp is not substituted for the reviewed CLI version. No `db push` or pending-directory replay is part of this release.

## Publication and release order

Feature publication and an unmerged PR are authorized. Inspected production workflows are dispatch-only/main-only or protected; the commission PR workflow uses local synthetic PostgreSQL/PostgREST. Both linked Vercel projects use `main` for production. Feature previews have no custom domains. Supabase's GitHub integration applies production migrations on the configured production branch, not an unmerged feature branch.

Preview database isolation could not be confirmed: project environment-value access requires secure verification and the Supabase dashboard is signed out. Automated frontend preview builds may run, but no authenticated real-user preview testing is authorized by that uncertainty. Browser acceptance uses an isolated synthetic bundle with external requests blocked. Before backend application or merge, securely inspect Supabase's production deploy toggle. The proposed consolidated approval includes setting **Deploy to production = OFF only if currently ON** for this repository/project, to keep database release on the exact reviewed transaction and prevent automatic replay. This leaves preview configuration unchanged and makes future production database releases manual. If the toggle cannot be inspected or the integration differs from the reviewed target, stop for secure access or a revised exact action; do not infer that it is off.

The single approval request identifies the exact PR/head, completed hosted checks and hashes above. Approval authorizes this sequence only:

1. Recheck main, the exact approved PR/head, hosted migration history, function preimages/ACLs/default grants, API-exposed schemas, PostgREST function-setting support/hoisting, both Vercel production branches and Supabase production automation. With the explicit conditional setting approval above, turn off Supabase production auto-deployment if enabled. Stop on any other drift; do not change other settings. Secure Supabase dashboard authentication may be required because connected tools do not expose that integration configuration. The anonymous OpenAPI endpoint is restricted to service_role; do not bypass it or obtain privileged keys for this check.
2. Apply the exact reviewed SQL transaction to `jncvvsvckxhqgqvkppmj`. Read back the stored history SQL hash, all new/replaced function definitions, owners, grants, stability, security mode and search paths, helper schema privileges, unchanged auth/writer/RLS inventory, and non-exposure of the helper schema. Compare Supabase advisors against the captured baseline.
3. Only after backend verification, merge the exact approved PR to `main`, allowing the two identified Vercel production deployments. No unrelated deployment/settings action is included.
4. Verify both deployments' Git source, READY state, aliases and built scoped-commission assets. Perform allowed authenticated read acceptance through a real signed-in account if available; never fabricate credentials or create customer financial data to test. A successful build or HTTP 200 alone does not establish live feature acceptance.

## Rollback and containment

The guarded package [release/rollback.sql](release/rollback.sql) requires the exact applied source history and current function postimages. It restores the ten freshly captured reader/helper definitions, removes nineteen new functions and two types in explicit dependency order with RESTRICT, drops the empty helper schema and deletes only the exact migration-history row. It never deletes financial history. On an uncertain apply/rollback response, inspect state before retrying.

For a frontend-only regression, first restore the compatible personal frontend at the inspected base on both projects; the shared backend remains compatible. If an authorization defect affects shared definitions, contain every affected public and directly callable helper path, including legacy My readers; disabling only the newly named endpoints is insufficient. The consolidated request includes conditional execution of the exact guarded backend rollback and restoration of the compatible personal frontend when one of the listed failure triggers occurs. A drifted guard is a stop condition, not permission to force recovery.

Rollback triggers: authorization/tenant leakage, incompatible personal contracts, unexplained financial reconciliation mismatch, or a blocking released regression. Conditional rollback is part of the proposed exact approval; no unrelated recovery or data correction is included. Until Chris approves that request, rollback is prepared only.

## Historical local evidence and current limitations

See [verification.md](verification.md) for the full A01–A19, F01–F14 and U01–U18 matrix. The original local candidate passed: all 51 acceptance scenarios, the full native runner (exit 0, about 13m12s), 36 scale cases/288 samples/36 plans, exact apply/history/rollback/reapply, 48 Chromium browser checks, 163 focused frontend tests and production build passed. The full frontend suite has 7,110 passing tests and the same one baseline failure/ten pending; application TypeScript retains 79 existing diagnostics, global lint: 11 errors/145 warnings, with exact-base equivalence. Root TypeScript/scoped lint pass. Screenshots and complete evidence are linked there. Hosted check links and the exact published head are pinned in the PR/approval request. No production acceptance claim is made.
