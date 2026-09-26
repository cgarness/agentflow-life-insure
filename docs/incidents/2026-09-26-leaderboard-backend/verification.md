# Backend recovery verification and production release record

Status: **production organization standings re-paused at 16:32:24 UTC on September 26 under the approved latency stop rule. Signed-in Dashboard, Leaderboard and TV functional checks passed; recovery is not complete.**
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

A fresh ten-minute observation completed **15:32:02.927–15:42:02.927 UTC**. Each consecutive five-minute window had one non-leaderboard API request (origin times 1,017 ms and 1,014 ms), zero server errors and no standings HTTP traffic. Database samples at 15:32:34, 15:34:54, 15:37:04, 15:39:10 and 15:42:04 had zero lock waiters and zero standings queries over one second; active client queries ranged from zero to one. Final function hash remains correct. A final authenticated-role month read at 15:40:30 took **419.357 ms**, with the same roster and totals. No re-pause condition occurred. This sparse traffic cannot establish busy-period capacity.

The public production site and login form load. The one secure sign-in request timed out; fresh navigation still shows the login form. Signed-in Leaderboard, Dashboard and TV verification is **blocked on user sign-in**, not passed. A manual browser handoff is offered for that remaining check. The recovery is live; signed-in visual verification and representative busy-period validation remain open.

The reconciled filename passed PostgreSQL 17.6 CI: [run 36252367967](https://github.com/cgarness/agentflow-life-insure/actions/runs/36252367967), 21/21 checks and three behavioral mutations caught. Its summary reports `20260926060304_leaderboard_request_guard.sql` and unchanged SQL hashes. Release bookkeeping is PR #388; executable content is unchanged.

## Signed-in verification and authorized latency rollback (September 26 UTC)

This section supersedes the pending-browser and reopened-production status above. Secure browser sign-in succeeded. Verification used the real signed-in production application at `https://www.fflagent.com`, with deployment `dpl_Ep5GyJF7SmFomLYVdWAyp7RkBt4V` READY at main `7126ce1f9ce0b4b6158a687d0d220dcb0e5e0d7d` after release-record PR #388.

### Functional browser results

- Dashboard: the monthly leaderboard widget loaded Alexa Segura. One manual Refresh showed disabled `Refreshing… dashboard`, preserved existing section contents during the load, and completed without a section error. The cooldown returned. The widget loaded again after returning from the Leaderboard page.
- Leaderboard: Today, This Week and This Month settled successfully; the seven-agent roster and Recent Wins loaded. Today is now September 26, so its zero activity is not compared with the September 25 database sample. Monthly policies showed Alexa with 2; switching to Calls Made ranked Alexa 810, Will 469 and Teo 329, followed by 203, 170, 21 and 0 (2,002 total).
- TV: opened successfully, with Month totals of 2,002 calls, 2 policies, $2,004 displayed annualized premium and 31 appointments. Switching to Week showed loading copy, then 955 calls, 0 policies, $0 premium and 7 appointments. These settled totals match the canonical database checks. The normal page was restored successfully.
- No active call tab was refreshed, no call was placed, and no synthetic or customer-data write was performed. Populated Group remains not applicable to this account.

### Latency stop condition

The final log window was **16:19:38–16:31:59.380 UTC**. There were **20 organization-standings POST requests, all HTTP 200**, plus one successful OPTIONS preflight. No PT429 or unexpected standings server error occurred. Three POST responses nevertheless exceeded the approved two-second threshold:

| Log timestamp (UTC) | HTTP status | Origin time |
| --- | --- | --- |
| 16:23:55.773 | 200 | 2,734 ms |
| 16:30:10.290 | 200 | 3,574 ms |
| 16:30:38.544 | 200 | 4,481 ms |

The 16:30:05 checkpoint contained only the first slow response; the final checkpoint exposed the two additional slow responses. That met the explicit **two measured standings reads over 2 seconds** stop condition. Origin time is HTTP/API evidence, not isolated database execution time. Successful responses do not waive this criterion.

The same window contained 205 other REST requests (including any preflights), all HTTP 200, p95 origin time 1,481 ms, maximum 1,801 ms. This did not meet the non-leaderboard latency/error trigger and does not establish busy-period capacity. Database samples at 16:29:48 and 16:33:01 showed zero lock waiters and zero standings queries over one second.

### Exact rollback and read-back

- Fresh preflight at 16:32:17 confirmed guarded hash `8af04a4deed619788ee803df90d59205` and the exact original owner/ACL/configuration.
- Applied the already-approved, unchanged `supabase/ops/leaderboard_repause.sql` as the **new** migration `20260926163224_leaderboard_repause_latency_gate` at 16:32:24. SHA-256: `4893c227610bd55474b880ff73eb9b9ab4d441ebe2584b34566074a7857d4028`.
- The sole recorded production statement equals the ops source byte-for-byte. CLI generated the local file at version `20260926163440`; its filename was reconciled to the actual production version without modifying SQL bytes.
- Read-back confirmed re-paused hash `75eec092f7039c2c8cb0cca93e93d1ae`, unchanged owner/ACL/search path/STABLE/SECURITY DEFINER, and unchanged Group hash `e1283b5b05d295c1d25888485cc08346`. The concurrency guard remains installed.
- A bounded READ ONLY authenticated-role call returned expected `PT503: Standings temporarily paused`. The real browser then displayed `Standings are paused for maintenance.` with its automatic retry time, not a zero podium or endless spinner.
- No sessions were terminated and no timeout, route, RLS, grant, customer data, telephony, Edge Function or application source was changed. Future aggregate starts are blocked; the re-pause does not cancel work already in flight.

### Read-only investigation and next diagnostic step

The PostgreSQL logs covering the slow-response period contained 28 LOG records with SQLSTATE 00000 and no reported error severity. This is not proof of fast execution. Function timing is disabled (`track_functions=none`), and `pg_stat_statements.track=top` exposes cumulative statement statistics rather than per-request traces. The normalized authenticated HTTP RPC statement has 3,830 historical successful executions, mean 494.539 ms and maximum 7,854.356 ms; those values cannot attribute any of the three new slow requests.

A bounded **EXPLAIN without ANALYZE** of the unchanged monthly aggregate uses `idx_calls_org_created_at`; no aggregate was executed around the pause. Its estimated total cost is 208.68. Catalog estimates are small (calls about 2,988 rows; other source tables a few pages), and JIT is off. These facts do not justify an index, timeout, pool-size or metric change by themselves. The security advisor repeats the intentional authenticated SECURITY DEFINER exposure notice; the tenant check and ACL remain intact ([advisor description](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)).

Post-rollback evidence narrows the investigation: two expected HTTP 503 maintenance responses took **2,800 and 3,294 ms** after the pause was restored. They cannot have run the standings aggregate because the verified pause raises before business lookups. A separate bounded authenticated-role invocation measured that same PT503 path at **3.397 ms inside PostgreSQL** at 16:43:54 UTC. These are different requests, not a paired trace, so they do not prove which API/pool/host component accounts for the delay or how much of the earlier successful requests was database execution. They do show that aggregate work alone cannot explain slow HTTP responses.

Next, inspect [Supabase API and database Reports](https://supabase.com/docs/guides/observability/reports) for gateway response speed, database CPU/connections and PostgREST pool/host pressure while the pause stays active. Do not add an index, raise timeouts or reopen solely on the basis of this unpaired comparison. Before any subsequently approved reopening, prepare a bounded timing comparison: capture the normalized RPC's cumulative call/execution counters immediately before and after one authenticated HTTP read, correlate its log timestamp and origin time, and require an isolated one-call delta; discard ambiguous deltas without resetting shared statistics. Pair this with API pool/host metrics. If database time dominates, reproduce and optimize the unchanged metric query on a representative isolated fixture. If the API gap dominates, investigate that path before changing SQL. Preserve the same rollback criteria. A further production reopening or instrumentation/configuration change requires approval of that concrete change; the current approval covered this completed release and its conditional rollback.

This follow-up records the exact already-applied rollback migration and updates the two plans, AGENT_RULES and WORK_LOG. It introduces no new recovery SQL or frontend implementation. Production organization standings remain paused; the frontend fixes remain deployed.

Local record checks pass: new migration equals the already-tested ops source and recorded production SQL; root TypeScript command exits 0 (known empty project); S1 verifier 23/23 and self-test 5/5; whitespace check clean; every previous WORK_LOG byte preserved. No app typecheck, full frontend suite or rebuild is claimed for this unchanged application source.

Record PR #389's initial head `d890e803` passed the existing PostgreSQL workflow [run 36256427003](https://github.com/cgarness/agentflow-life-insure/actions/runs/36256427003), job 108443963322. The subsequent documentation addition records only the post-pause timing clue; executable content is identical.

## Capacity and response-size diagnosis (September 26, after re-pause)

PR #389 merged as `e16a3c0181819e80cf608a0efa8aede428321e7e`; its final tree `f35e3fe653d77211c7d1ca4e943ae4ffa5244c54` equals the verified local tree. Final PostgreSQL run 36256649980 / job 108444582911 passed 21 checks and caught three behavioral mutations. The following investigation made no further production mutation.

Authenticated Supabase Infrastructure shows AGENTFLOW CRM on Nano / t4g.nano / us-east-1, up to 0.5 GB memory. The 08:52–09:52 America/Los_Angeles database report has a large persistent Swap segment (approximately 0.65–0.8 GB, visually estimated), about 0.4 GB physical memory, 1.96 GB memory commitment and 9.83% CPU headline. Pool and disk time series failed to load after one report refresh. Swap allocation is not paging activity; these observations motivate a controlled capacity test but do not prove the slow-response cause. Overview connections were 21/60; a separate SQL snapshot found nine idle PostgREST connections and no lock waiters.

A three-second-bounded READ ONLY size query over Chris's organization's active profiles returned seven agents, three inline `data:` avatars, sum `octet_length(avatar_url)` **5,961,926**, largest **3,115,174**. Avatar contents were not exported. The canonical RPC emits `p.avatar_url`, and both organization standings consumers request its full result, so this text is repeated in each successful current roster response. This is logical content size, not measured compressed wire bytes. The two existing upload components use `readAsDataURL`; the team-profile roster already deliberately excludes this field. Slow maintenance responses contain no such payload, so this defect is not a complete explanation of the incident.

The final Supabase resize review is prepared but **not submitted**: Nano → Small, $0.01344 → $0.0206/hour, estimated $9.68 → $14.83/month (+$5.15), excluding tax. The confirmation lists only the compute change and explicitly warns that this project may require longer downtime than normal. Micro (1 GB) is offered at the same current hourly price. The [capacity plan](capacity_plan.md) records the recommended Small (2 GB) test, alternatives, exact execution/verification, uncertainty and approval boundary. Production remains on Nano with organization standings paused; no avatar or application change was made.

### Approved resize preflight: deferred for recent call activity

Chris approved the resize at 17:09:12 UTC. Provider status was ACTIVE_HEALTHY and the pending review still matched the exact approved change. At 17:10:39.949 UTC, production's paused function hash, owner/ACL/config/STABLE/SECURITY DEFINER and migration record all matched. The current instance remained t4g.nano.

The call-free gate did not pass: a recent Alexa outbound call started at 17:07:08.87 UTC and still showed `ringing`, `ended_at=null`, last update 17:07:24.111, at a targeted 17:11:17 UTC read. Four preceding calls in the last fifteen minutes were completed. Six open sessions had stale heartbeats (none within three minutes), which cannot overrule the recent call evidence. Old inbound ringing rows also exist, but no telephony cleanup or state rewrite is part of this task. No provider-level terminal status is available to resolve the recent call's uncertainty.

The bounded baseline 17:05:19.658–17:10:19.658 UTC contained one expected standings POST 503 at 1,580 ms and 196 other REST requests, all 2xx, including twelve OPTIONS; 139 ordinary GETs had p95 120.1 ms and max 1,034 ms. Separate database activity sample: zero lock waiters, thirteen client connections. This is not a post-resize measurement.

**Result: approved but not applied.** The final confirmation was not pressed. Production is still Nano, standings remain paused and no active work was interrupted. The approved plan requires a call-free window or resolution of uncertain active-call state, followed by a fresh preflight. The existing cost/configuration approval remains valid.

## Approved Small resize executed (September 26 UTC)

### Authority, preflight and application

Chris confirmed the earlier call was real and asked us to hold, then renewed the maintenance window and required a fresh dialing check. At 20:59:56 UTC the earlier blocker was completed (ended 18:16:29.072 UTC). A 21:01:37.555 check found no recent nonterminal calls and no unended active dialer session with a heartbeat within three minutes; three registered phones did not itself establish dialing. The final check immediately before confirmation, **21:07:03.673 UTC**, again found both activity counts zero. Another call had ended at **21:06:35.498 UTC**. Old inbound ringing rows/stale sessions were not changed. Pause hash/security matched, zero lock waiters and 22 client connections.

The signed-in final review listed only Nano → Small, $0.01344 → $0.0206/hour, $9.68 → $14.83/month estimate (+$5.15), before tax, with the previously approved automatic-restart/longer-downtime warning. **Confirm changes was pressed once at 21:07:20.458 UTC.** Provider status became RESIZING; no second resize/restart was sent. The database start time was **21:09:57.156 UTC**. By **21:10:24 UTC**, provider status was ACTIVE_HEALTHY and Infrastructure showed **t4g.small / Small / 2 GB**, with the same disk (8 GB gp3, 3,000 IOPS, 125 MB/s), spend cap and region. Its displayed connection ceiling automatically changed from 60 to 90 with the tier; no manual pool configuration was changed. The observed confirmation-to-verified-healthy interval was about three minutes, not a precisely measured all-client outage duration.

PostgreSQL remains **17.6**, provider build **17.6.1.063**. The recovered function matches `75eec092f7039c2c8cb0cca93e93d1ae`; owner postgres, original `{postgres,authenticated,service_role}` ACL, STABLE, SECURITY DEFINER, `search_path=public, pg_temp`, anon denied and authenticated execute allowed. Existing migrations `20260926060304` and `20260926163224` remain recorded. Final Group definition hash remains `e1283b5b05d295c1d25888485cc08346`. No SQL migration/data write, customer call, session termination, avatar edit, grant/RLS change or frontend deployment was performed by this task.

### Bounded comparison

Before: **20:56:43.464–21:01:43.464 UTC**, 131 non-leaderboard REST requests, all 2xx (29 OPTIONS); no standings POST was present in that window. After: **21:10:24.926–21:20:24.926 UTC**, split exactly at 21:15:24.926. These are gateway **origin times**, not browser end-to-end timings. Traffic mix and sample sizes differ; this is not a paired benchmark or load test.

| REST measurement | Before, five minutes | After, first five minutes | After, second five minutes |
| --- | --- | --- | --- |
| Non-leaderboard requests, all 2xx | 131 | 439 | 594 |
| Included OPTIONS | 29 | 59 | 91 |
| Ordinary GET count | 42 | 256 | 348 |
| GET mean / p95 / max, ms | 733.048 / 1,703.15 / 1,890 | 88.770 / 212.25 / 375 | 93.483 / 345 / 455 |
| HEAD count / p95, ms | 22 / 1,111.05 | 47 / 234.5 | 62 / 214.75 |
| Standings POSTs (expected 503) | None | 1 at 1,934 ms | 2 at 1,825 / 1,914 ms |

All **1,033 non-leaderboard REST requests** in the ten-minute post-recovery window succeeded (883 excluding OPTIONS). The three maintenance POSTs are expected 503s, not unexpected server errors. No active standings response was generated around the pause. Only ordinary signed-in reads and one Dashboard Refresh were used; no retry/cooldown bypass or load loop was run. Our test page was navigated away after evidence collection so it would not continue polling. Other users' ordinary traffic is included in the log counts, including their normal writes; those were not writes performed for this verification.

The browser authentication step delayed the intended midpoint SQL/browser checkpoint: the first-half log window was inspected at about 21:18, and the SQL checkpoint was **21:18:09.061**, not at 21:15. Recovery / delayed-midpoint / final SQL samples at 21:10:24.046 / 21:18:09.061 / 21:20:50.149 found **zero lock waiters** and **16 / 19 / 23 client connections**. This evidence does not establish uninterrupted monitoring. Final provider status remained ACTIVE_HEALTHY and the pause hash remained unchanged.

### Restart interval, UI and host evidence

The planned restart interval **21:07:20.458–21:10:24.926 UTC** was excluded from the steady-state comparison, but its errors were retained: 253 gateway log records contained **74 HTTP 521s, eight 522s and two REST 503s**. Of these 84 responses, 81 were REST and three Auth; the two 503s were not separately attributed. This is request-level interruption evidence, not 84 lost writes or calls. A successful HEAD in that interval had 27,709 ms origin time. Do not describe the operation as having no downtime or no errors.

The real signed-in Dashboard settled with all sections loaded, one explicit bounded Refresh completed and its normal cooldown returned, and the leaderboard widget stayed paused with Retry held until 14:22 PT. Navigating to the full Leaderboard showed the same maintenance notice and next-check time without loading standings. No Dialer/call action or customer edit was used. The provider screenshot `AgentFlow-Small-compute-applied-2026-09-26.jpg` records the applied t4g.small configuration and is saved with the user-facing handoff.

The 13:18–14:18 PT memory chart shows the Nano-era Swap segment disappearing from the visible post-restart bars, with a larger physical-memory/cache/free allocation. This is a visual trend, not an exact zero-swap or swap-in/out measurement. The final refreshed 13:20–14:20 PT report headlines were **1.64 GB memory commitment** and **3.49% CPU**. Disk/network/pool/connection time series still failed to load after one report refresh, so no claim is made about those series. Disk settings and bounded SQL connection/lock samples were independently verified.

### Result and remaining boundary

**Basic resize/recovery: PASS. Leaderboard reopening/capacity: NOT TESTED.** Ordinary CRM reads were faster in these samples and the host chart improved, but the full aggregate and almost-6 MB inline avatar output remained paused. Three maintenance responses near two seconds do not establish adequate headroom or explain the API-path delay. Keep production standings paused at the existing exact definition; the original forward script must continue refusing this guarded-and-paused preimage.

Next: isolate the remaining maintenance API-path timing with bounded read-only evidence and prepare a photograph-preserving avatar-payload repair. A code/data/configuration change or newly tested exact reopening requires separate approval; no automatic downsize, pause bypass, timeout increase or relaxed stop rule is authorized. This record changes only the four PR #390 documentation files. Final local record checks are recorded in the accompanying WORK_LOG entry; no new application build, frontend suite or successful full standings performance check is claimed.
