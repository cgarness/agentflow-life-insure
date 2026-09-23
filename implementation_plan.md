# Implementation Plan — BUGFIX: Simplify the Dashboard Leaderboard widget (rev 1.1 — PROPOSED, AWAITING CHRIS'S APPROVAL)

> **STATUS (rev 1.1, 2026-09-23): PLAN ONLY. No source or test file has been modified.**
> - Rev 1 of this file alone was committed as `235a2e8` and pushed to
>   `claude/dashboard-leaderboard-simplify-cqgfjf`. It was **not** pushed to `main`.
> - Rev 1.1 folds in an adversarial review of rev 1. The fixes are in §2.3, §5 and §7.
> - Nothing is merged or deployed.
>
> **Repository:** `cgarness/agentflow-life-insure` · branch `claude/dashboard-leaderboard-simplify-cqgfjf`
> · base `main` @ **`858f62f`**. The previous plan (Custom-Field Creation Outage, PR #379) is preserved
> in git history at `858f62f`.
>
> **No database or backend change is required:**
> - no migration, RPC change, RLS change, grant or Edge Function
> - no Supabase MCP call and no production read or write
> - no telephony or dialer file
>
> This is a presentational change to one widget plus its tests.

---

## §0. TL;DR

The Dashboard `LeaderboardWidget` currently renders a gamified podium:
- trophy, medal and star icons in place of photos
- the first name only
- a numeric `pts` value per agent
- a separate **"Your Standing"** card with `#rank`, "On the podium!" / "Keep pushing!" and `N Wins`

The fix replaces **only the rendered body** with a clean top-3 list. Each row shows:

```
#1   (photo)    Avery Adams
#2   (photo)    Blake Brooks            ← Group view: org name as small secondary text
#3   (initials) Casey Cole
            [ VIEW FULL STANDINGS ]  → /leaderboard
```

The data layer is unchanged:
- both RPC calls and the month window
- the sort comparators
- the `cancelled` stale-response guards
- the error/Retry panel and the stale-snapshot banner
- the empty state
- the Agency/Group toggle and its silent org fallback
- the effect dependency list

Photos reuse the app's existing `LeaderboardAgentAvatar`, which is Radix Avatar with an initials fallback and is already used by the full Leaderboard page. Initials and the display name come from the existing, unit-tested `initialsFor` / `displayNameFor` helpers. No new avatar or initials implementation is written.

---

## §1. Evidence (read-only survey, 2026-09-23)

| Fact | Source |
|---|---|
| The widget is mounted only by the Dashboard and receives only `userId`. | `src/pages/Dashboard.tsx:27, :429` |
| **Dashboard.tsx** renders the card chrome, not the widget: the "Leaderboard" title, the amber Trophy header tile and the `p-6` body. There is no fixed height, so a 3-row list fits without scrolling. | `Dashboard.tsx:72, :103, :112, :596-615` |
| Org data is `supabase.rpc("get_org_leaderboard_stats", { p_start: startOfMonth, p_end: now })`. The rows already include `avatar_url`. | `LeaderboardWidget.tsx:43-70`; `types.ts:6420-6434` |
| Group data is `supabase.rpc("get_agency_group_leaderboard", { p_group_id, p_period: "month" })`. The rows already include `agent_avatar_url` and `organization_name`. | `LeaderboardWidget.tsx:72-95`; `types.ts:6245-6259` |
| Rank is array index + 1 after sorting by `policies_sold` desc, then lowercased `"last first"`, then `id`. This matches the full page's `compareAgentsByMetric` / `rankAgents`. | `LeaderboardWidget.tsx:62-69, :87-94, :212`; `leaderboardTypes.ts:151-168` |
| The existing avatar component is `LeaderboardAgentAvatar`. It trims the URL. A whitespace, empty or null URL shows initials, and a broken URL falls back to initials. It has 6 call sites on the Leaderboard page, TV mode and Recent Wins. | `src/components/leaderboard/LeaderboardAgentAvatar.tsx:13-29` |
| Existing tested helpers: `initialsFor({firstName,lastName})` returns trimmed, uppercased initials or `"?"`. `displayNameFor(...)` returns "First Last" or `"Unnamed agent"`. Neither pulls in Supabase at runtime (the `profile-queries` import is type-only). | `src/lib/profile/profile-org-view.ts:96-107`; tests `profileScopeAndOrgTree.test.ts:144-150` |
| `profiles.first_name` / `last_name` are `NOT NULL DEFAULT ''`, so blank names are possible. `avatar_url` is nullable with `DEFAULT ''` and is often a base64 data URL. | baseline schema `:4228-4235`; `ProfileAvatarUploader.tsx:48` |
| The existing widget suite passes **5/5** at `858f62f`. It was run in a scratch copy because this checkout has no `node_modules`. | survey run, vitest 3.2.4 |
| **No in-flight branch** touches `LeaderboardWidget.tsx` or its test (362 remote branches checked). The newest WORK_LOG entries (2026-09-18 to 2026-09-22) do not mention the widget. **No conflict.** | WORK_LOG.md:7-293 |
| The #347 suite pinned the displayed count ("`policies_sold` maps to Wins (podium pts + Your Standing count)"). This task deliberately retires that **display** pin and replaces it with a stronger **ordering** pin (§2.3 #5). The canonical-source pins are kept. | WORK_LOG.md:2808, :2827 |
| AGENT_RULES #23 requires the widget's org view to stay on `get_org_leaderboard_stats`, and a failure must be an error state, never a zero board. `get_agency_group_leaderboard` is a separately approved follow-up and is **not** touched here. | AGENT_RULES.md:187-192 |

---

## §2. Proposed implementation

### 2.1 `src/components/dashboard/widgets/LeaderboardWidget.tsx` (EDIT)

**Unchanged, byte-for-byte:**
- the `RankedAgent` shape, including `wins`, which the sort still needs
- `fetchOrgLeaderboard` and `fetchGroupLeaderboard`, and both comparators
- the async IIFE, including both `cancelled` checks, the `finally` guard, and the `setWidgetView("org")` fallback when the group RPC fails
- the effect dependencies `[userId, widgetView, agencyGroup, reloadNonce]`
- the error panel ("Couldn't load standings" + one Retry)
- the stale banner ("Refresh failed — standings may be out of date." + Retry)
- the toggle markup and labels ("My Agency" / "Group")
- the `View Full Standings` button, its classes, and `navigate("/leaderboard")`

**Removed:**
- the `Trophy`, `Medal` and `Star` imports, and `RANK_STYLES`
- the podium: icon circles, `glass-card` tiles, `{agent.wins}` + `pts`, and the pulsing star
- the "Your Standing" card: `#rank`, "On the podium!" / "Keep pushing!", and `N Wins`
- `currentUserRank` and `currentUserData`

**Changed:**
- **Loading skeleton.** The podium-shaped grid becomes three list-row placeholders (`h-14 bg-muted/20 rounded-xl animate-pulse`, `space-y-2`). This is the same pattern the sibling widgets use.
- **Empty state.** The `Trophy` icon becomes a neutral `Users` icon. The copy stays **"No sales data yet"** (D-3).
- **Main body:**
  ```tsx
  <div className="space-y-4">
    {loadError && /* unchanged stale banner */}
    {agencyGroup && /* unchanged toggle */}
    <ol aria-label="Top agents this month" className="space-y-2">
      {top3.map((agent, idx) => (
        <LeaderboardPreviewRow
          key={agent.id}
          index={idx}
          rank={idx + 1}
          firstName={agent.firstName}
          lastName={agent.lastName}
          avatarUrl={agent.avatarUrl}
          organizationName={widgetView === "group" ? agent.organizationName : null}
          isCurrentUser={agent.id === userId}
        />
      ))}
    </ol>
    {/* unchanged View Full Standings button */}
  </div>
  ```
  `top3 = ranked.slice(0, 3)` is unchanged, so the order is exactly what the current comparators produce.

**Size:** the file drops from 284 lines to **about 225**. It stays above the §7 < 200 guideline because most of what remains is the frozen fetch/effect/error code, which the brief says not to refactor just to hit the target. The new row component is extracted, so all new markup lives outside this file.

### 2.2 `src/components/dashboard/widgets/LeaderboardPreviewRow.tsx` (NEW, ~50 lines, presentational only)

This is extracted per AGENT_RULES §7. It fetches no data, computes no ranks and holds no state.

```tsx
<motion.li                                   // same stagger as Callbacks/Appointments rows
  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.05 }}
  className={cn(
    "flex items-center gap-3 rounded-xl border px-3 py-2",
    isCurrentUser ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-transparent",
  )}
>
  <span className="w-7 shrink-0 text-sm font-bold tabular-nums text-muted-foreground">{`#${rank}`}</span>
  <LeaderboardAgentAvatar
    avatarUrl={avatarUrl}
    initials={initialsFor(person)}
    alt={name}
    className="h-10 w-10"
    fallbackClassName="text-xs"
  />
  <div className="min-w-0 flex-1">
    <p className="truncate text-sm font-bold text-foreground">
      {name}
      {isCurrentUser && <span className="sr-only"> (you)</span>}
    </p>
    {organizationName && <p className="truncate text-[10px] text-muted-foreground">{organizationName}</p>}
  </div>
</motion.li>
```

- **Name and initials.** `person = { firstName: firstName ?? "", lastName: lastName ?? "" }` and `name = displayNameFor(person)`. The `?? ""` guards against the untyped group mapping (`(data as any[])`).
- **Current user (D-2 default).** If the user is in the top 3, their row gets a **soft primary tint** as a purely visual cue. A screen-reader-only "(you)" gives the same cue to assistive technology. There is no visible text and no score.
- **Photos.** All three rows use the same **40px** photo, so they are consistent and noticeable. #1 does not get a bigger photo, because that reads as podium gamification.
- **Theming.** Only theme tokens are used (`bg-muted/30`, `text-foreground`, `text-muted-foreground`, `primary/*`), so rows are correct in light and dark mode. This also removes the old hard-coded `border-white/5`, `bg-slate-300` and `bg-amber-700`. Tailwind only, no inline styles.
- **Interaction.** Rows are **not** clickable and have no hover affordance. The widget's only action is still `View Full Standings`.

### 2.3 Tests — `src/components/dashboard/__tests__/leaderboardWidget.test.tsx` (EDIT)

**Harness additions:**
- `within` in the RTL import.
- `h.autoResult(fn)` becomes RPC-name aware. The existing `rpcOk` / `rpcFail` ignore the argument and keep working.
- A controllable `h.agencyGroup` for the `useAgencyGroup` mock. It must be reference-stable because it is an effect dependency.
- An `imagesLoadInstantly()` helper. It spies on jsdom's `HTMLImageElement.prototype.complete` / `naturalWidth` getters so the real Radix Avatar reaches "loaded" and renders the `<img>`. The existing `vi.restoreAllMocks()` restores them. jsdom has no `canvas`, so without the spy no `<img>` ever renders.

**Assertion conventions:**
- Name matchers use anchored regexes (`/^Avery\b/`, `/^Fresh\b/`, `/^Stale\b/`) because rows now render the full name. `getByText` ignores `alt`, so there is no collision with the photo.
- Rows start at `opacity: 0` in jsdom, so assertions use `toBeInTheDocument` / role / `within`, never `toBeVisible`.

**Kept (same intent, tightened):**
1. **Org source.** The org view calls `get_org_leaderboard_stats` with `p_start` = local month start and `p_end` > `p_start`. It never calls `from("clients")` / `from("profiles")`. A second variant runs with a group **present** (`h.agencyGroup` set) and asserts the default view still calls only the org RPC and **not** `get_agency_group_leaderboard`. With a null group that assertion would be vacuous.
2. **Initial failure.** Shows "Couldn't load standings" + Retry and never "No sales data yet". Retry recovers.
3. **Failed refresh.** Keeps the last snapshot behind the stale banner, and Retry clears it.
4. **Superseded response resolving first.** It cannot commit. **Also asserts "No sales data yet" and the list are absent** while the newest request is pending. This protects the `finally { if (!cancelled) setLoading(false) }` guard, which the current suite does not.

**Replaced.** The test "maps policies_sold to Wins" (`"7 Wins"`, podium `"7"`) becomes:

5. **Ranking by `policies_sold`.** The fixture is built so that `policies_sold` order disagrees with **input order, alphabetical order, `calls_made`, `annualized_premium` and `recent_wins_7d`**. For example, the lowest seller has an A-surname and the highest calls and premium. The test asserts `#1/#2/#3` in DOM order, each paired with the right name. It includes a 4-4 tie resolved by last name, and checks that the 4th agent is hidden. Sorting by any other metric, or ignoring the metric, fails this test. The file docblock drops the "→ Wins" display wording and keeps the canonical-source intent.

**New:**

6. **Photos.** An agent with `avatar_url` renders `<img alt="Avery Adams" src=…>` and no initials. Agents with `""`, `null` or whitespace URLs render initials (`BB`, `CC`) and no `<img>`.
7. **Blank names.** A blank name renders "Unnamed agent" with `?` initials, without crashing.
8. **No scoring UI.** Run once with the user in the top 3 and once with the user outside it. The widget must not contain:
   - `pts`, `points`, or `win`/`wins`
   - the metric values themselves (the fixture uses distinctive values such as 987)
   - "Your Standing", "On the podium!" or "Keep pushing!"
   - `.lucide-trophy`, `.lucide-medal` or `.lucide-star`

   The checks are per-element queries, not a `textContent` regex, because concatenated text like `987pts` has no word boundary.
9. **Current user.** When the user is in the top 3, only their row has the tint and the sr-only "(you)". When the user is ranked 4th or lower, no row does, and no standing card appears.
10. **View Full Standings.** Calls `navigate("/leaderboard")` exactly once. There is no test for this today.
11. **Group toggle.** "Group" calls `get_agency_group_leaderboard` once with `{ p_group_id, p_period: "month" }`, ranks the group rows, and shows each org name as secondary text.
12. **Group fallback.** A group RPC failure falls back to org standings, not the error panel. Clicking "Group" again then issues a **second** group call. This proves `setWidgetView("org")` really reset the toggle.
13. **Org-name guard.** Load Group ("North Agency" visible), make the org RPC fail, then click "My Agency". The stale banner shows and the kept group rows remain, but **"North Agency" is absent**. This protects the `widgetView === "group"` guard that moves into the new prop.
14. **Empty state.** An empty roster renders "No sales data yet" with no list and no error.
15. **Late stale response (org).** A superseded response that resolves *after* the newest one cannot overwrite it. The current suite still passes all 5 tests with the `cancelled` check removed, so this closes that gap.
16. **Late stale response (group).** The same test on the group path protects the group-branch `cancelled` check, which has no test today.

---

## §3. Exact files

| File | Change |
|---|---|
| `src/components/dashboard/widgets/LeaderboardWidget.tsx` | EDIT, render path only (§2.1) |
| `src/components/dashboard/widgets/LeaderboardPreviewRow.tsx` | **NEW**, presentational row (§2.2) |
| `src/components/dashboard/__tests__/leaderboardWidget.test.tsx` | EDIT (§2.3) |
| `implementation_plan.md` | this plan, updated to an as-built record |
| `WORK_LOG.md` | newest-first entry, in the **same** commit as the code |

**Deliberately NOT touched:**
- `src/pages/Dashboard.tsx` (card header Trophy, D-4)
- `LeaderboardAgentAvatar.tsx` and `profile-org-view.ts`
- the full Leaderboard page, `useLeaderboardData` and `leaderboardTypes`
- every RPC, migration, RLS policy, grant and Edge Function
- `types.ts`
- all telephony and dialer code
- `index.css` (`glass-card` and `premium-gradient-amber` are still used elsewhere)
- `AGENT_RULES.md` (no new invariant; #23 remains accurate)

---

## §4. Database / backend confirmation

**None required.**
- Both RPCs already return everything the new UI needs: `avatar_url` / `agent_avatar_url`, names and `organization_name`.
- No query is added, removed or altered, so no `.maybeSingle()` site is touched.
- `organization_id` and RLS boundaries are unchanged. The org RPC still derives the org from `profiles` for `auth.uid()`.
- No service-role keys, no secrets, and no mock data in production paths.

---

## §5. Decisions for Chris (recommended defaults marked ✅)

| # | Question | Options |
|---|---|---|
| **D-1** | Name format | ✅ **Full name** "Avery Adams". It is the clearest, and a blank name becomes "Unnamed agent". Alternatives: "Avery A." (the full page's podium style), or first name only (today). |
| **D-2** | Current user shown in the top 3 | ✅ **Soft primary row tint only**, plus the screen-reader-only "(you)". This is the most literal reading of "subtle visual treatment". Alternatives: tint + a small visible "You" label (this is text, which goes slightly beyond "visual treatment"), or no treatment. |
| **D-3** | Empty-state icon and copy | ✅ **Neutral `Users` icon, keep "No sales data yet"**. Alternative: keep the Trophy icon. |
| **D-4** | Dashboard card header Trophy tile (`Dashboard.tsx:103`). It is the per-widget identity icon, like Phone/Calendar/Target on the sibling cards. | ✅ **Leave unchanged**: it sits outside the widget body and is not a score graphic. Alternative: replace it in this pass, which adds `Dashboard.tsx` to the scope. |
| **D-5** | **Zero-sales months.** The org RPC returns the full Active roster with zeros filled in. When nobody has sold yet, the top 3 falls through to the **alphabetical** tie-break. Today "0 pts" makes that visible. Without numbers, an alphabetical "#1" looks like a real standing. | ✅ **No change.** The brief freezes ranking semantics and forbids score text. Alternative (presentational only, ranking unchanged): when every ranked agent has 0 sales, show one neutral line such as "No sales recorded yet this month". |

---

## §6. Observations, no change proposed

1. **Period mismatch.** The widget is month-to-date, but the full Leaderboard page opens on **Today** by default (`useLeaderboardData.ts:74`). "View Full Standings" can therefore show a different #1 until the user picks "This Month". This is pre-existing, and changing the page is out of scope.
2. **Group metric.** Group `policies_sold` counts `clients`, not `wins`. This is a documented AGENT_RULES #23 follow-up and is not touched here.

---

## §7. Verification plan (after approval)

1. **Dependencies.** Run `npm ci`. These are local dev dependencies only; the checkout has no `node_modules`.
2. **Baselines on the clean tree, before any edit:**
   - `npx tsc -p tsconfig.app.json --noEmit` (expected ≈ 91 pre-existing errors; the list is saved)
   - the full `npx vitest run`
3. **Widget suite.** Run `npx vitest run src/components/dashboard/__tests__/leaderboardWidget.test.tsx`.
4. **Neighbouring suites, then the full suite:**
   - `src/pages/__tests__/leaderboardPage.test.tsx`
   - `src/hooks/__tests__/useLeaderboardData.test.tsx`
   - `src/lib/__tests__/profileScopeAndOrgTree.test.ts`

   Then run the full `npx vitest run` and diff it against the baseline.
5. **Typecheck.**
   - Run `npx tsc --noEmit`, as the brief requires. It is reported as **vacuous** (AGENT_RULES #35: the solution-style root checks 0 files).
   - Re-run `npx tsc -p tsconfig.app.json --noEmit` and diff it against the baseline. "Zero new errors" is claimed only from that diff.
   - Run ESLint on the three touched source/test files.
6. **Mutation checks.** Each mutation must make at least one test fail. The results are recorded in WORK_LOG.
   - (a) remove the org `cancelled` check
   - (b) remove the group `cancelled` check
   - (c) make `finally` `setLoading(false)` unconditional
   - (d) delete `setWidgetView("org")`
   - (e) pass `organizationName` without the `widgetView === "group"` guard
   - (f) sort by `calls_made`, then separately by `annualized_premium`, instead of `policies_sold`
   - (g) re-add a `pts` span
   - (h) render initials in place of the avatar
   - (i) drop `.slice(0, 3)`
   - (j) change the CTA route
7. **Visual check.** A throwaway harness in the session scratchpad (never committed) mounts the **real** widget. It is wrapped in the **same card chrome markup as `Dashboard.tsx:596-615`** (header tile + title + `p-6` body), so D-4 can be judged in context. It uses a stubbed Supabase client and synthetic rows. Playwright/Chromium screenshots are taken for:
   - light and dark mode
   - org and group views
   - the current user in the top 3
   - photo and initials rows

   The screenshots are shared with Chris. A live Dashboard check needs an authenticated session, so it remains Chris's browser pass on the Vercel preview and is **not** claimed here.
8. **Diff audit.** Confirm that the following are byte-identical to `858f62f`, so that no data source or ranking behaviour has changed:
   - both fetchers and both comparators
   - the IIFE and the effect dependencies
   - the error, stale-banner, toggle and CTA markup
9. **WORK_LOG and plan, before committing.** Write the newest-first `WORK_LOG.md` entry with:
   - date/status
   - what changed
   - files touched
   - **Migrations/deploys: None**
   - tests and typecheck performed, with real numbers (targeted suite, full-suite diff, both tsc commands, the mutation table)
   - blockers and next steps

   Then update this plan to an as-built record.
10. **Commit and push.** Commit code, tests, WORK_LOG and the plan together to `claude/dashboard-leaderboard-simplify-cqgfjf` and push. **No PR unless asked, no merge to `main`, no deploy.** Finish with the context snapshot.
