# Backend recovery verification and production release record

Status: **production backend reopened under Chris's explicit approval; live database checks passed; signed-in browser verification pending**.
Preparation-stage statements below are historical. See the production execution record at the end.
See [implementation plan](implementation_plan.md). Base main is b3c0839bfec85a11d4977e893a746a94a4e96060.

## Exact proposed SQL

| Purpose | File | SHA-256 |
| --- | --- | --- |
| Forward, generated with locked Supabase CLI 2.84.5 | supabase/migrations/20260926060304_leaderboard_request_guard.sql | a3dd4ed3ac6a6b1adfe26f9f3c90b3d8cad47e49adc94164beb30615e22bb557 |
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
- Real PostgreSQL 17.6 CI: **21/21 checks passed**, including three behavioral mutations caught. [Run 36219941710](https://github.com/cgarness/agentflow-life-insure/actions/runs/36219941710), job 108343170959, tested PR head 0119a3baeadaf271d280b6ac5f25f98421fb2a02 through merge ref 5b2f298e570c616c8aff775882f0ea7261e4b91c. Its tree is 4d542a0fc8bf859899401c43b5bc94cc579e57e7, identical to the prepared local tree and PR head.
- Actual database: PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1), x86_64. Production is PostgreSQL 17.6 aarch64; this is matching major/minor behavior, not production hardware equivalence.
- Real RPC contention returned PT429 in **3.47 ms** in the synthetic fixture. The 16-request same-org burst all returned PT429 with no advisory waiters or leaked locks; a different organization and authenticated CRM read/insert remained available. This is a concurrency contract check, not a multi-agent production capacity test.
- Commit, rollback and explicit cancellation of the holder all released the transaction guard. A READ ONLY transaction executed the STABLE RPC successfully. Re-pause returned PT503 while all business tables were exclusively locked by another fixture session, proving it stops before business lookups.
- Deliberate runtime defects detected: removed guard, per-user rather than per-organization key, and leaked session lock. Owner/ACL/body/missing-target/replay fault injections were rejected in both directions.
- Fresh read-only production read-back after CI still has paused hash 1314cefc781ff326540b83f748d48046 and unchanged owner/ACL/config/security/volatility; Group hash is also unchanged.

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

## As-built file scope and release status

The 12 changed files are the two root governance docs, root implementation_plan.md, the backend implementation plan and this verification record, the historical pause migration, CLI-generated forward migration, two ops scripts, synthetic SQL fixture, Node database test and the one read-only CI workflow. No src/, package/lockfile, deployed Edge Function or existing workflow changed. The final handoff commit adds documentation only; executable SQL/test/fixture/workflow content remains the tested version.

The branch was published through the connected GitHub API because shell git push had no GitHub credentials. API tree read-back matched the local tree exactly. Published preparation-plan commit: c7869d196e44d5cf8d0da1f0fe09bef2d9d56eb0 (local plan commit d8d0dc2e). Published implementation commit: 0119a3baeadaf271d280b6ac5f25f98421fb2a02 (same tree as local fad057f5). [Draft PR #387](https://github.com/cgarness/agentflow-life-insure/pull/387) is open and unmerged.

Approval requested only after review: merge PR #387, apply the exact forward SQL, perform the bounded read-only/signed-in verification and ten-minute observation, and authorize the exact re-pause template if the stated stop conditions occur. This approval would not authorize unrelated database changes or changes to PRs #382/#383. Git pushes/merges may trigger the existing Vercel preview/production builds; no application source changes are included.


## Production execution (2026-09-25 PT / 2026-09-26 UTC)

Chris explicitly approved merging PR #387, applying the exact tested recovery, performing live checks and ten minutes of observation, and using the tested re-pause if a documented stop condition occurs.

- PR #387 was merged at 2026-09-26 06:02:18 UTC as `545398cf7c90afc3bf12f28048930871db5f0491`. The merged tree `f3f153b68d2cfdb1d37a7f930850cef8d1478be4` exactly equals the approved head `fe43c5db`.
- The approved frontend was already READY on production `www.fflagent.com` at `b3c0839`; the Git-integrated deployment for the backend merge is also READY (`dpl_ACbFuQKdBS3A31xFVxKzw3UgkdWs`). No manual Vercel deployment was triggered.
- Applied only `leaderboard_request_guard` to project `jncvvsvckxhqgqvkppmj` at 06:03:04 UTC. Actual migration version: **20260926060304**. Its sole recorded statement equals the reviewed ops source byte-for-byte (SHA-256 unchanged above).
- The CLI-generated filename `20260926045240_leaderboard_request_guard.sql` is reconciled to `20260926060304_leaderboard_request_guard.sql`; no applied SQL bytes change. The test runner discovers this filename rather than hardcoding it.
- Immediate read-back: guarded definition MD5 `8af04a4deed619788ee803df90d59205`; owner, ACL, STABLE, SECURITY DEFINER and search path exactly preserved; anonymous EXECUTE remains denied. Group definition MD5 remains `e1283b5b05d295c1d25888485cc08346`.
- No customer-data writes, synthetic rows, live calls, grants/RLS edits, telephony changes, bulk migration push, historical-pause replay, or re-pause were performed.

### Live database verification

All reads used READ ONLY transactions with bounded statement/lock timeouts. Standings ran as `authenticated` with Chris's existing profile identity and organization; this verifies the database role/claims path, not browser authentication or an HTTP request. Date bounds match America/Los_Angeles and the frontend's Monday-start week.

| Period | Database execution time | Active agents | Calls | Appointments | Wins | Annualized premium | Talk seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Today (September 25 PT) | 98.641 ms | 7 | 339 | 4 | 0 | 0 | 5,831 |
| Week (from September 21 PT) | 226.346 ms | 7 | 955 | 7 | 0 | 0 | 19,601 |
| Month (from September 1 PT) | 46.995 ms | 7 | 2,002 | 31 | 2 | 2,004.24 | 39,124 |

Every result's agent IDs exactly match the organization's active roster. A separate bounded server-side canonical comparison at the identical month bounds matched calls, talk time, appointments, wins and premium exactly. This audit comparison is not a new frontend data source. The organization has no active agency-group membership, so a populated Group smoke check is not applicable for this account; its function was not changed.

The security advisor flags authenticated EXECUTE on the SECURITY DEFINER RPC as a generic exposure notice. This is the intentional existing aggregate contract documented in AGENT_RULES #23; authorization and ACL are unchanged and no grant was added.

### Observation and remaining verification

The five-minute pre-apply API baseline had 21 non-leaderboard requests, zero server errors, p95 origin time 1,394 ms and maximum 1,399 ms. Traffic is too light to establish busy-hour capacity.

The first two five-minute windows (06:03:04–06:08:04 and 06:08:04–06:13:04 UTC) were reviewed **retrospectively** after a long workspace delay while secure browser sign-in remained pending. They contained 27 and 21 non-leaderboard API requests respectively, zero server errors and no observed latency rollback trigger. No standings HTTP traffic was present. Database samples immediately after apply and at 15:30:44 UTC had no lock waiters or standings query over one second; the function hash remained correct. These sparse samples do not establish uninterrupted active monitoring during the delay.

A fresh bounded observation is being completed before handoff. The public production site and login form load. Secure email/password sign-in was requested once and remains pending; no signed-in Leaderboard, Dashboard or TV browser pass is claimed. Production has been reopened, but final user-visible verification and a representative busy-period check remain open.
