# Reports cleanup — pending release

Base production: 40e2a962 / contract 3.3.0 / 376 history rows, latest 20261105120044. Chris approved development; no production SQL or frontend release is authorized yet. Draft PR #522.

Contract 3.4.0 changes only the two v3 initiated-attempt classifiers and the contract-version marker, plus the new private canonical-sale premium guard. All existing reader ACLs and row policies are preserved. UI uses Calls, no Partial badges, and details under How it’s calculated. Usable appointment denominators already exist and are unchanged. Historical unknown data is excluded from its affected calculation, not zero-filled or backfilled.

## Verification/release order

1. Native PostgreSQL 17.6 must pass apply, classifier/premium tests, exact 97-function closure enable, scoped readback, exact rollback, original enable and original readback. Complete frontend exact-base comparison and native writer/idempotency/refusal regressions. No production data is used.
2. Review final exact diff and SHA-256 of the pending migration; refresh live preimages, migration history and conflicting work. This draft does not authorize applying the migration.
3. Separately approved production DB action: apply the final migration once, read back with reports_cleanup_readback.sql (including explicitly authorized role simulation), run advisors and verify migration history. No customer correction or rollback test in production.
4. Separately approved frontend merge/release only after backend success. Verify both production projects, source identities and live assets. The frontend basis copy describes contract 3.4.0.

## Recovery

Old A–D scripts remain immutable historical packages. While 3.4.0 is installed, reports_cleanup_enable.sql is the exact pinned re-enable and reports_cleanup_readback.sql is the matching verification. The original disable-only script remains applicable; it revokes readers without changing data. Never use the old enable/readback for 3.4.0.

Any rollback requires separate approval: restore the prior frontend, run reports_cleanup_rollback.sql only on exact postimages, then original reports_v3_enable.sql/readback. Rollback restores all three original function bodies and removes only the new premium insert guard. It changes no calls, policy sales, outcomes or premiums. A re-forward requires a newly reviewed migration, not replay of the recorded version.

## Limits

Dashboard/Leaderboard definitions are unchanged. Existing baseline type/test failures and accepted Reports performance/history exceptions remain documented. No live-user test or production call is authorized. Historical premium discrepancies remain unchanged. Native writer/retry and full release/rollback coverage passed in run 42574839515 at 05964e2. Final hosted frontend/browser checks remain a release blocker.
