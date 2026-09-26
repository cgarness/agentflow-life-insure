# Backend recovery verification and production release record

Status: **prepared; production pause remains active; real-session CI pending**.
See [implementation plan](implementation_plan.md). Base main is b3c0839bfec85a11d4977e893a746a94a4e96060.

## Exact proposed SQL

| Purpose | File | SHA-256 |
| --- | --- | --- |
| Forward, generated with locked Supabase CLI 2.84.5 | supabase/migrations/20260926045240_leaderboard_request_guard.sql | a3dd4ed3ac6a6b1adfe26f9f3c90b3d8cad47e49adc94164beb30615e22bb557 |
| Same reviewed source | supabase/ops/leaderboard_request_guard.sql | a3dd4ed3ac6a6b1adfe26f9f3c90b3d8cad47e49adc94164beb30615e22bb557 |
| Emergency re-pause, new-migration template only | supabase/ops/leaderboard_repause.sql | 4893c227610bd55474b880ff73eb9b9ab4d441ebe2584b34566074a7857d4028 |
| Historical pause, already applied; never replay | supabase/migrations/20260923224254_emergency_pause_org_leaderboard_20260923.sql | 12bfe5b433dbad4da7f673169a2620ebb0f9e6fd7659ab10539980d5b9b21594 |

The historical file equals the recorded production SQL statement byte-for-byte, including its lack of a terminal newline. The new migration and ops source are identical. No production command has applied them.

| Function state | MD5 of pg_get_functiondef |
| --- | --- |
| Original aggregate | d26a38b59de90db91ed777236ee4acc4 |
| Currently paused | 1314cefc781ff326540b83f748d48046 |
| Proposed guarded function | 8af04a4deed619788ee803df90d59205 |
| Emergency re-pause retaining guard | 75eec092f7039c2c8cb0cca93e93d1ae |

Both directions require the exact expected function definition and owner/ACL. Forward refuses original/unpaused, guarded, re-paused, missing or drifted functions. Re-pause accepts only the exact guarded function. Changing the function configuration, signature, body, owner or privileges requires re-review, not bypassing a check.

## Evidence collected before production changes

- Read-only metadata: PostgreSQL 17.6; paused function and migration match the recorded incident; owner/ACL/security/search path unchanged; authenticated and authenticator statement timeouts remain 8 seconds; existing organization/date call index present.
- Read-only activity sample: no other active client query, lock waiter or organization standings query over one second. No CPU/capacity claim.
- Local PGlite SQL precheck: historical pause, forward and re-pause execute and yield all expected definition hashes. This is syntax/catalog evidence only, **not** real-session lock or performance evidence.
- Frontend compatibility: **128/128** tests pass across request gate, leaderboard hook and Dashboard leaderboard widget. PT429 remains busy/backoff; PT503 remains maintenance.
- Node syntax check passes. Required root TypeScript command passes (known to check no app files); no TypeScript source or dependencies changed.
- Repository static S1 verifier **23/23**, self-test **5/5**, whitespace check pass.
- Real PostgreSQL 17.6 CI: pending. Do not approve production based on PGlite alone.

The separate Group RPC is unchanged (observed definition MD5 e1283b5b05d295c1d25888485cc08346). Its known metric/security differences and AgentScorecardModal follow-ups remain outside this change.

## Concrete release sequence requiring approval

1. Recheck the reviewed PR head, current main and frontend production deployment. Re-read target function definition, ACL/owner/config and migration history; require the paused hash above and no already-applied guard.
2. Capture a five-minute baseline of non-leaderboard API traffic latency/errors and database active/long-running queries. If there is no representative traffic, label the release lightly exercised and arrange a later busy-period check.
3. Apply **only** the exact forward source above with Supabase apply_migration to project jncvvsvckxhqgqvkppmj. No bulk migration push, no historical-pause replay, no RLS/grant/customer-data/telephony change.
4. Read back the actual returned migration version and statement bytes, guarded function hash and exact metadata. Record and reconcile the repository migration filename/references without changing applied SQL.
5. Run bounded authenticated-role read-only standings checks for Today, Week and Month. Verify same-org roster and representative totals against the preserved canonical metric definitions. Verify the normal signed-in Leaderboard page, Dashboard widget and TV; Group smoke check retains its existing semantics. No live test calls or synthetic production rows.
6. Observe two consecutive five-minute post-change windows. Separate expected PT429 busy responses from unexpected errors; require successful standings reads and stable non-leaderboard behavior.

Proposed stop conditions (include emergency re-pause authority in release approval):
- Any unexpected new permission/tenant leak, inconsistent metric result or failed definition/security read-back: stop and re-pause immediately.
- Any standings timeout, or two measured standings reads over 2 seconds: re-pause and investigate.
- Non-leaderboard p95 exceeds both 1 second and twice the baseline for two consecutive one-minute windows with at least 20 requests each: re-pause.
- Three or more unexpected non-leaderboard 5xx responses in a two-minute window when the baseline had none, or new persistent database lock waiters across two samples: re-pause and investigate. This conservative rollback does not assert causation.
- Insufficient traffic cannot establish a performance pass; report that limitation and continue the agreed observation during real use.

Re-pause applies only the exact tested template above through a **new** migration, after a fresh guarded-hash/ACL check. Read back the re-paused hash and PT503 behavior. It prevents subsequent aggregate starts; it does not cancel an aggregate already executing. Existing API statement timeouts remain the bound. Do not terminate sessions or change calling behavior.

The current frontend maintenance cooldown is about five minutes; an idle page may need to reach its allowed retry after release. Never refresh an active call tab.

## Review observations and limits

- The old #383 forward accepted an unpaused function; this forward requires the exact current paused state.
- The old re-pause recognized a marker without pinning the whole function/ACL. This one refuses body/security drift and verifies the exact resulting definition and metadata.
- The guard controls concurrent organization aggregates, not sequential request rate, other APIs or overall database capacity. Browser abort alone is not proof that server work ended.
- No production aggregate execution, live query-plan benchmark, authenticated browser test, multi-agent load test or production change is claimed in this preparation stage.
- No independent-agent review is claimed. PR #382/#383 remain untouched; this draft extracts and tests their backend concept without merging superseded frontend code.

References: [PostgreSQL 17 advisory locks](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS), [Supabase timeout documentation](https://supabase.com/docs/guides/database/postgres/timeouts), [Supabase changelog](https://supabase.com/changelog). No new platform feature or timeout setting is introduced.
