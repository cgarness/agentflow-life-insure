# Implementation Plan — BUGFIX: Simplify the Dashboard Leaderboard widget (rev 1 — PROPOSED, AWAITING CHRIS'S APPROVAL)

> **STATUS (rev 1, 2026-09-23): PLAN ONLY. No source or test file has been modified.** Only this
> plan file has been written. Nothing is committed, pushed, merged or deployed.
>
> **Repository:** `cgarness/agentflow-life-insure` · branch `claude/dashboard-leaderboard-simplify-cqgfjf`
> · base `main` @ **`858f62f`** (the branch has no commits of its own yet). The previous plan
> (Custom-Field Creation Outage, PR #379) is preserved in git history at `858f62f`.
>
> **No database or backend change is required.** No migration, no RPC change, no RLS change, no grant,
> no Edge Function, no Supabase MCP call, no production read or write, no telephony/dialer file.
> This is a presentational change to one widget plus its tests.

---

## §0. TL;DR

The Dashboard `LeaderboardWidget` currently renders a gamified podium: trophy/medal/star icons in
place of photos, first name only, a numeric `pts` value per agent, and a separate **"Your Standing"**
card with `#rank`, "On the podium!" / "Keep pushing!" and `N Wins`.

The fix replaces **only the rendered body** with a clean top-3 list. Each row shows:

```
#1   (photo)   Avery Adams
#2   (photo)   Blake Brooks            ← Group view: org name as small secondary text
#3   (initials) Casey Cole
            [ VIEW FULL STANDINGS ]  → /leaderboard
```

The data layer does not change. That covers both RPC calls, the month window, the sort comparators,
the `cancelled` stale-response guard, the error/Retry panel, the stale-snapshot banner, the empty
state, the Agency/Group toggle and its silent org fallback, and the effect dependency list. Photos
reuse the app's existing `LeaderboardAgentAvatar` (Radix Avatar with initials fallback), which the
full Leaderboard page already uses. Initials and the display name come from the existing, unit-tested
`initialsFor` / `displayNameFor` helpers. No new avatar or initials implementation is written.

---

## §1. Evidence (read-only survey, 2026-09-23)

| Fact | Source |
|---|---|
| Widget mounted only by the Dashboard, receives only `userId` | `src/pages/Dashboard.tsx:27, :429` |
| Card chrome (title "Leaderboard", amber Trophy header tile, `p-6` body) is rendered by **Dashboard.tsx**, not the widget. No fixed height, so a 3-row list fits without scroll | `Dashboard.tsx:72, :103, :112, :596-615` |
| Org data: `supabase.rpc("get_org_leaderboard_stats", { p_start: startOfMonth, p_end: now })`. The response already includes `avatar_url` | `LeaderboardWidget.tsx:43-70`; `types.ts:6420-6434` |
| Group data: `supabase.rpc("get_agency_group_leaderboard", { p_group_id, p_period: "month" })`. The response already includes `agent_avatar_url` and `organization_name` | `LeaderboardWidget.tsx:72-95`; `types.ts:6245-6259` |
| Rank = array index + 1 after sorting by `policies_sold` desc, then `"last first"` lowercased, then `id`. This is identical to the full page's `compareAgentsByMetric` / `rankAgents` | `LeaderboardWidget.tsx:62-69, :87-94, :212`; `leaderboardTypes.ts:151-168` |
| Existing avatar component: `LeaderboardAgentAvatar` (trims the URL; whitespace, empty or null URLs show initials; a broken URL falls back to initials). Used at 6 call sites on the Leaderboard page, TV mode and Recent Wins | `src/components/leaderboard/LeaderboardAgentAvatar.tsx:13-29` |
| Existing tested helpers: `initialsFor({firstName,lastName})` gives trimmed, uppercased initials or `"?"`. `displayNameFor(...)` gives "First Last" or `"Unnamed agent"`. The module has no Supabase or runtime-heavy imports | `src/lib/profile/profile-org-view.ts:96-107`; tests `src/lib/__tests__/profileScopeAndOrgTree.test.ts:144-150` |
| `profiles.first_name` / `last_name` are `NOT NULL DEFAULT ''`, so blank names are possible. `avatar_url` is nullable `DEFAULT ''` and is often a base64 data URL | baseline schema `:4228-4235`; `ProfileAvatarUploader.tsx:48` |
| Existing widget suite: **5/5 pass** at `858f62f`. This was run in a scratch copy because the checkout has no `node_modules` | survey run, vitest 3.2.4 |
| **No in-flight branch** touches `LeaderboardWidget.tsx` or its test. The latest WORK_LOG entries (2026-09-18…22) do not mention the widget, so **there is no conflict** | 362 remote branches checked; WORK_LOG.md:7-293 |
| AGENT_RULES #23 requires the widget's org view to stay on `get_org_leaderboard_stats`, with a failure shown as an error and never as a zero board. #23 lists `get_agency_group_leaderboard` as a separately-approved follow-up, so it is **not** touched here | AGENT_RULES.md:187-192 |

---

## §2. Proposed implementation

### 2.1 `src/components/dashboard/widgets/LeaderboardWidget.tsx` (EDIT)

**Unchanged, byte-for-byte:**
- the `RankedAgent` shape, including `wins`, which the sort still needs
- `fetchOrgLeaderboard`, `fetchGroupLeaderboard` and both comparators
- the async IIFE with `cancelled` checks and its `setWidgetView("org")` group-failure fallback
- the effect dependency list `[userId, widgetView, agencyGroup, reloadNonce]`
- the error panel ("Couldn't load standings" + one Retry)
- the stale banner ("Refresh failed — standings may be out of date." + Retry)
- the toggle markup and labels ("My Agency" / "Group")
- the `View Full Standings` button, its classes and `navigate("/leaderboard")`

**Removed:**
- the `Trophy`, `Medal` and `Star` imports and `RANK_STYLES`
- the podium block: icon circles, `glass-card` tiles, `{agent.wins}` + `pts`, the pulsing star
- the "Your Standing" card: `#rank`, "On the podium!" / "Keep pushing!", `N Wins`
- `currentUserRank` and `currentUserData`

**Changed:**
- **Loading skeleton.** The podium-shaped grid becomes three list-row placeholders
  (`h-14 bg-muted/20 rounded-xl animate-pulse`, `space-y-2`), the same pattern the sibling widgets
  use.
- **Empty state.** The icon changes from `Trophy` to a neutral `Users`. The copy stays
  **"No sales data yet"** (see D-3).
- **Main body.** The body is now:
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
  `top3 = ranked.slice(0, 3)` is unchanged, so the order is exactly what the current comparators
  produce.

**Size.** The file drops from 284 lines to about 200.

### 2.2 `src/components/dashboard/widgets/LeaderboardPreviewRow.tsx` (NEW, ~50 lines, presentational only)

This is extracted per AGENT_RULES §7 (< 200 lines per component). It fetches no data, computes no
ranks and holds no state.

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
    <p className="truncate text-sm font-bold text-foreground">{name}</p>
    {organizationName && <p className="truncate text-[10px] text-muted-foreground">{organizationName}</p>}
  </div>
  {isCurrentUser && (
    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-primary">You</span>
  )}
</motion.li>
```

- `person = { firstName: firstName ?? "", lastName: lastName ?? "" }` and
  `name = displayNameFor(person)`. The `?? ""` guards the untyped group mapping
  (`(data as any[])`).
- **Photo size.** Every row uses the same 40px photo, so the three are consistent and clearly
  visible. There is no size step-up for #1, because that reads as podium gamification.
- **Styling.** Classes use theme tokens only (`bg-muted/30`, `text-foreground`,
  `text-muted-foreground`, `primary/*`), so the row is correct in light and dark mode. This also
  removes the old hard-coded `border-white/5`, `bg-slate-300` and `bg-amber-700`. Tailwind only, no
  inline styles.
- **Interaction.** Rows are **not** clickable and have no hover affordance. The only action in the
  widget stays `View Full Standings`.
- **Rows vs. sibling widgets.** Each row is about 58px tall, compared with 66px sibling rows.

### 2.3 Tests: `src/components/dashboard/__tests__/leaderboardWidget.test.tsx` (EDIT)

**Harness additions:**
- `within` in the RTL import.
- `h.autoResult(fn)` becomes RPC-name aware. The existing `rpcOk` / `rpcFail` ignore the argument,
  so they keep working unchanged.
- A controllable, **reference-stable** `h.agencyGroup` for the `useAgencyGroup` mock (it is an
  effect dependency).
- An `imagesLoadInstantly()` helper. It spies jsdom's `HTMLImageElement.prototype.complete` and
  `naturalWidth` getters, so the real Radix Avatar reaches "loaded" and renders the `<img>`. The
  existing `vi.restoreAllMocks()` restores both getters. jsdom has no `canvas`, so without this no
  `<img>` would ever render.

**Kept, intent unchanged.** Only name matchers move from exact first name (`"Avery"`) to anchored
regexes (`/^Avery\b/`, `/^Fresh\b/`, `/^Stale\b/`), because rows now render the full name. These
tests stay:
1. The org view calls `get_org_leaderboard_stats` with `p_start` = local month start and
   `p_end` > `p_start`. There are **no** `from("clients")` / `from("profiles")` reads, and the org
   view does **not** call `get_agency_group_leaderboard`.
2. Initial failure shows "Couldn't load standings" + Retry, never "No sales data yet". Retry recovers.
3. A failed refresh keeps the last snapshot behind the stale banner, and Retry clears the banner.
4. A superseded in-flight response (stale resolves first) cannot commit.

**Replaced.** The test "maps policies_sold to Wins" asserted `"7 Wins"` and the podium `"7"`. It
becomes:

5. **Ranking.** Rows appear in the order `#1`, `#2`, `#3`, each paired with the right name, sorted by
   `policies_sold` desc with the existing tie-break (a 4-4 tie resolves by last name). The 4th agent
   is not shown.

**New:**

6. **Photos.** An agent with `avatar_url` renders `<img alt="Avery Adams" src=…>` and no initials.
   Agents with `""`, `null` or whitespace URLs render initials (`BB`, `CC`) and no `<img>`.
7. **Blank names.** A blank name renders "Unnamed agent" with `?` initials, and nothing crashes.
8. **No scoring UI**, checked both with the user in the top 3 and outside it:
   - no `pts`, `points`, `win`/`wins`
   - no metric values (asserted with deliberately distinctive values such as 987)
   - no "Your Standing", "On the podium!" or "Keep pushing!"
   - no `.lucide-trophy` / `.lucide-medal` / `.lucide-star` inside the widget

   These are per-element queries, not a `textContent` regex, because a regex on concatenated text
   would miss `987pts`.
9. **Current user.** If the user is in the top 3, only their row carries the "You" marker. If they
   are ranked 4th or lower, no row does, and no standing card appears.
10. **Navigation.** "View Full Standings" calls `navigate("/leaderboard")` exactly once. Today this
    has no test.
11. **Group toggle.** Clicking "Group" calls `get_agency_group_leaderboard` exactly once with
    `{ p_group_id, p_period: "month" }`, ranks the group rows, and shows each org name as secondary
    text. Org names do **not** appear in the org view.
12. **Group fallback.** A group RPC failure falls back to org standings, not the error panel.
13. **Empty state.** An empty roster renders "No sales data yet" with no list and no error.
14. **Stale response, reverse order.** A superseded response that resolves *after* the newest one
    cannot overwrite it. This closes a gap in the current suite: removing the `cancelled` check still
    passes all five existing tests.

---

## §3. Exact files

| File | Change |
|---|---|
| `src/components/dashboard/widgets/LeaderboardWidget.tsx` | EDIT: render path only (§2.1) |
| `src/components/dashboard/widgets/LeaderboardPreviewRow.tsx` | **NEW**: presentational row (§2.2) |
| `src/components/dashboard/__tests__/leaderboardWidget.test.tsx` | EDIT (§2.3) |
| `implementation_plan.md` | this plan |
| `WORK_LOG.md` | newest-first entry after implementation |

**Deliberately NOT touched:**
- `src/pages/Dashboard.tsx` (card header Trophy, see D-4)
- `LeaderboardAgentAvatar.tsx`
- `profile-org-view.ts`
- the full Leaderboard page, `useLeaderboardData` and `leaderboardTypes`
- every RPC, migration, RLS policy, grant and Edge Function
- `types.ts`
- all telephony and dialer code
- `index.css` (`glass-card` and `premium-gradient-amber` are still used elsewhere)
- `AGENT_RULES.md` (no new invariant; #23 remains accurate)

---

## §4. Database / backend confirmation

**None required.** Both RPCs already return everything the new UI needs (`avatar_url` /
`agent_avatar_url`, names, `organization_name`). No query is added, removed or altered. No
`.maybeSingle()` site is touched because no query is touched. `organization_id` / RLS boundaries are
unchanged, because the org RPC derives the org from `profiles` for `auth.uid()`. There are no
service-role keys, no secrets and no mock data in production paths.

---

## §5. Decisions for Chris (recommended defaults marked ✅)

| # | Question | Options |
|---|---|---|
| **D-1** | Name format | ✅ **Full name** "Avery Adams" (clearest; blank names become "Unnamed agent") · "Avery A." (the full page's podium style) · first name only (today) |
| **D-2** | Current user shown in the top 3 | ✅ **Soft primary tint on the row + small "You" label** (no score) · tint only · no treatment |
| **D-3** | Empty-state icon/copy | ✅ **Neutral `Users` icon, keep "No sales data yet"** · keep Trophy icon |
| **D-4** | Dashboard card header Trophy tile (`Dashboard.tsx:103`, the per-widget identity icon like Phone/Calendar/Target on sibling cards) | ✅ **Leave unchanged** (outside the widget body; not a score graphic) · replace in this pass (adds `Dashboard.tsx` to scope) |

---

## §6. Observations, no change proposed

1. **Zero-sales months.** The org RPC returns the whole Active roster zero-filled, so when nobody has
   sold yet the top 3 falls through to the alphabetical tie-break. This is existing ranking
   semantics, which this task freezes. Without visible counts it is less obvious to the viewer. It
   could be a follow-up, for example a neutral "No sales yet this month" note.
2. **Period mismatch.** The widget is month-to-date, and the full Leaderboard page opens on **Today**
   by default (`useLeaderboardData.ts:74`). "View Full Standings" can therefore show a different #1
   until the user picks "This Month". This is pre-existing. Changing the page is out of scope.
3. **Group metric.** Group `policies_sold` counts `clients`, not `wins`. This is already a documented
   AGENT_RULES #23 follow-up and is not touched.

---

## §7. Verification plan (after approval)

1. `npm ci`. Local dev dependencies only; the checkout has no `node_modules`.
2. `npx vitest run src/components/dashboard/__tests__/leaderboardWidget.test.tsx`.
3. Neighbouring suites: `src/pages/__tests__/leaderboardPage.test.tsx`,
   `src/hooks/__tests__/useLeaderboardData.test.tsx`,
   `src/lib/__tests__/profileScopeAndOrgTree.test.ts`. Then the full `npx vitest run`.
4. `npx tsc --noEmit`, plus ESLint on the touched files.
5. **Mutation checks.** Each of the following must fail at least one test:
   - removing the `cancelled` guard
   - re-adding a `pts` span
   - rendering `null` instead of the avatar
   - swapping two comparator keys
6. **Visual check.** A throwaway harness in the session scratchpad (never committed) mounts the
   **real** widget with a stubbed Supabase client and synthetic rows, then takes Playwright/Chromium
   screenshots in light and dark mode, in both the org and group views. The screenshots are shared
   with Chris. A live Dashboard check needs an authenticated session and remains Chris's browser pass
   on the Vercel preview. That pass is **not** claimed here.
7. **Diff audit.** Confirm the diff leaves both fetchers, both comparators, the effect dependencies
   and the error/stale/toggle/CTA markup byte-identical, and that no data-source or ranking behaviour
   changed.
8. Commit to `claude/dashboard-leaderboard-simplify-cqgfjf` and push. **No PR unless asked; no merge
   to `main`; no deploy.** Then append the WORK_LOG entry and the context snapshot.
