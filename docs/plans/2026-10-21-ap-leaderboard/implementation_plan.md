# AP-only Leaderboard redesign — implementation plan (APPROVED 2026-10-21, D1–D5 = A; implemented on a draft PR; not merged, not released)

**Status:** approved by Chris on 2026-10-21 ("Approved to proceed", D1 A, D2 A, D3 A, D4 A, D5 A; plus "ensure actual
tie-break rank changes are reflected correctly in movement indicators"). Implemented on `claude/sweet-cannon-jve7ak`
from `main` `51b0e56`. Draft PR #475 is open for review. No Supabase command (read or write), migration, Edge deploy,
Vercel action, merge or release. Evidence and the implementation-time changes are in `verification.md` (§5 lists
the additions beyond this plan's text). The plan text below is the approved version, kept as written.

---

## §0. TL;DR

The Leaderboard ranks every agent by **Annualized Premium (AP)** only. The metric dropdown, the TV metric selector,
TV auto-rotation and their stored preferences go away. The page keeps Today / This Week / This Month and My Agency /
Agency Group. The podium keeps its gold / silver / bronze cards, avatars and motion, and each card shows AP first,
then Policies and Calls. A new **Your Performance** card sits to the right of the podium on desktop and stacks on
smaller screens. **Full Rankings** lists every ranked agent, the top three included, with the columns Rank · Agent ·
AP · Policies · Calls, and marks the signed-in agent's row with a subtle blue tint and a **YOU** label. Appointments
disappear from every visible Leaderboard surface: podium, card, table, TV tables, TV totals and on-screen notes.
The Dashboard preview uses the same AP ranking, so it can never disagree with the page.

The work is frontend only. It reuses the existing `get_leaderboard_snapshot` payload and its 1:1
`annualized_premium → premiumSold` mapping. No RPC, RLS, migration, telemetry, sale attribution, request-gate,
polling, Recent Wins or CSV change.

---

## §1. Inputs read and conflict check

- **Governance:** `AGENT_RULES.md` (§3 tenancy, §7 component standards, §8 workflow, §10 forbidden patterns;
  invariants #23 leaderboard RPC / request discipline / truthful states, #40 secured facts + on-screen notes,
  #42 Sold Date basis), `VISION.md`, and the newest `WORK_LOG.md` entries (2026-10-21 commissions insights release;
  nothing touches the Leaderboard).
- **Base:** `main` = `51b0e56` (feat(commissions) #474). The working branch is identical to `main`.
- **Open PRs (14):** none touches the current Leaderboard code. #383 / #382 / #381 (September 23 leaderboard
  containment and docs) are stale drafts whose substance was superseded by the shipped Leaderboard Recovery work
  (#23 rev 1.2/1.3) and the October 4–16 releases (#40, #42). This work does not build on, revive or close them.
  #473 (commissions icon) and #474 (merged) are unrelated.
- **Production state assumed from the records (not re-queried, per the no-backend-before-approval rule):**
  `get_leaderboard_snapshot` and `get_leaderboard_recent_wins` are live with the Sold Date basis (#42, PR #453).
  Nothing in this plan depends on any unapplied migration.
- **"Approved visual direction":** no image or mock is stored in the repository. This plan implements the written
  requirements. If a reference image exists, please attach it at approval so the screenshots can be compared with it.

---

## §2. Current behaviour on `main` (evidence)

| Area | Today | File |
|---|---|---|
| Ranking | Client re-ranks the snapshot by a selectable metric (default **Policies Sold**); ties go to last name, first name, id. | `leaderboardTypes.ts:190-209`, `useLeaderboardData.ts:77,114,432-447,534-537` |
| Metric selector | `<select aria-label="Metric">` with six metrics. | `LeaderboardFilters.tsx:70-79` |
| Podium | One number per card, for the selected metric. No Policies/Calls line. | `LeaderboardPodiumCard.tsx:127-138` |
| Full Rankings | Ranks **4+ only**, with Calls · Policies · Annual Premium · Appointments · Talk Time · Policies / 100 Calls. Own row: `bg-primary/5 border-l-2 border-primary`, no label. | `LeaderboardRankingsTable.tsx`, `Leaderboard.tsx:93,222-234` |
| TV | Own metric index + 30 s auto-rotation, stored in `localStorage` (`leaderboardTvMetricIndex`, `leaderboardTvAutoRotate`). Re-ranks locally by that metric. The table shows Appts / Talk / Policies per 100 Calls; the totals strip shows Appts. | `TVMode.tsx:45-64,126-195,305-337`, `TVRankingsTable.tsx`, `TVAgencyTotalsStrip.tsx` |
| Dashboard preview | Ranks by **policies_sold** (`wins`), shows the top three agents who have a sale, and no score. | `useLeaderboardWidgetStandings.ts:37-41`, `LeaderboardWidget.tsx:97-101` |
| On-screen notes | `outsideRosterNote` reads "Outside active roster: N calls, **N appointments**, N policies" on the page, on TV and in the widget. | `leaderboardExport.ts:26-30` |
| AP mapping | `premiumSold = r.annualized_premium` (no ×12). Unknown-premium counts are validated. `isPremiumWhollyUnknown` renders "—" and never $0. | `performanceQueries.ts:52-59`, `premiumAvailability.ts` |

Component sizes: `Leaderboard.tsx` 251 lines, `TVMode.tsx` 514, `LeaderboardRankingsTable.tsx` 210, all over the
200-line standard with **no documented exception** (§7 lists only `DialerPage.tsx` and `TwilioContext.tsx`).
`useLeaderboardData.ts` (961) is a hook, not a component.

**Pre-existing layout risk to verify:** `PODIUM_GRID_CLASS` gives the podium a fixed `h-[268px]` while it is one
column below `sm`. The absolutely positioned cards (232–264 px tall) can overlap when stacked on phones. This is
confirmed or ruled out with a 390 px screenshot before any fix (§5.3).

---

## §3. Scope

**In:** the Leaderboard page, TV Mode, the Dashboard Leaderboard preview (ordering only), the shared ranking helpers
and the on-screen note text that these three surfaces render.

**Out (unchanged):** `get_leaderboard_snapshot` / `get_leaderboard_recent_wins` / group RPCs and their SQL, RLS,
grants and migrations. `performanceQueries.ts` (schema, scope checks, AP mapping). `leaderboardRequestGate.ts`,
polling cadence, realtime binding, backoff, PT429/PT503 holds, stale/error/maintenance copy
(`leaderboardStatusCopy.ts`), viewer/scope isolation, photo loading. Recent Wins (`RecentWinsPanel.tsx`, latest-entered
order, Sold Date labels). The CSV export (§6). Dashboard stat cards, Reports, Goals, Agent Profile, Dialer and
telephony. Appointment storage and reporting. The unmounted `AgentScorecardModal` and the unused legacy
`leaderboardPremium.ts`.

---

## §4. Ranking contract (frontend, presentation of the canonical snapshot)

1. **One metric.** Order is by `premiumSold` (the RPC's `annualized_premium`, known sale-time premiums only),
   descending. The value is never multiplied by 12. No new code calls `monthlyPremiumToAnnual`.
2. **Deterministic ties (D1, recommended):** AP desc → Policies desc → Calls desc → last name, first name
   (case-insensitive) → profile id. Every agent gets a unique rank 1…N, so the top three and the table always agree.
   *Alternative D1-B:* AP desc → name → id (today's tie-break), see §8.
3. **Unknown premium.** If every one of an agent's policies has an unknown premium, AP shows "—" (D14) and is never
   presented as $0. Ranking uses the known subtotal, which is 0 in that case. Partly unknown keeps its subtotal with
   the existing `*` marker and its title. Genuine known $0 and the empty period's $0.00 are unchanged.
4. **One ranking for every surface.** The hook ranks once. The podium, Your Performance, Full Rankings, TV, the
   TV totals highlight and the Dashboard preview all read that order through the same
   `compareAgentsByAp` / `rankAgents` helpers.
5. **Legitimate movement.** Rank movement (arrows, glow, glide, "New #1") is computed only between two successful
   snapshots of the **same** viewer, view, group and period (the existing `movementFilterKey` without the metric).
   The value fingerprint used for change detection is the full sort key (AP, Policies, Calls), so a tie-break
   reorder is shown as the real rank change it is, and an unchanged board shows none. A frozen board (no AP above
   zero, or every AP equal) shows no motion. A first load or a period, view or group switch never shows motion.
6. **No new requests.** Your Performance and the Dashboard order are derived in memory from the snapshot already
   loaded. No new RPC, table read, timer or realtime binding.

---

## §5. Design by surface

### §5.1 Filters (`LeaderboardFilters.tsx`)
Remove the metric `<select>` and its props. Keep the My Agency / group toggle, Today / This Week / This Month and the
TV button. Add a quiet sub-heading under the H1: "Ranked by Annualized Premium (AP)". Accessibility: the toggle
buttons gain `aria-pressed`. The icon-only TV button gains `aria-label="Full Screen Display Mode"`; today it has
only a tooltip.

### §5.2 Board body (`LeaderboardBoard.tsx`, new; extracted from `Leaderboard.tsx` to meet the 200-line standard)
It holds the stale banner, the podium + Your Performance row, and the Full Rankings + Recent Wins row. The page
keeps the loading skeleton, the error, empty and loading branches, TV entry/exit and CSV export, with unchanged
logic. Desktop layout (D5, recommended ≥ `xl` 1280 px): `grid xl:grid-cols-[minmax(0,1fr)_20rem]`, with the podium
left and the card right, aligned to the bottom. Below `xl` the card stacks under the podium at full width (two-column
stat layout at `sm`+).

### §5.3 Podium (`LeaderboardPodium.tsx`, `LeaderboardPodiumCard.tsx`, `podiumLayout.ts`)
Preserve the metal configs, trophy, avatar, name, group organization line, rank pill, `OdometerValue`, and the
enter/exit/glide transitions, glow, spotlight and new-leader classes. The card's value block becomes:
- **AP** large (current size), labelled "AP", "—" when wholly unknown, `*` + title when partly unknown;
- below it, a compact row: **Policies** and **Calls** (small tabular figures with labels).

Tier heights grow by about 36 px to fit the row (1st ≈ 300, 2nd ≈ 284, 3rd ≈ 268 px; skeleton heights and grid height
follow). If the 390 px check shows the stacked overlap described in §2, the single-column podium gets per-slot tier
heights (a presentation-only fix).

### §5.4 Your Performance (`LeaderboardYourPerformance.tsx`, new)
Its input is the ranked agents, the signed-in `user.id` (the same id that drives today's row highlight; View As is
not supported on `/leaderboard`), the frozen-aware `rankMovements`, the view or group name and the period.
- **On the board:** heading "Your Performance" with the period (and the group name in Group view). AP is large, with
  the same "—" and `*` rules plus a one-line "Includes N policies with unknown premium" / "Premium unknown for N
  policies" when that applies. **Rank** "#k of N". **Movement**: arrow and spots with "since last update" only when
  the hook reports a real movement (§4.5), otherwise nothing. **Policies** and **Calls**. A subtle blue frame
  (`border-primary/30 bg-primary/5`) ties it to the YOU row.
- **Not on the board** (the user is absent from the authorized active roster of this view): "Your stats aren't on
  this board" with "Only active agents in {My Agency | group name} are ranked." No numbers, never zeros.
- **Loading, error, maintenance or empty roster:** the card is not rendered, because these states already replace
  the whole board. **Stale:** it shows the same stale snapshot as the board, under the existing stale banner.
- Semantics: `<section aria-labelledby>`, stats as `<dl>`, the movement icon `aria-hidden` with sr-only text, no live
  region (to avoid noisy announcements every poll).

### §5.5 Full Rankings (`LeaderboardRankingsTable.tsx`, + new shared `LeaderboardRankMovement.tsx`)
Every ranked agent, the top three included. Columns **Rank · Agent · AP · Policies · Calls**, all visible at every
width (the table keeps its horizontal scroll guard). The AP header reads "AP" with `title`/sr text "Annualized
Premium". The signed-in agent's row keeps the subtle blue tint and left border and adds a small **YOU** pill next to
the name, wherever the row sits. Row glide (`layoutId`), glow, rank-pill pop, odometers, spotlight and new-leader
highlights stay. The "All agents shown in podium above" empty row is removed, since the table now always lists the
podium agents. The movement badge moves to a shared component used by both the table and the card.

### §5.6 TV Mode
- **`TVMode.tsx`:** remove `METRICS`, `readTvPrefs`, both `localStorage` keys, the metric index state, the 30 s
  rotation interval and both controls. On mount it does a best-effort `try { removeItem }` of
  `leaderboardTvMetricIndex` and `leaderboardTvAutoRotate`, so those stored preferences stop existing in the browser.
  It uses the hook's AP-ranked `agents` directly; no local re-rank. `useTVRankMotion` keeps its TV timings, keyed by
  organization and period only. The settings gear now contains only the org-wide ticker editor, so it is shown only
  to roles that can edit the banner (Admin / Team Leader, unchanged predicate). Escape still closes the popover first.
  The clock, Live Feed indicator, agency title, ticker, New #1 banner, standings notices and period buttons are
  unchanged.
- **Size (D4, recommended):** move the toolbar (gear/popover, clock, live indicator, title, exit) verbatim to
  `TVToolbar.tsx`, the footer ticker to `TVTicker.tsx`, and the banner/organization-name reads and the banner save to
  `useTvDisplaySettings.ts`. Markup, labels, queries (`.maybeSingle()` preserved) and behaviour stay the same. This
  takes `TVMode.tsx` under 200 lines.
- **`TVPodium.tsx`:** AP as the hero value labelled "AP", then a Policies · Calls line. Card, trophy, badge and motion
  are unchanged.
- **`TVRankingsTable.tsx`:** header "Live Ranking · Annualized Premium" ("Ranking · …" when not live). Columns
  (D2, recommended) **Rank · Agent · AP · Policies · Calls**, matching Full Rankings. Appts, Talk and Policies / 100
  Calls are removed from TV.
- **`TVDeepRankPanel.tsx`:** ranks 11+ show AP, labelled "AP".
- **`TVAgencyTotalsStrip.tsx`:** three cells, **AP · Policies · Calls**, with AP permanently highlighted. Appts and
  the metric-to-column map are removed. The roster-wide "—" rule for all-unknown premium is unchanged.

### §5.7 Dashboard preview (`useLeaderboardWidgetStandings.ts`, `LeaderboardWidget.tsx`)
`widgetRows` ranks the snapshot rows with the shared `rankAgents` (AP order, §4) instead of `policies_sold`. Under
D1-A, eligibility for the top three stays "has at least one policy this month", because every agent with AP above
zero has a policy and, among equal AP, sellers sort first. The preview is therefore always an exact prefix of the
page's This Month ranking for the same view. "No sales recorded yet this month." and the zero-sale safeguard are
unchanged. The request gate, Refresh tracker, month-identity tag, group toggle, photo rules and error/stale/hold states
are untouched. `LeaderboardWidget.tsx` changes only its safeguard comment. *(If D1-B is chosen, eligibility becomes
"AP above zero" to keep the prefix property, which hides agents whose every premium is unknown.)*

### §5.8 On-screen notes (`leaderboardExport.ts`)
- `outsideRosterNote` → "Outside active roster: N calls, N policies". It appears only when excluded calls or policies
  are above zero. Excluded appointments no longer produce or appear in a visible note (requirement 5).
- `performanceCaption` (page and TV) keeps the unknown-premium note ("Annual premium (N policies with unknown
  premium)", approved Part A wording), the outside-roster note and the undated-Sold-Date note. **D3 (follows D2):**
  the talk-time duration note is dropped from the on-screen caption, because Talk Time is no longer displayed on any
  Leaderboard surface. The snapshot still validates every duration count, and the CSV still carries Talk Time.
- This amends the AGENT_RULES #40 "On-screen performance notes" bullet; the amendment ships in the same commit (§7).

---

## §6. CSV export — intentionally unchanged

`leaderboardCsv` keeps its exact header and columns, Appointments Set and Talk Time included. It is a downloaded
report, not a visible Leaderboard surface (requirement 11). Its **Rank** column already followed the on-screen order,
which is now AP. No presentation-only adjustment is proposed.

---

## §7. Exact files to touch

**Application (frontend only)**

| # | File | Change |
|---|---|---|
| 1 | `src/components/leaderboard/leaderboardTypes.ts` | Replace the metric machinery (`Metric`, `LEADERBOARD_METRICS`, `METRIC_DISPLAY_LABEL`, `metricKey`, `metricLabel`, `displayedMetricValue`, `formatMetricValue`, `compareAgentsByMetric`) with `compareAgentsByAp`, `rankAgents(agents)`, `displayedAp`, AP labels, and AP/sort-key fingerprint helpers. Keep `AgentStats` (data contract incl. `appointmentsSet`), `Win`, `Period`, period helpers, `formatPremiumSold`, `formatTalkTime` (used by `supabase-users.ts`) and the legacy annualizer export (used only by the unmounted `leaderboardPremium.ts`). |
| 2 | `src/hooks/useLeaderboardData.ts` | Remove metric state, ref, `changeMetric` and the `metric`/`setMetric` return values. Rank by AP. The movement key drops the metric. Gate, poll, realtime, wins, scope and stale logic are untouched. |
| 3 | `src/pages/Leaderboard.tsx` | Drop the metric wiring. Render `LeaderboardBoard`. Loading, error, empty, TV and CSV logic unchanged. |
| 4 | `src/components/leaderboard/LeaderboardBoard.tsx` | **New**: board body, layout (§5.2). |
| 5 | `src/components/leaderboard/LeaderboardYourPerformance.tsx` | **New** (§5.4). |
| 6 | `src/components/leaderboard/LeaderboardRankMovement.tsx` | **New**: shared movement badge (moved from the table). |
| 7 | `src/components/leaderboard/LeaderboardFilters.tsx` | §5.1. |
| 8 | `src/components/leaderboard/LeaderboardPodium.tsx` | Drop the metric prop; pass AP. |
| 9 | `src/components/leaderboard/LeaderboardPodiumCard.tsx` | AP + Policies/Calls (§5.3). |
| 10 | `src/components/leaderboard/podiumLayout.ts` | Tier, grid and skeleton heights; mobile slot heights if needed. |
| 11 | `src/components/leaderboard/LeaderboardRankingsTable.tsx` | §5.5. |
| 12 | `src/components/leaderboard/TVMode.tsx` | §5.6. |
| 13 | `src/components/leaderboard/TVToolbar.tsx` | **New** (D4): moved toolbar + banner popover. |
| 14 | `src/components/leaderboard/TVTicker.tsx` | **New** (D4): moved footer ticker. |
| 15 | `src/components/leaderboard/useTvDisplaySettings.ts` | **New** (D4): moved banner and organization-name reads, banner save. |
| 16 | `src/components/leaderboard/useTVRankMotion.ts` | Drop the metric parameter; AP fingerprint. |
| 17 | `src/components/leaderboard/TVPodium.tsx` | §5.6. |
| 18 | `src/components/leaderboard/TVRankingsTable.tsx` | §5.6 (D2). |
| 19 | `src/components/leaderboard/TVDeepRankPanel.tsx` | §5.6. |
| 20 | `src/components/leaderboard/TVAgencyTotalsStrip.tsx` | §5.6. |
| 21 | `src/hooks/useLeaderboardWidgetStandings.ts` | §5.7 (`widgetRows` only). |
| 22 | `src/components/dashboard/widgets/LeaderboardWidget.tsx` | Safeguard comment only. |
| 23 | `src/lib/leaderboardExport.ts` | §5.8 (notes only; CSV untouched). |

**Tests.** Assertions about removed behaviour (metric switching, TV rotation/index, Appointments columns, the old
note text) are **replaced** by assertions for the new contract. No test is skipped, disabled or weakened.

| File | Change |
|---|---|
| `src/components/leaderboard/__tests__/apRanking.test.ts` | **New**: AP order, every tie-break level, unique ranks, unknown/partial/known-zero/empty, fingerprint, frozen detection, no ×12. |
| `src/components/leaderboard/__tests__/leaderboardYourPerformance.test.tsx` | **New**: present (rank of N, AP, Policies, Calls), movement only when real, wholly/partly unknown premium, absent-from-roster state with no numbers, Group label. |
| `src/pages/__tests__/leaderboardPage.test.tsx` | No metric combobox; columns exactly Rank/Agent/AP/Policies/Calls; top three in the table **and** on the podium in the same order; YOU on the user's row at any rank; no "Appointment"/"Appts" text anywhere; podium AP + Policies + Calls; caption strings; existing stale/error/offline/empty/Group tests kept. |
| `src/hooks/__tests__/useLeaderboardData.test.tsx` | The metric-switch block is replaced by AP ordering/ties, period and Group switching (one RPC per load, no motion across a switch), and no `setMetric` in the API. Gate, poll, realtime, stale and viewer-isolation tests kept as they are. |
| `src/components/leaderboard/__tests__/tvModeRegression.test.tsx` | No "Viewing metric" select and no auto-rotate switch; nothing rotates after 30 s+ (fake timers); obsolete keys are ignored and removed; AP order on podium, table and ranks 11+; the banner editor is still available to an Admin, and Escape closes it without exiting; the gear is hidden for an Agent; totals show AP/Policies/Calls only. |
| `src/components/leaderboard/__tests__/leaderboardStatusSurfaces.test.tsx` | Caption string (no appointments, no talk-time note); all status tests kept. |
| `src/components/dashboard/__tests__/leaderboardWidget.test.tsx` | The policies-order test becomes AP order (incl. a seller with unknown premium after AP sellers); note string; every gate/Refresh/month/group test kept. |
| `src/lib/__tests__/performanceContract.test.ts` | Note strings; the ratio-ranking test becomes AP ranking. CSV header/row assertions unchanged (proves §6). |

**Docs (same branch):** this plan; `docs/plans/2026-10-21-ap-leaderboard/verification.md` (new, after the
build); a newest-first entry at the top of root `implementation_plan.md`; a newest-first `WORK_LOG.md` entry;
`AGENT_RULES.md`, with the #40 on-screen-notes bullet amended (§5.8) and a short "AP-only Leaderboard" rule under
#40 (one ranking metric, the shared comparator, Appointments not shown on Leaderboard surfaces, CSV unchanged).

**Not touched:** everything listed as out of scope in §3, `supabase/**`, `.github/**`, `package*.json`, `vercel.json`.

---

## §8. Decisions for Chris (recommendation first)

- **D1 — Tie-break.** **A (recommended):** AP → Policies → Calls → name → id. A seller whose premium is unknown is
  never ranked under an idle agent by alphabet, and the Dashboard preview stays an exact prefix. **B:** AP → name → id
  (today's canonical tie-break). Purer "AP only", but zero-AP sellers interleave alphabetically with idle agents.
- **D2 — TV table columns.** **A (recommended):** Rank · Agent · AP · Policies · Calls (same as Full Rankings).
  **B:** also keep Talk and Policies / 100 Calls on TV.
- **D3 — On-screen talk-time note.** Follows D2: **A** drops it from page and TV (nothing on screen shows talk time).
  Under D2-B it stays on TV only.
- **D4 — `TVMode.tsx` size.** **A (recommended):** verbatim extraction (§5.6) to meet the 200-line standard.
  **B:** remove only the metric code (≈450 lines remain) and record a documented exception in AGENT_RULES §7.
- **D5 — Side-by-side breakpoint.** **A (recommended):** ≥ 1280 px (`xl`), because with the sidebar a 1024 px window
  leaves the podium too narrow for dollar amounts. **B:** ≥ 1024 px (`lg`).

---

## §9. Verification plan

**Before the first edit:** record main-baseline numbers on this container: `npx tsc --noEmit`, the app check
`npx tsc -p tsconfig.app.json --noEmit` (error count), full `npx vitest run` (failed tests/files), so that "no new
failures" is measured, not assumed.

**After implementation:**
1. `npx tsc --noEmit` exits 0. The app check shows no new errors (none in touched files).
2. Targeted Vitest: the eight files in §7 plus `leaderboardRequestGate`, `leaderboardAvatarCache`,
   `useLeaderboardAvatars`, `dashboardRefresh`, `dashboardRefreshWiring`, `recentWinsSoldDate` and `viewAsSurfaces`.
   Then the full suite against the baseline.
3. `npx eslint` on every touched TypeScript file exits 0. CI's Reports-frontend gate lints changed files, so any
   pre-existing lint error in a touched file is fixed minimally and recorded. `npm run build` passes, and
   `git diff --check` is clean.
4. Static checks: no "Appointment"/"Appts" text under the page, TV and widget render paths; no `* 12` /
   `monthlyPremiumToAnnual` in changed code; no new `setInterval`, realtime channel, `supabase.from`/`.rpc` in changed
   files beyond the moved banner reads (the count of timers goes **down**: the 30 s rotation is removed).
5. Behaviour matrix (unit/component tests): AP order and every tie level; Today / Week / Month; org ↔ Group switching;
   the user's rank and YOU row at ranks 1, 2, 3, mid-table and last; the user absent from the roster; wholly unknown,
   partly unknown, known-zero and empty premiums; an empty roster; stale/error/maintenance/offline over and without a
   snapshot; TV; the Dashboard preview prefix property; the top three identical on podium and table.
6. **Visual:** a throwaway fixture harness in the session scratchpad (never committed, never under `src/`, no
   production path) renders the real components with fixture snapshots. Playwright screenshots of the page at 1440,
   1280, 1024 and 390 px, dark and light, and TV at 1920×1080 and 1280×720. Keyboard pass: tab order, visible focus,
   toggles announce state, the TV popover traps and Escape closes. Screenshots are attached to `verification.md` / the
   PR.
7. **Hosted:** none. No Supabase query or write, no migration, no Edge deploy, no Vercel action. Pushing the branch
   and opening the PR lets Vercel's existing Git integration build its automatic **preview**. That is not a production
   deployment, and nothing is triggered manually. A signed-in preview check, if Chris wants one, is a separate,
   read-only step on his authorization.

---

## §10. Risks and limitations

- **Visible re-ordering.** The Dashboard preview and the Leaderboard reorder from policies (or the chosen metric) to
  AP. This is intended, but it will be noticed.
- **Unknown premiums rank low.** An agent whose premiums are all unknown ranks by a $0 subtotal. Under D1-A they still
  rank above idle agents. The "—" and caption disclosures stay.
- **The TV extraction (D4-A)** is a move with no logic change. The regression and status-surface suites cover it, and
  screenshots compare before and after.
- **Fixed-height podium.** Taller cards and the possible stacked-overlap fix change pixel heights only. Screenshots at
  every listed width guard it.
- **Lint gate.** Touching a file makes its pre-existing lint findings blocking in CI; those fixes stay minimal and
  are listed.
- **Not verifiable here:** signed-in production data and the real roster. The evidence will be component tests,
  build and fixture screenshots.

---

## §11. Explicit non-actions and gates

No backend command before or during implementation (no `list_migrations` needed: no schema dependency changes). No
migration, RLS, grant, RPC, telemetry, sale-attribution, Twilio or dialer change. No direct push to `main`, no merge,
no release. After approval: implement on `claude/sweet-cannon-jve7ak`, open a **draft** PR for review, and stop.
Merging and releasing need Chris's separate approval.

---

## §12. Approval and implementation record (2026-10-21)

- **Approval:** Chris, 2026-10-21: D1 A (AP → Policies → Calls → name → id), D2 A (TV shows AP, Policies, Calls),
  D3 A (no visible talk-time notes), D4 A (TV extraction), D5 A (side by side at ≥ 1280 px). Additional instruction:
  tie-break rank changes must show correctly in the movement indicators. Done: the whole sort key drives change
  detection and the "frozen" test (`verification.md` §5.1).
- **Files actually touched:** the §7 list, plus these new extractions to stay under 200 lines: `TVBoard.tsx`,
  `useTvClock.ts` and `LeaderboardApValue.tsx`. Docs: this plan, `verification.md`, `screenshots/`, the root plan,
  `WORK_LOG.md` and `AGENT_RULES.md`.
- **Verification:** `verification.md`. It covers the baseline-versus-branch typecheck and full-suite comparison
  (no new failure), targeted 331/331, lint, build, static checks and screenshots.
- **Gates still open:** review of the draft PR; a signed-in read-only preview check if wanted; merge and frontend
  release need Chris's separate approval. No backend gate exists for this change.

---

## §13. Amendment — test-only correction of the TV visual harness (approved by Chris 2026-10-21)

**Why.** PR #475's "Policy sale transaction verification" workflow (`policy-sale-recording.yml`) fails in its
`tv-browser` job (run `39626583398`, job `119313300470`). The job runs the real-Chromium harness in
`scripts/tests/leaderboard-visual/`, which still expects the removed behaviour. The caption text with
"1 appointments" fails first at `verify.mjs:20`. After it come the four-cell totals with Appts, the
metric-index sort, the "Viewing metric" select, the auto-rotate switch and the 30 s rotation, and the
`restAgents` table prop. The failure was reproduced locally with the same assertion and actual/expected text. The
`postgres` job and every other check pass. This workflow is not part of the Reports-frontend gate, so §9's
verification did not cover it. That gap is recorded here.

**Approved scope (test-only):**

| File | Change |
|---|---|
| `scripts/tests/leaderboard-visual/entry.tsx` | The table uses the new `agents` property with AP-ranked rows and a YOU row. The fixture gains deterministic AP ties (one decided by Policies, one by Calls, both against name order) and a wholly-unknown-premium agent outside the routine variant. It adds live-update hooks for a no-rank-change update, a tie-break reorder and an AP reorder. |
| `scripts/tests/leaderboard-visual/verify.mjs` | Legacy metric-switching and rotation assertions are replaced by AP-only checks. It validates AP / Policies / Calls on the TV podium, ranks 4–10, ranks 11+ and the totals; deterministic tie-breaks; real movement, and none when ranks hold; no Appointments or removed metrics on TV or the normal table; Agent sees no gear; the Admin ticker editor works; and rankings are unchanged after the former 30 s interval. Geometry, avatar, overlap, scrolling, Sold Date, period, roster and runtime-error checks are kept. |
| `docs/plans/2026-10-21-ap-leaderboard/implementation_plan.md` (this §13), `verification.md`, `WORK_LOG.md`, root `implementation_plan.md` | Records. |

**Not touched:** `.github/workflows/policy-sale-recording.yml` (not weakened, skipped or disabled), the harness's
`stubs.ts`, `vite.config.ts` and `index.html`, all application code under `src/`, `supabase/**` and telephony. The
Admin role is exercised by having Playwright serve the existing stub module, unchanged except for its role string, to
a separate browser context. No file outside the table above changes. The harness `README.md` still describes the
retired checks; updating it needs Chris's approval (flagged in `verification.md`).

---

## §14. Amendment — final UI polish: "Annual Premium" labels and a two-cell TV totals strip (PLAN, AWAITING CHRIS'S APPROVAL)

**Request (Chris, 2026-10-21):** exactly two changes on PR #475.
1. Every visible "AP" label on the Leaderboard and TV Mode becomes **"Annual Premium"**. The shared display labels
   change, and the subtitle becomes **"Ranked by Annual Premium"**. Longer labels must fit on mobile without clipping.
   No calculation or ranking logic changes.
2. TV Mode's top **Active-Agent Totals** strip shows only **Annual Premium** and **Policies**, in a balanced two-column
   layout. **Calls stay** on every podium card (page and TV), in the page's Full Rankings, and in TV ranks 4–10.

**Checked first:** branch `claude/sweet-cannon-jve7ak` is clean at `ccddd27` and matches the remote; `main` is still
`51b0e56`; PR #475 has no review threads or human comments; all checks on `ccddd27` are green (§9 records the
equivalent `fd0220c`). The newest Work Log entries are this PR's own, so there is no conflicting work.

**Inventory of visible "AP" (8 render sites, all fed by two constants in `leaderboardTypes.ts`):**

| Surface | Today | After |
|---|---|---|
| Page subtitle (`LeaderboardFilters`) | "Ranked by Annualized Premium (AP)" | "Ranked by Annual Premium" |
| Podium card label (`LeaderboardPodiumCard`) | "AP" | "Annual Premium" |
| Your Performance label | "AP" | "Annual Premium" |
| Full Rankings column header | "AP" (accessible name "Annualized Premium") | "Annual Premium" (wraps to two lines below `sm`; one line from `sm`) |
| TV podium label (`TVPodium`) | "AP" | "Annual Premium" |
| TV ranks 4–10 header and badge (`TVRankingsTable`) | "AP"; "Live Ranking · Annualized Premium" | "Annual Premium"; "Live Ranking · Annual Premium" |
| TV ranks 11+ header (`TVDeepRankPanel`) | "AP" | "Annual Premium" |
| TV totals label (`TVAgencyTotalsStrip`) | "AP" | "Annual Premium" |

**Approach.**
- `AP_LABEL` / `AP_FULL_LABEL` become one shared `ANNUAL_PREMIUM_LABEL = "Annual Premium"`. The screen then
  uses one term (matching the existing caption "Annual premium (N policies with unknown premium)"). The `title` and
  `aria-label` attributes that existed only to expand "AP" are dropped where the visible text now says the same
  thing. The table's accessible name becomes "Full rankings by Annual Premium". Code comments that say "AP" are not
  visible and stay as they are.
- **Mobile fit:** on phones the Full Rankings "Annual Premium" header may wrap to two short lines (right-aligned,
  tight leading) inside the existing column, and stays on one line from `sm` up. No column or AP-cell width changes.
  The podium, Your Performance and TV labels already have room. Each is measured in the browser for clipping (below).
- **TV totals:** the Calls cell and the now-unused Calls total are removed from the strip; the grid becomes
  `grid-cols-2`, Annual Premium (still highlighted) then Policies, with equal cell widths. The roster-wide "—" rule for
  all-unknown premium is unchanged. No data, request, gate or poll change.
- **Unchanged:** `compareAgentsByAp` / `rankAgents`, AP values and their "—" / `*` rules, every calculation, the
  CSV export (its "Annualized Premium USD" header included), the on-screen notes, RPCs, RLS, Supabase and telephony.

**Intended files (only these):**

| File | Change |
|---|---|
| `src/components/leaderboard/leaderboardTypes.ts` | One shared `ANNUAL_PREMIUM_LABEL` replaces `AP_LABEL` / `AP_FULL_LABEL` |
| `src/components/leaderboard/LeaderboardFilters.tsx` | Subtitle "Ranked by Annual Premium" |
| `src/components/leaderboard/LeaderboardPodiumCard.tsx` | Label |
| `src/components/leaderboard/LeaderboardYourPerformance.tsx` | Label |
| `src/components/leaderboard/LeaderboardRankingsTable.tsx` | Header label, mobile wrap, table accessible name |
| `src/components/leaderboard/TVPodium.tsx` | Label |
| `src/components/leaderboard/TVRankingsTable.tsx` | Header label and badge |
| `src/components/leaderboard/TVDeepRankPanel.tsx` | Header label |
| `src/components/leaderboard/TVAgencyTotalsStrip.tsx` | Label; remove the Calls cell; two-column grid |
| `src/pages/__tests__/leaderboardPage.test.tsx` | Subtitle, column names, podium label text |
| `src/components/leaderboard/__tests__/tvModeRegression.test.tsx` | Header, badge, totals (two cells, no Calls) and the totals-premium lookup |
| `src/components/leaderboard/__tests__/leaderboardYourPerformance.test.tsx` | Label assertion added |
| `scripts/tests/leaderboard-visual/verify.mjs` | Expected labels, badge and two-cell totals. Adds browser checks: no clipped label (scroll width ≤ client width) on the page at 390 px and on TV at every viewport; the two totals cells sit side by side with equal widths. Podium and both tables still assert Calls. |
| Docs: this §14, `verification.md` §10, `WORK_LOG.md`, root `implementation_plan.md` | Records |

Not touched: `entry.tsx`, the workflows, `stubs.ts`, `vite.config.ts`, the harness `README.md`, `AGENT_RULES.md` (no
new invariant), the Dashboard widget (it shows no premium label), `leaderboardExport.ts` and everything outside the
Leaderboard.

**Verification plan:** the targeted Vitest suites, `npx tsc --noEmit`, the app check against the 84-error baseline,
ESLint on touched files, `npm run build` and `git diff --check`. Then the real Playwright visual harness locally
(fresh Vite, as CI runs it), fixture screenshots of the page at 1440/1024/390 (dark and light) and TV at 1920/1280,
and every PR #475 check green on the final head. No Supabase command, migration, merge or deployment.

**Status:** plan only; no application, test or harness file edited. Waiting for Chris's explicit approval.
