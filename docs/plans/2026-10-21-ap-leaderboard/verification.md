# AP-only Leaderboard — verification record

**Scope:** frontend only, branch `claude/sweet-cannon-jve7ak`, base `main` `51b0e56`. Approved by Chris 2026-10-21
with D1–D5 = A. No Supabase query or write, migration, Edge deploy, Vercel action, merge or release. All evidence
below was produced in this session's container; hosted, signed-in verification has not been done (§7).

---

## §1. Method

- **Baseline first.** `main` was checked out as a separate worktree (`git worktree add --detach … 51b0e566`). Its
  root/app typechecks and full Vitest suite were recorded **before any application edit**, so "no new failures" is
  measured against the same container and toolchain (Node 22.22.0, `npm ci` from the lockfile).
- **Branch.** The same commands were run on the final tree after the last edit.
- **Screens.** A throwaway fixture harness lived only in the session scratchpad (never under `src/`, never
  committed, no production path). It aliased `useLeaderboardData`, `AuthContext`, `BrandingContext` and the Supabase
  client to fixture stand-ins and rendered the **real** `Leaderboard` page and `TVMode` components. A second
  instance rendered `main`'s components from the baseline worktree with the same fixture, for comparison. The
  fixture data (agency, agent names, amounts) is illustrative only. Playwright 1.56 with the pre-installed
  Chromium 1194 captured the shots.

## §2. Static and build checks

| Check | `main` baseline | Branch (final tree) |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | exit 0 |
| `npx tsc -p tsconfig.app.json --noEmit` | 84 errors (pre-existing) | **the identical 84-error set** (`diff` of sorted error lines is empty); none in a touched file |
| `npx eslint <every touched .ts/.tsx>` | — | exit 0, 0 warnings (34 files) |
| `npm run build` | — | exit 0 (the >500 kB chunk warning is pre-existing) |
| `git diff --check` | — | clean |

Additional static checks on the changed code:

- No "Appointment"/"Appts"/"Talk time"/"per 100" text remains in any Leaderboard, TV or widget render path.
  The only matches are the `AgentStats.appointmentsSet` data field and the intentionally unchanged CSV columns
  (§5 of the plan).
- No `* 12`, `monthlyPremiumToAnnual` or `ANNUAL_PREMIUM_MULTIPLIER` in any added line. `premiumSold` still maps
  1:1 from `annualized_premium` (`performanceQueries.ts`, untouched).
- `setInterval` in the Leaderboard, TV, page and widget code: **4 on `main` → 3** (the 30 s TV metric rotation is
  gone; the page poll, TV clock and any other timers are unchanged).
- Supabase reads (`.from` / `.rpc` / `.channel`) across the same files: **identical sets** on `main` and the branch
  (`get_leaderboard_snapshot`, `get_leaderboard_recent_wins`, the `wins` INSERT channel, and the TV
  `organizations` / `company_settings` reads, now moved verbatim into `useTvDisplaySettings`). No new request,
  poll or realtime binding. `performanceQueries.ts`, `leaderboardRequestGate.ts` and `leaderboardStatusCopy.ts`
  are unchanged.

## §3. Tests

**Full suite** (`npx vitest run --maxWorkers=2 --minWorkers=1 --reporter=json`):

| | Tests | Failed tests | Failed files |
|---|---|---|---|
| `main` baseline | 5,985 | 1 | 11 suites, 10 files |
| Branch | 6,018 (+33 net) | **1 — the same test** | **11 suites, the same 10 files** |

The one failing test on both is `recordingRetentionVoicemail.test.ts › handler wiring … byte-identical to deployed
v29`. The 10 pre-existing failing files are unrelated to the Leaderboard: `caller-id-selection`,
`custom-fields-settings`, `dialerCampaignPresenceHook`, `contactName`, `contactScope`, `leadDisposition`,
`recordingRetentionVoicemail`, `userLocalDayBounds`, `runtimeEventLogger` and `addLeadAssignmentGate`. No new
failure.

**Targeted re-run on the final tree** (after the last three presentation edits): 15 files, **331 / 331 passed**.
The files are `leaderboardPage`, `useLeaderboardData`, `tvModeRegression`, `leaderboardStatusSurfaces`,
`leaderboardWidget`, `performanceContract`, `apRanking` (new), `leaderboardYourPerformance` (new),
`recentWinsSoldDate`, `leaderboardRequestGate`, `leaderboardAvatarCache`, `useLeaderboardAvatars`,
`dashboardRefresh`, `dashboardRefreshWiring` and `viewAsSurfaces`.

**Behaviour matrix (where each requirement is proven):**

| Requirement | Proof |
|---|---|
| AP is the only order; no metric API | `useLeaderboardData` "ranks by AP — not Policies, Calls, Talk Time or Appointments — and exposes no metric API"; `apRanking` order tests |
| Deterministic ties AP → Policies → Calls → name → id | `apRanking` "breaks ties…" (every level), "unique rank 1…N independent of input order"; hook "breaks AP ties…" |
| **Tie-break rank changes show as movement** | hook: "equal AP: a Policies tie-break…", "equal AP and Policies: a Calls tie-break…", "an all-$0 AP board is still ordered (and moves) by its Calls tie-break — never frozen"; `apRanking` "change detection covers the whole sort key" |
| No fake movement | hook: "a value change that keeps every rank shows no movement", "an identical board … is frozen", period and Group switches show none |
| Today / Week / Month, org ↔ Group | hook period and Group tests (one RPC each, correct `p_period` / `p_group_id`); page "keeps Today / This Week / This Month…" and the Group toggle test |
| No metric selector on the page | page "has no metric selector and says the board ranks by Annualized Premium" |
| Podium: AP, then Policies and Calls | page "each podium card shows AP first, then Policies and Calls"; TV totals/podium test |
| Top three = table top three | page "renders the podium (top 3) and Full Rankings with every ranked agent, the top three included" |
| Full Rankings columns | page "Full Rankings has exactly Rank, Agent, AP, Policies and Calls" |
| YOU row anywhere | page "marks the signed-in agent's row with YOU and a blue tint wherever it ranks" (rank 4 and rank 1) |
| Your Performance | 7 component tests + 4 page tests: AP, rank of N, Policies, Calls, period/scope, movement only when real, none when frozen, wholly/partly unknown, genuine $0, absent-from-roster (no figures), Group name, no user id |
| Unknown premium never $0 | page/TV D14 suites (kept), `apRanking` `displayedAp`, card tests |
| No Appointments anywhere | page "shows no Appointments anywhere…", TV "…no Appointments, Talk Time or Policies / 100 Calls", widget note test, contract note cases |
| TV: no selector, no rotation, stored prefs gone | TV "an Admin's options hold only the ticker editor…", "an Agent has nothing to configure", "never rotates… past 30, 60 and 90 seconds", "ignores and removes the obsolete … preferences" |
| TV ticker, clock, banner, title, Escape | TV Admin/Agent tests (Escape closes the popover first, then exits); status-surface ticker tests (kept) |
| Dashboard preview = page ranking | widget "orders the top 3 by AP, exactly like the Leaderboard page…" and "a seller whose every premium is unknown follows the AP sellers…"; every gate/Refresh/month/group/offline widget test kept |
| Stale / error / maintenance / offline / empty | page, status-surface and widget suites (all kept, all pass) |
| CSV unchanged | contract test asserts the full header run incl. `Appointments Set`, `Talk Time Seconds`, `Policies per 100 Calls` and a full row; page CSV test unchanged |
| Request discipline | hook "two refreshes … join one request", poll/visibility/realtime tests (kept); widget gate tests (kept) |

## §4. Screens (`screenshots/`)

| File | What it shows |
|---|---|
| `branch-page-dark-1440.png`, `branch-page-dark-1280.png` | Side-by-side layout at ≥ 1280 px (D5): podium + Your Performance (#5 of 9, ↑2 since last update), five-column Full Rankings with the YOU row, the AP-tied pair ordered by Policies, the all-unknown agent "—*" ranked above zero-sale agents (D1-A) |
| `branch-page-dark-1024.png` | Below 1280: the card stacks under the podium; AP and the stats share one row |
| `branch-page-dark-390.png`, `branch-page-light-390.png` | Phone: gold first, no overlap, all five table columns visible, YOU wraps under the name |
| `branch-page-light-1440.png` | Light theme |
| `branch-page-absent-dark-1440.png` | Signed-in agent outside the roster: "Your stats aren't on this board", no figures, no YOU row |
| `branch-page-stale-dark-1440.png` | Stale banner with Retry over the last snapshot; card shows the same snapshot |
| `branch-page-keyboard-focus-1440.png` | Keyboard focus |
| `branch-tv-dark-1920.png`, `branch-tv-dark-1280.png` | TV: AP totals (highlighted), AP podium with Policies · Calls, "Live Ranking · Annualized Premium" ranks 4–10, ranks 11+ by AP, ticker, clock, Live Feed; no gear for an Agent |
| `branch-tv-admin-options-1920.png` | Admin: the options popover holds only the org-wide ticker editor |
| `base-page-dark-1440.png`, `base-page-dark-1024.png`, `base-page-dark-390.png`, `base-tv-dark-1920.png` | `main` for comparison: metric dropdown, single-metric podium, ranks 4+ only with six crowded columns, Appointments, and the pre-existing stacked-podium overlap at 390 px |

Every capture reported 0 px horizontal overflow. The only console error was the harness page's missing favicon
(404). It occurred on `main` too and is not application code.

**Keyboard pass (1440 px):** Tab moves Today [aria-pressed=true] → This Week → This Month → Full Screen Display Mode
(now has an accessible name) → Export CSV, each with a visible focus ring. On TV (Admin) the options popover opens
from its button, and Escape closes it without leaving TV; a second Escape exits.

## §5. Changes made during implementation (beyond the plan text)

1. **Tie-break movement (Chris's instruction).** `hasMeaningfulStandings` and the change fingerprint use the whole
   sort key (AP, Policies, Calls), not AP alone. Otherwise an all-$0-AP morning would reorder by Calls without any
   indicator. A board is "frozen" only when every agent's AP, Policies and Calls are identical. The "New #1"
   celebration still requires the new leader's AP > 0, so a $0 leader decided by a tie-break moves, without the
   banner.
2. **Extra extractions for the 200-line standard:** `TVBoard.tsx` (podium + ranks 4–10 / 11+ / Recent Wins, and the
   New #1 banner), `useTvClock.ts`, `LeaderboardApValue.tsx` (shared AP cell with the unchanged "—" / `*` markup) and
   `LeaderboardPodiumSkeleton` (in `LeaderboardBoard.tsx`). TVMode: 514 → 191 lines; page: 251 → 194.
3. **Dead TV props removed.** `TVMode` accepted `rankAnimations/rankMovements/rankMotions/rankDeltas` but never used
   them (it computes its own TV motion), so they were removed from it and from the page.
4. **TV keeps an idempotent AP re-rank** of its `agents` prop (copying rows, never mutating the parent), so TV is
   correct for any caller. For the page's already-ranked rows the result is identical.
5. **Layout fixes found by the screenshots:** the pre-existing stacked-podium overlap on phones (confirmed on
   `main`) is fixed with per-slot heights below `sm`, and gold leads when stacked. Phone table tracks are tightened
   so all five columns fit 390 px. The tall-screen TV podium row is 32 px taller so the gold trophy clears the
   totals panel at 1080p.
6. **Small accessibility additions:** `aria-pressed` on the view and period toggles, an accessible name on the TV
   button, `aria-current` on the YOU row, label-first `<dl>` stats, and sr-only movement text.

## §6. Not changed (verified by diff)

`performanceQueries.ts` (schema, scope checks, 1:1 AP mapping), `leaderboardRequestGate.ts`,
`leaderboardStatusCopy.ts`, `RecentWinsPanel.tsx`, `Dashboard.tsx`, `supabase/**`, `.github/**`, `package*.json`,
`vercel.json`, all telephony/dialer code, `AgentScorecardModal.tsx`, `leaderboardPremium.ts`, and
`leaderboardCsv` (columns and rows).

## §7. Limitations and open items

- **No hosted verification.** No signed-in run against real production or preview data; no Supabase or Vercel
  command was run. Evidence is the test suites, typecheck, lint, build and fixture screenshots. A signed-in
  read-only preview check is a separate step on Chris's authorization.
- **No reference image.** No visual reference file was available in the session; the screenshots follow the written
  requirements and the existing dark premium styling.
- **Recent Wins at 1024–1279 px** is cramped (truncated names, amount badge over the Sold date). This is
  **pre-existing** (identical on `main`, see `base-page-dark-1024.png`) and in the untouched `RecentWinsPanel`;
  left for a separate change.
- On narrow table rows the agent name truncates and the YOU label wraps under it; the full name stays in the
  `title`.

---

## §8. CI blocker fix — TV visual harness (test-only; plan §13; 2026-10-21)

**Finding (Chris's review).** `Policy sale transaction verification` › `tv-browser` failed on PR #475 head
`2266cd5` (run `39626583398`, job `119313300470`) at `verify.mjs:20`. The harness expected the old caption
"…2 calls, 1 appointments, 0 policies". Further down it also expected the Appts total, the metric-index sort,
the "Viewing metric" select, the auto-rotate switch and rotation, and `entry.tsx` still passed the removed
`restAgents` table prop. `postgres` and every other check passed. **Gap in §3:** this workflow is not part of
the Reports-frontend gate, the harness files are outside every tsconfig, and §3/§4 never ran it, so the earlier
verification missed it.

**Reproduced locally first** on the same head: the same `AssertionError` at `verify.mjs:20` with identical actual
and expected text.

**Files changed (exactly the approved scope):** `scripts/tests/leaderboard-visual/entry.tsx`,
`scripts/tests/leaderboard-visual/verify.mjs`, plus records (plan §13, this §8, `WORK_LOG.md`, root
`implementation_plan.md`). The workflow, `stubs.ts`, `vite.config.ts`, `index.html`, `README.md`, all of `src/`
and `supabase/` are unchanged. No check is skipped, disabled or weakened.

**What the harness now proves (real Chromium, Playwright 1.56.1):**

| Requirement | Check |
|---|---|
| New table property | `entry.tsx` passes AP-ranked `agents` (plus `userId`) to `LeaderboardRankingsTable`. An ad-hoc typecheck of the pre-fix entry reports TS2322 for `restAgents`; the fixed entry adds no error (the only remaining line is the pre-existing `AuthContext.tsx(245,16)`, one of `main`'s 84). |
| AP-only ranking | An independent in-page comparator over the fixture rows drives the expected podium, ranks 4–10, ranks 11+ and totals. Hard-coded orders guard the comparator itself. The metric-switch and rotation steps are removed. |
| AP / Policies / Calls everywhere | Every measured state compares each podium card (AP + "N Policies" + "N Calls"), every ranks 4–10 row (rank, name, AP, Policies, Calls), every ranks 11+ row (rank, name, AP), the totals (AP, Policies, Calls with labels `AP / Policies / Calls`), the five table headers and the "Ranking · Annualized Premium" badge. |
| Deterministic tie-breaks | Fixture ties decided **against** name order: Harper ties Gray on AP with one more Policy, and Jordan ties Indigo on AP and Policies with more Calls. Expected order Emerson, Finley, Harper, Gray, Jordan, Indigo, Kai. |
| Real movement | A value change that keeps every rank shows **no** arrows. A Policies tie-break reorder shows exactly Gray "Moved up 1" and Harper "Moved down 1". An AP reorder (Kai to #1) shows "Moved down 1" on all seven table rows and a new podium. |
| No removed metrics | Every measured state and the normal table at 1440/390 reject `appointment`, `appts`, `talk`, `talk time`, `policies / 100`, `per 100 calls`, `viewing metric`, `auto-rotate`, `cycles metrics` and `1m 21s`. The caption is exactly "Annual premium (2 policies with unknown premium) · Outside active roster: 2 calls, 0 policies", although the fixture excludes 1 appointment. |
| D14 | Noah's only premium is unknown: "—*", never $0, ranked 14th; Avery's partial "$701.40*". |
| Kept checks | Podium/totals centerline, no horizontal overflow, no lower-panel overlap, no avatar overlap, table photos unclipped and hit-test visible after scrolling, source ranks unmutated, the Sold Date rows (TV and normal), period switch, rosters 1/2/3/14, exit/re-entry, the `?routine=1` variant, and zero `pageerror`s on both browser contexts. |
| Admin / Agent | Agent (the fixture's stub role): no "TV display options" button. Admin, in a separate browser context that serves the unchanged stub module with only its role string set to "Admin": the popover holds only the ticker editor (no metric select, no switch, no combobox). Save stays disabled until an edit, Reset restores the saved text, Escape closes the popover without leaving TV, and a second Escape exits. |
| Former 30 s rotation | Re-entering TV removes the stored `leaderboardTvMetricIndex` / `leaderboardTvAutoRotate`. After 30.1 s of real browser time, the podium, ranks 4–10, ranks 11+ and totals are identical and still match the AP board. |

**Local runs** (fresh Vite from the repository root on port 4179, exactly as the workflow does):

| Run | Code under test | Result |
|---|---|---|
| Reproduction | old harness, branch head | **fail** at `verify.mjs:20` (the CI failure) |
| Negative control | new harness, `main` `51b0e56` components | **fail** at the caption: "…2 calls, 1 appointments, 0 policies" |
| Mutation A | branch with a name-only tie-break (AP → name → id) | **fail**: the ranks 4–10 diff shows Gray before Harper and Indigo before Jordan |
| Mutation B | branch with AP-only change detection | **fail**: TimeoutError waiting for the Policies tie-break movement |
| Final 1 / Final 2 | new harness, branch (unmodified) | **pass**, exit 0, 77 s / 74 s, 15 PASS lines, 31 evidence screenshots |

Mutation A first "passed" on a server whose readiness probe had already pre-transformed the unmutated module.
Restarting Vite after the mutation (as CI always does) failed it as above. Mutations ran in a throwaway worktree that
has since been removed.

**Standard checks on the final tree:** `npx tsc --noEmit` exit 0. The app check is the identical 84-error set to
the `main` baseline. Targeted Vitest 15 files, 331 / 331. ESLint on both harness files: 0 errors and the same
single pre-existing `react-refresh/only-export-components` warning at `entry.tsx:19` that the pre-fix file has.
`npm run build` exit 0, `git diff --check` clean. No application code changed, so the earlier full-suite result
(§3) still describes the application.

**Not changed, flagged for approval:** `scripts/tests/leaderboard-visual/README.md` still describes the retired
metric-switch/rotation checks and the old caption. Updating it is outside the approved scope.

**GitHub checks on the final head:** recorded in §9 once the run completes.
