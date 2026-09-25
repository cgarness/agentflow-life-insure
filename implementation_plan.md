# Implementation Plan — Leaderboard recovery: frontend request discipline + truthful maintenance/stale states (rev 1 — AWAITING CHRIS'S APPROVAL)

> **STATUS (rev 1, 2026-09-25): PLAN ONLY. No application file has been edited and no backend command has run.**
> - Scope is **frontend only**: standings + Recent Wins request discipline, truthful maintenance/stale states on the
>   Leaderboard page, TV mode and the Dashboard widget, and replacing the Dashboard's automatic refresh with one bounded
>   manual Refresh control.
> - **The production leaderboard pause stays active.** Migration `20260923224254 emergency_pause_org_leaderboard_20260923`
>   is not replayed, rolled back or edited. No migration, RPC, RLS, grant, Edge Function, Supabase MCP call, production
>   read or write, Vercel action, merge or push to `main` is part of this plan.
> - **Needs Chris's explicit approval** of this plan (and of decisions D-1 … D-12 in §6) before any `src/` edit.
> - The draft design was reviewed before approval by four independent reviewers (concurrency, React lifecycle, truthful
>   UX, scope/safety); every confirmed finding is folded in below (§11).
>
> **Repository:** `cgarness/agentflow-life-insure` · branch `claude/agentflow-leaderboard-recovery-uney6j`
> · base `main` @ **`62684da`** (2026-09-24 20:56 PT). The previous plan (Team / Open Pool lead details, rev 1–7 and §11)
> is preserved in git history at **`62684da`**; the one before it (Dashboard Leaderboard widget) at `f78140d`.

---

## §0. TL;DR

The organization leaderboard was paused in production on 2026-09-23 (live-only migration `20260923224254`) because
leaderboard traffic was slowing the whole app. The pause makes `get_org_leaderboard_stats` fail fast with a marked
`PT503` error ("Standings temporarily paused"). The browser code that caused the amplification is still on `main`:

- the Leaderboard page / TV mode polls the standings RPC **and** the Recent Wins feed **every 4 seconds**;
- every `calls` / `appointments` / `wins` realtime INSERT triggers another standings refresh ~0.5–1 s later, **even in
  hidden tabs**;
- nothing stops overlapping requests, so slow responses pile up; nothing backs off after errors, so the `PT503` is
  requested every 4 s by every open tab;
- the Dashboard re-runs its 9 stat-card queries every 2 minutes in every tab, visible or not.

The UI also misreports the outage: the page says "Check your connection", a failed or still-loading Recent Wins read
shows "No wins yet", TV mode shows zero totals and an empty podium under "LIVE", and the Dashboard widget says only
"Couldn't load standings".

This plan adds one small, tested request gate and routes every standings and Recent Wins read through it:
**one request in flight at a time, identical requests shared, a 30-second poll that only runs in a visible, online tab,
spacing that stretches when the database is slow, exponential backoff, and a 5-minute hold on `PT503`.** Each surface
then says exactly what is true — paused for maintenance, busy, failed, loading, or "showing results from 3:42 PM" —
and never shows another period's, view's or viewer's numbers under the current selection. The Dashboard loses its
automatic refresh and gains one Refresh button that cannot be spammed.

Canonical metrics, ranking, period bounds, tenant isolation and network-free metric switching are unchanged.

---

## §1. Inputs, conflicting work, and what was NOT received

### 1.1 Read before planning
- `AGENT_RULES.md` (v5.0.0) — §3 multi-tenancy, invariant **#23** (leaderboard RPC contract and frontend contract),
  #25 (applied migrations immutable), #28 (production read-only by default), §7 component standards (< 200 lines,
  Zod, Tailwind only), §8 workflow protocol, §9 doc update rule, §10 forbidden patterns.
- `VISION.md` — Agency Groups share leaderboard-visible metrics only; Telemetry / Speed / UI-quality principles.
- `WORK_LOG.md` — newest entries (2026-09-24 Team/Open lead details; 2026-09-23 Dashboard widget D-6 and
  simplification). The root log has **no entry** for the leaderboard containment; it lives only on unmerged branches.

### 1.2 Conflicting / related work (checked 2026-09-25 against `origin`)
| Item | State | Relation to this plan |
|---|---|---|
| PR **#382** `hotfix/leaderboard-emergency-containment-20260923` (`0057ad6`) | **open draft** | Records the applied pause migration, its guarded rollback and the incident note. **Not touched**; its migration file is not added here. |
| PR **#383** `fix/leaderboard-resilience-20260923` (`6fac3e5`, 13 commits, CI green) | **open draft** | Includes #382 plus a frontend request gate, changes to `useLeaderboardData.ts` / `LeaderboardWidget.tsx` / their tests, a CI workflow, and **backend** guard/re-pause SQL (`supabase/ops/*`). **Overlaps this plan's frontend files; both cannot merge.** This branch starts fresh from `main` as instructed and supersedes #383's *frontend* only (D-10). #383's backend SQL is out of scope. **No change is made to #383.** |
| PR **#381** `claude/docs-leaderboard-merge-closeout` | open, docs only | WORK_LOG closeout; no application conflict (ordinary `WORK_LOG.md` merge). |
| `bugfix/leaderboard-metric-switch-rerank` (`99b2a0f`) | stale (Aug 5) | Superseded by `main`'s current `changeMetric`. |

Facts taken from #382/#383 (read-only; not re-verified against production — no production access is planned):
- The pause inserts, after the existing `auth.uid()` null check:
  `RAISE SQLSTATE 'PT503' USING MESSAGE = 'Standings temporarily paused', HINT = 'Leaderboard maintenance is in progress. Avoid repeated retries.'`
  PostgREST turns `PTxyz` into HTTP `xyz`, so supabase-js returns
  `{ data: null, error: { code: "PT503", message: "Standings temporarily paused", hint: "…", details: null }, status: 503 }`.
  `@supabase/postgrest-js` 2.98 (this lockfile) does **not** auto-retry and reports an abort as `code: ""` (checked in
  `node_modules`).
- Only `get_org_leaderboard_stats` is paused. `get_agency_group_leaderboard` and the direct `wins` / `clients` reads are not.
- A future server guard (PR #383, not approved, not applied) would answer `PT429` "Standings are busy".
- #383 recorded a bounded read-only production EXPLAIN of the month aggregate at **48 ms** on the existing
  `idx_calls_org_created_at` — the aggregate is cheap when it is not stampeded.

### 1.3 "The attached plan"
The request referred to an attached plan. **No attachment reached this session.** This plan was built from the
request text, the repository and the #382/#383 incident documents. If the attached plan differs, send it and this
plan will be revised before any code is written.

---

## §2. Current behaviour on `main` (evidence)

| # | Where | What happens | Why it matters |
|---|---|---|---|
| E1 | `src/hooks/useLeaderboardData.ts:553-554` | `setInterval(pollRefresh, Number(VITE_LEADERBOARD_POLL_MS \|\| 4000))` — standings RPC **and** wins feed every 4 s per visible tab. | ~15 standings + ~15 wins/clients reads per minute per tab. |
| E2 | `useLeaderboardData.ts:492-501, 531-546` | Realtime INSERTs on `calls`, `appointments`, `wins` schedule a standings refresh after 550–1050 ms, with no visibility check. | An Admin tab (sees every org call) refreshes on nearly every call, **hidden tabs included**. `appointments` is not in the realtime publication (#23), so that subscription never fires. |
| E3 | `useLeaderboardData.ts:419-428` | Every trigger starts a new RPC; `fetchGenerationRef` only discards stale *results*. | Slow responses overlap and pile up (incident: 20 s mean / 44 s max leaderboard latency). |
| E4 | `useLeaderboardData.ts:395-403` | Failure sets `loadError`; polling continues at 4 s. | `PT503` re-requested every 4 s by every tab. |
| E5 | `useLeaderboardData.ts:434-467` | Wins feed: no error handling (`data` null ⇒ `[]`), no generation/scope guard, fetched in parallel at mount. | A failed or still-pending read shows **"No wins yet. Get dialing…"**; a late org response can land under "Group Recent Wins". |
| E6 | `useLeaderboardData.ts:73-117, 376-417`; `LeaderboardWidget.tsx:98-112` | A period / view switch keeps the old rows; only the error string changes on failure. | A failed switch shows Today's rows under "This Week" (CSV and TV totals included); the widget shows Group rows under "My Agency". |
| E7 | `useLeaderboardData.ts:315-319`; `LeaderboardWidget.tsx:98-103` | Any group failure silently switches to the org view. | During the pause the group RPC is the only working source; the fallback sends users to the paused one. |
| E8 | `leaderboardPremium.ts:14-24, 52-64`; `useLeaderboardData.ts:353-367` | Group premium / 7-day-wins sub-reads ignore their errors (`data \|\| []`). | Renders "$0" / "0" as live values. |
| E9 | `LeaderboardErrorBanner.tsx:36-41` | "Standings are unavailable right now. Check your connection and try again." Retry unbounded. | Wrong during maintenance. |
| E10 | `TVMode.tsx:110-123, 366-372, 473-477, 649-652, 752-758` | TV gets no status. With nothing loaded: empty podium, **zero** agency totals, "Live Feed", "Live Ranking", "LIVE NEWS FEED · No wins yet — get dialing!". | Presents an outage as a live zero board. |
| E11 | `LeaderboardWidget.tsx:31-152, 173-185` | Generic "Couldn't load standings"; Retry unbounded; skeleton replaces the snapshot on every run. | No maintenance message; Retry spam reaches the RPC. |
| E12 | `useDashboardStats.ts:146-198` | `setInterval(fetchStats, 120000)`; per-query `error`s ignored (`count ?? 0`); no stale-response guard. | The Dashboard's only automatic refresh; a failed refresh writes zeros. |

Unchanged-and-correct today (preserved): canonical RPC-only org standings (#23); `changeMetric` re-ranks cached rows
with **zero** network; newest-only commits; last snapshot behind a stale banner; deterministic tie-break; CSV / podium
/ TV entry; Dashboard widget D-1…D-6 presentation.

---

## §3. Scope

**In scope (the five requested items):**
1. Serialize and coalesce standings and Recent Wins requests.
2. Controlled polling, hidden-tab (and offline) suppression, error backoff, maintenance handling.
3. Preserve scope isolation, stale-response protection and network-free metric switching.
4. Truthful maintenance/stale states on the Leaderboard page, the Dashboard widget and TV mode (plus Recent Wins).
5. Remove the Dashboard's automatic refresh; add one bounded manual Refresh control.

**Out of scope:** any backend change (#383 guard SQL, index work, un-pausing); `get_agency_group_leaderboard`'s known
metric differences (#23 follow-up); `AgentScorecardModal` (not mounted anywhere); other Dashboard widgets' data logic;
the stat cards' pre-existing zeros on a *first-load* failure; telephony/dialer; dependency or config changes; merging;
deploying.

---

## §4. Design

### 4.1 `src/lib/leaderboardRequestGate.ts` (new, pure TypeScript, no React)

**Failure classification:** `PT503` → `maintenance`; `PT429` → `busy`; the gate's own 25 s timer → `timeout`;
anything else (network `status 0`, `42501`, 4xx/5xx, empty response, a thrown sub-read) → `error`. Raw database
messages are never shown.

**Backoff (D-3):** `maintenance` fixed **5 min** ± 10 % (the server hint says "Avoid repeated retries"); `busy` 15 s
doubling to 2 min; `error` / `timeout` 30 s doubling to 5 min; ± 20 % jitter so many tabs don't retry together.

**Poll interval (D-1):** default **30 s**; `VITE_LEADERBOARD_POLL_MS` accepted only within 30 s – 5 min; the legacy 4 s
value or anything invalid falls back to 30 s.

**The gate** — one per viewer `${authUserId}:${organizationId}` (D-5), from a small module registry
(`getLeaderboardRequestGate(identity)`). It stores **only scheduling metadata** (in-flight request, queue, per-endpoint
failures / cooldown / last start / last response time) — **never standings or wins rows** — so nothing can cross users
or organizations. Only idle gates are evicted (at most 4 kept); `resetLeaderboardRequestGates()` aborts and settles
everything (tests).

`gate.run({ endpoint, channel, key, mode, owner, notBefore?, load })`:
- `endpoint`: `org_standings` | `group_standings` | `wins` — cooldowns are per endpoint, so the unpaused Group RPC and
  the wins feed are never blocked by the org pause;
- `channel`: `standings` | `wins`;
- `key`: **consumer + endpoint + view + group id + period + period START** — never the moving `p_end = now`, so
  identical work really coalesces, and the page and the Dashboard widget never share a result;
- `mode`: `initial` (mount / filter change) · `auto` (poll, realtime, visible/online again, retry timer) · `manual`
  (Retry, Dashboard Refresh);
- `owner`: the calling hook/component; `gate.release(owner)` on unmount or identity change drops that owner's
  not-yet-started work **with no network call**;
- `notBefore`: the realtime win path never joins a wins read that started before the INSERT arrived;
- `load(signal)`: performs the reads with `.abortSignal(signal)` and returns rows or an error.

Rules:
1. **Serialize:** at most **one request in flight per gate**, across all endpoints. A filter change therefore waits for
   the in-flight request (typically ~50 ms; never more than the 25 s timeout) under the existing refresh spinner,
   instead of stacking a second aggregate on a slow database.
2. **Coalesce:** a request whose key matches the in-flight or the queued request joins it; a queued entry takes the
   strongest mode of its joiners (manual > initial > auto).
3. **Bounded queue:** at most one queued request per channel; a newer one replaces the older, which resolves
   `superseded` without touching the network. Order: standings before wins.
4. **Cooldown, checked twice:** after a failure the endpoint is blocked until `now + delay`. `initial` / `auto` runs are
   refused during a cooldown **when requested and again right before a queued run starts** — an in-flight `PT503`
   plus a queued period switch is exactly one RPC. A success clears the failure count.
5. **Automatic spacing:** an `auto` run starts no sooner than 15 s after the endpoint's last start of **any** mode and
   no sooner than `max(15 s, 2 × last response time)` after the last response — a 20 s response pushes the next
   automatic request to 40 s after it returned.
6. **Manual (D-4):** accepted no sooner than 30 s after the endpoint's last request started **and** 15 s after it
   returned (so a click can never overlap a timed-out query that may still be running on the server). It may bypass an
   `error` / `timeout` backoff (a person asked), but **never a `maintenance` or `busy` hold** — the server's hints say
   "Avoid repeated retries" / "Retry after the client cooldown"; during those holds the UI shows the next automatic
   check instead of an active Retry.
7. **Timeout:** the gate races `load()` against its own 25 s timer and aborts; the lane is freed at 25 s even if a
   sub-read never settles, and the result is classified from the gate's flag, not the error shape.
8. **Results:** `ok` · `failed {kind, retryAt}` · `blocked {reason: "cooldown", kind, retryAt}` ·
   `blocked {reason: "throttled", availableAt}` · `superseded`.

(A prototype of this module and 12 unit tests already pass in the session scratchpad; it is not in the repository.)

### 4.2 Result → state rules (hook and widget)

| Result | Loading flags | Status / `loadError` | Snapshot on screen |
|---|---|---|---|
| `ok` (newest generation, current scope) | settled | `ok`, `lastUpdatedAt = now`; retry timer cancelled | replaced, **tagged with its scope** |
| `failed` | settled | kind + next check; `loadError` set | kept **only if its scope tag equals the current scope**; otherwise cleared → no-snapshot panel |
| `blocked: cooldown` | settled | same as `failed` (e.g. remount during the pause → maintenance panel, **0 requests**) | same as `failed` |
| `blocked: throttled` | settled | unchanged; the Retry control shows when it re-enables | unchanged |
| `superseded` | settled only if still the newest generation | unchanged | unchanged |

"No agents on the board" / "No sales data yet" / "No wins yet" appear **only** after a successful read for the current
scope returned nothing.

**Group view (D-12):** a group failure no longer silently switches to "My Agency" (which during the pause is the
paused endpoint). The view stays on Group and shows the group's truthful error/stale state with Retry; the user can
switch to My Agency themselves. Group sub-reads (premium, 7-day wins) that fail now fail the group load instead of
rendering "$0" / "0".

### 4.3 `useLeaderboardData` (Leaderboard page and TV mode share one instance)

- **Identity & isolation:** `identityKey = ${user.id}:${profile.organization_id}` — the real auth user (what the RPC
  checks as `auth.uid()`) plus the effective organization. View As keeps the real `user` and is forced into the same
  organization, so it does not reset. On an identity change (in a layout effect, before paint) the hook synchronously
  clears `agentsRef` and resets agents, wins, `loadError`, both statuses, `initialLoading = true`,
  `filterRefreshing`, `hasLoadedOnceRef`, `latestWinIdRef`, the rank-snapshot refs, dirty flags and every scheduler
  timer, bumps both generations and releases its queued work. The realtime channel stays keyed and filtered by
  `organization_id`, but **binds only `wins` INSERTs** (D-2): the `calls` binding is removed (it shares the org-wide
  `calls` stream the dialer relies on, costs one authorization check per open leaderboard tab per call, and an Agent
  only receives their own calls anyway) and the `appointments` binding is removed (the table is not in the realtime
  publication, so it never fired). Standings changes arrive through the 30 s poll.
- **Scope-tagged snapshots:** standings are tagged `identity | view | group | period`; wins `identity | view | group`
  (wins are not period-scoped). The stale strip appears only when the tag matches the selection; a failed or blocked
  switch clears the rows (so CSV export and TV totals can never pair old numbers with a new label).
- **Stale-response protection:** `fetchGenerationRef` (newest only) plus the scope check; the wins feed gets the same
  (`winsGenerationRef` + scope check). The group load (RPC → premium → 7-day wins) is one gated unit.
- **Metric switching:** `changeMetric` untouched — zero requests (RPC or table), synchronous re-rank.
- **No double mount fetch:** fetches depend on the *selected group id* instead of the `agencyGroup` object, so group
  info arriving after mount no longer re-sends the org request.
- **Effects split** so tab switches never touch realtime: (a) realtime channel effect keyed on organization/identity,
  calling refs; (b) one scheduler effect owning the poll interval (only while visible; idempotent start), trailing and
  retry timers, and `visibilitychange` / `online` / `offline` listeners; (c) scheduler timers in their own refs,
  outside `clearAllSequenceTimers`, so a metric or period switch never cancels a scheduled re-check. All cleared on
  unmount and identity change.
- **One automatic trigger path** `requestAutoRefresh()`: only when visible and online; inside a cooldown it arms one
  retry timer at `retryAt` instead; otherwise the gate's spacing decides and one trailing timer fires at
  `autoAvailableAt`. Sources: the 30 s poll, a `wins` INSERT, becoming visible / online again (only if something
  changed or the data is older than one poll), and the retry timer. A tab that mounts hidden defers its first load
  until shown.
- **Recent Wins (D-6):** fetched through the same gate **after** the standings commit for the current scope (so a group
  query never uses the org roster), then on the automatic cadence **whenever standings are on screen** (even if a
  standings refresh failed), and on a `wins` INSERT with `notBefore = event time`. The win flash/spotlight runs only if
  the new win is in the committed list and the viewer is unchanged. Nothing is fetched for Recent Wins while no
  standings are displayed. A failed read keeps the previous list (same scope only).
- **Return value:** existing fields kept; `standingsStatus { kind: "ok"|"maintenance"|"busy"|"error", lastUpdatedAt,
  nextCheckAt, manualAvailableAt, offline }`, `winsStatus { kind: "loading"|"ok"|"error", lastUpdatedAt }`;
  `loadError` kept (non-empty whenever standings are not ok) for #23 compatibility; `retry()` is the bounded manual
  run; `fetchData()` keeps working for tests as an unthrottled `initial` run.

### 4.4 Status copy (one pure table: `src/lib/leaderboardStatusCopy.ts`)

| State | Page / TV (full) | Page / TV (strip over a snapshot) | Dashboard widget |
|---|---|---|---|
| maintenance | **"Standings are paused for maintenance."** "We'll check again automatically at 3:47 PM." (no active Retry during the hold) | "Standings are paused for maintenance — showing results from 3:42 PM." | "Standings are paused for maintenance. You can check again at 3:47 PM." / "…showing results from 3:42 PM." |
| busy | "Standings are busy right now." "Retrying at 3:43 PM." | "Standings are busy — showing results from 3:42 PM." | same, without a retry time |
| error | "Couldn't load the leaderboard." "We'll try again automatically at 3:43 PM." | "Couldn't refresh standings — showing results from 3:42 PM." | "Couldn't load standings" / "Refresh failed — showing results from 3:42 PM." |
| offline | "You're offline — standings will refresh when you reconnect." | same idea | — |
| loading | skeleton (page) / "Loading standings…" (TV) | — | skeleton only when nothing is on screen |

- A "next check" time is shown **only while a timer is actually armed and in the future**; the Dashboard never promises
  an automatic check (it has none).
- Zero-activity copy is qualified when stale: "No activity as of 3:42 PM" (page), "No sales recorded as of 3:42 PM"
  (widget); it is suppressed on the full error panels.
- Times: page and widget use the viewer's browser clock with the agency's 12/24 h preference where available; TV uses
  the same agency timezone as its clock.
- **Accessibility:** status copy sits in `role="status"` / `aria-live="polite"`; a Retry that is not yet allowed uses
  `aria-disabled="true"`, stays focusable, does nothing on click, and is described by visible text "Retry available at
  3:43 PM" (`aria-describedby`); Tailwind `aria-disabled:` styles. One one-shot timer re-enables it (no ticking).

### 4.5 Leaderboard page (`Leaderboard.tsx`) and `LeaderboardErrorBanner`

`LeaderboardErrorBanner` renders the full panel and the strip from `standingsStatus` + the table above (headline stays
the hook's `loadError`, so existing callers and tests keep their text). The page passes `standingsStatus`, `winsStatus`,
`initialLoading` and `retry` through; its own growth is a few lines of props.

### 4.6 TV mode (`TVMode.tsx` + new `TVStandingsNotice.tsx`) — D-8

New optional props `standingsStatus`, `winsStatus`, `loading`, `onRetry`:
- **Nothing loaded + not ok (or still loading):** toolbar kept (clock, settings, exit). The podium, table, deep-rank
  panel, totals and Recent Wins are replaced by `TVStandingsNotice` — large TV-styled copy from §4.4 **plus the three
  period buttons**, so a TV user can switch period without leaving TV. No zero totals.
- **Snapshot + not ok:** a compact notice strip at the top of `<main>`.
- **"Live" wording only when live:** the Activity icon + "Live Feed", "Live Ranking: {metric}" (→ "Ranking: {metric}")
  and the footer "LIVE NEWS FEED" (→ "NEWS FEED") follow `standingsStatus`.
- **Ticker:** "No wins yet — get dialing!" only after a successful empty wins read; when wins aren't loaded or failed,
  the custom banner if set, otherwise neutral status copy ("Standings paused — last update 3:42 PM" / "Recent wins
  unavailable").
- TV's Recent Wins panel receives `winsStatus`. Auto-rotation still only re-ranks cached rows. TVMode is already 774
  lines (pre-existing exception to §7); new UI goes into `TVStandingsNotice.tsx` and the copy table, keeping TVMode's
  growth to prop wiring and a few conditionals. No inline styles in new UI.

### 4.7 Recent Wins (`RecentWinsPanel.tsx`)

New optional `status` (`loading` | `ok` | `error`) and `lastUpdatedAt`: `loading` → skeleton rows (default and TV
variants); `error` with no list → "Recent wins are unavailable right now."; `error` over a list → the list plus
"Couldn't refresh — showing wins as of 3:42 PM."; "No wins yet" only for `ok` + empty. Without the prop it behaves as
today.

### 4.8 Dashboard widget (`LeaderboardWidget.tsx` + new `useLeaderboardWidgetStandings.ts`)

- Data/gate logic moves into `useLeaderboardWidgetStandings` (the widget file shrinks below 200 lines; presentation
  D-1…D-6 unchanged). Identity `${userId}:${organizationId}` with a new `organizationId` prop from the Dashboard.
  Endpoints `org_standings` / `group_standings`; snapshot tagged with view + group. Like the hook, it depends on the
  selected group id rather than the `agencyGroup` object, so group info arriving after mount no longer sends a second
  org request.
- **No polling and no automatic retry timer.** Mount / view toggle → `initial`; Retry and the Dashboard Refresh
  (`refreshSignal` prop) → `manual`. The mount-time `refreshSignal` is remembered, so a remount (edit-mode toggle,
  hide/restore) never counts as a click.
- The snapshot stays on screen during a manual refresh (no skeleton flash). If a manual run is throttled, the widget
  says "Standings can refresh again at 3:43 PM".
- An identity change clears the snapshot; a view switch whose load fails shows that view's error, never the other
  view's rows (Group rows never appear under "My Agency").

### 4.9 Dashboard refresh (`Dashboard.tsx`, `useDashboardStats.ts`, new `DashboardRefreshButton.tsx`) — D-7

- `useDashboardStats`: remove the 120 s `setInterval`. Data still loads on mount and on period / perspective change. A
  request-id guard covers `setData`, `setLoading` and errors, so an older response can neither overwrite a newer
  selection nor clear its loading state. If **any** stat query returns an error, the previous values are kept (never
  replaced with zeros). `refresh()` returns a promise that settles with the newest request.
- **One control** in the Dashboard controls row: "Refresh" (accessible name "Refresh stats and standings"), showing
  "Updated 3:42 PM". One click refreshes the stat cards and asks the Leaderboard widget for one manual run. Disabled
  (`aria-disabled`, focusable) while refreshing, for 30 s after the Dashboard mounts, and for 30 s after each refresh
  settles; its timer is cleared on unmount. Other widgets keep their load-on-mount behaviour.

### 4.10 Resulting request bounds (per browser tab)

| Situation | `main` today | After |
|---|---|---|
| Leaderboard/TV visible, healthy | ~15 standings + ~15 wins reads/min, plus up to ~1/s realtime-triggered refreshes (Admins); unbounded overlap | ≤ 4 standings requests/min (30 s poll, ≥ 15 s spacing, stretched when slow); wins on the same cadence; **≤ 1 request in flight** |
| Leaderboard/TV **hidden** | realtime-triggered refreshes continue | **0** (only the `wins` subscription stays open) |
| Pause active (`PT503`) | 15 standings + 15 wins reads/min, indefinitely | **1 standings request per ~5 min per viewer** (manual checks cannot shorten the hold); **0** wins reads while nothing is displayed |
| Dashboard open | 9 stat queries every 2 min (visible or hidden) + widget on mount | widget + stats on mount only; manual Refresh ≤ 1 per 30 s |

---

## §5. Exact files to touch

**New**
1. `src/lib/leaderboardRequestGate.ts` — classification, backoff, poll interval, gate, viewer registry.
2. `src/lib/leaderboardStatusCopy.ts` — pure status/ticker copy and time formatting.
3. `src/lib/__tests__/leaderboardRequestGate.test.ts` — gate + copy unit tests.
4. `src/hooks/useLeaderboardWidgetStandings.ts` — the Dashboard widget's data/gate logic (extracted).
5. `src/components/leaderboard/TVStandingsNotice.tsx` — TV notice/strip with period buttons.
6. `src/components/dashboard/DashboardRefreshButton.tsx` — the bounded Refresh control.
7. `src/components/leaderboard/__tests__/leaderboardStatusSurfaces.test.tsx` — banner, TV and Recent Wins states.
8. `src/components/dashboard/__tests__/dashboardRefresh.test.tsx` — Refresh bounds and `useDashboardStats`.

**Edited**
9. `src/hooks/useLeaderboardData.ts`
10. `src/hooks/__tests__/useLeaderboardData.test.tsx`
11. `src/pages/Leaderboard.tsx`
12. `src/pages/__tests__/leaderboardPage.test.tsx`
13. `src/components/leaderboard/LeaderboardErrorBanner.tsx`
14. `src/components/leaderboard/RecentWinsPanel.tsx`
15. `src/components/leaderboard/TVMode.tsx` (props, notice/strip placement, live labels, ticker text)
16. `src/components/leaderboard/leaderboardPremium.ts` (optional `signal`; surface read errors instead of `data || []`)
17. `src/components/dashboard/widgets/LeaderboardWidget.tsx`
18. `src/components/dashboard/__tests__/leaderboardWidget.test.tsx`
19. `src/pages/Dashboard.tsx` (Refresh control, `refreshSignal` / `organizationId` props only)
20. `src/hooks/useDashboardStats.ts` (remove interval; request-id guard; keep values on error)
21. `AGENT_RULES.md` — amend invariant #23's frontend contract (D-9; Doc Update Rule §9)
22. `implementation_plan.md` (this file) and `WORK_LOG.md` (newest-first entry)

**Not touched:** every `supabase/**` file, `src/integrations/supabase/types.ts`, `package.json` / lockfile, CI, Vercel
config, `TwilioContext`, dialer files, other Dashboard widgets, PR #381/#382/#383 branches.

---

## §6. Decisions for Chris (recommendation first)

| ID | Decision | Recommendation | Alternative |
|---|---|---|---|
| **D-1** | Poll cadence | **30 s** default; env override clamped to 30 s – 5 min; legacy 4 s rejected | 60 s default |
| **D-2** | Realtime `calls` / `appointments` triggers | **Remove both bindings; keep the `wins` binding (celebrations); rely on the 30 s visible-only poll** | Keep them behind the ≥ 15 s throttle |
| **D-3** | Backoff numbers | **Maintenance 5 min ±10 %; busy 15 s→2 min; error/timeout 30 s→5 min ±20 %; 25 s timeout** | Tune |
| **D-4** | Manual Retry / Refresh | **Accepted ≥ 30 s after the last request started and ≥ 15 s after it returned; may bypass an error/timeout backoff but never a `maintenance` or `busy` hold (the UI shows the next automatic check instead)** | Let manual runs bypass every hold |
| **D-5** | Where backoff state lives | **Shared per-viewer gate (metadata only) so maintenance/backoff survive Dashboard ↔ Leaderboard ↔ TV navigation.** No data cache, so each remount (navigation, Dashboard edit-mode toggle) outside a hold still sends one request — accepted as human-paced | Per component; or add a ≤ 10 s per-viewer success cache (#383 had one) |
| **D-6** | Recent Wins | **After standings, same gate and cadence while standings are on screen; own truthful loading/error state** | Keep the parallel fetch at mount |
| **D-7** | Dashboard Refresh scope | **Stat cards + Leaderboard widget; one button in the controls row** | Refresh every widget (touches 5 more widget files) |
| **D-8** | TV with nothing loaded | **Full notice with period buttons replacing podium/table/totals/wins; "live" wording only when live** | Strip only |
| **D-9** | AGENT_RULES #23 amendment (**required** by the Doc Update Rule §9) | **Wording as in §4 (frontend facts only):** single-flight per viewer, 30 s visible-only poll, only `wins` realtime, `PT503` = maintenance hold (PostgREST maps `PTxyz` → HTTP xyz; postgrest-js 2.98 has no auto-retry and reports aborts as `code: ""`), scope-tagged truthful states, no Dashboard auto-refresh | Different wording |
| **D-10** | PR #383 | **This branch supersedes #383's frontend (commit `6ee612ad` and its gate `src/lib/leaderboard-request-gate.ts`); #383 stays open and untouched; if the backend guard is wanted later it is re-cut on a backend-only branch for its own approval, so a second gate never lands** | Build on #383 instead |
| **D-11** | Backoff across full page reloads / new tabs | **Memory only** (a reload during the pause sends one request — human/kiosk-paced) | Persist `{blockedUntil, kind}` per viewer in `sessionStorage` |
| **D-12** | Group failure behaviour | **Stay on Group with a truthful error/stale state (no silent switch to the paused org view); failing group sub-reads fail the load instead of showing $0/0** | Keep today's silent fallback to My Agency |

---

## §7. Verification plan

**Baseline on clean `main` @ `62684da`, captured before any edit (scratch, not committed):**
`npx tsc --noEmit` exit 0 (vacuous: `"files": []`, AGENT_RULES #35); `npx tsc -p tsconfig.app.json --noEmit` exit 2
with **91 errors**; targeted ESLint of the 11 existing files to edit: clean; `npm run build`: OK; full `npx vitest run`
(no `.env`): **3264 tests — 3251 passed / 1 failed / 12 skipped; 13 failed suites in 12 files** (11 fail to load with
"supabaseUrl is required", plus `recordingRetentionVoicemail.test.ts` "…byte-identical to deployed v29"). This matches
the 2026-09-24 WORK_LOG record.

**After implementation:**
1. Focused suites (gate, hook, page, widget, status surfaces, Dashboard refresh), each run several times.
2. Required coverage: coalescing (20 simultaneous refreshes → one request, ported from #383's gate scenarios);
   one-in-flight; bounded queue / `superseded`; per-endpoint cooldown checked at request
   and at start (in-flight `PT503` + queued switch = one RPC); `PT503` hold with **no network** while blocked;
   automatic spacing incl. slow responses; manual bounds (a manual run during a `PT503` or `PT429` hold calls `load()`
   zero times); a superseded queued context makes zero network calls; 25 s timeout frees the lane even if `load()` never settles;
   poll cadence + env clamp; hidden/offline suppression of poll, realtime and retry timers and resume on return;
   identity change clears data before paint and never shows another viewer's rows; scope-tagged snapshots (period /
   view switch during a hold never shows the old rows); newest-only commits for standings **and** wins; metric switch
   = zero requests; `agencyGroup` null → object = one org RPC; realtime `subscribe` count stays 1 across visibility
   changes, failures and metric switches, and the channel binds only `wins`; unmount with queued wins = no request, no timers; truthful copy for every
   state in §4.4 (never zeros, never "No wins yet" / "No agents on the board" on failure or while loading, never
   "check your connection" for maintenance, "live" wording only when live); TV notice keeps period buttons; accessible
   disabled Retry; Dashboard has no interval, Refresh is bounded, remount never counts as a click, stat errors keep
   previous values.
3. Existing pinned behaviour kept. Harness changes: mocks gain `.abortSignal()` on RPC and table builders;
   `resetLeaderboardRequestGates()` in every leaderboard suite's `beforeEach`; the clock is controlled with
   `vi.useFakeTimers({ toFake: ["Date"] })` / `vi.setSystemTime` (RTL `waitFor` keeps working); the widget suite's strict
   console-error filter stays. Tests **restated with the same intent**:

   | Existing test | Why it changes | Restated assertion |
   |---|---|---|
   | hook: "discards an older in-flight response that resolves after a newer one" | requests no longer overlap | two queued runs: the older is `superseded`/discarded; only the newest commits |
   | hook: "a silent poll that supersedes the visible INITIAL fetch settles initialLoading…" | same key now **joins** the in-flight request | the joined silent run settles `initialLoading`/`filterRefreshing`; one RPC; nothing can resurrect loading |
   | hook: "a silent poll that supersedes a visible FILTER refresh settles filterRefreshing" | serialization | the newest run settles `filterRefreshing`; the superseded run cannot touch it |
   | hook: "a period switch mid-flight discards the old period's late response" | the switch waits for the in-flight request | the week request starts only after today's settles; today's data never commits under This Week |
   | hook: "a superseded stale response can never restore the previous metric's ordering" | overlap mechanics | same guarantee via serialized runs |
   | hook: "retry() clears the error and reloads standings" | 30 s manual spacing | retry before 30 s sends nothing; after 30 s it reloads and clears the error |
   | widget: "Retry recovers", "keeps the last ranked snapshot behind the stale note", "keeps the stale note (with a working Retry)…" | 30 s spacing; a `userId` change is now an identity reset | re-fetch via `refreshSignal`/Retry after advancing 30 s; the snapshot survives a failed **same-viewer** refresh; zero-sales copy reads "as of h:mm" when stale |
   | widget: three "stale-response protection" tests (two pending at once) | serialization + identity reset | queued/superseded runs never commit; an identity change clears the snapshot |
   | widget: "falls back to org standings when the group RPC fails, and resets the toggle…" | D-12 | Group stays selected and shows its truthful error; no org RPC is sent on its behalf; Retry after 30 s requests the group again |
   | widget: "hides group org names when a kept group snapshot is shown under My Agency…" | that is the mismatched-scope case | My Agency with a failing org load shows the org error state, never Group rows |
   | page: `baseHookState` | new hook fields | adds `standingsStatus` / `winsStatus` defaults |

4. `npx tsc --noEmit` and **`npx tsc -p tsconfig.app.json --noEmit`** (the real check) — error set identical to the
   baseline; zero new errors.
5. Targeted ESLint on every touched file (`--max-warnings 0` for new files).
6. `npm run build`.
7. Full `npx vitest run`, compared file-by-file with the `main` baseline.
8. Independent adversarial review of the diff before commit.

No browser/preview smoke test against a hosted backend is planned or claimed (a preview may point at production).

---

## §8. Explicit non-actions

No Supabase MCP call (read or write), no `apply_migration`, no replay/rollback/edit of `20260923224254`, no un-pause,
no RLS/grant/RPC/Edge Function change, no production data access, no Vercel action, no merge, no push to `main`, no
change to PR #381/#382/#383. Pushing this branch may trigger Vercel's automatic **preview** build; that is not a
production deployment.

---

## §9. Risks and rollback

- **Staler standings:** updates within ~30 s instead of ~4 s (win celebrations still fire from the `wins` INSERT).
  Accepted trade-off for load safety.
- **Filter switches can wait** behind an in-flight request (normally ~50 ms; ≤ 25 s when the database is slow).
- **Shared gate state:** metadata only, keyed by viewer, bounded, never evicted while busy.
- **Group behaviour change (D-12)** and **test churn** as listed in §7.3.
- **Known limitation:** aborting a request frees the browser but cannot cancel the database query; the serialize rule
  and backoff bound the server cost instead.
- **Rollback:** revert this branch's commits; no data or schema is involved.

---

## §10. Plan history

- This file on `main` @ `62684da` held the Team / Open Pool lead-details plan (rev 1–7 and §11); @ `f78140d` the
  Dashboard Leaderboard widget plan. Both remain in git history.
- The incident's own records (containment note, approved emergency scope, #383 recovery plan) live on the unmerged
  branches of PR #382 / #383 under `docs/incidents/2026-09-23-*` and are not copied here.

---

## §11. Pre-approval design review (2026-09-25)

Four independent read-only reviewers critiqued the first draft against the code. Findings adopted above:
- **Concurrency:** coalescing key must exclude `p_end`; cooldown re-checked when a queued run starts; spacing measured
  from any start and stretched by response time; typed `blocked` reasons; timeout owned by the gate; owner release;
  never evict a busy gate.
- **React lifecycle:** result → state table; identity reset list and before-paint reset; scope-tagged snapshots; split
  effects so visibility/failures never re-subscribe realtime; scheduler timers outside `clearAllSequenceTimers`; the
  realtime win handler re-checks viewer and only celebrates committed wins; `agencyGroup` double fetch; test harness
  and the explicit list of restated tests.
- **Truthful UX:** mismatched-scope snapshots; TV ticker / "LIVE" labels / period buttons; Recent Wins loading state and
  scope; group fallback to the paused endpoint and $0 sub-reads (D-12); Dashboard Refresh naming, throttled first
  click and error-to-zero stats; accessible disabled Retry; only-armed "next check" times; stale zero-activity copy;
  component-size extractions.
- **Scope/safety:** manual runs must not bypass `maintenance` / `busy` holds (D-4 changed); remove the `calls` /
  `appointments` realtime bindings (D-2 changed); `leaderboardPremium.ts` added to the file list with error
  propagation; the #23 amendment is required, not optional; record #383's frontend as superseded; the widget's own
  `agencyGroup` double fetch; TV footer/ticker. No backend, secret, service-role, RLS or telephony exposure was found
  in the plan.
- The adversarial verification pass run on the findings confirmed every finding it checked (none refuted).
