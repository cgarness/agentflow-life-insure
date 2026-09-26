# Implementation Plan — Leaderboard recovery: frontend request discipline + truthful maintenance/stale states (rev 1.3 — rev 1.1 APPROVED 2026-09-25; rev 1.2 = Chris's corrections, §13; rev 1.3 = two approved corrections, §14)

> **REV 1.3 (2026-09-26, APPROVED by Chris):** two frontend corrections, recorded in **§14** with the exact files before any
> edit. Chris explicitly approves a **narrow exception to edit `src/lib/dashboard-callbacks.ts` for request-lifetime handling
> only**. Its data sources, ownership rules, ordering, pagination, exact totals and contact-resolution behaviour are preserved.
> No further approval is needed for these two corrections. Still frontend only: no merge, push to `main`, deploy, backend
> change, lifting of the production pause, or change to PRs #382/#383.
>
> **REV 1.2 (2026-09-25, Chris, within the approved recovery scope):** three corrections — coordinated, non-overlapping
> Dashboard refresh; visibility/connectivity re-checked before every dispatch (including post-standings Recent Wins and
> queued work, and an offline mount); same-selection data kept on a failed refresh with a clear section-level
> failure/stale indication. Recorded in **§13** with the exact files, before any edit. Still frontend only.

> **APPROVAL (2026-09-25, in session):** Chris approved rev 1 **as written**, with D-12 = stay on Group with a truthful
> error, D-2 = remove the `calls` + `appointments` bindings, and **D-7 changed to "Every Dashboard widget"** (§4.9 and
> §5 updated below as rev 1.1). Every other decision follows its §6 recommendation. Scope remains frontend only.
>
> **STATUS (rev 1, 2026-09-25): PLAN ONLY at the time of approval. No application file had been edited and no backend command had run.**
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
- **One control** in the Dashboard controls row: "Refresh" (accessible name "Refresh dashboard"). One click refreshes
  the stat cards and sends one `refreshSignal` increment to **every Dashboard widget** (D-7 as approved): Callbacks,
  Schedule, Goal Progress, Leaderboard (one bounded manual run through the gate), Missed Calls and Anniversaries.
  Disabled (`aria-disabled`, focusable) while the stat refresh runs, for 30 s after the Dashboard mounts, and for 30 s
  after each refresh settles; its timer is cleared on unmount. It shows "Refreshing…" while running and does not claim
  "Updated" (the Dashboard cannot confirm every widget succeeded).
- Each of the five other widgets gains an optional `refreshSignal` prop in its existing load effect (a remount still
  loads once, exactly as today), a cancellation guard so an older load can never commit after a newer one, and — where
  the widget has no error state of its own — a failed **refresh** keeps the rows already on screen instead of replacing
  them with an empty list or zeros (on first load nothing was on screen, so first-load behaviour is unchanged).
  Missed Calls and Anniversaries also clear their list when a refresh returns nothing (today they would keep stale rows).
  Callbacks keeps its existing explicit error state.

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
19a. `src/components/dashboard/widgets/CallbacksWidget.tsx`, `AppointmentsWidget.tsx`, `GoalProgressWidget.tsx`,
     `MissedCallsWidget.tsx`, `AnniversariesWidget.tsx` — `refreshSignal` prop + guard only (D-7 as approved)
20. `src/hooks/useDashboardStats.ts` (remove interval; request-id guard; keep values on error)
21. `AGENT_RULES.md` — amend invariant #23's frontend contract (D-9; Doc Update Rule §9)
22. `implementation_plan.md` (this file) and `WORK_LOG.md` (newest-first entry)

**Not touched:** every `supabase/**` file, `src/integrations/supabase/types.ts`, `package.json` / lockfile, CI, Vercel
config, `TwilioContext`, dialer files, PR #381/#382/#383 branches.

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
| **D-7** | Dashboard Refresh scope | ~~Stat cards + Leaderboard widget~~ → **APPROVED: every Dashboard widget** (touches 5 more widget files) | Stat cards + Leaderboard widget only |
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

---

## §12. As built (2026-09-25, rev 1.1 approved scope) — NOT merged, NOT deployed

Implemented on `claude/agentflow-leaderboard-recovery-uney6j` exactly as §4 describes, frontend only. Deviations from
the §5 file list, all small and in scope:
- **`src/hooks/useTimeReached.ts` (new, 15 lines):** the one-shot "has this time passed" hook used by the Retry and
  Refresh controls. Kept out of `LeaderboardErrorBanner.tsx` so that file exports only components (fast refresh).
- **`src/pages/__tests__/dashboardRefreshWiring.test.tsx` (new):** proves one accepted Refresh click signals every
  widget; it stubs the widget modules, so it cannot share a file with the real-widget tests.
- `LeaderboardRetryButton` is a named export of `LeaderboardErrorBanner.tsx` (reused by TV and the widget). Retry and
  Refresh check the clock at click time as well as through their re-enable timer.
- **Mounted guards** in both hooks: after unmount nothing commits and nothing new is requested (found while writing
  the unmount test).
- The Dashboard Refresh button's accessible name is "Refresh dashboard"; it never claims "Updated".
- One **pre-existing** type error (`Win` → `WinPremiumRow` in the wins premium mapping) disappeared because that code
  moved into `loadRecentWins`; the app typecheck went from 91 to 90 errors with no new error.

Sizes: `TVMode.tsx` 774 → 834 lines, `RecentWinsPanel.tsx` 245 → 269, `Leaderboard.tsx` 252 → 281 (all already over
the §7 guideline before this work); `LeaderboardWidget.tsx` 235 → 143 (its logic moved into
`useLeaderboardWidgetStandings`). New components are all under 200 lines and Tailwind-only.

### §12.1 Post-implementation adversarial review (2026-09-25) — all confirmed findings fixed

Four independent reviewers (gate/scheduling, React state, truthful UI, regressions/scope) read the implemented diff;
a skeptic verified each finding against the code. Confirmed findings and their fixes (each now pinned by a test that
fails without the fix — see the WORK_LOG mutation table):
1. **A Retry joining a queued period switch** made the queued job "manual", so the spacing rule refused it and the old
   period's rows stayed under the new label. The gate now keeps every joiner's mode and runs the job if any of them is
   allowed; a deferred load of a new selection stays in the loading state (never "showing results from" old rows).
2. **A tab opened in the background during a hold** stayed on the skeleton for the whole hold. The first shown/online
   check now settles into the hold's state (no request).
3. **The widget showed the other view's rows while a view switch loaded.** It now shows the skeleton; a manual
   refresh of the same view still keeps its snapshot.
4. **Offline tabs kept "Live" wording.** Offline is now "not live" on the page and TV, with "Standings are not
   updating … You're offline — standings will refresh when you reconnect." and no Retry that cannot succeed.
5. **Realtime wins skipped the spacing rule** (20 INSERTs → 20 reads). They are now automatic runs with one trailing
   read for a burst; the celebration fires when ANY committed list contains the win (it was dropped when two reads
   joined).
6. **Recent Wins stopped during a standings hold** even with standings on screen. They keep their own spaced cadence;
   a standings run that sent nothing (a refused manual Retry) no longer triggers a wins read.
7. **The widget ran on a second gate while the organization id was unknown.** It now waits for both ids.
8. **The promised "next check" could be earlier than the real one** after a slow or timed-out answer. It is now the
   time the gate will really accept the automatic run.
9. **The TV ticker could say "Loading recent wins…" forever** (standings failed, or an empty roster). The ticker shows
   neutral status copy, and an empty roster still loads its org wins.
10. **A TV period switch kept "Live" on the previous period's rows.** TV now shows "Loading standings for this period…"
    and drops the live wording until the new period commits.
11. **Accessibility:** the Recent Wins skeleton is a `role="status"` region with screen-reader text; the Refresh
    button's accessible name follows its visible state ("Refresh dashboard" / "Refreshing… dashboard", `aria-busy`).
12. **Stats:** my first version zeroed every card on a first-load failure of any query (including two queries no card
    displays). A first load or a switch now behaves exactly as on `main`; only a failed Refresh of the same selection
    keeps the values on screen, and only the displayed queries count.

### §12.2 Second adversarial review round (2026-09-25, on the code after §12.1)

Four reviewers ran again on the updated diff, with finders repeating until two rounds found nothing new; a skeptic
checked each finding against the current tree. Seven findings: six are fixed, and one is recorded as a known
limitation. Each fix has a test that fails without it.
1. **(major) Switching Today → Week → Today while Today was in flight** left the abandoned Week request queued. It
   still ran after Today settled, which is one extra aggregate RPC. If it failed, its hold never reached the status,
   so the page and TV said "Live" during a maintenance hold for up to 5 minutes. Fixes:
   - A request that joins the in-flight job now drops the queued job on the same channel when only this viewer
     wants it and its key differs (`dropQueued`). Jobs another consumer also wants are kept.
   - A poll tick that meets a hold always settles the status into that hold.
2. **(minor) A realtime win queued behind a slow Recent Wins read** was refused as too soon and then dropped. The
   win showed up only at the next poll. The event is now kept and read again as soon as the gate allows it
   (`onThrottled`).
3. **(minor) A Recent Wins timer set while the tab was visible** could send a read after the tab was hidden. Hiding
   the tab now clears that timer. When the tab is shown again, the catch-up refresh reads the feed.
4. **(minor) Group view:** a delayed realtime read after the standings were cleared recorded an empty "ok" wins
   list, so TV could say "No wins yet". A Recent Wins read without an explicit roster now runs only while the
   current selection's standings are on screen.
5. **(minor) The snapshot tag had no period start.** After midnight, or a week or month boundary, a failed refresh
   kept yesterday's "Today" rows, labelled only with a time. The tag now includes the period start.
6. **(minor) A deferred load of a new selection** could leave the spinner on and show old times after an early
   manual Retry. It now settles, and the times are correct.
7. **(minor) Known limitation, not changed:** the Dashboard Refresh button's 30 s window starts when the button
   mounts, not when the Leaderboard widget's gate last ran. The widget shares that gate with the Leaderboard page, so
   the gate can refuse the first accepted click, for example right after a visit to the Leaderboard page.
   - When it refuses, the widget says "Standings can refresh again at h:mm", in its empty-roster state as well.
   - The stat cards and the other five widgets still refresh, and nothing extra is sent.
   - Tying the button to the gate would couple the whole Dashboard to the leaderboard gate for one widget, so it
     is left for Chris to decide.

**After the final mutation run:** the separate "nothing has loaded yet" branch of the hold handling had become
equivalent to the general branch, and its mutation survived for that reason. It was removed: a poll tick that meets
a hold now settles every tab the same way, with no request. Its mutation now targets the general branch and is
caught. One test was also found to pass because of the gate's spacing rather than the rule it names; its clock now
moves past the spacing, and it is caught.

**Mutation proof (final tree):** 42 mutations, each re-breaking one guard on an isolated copy. The repo was never
mutated, and files were restored with a sha256 check.
- 39 are caught.
- The 3 that survive are each one of two layered guards: unmount (M10), parallel Recent Wins at mount (M11) and
  realtime spacing (M22). Removing both guards of each pair (M10b, M11b, M22b) is caught.

---

## §13. Rev 1.2 corrections (2026-09-25, requested by Chris within the approved recovery scope)

Recorded before any edit. Frontend only: no migration, RPC, RLS, grant, Edge Function, Supabase MCP call, production
read or write, Vercel action, merge, push to `main`, or change to PRs #382/#383. **The production pause
(`20260923224254`) stays active.** Metric definitions, query shapes, `organization_id`/RLS boundaries and
`.maybeSingle()` usage are unchanged; no form or modal is added (so no new Zod schema); Tailwind theme tokens only.

### 13.1 What is wrong today (verified in the code at `68810757`)

1. **Dashboard refresh is not coordinated.** `refreshDashboard` awaits only `refreshStats()`. Each widget reloads from
   its own `refreshSignal` effect, and nothing waits for it. The Refresh button therefore re-enables before the widget
   work ends, and nothing stops overlap:
   - A signal that arrives while a widget's load is still running starts a second load for the same data (the
     `cancelled` flag drops the old result but not its request).
   - A perspective or period switch during a load does the same.
   - The edit-mode toggle remounts every widget, and each remount starts its own load.
2. **Some dispatch paths skip the visibility and connectivity check.**
   - `fetchData` chains the post-standings Recent Wins read even when the tab was hidden (or went offline) while
     standings were in flight.
   - The gate starts a queued job without re-checking the tab.
   - The page and TV defer only a *hidden* mount: an *offline* mount sends its request, and the widget and every
     Dashboard section load at mount whether hidden or offline.
3. **Failure feedback is missing or misleading.**
   - `useDashboardStats` keeps same-selection numbers on a failed Refresh but shows no indication.
   - A first-load failure shows the valid-empty message in four widgets:
     - Schedule: "Your schedule is clear for today";
     - Goal Progress: "No goals configured";
     - Missed Calls: "All caught up!";
     - Anniversaries: "No policy anniversaries soon".
   - The same four keep rows on a failed Refresh, but silently.
   - Callbacks re-enters the skeleton on every Refresh, and a failed Refresh clears its rows.
   - Stat cards show "0" / "$0" when nothing is loaded.

### 13.2 Design

**A. Page activity (`src/lib/pageActivity.ts`, new).** `isPageActive()` = the tab is visible AND online.
`onPageActivityChange(listener)` subscribes to `visibilitychange`, `online` and `offline`.
`canAutoRefreshLeaderboard()` keeps its name and delegates to it.

**B. Dashboard sections (`src/lib/dashboardRefresh.ts`, new; pure TypeScript).**
- *Section lanes.* One lane per viewer and section (`${userId}|${section}`), in a module registry like the gate: it
  holds scheduling metadata and one promise, never rows beyond the promise.
  - **One load in flight per section.** A request for the same scope joins it, so a Refresh, a remount or a
    duplicate signal never starts a second load.
  - A different scope (perspective or period switch) replaces the one queued job. It aborts the in-flight load only
    when no other owner still wants it, and starts after that load settles, so the same section never has two
    requests on the wire.
  - **Activity is re-checked right before every dispatch, queued jobs included.** A hidden or offline page resolves
    `inactive` and sends nothing.
  - Each dispatched load gets an `AbortSignal` that fires at **25 s** (`DASHBOARD_SECTION_TIMEOUT_MS`, same as the
    leaderboard gate). The lane is freed only when the load really settles: a load that ignores the signal keeps its
    lane, and later requests join it rather than overlap it.
  - An owner that unmounts is released: its queued work is dropped unsent, and an in-flight load it alone wanted runs
    to its bound, so an immediate remount joins it.
- *Refresh tracker* (`DashboardRefreshTracker`, one per Dashboard mount). Every section reports, for each Refresh
  signal, a promise of its outcome:
  - `ok` / `failed`: work actually started, or joined work already running;
  - `deferred`: nothing sent (the leaderboard's gate spacing or hold);
  - `inactive`: nothing sent (offline);
  - `superseded` / `skipped`.

  `wait(signal, expectedSections, 20 s)` resolves when every expected section has reported and its work has settled,
  or at the bound (`DASHBOARD_REFRESH_WAIT_MS`), whichever comes first. The expected sections are the stat cards plus
  every visible widget at click time. **Leaderboard deferral resolves immediately**, so it never blocks the other
  sections.

**C. `useDashboardSection` (`src/hooks/useDashboardSection.ts`, new).** The React binding every non-leaderboard
section uses:
- a scope-tagged snapshot: data for another user, perspective or period is never exposed;
- `loading` (nothing for this scope yet), `refreshing` (a same-scope load running over data on screen), `failed` (the
  last attempt for this scope failed), `offline` (a load is waiting for connectivity), `updatedAt`, `complete`, and
  `reload()`;
- a Refresh signal (never the mount value, so a remount is not a click) runs one load through the lane and reports it
  to the tracker;
- when the page becomes visible and online again, a load that was deferred for this scope runs once.
- A load **throws** on a returned query error. It may attach a `fallback` value, used only when nothing for the scope is
  on screen. This keeps the stat cards' first-load behaviour (values as on `main`) while still flagging the failure.

**D. Section-level feedback (`src/components/dashboard/DashboardSectionNotice.tsx`, new; one copy table).**

| Data on screen | State | What the section shows |
|---|---|---|
| Yes | Failed | "Couldn't refresh — showing \<section> from h:mm." |
| Yes (stats fallback) | Failed | "Some stats couldn't be loaded — numbers shown may be incomplete." |
| Yes | Offline | "You're offline — showing \<section> from h:mm." |
| Yes | Refreshing | "Refreshing…" |
| No | Failed | A panel: "Couldn't load \<section>." and "Use Refresh to try again." It never shows the valid-empty message. |
| No | Offline | A panel: "You're offline. \<Section> will load when you reconnect." |

All states are `role="status"`; each widget keeps its existing empty-state copy for a successful empty read.
- **Callbacks** keeps its own first-load failure panel and its "Try again" button, now routed through the lane.
- **Stat cards** show the notice above the grid, and "—" instead of "0" / "$0" when nothing is loaded.

**E. Wiring.**
- **`useDashboardStats`:**
  - loads through `useDashboardSection` (section `stats`), with the same nine queries, the same bounds and `.abortSignal()`;
  - a displayed-query failure throws, with the `main`-equivalent values as fallback;
  - an undisplayed failure (leads, talk time) is still success;
  - it returns `{ data, loading, section }` and no `refresh`.
- **`Dashboard.tsx`:**
  - one tracker;
  - `refreshDashboard` bumps the signal and awaits `tracker.wait(signal, ["stats", ...visibleWidgets], 20 s)`;
  - passes `refreshTracker` to the stats hook and every widget.
- **The five widgets** (Callbacks, Schedule, Goal Progress, Missed Calls, Anniversaries):
  - their existing query bodies move, unchanged, into a `load(signal)` function (plus `.abortSignal()` where the query
    is local);
  - `dashboard-callbacks.ts`, the shared callback contract (#22), is **not** edited, so Callbacks loads are not
    abortable; its lane still prevents overlap;
  - the render code keeps its markup.
- **`DashboardRefreshButton`:** unchanged behaviour (30 s after opening and after each settle). `onRefresh` now resolves
  when the reported work settles or at the 20 s bound.

**F. Leaderboard (page, TV, gate, widget).**
- **Gate:**
  - new refusal `{ status: "blocked", reason: "inactive" }` when the page is hidden or offline;
  - it is checked when a run is requested AND again right before a queued job starts (all modes);
  - joining an in-flight request sends nothing and is unaffected.
- **`useLeaderboardData`:**
  - An offline mount defers, as a hidden mount already does, and loads when visible and online.
  - `fetchWins` re-checks activity before every dispatch; the post-standings read, realtime reads and catch-up reads all
    go through it. An inactive page marks the hook dirty, so the catch-up refresh on return reads the feed.
  - An `inactive` standings result for a **new** selection clears the other selection's rows and stays in its loading
    state. For the **same** selection it settles with nothing changed.
- **Page:**
  - offline with nothing loaded shows the offline banner ("Standings are not updating. You're offline — standings will
    load when you reconnect.") instead of an endless skeleton;
  - a switch still loading with no rows shows a board skeleton, never "No agents on the board".
- **TV:** the same. The notice shows the offline copy (no spinner) when offline, and a pending switch with no rows is a
  loading notice, not an empty podium.
- **Widget (`useLeaderboardWidgetStandings`):**
  - reports each Refresh to the tracker: gate spacing or a hold is `deferred`, resolved immediately;
  - an `inactive` refusal keeps the load pending and re-runs it once when the page is visible and online;
  - offline with nothing loaded shows the offline copy with no Retry; offline over a snapshot shows the stale strip with
    the time.

### 13.3 Exact files

**New**
1. `src/lib/pageActivity.ts`
2. `src/lib/dashboardRefresh.ts`
3. `src/hooks/useDashboardSection.ts`
4. `src/components/dashboard/DashboardSectionNotice.tsx`
5. `src/lib/__tests__/dashboardRefresh.test.ts` (lanes + tracker)
6. `src/components/dashboard/__tests__/dashboardSections.test.tsx` (widgets, stats and coordination regressions)

**Edited: application**
7. `src/lib/leaderboardRequestGate.ts`
8. `src/lib/leaderboardStatusCopy.ts`
9. `src/hooks/useLeaderboardData.ts`
10. `src/pages/Leaderboard.tsx`
11. `src/components/leaderboard/TVMode.tsx`
12. `src/hooks/useLeaderboardWidgetStandings.ts`
13. `src/components/dashboard/widgets/LeaderboardWidget.tsx`
14. `src/hooks/useDashboardStats.ts`
15. `src/components/dashboard/StatCards.tsx`
16. `src/pages/Dashboard.tsx`
17. `src/components/dashboard/DashboardRefreshButton.tsx` (contract comment)
18. `src/components/dashboard/widgets/AppointmentsWidget.tsx`
19. `src/components/dashboard/widgets/CallbacksWidget.tsx`
20. `src/components/dashboard/widgets/GoalProgressWidget.tsx`
21. `src/components/dashboard/widgets/MissedCallsWidget.tsx`
22. `src/components/dashboard/widgets/AnniversariesWidget.tsx`
22a. `src/components/leaderboard/leaderboardPremium.ts` — added by the §13.6 review (re-check before its follow-on reads)

**Edited: tests**
23. `src/lib/__tests__/leaderboardRequestGate.test.ts`
24. `src/hooks/__tests__/useLeaderboardData.test.tsx`
25. `src/pages/__tests__/leaderboardPage.test.tsx`
26. `src/components/dashboard/__tests__/leaderboardWidget.test.tsx`
27. `src/components/dashboard/__tests__/dashboardRefresh.test.tsx`
28. `src/pages/__tests__/dashboardRefreshWiring.test.tsx`
29. `src/components/leaderboard/__tests__/leaderboardStatusSurfaces.test.tsx` (if the TV notice copy changes)

**Edited: docs**
30. `AGENT_RULES.md`: #23 amendment (the corrections) and a one-line note in #22 (a failed same-scope Refresh keeps the
    complete previous page and total, with a stale note).
31. `implementation_plan.md`
32. `WORK_LOG.md`

**Not touched:**
- `src/lib/dashboard-callbacks.ts`, `DashboardDetailModal`
- every `supabase/**` file and the generated types
- `package.json` / lockfile, CI, Vercel config
- telephony and dialer files, and PRs #381/#382/#383

### 13.4 Regressions required by Chris (plus the ones the design needs)

1. **Standings resolving after the tab becomes hidden:**
   - no Recent Wins read is sent;
   - on return, the catch-up reads standings and then wins, once.
2. **Mounting offline:**
   - page/TV hook: no standings RPC and no wins read; the page shows the offline banner and TV the offline notice;
     `online` then loads once;
   - Dashboard sections and the Leaderboard widget: nothing sent, offline panels shown, one load each on reconnect.
3. **A widget still pending when another Refresh becomes eligible:**
   - the second Refresh starts no second load for it, and the Refresh wait stays bounded;
   - the other sections refresh, and the pending widget's result still lands.
   - The same guarantee applies to a switch, and to a remount (edit-mode toggle).
4. **A failed Refresh keeps data and shows feedback:** Schedule, stat cards, Callbacks, Goal Progress, Missed Calls,
   Anniversaries and the Leaderboard widget keep same-selection data and show the section-level note.
   - A first-load failure never shows the valid-empty message.
   - The leaderboard cooldown is a deferred section that does not block the others.

Verification follows §7: affected suites, the real app typecheck (`tsconfig.app.json`), targeted ESLint with warnings
treated as errors, build, and the full suite compared with `main` @ `62684da` and with this branch @ `68810757`.

### 13.5 As built (2026-09-25): design changes from the pre-implementation review

Four read-only reviewers critiqued §13 against the code, finders repeating until two rounds found nothing new, and a skeptic verified each finding. Of 22 findings, 13 were confirmed; all 13 are built in, and so are several of the refuted ones. What changed from §13.2 as written:

- **B (lanes):**
  - **Bound, with no stuck section.** At 25 s the lane reports the load `failed` to every waiter, even when the load ignores the abort (Callbacks' shared reads take no signal). That load keeps the lane until it really settles, and its late answer is discarded. Any request meanwhile gets `busy`: nothing is sent, and the section shows the failed note. Work queued behind it is refused the same way.
  - **Switches.** A load aborted because every owner left is *abandoned*. It ends `superseded`, never `failed`, and it is never joined: a request for its scope queues a fresh job behind it. An owner that returns to the in-flight scope drops its own queued detour unsent.
- **B/E (tracker).** The Refresh waits for the sections *registered* (mounted) when it is pressed, not for the layout's widget list. A section that unmounts meanwhile counts as `skipped`. The Leaderboard widget with no organization reports `skipped`.
- **C (hook).**
  - A per-run generation guard: only the newest run for the current scope changes state.
  - **Scopes include the period start:** local day for Schedule, month for Goal Progress, the selected period's start for stats. The load's bounds come from that same value, so after midnight a failed Refresh shows "Couldn't load …" rather than yesterday's rows.
- **C/D (stat cards).** No invented numbers:
  - A displayed value whose query failed is `null` and shows "—" with no trend arrow; the values that did load still show.
  - If all six displayed queries fail, there is no fallback: "Couldn't load stats. Use Refresh to try again."
  - A partial fallback says "Some stats couldn't be loaded — what's shown may be incomplete." and never "from h:mm".
- **D (section notice).**
  - One always-mounted `role="status"` region per section; "Refreshing…" is visual only, so six sections do not announce at once.
  - Callbacks' failure panel gains `role="status"`.
  - Every widget's valid-empty branch carries the notice, so a failed Refresh over an empty list says so.
- **Missed Calls:** a failed contact lookup is a failure (the #22 rule), never rows claiming "no linked contact record".
- **F (leaderboard).**
  - **Selection changes go through the gate.** The mount and selection effect never short-circuits: fetchData, through the gate's `inactive` refusal, is the only deferral, for mount and switch alike, whether hidden or offline.
  - **A deferred new selection:** on `inactive` it clears the other selection's rows, headline and times; a maintenance or busy hold on the endpoint stays shown. It enters its loading state explicitly, a silent run included. A standings commit that succeeds cancels a pending catch-up.
  - **Offline copy makes no promise:** "can't load / refresh until you reconnect". The TV ticker has its own offline line. While offline, a Recent Wins status still at loading is reported as unavailable.
  - **The widget:**
    - with nothing loaded for the view, a Refresh or a resume is a first load (`initial`);
    - offline is tracked live, so a background mount shown while offline says so;
    - an `inactive` new view resets the other view's headline.

Refuted and not built: a per-Dashboard snapshot store to survive edit-mode remounts. The skeptic judged it out of scope (D-5 accepts one load per remount; remounts during a load already join it). Also refuted and not built: separate "wins-only" catch-ups. The catch-up on return reading standings and then wins is intended, and the gate spaces it.

### 13.6 Post-implementation review (2026-09-25): all confirmed findings fixed

Four reviewers read the implemented diff (lanes/hook, Dashboard wiring, leaderboard, test quality); a skeptic
verified each finding, with throwaway probes when feasible. Of 12 findings, 9 were confirmed; with duplicates merged,
there were 4 defects. Each fix has a test that fails without it.

1. **Follow-on reads skipped the activity check.** A read sent after an earlier read of the same load returned went
   out even if the tab had hidden or gone offline meanwhile. Affected: Missed Calls' contact lookups; the leaderboard's
   Recent Wins premium lookup; the group standings' premium and 7-day wins reads. Fixes:
   - `assertPageActive()` / `PageInactiveError` in `pageActivity.ts` are called before each follow-on read. They were
     added in `MissedCallsWidget.tsx`, `useLeaderboardData.ts` and **`leaderboardPremium.ts`** (the one file added to
     §13.3; it is used only by the leaderboard hook).
   - The lane maps the error to `inactive` (deferred, resumed once), and the gate maps it to `blocked` / `inactive`,
     with no failure and no backoff.
   - `dashboard-callbacks.ts` stays untouched, as #22 requires. Its internal contact lookups therefore remain the one
     known place where a load already on the wire can still finish its chained reads after the tab hides. They are
     bounded by the lane, which sends nothing new.
2. **An offline switch left the owner's earlier queued selection in the gate**, and it was sent on reconnect. The
   `inactive` refusal now drops that owner's queued detour, as joining the in-flight job already did.
3. **The page's "Refreshing" spinner** stayed on beside the offline banner with nothing in flight. It is now hidden
   while offline, and TV's strip does the same.
4. **Tests that could not fail:**
   - The lane's "same scope joins" test was not counting after settle.
   - The "release … remount joins" test never joined. It is now split into "release drops queued work unsent" and "a
     remount joins the load on the wire (one request, never aborted)".
   - The sections' no-leak assertion checked a word no fixture contains; it now checks the injected error text.

**Refuted:**
- Work queued behind a stalled load is refused as `busy` at the bound. That is intended (§13.5): it keeps the wait
  bounded, the state shown is true, and Refresh or Try again loads it once the stall ends.
- The Callbacks scope has no day in it. Its list is the pending callbacks, not a day's list.
- The saved-layout read on an offline mount is not a Dashboard section and is out of scope.

**Mutation proof (isolated copy; files restored with a sha256 check):** 43 mutations, 42 caught. They cover the lanes,
tracker, section hook, gate, page/widget hooks, page, TV, stats, Schedule, Missed Calls, the notice and the four
review fixes. The one survivor, the `fetchWins` pre-dispatch re-check, is layered behind the gate's own `inactive`
refusal; removing both is caught.

---

## §14. Rev 1.3 corrections (2026-09-26, approved by Chris; recorded before any edit)

**Base:** the branch at `4e4a99f5`, with current `main` (`8532dc89`, #385 campaign retry guard) merged in as `9ba24928`.
That merge was a clean union, and #385's migration, plan doc, AGENT_RULES #15 note and WORK_LOG entry are unchanged.
**Approval:** Chris approves both corrections, including the narrow exception above for `src/lib/dashboard-callbacks.ts`.

### 14.1 Callback requests still overlap after a partial failure (verified by Chris at `4e4a99f5`)

**What happens.** A campaign callback row query fails immediately while the other row and count queries are still out.
`fetchCallbackPage` checks each branch inside its own `.then`, so that branch's failure rejects the outer `Promise.all`.
`loadCallbacks`' `Promise.all([page, total])` then rejects too. The section lane sees the load as settled and frees
itself, and a Refresh 31 s later sends six new reads while the earlier ones are still pending.

**Fan-out boundaries:**
- `fetchCallbackPage`, the three branch row queries: **rejects early** (the per-branch error check throws).
- `loadCallbacks`, the page + count pair: **rejects early** (either half can reject first).
- `fetchCallbackTotal`, the three count queries: they are bare builders that resolve even on an error, so `Promise.all`
  waits for all three and checks them afterwards. It is made explicit anyway, and it now cancels the siblings on the
  first failure.
- `resolveContactDetailsByIds` (`dashboard-contact-identity.ts`): it awaits bare builders the same way, so it waits for
  all its lookups. It runs only after every branch has succeeded. **This file is not edited** (outside the exception).
  Its lookups cannot be cancelled, but the lane now waits for them.

**Design:**
- New `src/lib/requestLifetime.ts`:
  - `settleAll(promises, onFirstFailure)` never settles before every promise has settled, then rethrows the
    *chronologically first* failure;
  - `linkedAbort(signal?)` gives one controller per load, aborted on the first failure or when the caller's signal
    aborts, and disposed afterwards.
- `dashboard-callbacks.ts`: `CallbackQueryOptions` gains an optional `signal`.
  - `fetchCallbackTotal` and `fetchCallbackPage` build every query first (an invalid user id still throws before any
    request), attach `.abortSignal()`, and wait with `settleAll`. The first failure cancels the siblings, and the call
    rejects only when all of them have settled, as success or confirmed cancellation.
  - `fetchCallbackPage` does not start its contact lookup once the caller has cancelled.
  - Filters, columns, ownership (`applyOwnership` / `ownershipOrExpression`), branch exclusivity, `offset + pageSize`
    pagination, global ordering, exact totals, `assertNoQueryError` contexts and `resolveContactDetailsByIds` are
    unchanged. `DashboardDetailModal`'s calls (no signal) behave as before.
- `CallbacksWidget.loadCallbacks(userId, isFiltered, signal)`: page and total run under one linked controller, with
  `settleAll` and cancel-on-first-failure. The lane's 25 s bound still reports failure on time and still refuses later
  requests with `busy` while anything is outstanding. When the outstanding work settles, the lane is free again. No
  partial page or total is ever returned.

### 14.2 The Leaderboard widget keeps the previous month's podium (verified by Chris)

**What happens.** September standings load successfully, the browser-local date moves into October, and a Refresh
fails. September's podium stays under "Top agents this month", because the snapshot scope is viewer | view with no
month.

**Design:**
- In `useLeaderboardWidgetStandings`, the snapshot tag becomes viewer | view | **month start**, computed from the
  browser-local date when each load runs.
- Every keep-or-commit decision compares against that tag: clearing at the start of a load, commit on ok, the failure
  and hold branches, the `inactive` branch, and choosing the Refresh or resume mode.
- A load for a new month clears the old rows first and shows its loading state. A failed, held, spaced or deferred
  new-month load never shows the previous month's rankings.
- No timer and no automatic polling: nothing reloads just because the date changes; the check happens when a load
  runs, for example on Refresh.

### 14.3 Exact files

**New:**
1. `src/lib/requestLifetime.ts`
2. `src/components/dashboard/__tests__/callbacksRequestLifetime.test.tsx`: regressions using the real callback helpers,
   with the Supabase transport mocked; `fetchCallbackPage` / `fetchCallbackTotal` are not replaced.

**Edited:**
3. `src/lib/dashboard-callbacks.ts` (the approved exception; request lifetime only)
4. `src/components/dashboard/widgets/CallbacksWidget.tsx`
5. `src/hooks/useLeaderboardWidgetStandings.ts`
6. `src/components/dashboard/__tests__/dashboardCallbacks.test.ts`: its transport mock gains `abortSignal()`, as real
   PostgREST builders have it; no assertion changes.
7. `src/components/dashboard/__tests__/leaderboardWidget.test.tsx`: month-rollover regressions.
8. `AGENT_RULES.md`: the #22 request-lifetime note; #23 the widget's month identity.
9. `implementation_plan.md` (this section) and `WORK_LOG.md`.

**Not touched:**
- `src/lib/dashboard-contact-identity.ts`, `DashboardDetailModal`, every `supabase/**` file, generated types,
  dependencies, CI and telephony;
- #385's files (as merged), and PRs #382/#383.

### 14.4 Regressions required

1. **Callbacks, with the real helpers and a mocked transport:**
   - a partial failure (one branch fails at once while the rest are pending) rejects only after every started read has
     settled (siblings cancelled), and never returns partial data;
   - outstanding work that ignores the abort holds the lane beyond the 25 s bound, with failure shown at the bound and
     a later Refresh refused as busy (no new reads);
   - recovery: once that work settles, the next Refresh sends one fresh set of reads and shows the rows;
   - the page/count pair behaves the same way;
   - a failed Refresh over earlier data keeps the complete earlier page and total, never the partial new one.
2. **Widget:**
   - September loaded, the clock in October, and a failed Refresh: no September podium, a truthful failure state;
   - the same for a deferred or held new-month load;
   - no request is sent when only the clock advances.

Verification: the new regressions, affected suites, `npx tsc -p tsconfig.app.json --noEmit`, targeted ESLint
(`--max-warnings 0`), build, and the repository gates. Results are compared with the pre-change tree, and pre-existing
failures are reported separately.


### 14.5 As built, review and verification (2026-09-26)

**As built.** §14.1 and §14.2 are built as written. One addition came from the review below:

- **Widget, month checked again when a load settles.** A Refresh sent at 23:59:40 on 30 September can settle after local
  midnight, up to the gate's 25 s bound. `load()` therefore recomputes the tag from the clock when the load settles.
  - If the month rolled while the request was queued or on the wire, the previous month's rows are cleared before any
    branch runs: ok, failed, held, spaced or `inactive`.
  - An ok answer loaded for the previous month is never committed as this month's. The widget shows
    "Couldn't load standings" and reports `failed`, and the next Refresh loads the new month as a first load
    (`initial`, not spaced).
  - Still no timer and no polling. A snapshot committed before midnight stays on screen until the next load runs,
    which is the accepted §14.2 boundary.
  - The failure branch's own clear became redundant and was removed; the one settle-time clear covers it.

**Callback boundaries as built:**

| Boundary | Before | After |
|---|---|---|
| `fetchCallbackPage` branch reads | `Promise.all`, with the assert inside `.then`, so it rejected early | `settleAll` + `.abortSignal()`; first failure cancels the siblings; no contact lookup once the caller cancelled |
| `fetchCallbackTotal` counts | `Promise.all` over builders that resolve on error, so it waited for all | the same, plus sibling cancel |
| `loadCallbacks` page + total | `Promise.all`, rejected early | `settleAll` under one `linkedAbort` tied to the lane's signal |
| `resolveContactDetailsByIds` | awaits all three lookups | unchanged (outside the exception); the lane waits for it |

**Post-implementation review.** An adversarial diff review ran two lenses, each finding verified by a skeptic.
- **Callbacks lens:** no findings.
- **Widget lens:** one finding, the midnight straddle above.
  - The skeptic reproduced it. It rated the finding as the accepted no-timer boundary and offered the settle-time check
    as optional hardening.
  - The hardening was built, because the correction requires the month in "the comparisons that govern retaining or
    committing results". It comes with two regressions: a failed answer after midnight, and an ok answer after
    midnight followed by recovery.

**Mutation proof.** Run on an isolated copy, with each file restored and its sha256 checked. All 14 mutations are
caught:

| Group | Mutations |
|---|---|
| Callbacks | C1–C3 early-rejecting `Promise.all` at each boundary; C4 `settleAll` settling on the first failure; C5/C6 no sibling cancel (page / total); C7 contact lookup after cancel; C8 widget ignoring the lane's signal; C9 rethrowing the last failure |
| Widget | L1 tag without the month; L2 no clear at load start; L3 settle-time tag equal to the start tag; L4 no settle-time clear; L5 committing last month's ok answer |

**Verification (final tree):**
- New regressions: `callbacksRequestLifetime` 10/10; widget rev 1.3 block 7/7.
- Affected suites: **314/314** across 12 files.
- Full suite: **3,411 passed / 1 failed / 12 skipped of 3,424**.
  - Zero status changes and no removals vs the pre-review rev 1.3 run; 2 tests added.
  - The failing-file set is identical to `main`.
- `npx tsc -p tsconfig.app.json --noEmit`: 90 errors, **zero new**, none in a changed file.
- `npx tsc --noEmit`: exit 0.
- ESLint `--max-warnings 0` on all 38 changed `src` TS/TSX files: clean.
- `npm run build`: OK (pre-existing chunk-size warning only).
- `npm run verify:s1-plan`: all 23 checks passed. `verify:s1-plan:selftest`: passed (5/5).

**Pre-existing failures (not caused by this work; identical on `main`):**
- 11 files fail at import with "supabaseUrl is required." (no `.env` in the sandbox):
  `addLeadAssignmentGate`, `dialerCampaignPresenceHook`, `clientMapping`, `contactName`, `contactScope`,
  `leadDisposition`, `userLocalDayBounds`, `caller-id-selection`, `runtimeEventLogger`, `custom-fields-settings`,
  `dialer-api-attempt-cap`.
- `recordingRetentionVoicemail`: "handler wiring … byte-identical to deployed v29".
- `sql-tests.yml` is manual-only and needs Docker/Supabase, so it was not run.


## §15. Backend reopening preparation (2026-09-25 PT / 2026-09-26 UTC)

Chris authorized beginning the backend review, isolated implementation and testing after PR #386 was merged and deployed at `b3c0839`. The exact scope, files, verification and later production approval boundary are in [the backend plan](docs/incidents/2026-09-26-leaderboard-backend/implementation_plan.md). The production pause remains active. This section supersedes the earlier frontend-only restriction only for this separately authorized preparation stage; it does not authorize a production migration or alter PRs #382/#383.
