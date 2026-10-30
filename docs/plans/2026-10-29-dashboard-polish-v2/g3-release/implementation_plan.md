# Dashboard Polish V2 — G3 protected backend release (implementation plan)

**Date:** 2026-10-29 · **Branch:** `release/dashboard-attention-g3-20261029`
**Base:** `main` 7a03033492c55fd16ea1bacd049934102fe340e4
**Status:** G3 PRODUCTION COMPLETE. The protected check/apply/record-history stages succeeded; migration `20261029200000_dashboard_attention_clearances` is recorded. G4 file reconciliation is staged on draft PR #504. **G5 frontend release remains unapproved.** The pre-release process below is historical.

## G3 closeout and G4 reconciliation — October 29, 2026

**Completed production stages:** `check` run [40967614726](https://github.com/cgarness/agentflow-life-insure/actions/runs/40967614726);
`apply-migration` run [40968145912](https://github.com/cgarness/agentflow-life-insure/actions/runs/40968145912);
`record-history` run [40968675025](https://github.com/cgarness/agentflow-life-insure/actions/runs/40968675025).
All completed successfully through the protected `google-sheets-production` environment.

**Independent production verification:** 352 migration-history rows, recorded version `20261029200000`,
24 SQL statements, digest `43769e1677e2a218021e7f8bc146f92e86b1154ae00aa1d3c63e8d1515f07693`.
The table, three RLS policies, both SECURITY INVOKER RPCs, guard and three indexes are present.
Security advisor 256 findings (unchanged); performance advisor 465 (+1 informational unused index).
No further production SQL is required for G4.

**Reconciliation staged, not merged:** On draft PR #504, move the exact approved SQL Git blob
`4ab80696278eb8a0bf2b6731b0d8c64e708a52da` unchanged to
`supabase/migrations/20261029200000_dashboard_attention_clearances.sql`. The protected runner and
rehearsal now require the top-level file and no pending duplicate. They retain the recorded-state
replay refusal and protected rollback. The rollback SQL is byte-identical. Production-generated
table and RPC types already match PR #504 exactly.

**Next:** G4 CI, PostgreSQL 17.6 rehearsal, frontend regression, typecheck, lint, build, browser
verification and Vercel preview. Then request Chris's **separate G5 production frontend approval**.
No merge, production Vercel flag changes or frontend deployment during this reconciliation.

## Approval scope

Chris approved the **exact migration and new RLS** but required a separate protected workflow PR, with distinct authorizations for `check`, `apply-migration` and `record-history`. Each GitHub dispatch is manual, main-only, stage/confirm equality, gated by the existing `google-sheets-production` environment (reviewer `cgarness`, admin bypass off, main-only branch policy). Rollback is also separately gated and refuses all existing clearance rows. No automatic schema application occurs on PR or merge.

Source of truth reviewed: `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md`, deployed G2 release workflow and runner, and the Gate 2 Dashboard Polish plan. Supabase production was inspected read-only.

## Approved immutable files

- `supabase/migrations/pending/20261029200000_dashboard_attention_clearances.sql`: 16,396 bytes, SHA-256 **85ac2ff7dcd435bd48718311b05704e4e7d96293abf9b47fd062ce30610cb8e8**, Git blob `4ab80696278eb8a0bf2b6731b0d8c64e708a52da`.
- `supabase/migrations/rollback/20261029200000_dashboard_attention_clearances.rollback.sql`: 2,338 bytes, SHA-256 **9250e2e7cedc8d8e6476838d84e1bc924b869b79248a0e982f68dd267393db55**, Git blob `647e78d16ba39480da5e7ec754f1f43598f9c3d6`.

Both Git blobs are **byte-identical** to approved Dashboard feature PR #504. This section describes their original pre-apply location; the G4 candidate now stages the forward SQL in `supabase/migrations/` with the same blob, while production `main` remains unchanged until an approved merge. All existing CRM calls, campaign leads, appointments, missed-call telemetry, voicemail and other source tables are unchanged.

## Verified production preflight

Project `jncvvsvckxhqgqvkppmj`, PostgreSQL 17.6. Migration history **351** rows with head **20261029120000**. New attention table, clear/undo RPCs and private guard all absent. Reviewed dependency `public.get_org_id()` MD5 `fb1d12f537aac3b3ed18c9e0628f2251`. Supabase advisor baseline **256 security / 464 performance** findings (compare after any authorized apply; don't casually fix unrelated items).

## Release workflow

- New `.github/workflows/dashboard-attention-release.yml` is **workflow_dispatch ONLY**. Jobs: secret-free live `environment-guard` followed by protected `release`. Required exact stage confirmation and main branch gate.
- New `scripts/dashboard_attention_release.py` pins the exact migration/rollback SHA-256, their expected locations, production pooler, TLS and database/role identity, the history baseline, `get_org_id()` definition, schema catalog and migration-history fingerprints. Any unrecognized or partial state fails closed. It executes only the approved migration via a single `psql --single-transaction` with 2 s lock timeout and 120 s watchdog. The CLI history stage is pinned to Supabase CLI 2.121.0, runs `migration repair --status applied` with a temporary directory containing only this version, and executes no SQL migration. No `db push` or `migration up`.
- Protected workflow receives only existing `SUPABASE_DB_PASSWORD` and `SUPABASE_POOLER_HOST` GitHub environment secrets. No service role key or Vercel configuration.
- On rollback, the runner checks and locks the clearance table, refusing to discard any user data. Rollback requires separate approval.
- Unrelated CRM activity is not fingerprinted or read; only catalog definitions and migration-history rows are fingerprinted.

## Separately approved stages

| Stage | Preconditions | Result |
|---|---|---|
| `check` | State recognized, protected environment | Read-only classification and catalog checks |
| `apply-migration` | 351 history rows, new objects absent | ONE pinned DDL transaction; history remains 351 |
| `record-history` | Exact four objects installed; read-backs pass | CLI records version 20261029200000 exactly once; history becomes 352 |
| `rollback-migration` | Explicit separate approval; clearance table EMPTY | Protected rollback and optional version history revert |

The independent read-back after `apply-migration` must include table, 3 RLS policies, grants, both SECURITY INVOKER RPCs, trigger, columns, indexes, source timestamp semantics, migration history, and advisors. **Record-history must not be dispatched until Chris approves it separately.**

## Local CI, no hosted access

Release-only PR includes the **exact** 69-check SQL suite, two-session concurrency test, 3 negative controls and rollback proof on disposable PostgreSQL 17.6; a new real Supabase CLI 2.121.0 release-runner rehearsal using isolated TLS localhost PostgreSQL 17.6 and synthetic history/data only; and a read-only live GitHub protected-environment configuration check. The first production-matching rehearsal determined and pinned **24 CLI statements**, concatenation SHA-256 **43769e1677e2a218021e7f8bc146f92e86b1154ae00aa1d3c63e8d1515f07693**. These are now hardcoded in the runner and the full rehearsal re-runs to verify them before merge review. No production DB credentials are exposed to CI or the PR.

## File list / boundaries

- **Copied exact from PR #504:** the forward SQL, rollback, 2 SQL test files, `scripts/run_dashboard_attention_tests.sh`; and the SQL CI workflow (with only release-runner/guard jobs added).
- **New:** `.github/workflows/dashboard-attention-release.yml`, `scripts/dashboard_attention_release.py`, `scripts/tests/dashboard_attention_release_test.py`, this plan.
- **Updated:** `WORK_LOG.md` newest-first.
- **Not touched:** any `src/`, Twilio, Dialer, Edge Function, existing migration, CRM data, Supabase production RLS, Vercel flags or PR #504.

## Handoff and next approval

The release-only PR requires independent CI review and Chris's explicit merge approval. After its approved merge, dispatch only the read-only `check` stage with its own approval, then (if it passes) request the **separate** production `apply-migration` authorization and protected environment review. Independently verify the production schema and advisor difference, then request approval for `record-history`. Reconcile the recorded migration path, generated types and Dashboard feature PR #504 afterward. G5 frontend activation is another separate release.
