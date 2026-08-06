# Implementation Plan — Leaderboard metric-switch re-rank (synchronous, zero-RPC)

**Status:** **IMPLEMENTED LOCALLY on branch `bugfix/leaderboard-metric-switch-rerank`** — Chris approved this plan on 2026-08-06; implemented exactly as documented using only the listed files. NOT committed, NOT pushed, NOT merged, NOT deployed. Fail-first proven: 6/7 new hook tests failed against unmodified main (the period-fetch guard passed by design); after the fix 18/18 hook · 31/31 focused · full vitest **944/944** host TZ / **932+12 skipped** UTC / **944/944** LA · tsc 0 · ESLint clean · build OK · `git diff --check` clean. As-built delta from plan: none. See the 2026-08-06 `WORK_LOG.md` entry for the full record.
**Date:** 2026-08-06
**Baseline:** `origin/main` = **`a411892`** (squash-merge of PR #347, "serve org standings from scoped aggregate RPC"). Newest `WORK_LOG.md` entry on main is the production-migration-apply record for `20260805090000` — no conflicting in-flight work. The RPC is live and healthy in production (pg_stat_statements: 64 calls, 42.15 ms mean, 22.47/163.51 ms min/max) — this is a **frontend lifecycle/rendering regression only**.
**Branch plan:** cut **`bugfix/leaderboard-metric-switch-rerank`** from `origin/main`. Pre-existing dirty files excluded from commits as always (`deno.lock`, `.claude/`, `.cursor/`, `tsconfig*.tsbuildinfo`).

> Supersedes the PR #347 aggregate-RPC plan (merged as `a411892`; durable record in the 2026-08-05 `WORK_LOG.md` entries and git history).

---

## 1. Confirmed root cause (verified against current main — the hook is byte-identical to the PR #347 version)

`get_org_leaderboard_stats` returns **every** metric in one response, but `metric` sits in the fetch-callback dependency chains ([useLeaderboardData.ts:341](src/hooks/useLeaderboardData.ts:341) `fetchGroupData` deps, [:384](src/hooks/useLeaderboardData.ts:384) `fetchOrgData` deps → `fetchData` [:387-396] → the fetch effect [:440-442]). A metric switch therefore: (1) updates the visible metric immediately; (2) leaves `agents` ranked by the previous metric (re-rank happens only post-refetch at :314/:376); (3) fires a pointless RPC + `beginFetch` → `filterRefreshing` spinner; (4) re-ranks after the response; (5) lets the podium's per-slot `AnimatePresence mode="sync"` overlap outgoing/incoming cards (0.38s exit ghost, [LeaderboardPodium.tsx:94-111](src/components/leaderboard/LeaderboardPodium.tsx:94), [LeaderboardPodiumCard.tsx:62-74](src/components/leaderboard/LeaderboardPodiumCard.tsx:62)) across the two inconsistent renders.

**Additional verified transition defects the same fix resolves:**
- **Odometer cross-semantics roll:** the podium value is `agent[metricKey(metric)]` with a per-metric formatter; on switch, `OdometerValue` renders the old number through the new formatter for a frame, then tweens between semantically unrelated values (0.48s) ([OdometerValue.tsx:13-29](src/components/leaderboard/OdometerValue.tsx:13), [LeaderboardPodiumCard.tsx:128-129](src/components/leaderboard/LeaderboardPodiumCard.tsx:128)).
- **Unconditional reorder animations:** table rows carry `layout="position"` + `layoutId` regardless of the animation maps ([LeaderboardRankingsTable.tsx:133-138](src/components/leaderboard/LeaderboardRankingsTable.tsx:133)) — a filter-driven reorder spring-glides like live data.
- **Leftover live-animation state:** the `movementFilterKey` reset effect ([useLeaderboardData.ts:137-144](src/hooks/useLeaderboardData.ts:137)) clears `rankMovements`/spotlight/flash but **not** `rankAnimations`, `rankMotions`, `rankDeltas`, or `newLeaderId` — those die only on their own 1.4–2.8 s timers, so a live update ≤1.5 s before the switch decorates the re-composed board with stale glow/pop/glide.

**Not affected (evidence):** the Dashboard `LeaderboardWidget` has no metric switcher and does not use the hook (fixed `policies_sold` → Wins; grep-verified) — untouched. `TVMode`'s 30 s metric rotation is purely local state + a local `rankAgents([...agents], metric)` re-sort ([TVMode.tsx:139-183](src/components/leaderboard/TVMode.tsx:139)) — it already does the synchronous pattern and never calls the hook's `setMetric` — untouched.

## 2. Fix design (surgical, hook-level; RPC remains the only org standings source)

### 2.1 `src/hooks/useLeaderboardData.ts`

- **`metricRef`** — kept synchronously current; the single source the fetch paths read.
- **Controlled `changeMetric(next)` exposed under the existing `setMetric` API name.** In ONE event-handler batch (React 18 auto-batching ⇒ a single commit, so no render can pair the new metric with the old ordering):
  1. no-op if `next === metricRef.current`;
  2. `metricRef.current = next`;
  3. **clone** the cached rows (`agentsRef.current.map(a => ({ ...a }))`) and `rankAgents(clones, next)` — the existing state objects are never mutated; id/name/avatar/metric values stay attached to their agent;
  4. clear ALL live-animation state synchronously: `rankAnimations`, `rankMovements`, `rankMotions`, `rankDeltas`, `newLeaderId`, spotlight/flash timers (fixes the leftover-state leak for the metric path);
  5. `setMetric(next)` + `setAgents(ranked)`.
  No `beginFetch`, no RPC, no `filterRefreshing`, no generation bump. The existing `movementFilterKey` effect still fires afterwards and clears the movement refs exactly as today (parity: the first refresh after a switch shows no movement arrows).
- **Remove `metric` from the fetch dependency chains** (`fetchOrgData` deps :384, `fetchGroupData` deps :341); inside both, rank and animate with **`metricRef.current`** — so a poll/refresh resolving after a switch ranks with the latest metric, never a stale closure, and metric changes can no longer re-fire the fetch effect. Period and view/group changes keep their deps and still fetch (data scope changes). 4 s polling, realtime refresh, `fetchGenerationRef` stale-guard, `loadError`/retry, and Recent Wins are untouched.
- `standingsFrozen`/`movementFilterKey` keep using the `metric` state — consistent, since it commits atomically with the ranked rows.

### 2.2 `src/pages/Leaderboard.tsx` (only page change; components untouched)

Add **`key={metric}`** to `<LeaderboardPodium>` and `<LeaderboardRankingsTable>`. Because the synchronous re-rank commits `metric` and the ranked rows together, the key change remounts both subtrees **in that same commit**: per-slot `AnimatePresence` dies wholesale (no 0.38 s exit ghost, no outgoing/incoming overlap — disabled **only** for filter-driven changes), remount uses `initial={false}` (no enter animation), table rows have no prior layout snapshot (no spring glide), and `OdometerValue` re-seeds its display state (no cross-semantics roll). Live-data commits never change `metric`, so keys are stable and every live glide/glow/spotlight/odometer behavior is preserved exactly. Known cosmetic trade-off: a metric switch resets any transient hover state inside the two remounted components (no scroll container lives inside them — page-level scroll is unaffected).

No changes to `LeaderboardFilters` (already calls `setMetric`), `LeaderboardPodium/Card`, `OdometerValue`, `leaderboardRankMotion`, `leaderboardTypes` (`rankAgents` stays deterministic: metric ↓, last/first name, id), `TVMode`, `RecentWinsPanel`, CSV export, the widget, or anything backend.

## 3. Fail-first tests (written and run against unmodified main first; failures recorded)

`src/hooks/__tests__/useLeaderboardData.test.tsx` — new fixture set where **Agent A leads Policies Sold and Agent B leads Calls Made**, plus:
1. Initial load ranks A #1 under Policies Sold (B #1 under Calls proven by the same fixture's values).
2. `act(() => setMetric("Calls Made"))` → **synchronously** B is rank 1 (no pending RPC flush needed) — fails today (rows stay A-first until a refetch).
3. Association integrity: B keeps its id/name/avatar/callsMade/policiesSold values through the switch; so does A.
4. The switch adds **zero** `get_org_leaderboard_stats` calls — fails today (one fires).
5. `filterRefreshing` stays `false` and `initialLoading` stays `false` throughout — fails today.
6. Rapid switches (Policies → Calls → Talk Time → Premium → Calls) settle on the final metric's correct ordering with zero RPC calls.
7. Manual-mode poll started before a switch, resolving after: committed rows are ranked by the **latest** metric — fails today (stale closure ranks by the old one).
8. After (7), the old metric's ordering cannot be restored by any late/stale response (superseded-generation discard remains covered by existing tests).
9. `setPeriod` still triggers exactly one new RPC with the visible refresh lifecycle (tightens existing coverage; must stay green).
10. Live-animation clearing: populate the animation maps via two auto-mode commits with changed values, then switch metric → all four maps empty + `newLeaderId` null in the same tick.
Existing error/retry/stale-generation/RPC-source/page/widget suites must remain green unchanged (the consumers audit confirmed **no existing test asserts fetch-on-metric-change**, so none needs weakening).

## 4. Files to touch (complete list)

| # | File | Action |
|---|---|---|
| 1 | `src/hooks/useLeaderboardData.ts` | EDIT — `metricRef` + controlled `changeMetric` under the `setMetric` name; remove `metric` from fetch deps; rank fetch results by `metricRef.current`; synchronous animation-state clearing |
| 2 | `src/pages/Leaderboard.tsx` | EDIT — `key={metric}` on `LeaderboardPodium` and `LeaderboardRankingsTable` (2 lines) |
| 3 | `src/hooks/__tests__/useLeaderboardData.test.tsx` | EDIT — fail-first tests §3 |
| 4 | `implementation_plan.md` | EDIT — this plan |
| 5 | `WORK_LOG.md` | EDIT — newest-first entry (with implementation) |

Nothing else: no Supabase/migration/RPC/RLS/grant change, no backend/Edge change, no widget change (evidence in §1), no dialer/telephony/telemetry code, no new dependencies, no mock data in production paths, Tailwind only, strict types (no `any`).

## 5. Verification gates

`npx tsc --noEmit` · focused hook/page/widget suites · full `npx vitest run` in host TZ, `TZ=UTC`, `TZ=America/Los_Angeles` · ESLint `--max-warnings 0` on touched files · `npm run build` · `git diff --check` · scope audit vs `origin/main`. WORK_LOG entry + context snapshot at handoff. No commit/push/PR/merge/deploy without Chris's separate approval.
