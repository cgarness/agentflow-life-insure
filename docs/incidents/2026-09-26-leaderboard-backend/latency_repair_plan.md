# Organization leaderboard payload repair — implementation and release record

Prepared September 26, 2026 UTC for Chris Garness. **Status: approved production release applied; signed-in checks and the ten-minute observation passed. Production organization standings are live.**

Sections 1–8 preserve the approved preparation/release packet. Section 9 records the subsequent authorization, exact applied versions and final production outcome.

Chris said “Continue” at 15:38:26 PT / 22:38:26 UTC after the plan was completed and the implementation approval boundary was stated. This authorized building and testing on `codex/leaderboard-photo-payload-20260926`; production migration, merge/deploy and reopening remain separate. The plan-only tree was published on PR #390 at `939b0692`, followed by approval commit `e5dffa35` before application edits. The CLI-generated preparation filename `supabase/migrations/20260926223934_leaderboard_payload_prepare.sql` was recorded before its body was implemented. PR #391 contains the implementation and is stacked on the documentation branch of #390.

## 1. Outcome and authority

Make recurring organization standings responses contain names and numbers, with photos loaded separately through existing permissions and reused in memory. Preserve all rankings, canonical metrics, photos, Group behavior and maintenance protections. Then assess a separately approved reopening against the original production stop rules.

The initial “Let's begin” authorized diagnosis and plan preparation. The later “Continue” approved implementation under AGENT_RULES §8, as recorded above. That permits local code/SQL preparation, synthetic tests, branch commits and a draft PR. It does **not** apply SQL, merge/deploy application code, restart the project or reopen production. The tested commit, SQL digests, resulting function hashes and rollback evidence are now recorded in §8 for the separate release decision.

Current project: `jncvvsvckxhqgqvkppmj`, Small / 2 GB. Main was `e16a3c0181819e80cf608a0efa8aede428321e7e` when this investigation began. The current function definition is `75eec092f7039c2c8cb0cca93e93d1ae` (guarded and paused). A bounded catalog read at 22:22:36.937 UTC confirmed it and zero lock waiters. No aggregate was executed around the pause.

## 2. Findings and what they establish

### Maintenance requests repeat below the browser boundary

In the exact post-resize window 21:10:24.926–21:20:24.926 UTC, three outer POSTs to `get_org_leaderboard_stats` correspond in time to three groups of **six** PostgreSQL PT503 error records. Each database record identifies this function in both its query and PL/pgSQL context. Each group includes multiple backend process IDs; these are not six copies of a single log entry.

| HTTP response date (UTC) | Origin time | Database errors | First → last database error (UTC) | Error span |
| --- | ---: | ---: | --- | ---: |
| 21:12:23 | 1,934 ms | 6 | 21:12:21.675 → 21:12:23.441 | 1,766 ms |
| 21:16:17 | 1,825 ms | 6 | 21:16:15.786 → 21:16:17.533 | 1,747 ms |
| 21:17:17 | 1,914 ms | 6 | 21:17:15.541 → 21:17:17.424 | 1,883 ms |

This strongly supports retry amplification below the outer HTTP request boundary as a substantial contributor to the maintenance delay. It is a temporal correlation, not a request-ID join between gateway and PostgreSQL traces. It does not identify the responsible hosted component or explain earlier slow **successful** responses. The installed postgrest-js 2.98.0 calls its fetch once and has no automatic retry loop; the frontend then observes its maintenance hold. No role/database-role `pgrst.db_pre_request` setting was found in the inspected catalog; that does not exclude every hosted configuration source.

Keep HTTP 503 / body `PT503` and the five-minute hold. Do not switch to 200 or an arbitrary 4xx to improve measurements, disable project-wide retries, upgrade the SDK, or raise timeouts. The request IDs and bounded log evidence are in [verification.md](verification.md#maintenance-request-correlation-and-avatar-plan-september-26-utc), ready for a provider inquiry if Chris requests one. No support message has been sent. Default Kong behavior documented by Kong does not prove the hosted Supabase implementation; do not label this a proven Kong bug.

The maintenance-only delay is no longer evidence by itself that another compute upgrade is needed. The earlier successful responses that crossed the stop rule still require a real success-path verification after an approved repair and reopening. No stop threshold is relaxed.

### Photos are repeatedly embedded in successful standings

Seven active profiles in the affected organization contain three inline avatars totaling **5,961,926 text bytes**, largest **3,115,174**. These are stored-text sizes, not compressed network measurements. Both organization consumers request the full RPC result on every refresh, including `avatar_url`. The function's final SELECT reads `p.avatar_url`; a client projection alone does not establish that the function avoids constructing that large output.

Both existing upload paths store data URLs in `profiles.avatar_url`. There is no avatar Storage bucket. Reusing an unrelated public bucket or migrating images would add ownership/privacy and data-recovery scope. Instead, use the existing authenticated profile SELECT path. The inspected permissive `profiles_select_org` policy makes profiles in `get_user_org_id()` readable; the hierarchical policy coexists with it. Do not change either policy, grants, or organization helper. Cross-organization access is not needed.

## 3. Proposed behavior

### 3.1 Keep metric responses small

In a **new**, exact-preimage SQL preparation migration, replace the unique final SELECT expression `p.avatar_url` with `NULL::text`. Keep the `avatar_url text` return column so the signature and generated database types do not change. Preserve the complete remaining function body byte-for-byte, including authentication, database-derived organization, 35-day bound, metric expressions, order, advisory guard and pause marker. No profile row is updated.

Both organization RPC callers also explicitly select `agent_id,first_name,last_name,calls_made,appointments_set,policies_sold,annualized_premium,talk_time_seconds,recent_wins_7d`. Map that projected type without casts that pretend an avatar was returned. This makes the frontend compatible before and after the SQL patch and prevents large avatar output from returning to these callers if the old database body is later restored.

Do not change the Group RPC or its avatar mapping. Do not calculate standings from raw calls, appointments, clients or wins in the browser.

### 3.2 Load photos separately, after valid standings

Add a shared in-memory avatar cache and hook. On the page, request IDs from the current successful organization roster. On the Dashboard, request only the rendered top-three IDs. A successful empty roster needs no photo request. A Group view, initial maintenance/error state, or missing viewer/organization must not initiate an organization photo read. If a later refresh fails, existing same-scope cached photos may remain with the stale standings; it must not initiate a new photo read from that failed result.

Use only the authenticated client:

```ts
supabase.from("profiles")
  .select("id,avatar_url")
  .eq("organization_id", organizationId)
  .in("id", requestedIds)
  .abortSignal(signal)
```

Deduplicate/sort requested IDs and validate returned IDs against that exact request. Reject cross-scope results before they enter the cache. Requests remain protected by existing RLS; there is no service-role client, new SECURITY DEFINER photo RPC, public bucket or raw profile export.

The hook decorates the **returned presentation arrays** from the page/widget hooks. It must not feed photo updates back into numeric ranking, metric snapshots, rank-motion comparisons, win celebrations, standings freshness or Dashboard completion. TV, podium, table and Recent Wins already receive that page array, so they inherit the same photos without independent fetching. Continue using the existing initials fallback while photos load or if a photo cannot be read. A photo failure cannot clear numbers, claim standings failed, create a zero board or hold the Dashboard Refresh button open.

### 3.3 Cache and request bounds

| Concern | Proposed rule |
| --- | --- |
| Identity | Cache keys include real auth user ID, effective organization ID and agent ID. Period/metric do not identify a photo. Return only the current scope's entries. |
| Lifetime | Memory only; no localStorage/IndexedDB persistence. Reuse across page/TV/widget navigation in the same tab. Clear on sign-out or auth-user change; discard a previous organization cache on an organization change. A single lazily installed auth listener handles sign-out even when leaderboard consumers are unmounted. |
| Freshness | Five-minute freshness for successful images and successful null/missing results. Revalidate only when a successful standings load or new visible demand supplies a trigger; no periodic photo polling. Failure retains a same-scope cached image and respects photo-endpoint backoff. |
| Bounds | At most 256 agent entries and 32 MiB of estimated string storage (`2 × string.length`) per current viewer/org cache; LRU eviction. Oversized responses use initials and a five-minute suppression entry so every render does not retry them. Prune IDs absent from all current consumers' rosters. |
| Dispatch | Add an `avatars` endpoint/channel to the existing viewer request gate. One photo request shares the same single active lane as standings and Recent Wins. Queue priority is standings, wins, then avatars. At most one queued photo batch. |
| Batch size | At most 20 IDs per request. Maintain demand centrally so page and widget request each missing ID once; a changed demand recomputes the pending batch. One batch per gate turn lets standings/wins take priority between batches. |
| Spacing | Photo work always uses automatic spacing/backoff, including photo work following a manual standings refresh. A single one-shot wake-up may finish current deferred demand; clear it when demand ends or the page becomes inactive. This is not a recurrent refresh timer. |
| Timeout | Gate-owned five-second timeout for the new photo endpoint only, default 25 seconds unchanged for other endpoints. Abort and ignore late results, then apply photo-only error backoff. Test that this optional timeout cannot lengthen other requests or alter maintenance/busy rules. |
| Activity/lifecycle | Recheck visible/online immediately before each batch and queued start. Hide/offline cancels pending dispatch; on return, resume current demand once. Owner release on unmount/view/identity change removes obsolete queued work; late responses cannot repopulate a released identity. |

An eviction/suppression record must be bounded too and must prevent immediate eviction/refetch loops. Use separate small per-ID freshness metadata if image strings are evicted; no unbounded registry. Coalescing is by requested IDs and current cache demand, not by a page-specific consumer prefix. An entry with a successful null is a cache hit. Group images continue to use their existing payload.

The first cold photo read can still transfer the existing large data URLs. This plan removes them from recurring standings and bounds their separate reads; it does not claim to compress or migrate stored photos. Five-minute photo staleness and initials after a failed/oversized photo read are intentional presentation tradeoffs. The current three images fit the proposed budget. Other profile screens and uploads remain unchanged.

## 4. Exact implementation file scope

### Application and tests

| File | Change |
| --- | --- |
| `src/lib/leaderboardAvatarCache.ts` | New bounded cache, demand coalescing, protected query and session cleanup. |
| `src/hooks/useLeaderboardAvatars.ts` | New React subscription/activity/owner lifecycle adapter. |
| `src/lib/leaderboardRequestGate.ts` | Add photo channel/endpoint and photo-only timeout; preserve existing behavior. |
| `src/hooks/useLeaderboardData.ts` | Project numeric/name fields and decorate the returned organization presentation array. |
| `src/hooks/useLeaderboardWidgetStandings.ts` | Same projection; decorate the rendered top three without changing month/snapshot handling. |
| `src/lib/__tests__/leaderboardAvatarCache.test.ts` | New cache/query/bounds/demand tests using a fake transport. |
| `src/hooks/__tests__/useLeaderboardAvatars.test.tsx` | New lifecycle, scope and activity tests with the real cache/gate. |
| `src/lib/__tests__/leaderboardRequestGate.test.ts` | Photo priority, serialization, timeout, spacing and channel release. |
| `src/hooks/__tests__/useLeaderboardData.test.tsx` | Projection, nonblocking decoration, numeric/animation and Group regressions. |
| `src/components/dashboard/__tests__/leaderboardWidget.test.tsx` | Projection/top-three photos, Refresh completion and midnight regressions. |
| `src/components/leaderboard/__tests__/leaderboardStatusSurfaces.test.tsx` | Photos/initials on TV and Recent Wins with unchanged status truth. |
| `src/pages/__tests__/leaderboardPage.test.tsx` | Page propagation and maintenance/empty/error behavior. |

### Database, verification and records

| File | Change |
| --- | --- |
| `supabase/ops/leaderboard_payload_prepare.sql` | New guarded-and-paused original → guarded-and-paused lean payload. |
| `supabase/ops/leaderboard_payload_reopen.sql` | New exact lean paused → lean active template; remove only pause marker. |
| `supabase/ops/leaderboard_payload_repause.sql` | New exact lean active → lean paused template; restore only pause marker. |
| `supabase/ops/leaderboard_payload_restore.sql` | New exact lean paused → current original paused template; restore only avatar expression. |
| `supabase/migrations/20260926223934_leaderboard_payload_prepare.sql` | New un-applied preparation migration, byte-identical to the prepare source. Generated filename recorded before editing; reconcile to the provider's actual version only after a later approved apply. |
| `supabase/tests/fixtures/leaderboard_backend.sql` | Synthetic large photos, authenticated same-org photo access and cross-org denials. |
| `scripts/tests/leaderboard-backend.node.mjs` | Preserve existing assertions; add payload, row preservation, security, transition/refusal and rollback tests. |
| `AGENT_RULES.md` | Record only the as-built invariant and actual deployment state after implementation. |
| `implementation_plan.md` | Approval, file scope and as-built references. |
| `docs/incidents/2026-09-26-leaderboard-backend/latency_repair_plan.md` | This proposal, approval and implementation evidence. |
| `docs/incidents/2026-09-26-leaderboard-backend/verification.md` | Exact checks, performance limits and release packet. |
| `WORK_LOG.md` | Additive newest-first entry; preserve all existing bytes. |

The existing backend CI path filters cover these SQL/test files; no workflow or dependency edit is planned. Applied migrations and existing guard/re-pause sources remain immutable. A later approved production reopen, re-pause or restoration receives its own new migration filename; it is never accomplished by modifying an applied migration. Record any needed file-scope expansion before editing it; a change to metrics, RLS, Group, uploads or production data needs a revised approval.

**This planning commit changes only four docs:** this new plan, the root plan, verification and WORK_LOG. The capacity plan remains the historical resize record.

## 5. Required evidence before requesting a release

### Frontend

- Prove the real client query excludes `avatar_url`, not just a mapper discarding the field after download. Include a synthetic 6 MB photo response that only the profile transport returns.
- Numbers render before the photo promise settles. Photo success/failure cannot change ranks, totals, metric animations, Recent Wins celebrations, status timestamps or Dashboard Refresh completion.
- Page + widget share overlapping IDs, remounts/StrictMode join current work, and changing metric/period or repeated Refresh inside five minutes does not refetch photos. Different ID demand requests only missing entries; null is cached; TTL expiry triggers at most one revalidation.
- One active gate request across standings/wins/photos; queued standings/wins take priority; batching yields; five-second photo timeout aborts without changing existing 25-second tests; a late photo result cannot commit. Simulate a slow image read during a new standings refresh.
- Hidden/offline mount and queued start send nothing. Hidden/offline between batches prevents the next read. Resuming uses only current demand. Identity/org/view changes and logout cannot expose old images; unmount releases owners and one-shot timers. No fresh photo load during an initial maintenance response.
- Memory/entry caps, oversized images, negative results, failure backoff and eviction do not cause retry loops. An omitted/mismatched response ID cannot be used for another agent.
- Keep all existing period/month-straddle, truthful states, Group failure, ranking and Refresh tests. Prove image display through the actual page/TV/widget integration, rather than asserting only that a mock received a prop.

### Real PostgreSQL 17 synthetic verification

Use the existing loopback-only, empty-cluster harness; never import customer photos or production credentials. Add generated large image strings and record row hashes before/after every SQL transition. Exercise the existing function under authenticated identities with the synthetic RLS path as well as owner-level definition assertions.

1. Original and lean active results match in every column except avatar; same roster/order for all periods, zero-activity agents, boundary and negative/null premium cases. Lean `avatar_url` is always null. The client-projected seven-agent synthetic result is below 16 KiB even with at least 6 MB of stored synthetic photo text.
2. Profile avatar rows remain byte-identical through prepare, reopen, re-pause and restore. Authenticated same-org photo reads succeed and cross-org/anonymous reads fail or return no rows as appropriate. No grants or policies are changed by the patch.
3. Full metadata before/after matches: owner, ACL, signature, argument/return types, STABLE, SECURITY DEFINER, search path, plus exact body-delta checks. Authentication/date validation, anon denial, authoritative organization, PT429 contention and ordinary CRM progress retain the existing real-session tests.
4. Prepare preserves PT503. Reopen/repause alter only the pause marker. Restore returns exactly `75eec092f7039c2c8cb0cca93e93d1ae`. Every template refuses a wrong body, wrong owner/ACL, missing target or replay, and leaves the database unchanged on refusal. Record all resulting hashes and exact SHA-256 source digests in the release packet.
5. Break the new guards/payload/cache behaviors individually on an isolated copy and show the relevant regression fails. Focus on actual defects: avatar included in projection/body; lost same-org scope; duplicate photo dispatch; hidden follow-on read; late identity commit; unbounded re-fetch after eviction; numeric state blocked on photos. Do not replace meaningful pre-existing assertions with weaker ones.

Run focused suites, targeted lint with zero warnings, build and real app typecheck against a fresh main baseline. Run the required root typecheck but label its known empty-project limitation. Compare full-suite results rather than claiming a green baseline: prior app typecheck has 90 pre-existing errors; prior missing-env and voicemail test failures are documented, not waived for new failures. Run the existing S1 gates and whitespace checks. Local synthetic latency is not a production benchmark.

## 6. Staged release and recovery procedure — later exact approval

The proposed release packet must identify the reviewed frontend commit, four tested SQL sources, every pre/post hash and the approved recovery transitions. Do not infer a production release from approval to implement this plan.

1. **Before the first production change**, freshly verify no active/nonterminal calls or fresh dialing sessions, provider health, pause hash, owner/ACL/config and Group hash. A stale session is not proof an apparent call ended. If activity is unresolved, defer under Chris's existing condition. Check again immediately before any later SQL phase if the window has elapsed.
2. Deploy the reviewed frontend while the database remains paused. Verify old PT503 still produces maintenance, Group behavior is unchanged and no photo query is started without a valid organization roster. Do not bypass the pause for a browser test.
3. Apply only the exact preparation migration using the migration mechanism. It accepts current paused hash `75eec092f7039c2c8cb0cca93e93d1ae`, uses short lock/statement timeouts, preserves pause/security and checks the unique avatar expression. Re-read metadata/hash and authenticated PT503; no successful aggregate is expected at this stage. Reconcile the recorded version without editing source bytes.
4. If separately approved, apply the exact reopen template accepting only the new lean-paused hash. Have the tested lean re-pause already approved for the same stop criteria. Keep Small; make no additional compute, pool, timeout, telemetry configuration or SDK changes.
5. Use one signed-in validation tab, ordinary user-visible actions and existing cooldowns. Check Today/Week/Month, one metric switch, Dashboard Refresh and TV. Observe first cold photo loading, then warm reuse; measure stats HTTP duration/response bytes separately from photo HTTP duration/bytes. Do not sum/compress assumptions into a claimed network measurement. Read-only catalog/counter snapshots may support attribution, but do not execute the old large aggregate alongside production just for comparison.
6. Observe ten minutes with exact one-minute API windows and request counts. Record success-path origin latency, unexpected errors, ordinary CRM latency and sampled lock waits. Expected maintenance 503/PT429 must stay visible in the record but be separated from successful aggregate timings and unexpected server errors. Sparse traffic or unavailable charts means limited verification, not a capacity pass.
7. Re-pause immediately on the original stop rules: any standings timeout; two successful standings responses over 2 seconds; ordinary REST p95 over 1 second **and** over twice its baseline in two consecutive one-minute windows with at least 20 requests each; at least three unexpected non-leaderboard 5xx in two minutes against a zero baseline; new lock waits persisting across two samples; or any security/scope/metric mismatch. Do not wait for ten minutes if a rule fires. A photo timeout is a photo failure; any broader CRM impact still triggers the ordinary-traffic rules.

**Recovery order:** active lean → tested lean re-pause first. If this repair itself must be removed, lean paused → tested original paused restore, then restore the preceding frontend deployment if approved. Never restore the old active large-payload function. If still paused at prepare time, restore can return directly to the original paused definition. All operations refuse drift; never rewrite the expected hash to force them through. Do not restore a whole database backup over newer customer writes, clear calls/sessions, terminate agents or edit profile photos. Existing tested hashes/scripts for the previous function revision cannot be blindly reused.

Photos are not mutated, so there is no customer-image restore/import step. A future Storage migration is separate work. If the lean success path still crosses a stop rule, keep the pause and use paired HTTP/counter evidence to prepare the next specific repair; do not buy another tier or relax the threshold automatically.

## 7. Review decision and current limits

Implementation approval was given and the repair is complete. The five-minute photo freshness, bounded memory/timeout and initials fallback are part of the implemented behavior. The next decision is the staged production release in §6 using the exact packet in §8, including conditional re-pause and restoration while paused.

Implementation and synthetic verification are complete; no repaired successful production standings read, migration or deployment has occurred. The evidence supports removing a known repeated payload, not a promise that it alone cures all production latency. Maintenance retry amplification remains a provider-path finding with attribution limits; the maintenance error contract is intentionally preserved. The first cold photo read still carries the existing image data and can fail to initials after five seconds. Browser/API latency and a ten-minute production observation remain release-stage work.

Primary references checked September 26: [PostgREST custom errors](https://docs.postgrest.org/en/stable/references/errors.html), [Kong proxying/retries](https://developer.konghq.com/gateway/traffic-control/proxying/), [Supabase API retries](https://supabase.com/docs/guides/api/automatic-retries-in-supabase-js). Current SDK retry guidance covers newer releases; the installed 2.98.0 source determines this application's behavior. The Supabase changelog Markdown endpoint could not be retrieved in this environment; no SDK/platform change is proposed from an assumed changelog state.

## 8. Final implementation and exact release packet

### 8.1 Reviewed source and behavior

The final executable-source commit is **`da4b0b1be179416b33fa0655580aad852d9fa34b`**, tree `e2016b87f0991f256d30c0169fc00c89883a4ae2`, on [PR #391](https://github.com/cgarness/agentflow-life-insure/pull/391). The local tested tree and API-published Git tree match exactly. Later record-only commits do not change executable sources. PR #391 is based on [documentation PR #390](https://github.com/cgarness/agentflow-life-insure/pull/390); both are drafts. Main remains `e16a3c0181819e80cf608a0efa8aede428321e7e`. The complete implementation changes exactly the 24 files in §4; no scope expansion was needed.

The frontend projects out photos at the actual RPC request, then decorates presentation arrays from the protected cache. Numerical snapshots, ranking/celebrations, status times, month identity and Refresh completion retain their existing behavior. A review found that navigating through an unloaded roster could prune valid cached photos; unknown rosters now preserve them, with a regression. Another final review removed an obsolete deferred timer when all demand becomes unavailable. Tests deliberately breaking both fixes fail. This was a code and regression review, not an independent-agent review or a production browser run.

### 8.2 Frontend and baseline evidence

| Check | Final result |
| --- | --- |
| Seven affected frontend suites | 181 / 181 passed |
| Full suite | 3,445 passed, one failed, two skipped; 3,448 assertions |
| Comparable baseline | 3,421 passed, one failed, two skipped; 3,424 assertions |
| Common-test status changes | None; 24 added tests and one renamed existing test |
| Failed files | Same 12 as baseline: 11 missing Supabase environment imports and the existing voicemail v29 wiring assertion |
| App TypeScript | 90 diagnostics, identical to baseline after normalizing source line/column offsets |
| Changed-source lint | All 12 TypeScript/test files pass with warnings treated as errors |
| Production build | Pass; existing bundle-size warning remains |
| Frontend mutation checks | 10 / 10 deliberate defects caught on an isolated copy; every source restored byte-for-byte |

The first baseline was an archive without Git metadata; that made one Git-history-dependent voicemail assertion skip. The four Git-dependent suites were rerun in a detached worktree of the exact baseline and merged into the comparison. The corrected baseline above has the same voicemail failure as the final tree. The renamed widget test now says metrics/roster come from the RPC and only protected photos are read separately; its numerical/security intent remains covered. Root `tsc --noEmit` is still an empty-project check, not an app typecheck. Final S1 and record-integrity checks are recorded in verification.md.

The ten frontend mutations cover lost standings projection, missing organization filter, expanded profile columns, identity cache reuse, wrong photo timeout, ignored freshness, disabled memory bounds, unloaded-roster eviction, missing queued-photo dispatch, and obsolete deferred timers. Assertions failed for the intended defect; no parse/import failure was counted as a mutation catch.

### 8.3 PostgreSQL 17.6 evidence and transition hashes

[GitHub run 36278812457](https://github.com/cgarness/agentflow-life-insure/actions/runs/36278812457) passed on the exact final executable-source commit, using the existing isolated loopback PostgreSQL 17.6 service. The same SQL, fixture and runner passed all **32 real-session tests** and caught **four SQL mutations** in the preceding run 36278137026. The first job exposed a test-only `Result(0)` versus ordinary-array assertion; checking the result length corrected it before the passing runs. The local execution namespace cannot chown a non-root cluster owner, so no local real-PostgreSQL pass is claimed and no root-user protection was bypassed.

Generated photo text exceeds 6 MB across seven synthetic agents; the projected lean result stays below 16 KiB. Every non-photo metric, roster and order matches for Today/Week/Month. Photo row hashes are unchanged through all four transitions. Same-org authenticated photo access succeeds; cross-org and anonymous access are denied. Complete function metadata, grants, RLS, authentication/date validation, PT429 contention and ordinary CRM progress pass. Every new template refuses wrong body, owner, ACL, missing target and replay without leaving a partial change. These are synthetic correctness checks, not production performance measurements.

| Operation | Required definition MD5 | Resulting definition MD5 | SQL SHA-256 |
| --- | --- | --- | --- |
| Prepare, paused → lean paused | `75eec092f7039c2c8cb0cca93e93d1ae` | `41615c590703650c27ed41d164bcbfe4` | `2f7e91546549d7872cc1571bf04a0f57225f110cf96c1f0058cc03f4189cc891` |
| Reopen, lean paused → lean active | `41615c590703650c27ed41d164bcbfe4` | `c8b1f9d0c7cf5f8dfb7e437577029278` | `f652a81b02f89886652782a68e119062c463b0fe02ef95d3b25f146155ea3903` |
| Re-pause, lean active → lean paused | `c8b1f9d0c7cf5f8dfb7e437577029278` | `41615c590703650c27ed41d164bcbfe4` | `798063000e923eca9ccb407d80ea7b5c269bf30ed5ed947d9a19435ba84493b6` |
| Restore, lean paused → original paused | `41615c590703650c27ed41d164bcbfe4` | `75eec092f7039c2c8cb0cca93e93d1ae` | `093d42adb515e2d8543304a459db7879f8e66e4234188971c96603467492eee0` |

Sources are the four `supabase/ops/leaderboard_payload_*.sql` files. The preparation migration is byte-identical to its ops source and remains unapplied. Each operation is a separate new migration; reopening, re-pause and restoration do not edit historical migrations.

### 8.4 Production release decision

The 23:13:36.473 UTC bounded READ ONLY catalog check still found original paused MD5 `75eec092f7039c2c8cb0cca93e93d1ae`, owner `postgres`, ACL `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`, STABLE SECURITY DEFINER, `search_path=public, pg_temp`, and zero lock waiters. No production photo bytes were read or changed, and no new successful aggregate was run.

Requested next approval is concrete: merge documentation PR #390, retarget/merge the tested PR #391 and deploy that frontend while paused; apply only the exact preparation then reopening sources above; perform the bounded signed-in ten-minute check in §6; re-pause immediately on its original stop conditions. Include the tested paused restoration and rollback to the preceding frontend deployment if the repair itself must be removed. Immediately before production work, freshly confirm no active/nonterminal calls or fresh dialing sessions, health, exact preimage/security and Group. Defer if activity or drift is unresolved. Approval to prepare this packet does not authorize any of those production actions; AGENT_RULES #28 and Chris's dialing condition remain in force.

## 9. Approved production execution — September 26 UTC

Chris approved the exact §8.4 release at **23:26:58 UTC / 16:26:58 PT**, including both PR merges, frontend deployment while paused, exact preparation/reopening, ten-minute verification, conditional re-pause and paused restoration/frontend rollback. This supersedes the pending-approval status above; it does not expand source or configuration scope. Approval was recorded on PR #391 before execution.

Fresh activity/security checks passed at 23:28:34.860, 23:30:56.027 and 23:33:35.159 UTC: zero recent nonterminal calls and zero fresh active dialer-session heartbeats. Latest completed call at the initial check was 22:40:16.040 UTC. Provider ACTIVE_HEALTHY, original paused definition/owner/ACL/config and Group hash matched, with zero lock waiters. No call/session was modified.

PR #390 merged at `4af2e5883ab252536750ef40ca7310e265241c20`; #391 was retargeted to main and merged at `775005cff965c3eb946a996bed313729db59eb2b`, whose tree exactly matches the tested release tree `5129794ef5c384ad561bc2b7c092af3d8c21f5ca`. Vercel production `dpl_HPuZtNbMjSsSrHqZZuGp2ZbBxKhM` is READY and owns www.fflagent.com. A deliberate reload verifies the signed-in maintenance panel, with its next check at 16:37 PT. The previous application deployment is `dpl_AgVz7LGxuXKTiQaabrSju4wEYdfp` (main e16a3c01); the immediately preceding documentation deployment is `dpl_9p6VwyRHAx8D9YvDrVCYyiDkrpAN` with identical prior application source.

Execution-record scope, before SQL apply: the existing five record files (this plan, root implementation_plan.md, verification.md, AGENT_RULES.md, additive WORK_LOG.md); reconcile only the new preparation migration filename to its actual provider version; add the CLI-generated `supabase/migrations/20260926233252_leaderboard_payload_reopen.sql` and reconcile its version after approved apply. SQL bytes must match the four approved digests. If a stop rule fires, generate and record only the necessary new re-pause/restoration migration from the exact approved source. No application-source edit or unrelated migration is permitted. A verification screenshot is supporting evidence, not customer-data export.

Execution results follow here after read-back; browser holds will expire normally, with no cooldown bypass.

**Applied/read back:** preparation `20260926233422_leaderboard_payload_prepare` and reopening `20260926233524_leaderboard_payload_reopen`. Both stored migration statements match their approved SHA-256 bytes exactly. The preparation read at 23:35:02.438 UTC confirmed lean-paused hash, no active calls/dialing/lock waiters, and authenticated PT503. The 23:35:49.801 reopening read confirms lean-active `c8b1f9d0c7cf5f8dfb7e437577029278`, unchanged owner/ACL/config, anon denied, authenticated allowed, unchanged Group hash, zero lock waiters and 17 client connections. The CLI-generated filenames were reconciled to these actual versions without changing SQL.

**Baseline and planned observation:** exact 23:26:00–23:31:00 UTC pre-release API sample: 172 non-leaderboard REST requests (56 OPTIONS), all 200; ordinary non-OPTIONS p95 186 ms, all-method p95 181 ms. One expected maintenance POST was 503/1,201 ms. The ten-minute observation is 23:36:00–23:46:00 UTC, with the immediate post-reopen integrity check recorded separately. A bounded authenticated-role Month read returns seven agents, zero inline photos, 2,059 calls, 34 appointments, two policies and $2,004.24 annualized premium. Its projected PostgreSQL JSON text is 1,657 bytes; that is not an HTTP transfer measurement. The browser's original maintenance hold is being allowed to expire normally.

**Signed-in functional checks:** the original hold expired automatically and Today loaded, followed by Week and Month. Calls Made reordered the same roster without changing the metric contract. All three stored photos decoded successfully; the other agents use initials. TV Month totals matched the authenticated-role read (2,059 calls, two policies, $2,004 rounded, 34 appointments); TV Week showed 1,012 calls, zero policies, $0 and ten appointments. Dashboard initial loading and one permitted Refresh completed with the leaderboard and all sections visible and no failure notices. Returning to the full board retained working photos. No Group selection was available in this account; Group was verified by unchanged definition/security, not a fabricated signed-in Group test.

**Interim observation:** the first standings POST was 200/54 ms and the first protected photo GET was 200/198 ms. Period/metric/TV/Dashboard navigation reused the photos; one further photo GET at 23:42 was 200/187 ms after the five-minute freshness window. All sampled standings through 23:44 were 200 and below 152 ms; no unexpected REST errors. Some ordinary requests reached 642 ms, below the one-second floor of the stop rule. Lock samples at 23:39:53 and 23:41:10 remained zero (24 and 22 connections). Final exact-window totals follow after 23:46. API response content-length headers are absent for standings/photos; no zero-byte or measured wire-size claim is made.

**Final outcome:** the exact 23:36:00–23:46:00 UTC window passed all approved stop rules. Twenty-two standings POSTs were all 200: min 34 ms, p95 65 ms, max 151 ms; none requested the avatar column. The 234 other REST requests were all 200 (18 OPTIONS); non-OPTIONS p95 153 ms / max 642 ms versus baseline p95 186 ms. Those requests include two separate photo GETs at 198 / 187 ms. No timeout, unexpected 5xx, PT429, security/scope/metric mismatch or new lock waiter was observed. Exact one-minute counts and p95s are in verification.md; sparse minutes are not a busy-period capacity test.

At 23:46:01.287 UTC the lean-active hash/security and Group were unchanged, zero lock waiters and 29 client connections. Browser checks passed for Today/Week/Month, Calls Made, TV Month/Week totals, all three photos/initials, and Dashboard initial load plus one bounded Refresh. The validation tab was closed after the observation to end agent-generated polling. No re-pause, restoration, additional resize or telemetry/configuration change was needed. The first aggregate log query returned a logs-backend error; splitting summary and minute queries succeeded. This was a verification-tool error, not an application HTTP error.

The final evidence screenshot is saved as `agentflow-leaderboard-restored-20260926.jpg`; no original avatar file or contact export was copied into Git. Both applied migrations are stored under their provider versions with unchanged SQL; five record files complete the release. Required root tsc, S1 23/23 and self-test 5/5 pass. No app source changed after the already-tested release.
