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
# Maintenance request correlation and avatar plan — September 26 UTC

This is a read-only follow-up to the approved Small resize, recorded at approximately 22:30 UTC. Organization standings remain paused; no new HTTP load probe, unpause, DDL, customer-data write, compute change or application edit was performed. The proposed implementation is in [latency_repair_plan.md](latency_repair_plan.md); approval is pending.

## Fresh catalog state

At **22:22:36.937 UTC**, a bounded READ ONLY catalog transaction confirmed current definition MD5 **`75eec092f7039c2c8cb0cca93e93d1ae`** and **zero lock waiters**. The inspected role/database-role settings contain no `pgrst.db_pre_request`; authenticator/authenticated statement timeouts are 8 seconds, anon 3 seconds. This does not rule out configuration in other hosted layers. Function tracking is off, so there is no new per-function execution-time attribution.

Profile SELECT policies include the permissive same-org `profiles_select_org` (`organization_id = get_user_org_id()`) and the hierarchical policy. No avatar Storage bucket exists. Nothing changed those policies, their helpers, buckets or profiles. The earlier read-only size evidence remains seven active profiles, three inline avatars, 5,961,926 total avatar text bytes, largest 3,115,174; image contents were not exported.

## Bounded historical log correlation

Queried exactly **21:10:24.926–21:20:24.926 UTC**, the existing post-resize observation interval. There are three outer standings POSTs and 18 PostgreSQL ERROR records with SQLSTATE PT503 as authenticator. Each database record's query and PL/pgSQL context identifies `get_org_leaderboard_stats`; full queries, JWT claims and private request headers were not exported. Multiple backend PIDs within each group distinguish repeated execution from a single duplicated record.

| HTTP response date (UTC) | Request ID | Origin ms | PG errors / span ms |
| --- | --- | ---: | ---: |
| 21:12:23 | `01a0df8f-d90c-7f7f-b984-87b8dd8e95f2` | 1,934 | 6 / 1,766 |
| 21:16:17 | `01a0df93-6bf2-7af0-abc6-d909af388415` | 1,825 | 6 / 1,747 |
| 21:17:17 | `01a0df94-557c-7d36-99e4-3b86e2910557` | 1,914 | 6 / 1,883 |

Every outer response logs `PostgREST; error=PT503` and gateway version `1`. Trace IDs equal the request ID with hyphens removed.

| Group | PostgreSQL UTC timestamps with process ID |
| --- | --- |
| 1 | 21:12:21.675 (3278), 21:12:21.795 (3284), 21:12:21.952 (3284), 21:12:22.027 (3283), 21:12:22.766 (3285), 21:12:23.441 (3286) |
| 2 | 21:16:15.786 (3367), 21:16:15.890 (3374), 21:16:15.979 (3375), 21:16:16.353 (3379), 21:16:16.878 (3381), 21:16:17.533 (3382) |
| 3 | 21:17:15.541 (3385), 21:17:15.649 (3396), 21:17:15.770 (3397), 21:17:16.113 (3399), 21:17:16.882 (3403), 21:17:17.424 (3404) |

**Inference:** strong evidence of repeated attempts below the outer browser HTTP boundary, spanning most of each maintenance response. This is timestamp correlation, not a shared request-ID join into PostgreSQL. The exact hosted retry layer is not established. Installed postgrest-js 2.98.0 calls fetch once; no application custom-fetch retry was found. These errors execute before the aggregate/photo read and do not demonstrate performance of a successful standings query.

**Decision:** preserve intentional HTTP503/PT503, its five-minute client hold and all original success-path stop thresholds. Do not treat the maintenance delay as proof another resize is required. Prepare a narrow payload/cache repair; the existing photo data remains protected and unchanged. If provider attribution is requested later, the table above is a nonsecret evidence packet; no support communication has been sent.

## Plan preparation verification

Only documentation is changed: root plan §15.5, new latency repair plan, this record and an additive WORK_LOG entry. Root `npx tsc --noEmit` exits 0 (known empty root project); S1 verifier passes 23/23 and its self-test 5/5. Whitespace checks and local document links pass. Removing only the new entry reconstructs every prior WORK_LOG byte (prior SHA-256 `44ba3918226beec3774a3d3f5c17272eefe805ff00898644c34d9e9942b5e246`). The exact four-document scope was checked. No implementation-test, repaired production latency, new build or reopening pass is claimed.

---

# Payload repair implemented and verified — September 26 UTC

## Authority, source and production state

Chris's 22:38:26 UTC “Continue” approved implementation/testing, following the plan-only commit on #390; approval commit `e5dffa35` preceded application edits. The later 23:06:26 UTC “Continue” kept final checks in scope. Production release was explicitly kept separate. [PR #391](https://github.com/cgarness/agentflow-life-insure/pull/391) is a draft stacked on documentation PR #390. Final executable-source commit **`da4b0b1be179416b33fa0655580aad852d9fa34b`**, tree `e2016b87f0991f256d30c0169fc00c89883a4ae2`, matches the locally tested tree. Main remains `e16a3c0181819e80cf608a0efa8aede428321e7e`; later commits on this branch only finalize records.

At **23:13:36.473 UTC**, a bounded READ ONLY check confirmed production org MD5 `75eec092f7039c2c8cb0cca93e93d1ae`, owner `postgres`, ACL `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`, STABLE SECURITY DEFINER, `search_path=public, pg_temp`, and zero lock waiters. This was not a call-free release check and does not authorize a later change. No repaired successful aggregate, profile-photo contents, production SQL apply, merge/deploy, compute change or dialing action occurred in this stage.

## Final frontend comparison

| Evidence | Result |
| --- | --- |
| Avatar cache / hook | 11 + 7 tests passed |
| Shared request gate | 28 tests passed |
| Leaderboard data hook | 55 tests passed |
| Dashboard widget | 49 tests passed |
| Page / TV and status surfaces | 17 + 14 tests passed |
| Total affected | **181 / 181** |
| Full final | **3,445 passed, one failed, two skipped**; 3,448 assertions |
| Comparable baseline | **3,421 passed, one failed, two skipped**; 3,424 assertions |
| Common assertions | No status changes; 24 new passing tests, one intentional name change |
| Failed-file set | Same 12 files as baseline |
| Real app typecheck | 90 existing diagnostics, no additions/removals after normalizing line/column offsets |
| Lint | Clean on all 12 changed TS/TSX files, `--max-warnings 0` |
| Build | Pass in 43.20 seconds; existing large-bundle warning |
| Root typecheck | Exit 0; known empty root project, not an app correctness gate |
| S1 verifier / self-test | 23 / 23 and 5 / 5 |

The initial baseline archive lacked Git history. Rerunning its four Git-history-dependent suites in a detached worktree exposed the same existing voicemail wiring failure as final; the table uses that corrected baseline. Eleven other files stop at missing Supabase configuration: `addLeadAssignmentGate`, `dialerCampaignPresenceHook`, `clientMapping`, `contactName`, `contactScope`, `leadDisposition`, `userLocalDayBounds`, `caller-id-selection`, `runtimeEventLogger`, `custom-fields-settings`, `dialer-api-attempt-cap`. `recordingRetentionVoicemail` has the single failed assertion about deployed-v29 handler wiring. No missing-env or historical failure was counted as a newly passing check.

The existing widget assertion named “reads NO raw clients/profiles” was restated to “loads metrics/roster from the org RPC and reads only protected profile photos separately.” This is the approved photo exception; metrics and roster still cannot come from raw profile/client reads. UI image tests render the actual page, widget, TV and Recent Wins under mocked transports; jsdom image completion is simulated. No authenticated production browser or network/load performance claim is made.

Ten frontend mutations were caught on an isolated copy: omitted RPC projection, missing org filter, expanded profile columns, reused cross-org cache, wrong timeout, ignored freshness, disabled memory cap, unloaded-roster eviction, skipped queued photos, and obsolete deferred timer. Each produced an intended assertion failure and was restored byte-for-byte. Review also verified photo-only updates leave ranking/celebration/status/Refresh behavior unchanged, with the existing midnight-straddle regressions retained. No independent-agent review was run.

## Real PostgreSQL verification and exact SQL

[Run 36278812457](https://github.com/cgarness/agentflow-life-insure/actions/runs/36278812457) succeeded on the final executable-source commit in the existing PostgreSQL 17.6 isolated CI service. It uses the same runner, fixture and SQL as the preceding passing run 36278137026: **32 tests, four behavioral mutations caught**. Synthetic seven-agent avatars exceed 6 MB, while projected standings remain below 16 KiB. All non-photo columns and ordering match for all three periods; profile-photo row hashes remain identical through all four transitions. Full function metadata/ACL/RLS, tenant/date validation, authenticated/cross-org/anonymous access, transaction lock lifetime and ordinary CRM progress pass. Every transition refuses body, owner or ACL drift, missing target and replay. Local cluster ownership was unavailable; no PostgreSQL protection was altered to bypass it.

| Source in `supabase/ops/` | Preimage MD5 → result MD5 | SHA-256 |
| --- | --- | --- |
| `leaderboard_payload_prepare.sql` | `75eec092f7039c2c8cb0cca93e93d1ae` → `41615c590703650c27ed41d164bcbfe4` | `2f7e91546549d7872cc1571bf04a0f57225f110cf96c1f0058cc03f4189cc891` |
| `leaderboard_payload_reopen.sql` | `41615c590703650c27ed41d164bcbfe4` → `c8b1f9d0c7cf5f8dfb7e437577029278` | `f652a81b02f89886652782a68e119062c463b0fe02ef95d3b25f146155ea3903` |
| `leaderboard_payload_repause.sql` | `c8b1f9d0c7cf5f8dfb7e437577029278` → `41615c590703650c27ed41d164bcbfe4` | `798063000e923eca9ccb407d80ea7b5c269bf30ed5ed947d9a19435ba84493b6` |
| `leaderboard_payload_restore.sql` | `41615c590703650c27ed41d164bcbfe4` → `75eec092f7039c2c8cb0cca93e93d1ae` | `093d42adb515e2d8543304a459db7879f8e66e4234188971c96603467492eee0` |

Preparation migration `20260926223934_leaderboard_payload_prepare.sql` is byte-identical to its source and **unapplied**. Reopening/re-pause/restoration each need their own new migration on approved execution; old migrations are immutable. The original active large-payload body is never a restoration target.

## Release decision and limits

The [payload plan §6 and §8.4](latency_repair_plan.md#6-staged-release-and-recovery-procedure--later-exact-approval) defines the next exact approval: merge #390 then retarget/merge #391, deploy the tested frontend while paused, apply prepare then reopen, and perform a ten-minute signed-in observation. Include conditional re-pause and paused restoration/frontend rollback if the repair must be removed. Before production work, freshly verify no active/nonterminal calls or fresh dialing sessions, provider health, pause/security and Group; defer unresolved activity or source drift. The read at 23:13 is not a substitute for that check.

Unchanged stop rules: any standings timeout; two successful standings HTTP responses over two seconds; ordinary REST p95 over one second and twice baseline in two consecutive one-minute windows with at least 20 requests each; at least three unexpected non-leaderboard 5xx in two minutes against zero baseline; new lock waiters persisting over two samples; or any security/scope/metric mismatch. Expected maintenance responses remain reported separately. A five-second photo timeout is a photo failure, not a successful-standings latency measurement.

Cold photo reads still transfer original large data URLs, with five-minute reuse and initials fallback. Stored photos, uploads, Group and permissions are unchanged. Real repaired API/browser latency, cold-photo experience and sustained production capacity remain unverified until the approved release stage. No provider support message, dependency/workflow change, second resize or relaxed threshold is included.

**Record integrity:** exact 24-file scope matches payload §4; all added local document links resolve; whitespace is clean. Only the five listed record files change after final executable-source commit. Removing the new implementation entry reconstructs all prior WORK_LOG bytes (SHA-256 `815c098a246eb278ff1c6cde5468d0c0e6f72d98147f94eee322465c0092baee`). The preparation migration and ops source are byte-identical.

---

---
# Payload release completed — September 26, 23:46 UTC

## Authorization, activity checks and deployment

Chris approved the exact staged release at **23:26:58 UTC / 16:26:58 PT**: merge #390/#391, deploy the tested frontend while paused, apply exact prepare/reopen, observe ten minutes, and conditionally re-pause/restore/roll back if a stop condition fired. Approval was recorded on PR #391 before execution.

Activity checks at 23:28:34.860, 23:30:56.027 and 23:33:35.159 UTC found zero recent nonterminal calls and zero fresh unended active dialer-session heartbeats; the preparation read at 23:35:02.438 reconfirmed both before reopening. Fresh sessions mean heartbeat within three minutes; recent calls mean created within two hours or updated within fifteen minutes, no end time and no terminal status. Old stale rows were not altered. Provider ACTIVE_HEALTHY; all exact function/security and Group checks matched, with zero lock waiters.

PR #390 merged at `4af2e5883ab252536750ef40ca7310e265241c20`. PR #391 was retargeted to main, marked ready and merged at **`775005cff965c3eb946a996bed313729db59eb2b`**. Its tree `5129794ef5c384ad561bc2b7c092af3d8c21f5ca` equals the approved/tested release tree. Git-integrated Vercel production **`dpl_HPuZtNbMjSsSrHqZZuGp2ZbBxKhM`** is READY at `www.fflagent.com`; it built at 23:31:25.481 and was ready at 23:31:53.790 UTC. Framework Vite, region iad1. No manual duplicate deployment was triggered.

Previous app deployment: `dpl_AgVz7LGxuXKTiQaabrSju4wEYdfp` at main e16a3c01. The immediately preceding documentation-only deployment `dpl_9p6VwyRHAx8D9YvDrVCYyiDkrpAN` contains the same previous app source. A deliberate reload after deployment still showed maintenance and a 16:37 PT next check. That hold was allowed to expire; no cooldown bypass.

## Applied SQL and read-back

| Applied migration | Definition result | Stored statement SHA-256 |
| --- | --- | --- |
| `20260926233422_leaderboard_payload_prepare` | Lean paused `41615c590703650c27ed41d164bcbfe4` | `2f7e91546549d7872cc1571bf04a0f57225f110cf96c1f0058cc03f4189cc891` |
| `20260926233524_leaderboard_payload_reopen` | Lean active `c8b1f9d0c7cf5f8dfb7e437577029278` | `f652a81b02f89886652782a68e119062c463b0fe02ef95d3b25f146155ea3903` |

Each is one stored statement, byte-identical to the approved ops source. The earlier CLI filenames were reconciled to the provider's actual versions, with no SQL edit. Preparation preserved authenticated PT503. The 23:35:49.801 and 23:46:01.287 metadata reads confirmed owner postgres, ACL `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`, STABLE SECURITY DEFINER, `search_path=public, pg_temp`, anonymous execute denied and authenticated execute allowed. Group definition stays `e1283b5b05d295c1d25888485cc08346`. No customer-photo/source data, role/grant/RLS, compute, pool, SDK, telemetry or dialing change was made.

A bounded authenticated-role Month read returned seven agents, zero non-null inline avatars, 2,059 calls, 34 appointments, two policies and annualized premium 2,004.24. Its projected JSON **text** is 1,657 bytes. This is a database serialization check, not measured HTTP transfer bytes.

## Signed-in behavior

Today, Week and Month settled successfully. Calls Made ranked Alexa 815, Will 469, Teo 367, Desiree 216, Keenyun 170, Chris 21 and chris t. 1 for Month (sum 2,059). The three stored images decoded; other agents displayed initials. TV Month totals matched the database (2,059 / 2 / $2,004 rounded / 34); TV Week showed 1,012 calls, zero policies, $0 and ten appointments. Dashboard initial reads and one allowed Refresh completed, with standings and all sections visible and no failure notices. Photo reuse survived metric/period/TV/Dashboard navigation; the next photo GET followed the five-minute freshness interval.

The final UI had no status/error notices and all three photo identities decoded. Screenshot `agentflow-leaderboard-restored-20260926.jpg` is saved for Chris. No customer-contact export or original photo data was added to Git. The validation tab was closed after the observation to stop agent-generated polling. No Group selector was available in this account; Group verification is its unchanged definition/security and existing tests, not a claimed live Group interaction.

## Exact ten-minute API observation

**23:36:00–23:46:00 UTC**, plus the immediate post-reopen integrity check recorded above. All times below are API origin times, not end-to-end browser rendering times.

| Traffic | Requests | Result | Origin latency |
| --- | ---: | --- | --- |
| Standings POST | 22 | All HTTP 200; none requested avatar column | min 34 ms / p95 65 ms / max 151 ms |
| Other REST, including photos | 234 (216 non-OPTIONS) | All HTTP 200 | non-OPTIONS p95 153 ms / max 642 ms |
| Protected photo GET, subset of other REST | 2 | Both HTTP 200 | 198 ms first / 187 ms after freshness expiry |

Pre-release baseline **23:26:00–23:31:00 UTC**: 172 other REST requests, all 200 (116 non-OPTIONS), non-OPTIONS p95 186 ms. One expected paused standings POST was 503 at 1,201 ms. Traffic mixes differ; do not present this as a paired load benchmark.

| UTC minute | Standings POSTs / max ms | Other REST non-OPTIONS / p95 ms |
| --- | ---: | ---: |
| 23:36 | 0 / — | 17 / 161 |
| 23:37 | 1 / 54 | 10 / 198 |
| 23:38 | 4 / 59 | 23 / 107 |
| 23:39 | 3 / 63 | 15 / 104 |
| 23:40 | 3 / 64 | 21 / 637 |
| 23:41 | 2 / 151 | 61 / 146 |
| 23:42 | 2 / 63 | 24 / 107 |
| 23:43 | 3 / 65 | 11 / 152 |
| 23:44 | 2 / 65 | 20 / 155 |
| 23:45 | 2 / 59 | 14 / 96 |

No standings timeout or successful response over two seconds occurred. Every ordinary REST minute was below the one-second p95 floor; several minutes had fewer than the required 20 non-OPTIONS requests, so those sparse minutes cannot establish busy-period capacity. No unexpected server error, PT429, scope/security/metric mismatch, or persistent lock waiter appeared. Lock samples at 23:35:49, 23:39:53, 23:41:10, 23:44:49 and 23:46:01 were all zero, with 17 / 24 / 22 / 29 / 29 connections.

Standings/photo response Content-Length headers are absent in these logs. Do not call the returned blank values zero-byte responses or claim a measured wire-size reduction. The real projection, null-returning body, small database JSON and decoded photos establish separation; transport byte size remains unmeasured. The first combined summary/minute log query returned a logs-service backend error; separate bounded queries succeeded. This was not an app HTTP failure.

## Outcome, recovery and release-record checks

**All release stop rules passed; organization standings remain live.** No re-pause/restoration or additional resize was needed. The exact tested payload re-pause accepts only active `c8b1f9d0c7cf5f8dfb7e437577029278` and returns `41615c590703650c27ed41d164bcbfe4`; only then may the tested restore return original paused `75eec092f7039c2c8cb0cca93e93d1ae`. Do not reuse old-preimage recovery scripts or restore the original large-payload active body.

The post-DDL security advisor flags authenticated execution of `get_org_leaderboard_stats` as a SECURITY DEFINER exposure. This is its existing, required aggregate API contract: unchanged explicit authenticated grant, database-derived tenant, auth/date checks, pinned search path and anonymous denial, all compared directly and tested. No new permission was granted or advisory suppressed. Unrelated project findings remain outside this release. [Supabase advisor reference](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Record-only follow-up scope: five documentation files, the preparation migration filename reconciliation, and the new applied reopen migration. App/ops/test/fixture sources are unchanged from the tested release. Root tsc exits 0 (known empty project), S1 verifier 23/23 and self-test 5/5; migration/source byte parity and whitespace checks pass. The 181 frontend tests, 32 PostgreSQL tests, 14 combined mutations and unchanged baseline test/typecheck failures are those of the release packet; no new full frontend-suite run is claimed for record changes. Existing CI verifies the reconciled migration record before merge. All prior WORK_LOG bytes remain intact.

This is a successful bounded release check, not a high-concurrency or busy-period load certification. Stored images remain large on a cold photo read; five-minute reuse and initials fallback remain intentional. The maintenance-path repeated-attempt finding is unchanged and needs no gateway/status workaround in this release.
