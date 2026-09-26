# Leaderboard backend recovery — implementation and release plan

## Authorization and current state

Chris authorized beginning backend review, preparation and testing on September 25, 2026 (America/Los_Angeles), after frontend PR #386 was released. This authorizes the isolated implementation and draft PR. Production reopening remains a separate approval of the exact tested SQL. Production access in this stage is read-only. No production migration, re-pause, merge, deployment, customer-data mutation or change to PRs #382/#383 is authorized here.

Base: `main` at `b3c0839bfec85a11d4977e893a746a94a4e96060`. Branch: `codex/leaderboard-backend-recovery-20260926`. The frontend release is live on both Vercel projects. Its source is out of scope for this backend change.

Read-only preflight on September 26 UTC confirmed:
- Production project `jncvvsvckxhqgqvkppmj`, PostgreSQL 17.6.
- `get_org_leaderboard_stats(timestamptz,timestamptz)` is still paused, definition MD5 `1314cefc781ff326540b83f748d48046`; original without the exact pause block is `d26a38b59de90db91ed777236ee4acc4`.
- Owner `postgres`, ACL `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`, STABLE SECURITY DEFINER, `search_path=public, pg_temp`.
- Pause migration `20260923224254` is already applied. Its exact recorded SQL will be restored to the repository as historical evidence, never replayed on production.
- `authenticated` and `authenticator` have an 8-second statement timeout. No role/global timeout changes are planned.
- Existing `idx_calls_org_created_at` is present. No missing-index diagnosis supports a new index.
- One activity snapshot found zero other active client queries, zero lock waiters and zero leaderboard queries over one second. This is not a capacity measurement.
- The separate Group RPC is not paused and is not modified. Group metric/security follow-ups remain outside this organization-standings recovery (AGENT_RULES #23).

## Design

Adapt only the backend proposal from PR #383 (`6fac3e5b52870a460a20812aa80dc6d21dbea9a8`). Replace the exact maintenance block with `pg_try_advisory_xact_lock(hashtextextended('agentflow:leaderboard:v1:' || v_org, 0))` after authentication, database-authoritative organization resolution and date validation, immediately before aggregation. A competing same-organization transaction receives `PT429` immediately; no queue or row lock is added. The lock ends with the transaction. Other organizations have independent keys.

Preserve the complete existing metrics/roster query, signature, owner, ACL, volatility, security configuration and caller authorization. A body comparison that removes only the new guard must reproduce the original definition exactly. The existing frontend already recognizes PT429 as busy and applies backoff. This guard limits concurrent expensive work, not sequential request rate, and it is not a performance guarantee.

Harden both directions relative to #383:
- Reopening accepts only the exact paused production definition and expected owner/ACL, not a generic unpaused original or a previously guarded function.
- Re-pause accepts only the exact tested guarded definition and expected security metadata; it reinstates the original maintenance block before any business lookup and preserves the guard.
- Both patches reject drift, repeats and missing targets; both verify complete metadata and definition after replacement and use bounded transaction-local DDL timeouts.
- The re-pause script is a new-migration template, not an automatic migration. No rollback that simply exposes the unguarded function is bundled.

## Exact file scope

1. `implementation_plan.md`: append a link and authorization note; retain the entire frontend history.
2. This plan and `docs/incidents/2026-09-26-leaderboard-backend/verification.md`: findings, evidence, exact release/re-pause checksums, execution order, limits and approval request.
3. `supabase/migrations/20260923224254_emergency_pause_org_leaderboard_20260923.sql`: exact production historical SQL, restored without edits.
4. One CLI-generated `supabase/migrations/*_leaderboard_request_guard.sql`: forward change, unapplied to production.
5. `supabase/ops/leaderboard_request_guard.sql`: reviewed forward source, byte-identical to the generated migration.
6. `supabase/ops/leaderboard_repause.sql`: strict inverse operational template for a newly approved migration.
7. `scripts/tests/leaderboard-backend.node.mjs`: localhost-only PostgreSQL 17 integration suite using the already-locked `postgres` dependency; no new app dependency.
8. `AGENT_RULES.md` and `WORK_LOG.md`: additive backend invariant and verification entry, explicitly distinguishing prepared from applied.

Any required fixture or test runner extraction stays under `scripts/tests/leaderboard-backend*` or `supabase/tests/fixtures/leaderboard_backend*` and will be listed in the as-built record. No frontend, telephony, customer data, RLS, grant, schema/table/index, dependency or CI workflow changes are planned.

## Verification before production approval

Use a disposable local PostgreSQL 17.6 cluster, synthetic rows only. The runner refuses non-loopback hosts, unexpected ports/database names and nonempty fixture databases. No production credentials are available to it.

Required checks:
- Exact original, paused, guarded and re-paused definitions; immutable metadata and historical SQL parity.
- Canonical aggregate parity before/after, active roster, half-open date bounds, 35-day cap, outbound-only calls, nonnegative duration, appointment attribution/status behavior, win counts, premium fallback/annualization and cross-org protection.
- Real authenticated-role calls; anonymous denial; null/missing identity; database org overriding forged claims; raw-table RLS remains restrictive.
- At least two real sessions: same-org contention returns PT429 quickly; different-org requests and core CRM reads/writes remain available; releasing/rolling back/cancelling the holder permits subsequent standings work.
- Sustained small fixture burst: bounded expensive work, no advisory lock leakage or wait queue. Synthetic timing is not production capacity evidence.
- Re-pause blocks before business tables, retains the guard and exact metadata; drift/replay refusal leaves the function untouched.
- Targeted negative mutations for the lock, scope, preimage/metadata and re-pause checks; tests must fail for the relevant defect.
- Frontend gate/standings suites for PT429/PT503 compatibility; repository S1 gates and required root typecheck. No broad app rebuild is needed for SQL/test/docs-only changes.

## Production release boundary (not executed by this task)

After exact SQL review and Chris's approval: freshly verify main/release deployment, production definition and metadata, history and current load; apply only the new forward SQL through `apply_migration`; never bulk `db push` or replay the historical pause. Read back the returned migration version, recorded statement bytes, definition/metadata and absence of pause. Reconcile the repository filename/references to the actual migration version without editing the applied body.

Perform bounded authenticated-role read-only checks for Today/Week/Month and real signed-in UI checks of Leaderboard, Dashboard and TV. Existing five-minute maintenance holds can delay individual tabs; wait for the allowed retry or reload only an idle tab. Never reload an active call tab. Group is smoke-checked separately without changing its semantics.

Observe non-leaderboard latency/errors, DB lock waiters and long-running standings while users work; separate expected PT429 responses from unexpected errors. Establish the before/after comparison window and explicit stop thresholds in the verification record. If the approved stop criteria are crossed, apply the exact tested re-pause as a new migration if rollback execution is included in the approval; otherwise request that specific action. Record browser/load-test gaps honestly. This task does not declare production standings restored.

## Test environment adjustment (before test implementation)

The workspace cannot create/switch an unprivileged OS user, so a native PostgreSQL server cannot start here. Use a disposable PostgreSQL **17.6 service in GitHub Actions** for the real-session suite instead. Add `.github/workflows/leaderboard-backend.yml` to the exact file scope: read-only repository permissions, pinned existing action SHAs, locked dependencies with install scripts disabled, synthetic local database URL only, no Supabase/Vercel/production secrets and no deployment step. This is the only CI addition; existing workflows are unchanged. Local SQL prechecks may use PGlite, but they do not count as concurrency proof.
