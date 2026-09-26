# Organization leaderboard payload repair — proposed implementation

Prepared September 26, 2026 UTC for Chris Garness. **Status: diagnosis and plan only; implementation approval pending. Production organization standings remain paused.**

## 1. Outcome and authority

Make recurring organization standings responses contain names and numbers, with photos loaded separately through existing permissions and reused in memory. Preserve all rankings, canonical metrics, photos, Group behavior and maintenance protections. Then assess a separately approved reopening against the original production stop rules.

Chris's “Let's begin” follows the proposed deliverable of a read-only diagnosis and exact repair plan, tests and rollback procedure. It authorizes this investigation and documentation. Under AGENT_RULES §8, approval of this plan is the next implementation boundary. Approval will permit local code/SQL preparation, synthetic tests, branch commits and a draft PR. It does **not** apply SQL, merge/deploy application code, restart the project or reopen production. Present tested commit IDs, SQL digests, resulting function hashes and rollback evidence before those actions.

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
| `supabase/migrations/<CLI-version>_leaderboard_payload_prepare.sql` | New un-applied preparation migration, byte-identical to the prepare source. Record the generated filename before editing; reconcile to the provider's actual version only after a later approved apply. |
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

Recommended approval: implement and test the exact payload/cache repair above, with production still paused. The proposed five-minute photo freshness, bounded memory/timeout and initials fallback are part of that reviewable behavior.

No implementation, synthetic repair test, new successful production standings read, migration or deployment has occurred in this planning turn. The evidence supports removing a known repeated payload, not a promise that it alone cures all production latency. Maintenance retry amplification remains a provider-path finding with attribution limits; the maintenance error contract is intentionally preserved.

Primary references checked September 26: [PostgREST custom errors](https://docs.postgrest.org/en/stable/references/errors.html), [Kong proxying/retries](https://developer.konghq.com/gateway/traffic-control/proxying/), [Supabase API retries](https://supabase.com/docs/guides/api/automatic-retries-in-supabase-js). Current SDK retry guidance covers newer releases; the installed 2.98.0 source determines this application's behavior. The Supabase changelog Markdown endpoint could not be retrieved in this environment; no SDK/platform change is proposed from an assumed changelog state.
