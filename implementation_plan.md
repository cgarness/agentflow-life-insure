## 2026-10-09 — APPROVED and BUILT LOCALLY (not pushed): Campaigns page table redesign, Phase 1

**Current status:** Chris approved rev 2 with D1-B and D2–D9 as recommended. Phase 1 is built and verified locally on `feature/campaigns-table-phase1-20261009`. Chris then approved publishing: the branch is pushed and open as draft PR #433 for his visual review. It is not merged or deployed, and production was only read (the §9 preflight). §14 records what was built and where it differs from this plan. The text below §14's heading is the approved plan, kept as written.

**Status when submitted for approval:** Phase 0 is complete. No application file has been edited, no backend command has been run, and nothing has been pushed. The only repository change is this section of `implementation_plan.md`.

**Base and branch:** base is `main` at `8d53531`. The proposed branch is `feature/campaigns-table-phase1-20261009`. Push, PR, merge and deploy each need separate approval.

**Revision history:**
- Rev 1 was drafted after the review.
- Rev 2 addresses an independent three-reviewer pass (requirements, safety/invariants, feasibility). That pass found no blockers. Its corrections are folded in below; the main ones are D1, the result caps, the harness widths, compare-and-set detection, placeholder states, sticky-column mechanics and query options.
- A separate verifier then re-checked rev 2 against the installed packages and the repository. It confirmed the new mechanisms and found five minor corrections, all applied here:
  - the unreachable View All case was removed from D1;
  - Open Pool assignee ids are now collected;
  - `role_permissions` was added to the harness stubs;
  - a desktop test pass was added;
  - the expanded row is now sized with container query units.

### 1. What was reviewed

**Documents.** I read `AGENT_RULES.md` (all 620 lines) and `VISION.md`, and all 13,017 lines of `WORK_LOG.md` in eight chunks reviewed in parallel.

**Code.**
- `Campaigns.tsx`, `CampaignDetail.tsx`, `CreateCampaignModal.tsx`, `CampaignHeatmap.tsx`
- `campaign-card-stats.ts`, `campaign-assignee-scope.ts`, `campaign-settings-permissions.ts`
- The Dialer `CampaignSelection*` table family
- `usePermissions`, `PermissionGate`, `PageGuard`, `useOrganization`, `AuthContext`, View As surfaces
- Every `user_preferences` writer, plus `report_layouts`
- The shadcn primitives
- The test and visual-harness infrastructure

**SQL**, read from the repository migrations only (no database was queried):
- `get_campaign_card_stats`, `get_queue_metrics`, `get_campaign_last_dialed`, `get_dialer_campaign_presence`
- `campaigns` and its RLS policies
- `user_preferences` and its policies and trigger

**Open PRs checked for overlap:** #429, #425, #398, #383, #382, #381, #378, #294. None touches campaign files, `src/components/ui/*`, permissions or `user_preferences`. #378 touches `src/App.tsx`, which this plan does not edit.

**Baselines on `8d53531`.**
- `npx tsc --noEmit` exits 0 but checks zero files.
- `npx tsc -p tsconfig.app.json --noEmit` reports **85 errors**, none of them in campaign files.
- Installed versions: `@tanstack/react-query` 5.83.0, `supabase-js`/`postgrest-js` 2.98.0, Playwright 1.56.1 (global, under `/opt/node22/lib/node_modules`), Chromium at `/opt/pw-browsers`.

### 2. Current page defects (confirmed in code)

1. **Fabricated zeros.**
   - While stats load, after a stats error, or when the RPC omits a campaign, Contacted and Converted show 0 (`Campaigns.tsx:347`).
   - `getCampaignCardStats` swallows errors and returns `{}`.
   - On the same fallback path, Total and Called come from `campaigns.total_leads`/`leads_called`. Those columns are trigger-maintained and **accurate** (invariant #17), so those two values are true today.
2. **The RPC and the list disagree on visibility.**
   - `get_campaign_card_stats` returns Personal campaigns to their owner only. Its `view_all` (JWT Admin, Team Leader or Team Lead, or `is_super_admin()`) widens Team only (baseline `:2211-2236`).
   - The list shows agents' Personal campaigns to Admins and Super Admins, so the RPC omits exactly those rows.
   - No other row is omitted. `campaigns_select` RLS uses the same JWT role list as the RPC's `view_all` (baseline `:11687`). A non-leadership role granted View All Campaigns therefore never receives unassigned Team rows in the first place.
3. **A failed list load looks empty.** It renders "No campaigns yet" with a Create button. There is no error state at all.
4. **No request safety.** There is no abort and no stale-response guard. Every refetch flashes the skeleton.
5. **Hidden row cap.** The list uses `select("*")` with no paging, so PostgREST `max_rows` (default 1000) would silently truncate it.
6. **Incomplete agency lock.** The suspended/archived lock covers only the header Create button. The empty-state Create button and Duplicate bypass it. It fails open if the status read errors; that part is left as is.
7. **Duplicate is not a real dialog.** It is a custom overlay with no focus trap, no Escape handling and no dialog role.
8. **Rule violations.** The page is 435 lines and uses inline `style` widths, against the 200-line and Tailwind-only rules.

### 3. Scope

**This build is frontend only.**
- No migration, RLS, RPC or Edge change.
- No edit to `TwilioContext`, Voice.js, queue RPCs, call telemetry, dispositions, `DialerPage` or any Dialer component.
- No change to `CampaignDetail.tsx`, `CreateCampaignModal.tsx`, `campaign-assignee-scope.ts` or `App.tsx`.
- I run no production reads or writes. Live checks happen only on a preview, after approval, and Chris performs them.

**Runtime reads and writes the shipped page will make.** Each one goes through the signed-in user's RLS.

| Kind | What |
|---|---|
| Read | `campaigns` (org rows) |
| Read | `get_campaign_card_stats` |
| Read | `get_campaign_last_dialed`, only if D3 is approved |
| Read | `profiles` (leadership assignee identities; the Create-modal agent list, as today) |
| Read | `organizations.status`, as today |
| Read | `user_preferences` (own row) |
| Write | `user_preferences`, own row only, on an explicit Save or Reset |
| Write | `campaigns` insert from Duplicate (unchanged payload) and from the existing Create modal |

**Visibility is unchanged.** The page reads org-scoped rows (RLS still applies) and then runs the existing `filterCampaignsForManagement(rows, user.id, { isAdmin, isSuperAdmin, viewAll })` with today's inputs. Management access never grants Dialer access, and no dialing action is added.

### 4. UX design

**Visual direction.** The target is AgentFlow's dark command-center look, built only from theme tokens so the light theme is correct as well. The app defaults to light; dark is the `.dark` class. Approval screenshots lead with dark and include light. **No mockup of the approved direction exists in the repository. Chris, please share the reference if there is one** (question Q1).

**Header**
- Title "Campaigns" with a muted count.
- **New Campaign** primary button:
  - gated by `PermissionGate "Create Campaigns"`, as today;
  - disabled while the agency is locked, with the existing toast;
  - opens the existing `CreateCampaignModal`, unchanged.
- No subtitle or descriptive copy.

**Toolbar** (one row on desktop, wrapping on narrow screens)
- Name search.
- **Type** select: All / Personal / Team / Open Pool. Legacy `OPEN` counts as Open Pool.
- **Status** select: All / Draft / Active / Paused / Completed / Archived.
- **Sort** select. Sortable header buttons drive the same sort state, and sorted headers carry `aria-sort`.
- **Reset**, shown only when something differs from the defaults.
- **Columns** popover, on the desktop table only.
- Radix/shadcn primitives throughout.

**Desktop table** (`xl` and up: a viewport of at least 1280px gives about 990px of content next to the 240px sidebar)
- Shell: `rounded-xl border border-border/60 bg-card`.
- The header band and rows use **opaque** layering, so the sticky column stays clean. Each cell sits on `bg-card`, with the muted tint and hover drawn as an overlay (`group` / `group-hover:`).
- Rows are about 48px tall, with thin dividers drawn on the cells (`border-separate border-spacing-0`).
- Numbers are right-aligned and use `tabular-nums`.
- The table uses `min-w-max`/explicit column minimums, so it scrolls inside its wrapper instead of squeezing columns.
- The Actions column is `sticky right-0 z-10 bg-card` with a left divider shadow.
- Expanded-row content is `sticky left-0`, sized to the visible width without measuring or inline styles. The table sits in a wrapper with `[container-type:inline-size]`, and the content uses `w-[100cqw]` (Tailwind 3.4.17 arbitrary values).

| Column | Default | Rule | Content |
|---|---|---|---|
| Expand chevron | yes | fixed first | A `<button>` with `aria-expanded`/`aria-controls`. It expands inline and never navigates. |
| Campaign | yes | locked | The name links to `/campaigns/:id`, with a compact Personal / Team / Open Pool badge (existing `campaignTypeBadgeClass`). |
| Status | yes | | Restrained pill with a dot: Active → success, Paused → warning, Draft → muted, Completed → primary, Archived → faded muted. |
| Lead progress | yes | | `called / total` plus a 4px bar (the existing shadcn `Progress` with `h-1`; its internal transform is the accepted primitive exception, so there is no page inline style). The tooltip says "Called at least once". The words "Untouched" and "Completed" are never used. |
| Agents | yes | | Personal → owner. Team → avatar stack with `+N`. Open Pool → "Open to agency" (D9). Identities follow D5. |
| Converted | yes | | Distinct converted campaign leads (RPC `converted_leads`). Never policies sold. |
| Actions | yes | locked, last, sticky | **Open** plus an overflow menu. |
| Contacted | optional | | RPC `contacted_leads`. |
| Created | optional | | Branding `formatDate(created_at)`. |
| Tags | optional | | Up to two chips, then `+N`. |
| Last dialed | optional (D3) | | Relative time, with a tooltip and `sr-only` exact time. |

There is **no Ready Now column** (D2).

**Metric states.** These apply to the RPC values Total, Called, Contacted and Converted. Each state renders differently and has a test.

| State | Rendering |
|---|---|
| Loading, including a placeholder map that lacks this id | Skeleton |
| Request failed, with no usable data | "—", plus one compact "Metrics unavailable · Retry" notice |
| Settled response from the current key with no row for this campaign | Depends on D1 |
| Loaded | The value. A genuine 0 renders as 0. |

**Last dialed states** (if D3 is approved): loading shows a skeleton; an error shows "—" with Retry; a loaded response with no row shows **"Never"**. The RPC is organization-wide, so a missing row means never dialed.

**Expanded row** (desktop and mobile)
- One row open at a time, matching the Dialer table's single-open accordion.
- A compact definition grid:
  - Total, Called, Contacted, Converted, using the states above;
  - Created;
  - Retry interval, Max attempts, Calling window and Ring timeout, from the existing `campaignSelectionModel.ts` helpers;
  - Last dialed (D3);
  - Owner or assigned agents (D5/D9).
- Description and tags appear only when they have a value.
- No charts, nested cards, presence or activity feed. There is no reliable feed source; Last dialed is the only candidate (D3).

**Actions**
- **Open** navigates to the existing detail route.
- The overflow menu holds **Duplicate**. Its eligibility is copied unchanged from today's role logic:
  - Agent: no item.
  - `role` "Admin" (case-insensitive): allowed.
  - Team Leader: allowed only if they created the campaign or are assigned to it.
  - Any other role string: disabled, with "Only the campaign owner can duplicate".
- With D4, Duplicate is also disabled while the agency is locked.
- When a viewer has no items, the overflow trigger is not rendered at all.
- The menu uses `DropdownMenu modal={false}`. The dialog state lives at page level and opens from `onSelect`.

**Duplicate dialog**
- Built on Radix `AlertDialog`. Confirm is a plain `Button` and the dialog closes only on success. Escape and outside-close are blocked while saving.
- The payload is validated with Zod.
- It inserts **exactly today's payload**: `"<name> (Copy)"`, the type, description, `assigned_agent_ids` and tags, status Draft, zeroed counters, `created_by`, `organization_id`.
- It never copies leads.
- The toast and activity-log entry are the same as today. Afterwards the list refreshes in the background.

**Below `xl`: stacked rows** (tablet and mobile)
- One bordered list, one row per campaign:
  - line 1: name and type badge, with the status pill on the right;
  - line 2: lead progress bar and `x / y called`;
  - line 3: **Open**, the overflow menu and the chevron, each a touch target of at least 40px.
- Expanding shows the same detail grid, which covers every optional column.
- No horizontal scrolling is needed for any essential action.
- Desktop and stacked are chosen by a `useMinWidth(1280)` hook based on `matchMedia`/`useSyncExternalStore`. Only one tree is mounted, so ids are not duplicated and the DOM is not doubled. Column preferences apply to the desktop table only.

**Page states**
- Skeleton table while loading.
- A **load-error panel** with Retry, shown only when there is an error and no data. A failed background refresh keeps the rows and shows "Couldn't refresh · Retry".
- "No campaigns yet" plus New Campaign (gated and lock-aware).
- "No campaigns match" plus Reset filters.

**Scale.** Filters and sorting always run on the full authorized set. Rows render 100 at a time, with a visible "Showing N of M · Show more". This is not a hidden cap, because the total is always shown.

### 5. Data layer

TanStack Query, with stable identity-scoped keys and explicit per-query options.

**Shared options** (`CAMPAIGNS_TABLE_QUERY_OPTIONS`, pinned by a source-contract test; `App.tsx` stays untouched):
- `staleTime: 30_000`
- `refetchOnWindowFocus: false`
- `retry`: at most once, and never for the list-too-large error

| Key | Query |
|---|---|
| `["campaignsTable","list",orgId,userId]` | **Raw org rows**. The management filter runs at render in a `useMemo` with the current role inputs, so a role change can never paint a wider cached set. Columns are explicit, not `*`: id, name, type, status, description, assigned_agent_ids, tags, user_id, created_by, created_at, organization_id, retry_interval_minutes, retry_interval_hours, max_attempts, calling_hours_start, calling_hours_end, ring_timeout_seconds, plus total_leads and leads_called only if D1-B is chosen. `.eq("organization_id")`, ordered `created_at desc nullsFirst:false` then `id`. **Paging:** the first page requests `count: "exact"`; later pages use the raw rows received as the offset; rows are deduplicated by id; paging stops at the count or on an empty page; filtering happens after paging. This avoids the 1000-row cap and does not depend on `max_rows`. Above 10,000 rows it raises a visible error. `leads_contacted`/`leads_converted` are never read. |
| `["campaignsTable","stats",orgId,userId,idsHash]` | `get_campaign_card_stats` on the **post-filter** visible ids, sent in chunks of 200 and merged. Any failed chunk fails the whole query, so partial maps are never shown. `campaign-card-stats.ts` will throw a typed error and accept a signal. `idsHash` is the length plus a fast hash of the sorted ids, so the key stays small; the full ids are passed to the function through a closure. The placeholder map is reused only if the previous key has the same org and user. While `isPlaceholderData` is true, a missing id renders as Loading. |
| `["campaignsTable","lastDialed",orgId,userId]` | D3 only. `get_campaign_last_dialed()` paged with `.order("campaign_id").range()` and a count, then filtered to visible ids on the client. |
| `["campaignsTable","assignees",orgId,userId,idsHash]` | Leadership viewers only (D5). The ids come from a new leadership-only collector in `model.ts`: Personal owners, Team participants and, for D9, Open Pool `assigned_agent_ids`. The existing `collectAssigneeIds` skips Open Pool, so it is not reused here. `profiles id, first_name, last_name, avatar_url`, explicit `.eq("organization_id")`, `.in("id", ≤100-id chunks)`, with a signal. Rendering is also gated on the **current** viewer being leadership, so cached names are never shown to an Agent after an identity switch. Loading shows avatar skeletons; an error shows count-only. |
| `["campaignsTable","createAgents",orgId,userId]` | Fetched only when the viewer has Create Campaigns. Today's Active-profiles list for the unchanged modal, with an explicit `organization_id` filter and a signal. |
| `["campaignsTable","orgStatus",orgId]` | `organizations.status` via `.abortSignal(signal).maybeSingle()`. It fails open to active, as today. |
| `["campaignsTable","prefs",orgId,userId]` | See §6. |

**Rules for every query:**
- each passes `signal` through `.abortSignal()`, placed before `.maybeSingle()`;
- none runs before organization, user and permissions are known (PageGuard already enforces this; the check is kept as defense in depth);
- after a create or duplicate, rows stay on screen while the background refetch runs.

`Campaigns.tsx` is an identity shell that renders `<CampaignsPageContent key={`${userId}:${orgId}`}>`. Filters, the expanded row, the column draft and pending saves therefore reset during render when the identity changes. There is no realtime subscription, the same as today.

**Sorting and filtering** apply to the full loaded set.
- Sorts:
  - Newest (default, today's order)
  - Oldest
  - Name A–Z / Z–A
  - Status
  - Type
  - Lead progress (percent called)
  - Total leads
  - Converted
  - Contacted
  - Last dialed (D3)
- Unknown values sort last in either direction.
- Ties fall back to `created_at desc`, then `id`.
- While stats are loading, metric sorts keep that fallback order.
- Search and both filters combine.
- **Reset** restores the defaults.

### 6. Column preferences

There is no schema change.

**Storage**
- Path: `user_preferences.settings.campaigns_table = { v: 1, orgs: { [orgId]: { order: string[], hidden: string[] } } }`.
- `user_preferences` holds one row per user (`UNIQUE(user_id)`, RLS `auth.uid() = user_id`) and has no organization column. The organization namespace is therefore enforced by the app inside the JSON.
- RLS makes it impossible to write another user's row.

**Owner and View As**
- The owner is the real `user.id` plus the current `organizationId`.
- Under View As nothing is read or written; the route does not mount under View As anyway.
- Every async completion re-checks the owner/epoch, and an impersonation ref, before it commits.

**Parsing.** A Zod schema parses `campaigns_table`. A pure normalizer then:
- drops unknown and duplicate ids;
- appends newly added columns at their default positions;
- pins locked columns.

**Load**
- Read `settings, updated_at` with `.maybeSingle()`.
- **Never write on load.**
- The Columns editor and Save stay disabled until the read has settled successfully for the current owner.
- If the read fails, the table uses the defaults and the editor shows "Couldn't load saved columns · Retry".

**Editing.** The Columns popover edits a draft that previews live:
- checkboxes show or hide optional columns;
- up/down buttons reorder the reorderable columns;
- Campaign, Actions and the chevron cannot be hidden.

**Save**
1. Re-read the row with `.maybeSingle()`. Abort if the read fails.
2. Merge only `campaigns_table.orgs[orgId]` into the freshly read settings.
3. Run `update({ settings }).eq("user_id", uid)` with `.eq("updated_at", observedString)`, or `.is("updated_at", null)` when it was null, followed by `.select("updated_at")`. The observed timestamp string is passed back exactly as read, never through `Date`.
4. **An empty result means a conflict.** Re-read, re-merge and try once more.
5. If no row exists, `insert`. On a 23505 error, re-read and take the same merge plus compare-and-set path. Never write a merge built on an empty base over an existing row.
6. Check the Supabase error. Close the popover only after success. On failure, keep the draft and show a concise error.

**Reset** removes only this organization's entry, using the same path. **Cancel** discards the draft.

**Limitation (documented, not fixed).** Compare-and-set protects only this page's own saves. Five existing writers do unguarded read-merge-write on the same blob: Contacts, `useContactScope`, ContactManagement, and CalendarSettings (×2). Contacts also writes automatically about 2 seconds after loading a saved sort. If one of their reads fails, or races with another write, the `campaigns_table` key can be erased, and the page falls back to the default columns. Compare-and-set relies on the `set_updated_at` trigger. That trigger is in the baseline, but **live presence is unverified** (preflight R1). Without it the save behaves like the existing writers: still own-row and key-scoped, with no conflict detection. No cross-tab compare-and-set guarantee is claimed.

### 7. Files

**Modified**

| File | Change |
|---|---|
| `src/pages/Campaigns.tsx` | Rewritten as the identity shell, under 200 lines |
| `src/lib/campaign-card-stats.ts` | Throws a typed error, accepts a signal, chunks ids, updated comment. Its only importer is `Campaigns.tsx`. |
| `implementation_plan.md` | This section |
| `WORK_LOG.md` | Completion entry |
| `AGENT_RULES.md` | Invariant #17 only: a one-paragraph amendment on the list's states and D1 rule |

**New components** (`src/components/campaigns/`, each under 200 lines, exporting only components)
- `CampaignsPageContent.tsx`
- `CampaignsHeader.tsx`
- `CampaignsToolbar.tsx`
- `CampaignsTable.tsx`
- `CampaignSortHeader.tsx`
- `CampaignTableRow.tsx`
- `CampaignRowDetails.tsx`
- `CampaignStackedList.tsx`
- `CampaignStackedRow.tsx`
- `CampaignRowActions.tsx`
- `CampaignColumnsMenu.tsx`
- `CampaignBadges.tsx`
- `CampaignLeadProgress.tsx`
- `CampaignMetricValue.tsx`
- `CampaignAgentsCell.tsx`
- `CampaignsListStates.tsx` (skeleton, error, empty, filtered-empty)
- `DuplicateCampaignDialog.tsx`

**New logic.** All non-component exports live in `.ts` files, to satisfy `react-refresh/only-export-components` under `--max-warnings 0`.
- `src/lib/campaigns-table/model.ts`: types, filters, search, sorts, metric-state resolver, duplicate eligibility, leadership predicate.
- `src/lib/campaigns-table/columns.ts`: the column registry.
- `src/lib/campaigns-table/prefs.ts`: Zod schema, normalizer, read/merge/compare-and-set.
- `src/lib/campaigns-table/queries.ts`: paged list, chunked stats wrapper, last dialed, assignee profiles, create-modal agents, org status, query options.
- `src/hooks/useCampaignsTableData.ts`
- `src/hooks/useCampaignsTablePrefs.ts`
- `src/hooks/useCampaignsTableState.ts`
- `src/hooks/useMinWidth.ts`

**New tests.** Radix tests copy the shim block from `notificationsDrawer.test.tsx`.
- `src/lib/__tests__/campaignsTableModel.test.ts`
- `src/lib/__tests__/campaignsTablePrefs.test.ts`
- `src/lib/__tests__/campaignsTableQueries.test.ts`
- `src/lib/__tests__/campaignCardStats.test.ts`
- `src/components/campaigns/__tests__/campaignsTable.test.tsx`
- `src/components/campaigns/__tests__/campaignStackedList.test.tsx`
- `src/components/campaigns/__tests__/campaignColumnsMenu.test.tsx`
- `src/components/campaigns/__tests__/duplicateCampaignDialog.test.tsx`
- `src/pages/__tests__/campaignsPage.test.tsx`, which covers:
  - `renderToString` smoke tests for the seeded, empty and error states, with the QueryClient seeded through `setQueryData`. Server rendering always takes the stacked layout, so a second `renderToString` renders `CampaignsTable` directly with seeded rows.
  - The page-level role, state and identity-switch tests, run twice: once with the default `matchMedia` stub (stacked) and once with `matchMedia` overridden to `matches: true` (desktop table, sort headers and Columns menu).

**Visual harness (D8):** `scripts/tests/campaigns-visual/{README.md,index.html,vite.config.ts,entry.tsx,stubs.ts,verify.mjs}`.
- `stubs.ts` is a recording fake query builder that allows only the tables and RPCs above, plus `role_permissions` (`usePermissions` queries it even for Admin), and serves synthetic fixtures for each persona.
- AuthContext and Branding are stubbed.
- `entry.tsx` wraps the page in QueryClientProvider (retry off) and TooltipProvider, inside a **shell that reproduces the app's 240px sidebar offset and `p-4 lg:p-6` padding**. A collapsed 64px variant is also run.

**Imported unchanged:**
- the helpers in `campaignSelectionModel.ts` (a pure `.ts` module, with no cycle and no react-refresh issue);
- `CampaignAvatarStack`, `filterCampaignsForManagement`, `CreateCampaignModal`, `PermissionGate`;
- the shadcn primitives.

**Not touched:** Dialer, telephony, queue, disposition, RPC, migration, RLS, Edge, `App.tsx`, `Sidebar`, `CampaignDetail`, `CreateCampaignModal`, and `useDialerCampaignPresence` (deliberately not reused).

### 8. Dependencies

- **No new npm packages.**
- The harness uses the environment's global Playwright 1.56.1 via `PLAYWRIGHT_MODULE` and the Chromium already in `/opt/pw-browsers`, following the `reports-visual` pattern. Nothing is downloaded and TLS is never bypassed.
- Tests need dummy `VITE_SUPABASE_*` variables in the shell only, never committed. The timezone is recorded.

### 9. Verification after approval

1. **Type checks.** Run `npx tsc --noEmit` (reported, but it checks nothing) and `npx tsc -p tsconfig.app.json --noEmit`. Compare the second against the 85-error baseline as a line-insensitive multiset. **No new diagnostic is allowed.**
2. **Lint and build.** `npx eslint` on every touched file with `--max-warnings 0`, then `npm run build` and `git diff --check`.
3. **Unit and component tests.**
   - The new suites.
   - The existing suites: `campaignAccessScope`, `campaignSelection*`, `viewAsSurfaces`, `viewAsRouteAllowlist`, `viewAsSidebarNav`, `campaignDetailImportRetry`.
   - Then a full-suite comparison of candidate against base.
4. **Role matrix.**
   - Roles:
     - Agent;
     - Agent with View All Campaigns granted (asserts that visibility matches RLS — assigned Team, Open Pool and own Personal campaigns only — and that the RPC omits no rows);
     - Team Leader with View All on, and with it off;
     - Admin;
     - Super Admin with role "Admin" and `is_super_admin`.
   - For each role, check:
     - visibility;
     - New Campaign gating;
     - Duplicate eligibility (today's rule);
     - lock behavior;
     - the D1 rendering for rows the RPC omits;
     - D5 identity gating, including the switch from a leadership user to an Agent;
     - D9 Open Pool assignees: names for leadership in the expanded row, a count for Agents.
   - The role string "Super Admin" is checked **through PageGuard as the documented pre-existing spinner** (it never mounts today), and its Duplicate eligibility as a pure function only.
5. **States.**
   - Loading shows no zeros.
   - A placeholder map renders new rows as Loading, never as "not available".
   - A stats error shows Retry.
   - A list error never renders as empty; a refetch error keeps the rows.
   - Genuinely empty, and filtered-empty with Reset.
   - Last dialed: Never versus error.
6. **Behavior.**
   - Filters, search and sort combine across the full set, with unknown values last.
   - Incremental rendering shows "Showing N of M".
   - Expansion is one row at a time, has the right ARIA, and never navigates.
   - Open navigates.
   - Create and Duplicate trigger the background refresh; the Duplicate payload is exactly today's.
   - The lock (D4).
7. **Preferences.**
   - No write on load.
   - Editing is disabled until the read settles.
   - Save merges only its key and leaves other keys and other orgs alone.
   - A compare-and-set result of zero rows triggers re-read and retry, and is never treated as success.
   - 23505 goes through re-read, merge and compare-and-set.
   - A failed read blocks the write.
   - Reset and Cancel.
   - Nothing happens under View As.
8. **Identity switches (org and user).** Previous rows, stats, assignees, preferences, drafts and pending saves are never committed or painted. This is asserted by capturing the DOM from a layout effect.
9. **Query safety.**
   - Paging: the count is honored, rows are deduplicated, and the cap error is visible.
   - Stats are chunked and fail as a whole.
   - Profile lookups are chunked.
   - Every query uses the signal.
   - The source-contract test pins the shared query options.
10. **Browser harness**, synthetic data only, no auth bypass, no production.
    - Viewports 1440, 1280, 1024, 768 and 390, inside the real shell offset, with the sidebar expanded and collapsed, in dark and light.
    - Checks: the table container width matches the real content width, no page overflow, the sticky Actions column renders cleanly, no console errors.
    - Screenshots: default table, wide optional columns, expanded row, Columns popover, stacked list, stacked expanded, and the empty, error and loading states. They are sent to Chris.
11. **Scope audit.** The diff touches no telephony, queue, disposition, Dialer, SQL or Edge path, and no new code reads `leads_contacted`/`leads_converted`.
12. **Live authenticated checks** happen on a Vercel preview, after push approval. Chris runs the sign-in smoke test; this environment has no authenticated session.

**R1: read-only backend preflight.** Requested separately; optional but recommended.
- Run `list_migrations`.
- Compare the live definitions of `get_campaign_card_stats` and `get_campaign_last_dialed` with the baseline.
- Confirm the live `user_preferences.set_updated_at` trigger.
- Read the PostgREST `max_rows` setting, if it is exposed.

### 10. Decisions for Chris (recommendation first)

**D1: rows that `get_campaign_card_stats` leaves out**
- Which rows: other agents' Personal campaigns seen by an Admin or Super Admin. This is the only reachable case, because RLS and the RPC read the same JWT role list.
- **The trade-off.** The spec says both "Phase 1 = existing trusted information" and "use the RPC for Total, Called, Contacted, Converted". For these rows, the RPC returns nothing, while the stored `total_leads`/`leads_called` (trigger-maintained and accurate) are what Admins see today.
- **Recommended: D1-B.** For these rows only, once the RPC has settled, Lead progress and Total use the stored `total_leads`/`leads_called`, and Contacted and Converted show "—" ("Not available for this campaign"). This keeps the true numbers Admins have today and never shows invented zeros. It departs from "RPC only" for Total and Called on these rows.
- **Alternative: D1-A.** Show "—" for all four values on these rows. This follows "RPC only" literally, but it is a **regression**: Admins lose accurate Total/Called and Lead progress on every agent-owned Personal campaign.
- Fixing these rows properly needs an approved RPC change in Phase 2.

**D2: Ready Now**
- **Recommended:** defer it to Phase 2, with no column and no placeholder.
- `get_queue_metrics` would need one call per campaign, each O(leads).
- It enforces Dialer scope (`can_dial_campaign`), so it would return 42501 for rows that are visible only through management scope.
- It does not use the Personal-queue definition, and it can overstate (invalid phones).
- A trustworthy column needs a new, approved batched RPC.

**D3: Last dialed**
- **Recommended:** include it as an optional column (off by default) and in the expanded row.
- Source: the existing `get_campaign_last_dialed`, which is already used by the Dialer selection screen. It returns the same org-wide `MAX(calls.created_at)` for every role, and it is labeled "Last dialed", not "activity".
- **Alternative:** omit it.

**D4: agency lock coverage**
- **Recommended:** apply the existing suspended/archived lock to the empty-state New Campaign button and to Duplicate as well. This is frontend-only and only tightens behavior.
- **Alternative:** keep today's header-only coverage.

**D5: Agents identities**
- **Recommended:** follow the Dialer's established ruling.
  - Leadership sees names and initials/avatars. Leadership means role 'Team Leader', 'Admin' or 'Super Admin', or `is_super_admin`; legacy 'Team Lead' is excluded.
  - The Agent role sees an assigned-agent count only.
- The Create modal's Active-profiles list is still fetched, as today, for viewers who have Create Campaigns. That includes an Agent who was granted it.
- **Alternative:** show identities to every role.

**D6: preference storage**
- **Recommended:** the org-namespaced `user_preferences` key with explicit Save (§6). It works across devices; the limitation is documented in §6.
- **Alternative:** localStorage keyed `af:campaigns:table:v1:<org>:<user>`, with try/catch. Nothing can clobber it, but it stays on one device.

**D7: reordering**
- **Recommended:** up/down buttons. This is accessible and matches Reports Phase 2.
- **Alternative:** drag and drop with dnd-kit.

**D8: visual harness**
- **Recommended:** commit `scripts/tests/campaigns-visual/` with no CI workflow.
- **Alternative:** scratchpad only.

**D9: Open Pool assignees**
- Open Pool campaigns store at least one `assigned_agent_ids` at creation, but anyone in the agency can dial them.
- **Recommended:** the Agents cell shows "Open to agency", which matches the Dialer and is accurate about dialing access. For leadership, the expanded row also lists them under "Assigned agents".
- **Alternative:** an avatar stack in the cell as well.

**Q1:** please share the approved visual reference, if there is one.

### 11. Risks and rollback

**Risks**
- With D1-A, Admins lose Total/Called on agents' Personal rows. With D1-B, those rows mix two documented-accurate sources.
- Other writers can erase the saved column key (§6). The page then falls back to the default columns.
- The sticky column and opaque layering need visual checks in both themes. These are covered by the shell-accurate harness.
- Switching the desktop/stacked layout by JavaScript means one tree is mounted. In server rendering and jsdom it falls back to stacked, which the tests account for.

**Rollback**
- Revert the single feature merge commit.
- No schema or data is involved.
- The orphaned `campaigns_table` preference key is ignored by older code.

### 12. Completion deliverables

1. A newest-first `WORK_LOG.md` entry with date and status, changes, the exact files, tests and results, migrations/deploys (none), and blockers.
2. The exact list of files touched, and the verification results, including the multiset type-check comparison.
3. Screenshots sent to Chris for approval.
4. No push, PR, merge or deploy without explicit approval.
5. A closing context snapshot: changes, decisions, migrations/deploys, blockers, next steps.

### 13. Pre-existing findings outside Phase 1 (each needs its own approval)

1. When an Admin duplicates an agent's Personal campaign, the copy is stamped `user_id = Admin` while `assigned_agent_ids` still lists the agent.
2. Duplicate's ownership check uses `created_by` and assignees instead of `user_id`. It excludes the role string "Super Admin" and copies no dialer settings.
3. The detail route has no management check, so a Team Leader can open agents' Personal campaigns by URL. Its status buttons are ungated and can report false success. Delete ignores errors. It reads unmaintained counters.
4. The agency lock has no server enforcement. The detail page, Dialer, inline create and import paths ignore it.
5. `AddToCampaignModal`'s scope filter reads camelCase fields, so its filtering is broken.
6. Profiles whose role string is "Super Admin" never pass `PageGuard` (`DB_ROLE_TO_KEY` has no entry, so permissions never load).
7. `get_campaign_card_stats` and `get_campaign_last_dialed` grant `anon` EXECUTE in the baseline. Hardening was deferred by Chris.
8. The recent-call-guard bullet of `AGENT_RULES` #15 says the queue metrics RPC "has not yet been adjusted", but `20261003043122` now mirrors it.

### 14. As built (2026-10-09)

**Preflight (read-only, production).** The live bodies of `get_campaign_card_stats` and `get_campaign_last_dialed` match the baseline. The `user_preferences` `set_updated_at` trigger exists. `authenticator` preloads `safeupdate`, and every update here filters on `user_id`. No custom `max_rows` is set. Nothing was written.

**Differences from §7, kept lean per approval condition 3:**
- Small single-use components were folded in:
  - `CampaignsHeader` → `CampaignsPageContent`;
  - `CampaignSortHeader` → `CampaignsTable`;
  - `CampaignStackedRow` → `CampaignStackedList`;
  - `CampaignBadges`, `CampaignLeadProgress`, `CampaignMetricValue` and `CampaignAgentsCell` → `CampaignCells.tsx`.
- `useCampaignsTableState` was not needed; filter, sort and expansion state live in `CampaignsPageContent`.
- `CampaignAvatarStack` crushed the initials at this row height, so `CampaignCells` has its own avatar stack.
- `get_campaign_card_stats` is called through the typed client; no `any` cast.
- The harness aliases `usePermissions` instead of stubbing `role_permissions`.
- Added `src/hooks/__tests__/useCampaignsTablePrefs.test.tsx`.

**Fixes from the adversarial review, each covered by a regression test or browser check:**
- Revisits refetch the list (`refetchOnMount: "always"`) and paint the owner's last confirmed column layout from the query cache.
- Last dialed failures show a Retry notice.
- An unsaved Columns draft is discarded below 1280px.
- The Campaign column truncates, so the default columns fit at 1280px without hiding Converted under the sticky Actions column. Optional columns scroll inside the table.
- Stacked progress text wraps instead of running under Open.
- Focus returns after Duplicate, Columns Retry and keyboard reordering.
- The no-org state never sends an unscoped read.

**Visual reference.** The previously approved dark table mockup was not found in the repository, docs or artifacts. The build follows the closest approved precedent, the dark Dialer campaign table. Chris should confirm the result against the mockup he has.

**AGENT_RULES.** Planned as a #17 amendment only. It also gained a short "Campaigns table invariant — October 9, 2026" section, because the `campaigns_table` preference key and its write rules are a new invariant (§9 of AGENT_RULES).

**Verification.** Results are in the newest WORK_LOG entry.

---

## 2026-10-08 UTC — SHIPPED: Super Admin live master Twilio balance

Chris approved the production release sequence. PR #426 merged to `main` as `158601c90e748d901197a103f4b570c367b454cd` after all five fresh-head gates passed: Twilio account balance, Dialer DNC integrity, Reporting integrity, A2P registration, and Reports frontend exact candidate-vs-base verification.

**Backend production:** `twilio-account-balance` Edge Function v1 is ACTIVE on `jncvvsvckxhqgqvkppmj`, `verify_jwt=false`, bundle SHA-256 `1d690adccb1715f8378f65e4e76737098c5b8386ba4f57b513230be45ff68c28`. Deployment readback matched the reviewed `index.ts` and `logic.ts` byte-for-byte. No migration, RLS, schema, production data, subaccount, Dialer/Voice, queue, disposition or telemetry mutation.

**Frontend production:** canonical Vercel project `agentflow` deployment `dpl_8VqL5hF7xWbx3ENh7djDBitBHDtP` is READY at the exact merge SHA and owns `www.fflagent.com` / `fflagent.com`. Secondary project deployment `dpl_FrbskHNduyuezuU85MBvLfWKUFRA` is also READY at the same merge. Vercel runtime-error scan found no errors in the selected post-release window.

**Verification boundary:** management-plane Edge deployment/readback, CI auth/provider/zero/error tests, built-frontend secret scan and Vercel production state are verified. This tool session does not expose a reusable authenticated AgentFlow Super Admin JWT, so it does not claim a live user-authenticated provider-balance response or browser rendering without evidence. No production auth/session credentials were extracted or manufactured to force that check. A real Super Admin opening the Agencies page will naturally invoke the deployed function; subsequent logs/network can confirm the live request.

No new AgentFlow invariant was introduced beyond the existing master-Twilio, Edge JWT, View-As and secret-handling rules.

---

## 2026-10-08 UTC — PRODUCTION EDGE DEPLOYED; frontend release gate in progress

Chris explicitly approved the production release sequence on October 7 PDT / October 8 UTC. Before deployment, production project `jncvvsvckxhqgqvkppmj` was ACTIVE_HEALTHY and had no existing `twilio-account-balance` function. Supabase public deployment/configuration guidance was rechecked; AgentFlow's reviewed `verify_jwt=false` + in-function ES256 bearer validation pattern remains intentional.

**Edge deployment:** deployed the complete reviewed `twilio-account-balance` bundle to production as **v1**, ACTIVE, `verify_jwt=false`, `ezbr_sha256=1d690adccb1715f8378f65e4e76737098c5b8386ba4f57b513230be45ff68c28`. Immediate readback confirms deployed `index.ts` and `logic.ts` are byte-for-byte identical to the review branch. No migration, RLS, database row, Twilio subaccount, Dialer/Voice, or Vercel production change occurred in the Edge deployment.

**Live verification boundary:** management-plane deployment/readback is verified. The current tool session does not expose a reusable authenticated AgentFlow user JWT, so it cannot truthfully claim a live Agent/Admin/Super-Admin invocation or actual provider balance yet without creating/mutating production auth state, which is outside the approved scope. The function's 401/403/master-endpoint/zero/error behavior remains covered by the green dedicated CI. Frontend release should expose the tile to the real Super Admin session, after which production function logs/network can confirm the real call without manufacturing credentials.

**Release gate:** current PR runtime is mergeable, feature/DNC/reporting checks are green. Two repository-wide workflows on the documentation-closeout head reported pre-job failures with zero jobs instantiated; no application test step ran or failed in those two executions. A fresh documentation/deployment record commit intentionally retriggers the PR workflows before merge so the release decision uses current evidence.

---

## 2026-10-07 — APPROVED BUILD: Super Admin live master Twilio balance

Chris approved repository implementation on October 7, 2026. Base/main at start: `1a877532068bf254aace53bdcacde606a4a693a5`; isolated branch: `feature/twilio-account-balance-20261007`. Full `AGENT_RULES.md`, `VISION.md`, and the complete 12,907-line `WORK_LOG.md` were read before runtime edits. Current open-work overlap was checked: PR #419 also changes `supabase/config.toml`; PR #378 and other historical open PRs touch shared documentation. Preserve current branch bytes and make only additive/surgical changes.

**Scope:** add a compact read-only master Twilio balance metric to the existing Super Admin Dashboard. No navigation page, billing management, per-agency allocation, usage graph, low-balance alerts, schema/RLS changes, subaccount changes, or Dialer/Voice behavior.

**Backend:** new `twilio-account-balance` Edge Function using only exact `TWILIO_MASTER_ACCOUNT_SID` + `TWILIO_MASTER_AUTH_TOKEN`. Call `GET https://api.twilio.com/2010-04-01/Accounts/{MASTER_ACCOUNT_SID}/Balance.json` with server-side Basic Auth. Do not use the fallback behavior in `_shared/twilioOutboundCreds.ts`. Validate Bearer JWT with anon-client `auth.getUser(jwt)`, then require BOTH JWT `is_super_admin === true` and server-side `profiles.is_super_admin === true` via `.maybeSingle()`. Return only `balance`, `currency`, `updated_at`; strip `account_sid`, raw Twilio payload, and secret-bearing diagnostics. Genuine zero is valid; malformed/upstream/config failure is unavailable, never fabricated zero. Add `[functions.twilio-account-balance] verify_jwt = false` to config.

**Frontend:** new `TwilioBalanceTile` mounted in `SuperAdminDashboard`, matching existing health tiles. TanStack Query with explicit modest stale time, no polling, no window-focus refresh and minimal/no automatic retry; manual accessible Refresh. Skeleton while loading, prominent amount + subtle currency on success, neutral `Unavailable` on failure. The query/render is disabled while `isImpersonating`; preserve the existing View-As allow-list that already blocks `/super-admin`.

**Files before runtime edits:**
- `implementation_plan.md`
- NEW `supabase/functions/twilio-account-balance/index.ts`
- NEW `supabase/functions/twilio-account-balance/logic.ts` — dependency-injected read-only handler logic so auth/provider behavior is testable without starting an Edge server
- NEW `supabase/functions/twilio-account-balance/logic.test.ts` — focused auth/master-account/zero/error regressions
- `supabase/config.toml`
- NEW `src/components/super-admin/TwilioBalanceTile.tsx`
- NEW `src/components/super-admin/__tests__/TwilioBalanceTile.test.tsx`
- NEW `.github/workflows/twilio-account-balance.yml` — narrow PR verification for the new Deno handler and UI tile
- `src/pages/SuperAdminDashboard.tsx`
- `WORK_LOG.md` after implementation/verification

**Verification:** focused auth/provider/zero/error Edge tests; UI loading/success/zero/unavailable/manual-refresh/View-As tests; Super Admin integration/regressions; `npx tsc --noEmit`; actual app TypeScript baseline comparison if root tsc is vacuous; scoped lint; production build; `git diff --check`; secret-response/frontend-bundle review. No production Edge deploy, Supabase mutation, migration, Vercel production release, merge, or push to `main` is authorized in this build.

**Build verification checkpoint (runtime head `10237284ebaf850e7adc4c815edf39a58f8c3b0f`):** dedicated Twilio balance CI PASSED — 12/12 Deno handler tests, Edge bundle type-check, 7/7 tile tests, scoped lint, root `npx tsc --noEmit`, `git diff --check`, production Vite build, and frontend bundle scan for `TWILIO_MASTER_*` / `SUPABASE_SERVICE_ROLE_KEY`. Existing Dialer/DNC, Reporting integrity, and A2P gates also passed. A2P exact-base app TypeScript comparison reports base=87, candidate=87, new=0. The broader Reports frontend exact-candidate/base workflow remains in progress at this checkpoint; do not misstate it as passed. No production deployment or Supabase mutation occurred.

---

## 2026-10-05 — Reports integrity published for verification; production release pending

Publication is approved and draft PR #418 is open. The reviewed candidate's files/evidence remain intact. The continuation adds a real-browser synthetic Reports gate and corrects premium clipping found in screenshots. See `docs/plans/2026-10-05-reports-integrity/{verification,release_packet}.md` for results and remaining native CI/hosted release gates. Production remains unchanged; Phase 2 and historical repairs remain excluded.

# Reports Phase 1 integrity — approved implementation

Chris approved the six-group audit plan on October 5, 2026. Base: b90e12d3bdcfb188ca0fbc6f25e971aaf77ddbf1. Isolated branch: codex/reports-integrity-phase1-20261005.

Full VISION.md, AGENT_RULES.md and WORK_LOG.md were read before application changes. Current main and open PR overlap checked. No production writes, migration application, historical repair, deployment, merge or main push are authorized. Phase 2 tabs/redesign are deferred.

See [the exact approved implementation plan](docs/plans/2026-10-05-reports-integrity/implementation_plan.md).

---

## 2026-10-05 — Reporting and leaderboard release completed

Chris confirmed the coordinated write window at 09:10 PDT under the October 4 release/permission approvals. PR #416 shipped as `51308ce16fb570ab668b87ab36df2a2b9abda995` after all five exact-head CI gates passed. Eight schema migrations, voice-status v45 and Google inbound sync v492 are applied and byte-verified. Both production frontend deployments are READY with served assets verified.

The approved six identity links and two missing sales are applied and receipt-verified: **eight policies/eight original sale events, $9,373.92 annualized premium**. September now contains four events/$3,205.32; October remains zero. Client details, calls, appointments and original sale facts match their pre-repair hashes; identity gaps and unlinked events are zero. No historical call/booking exclusions were invented. The 277 call and 12 booking candidates remain evidence-dependent; Reports remains a separate build.

Release bookkeeping only: align the eight migration filenames to recorded production versions without changing any SQL; update AGENT_RULES, WORK_LOG, this plan, task plan/progress/release/verification/Reports handoff and inventory; add the production release record and structured evidence. Fixtures resolve migrations by suffix and must still find exactly one file. Verify unchanged bytes, fixture generation, root/app TypeScript and whitespace before publication. No new runtime behavior or production data operation is part of this bookkeeping.

See [production-release.md](docs/plans/2026-10-04-leaderboard-accuracy/production-release.md) for exact versions, deployments, checks and recovery. Authenticated database-role readbacks passed. Secure hosted sign-in failed to fetch, so no authenticated production browser walkthrough or HTTP-origin latency claim is made. Agents were told to refresh and resume after final repair verification. Earlier statuses below are historical checkpoints.

## 2026-10-05 — Reporting release gate follow-up

PR #416 is published at `3edb2817`; native PostgreSQL 17.6 concurrency/security/index/reconciliation, DNC and A2P gates passed. Full frontend and real-browser checks exposed a missing permission fixture and TV table clipping. Correct the fixture, allow genuinely resolved baseline failures while rejecting all new failure identities/multiplicities, and size TV rows from actual header/content height. Keep geometry and data assertions. Thirty focused tests and root TypeScript/scoped lint pass; rerun all exact-head remote gates and inspect browser artifacts. The detailed results are in the task verification record. Production remains unchanged; the approved release still requires fresh drift/active-call checks and coordinated client refresh. Do not guess historical call/booking corrections.

## 2026-10-04 05:46 PDT — Reporting release and exact permission amendment approved

Chris approved the reporting release packet at 05:35 PDT, then explicitly approved the trusted Dialer permission correction at 05:46 PDT after the live ACL mismatch was disclosed. Migration 8 now verifies the exact actual ACL and revokes only anonymous/public execution; authenticated/service/owner grants remain. The fixture starts with the real baseline, and all 29 embedded policy/performance/repair steps pass, including anonymous denial and authenticated/Admin self-scope. No production mutation yet. Continue through native/browser/full-CI gates and recheck active calls immediately before any approved backend work. Reports-owned source remains outside this build.

Release verification additionally updates `scripts/verify_reports_frontend.py` to compare TypeScript file/code/message multiplicities without line-number churn and to allow resolved diagnostics; new diagnostics and new test/runtime failures remain prohibited. The existing AppointmentModal prefer-const lint error is corrected with no behavior change. Publication/release approval supersedes earlier isolated-only holds below; historical call/booking candidates remain unresolved.

## Reporting and leaderboard integrity — implemented in isolation, October 4, 2026

Chris approved the full correction plan at 22:41 PDT October 3 and asked to continue. Branch `codex/leaderboard-accuracy-audit-20261004`, base `436d9d840732bca1262559597c17e5ef09893fbf`. The task plan and exact release boundaries are in [the reporting release packet](docs/plans/2026-10-04-leaderboard-accuracy/release_packet.md); [verification](docs/plans/2026-10-04-leaderboard-accuracy/verification.md) records executed checks and limits.

Implemented one original sale per new primary/additional policy, stable identities/receipts, first/additional/historical entry, secured shared performance readers, agency timezone/as-of metadata, correct cents/seconds/ratio/CSV, atomic booking+disposition replay, stable call attempts and provider duration provenance. Preserved canonical DNC/conversion bodies and existing public-table RLS. Google provider event races are guarded. Reports application/RPC source is reserved for the other build.

Eight CLI-generated forward migrations are **unapplied**. Six historical identity links and the exact two-sale repair/reversal are quarantined outside automatic migrations. Disposable repair result: **8 events and $9,373.92 annual premium**, with no October increase. The immutable call/booking anomaly manifest remains unresolved pending provider/intent evidence; no historical mapping or duration correction is invented.

**Verified:** 521 passing frontend tests in 27 changed/new files (2 existing skips), both embedded database suites, read-only reconciliation query, production and isolated visual-fixture builds. App TypeScript has 87 baseline diagnostics versus 88 on main, no additions; scoped lint has no new errors. **Remaining gates:** independent-session PostgreSQL (local account-switch denied), real browser (Chromium certificate download error), full exact-head remote CI and production release checks. Neither browser nor production accuracy is claimed from component tests.

No public push/PR/merge, production mutation, Edge/frontend deployment, provider request or customer communication. Separate concrete release authorization is still required; the packet documents mixed-client rollout constraints and compatible recovery. Existing task histories below are preserved.

---

## Contact history soft pill with info — selected October 3, 2026

Chris selected option 2 of the final soft-pill previews at 20:32 PDT. Implement the whole communication row as one content-width soft pill, with inbound left/outbound right, plain inline outcome, compact time and an info button. All call metadata, historical agent attribution, duration, campaign, notes and existing recording/voicemail controls remain in a floating popover; email keeps full subject/body/endpoints/delivery details there. SMS and Activity retain their current presentation. The existing three-column Contact layout, readers, pagination, persisted refresh, conversion lineage and multi-tenant/View-As gates remain unchanged.

**Base / scope:** current main `f1a86fc9`, including the shipped Contact field and leaderboard work; no open overlapping history PR. Exact files announced before edits: `CallHistoryItem.tsx`, `EmailHistoryItem.tsx`, new `CommunicationHistoryPill.tsx` under `src/components/contacts/conversation-history/`; existing `fullScreenContactViewConversation.test.tsx`, `conversationDispositionColors.test.tsx` and new `communicationHistoryPill.test.tsx` under `src/components/contacts/__tests__/`; this plan and WORK_LOG.md. Eight files total. All are presentation/tests/documentation only; none changes production data or telephony. No migration, backfill, new dependency, source query or writer is needed.

**Implementation:** reuse the installed Radix popover with collision handling, a viewport-bounded scrollable content area, labeled trigger/content, explicit close, Escape/outside dismissal and focus restoration. Mount media only while open and unmount immediately on dismissal/contact switch. Default row keeps the exact stored meaningful outcome (including missed/forwarded labels); long values use ellipsis with full text in accessible/title details. Keep agency-configured disposition text colors using the existing dynamic color treatment, with Tailwind removing the old nested badge fill. The pill's displayed clock respects the existing time preference; full date/time remains on its timestamp tooltip and in details. Date, duration and agent are never invented. Email's persisted subject/body stay in the popover, and its status is shown in the pill.

**Validation:** focused history integration/data/pagination/refresh and Contact-entrypoint regressions; new real-Radix tests for trigger/Escape/outside close, focus return, full hidden data and media cleanup; `npx tsc --noEmit`, actual-app diagnostic comparison against exact main, scoped lint and Vite build; full frontend/DNC CI on the review head. Review the shared component for local-only state, stable keys, no new fetches and keyboard/touch affordances. Verify hosted appearance where authenticated browser access allows; never claim a signed-in check or audio playback without evidence.

**Local verification complete:** 116 passing focused tests across the completed selection (3 existing skipped); seven real-Radix lifecycle/content tests pass. Root tsc, scoped lint and Vite build pass. The application typecheck exactly matches main's 88 existing diagnostics. Full frontend/DNC CI and deployment checks remain release gates. Browser is signed out; no authenticated hosted or audio verification is claimed. Final commit/check/deployment evidence will be recorded on the PR.

**Release approved:** Chris explicitly approved public publication to `cgarness/agentflow-life-insure` and production deployment on October 3 PDT / October 4 UTC. This resolves the prior automatic-review publication block. Complete exact-head CI, PR merge and production verification; no backend change is required or authorized by this UI-only task.

**Boundaries / rollback:** continue the selected design through tested PR merge and production deployment under this explicit approval. Do not replay already-applied history migrations. Rollback is a frontend-only revert preserving subsequent main work. Out of scope: Contact redesign, Activity/SMS changes, data repair, callbacks/tasks/campaign writers, RLS, telephony/duration/locks/routing/dispositions/DNC/reminders and production business mutations.

---

> Current approved leaderboard data/TV work: [task plan](docs/plans/2026-10-03-leaderboard-data-tv/implementation_plan.md). Isolated implementation approved; production actions held. Existing plans below are preserved.

## Compact Contact history refinement — SHIPPED October 3 PDT / October 4 UTC, 2026 (PR #409)

**Release completed:** Chris explicitly requested “Complete the task to live production,” superseding the historical review-only holds below. PR #409 merged as `9112c8f1404f50289a53ce5806324ca50a9acfe5` from tested head `58993c487b7258329a0aeffd1f86b2652d3aa870`; both trees are `6b7ec06f1a995ce5e101f69585fce494f627f866`. Current main's #410/#411 field projection is preserved. The exact 11-file feature manifest below is unchanged; this closeout edits only implementation_plan.md and WORK_LOG.md, with no application or production-data behavior change.

**Checks:** 129 focused tests in 11 suites pass. Frontend CI `37164268636` passes against exact base `3ccbfb0b`: 4,091 passing tests on both sides, identical existing failure set (one failed assertion, 11 failed files including setup-dependent suites), 88 unchanged app diagnostics, zero unhandled errors. Root tsc, scoped lint, Reports tests, build and whitespace checks pass. DNC CI `37164268631` passes. Both previews READY before merge; no check was weakened.

**Live deployment evidence:** primary `dpl_FwUE1A36pXbQ4QcdZrheUCU7zJHj` and secondary `dpl_F1kU1MUDnm22GDBSN6GguyJCN84T` READY at `9112c8f1`, production target, no alias errors. www.fflagent.com / fflagent.com route to primary; agentflow-life-insure.vercel.app to secondary. Both public HTML/assets return 200; primary `index-DhW4Hs2r.js`, secondary `index-DpgyAOXk.js` contain the final compact disclosures, outbound layout, attribution wrapping and voicemail expansion. Both projects' one-hour Vercel runtime scans report no errors; static hosting logs do not certify client-side runtime health.

**Verification limits:** the production browser is signed out. Earlier authenticated preview checked call direction and complete call/voicemail/Activity expansion. Final responsive wrapping and email direction pass automated tests but have no final authenticated hosted visual walkthrough. No live audio, customer call/message or production-record mutation was used as a test. Auto-review rejected an optional protected-preview asset fetch because it creates a temporary authentication-bypass link; no bypass was performed or retried. Ordinary public production HTTP checks succeeded without bypass.

**Release boundary / recovery:** no new migration, backfill, query/writer, RLS, Edge, telephony/DNC/routing/locking/ownership/duration/reminder change. Do not replay either applied #407 history migration. Revert only the #409 frontend changes if needed, preserving subsequent main work; no database rollback is required. Existing tabs should refresh after active calls finish. The remaining text records the original design and approval checkpoints, not an outstanding production hold.

**17:06 PDT continuation:** refresh PR #409 with main `3ccbfb0b` after the separately approved Contact field release (#410/#411). Preserve that field projection unchanged. Only this plan and WORK_LOG.md receive new authored notes; the original 11-file feature delta remains unchanged. Previous head `2ce88024` passed final frontend/DNC gates. Re-run current-base verification and complete hosted visual review; record final evidence on PR #409. “Continue” does not authorize merging this refinement or releasing it to production.

Chris requested a simpler, space-saving history: one “Show details” expansion for everything, outbound icons on the right and inbound icons on the left, including email. This is a presentation-only refinement of shipped PR #407, based on main `c8b3a682`. Preserve the three-column Contact page, tabs, all stored data, existing reader/pagination/refresh behavior and SMS bubble direction.

### Design and exact file manifest

The manifest was presented before editing. No file below changes production data, telephony, ownership, RLS, schema, source writers or conversion behavior. No new files or migrations; no backfill.

| File | Reason and behavior change |
|---|---|
| `src/components/contacts/conversation-history/CallHistoryItem.tsx` | Compact summary retaining direction, agent, date, duration and outcome/disposition; wraps to a third line in narrow columns to preserve readable attribution. Icon follows direction. One disclosure reveals every existing metadata row, recording and voicemail; playback contracts unchanged. |
| `src/components/contacts/conversation-history/EmailHistoryItem.tsx` | Compact direction/date/subject summary and directional icon. One disclosure reveals full subject, complete body and all endpoint/delivery metadata. |
| `src/components/contacts/conversation-history/CommunicationDetails.tsx` | Explicit Show/Hide details labels and narrow-column wrapping, preserving keyboard/ARIA controls. |
| `src/components/contacts/conversation-history/ConversationTimeline.tsx` | Reduce inter-card spacing only. |
| `src/components/contacts/activity/ContactActivityItem.tsx` | Keep event, actor and time visible; expand complete change/assignee details with one disclosure. |
| `src/components/contacts/activity/ContactActivityTimeline.tsx` | Reduce padding and event spacing; preserve completeness/error/legacy disclosures and controls. |
| `src/components/contacts/__tests__/fullScreenContactViewConversation.test.tsx` | Update existing integration coverage for unified email/call expansion and playback lifecycle. |
| `src/components/contacts/__tests__/conversationDispositionColors.test.tsx` | Preserve agency colors, neutral cards and recording assertions under unified expansion. |
| `src/components/contacts/__tests__/contactActivityTimeline.test.tsx` | Verify collapsed actor and expanded assignee/change content, keeping legacy/retry/pagination coverage. |
| `implementation_plan.md` | Record authorized refinement, validation and release boundary. |
| `WORK_LOG.md` | Newest-first implementation evidence and remaining release status. |

### Verification and tradeoffs

Run focused Contact conversation/Activity and history attribution/refresh/pagination regression tests, root `npx tsc --noEmit`, app-type baseline comparison, scoped lint and Vite build. Review responsive hosted UI where browser access allows. Full call outcome and agent strings remain in Details; long summaries use ellipsis/title to keep cards compact. Media mounts only when Details opens, and collapses stop/unmount playback. Email retains quoted-line dimming and an internally scrollable full-body region. No extra data request or event is introduced by the new disclosure state.

Rollback is a frontend-only revert of this refinement; the already-applied Contact history migrations remain installed. Out of scope: source data changes, backfill, Contact field/layout cleanup, communications sending, dialing, DNC, routing, status processing, locks, ownership, reminders, automation, schema/RLS and production release. Build/review preparation is authorized; this revision needs Chris's exact merge/production-release approval. Validation results follow in the Work Log. Hosted inspection at a 1364-pixel viewport exposed cramped agent names; metadata now wraps as a group in narrow columns, keeping the agent readable without changing the page layout. PR #409 is review-only; final preview/CI evidence is recorded in its description.

---

## Contact history release — SHIPPED October 3, 2026 (PR #407)

Chris approved implementation with “Start the build,” then review publication with “Continue” / “finish the task,” and the staged production release at 12:26 PDT. [PR #407](https://github.com/cgarness/agentflow-life-insure/pull/407) is merged as `6c1f3174a15258c2f77c375204f687f15d20db34`, preserving prior main `84829dfe`. Migrations `20261003192857` and `20261003192907` are applied and catalog-verified with unchanged reviewed SQL. Both Vercel production targets are READY; production HTML/assets return 200 and contain the history readers. Final-head PostgreSQL, DNC and frontend comparison gates pass. Authenticated preview checks passed for stored attribution/details, Activity baselines, loading earlier records and refresh. Browser-service timeouts prevented the final voicemail visual check; no live media, customer communication or conversion mutation was tested. The dedicated specification, file list, deployment evidence, remaining verification limits and rollback are in [the Contact history plan](docs/plans/2026-10-03-contact-history/implementation_plan.md). No backfill or synthetic production business data was created.

Full-suite correction: the deep-link regression fixture now asserts persisted-history refresh instead of the retired browser activity insert. Final scope: 43 files; no runtime or CI-gate change in that correction. See PR #407 for final check results.

---

> Current Dialer/DNC task: [approved permanent disposition and DNC integrity plan](docs/plans/2026-10-02-dialer-dnc-integrity/implementation_plan.md). Branch implementation and testing approved; production actions and historical repair held. The unrelated leaderboard plan below is preserved.

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


### §15.1 Approved production release

Chris approved PR #387 merge, the exact tested forward SQL, bounded live checks and ten-minute observation, including the tested re-pause if stop criteria occur. PR #387 merged at `545398cf`; Supabase recorded migration `20260926060304_leaderboard_request_guard`, with SQL byte-for-byte equal to the tested source. The [production execution record](docs/incidents/2026-09-26-leaderboard-backend/verification.md#production-execution-2026-09-25-pt--2026-09-26-utc) records the database passes, observation limits and pending signed-in UI checks. The migration filename is reconciled without editing its contents. Production-only approval does not extend to Group semantics, RLS/grants, customer data, telephony or PRs #382/#383.

### §15.2 Signed-in checks completed; authorized latency re-pause

On September 26, signed-in Dashboard refresh, all three Leaderboard periods, metric switching and TV Month/Week totals passed functional checks on production main `7126ce1f`. The final API log window contained 20 successful standings POSTs, but three took 2,734 / 3,574 / 4,481 ms. The approved two-slow-read stop rule therefore required re-pause; successful data was not treated as a performance pass.

The exact tested re-pause was applied at 16:32:24 UTC as `20260926163224_leaderboard_repause_latency_gate`. SQL bytes match the existing ops source; guarded-and-paused hash `75eec092f7039c2c8cb0cca93e93d1ae`, security metadata, authenticated PT503 and the browser maintenance panel are verified. The new migration plus this plan, the backend plan/verification record, AGENT_RULES and WORK_LOG are the complete follow-up file scope. No new frontend, test, workflow or recovery SQL is introduced. See the [final evidence and diagnostic next step](docs/incidents/2026-09-26-leaderboard-backend/verification.md#signed-in-verification-and-authorized-latency-rollback-september-26-utc). Production standings remain paused pending a measured latency diagnosis and a separately approved next reopening.

### §15.3 Capacity diagnosis and resize preparation (historical; execution in §15.4)

Read-only investigation found a persistent large Swap allocation on the 0.5 GB Nano instance and 5,961,926 bytes of inline avatar text in the seven-agent organization roster. Neither observation alone attributes the slow HTTP maintenance path. The [capacity plan](docs/incidents/2026-09-26-leaderboard-backend/capacity_plan.md) prepares an exact Nano → Small (2 GB) change, estimated +$5.15/month before tax in the dashboard, with its project-specific longer-downtime warning, call-free preflight, read-only verification and recovery boundaries. The final confirmation has not been submitted. AGENT_RULES #28 requires separate exact production-configuration approval. Standings stay paused during this proposed capacity test. This proposal changes only the capacity plan, this root plan, incident verification and the additive work log; it changes no code, SQL, customer data or infrastructure.

Chris approved the exact resize at 10:09:12 PT on September 26. The fresh preflight found Alexa's recent 10:07 PT outbound call still marked ringing with no end time, confirmed again at 10:11:17 PT. Execution is deferred under the approved call-free condition; approval remains valid. The project is still Nano and the final confirmation is untouched. Resume after the call-free window is established and a fresh activity check passes; see the capacity plan's approval/preflight record.

### §15.4 Approved Small resize executed; standings remain paused

Chris confirmed the call-free window and requested another activity check. The final 21:07:03.673 UTC preflight found zero current nonterminal calls and zero fresh dialer-session heartbeats, with the pause/security metadata unchanged. The exact approved Nano → Small (2 GB) change was confirmed once at 21:07:20.458 UTC, at the same estimated +$5.15/month before tax. By 21:10:24 UTC, the provider was healthy, Infrastructure showed t4g.small, the database was reachable, and the pause/security contract and PostgreSQL 17.6 were unchanged.

The 21:10:24.926–21:20:24.926 UTC comparison contained 1,033 non-leaderboard REST requests, all 2xx (150 OPTIONS), with GET p95 212.25 / 345 ms in its two five-minute halves versus 1,703.15 ms in the earlier five-minute baseline. Three expected maintenance responses still took 1,825 / 1,914 / 1,934 ms. The Dashboard and its bounded Refresh worked; the widget and full Leaderboard retained the maintenance state. Zero lock waiters were observed. Authentication delayed the midpoint SQL/browser check; exact log windows and restart errors are explicitly recorded in [verification.md](docs/incidents/2026-09-26-leaderboard-backend/verification.md#approved-small-resize-executed-september-26-utc).

The resize passes basic recovery verification, **not** full leaderboard capacity verification. Standings were never reopened. The near-two-second maintenance path and unchanged inline avatar payload require follow-up; a new exact production reopening is still separately gated. No customer data, SQL, grants/RLS, application deployment, disk or manual pool settings were changed. The four-file documentation scope in §15.3 is unchanged; this section supersedes its earlier unexecuted status without erasing the approval/deferral history.

### §15.5 Maintenance-path diagnosis and proposed payload repair

Chris authorized beginning the read-only investigation and preparing the exact repair plan. The [payload repair plan](docs/incidents/2026-09-26-leaderboard-backend/latency_repair_plan.md) lists the proposed code/SQL files, cache behavior, synthetic regressions, deployment sequence and tested recovery requirements. Implementation approval is pending; production remains paused at `75eec092f7039c2c8cb0cca93e93d1ae`, freshly checked at 22:22:36.937 UTC on September 26.

The three post-resize maintenance HTTP requests correlate with 18 PostgreSQL PT503 executions in three six-attempt groups. Their error spans account for most of the outer response duration. This supports retries below the browser boundary, without identifying a specific hosted component or explaining earlier slow successful reads. HTTP 503/PT503 and the five-minute maintenance hold remain unchanged. No support message, gateway setting, SDK upgrade or further resize is proposed.

The proposed repair removes the existing 5,961,926 bytes of inline photo text from recurring organization standings: retain the RPC signature but return a null avatar field, explicitly project names/numbers in both clients, and load photos separately under existing profile RLS through a bounded shared memory cache and the same request gate. Photos, metric definitions, Group behavior, RLS/grants and uploads are preserved. New SQL templates must accept exact preimages and independently prepare while paused, reopen, re-pause and restore the original paused body. Their final hashes/digests are implementation deliverables before any separate production release approval.

This preparation changes only this root plan, the new payload plan, incident verification and an additive WORK_LOG entry. No application, SQL, customer data, dialing or infrastructure changes are part of this turn. The original production latency/error/lock stop rules still govern a later approved reopening.

**Implementation approval, 22:38:26 UTC:** Chris's “Continue” authorizes building and testing the listed repair on the isolated `codex/leaderboard-photo-payload-20260926` branch. The CLI generated `supabase/migrations/20260926223934_leaderboard_payload_prepare.sql`; its exact filename is recorded before its body is written. Plan-only PR #390 stays separate. This approval does not apply the migration, merge/deploy code or reopen production. Later implementation results supersede the preparation-only status above.

**Implementation complete:** [PR #391](https://github.com/cgarness/agentflow-life-insure/pull/391), stacked on documentation PR #390, contains tested executable-source commit `da4b0b1be179416b33fa0655580aad852d9fa34b`. The exact 24-file scope, review fixes, baseline comparison, SQL digests and release decision are in [payload plan §8](docs/incidents/2026-09-26-leaderboard-backend/latency_repair_plan.md#8-final-implementation-and-exact-release-packet). All 181 affected frontend tests pass; the full suite adds 24 passing tests with no common-test status changes and the same 12 baseline failing files. App typecheck remains the same 90 diagnostics; changed-source lint and build pass. PostgreSQL 17.6 CI passed 32 tests plus four caught SQL mutations; ten frontend mutations were caught. This does not establish repaired production latency.

**Release remains pending:** the 23:13:36 UTC read still confirms the original guarded-and-paused definition and unchanged security. The preparation migration and four transition templates have not been applied. Merge/deploy, prepare/reopen and the bounded production observation require the exact release approval in payload §8.4, with Chris's fresh no-active-dialing condition immediately before execution. No production data, photo, policy, telephony, dependency, compute or deployment change occurred during this implementation.

**Exact release approved, 23:26:58 UTC:** Chris approved §8.4, including both merges, paused deployment, exact prepare/reopen, ten-minute verification and conditional recovery. Three fresh dialing checks passed. Main `775005cf` and Vercel production now contain the tested frontend while the original database pause remains in force. Payload plan §9 records authority, file scope and execution checkpoints before SQL apply.

### §15.6 Payload release completed and standings live

Chris approved the exact staged release at 23:26:58 UTC. Fresh dialing checks passed; #390 merged at `4af2e588` and #391 at `775005cf`, with the tested tree preserved. Vercel production `dpl_HPuZtNbMjSsSrHqZZuGp2ZbBxKhM` is READY. Preparation `20260926233422_leaderboard_payload_prepare` and reopening `20260926233524_leaderboard_payload_reopen` are applied with their exact approved bytes. Active hash `c8b1f9d0c7cf5f8dfb7e437577029278`, security and Group verified; source migration filenames were reconciled to actual provider versions.

The signed-in Today/Week/Month, Calls Made, photos, TV totals and Dashboard Refresh checks pass. Exact 23:36–23:46 UTC observation: 22 standings requests all 200, 34–151 ms API origin latency, p95 65 ms; 234 other REST requests all 200, ordinary non-OPTIONS p95 153 ms. Two separate photo GETs (198/187 ms) demonstrate cold load and five-minute reuse. No stop rule fired; no re-pause or restoration was required. Final metadata/Group matched with zero lock waiters. Production standings remain live. Detailed limits, one-minute counts and recovery references are in payload plan §9 and incident verification. This is a bounded release check, not sustained busy-period capacity certification.

---

## §16. Reports & Analytics overnight build (2026-09-28) — plan awaiting approval

The Reports security/accuracy/reliability plan lives in its own file so the leaderboard record above stays intact:
**`docs/plans/2026-09-28-reports-analytics/implementation_plan.md`**.

- **Why:** the four live `public.rpc_report_*` functions are `SECURITY DEFINER`, trust a caller-supplied `p_org_id` and are
  executable by `anon` (read-only production catalog check, 2026-09-28): a cross-tenant aggregate exposure. Reports metrics
  also deviate from the documented canon (Contacted, Calls Made window, Policies Sold), one RPC reads a nonexistent column, and
  every failure renders as zero.
- **Proposed:** one new migration with a secured `public.get_report_*` family (scope from `auth.uid()` + profile, existing
  Reports permissions enforced server-side, agent id may only narrow) that revokes legacy EXECUTE; a keyed, generation-guarded
  frontend with truthful loading/empty/error/denied states and gated, sanitized exports; SQL + vitest coverage.
- **Boundaries:** no leaderboard, Dashboard, Dialer, telephony, RLS or `report-utils.ts` change. No production action until
  Chris's separate approval (plan §9).
- **Status update (2026-09-28, appended; the heading above is historical):**
  - Rev 2 was approved for branch implementation and testing only.
  - It is implemented and locally tested on `claude/reports-analytics-overnight-c69826`.
  - The migration is **not applied**, and nothing is merged or deployed.
  - The release packet, test results, metric decisions and rollback are in
    `docs/plans/2026-09-28-reports-analytics/MORNING_HANDOFF.md`.
- **Status update (2026-09-29, appended):**
  - Chris's three final corrections are implemented on the branch: contact-first Converted identity, a fail-closed
    agency time zone with no default, and the "Call contact rate" label. They are recorded in the Reports plan §R3.
  - A PR against `main` is opened so the Reports backend CI runs. It is not merged, and the migration is not applied.

---

## §17. Contact Follow-ups card + appointment ownership/reminders BUGFIX (2026-09-28) — plan awaiting approval

The full plan lives in its own file so the records above, including the Reports §16 pointer when it lands, stay
intact: **`docs/plans/2026-09-28-contact-followups/implementation_plan.md`**.

- **Why:** an explicitly chosen appointment assignee is overwritten on three live save paths (`CalendarPage.handleSave`,
  `CalendarContext.addAppointment`, `FullScreenContactView`'s Schedule). A CalendarPage edit also reassigns the row
  and rewrites `created_by`.
- **Reminders:** they also fire for Cancelled, Completed and No Show appointments. An assignee never learns of an
  appointment booked for them until a reload, because `appointments` is not in the realtime publication.
- **Proposed:**
  - one tested ownership rule: `user_id` = the responsible person, who is the reminder recipient; `created_by` = the
    scheduler, never rewritten;
  - a pure reminder-eligibility rule, a bounded visible-tab refresh and a Google create-sync guard;
  - a compact read-only Follow-ups card on the existing contact view, merging appointments, campaign callbacks and
    tasks for one contact. It reuses the `dashboard-callbacks.ts` constants without editing that file.
- **Boundaries:**
  - frontend only: no migration, RLS, RPC, Edge Function or deploy;
  - no Reports/Analytics, Dialer/telephony or canonical callback-writer change;
  - no production action. The only production access was read-only catalog and aggregate queries.
  - Decisions D-1…D-23 await Chris.
- **Status (2026-09-29):** approved 2026-09-28 with redlines (plan §16). Implemented and verified locally on
  `claude/contact-followups-appointment-fix-rruo7i` (plan §17); not pushed, merged or deployed.
- **Pre-merge gate (2026-09-29):** do not merge to `main` until appointment attribution is reconciled with the
  Reports work — "Appointments Set" credits `created_by` (scheduler), workload/reminders credit `user_id`
  (assignee). See plan §18. Branch push approved by Chris; no merge or deploy.
- **Final reconciliation (2026-09-29, after Reports):** rebased onto `main` @ `d05f4754`; the §18 gate is reconciled in plan
  §19 — Reports and the org leaderboard verified unchanged; GoalProgress and `getPerformance` now credit the setter; the
  Group leaderboard migration `20260929160000` is PREPARED, NOT APPLIED. Pre-existing Group 42702 defect documented (§19).
  Awaiting Chris: (A) the Group migration, (B) the push (a `--force-with-lease` after the rebase), (C) merge/release.
- **Revision (2026-09-29):** the Group migration is now the complete repair
  `20260929170000_group_leaderboard_repair_membership_setter_credit.sql` (42702 fix + setter credit + setter index),
  superseding `20260929160000`; PREPARED, NOT APPLIED. Evidence and suite in plan §20.
- **Revision (2026-09-29):** the same unapplied repair migration now also hardens EXECUTE (PUBLIC and anon revoked;
  authenticated and service_role kept; final ACL `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`);
  the rollback restores the exact production ACL. Plan §21.

## §18. Group leaderboard production record reconciliation (2026-09-29) — RECORD-ONLY; awaiting Chris's approval

(Root-plan §18. It is not the contact-followups plan's §18 pre-merge gate that §17 cites.)

- **Authority / scope:** Chris's brief "GROUP LEADERBOARD PRODUCTION RECORD RECONCILIATION" (label DOCS). Base `main`
  @ `196ea9a1` (0 behind). Filename/history reconciliation and release records ONLY: no application behaviour, no new
  migration SQL, and no production action of any kind (no apply, rollback, Supabase/RLS/data change or Vercel trigger).
- **Facts to record (all verified 2026-09-29, production `jncvvsvckxhqgqvkppmj`):**
  - **Application:** PR #395, tested head `d719845e45ea4e798a6dae74d13d28ff8492a0a3`, squash
    `196ea9a1d6435a271d67b6916844a09a04f8c0d4` (identical tree).
  - **CI on the tested head:** `Group leaderboard backend verification` (PG17.6) and `Leaderboard backend verification`
    both passed.
  - **Frontend:** Vercel production `dpl_4Lu4ibn82JTKvzFbTPQwuDwqsEq2` READY 21:04:59 UTC, serving
    `www.fflagent.com` and `fflagent.com`.
  - **Migration record:** `apply_migration` recorded version `20260929215047`, name
    `group_leaderboard_repair_membership_setter_credit`, as one statement. `md5(array_to_string(statements, E'\n'))` =
    `fe1c3033e7ce8b947b2b987eaea42dd7` = md5 of the merged forward file.
  - **Forward file:** sha256 `ee4a6d4973ab12c55b6775f741fc0fa3c541a7d67a64bf36514aff462636773d`, blob `34d4c66e`.
  - **Rollback file:** sha256 `d192f97115d7d9efca090867dfd749b778804fa1363a58b4854009c3cffcd5e9`, blob `3091e86c`;
    never applied.
  - **Function:** `pg_get_functiondef` md5 `e1283b5b05d295c1d25888485cc08346` → `8bd49ee01e0b92abd3e66548569f36bb`.
  - **ACL:** `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`.
  - **Index:** `appointments_setter_created_at_idx` =
    `CREATE INDEX appointments_setter_created_at_idx ON public.appointments USING btree (COALESCE(created_by, user_id), created_at)`.
  - **Live probes:** anon / PUBLIC-only (authenticator) → 42501; authenticated / service_role → membership denial
    P0001, not 42702.
  - **Unchanged:** org leaderboard `get_org_leaderboard_stats` definition md5 `c8b1f9d0c7cf5f8dfb7e437577029278`;
    Reports `get_report_call_summary` prosrc md5 `f221e1d470fc70ec92937be66be56e69`; every other function, index,
    policy, column, grant and trigger fingerprint; the data.
  - **Advisors:** security findings 194 → 193 — the only change is the removed
    `anon_security_definer_function_executable` finding for this RPC. Performance findings: an identical set of 410. The
    new index is not flagged `unused_index` because live traffic had scanned it (21:51:20 UTC) before the advisor
    run (21:51:37 UTC).
- **Occurrences of `20260929170000` on `main` (13, plus the two filenames), classified:**

  | Location | Class | Action |
  |---|---|---|
  | `supabase/migrations/20260929170000_group_leaderboard_repair_membership_setter_credit.sql` | current path | `git mv` → `supabase/migrations/20260929215047_group_leaderboard_repair_membership_setter_credit.sql`; content byte-identical |
  | `supabase/migrations/rollback/20260929170000_group_leaderboard_repair_membership_setter_credit.rollback.sql` | current path | `git mv` → `supabase/migrations/rollback/20260929215047_group_leaderboard_repair_membership_setter_credit.rollback.sql`; content byte-identical |
  | `scripts/run_group_leaderboard_tests.sh:9,58,59` | runner paths (live) | update |
  | `.github/workflows/group-leaderboard-backend.yml:3` | header naming the file under test | update; path globs already match |
  | `supabase/tests/group_leaderboard_rpc.sql:4` | SQL suite header (the AGENT_RULES #35-block bullet) | update |
  | `AGENT_RULES.md:205` | current-status rule | update: the header (drop "PREPARED, NOT APPLIED" and "production needs Chris's separate exact approval"), the tail "(… resolved by this migration once applied)", plus one verified-post-state sentence |
  | rollback file line 1 (`-- ROLLBACK for 20260929170000_…`) | comment inside the rollback | RETAIN: the brief requires byte-identical rollback content (#394 also left its header). The release records state that this name now means `20260929215047_…` |
  | `WORK_LOG.md` (the two 2026-09-29 Group entries) | historical entries | RETAIN (never rewritten; matched by content, since line numbers shift) |
  | `implementation_plan.md` §17 dated revision bullet | historical | RETAIN; new status goes in this §18 |
  | contact-followups plan §20/§21 (`:1503,1505,1562`) | historical, dated | RETAIN |

- **Reviewed, no version string, RETAIN:** these are present-tense test comments that describe the pre-repair
  production state the harness rebuilds on purpose:
  - `supabase/tests/group_leaderboard_index_proof.sql:86`;
  - `supabase/tests/group_leaderboard_harness.sql:14-16`;
  - `scripts/run_group_leaderboard_tests.sh:63,78,94` (`PROD_ACL`).
- **Files to touch (after approval):**
  1. The forward migration: rename only, as in the table.
  2. The rollback: rename only, as in the table.
  3. `scripts/run_group_leaderboard_tests.sh` (lines 9, 58, 59).
  4. `.github/workflows/group-leaderboard-backend.yml` (line 3).
  5. `supabase/tests/group_leaderboard_rpc.sql` (line 4).
  6. `AGENT_RULES.md`: line 205, and line 204 per D-2.
  7. `WORK_LOG.md`: one new entry at the top; no historical entry edited.
  8. `docs/plans/2026-09-28-contact-followups/PRODUCTION_RELEASE_2026-09-29.md` (new).
  9. `implementation_plan.md`: this §18 plus its as-built result.
- **Not touched:** `src/`; every other migration; the SQL content of both files; all other tests; the
  contact-followups plan (including its §18–§21); historical WORK_LOG entries; root §17's dated bullets;
  `RELEASE_READINESS.md`.
- **Verification before any push:**
  - sha256 and `git hash-object` of both files before and after (values above), and `git diff -M` showing two
    100%-similarity renames.
  - A content-based grep for `20260929170000`. It may remain only in the RETAIN rows above and in the new release
    records that cite the authored name: this §18, the new WORK_LOG entry, `PRODUCTION_RELEASE_2026-09-29.md`, and
    `AGENT_RULES.md` if it says "authored … renamed", as #34 does.
  - The Group runner on a disposable local PostgreSQL. This container has no Docker, so local = PG 16.13; the PG17.6
    proof is the PR's CI.
  - `npx tsc --noEmit`.
  - `git diff --stat`: no `src/` change and no new or changed migration content.
  - WORK_LOG updated last.
- **PR:**
  - Report the local results first; push and open the PR only on approval.
  - CI is expected to run two backend checks: `Group leaderboard backend verification`, and `Leaderboard backend
    verification`, whose `*leaderboard*.sql` filter matches the rename.
  - No merge without Chris.
- **Decisions for Chris:**
  - **D-1 branch.** Locally, the session's designated branch `claude/contact-followups-appointment-fix-rruo7i` has
    already been restarted at `main` and carries only this plan commit; its upstream tracking is cleared. The remote
    branch is still at the merged PR #395 head `d719845e`, with a tree identical to `main`. Publishing there needs an
    explicitly pinned lease:
    `git push --force-with-lease=claude/contact-followups-appointment-fix-rruo7i:d719845e45ea4e798a6dae74d13d28ff8492a0a3 -u origin HEAD:claude/contact-followups-appointment-fix-rruo7i`.
    Alternative: push the same commits to a new branch `claude/group-leaderboard-production-record`, with no force.
  - **D-2 `AGENT_RULES.md:204` (recommended: edit).** That current-state follow-up bullet still lists the Group
    RPC's "`appointments.user_id`-only … PUBLIC/anon EXECUTE" as open, and both are now fixed. Minimal wording:
    "(clients-based policies_sold, no direction filter; its `appointments.user_id`-only attribution and PUBLIC/anon
    EXECUTE were fixed by the Group repair applied 2026-09-29, next bullet)".
  - **D-3 rollback header (recommended: retain).** The AGENT_RULES #35-block bullet permits correcting a rollback
    header but does not require it. This brief requires byte-identical rollback content.

### §18 result (2026-09-29) — reconciled and verified locally; NOT pushed

- **Chris's decisions:**
  - D-1: a NEW branch `claude/group-leaderboard-production-record` from `main` @ `196ea9a1`. The merged PR #395
    branch stays historical at `d719845e` and is not reused or force-pushed.
  - D-2: approved; the `AGENT_RULES.md:204` parenthetical was updated.
  - D-3: approved; the rollback header was kept.
- **Renamed (100% similarity), with sha256 and blob identical before and after:**
  - forward → `supabase/migrations/20260929215047_group_leaderboard_repair_membership_setter_credit.sql` (sha256
    `ee4a6d4973ab12c55b6775f741fc0fa3c541a7d67a64bf36514aff462636773d`, blob `34d4c66e`, 5,434 bytes);
  - rollback → `supabase/migrations/rollback/20260929215047_group_leaderboard_repair_membership_setter_credit.rollback.sql`
    (sha256 `d192f97115d7d9efca090867dfd749b778804fa1363a58b4854009c3cffcd5e9`, blob `3091e86c`, 4,784 bytes).
- **Production match:** the stored `statements` of version `20260929215047` have md5
  `fe1c3033e7ce8b947b2b987eaea42dd7` and 5,434 bytes, equal to the renamed forward file. This was one read-only
  SELECT at 22:52 UTC; production still has 289 migrations, the latest being `20260929215047`.
- **Updated:**
  - runner `MIG` / `ROLLBACK` paths and its header;
  - the CI workflow header;
  - the SQL suite header (one comment line);
  - `AGENT_RULES.md` lines 204 and 205;
  - the new top `WORK_LOG.md` entry;
  - the new `PRODUCTION_RELEASE_2026-09-29.md`.
- **Remaining `20260929170000`, all intentional:**
  - WORK_LOG's two earlier Group entries;
  - root §17's dated revision bullet;
  - contact-followups plan §20/§21;
  - the rollback's first-line comment;
  - the new records that name the authored file (`AGENT_RULES.md:205` "authored as", this §18, the new WORK_LOG
    entry, `PRODUCTION_RELEASE_2026-09-29.md`).

  No filename carries it.
- **Checks:**
  - The Group runner on local PostgreSQL 16.13 passed steps 0–7: preimage, suite, three negative controls, drift and
    replay refusal, exact-ACL rollback and re-apply, the 13-scenario access differential, and the index proof, where
    auto_explain showed 7/7 index use.
  - Root `npx tsc --noEmit`: 0 errors. App tsconfig: 90, the same as `main`, since no TS file changed.
  - No `src/`, TS/JS or migration-content change.
  - No production write, apply, rollback, Vercel action or advisor fix.

## §19. Dialer appointment timezone + `created_by` writer fix (2026-09-30) — BUGFIX; implemented and verified locally (as-built below); not pushed

(Root-plan §19. It is not the contact-followups plan's §19 cited in §17 above.)

- **Authority / scope:** Chris's brief "DIALER APPOINTMENT TIMEZONE + CREATED_BY WRITER FIX" (label BUGFIX).
  - Base: `main` @ `d675a4b1`.
  - Local branch `claude/dialer-appointment-timezone-created-by` from `main` `d675a4b1`; this plan is committed
    locally only. Nothing is pushed.
  - Frontend-only writer fix. No schema, RLS, RPC, migration or production change.
  - Telephony, queue, canonical callback writer and Reports are untouched.
- **Verified root cause (code read + a throwaway probe that drove the real `saveCallData`; nothing committed):**
  1. **Timezone.** `dialer-api.saveAppointment` builds `start_time`/`end_time` as `${date}T${convertTo24h(time)}`, with
     no offset. `appointments.start_time` is `timestamptz`, so Postgres reads that wall-clock as UTC.
     - The probe ran under `TZ=America/Los_Angeles` for a 2:30 PM 2026-10-15 callback. The shadow insert sent
       `start_time: '2026-10-15T14:30:00'`, while `advance_campaign_lead` got
       `p_callback_due_at: '2026-10-15T21:30:00.000Z'`. The shadow is 7 h early.
     - The canonical DialerPage computation `new Date(y, m, d, h, min).toISOString()` is correct and is not changed.
  2. **`created_by` omitted.** The insert writes `contact_id, user_id, title, start_time, end_time, notes, status,
     organization_id` but no `created_by`.
  3. **Invalid second writer.** After `saveAppointment`, the appointmentScheduler path calls
     `CalendarContext.addAppointment({title,type,status,contactName,contactId,date,startTime,endTime,agent,notes})`.
     - The call is not awaited, inside a synchronous try/catch.
     - `addAppointment` inserts `{...a, ...ownership}` unmapped. PostgREST rejects the unknown camelCase columns, so
       today no second row lands, but there is a second INSERT attempt, an unhandled rejection and a `console.error`.
     - With the real CalendarProvider mounted, the probe recorded **2** `appointments` inserts per save.
- **Path audit (DialerPage):**
  - LIVE: `saveCallData` appointmentScheduler (`:3601`, plus `addAppointment` at `:3619`) and callbackScheduler
    (`:3664`). Both are reached from Save (`proceedSaveOnly`) and Save & Next (`proceedSaveAndNext`).
  - UNREACHABLE: `handleSaveCallback` (`:4256`; the Callback dialog's `setShowCallbackModal(true)` is never called)
    and the `AppointmentModal` `onSave` (`:4908`; `setShowAppointmentModal(true)` is never called).
- **Reader audit:**
  - Every reader parses `start_time` as an absolute instant; none compensates for the naive value.
  - The Main-Dialer shadow is never identified by time or `created_by`:
    - ContactFollowUps (`isMainDialerCallbackShadow`) matches title "Callback" plus a non-callback `type`;
    - appointmentFilters (`isDialerCallbackAppointment`, CalendarPage's List view) matches the title ("Callback" or
      a "Callback:" prefix) or the dialer notes marker, and deliberately never reads `type`;
    - dashboard-callbacks excludes it by `type` (it reads only callback types).
  - So the shadow must keep NO explicit `type` (DB default `Sales Call`): ContactFollowUps and dashboard-callbacks
    depend on it.
  - Reminders fire from `start_time`; today Dialer reminders fire 7 h early in PDT (8 h in PST).
- **Proposed implementation (surgical):**
  1. **NEW pure helper `src/lib/calendar/localDateTime.ts`:**
     - `parseWallClockTime(time)` accepts `h:mm AM/PM` (TimeSelect) and `HH:mm`, is anchored and range-checked, and
       returns null otherwise.
     - `localDateTimeToIso(dateYmd, time)` validates `yyyy-MM-dd` strictly (reusing `taskDates.parseLocalDateInput`,
       which rejects rollovers). It then returns `new Date(y, m-1, d, h, min, 0, 0).toISOString()`, the same
       construction as the canonical `callbackDueAtISO`, or null.
     - It never uses `new Date("yyyy-MM-dd")`, never appends `Z`, and has no fixed offsets. DST follows JS
       local-time rules, identically to the canonical value.
  2. **`dialer-api.saveAppointment`:**
     - `start_time` = helper(date, time). `end_time` = helper(date, end_time) when non-empty, else null.
     - If the date, the start or a non-empty end is invalid, it throws a clear Error BEFORE any write. Both live
       callers already catch and toast, so the call save continues.
     - Adds `created_by: data.agent_id`. `user_id` stays `data.agent_id`, the dialing agent, which equals
       `auth.uid()`, and RLS `appointments_insert` passes.
     - Every other column, the absence of `type`, and the `contact_activities` insert are unchanged. The now-unused
       `convertTo24h` is removed, and TimeSelect's doc comment is updated to name the helper (comment only).
  3. **`DialerPage.tsx`:**
     - `const { fetchAppointments } = useCalendar()` replaces `addAppointment`.
     - appointmentScheduler path: remove the `addAppointment` block. After a SUCCESSFUL `saveAppointment`, call
       `void fetchAppointments({ silent: true })`.
     - callbackScheduler path: the same silent refresh after success.
     - Dead `AppointmentModal` `onSave`: remove `addAppointment(data)` and refresh on success; not otherwise
       changed and not wired to anything.
     - `handleSaveCallback` stays unchanged; it is dead and inherits the fixed writer.
     - Unchanged: the canonical `callbackDueAtISO` (both copies), the `advanceCampaignLead` arguments, `saveCall`,
       `saveNote`, `updateLeadStatus`, queue, locks, Twilio, and the defense-in-depth try/catch (a shadow failure
       never blocks the call save or advancement).
- **Decisions for Chris:**
  - **D-1 CalendarPage (recommended: leave untouched).** Its `timeStringToDate` has different fallback semantics
    (unanchored regex; returns the base date on a parse failure). The new helper documents and tests the same
    contract without redesigning CalendarPage.
  - **D-2 appointment date prefill (recommended: include, one line).** `DialerPage.tsx:3458` defaults `aptDate` to
    the UTC date (`new Date().toISOString().split('T')[0]`), which is tomorrow after about 5 PM PDT. This is
    pre-existing and independent of the writer, but it is the same form's local-time contract. The fix is
    `todayLocalDateInput()` from `taskDates.ts`.
  - **D-3 branch name:** as above, or another name you prefer.
- **Tests (fail-first: each is run against the current code first and shown failing, then passing):**
  1. **`src/lib/calendar/__tests__/localDateTime.test.ts`:**
     - equality with `new Date(y,m,d,h,min).toISOString()` in any zone;
     - ISO `Z` format;
     - 12 AM / 12 PM, 24h input, malformed input and rollover dates rejected.
     - LA-only literals:
       - 2026-09-30 2:30 PM → `2026-09-30T21:30:00.000Z`
       - winter 2026-12-15 2:30 PM → `2026-12-15T22:30:00.000Z`
       - 2026-10-31 11:30 PM → `2026-11-01T06:30:00.000Z`
       - 2026-11-02 9:00 AM → `2026-11-02T17:00:00.000Z`
     - UTC-only: 2:30 PM → `14:30:00.000Z`.
  2. **`src/lib/__tests__/saveAppointmentPayload.test.ts`:**
     - start (with offset) and end instants, or null;
     - `user_id = created_by = agent_id`; `organization_id`, `status` Scheduled and `contact_id`/title/notes
       unchanged; no `type`; the activity row unchanged;
     - invalid time throws with ZERO inserts; an insert error throws.
  3. **`src/pages/__tests__/dialerAppointmentSave.test.tsx`:** real DialerPage save path, for Save and Save & Next.
     - Callback: exactly 1 `saveAppointment`, 1 `appointments` insert and 0 `addAppointment`.
     - **The shadow `start_time` equals the `advance_campaign_lead` `p_callback_due_at`,** with an offset guard,
       because an offset-less string would also parse locally in JS.
     - `created_by = user_id = USER`, and a silent refresh after the insert.
     - Appointment: the same checks, plus the expected start/end instants.
     - Failure: an appointments insert error → `toast.error`; the call save and advancement still happen; the
       success toast fires; no refresh.
  4. **Source contract:** DialerPage contains no `addAppointment(` call.
- **Verification:**
  - `npx tsc --noEmit`, plus the app `tsconfig.app.json` count vs the `main` baseline (90).
  - Under `TZ=UTC` and `TZ=America/Los_Angeles`:
    - the new tests;
    - dialerRenderStability, dialerTeamOpenWiring, dialerCallGate;
    - calendarAddAppointmentOwnership, reminderPopupRecipient, reminderEligibility;
    - contactFollowUps(+Queries), dashboardCallbacks, appointmentFilters, calendarPageListFilter;
    - fullScreenContactViewSchedule, taskDates;
    - the full suite vs the `main` baseline.
- **Docs after verification:**
  - AGENT_RULES #22: the ownership bullet's "Out-of-scope writers" clause becomes the fixed state. Legacy rows stay
    shifted until an approved repair.
  - A newest-first WORK_LOG entry.
  - This §19 as-built result.
- **Production:** none. After verification, a fresh read-only recount of the shadow candidates and a SEPARATE
  ID-bounded, fail-closed repair proposal. Any production mutation needs Chris's separate approval.
- **Known, not in scope (report only):**
  - existing rows stay shifted until repaired;
  - a silent refresh is skipped while another fetch is in flight, so the row then appears on the next 5-minute tick;
  - DialerActions shows `callbackDate` via `toISOString()`, which is off by a day beyond ±11 h zones;
  - FloatingDialer's writer is already correct;
  - google inbound all-day events are stored at UTC midnight;
  - the Dialer writes no `contact_name`.

### §19 review revisions (2026-09-30; independent read-only plan review — supersede the matching items above)

- **Writer scope confirmed:**
  - `saveCallData` `:3601`/`:3664` are the only live shadow writers. They are reached from Save, Save & Next
    (Personal and Team/Open) and both conversion paths, where `contact_id` is the new client id.
  - `autoSaveNoAnswer` / `handleAutoDispose` write no shadow. A callback-scheduler disposition named "no answer"
    auto-saves on selection and books no callback; this is unchanged and consistent with the canonical write.
  - FloatingDialer (native `type="time"`) is already correct.
- **Parity proven:**
  - The helper equals the canonical split-based parser for all 96 TimeSelect labels. This was checked on DST gap and
    overlap dates in LA, UTC, Santiago, Auckland, Chatham and Kolkata.
  - LA gap 2027-03-14 2:30 AM → `10:30:00.000Z`; LA overlap 2026-11-01 1:30 AM → `08:30:00.000Z`, the first
    instant.
  - The only divergence is years 0000–0099, where the canonical gives 19xx and the helper rejects. That needs a
    date caught mid-typing and is documented, not handled.
- **Refresh placement (replaces the per-path refresh):**
  - ONE `fetchAppointments({ silent: true })` after BOTH shadow blocks, only when at least one shadow save succeeded.
  - It sits outside the inner try/catch and is guarded as `?.(...)` with `.catch(() => {})`. `fetchAppointments`
    has no catch, and a missing function must never raise a false "may not have saved" toast.
  - Cost: one extra org-scoped ±180-day `select` per save that booked a shadow, and none for other saves.
- **Visible consequences of correct instants (a direct result of the fix; report, not scope creep):**
  - **Reminders.** A callback or appointment set within the reminder lead time (default 10 min) now pops the
    existing modal ReminderPopup soon after Save. Today in PDT these shadows are hours in the past and never
    remind. The immediate refresh only moves that moment from "within 5 min" to "now".
  - **Scorecard.** `AgentScorecardModal:58` counts `created_by` only, so new Dialer rows would count. It is
    currently not imported anywhere, so nothing is visible. Reports, org/Group leaderboards, GoalProgress and
    `getPerformance` use `COALESCE(created_by, user_id)` / `appointmentSetterOrExpression` and are unchanged.
  - **End at or before start.** This is possible today, e.g. a start of 11:45 PM, or a start changed after picking
    an end. It is not thrown on; noted as a known pre-existing issue.
- **Decisions (updated):**
  - **D-1 CalendarPage:** unchanged (leave untouched).
  - **D-2 appointment date prefill: recommendation changed to DEFER.** A local-today default in the evening lets an
    agent who picks "10:00 AM" without touching the date book a past appointment silently: no reminder, and it
    leaves the Follow-ups card at once. Today's accidental UTC-tomorrow default hides that. Fixing it properly
    needs a past-time warning (UI), which belongs in its own change. Alternative: include it with a non-blocking
    past-time warning toast.
  - **D-4 (new) immediate refresh: recommendation KEEP** the single silent refresh, accepting that a near-term
    callback reminds promptly. Alternative: drop it and rely on the existing 5-minute freshness.
- **Test additions:**
  - **Helper test:**
    - a table test of all 96 labels against a verbatim, commented copy of the canonical parser, on the DST gap and
      overlap dates;
    - LA literals for the gap, the overlap, 12:00 AM and 12:45 PM.
    - Its fail-first is only "module missing"; the real fail-first proof is the payload test and the page test.
  - **Source contract:** pins the two canonical `callbackDueAtISO` parse blocks (`saveCallData` and
    `proceedSaveAndNext`) unchanged, and requires no `addAppointment(` in DialerPage.
  - **Page test:**
    - exact string equality of `start_time` and `p_callback_due_at` (never `Date.parse`);
    - an offset guard on both `start_time` and `end_time`;
    - a spied `fetchAppointments` called exactly once;
    - cases: Personal Save and Save & Next, Team/Open Save & Next, a conversion (`contact_id` = client id), both
      schedulers (one refresh, two inserts), and the failure path.
  - **TZ commands:** `TZ=UTC npx vitest run …` and `TZ=America/Los_Angeles npx vitest run …`, recorded in the
    WORK_LOG, because LA-only cases skip in this UTC container and no CI runs vitest.
- **Docs additions (after verification):**
  - AGENT_RULES #22: name `dialer-api.saveAppointment` as also stamping `created_by`, and replace the
    "Out-of-scope writers" clause.
  - AGENT_RULES #23: note AgentScorecardModal's `created_by`-only count.
  - Fix the stale comment in `calendarAddAppointmentOwnership.test.tsx:325`.
  - Historical WORK_LOG lines are never rewritten.
- **Repair proposal note (for later):**
  - Identify shifted rows by `created_by IS NULL` plus the Main-Dialer shadow signature and a match to
    `campaign_leads`, not by a `created_at` cutoff; browser tabs running old code can keep writing after deploy.
  - Callback shadows take their exact instant from `campaign_leads.callback_due_at`. Dialer appointment rows have
    no canonical twin, so they need a separate decision.


### §19 as-built (2026-09-30; approved with D-1 leave CalendarPage, D-2 DEFER, D-3 this branch, D-4 keep the single silent refresh)

- **Branch:** `claude/dialer-appointment-timezone-created-by` from `main` `d675a4b1`. Committed locally only; not
  pushed, merged or deployed.
- **Decisions as applied:**
  - D-1: CalendarPage is untouched.
  - D-2: DEFERRED. The `aptDate` UTC-date prefill (`DialerPage.tsx`) is unchanged. Follow-up: "local-date
    appointment prefill" plus "explicit past-time validation/warning", as one change.
  - D-3: this branch.
  - D-4: ONE silent `fetchAppointments({ silent: true })` in `saveCallData`, only when at least one scheduler write
    succeeded. It is fire-and-forget: wrapped in `Promise.resolve(...).catch(() => {})` inside a try/catch, so a
    missing, throwing or rejecting refresh never turns a successful save into a failure, never shows the "may not
    have saved" toast, and never delays the call save, disposition or canonical advancement.
- **Files (application):**
  - NEW `src/lib/calendar/localDateTime.ts`: `parseWallClockTime`, `localDateTimeToDate`, `localDateTimeToIso`.
  - `src/lib/dialer-api.ts`: `saveAppointment` builds `start_time`/`end_time` with `localDateTimeToIso`, throws
    `"Invalid appointment date or time — nothing was saved"` BEFORE any write on malformed input, and adds
    `created_by: data.agent_id` (`user_id` stays `data.agent_id`). No `type`. The `contact_activities` row is
    unchanged. `convertTo24h` is removed.
  - `src/pages/DialerPage.tsx`: `const { fetchAppointments } = useCalendar();` replaces `addAppointment`. The
    `addAppointment` block after the appointmentScheduler write is removed. `schedulerWriteSucceeded` is set after
    each awaited `saveAppointment`, and the guarded refresh runs after the callback block. The dead
    `AppointmentModal` `onSave` no longer calls `addAppointment`; it refreshes after a successful save.
    `handleSaveCallback` (dead), the `aptDate` prefill and both canonical `callbackDueAt(ISO)` blocks are unchanged.
  - Comment only: `src/components/dialer/TimeSelect.tsx` and
    `src/contexts/__tests__/calendarAddAppointmentOwnership.test.tsx` (stale comment).
- **Files (tests):**
  - NEW `src/lib/calendar/__tests__/localDateTime.test.ts`: all 96 TimeSelect labels against a verbatim copy of the
    canonical parser on 10 dates, including the DST gap and overlap; edge and reject cases; LA-only and UTC-only
    literals.
  - NEW `src/lib/__tests__/saveAppointmentPayload.test.ts` (10): exact payload keys, `created_by = user_id =`
    agent, no `type`, activity row unchanged, malformed input throws with 0 inserts, insert error throws.
  - NEW `src/lib/__tests__/dialerAppointmentForcedLA.test.ts` (3): pins `TZ=America/Los_Angeles` in its own forked
    process (with a precondition test), so real Pacific/DST instants are checked even in a UTC run. It is the only
    guard against a helper that treats the wall-clock as UTC (e.g. appends "Z"), which UTC cannot distinguish; a
    naive offset-less value is also caught in any zone by the payload and page tests. Proven with a temporary
    naive-Z helper (then restored byte-identically).
  - NEW `src/pages/__tests__/dialerAppointmentSaveContract.test.ts` (8): no `addAppointment` outside whole-line
    comments; exactly two `saveAppointment(` and one refresh in `saveCallData`; refresh guarded by the flag, which
    is set only after each awaited write; both canonical parse blocks pinned verbatim;
    `callbackDueAt: callbackDueAtISO`; the writer uses the helper and stamps `created_by`/`user_id` with no `type`.
  - NEW `src/pages/__tests__/dialerAppointmentSave.test.tsx` (13): real DialerPage mount.
    - Personal Save and Save & Next (callback and appointment).
    - Both schedulers: 2 inserts, 1 refresh.
    - A failed shadow write does not block the save.
    - Conversion: `contact_id` is the client id.
    - Team/Open Save & Next: lock released.
    - Refresh reject, throw or missing: success toast, no false failure toast, no unhandled rejection.
    - Appointment-only failure: no refresh. Mixed failure: 1 refresh.
    - Time coverage (string comparisons, never `Date.parse`):
      - The 9 cases that write a callback shadow (Personal callback Save and Save & Next, both schedulers,
        conversion, Team/Open, the 3 refresh-isolation cases, mixed failure) assert the shadow `start_time` is
        string-equal to `p_callback_due_at`. Four of them (the two Personal callback cases, both schedulers,
        Team/Open) also apply the explicit offset guard; elsewhere equality with a `toISOString()` value already
        implies the "Z".
      - The two appointment cases assert exact `start_time`/`end_time` instants with the offset guard.
      - The failed-shadow case asserts the canonical `p_callback_due_at` instant only; the appointment-only failure
        case asserts no refresh, the call save and advancement, and no instant.
  - `src/pages/__tests__/dialerRenderStability.test.tsx`: the `useCalendar` mock now supplies `fetchAppointments`.
- **Before → after (LA, callback 2026-10-15 2:30 PM):** shadow `start_time` `'2026-10-15T14:30:00'` (naive; Postgres
  stores 14:30Z = 7:30 AM PDT, 7 h early) → `'2026-10-15T21:30:00.000Z'`, string-equal to `p_callback_due_at`. PST
  2026-12-15 2:30 PM → `22:30:00.000Z`; UTC 2:30 PM → `14:30:00.000Z`.
- **Results:**
  - Fail-first on `main` (the same 5 new/hardened files):
    - UTC: 23 failed, 6 passed, 2 skipped.
    - LA: 25 failed, 6 passed.
    - The helper and forced-LA files fail on import.
    - The 6 that pass are invariants that hold on both codebases.
  - Branch, the 7-file set (the new files plus dialerRenderStability and calendarAddAppointmentOwnership):
    - UTC: 71 passed, 9 skipped.
    - LA: 79 passed, 1 skipped.
  - Focused 65-file set:
    - Branch: UTC 940 passed / 29 skipped; LA 968 passed / 1 skipped; 0 failed in both.
    - `main`: UTC 908 passed / 20 skipped; LA 928 passed.
  - Full suite:
    - `main`: 249 files, 12 failed; 3842 tests, 1 failed; 1 unhandled error.
    - Branch: 254 files, 12 failed; 3892 tests, 1 failed; 1 unhandled error.
    - Both zones; the failed-file set is identical to `main`.
    - The 12 files are pre-existing Supabase-env import failures plus the `recordingRetentionVoicemail` "byte-identical
      to deployed v29" test.
    - The unhandled error is the pre-existing Twilio mock `findTwilioRemoteAudioElement` rejection, identical on `main`.
  - Typecheck: root `npx tsc --noEmit` 0 = 0; app `tsconfig.app.json` 90 = 90, with an identical error set.
- **Production (read-only, 2026-09-30 02:35 UTC):**
  - 71 appointments; 30 with `created_by` NULL.
  - 17 Main-Dialer shadows, all `created_by` NULL.
  - 4 shadows match a campaign callback, each exactly +07:00:00. 3 of them are future:
    - `2f5f498a-feb2-41de-afa2-2a2912e65c11`: 2026-10-12 10:30Z, due 17:30Z.
    - `47edce25-38d7-43ac-9772-472096d6fe01`: 2026-10-16 10:00Z, due 17:00Z.
    - `18858a30-72a4-4aea-98b4-2373664c012d`: 2026-10-27 15:00Z, due 22:00Z.
  - Past row `35cb701c-59dc-40bd-af57-b0f15784e9d1` (due 2026-09-21) is excluded.
  - All 4 belong to one agent and one org, with no external event.
  - No appointment was written or updated after 2026-09-29 22:49 UTC.
  - Repair: an ID-bounded, fail-closed DO block (re-verify 3 locked candidates → `start_time = callback_due_at`,
    `created_by = user_id` → row-count and postcondition checks). Status is untouched, so there is no workflow
    dispatch. It is PROPOSED ONLY and needs Chris's separate approval; nothing was mutated.

## §20. Reports Policies Sold source (2026-09-30) — BUGFIX; rev 2 APPROVED by Chris for branch implementation + isolated testing (§20.11 supersedes where they differ)

- **Authority / scope:** Chris's brief "BUGFIX — Reports Policies Sold uses the wrong source".
  - Base: `main` @ `5fc4649f` (re-checked 2026-09-30; includes #393 Reports, #395/#396 Group, #397 Dialer writer).
  - Branch `claude/reports-policies-sold-source-vqvh26`. **Only this plan is committed.** No implementation file edited,
    no migration created, no local or remote SQL executed beyond the read-only checks below.
  - Stop gate: no merge, no production migration, no deploy. Chris approves the production change separately.

### 20.1 Evidence (read-only, 2026-09-30; `BEGIN READ ONLY`, aggregates only, no PII, no writes)

- **Live function bodies (`md5(prosrc)`)** — these become the new migration's exact-preimage guard:
  - `public.get_report_call_summary(date,date,uuid)` `f221e1d470fc70ec92937be66be56e69` (equals the repo, per the
    2026-09-29 WORK_LOG record).
  - `public.get_report_call_volume(date,date,uuid)` `604abca3774fc10daa2c86faa9ff7524`.
  - `public.get_report_campaign_performance(date,date,uuid)` `9d151bf9ce31bd602af8317f2dd8e124`.
  - `public.get_profile_book_stats(text,text)` `38e98ae690b7dc781fadb5d1a858f11e` (read, never changed here).
  - `private.profile_parse_currency(text)` `dd42cd7b…`, `private.profile_parse_iso_date(text)` `be24ed08…`,
    `private.report_access(uuid)` `27116a40…`, `private.report_window(uuid,date,date)` `1107da18…`.
  - Before implementation, each repo body is loaded into a disposable local PG and its md5 compared with these; any
    mismatch STOPS the build and is reported (the repo must be the record of production).
- **Chris's organization (`a0000000-…0001`, agency zone `America/Los_Angeles`):**

  | Fact | Value |
  |---|---|
  | clients | 8 |
  | primary policies (evidence rule) | 8, 0 undated, 0 unassigned |
  | primary policies with `sold_date` 2026-09-01 … 2026-09-29 | **4** |
  | clients carrying `additional_policies` (any shape) | 0 (0 arrays, 0 elements, 0 malformed) |
  | wins created 2026-09-01 … 2026-09-29 (agency-local) | **2** |
  | September-sold primary policies whose client has NO win | 2 |
  | wins total / conversion-keyed / with `campaign_id` | 6 / 6 / 1 |
  | primary policies whose client has a campaign-bearing win | 1 of 8 (0 with >1 campaign) |

  Root cause confirmed: Reports counts `wins`; two September policies have no win.

### 20.2 The policy canon being mirrored (no new definition)

Source of truth: `src/lib/profile/normalized-policy.ts` + `public.get_profile_book_stats` (AGENT_RULES #34).

- **Primary** — a `clients` row in the org counts only with evidence: `nullif(btrim(carrier),'')` OR
  `nullif(btrim(policy_number),'')` OR `premium > 0` OR `face_amount > 0` OR `sold_date IS NOT NULL`. Sale date =
  `clients.sold_date` (a DATE; never converted through a time zone, never `created_at`).
- **Additional** — each element of `custom_fields->'additional_policies'` whose `jsonb_typeof = 'object'`, read through the
  empty-array-inside-LATERAL guard (#34: never a `WHERE` guard). Sale date =
  `private.profile_parse_iso_date(coalesce(entry->>'soldDate', entry->>'issueDate'))` — i.e. the legacy `issueDate` is used
  when `soldDate` is ABSENT, exactly as `get_profile_book_stats` does. The existing `private.profile_parse_*` helpers are
  REUSED, not copied.
- **Malformed** — container present and not an array (count 1 per client) + each non-object element; never a policy.
- **No usable sale date** → the policy is excluded from every dated Reports count and surfaced as `undated_policies`.
  Never bucketed by `created_at`, never guessed.
- **Window** — `sold_date BETWEEN v_win.start_date AND v_win.end_date` (the agency calendar dates `report_window`
  already validated). Date-only values stay calendar dates, so no DST/zone arithmetic applies.

**Two pre-existing TS↔SQL edge divergences found (decision D-1):** (a) a present-but-invalid or blank `soldDate` with a
valid `issueDate`: SQL does NOT fall back (coalesce picks the non-null string), TS does (`parse(soldDate) ?? parse(issueDate)`);
(b) `additional_policies: null` (JSON null): SQL counts it malformed, TS treats it as absent. Production has 0 rows of
either shape. **Recommendation:** Reports mirrors the SQL server canon (`get_profile_book_stats`) so the Agent Profile and
Reports can never disagree on the same row; both divergences get pinned by a SQL test and recorded as a follow-up
(align `normalized-policy.ts`), not changed in this bugfix.

### 20.3 Design

**New migration** `supabase/migrations/20260930120000_reports_policies_sold_normalized_source.sql` (authored version;
renamed to the production-stamped version after an approved apply, bytes unchanged — #35). The applied Reports
migration `20260929152553_…` is NOT edited.

1. **Preflight (refuse on drift or replay):** the three live md5s above, owner `postgres`, `prosecdef`, exact ACL
   `{postgres, authenticated, service_role}` for each; the two `profile_parse_*` helpers and `report_access` /
   `report_window` present with the md5s above; the new helpers must NOT already exist.
2. **`private.report_policy_facts(p_org uuid, p_agent_ids uuid[])`** — `STABLE`, `LANGUAGE sql`,
   `search_path = pg_catalog, pg_temp`, fully schema-qualified, REVOKEd from PUBLIC/anon/authenticated. One row per
   policy: `client_id, agent_id (= clients.assigned_agent_id), source ('primary'|'additional'), sold_date,
   campaign_id` (see 20.4). Rows are restricted to `clients.organization_id = p_org AND (p_agent_ids IS NULL OR
   assigned_agent_id = ANY (p_agent_ids))` — the SAME `agent_ids` `report_access` already resolved, so it cannot widen
   scope (NULL only for organization scope, exactly like calls/wins today).
3. **`private.report_policy_quality(p_org, p_agent_ids)`** — scope-wide (not windowed) `malformed_additional_policies`
   and `undated_policies`.
4. **`CREATE OR REPLACE` the three public RPCs** with identical signatures, `STABLE SECURITY DEFINER`, search path,
   grants. Each body is the applied body with only the `wins` CTE replaced:
   - `get_report_call_summary`: `w` ← policy facts dated in the window. `totals.policies_sold`,
     `by_agent[].policies_sold`, `unattributed.policies_sold` (policies whose client has no assignee — org scope only)
     and the roster union follow. New additive object `totals.policy_quality` `{undated_policies,
     malformed_additional_policies}` and `policy_source: 'normalized_policies'` in the payload.
     Dials-per-policy, Talk-minutes-per-policy and Top Performer are computed in the browser from these fields, so they
     follow automatically.
   - `get_report_call_volume`: `by_date[].policies_sold` = policies whose `sold_date` equals that local date.
     Same `policy_source` + `policy_quality`.
   - `get_report_campaign_performance`: see 20.4.
   - The disposition and lead-source RPCs have no policy field and are not touched.
5. **Postconditions** in the same transaction: new md5s recorded, ACLs exact, helpers unreachable by
   `authenticated`, legacy `rpc_report_*` still sealed (never re-granted).
6. **Rollback** `supabase/migrations/rollback/20260930120000_….rollback.sql`: guarded on the NEW md5s, restores the three
   preimage bodies verbatim from `20260929152553`, drops the two helpers, re-asserts ACLs and the legacy seal; verified
   to return exactly the preimage md5s. The existing `supabase/ops/reports_disable.sql` remains the emergency switch
   and still covers these functions.

### 20.4 Campaign Performance (decision D-2)

Current attribution evidence: `clients` has no `campaign_id`. The only lineage from a policy to a campaign is the
conversion win: `wins.idempotency_key = 'conversion:' || clients.lead_id` AND `wins.contact_id = clients.id` AND
`wins.campaign_id` is set (DialerPage path only; one per client by the unique key — unambiguous). Manually created,
imported, FloatingDialer and Contacts-page conversions have no campaign, and a failed celebration leaves no win at all.
In production only **1 of 8** policies has provable campaign lineage, so a campaign "Policies Sold" total cannot be
complete.

**Recommendation:** remove the `policies_sold` (COUNT(wins)) field from campaign rows and return instead
`attributed_policies` (normalized policies, dated in the window, whose client carries that conversion lineage — primary
and additional both count, because the one `additional_policies` writer is that same conversion) plus top-level
`policies_without_campaign` and `policy_attribution: 'conversion_lineage_only'`. UI column "Policies (campaign-attributed)"
with a note stating how many in-scope policies have no provable campaign. No campaign is ever inferred for a manual
client. Alternative (not recommended): show "unavailable" and no number at all.

### 20.5 Agent attribution limitation (documented, not fixed)

Policies are attributed to the client's CURRENT `assigned_agent_id` (the same column `get_profile_book_stats` and
`clients` RLS use). It is mutable: a client reassigned after sale moves its policies to the new agent for past
periods. `wins.agent_id` is sale-time but only exists for the subset of policies that have a win, so it cannot be the
source. Stated in AGENT_RULES #38 and the UI footnote ("credited to the client's current agent").

### 20.6 Frontend (labels, validation, tests — no computation change)

- `reports-schemas.ts`: accept `policy_source` (literal `'normalized_policies'`, required so a stale win-based payload is
  refused as `unavailable`, never shown under the new label), `policy_quality`, and the new campaign fields.
- `stat-computations.ts`: "Policies sold" subtitle `policies (wins)` → `stored policies`; Dials / Talk minutes per policy
  and Top Performer unchanged in formula.
- `PoliciesSoldChart.tsx`: footnote "Counted from stored client policies by sale date … credited to the client's current
  agent", plus a data-quality line when `undated_policies` / `malformed_additional_policies` > 0.
- `CampaignPerformance.tsx`: the attributed column and unattributed note; CSV header matches.
- `AgentPerformanceCards.tsx`: note text only (no longer "policies won").
- `Reports.tsx`: export label only if it says wins.

### 20.7 Tests

SQL (new `supabase/tests/reports_policy_facts.sql`, run by `scripts/run_reports_rpc_tests.sh` after the existing suite;
harness gains a production-shaped `clients` table — `policy_type NOT NULL DEFAULT 'Term'`, `premium/face_amount DEFAULT 0`,
`carrier/policy_number DEFAULT ''`, `sold_date date`, `custom_fields jsonb`, `lead_id`, `assigned_agent_id` — and the two
`profile_parse_*` helpers extracted verbatim from `20260919183544`):

- A converted client, 1 primary + 1 win → 1. B manual client, valid primary, no win → 1.
  C 1 primary + 2 valid additional + 1 win → 3. D no evidence (import defaults) → 0.
- E additional with only `issueDate` in range → counted on that date (and the D-1 divergences pinned).
- F string container / JSON null / non-object elements → 0 phantom policies, `malformed_additional_policies` exact.
- G primary sold outside the range → excluded. H additional sold outside → excluded; undated → `undated_policies`, not
  in any day.
- I own / team / organization and single-agent filters: counts never include another scope's clients; an out-of-scope
  `p_agent_id` still 42501; unassigned clients only in organization scope's `unattributed`.
- J September shape: 4 dated policies, 2 wins → totals 4, by_date sums 4, Top Performer from policies.
- Campaign: lineage-attributed policies counted per campaign; manual client never attributed; `policies_without_campaign`.
- Existing `reports_rpc.sql` policy assertions (T3/T4/T6/T8/T9/T11) re-seeded with clients so they assert policy
  counts; the wins fixtures stay to prove wins are ignored.
- **Mutation controls (runner):** 2g — the summary's policy CTE reverted to `COUNT(wins)` → must fail (A–C/J);
  2h — volume reverted → must fail; 2i — the additional-policies branch removed → must fail C;
  2j — the evidence rule dropped (every client counts) → must fail D. Plus drift, replay and rollback proofs for the
  new migration; PG16 locally, PG17.6 in CI (`reports-backend.yml`).

Vitest: fixtures + `reportStatComputations.test.ts` (Policies sold, Dials per policy sold, Talk minutes per policy,
Top Performer from policy counts), `reportsContracts.test.ts` (schema requires `policy_source`; a wins-shaped payload is
refused), `reportsPage.test.tsx` (chart totals, campaign column label/unattributed note, quality note).

Verification run: Reports SQL suite + new regressions; `scripts/run_profile_rpc_tests.sh`;
`normalizedPolicy.test.ts`; Reports Vitest; full Vitest vs `main`; `npx tsc --noEmit` AND
`npx tsc -p tsconfig.app.json --noEmit` vs `main`; ESLint on touched files; `npm run build`.

### 20.8 Files (exact; nothing else is touched)

- **New:** `supabase/migrations/20260930120000_reports_policies_sold_normalized_source.sql`;
  `supabase/migrations/rollback/20260930120000_reports_policies_sold_normalized_source.rollback.sql`;
  `supabase/tests/reports_policy_facts.sql`.
- **Modified (SQL/test infra):** `supabase/tests/reports_harness.sql`, `supabase/tests/reports_rpc.sql`,
  `scripts/run_reports_rpc_tests.sh`, `.github/workflows/reports-backend.yml` (only if its path filter needs the new files).
- **Modified (app):** `src/lib/reports-schemas.ts`, `src/lib/stat-computations.ts`,
  `src/components/reports/PoliciesSoldChart.tsx`, `src/components/reports/CampaignPerformance.tsx`,
  `src/components/reports/AgentPerformanceCards.tsx`, `src/pages/Reports.tsx` (label only, if needed).
- **Modified (tests):** `src/lib/__tests__/reportsFixtures.ts`, `src/lib/__tests__/reportStatComputations.test.ts`,
  `src/lib/__tests__/reportsContracts.test.ts`, `src/pages/__tests__/reportsPage.test.tsx`.
- **Docs:** `WORK_LOG.md` (newest first), `AGENT_RULES.md` (#38 metric canon: Policies Sold = normalized stored policies by
  sale date, never wins; #34 and #17 cross-references amended for Reports only; Leaderboard/Dialer keep wins), this plan.
- **Untouched:** Dialer, Twilio, queue/locks, dispositions, `ConvertLeadModal`, conversion, win celebration, Dashboard,
  Leaderboard, `get_profile_book_stats`, `normalized-policy.ts`, all RLS, all data. No win is backfilled.

### 20.9 Release (for later approval) and expected result

- Expected after release, Chris's org, 2026-09-01 … 2026-09-29, organization scope: `totals.policies_sold = 4`
  (4 primary + 0 additional), `by_date` sums to 4, `policy_quality` 0/0; Dials per policy sold = calls made ÷ 4.
- Sequence: CI green → merge → read-only preflight (md5s, 0 active dialer sessions) → `apply_migration` (Chris's
  exact approval) → verify md5s/ACLs and an authenticated September read = 4 → Vercel production deploy of the
  frontend. Between the migration and the deploy the old UI still renders summary/volume (now correct numbers) and the
  campaign panel shows its truthful error state (schema mismatch), never a wrong number.
- Rollback: apply the rollback as a NEW migration (restores the win-based bodies exactly); or the existing
  `reports_disable.sql` for "Reports unavailable, legacy sealed".

### 20.10 Decisions for Chris

- **D-1** Edge-case semantics: mirror the SQL server canon (`get_profile_book_stats`) — recommended — or the TS module.
- **D-2** Campaign Performance: campaign-attributed policies via conversion lineage + explicit unattributed count
  (recommended), or "unavailable".
- **D-3** Accept current-assignee attribution with the documented limitation (recommended; no schema change).
- **D-4** Frontend refuses payloads without `policy_source` (recommended) — makes the release order migration → frontend.

### 20.11 Rev 2 — Chris's approval with required adjustments (2026-09-30; supersedes 20.3–20.10 where they differ)

Approval covers branch implementation and isolated local testing only: no merge, production SQL, migration apply,
deploy, data or configuration change. Main re-checked: still `5fc4649f`; no concurrent branch touches Reports SQL.
Repo bodies built locally on PG16.13 hash to the live md5s in 20.1 (summary `f221e1d4…`, volume `604abca3…`, campaign
`9d151bf9…`, `report_access` `27116a40…`, `report_window` `1107da18…`).

1. **Source / sale date (D-1 = server canon).** Normalized stored policies exactly as `get_profile_book_stats`
   (20.2), reusing `private.profile_parse_iso_date`; `coalesce(soldDate, issueDate)` before parsing; JSON-null
   container counts malformed. Both SQL-vs-TS discrepancies are pinned by SQL tests; aligning
   `normalized-policy.ts` is a separate follow-up; Profile behaviour is untouched. Undated policies are never dated by
   `created_at` or a guess. Quality counts (`undated_policies`, `malformed_additional_policies`) are returned under
   `policy_quality` with `basis: 'scope_wide_all_time'` and labelled in the UI as "across this scope, all dates — not
   known to belong to this period". Dialer, Leaderboard and Dashboard keep event (wins) semantics.
2. **Campaign attribution (D-2).** Verified before coding: `mergeCustomFieldsOnConversion`
   (`src/lib/supabase-conversion.ts:28-44`, via `convert_lead_to_client_atomic`, which stamps `clients.lead_id`) is the
   only code that writes an `additional_policies` array; every other path carries the key by reference
   (`supabase-clients.ts`, `teamOpenLeadEdit.ts`, `FullScreenContactView.tsx`) and `import-contacts` never writes it.
   The assumption holds, so attribution proceeds. Per client (one lateral row, so no join can multiply policies):
   attributed to campaign X only when, among same-organization wins with `contact_id = client.id` and a non-null
   `campaign_id`, exactly one carries `idempotency_key = 'conversion:' || clients.lead_id`, all of them name the same
   campaign X, and X is a campaign of the same organization. Otherwise (no lineage, conflicting campaigns,
   foreign-organization campaign, manual/imported client with no `lead_id`) the client's policies are counted in
   `policies_without_campaign`. Campaign rows lose the `policies_sold` (COUNT(wins)) field; they carry
   `attributed_policies`; the payload carries `policies_in_period`, `policies_without_campaign` and
   `policy_attribution: 'conversion_lineage_only'`. UI: "Policies (campaign-attributed)" with the note "Conversion-lineage
   attribution only: not complete campaign sales attribution and not proof the campaign caused the sale." No ROI, no
   conversion rate.
3. **Current assignment is not seller credit (D-3).** Per-agent policy counts are "Policies (current assignment)" in
   Agent Performance, Agent Efficiency and every CSV (metadata `Note` rows state the basis). Top Performer becomes
   **"Most policies — current assignments"**. "Dials per policy sold" and "Talk minutes per policy sold" are shown ONLY
   for organization scope with no agent filter, described as "calls (or talk minutes) in the period ÷ dated stored
   policies in the period"; for own/team scope or an agent filter they are unavailable ("Not available: policies are
   credited to current assignment, not the original seller"). Reassignment regression added (SQL + Vitest). No seller
   ledger, ownership rewrite or win backfill.
4. **Fail-closed recovery (supersedes the 20.3.6 / 20.9 rollback).** Restoring the preimage bodies is NOT a production
   rollback: an old tab would accept win counts. Procedure, each step a NEW migration with Chris's approval:
   (a) `supabase/ops/reports_disable.sql` (unchanged) — revokes all six `get_report_*` from authenticated; old AND new
   tabs render "Reports are temporarily unavailable"; legacy stays sealed.
   (b) Optional, only while disabled: the preimage fixture
   `supabase/migrations/rollback/20260930120000_…rollback.sql` — refuses unless all six are client-disabled, restores the
   win-based bodies verbatim, drops the two helpers, and leaves everything disabled.
   (c) Re-enable only via `supabase/ops/reports_enable.sql`, now guarded: it refuses unless summary / volume / campaign
   carry the verified policy-based bodies (exact md5s). So the only path back is re-applying the forward migration
   (which preserves whatever ACL state it finds, i.e. stays disabled) and then enabling.
   Legacy `rpc_report_*` stay sealed at every step. Tested locally end to end; the fixture is never described as a
   standalone production rollback.
   Frontend: `policy_source: 'normalized_policies'` is required by the new schema (a win-based payload → `unavailable`);
   a disabled function (`permission denied for function`) → `unavailable` for old and new code alike.
5. **Release sequence (for separate approval; nothing changed or deployed now).** Facts: the Vercel production project
   deploys `main` automatically through its Git integration (every prior release, e.g. `dpl_4Lu4ibn8…`); the Supabase
   GitHub integration's "Deploy to production" is DISABLED (AGENT_RULES #30), so merging never applies a migration —
   migrations go only through the deliberate MCP `apply_migration`. Therefore "merge, then apply" is frontend-FIRST.
   Designed to be order-safe:
   - New frontend + old functions: the summary / volume / campaign panels show "unavailable" (no `policy_source`),
     never win counts under the new labels; other panels are unaffected.
   - Old tab + new functions: summary and volume parse (field names unchanged) and show the correct policy counts,
     but with the old labels ("policies (wins)", "Top performer", per-agent dials-per-policy); the campaign panel
     fails validation (no `policies_sold`) → unavailable. A reload is required; stated in the release note.
   - Controlled order: (1) CI green on the PR; (2) read-only preflight (live md5s = 20.1, 0 active dialer sessions);
     (3) merge → Vercel production READY (new UI, three policy panels "unavailable"); (4) `apply_migration` with the
     exact file; (5) verify md5s/ACLs + an authenticated September read = 4; (6) ask signed-in users to reload.
     Neither order depends on winning a deployment race. Integration settings are not changed.
6. **Verification** as listed in the approval; pre-existing failures reported separately.

**Revised exact file list (rev 2):**
- New: `supabase/migrations/20260930120000_reports_policies_sold_normalized_source.sql`;
  `supabase/migrations/rollback/20260930120000_reports_policies_sold_normalized_source.rollback.sql` (preimage fixture);
  `supabase/tests/reports_policy_facts.sql`.
- Modified SQL/ops/test infra: `supabase/ops/reports_enable.sql` (policy-body guard); `supabase/tests/reports_harness.sql`
  (production-shaped `clients`, win `idempotency_key`); `supabase/tests/reports_rpc.sql` (policy expectations);
  `scripts/run_reports_rpc_tests.sh` (policy migration, suite, mutations, drift/replay, recovery proof);
  `.github/workflows/reports-backend.yml` (path filter, if needed).
- Modified app: `src/lib/reports-schemas.ts`, `src/lib/stat-computations.ts`, `src/lib/reports-export.ts` (notes rows),
  `src/pages/Reports.tsx` (policy notes on exports, summary export labels), `src/components/reports/PoliciesSoldChart.tsx`,
  `src/components/reports/CampaignPerformance.tsx`, `src/components/reports/AgentPerformanceCards.tsx`,
  `src/components/reports/AgentEfficiency.tsx`.
- Modified tests: `src/lib/__tests__/reportsFixtures.ts`, `reportStatComputations.test.ts`, `reportsContracts.test.ts`,
  `reportsExportFormat.test.ts`, `reportsQueries.test.ts` (if needed), `src/pages/__tests__/reportsPage.test.tsx`.
- Docs: `AGENT_RULES.md` (#38, cross-refs in #17/#34), `WORK_LOG.md` (prepended), this plan.

### 20.12 As built (2026-09-30) — branch `claude/reports-policies-sold-source-vqvh26`; NOT merged, NOT applied, NOT deployed

- **Migration (NEW; the applied `20260929152553` is byte-identical to main, pinned by test):**
  `supabase/migrations/20260930120000_reports_policies_sold_normalized_source.sql`, SHA-256
  `b4cfc36c2b0eb370435a29456f08259ea0dfebc4ac18f6e80bb046477e1118a0` (42,160 bytes). Authored version; `apply_migration` will
  stamp its own version, and the filename (plus runner/test references) is reconciled afterwards with bytes unchanged (#35).
  - Preflight: live md5s of summary `f221e1d4…`, volume `604abca3…`, campaign `9d151bf9…`, `report_access` `27116a40…`,
    `report_window` `1107da18…`, `profile_parse_iso_date` `be24ed08…` (all equal to the repo build on PG16.13); owner/SECURITY
    DEFINER/STABLE/search_path; ACL exactly enabled or exactly disabled; clients/wins column shape; replay refusal.
  - Three private helpers; three `CREATE OR REPLACE` bodies generated from the applied bodies by exact single-occurrence
    replacements of the wins source only. Resulting body md5s: summary `826736e666a12d0d85ec3797b2556792`, volume
    `b4f7d891d7fb29962c86b668a1a2aee6`, campaign `ad2e005906f5d38dc1ee0308ad368f04` (embedded in the enable guard and the fixture).
  - Postconditions: metadata, ACL unchanged from preflight (never re-enables), no body reads `public.wins`, helpers
    client-unreachable, legacy sealed.
- **Recovery files:** preimage fixture `supabase/migrations/rollback/20260930120000_…rollback.sql` SHA-256
  `5bdb986618e42aac0d22833f618b3d8d49eab95d779d9723e5e2d76b22f1c771` (refuses unless all six `get_report_*` are
  client-disabled; restores the three preimage bodies verbatim; drops the helpers; stays disabled). `supabase/ops/reports_enable.sql`
  SHA-256 `16770f3da54a2fad1942f19732c27ea1ba64e831f5cf5b95350b11726d9f9885` gains the POLICY-SOURCE GUARD before any grant.
  `supabase/ops/reports_disable.sql` unchanged (`8cc967c4…`).
- **Additional-policy writer assumption re-verified before coding** (see 20.11.2) — holds.
- **Frontend:** schema requires `policy_source` / `policy_basis` / `policy_quality` (summary), `policy_source` / `policy_quality`
  (volume) and the campaign lineage fields; one wording module `src/lib/reports-policy-text.ts` (new — added to the 20.11 list)
  for on-screen notes and CSV `Note` rows; "Most policies — current assignments"; "Policies (current assignment)";
  "Policies (campaign-attributed)"; per-policy ratios organization-unfiltered only.
- **Expected production result (Chris's org, 2026-09-01 … 2026-09-29, organization scope, from the 20.1 read-only facts):**
  `totals.policies_sold = 4` (4 primary, 0 additional; wins would say 2); `by_date` sums to 4; `policy_quality` 0 / 0;
  Dials per policy sold = outbound calls made ÷ 4; Campaign Performance: at most 1 of those 4 can be campaign-attributed
  (only 1 of the org's 8 policies has a campaign-bearing conversion win) and the rest appear in `policies_without_campaign`.
  These are predictions from read-only aggregates; they are verified only after an approved apply.
- **Remaining limitations:** current-assignment attribution (no seller ledger); conversion-lineage-only campaign attribution;
  the TS/SQL edge divergences (follow-up: align `normalized-policy.ts`); Dialer header / Leaderboard / Group still count
  wins or clients by design; old tabs need a reload after release; `report_policy_quality` re-reads the facts (fine at
  current volume; revisit with an index plan if client counts grow by orders of magnitude).


### 20.13 ChatGPT takeover — final privacy and fixture corrections (2026-10-02)

Chris explicitly asked ChatGPT to implement and complete the two review corrections because Claude is unavailable.
Branch: `codex/reports-policy-final-fixes-20261002`, based on `037ec13e`. Production remains read-only; exact production
migration and merge approval remain separate under #28.

Intended files: the UNAPPLIED policy migration, its disabled-only rollback, reports_enable.sql, SQL runner,
reports_harness.sql, reports_rpc.sql, new reports_fixtures.sql, new reports_campaign_visibility.sql, new fixture
setup guard tests; Reports campaign/disposition schemas and labels, shared export notes, fixtures and page/contract
tests; isolated GitHub verification workflow; AGENT_RULES, WORK_LOG and this section. No applied SQL bytes change.

- One private visibility resolver mirrors the live campaigns_select policy and validates the actual actor. Both
  campaign performance and the disposition by-campaign breakdown use it, since inspection found the same name
  exposure in both. Policy counts and call counts remain scoped independently; hidden campaign metadata never
  leaves the server. Unavailable attribution combines absent, ambiguous and restricted links without identifying them.
- Fixture setup is separated from assertions and must succeed before any mutant is exercised. An injected broken
  fixture must stop the runner, never count as a killed mutant. Production preflight/postcondition guards are intact.
- Tests run against disposable localhost PostgreSQL with synthetic data and read-only repository credentials where
  possible. Temporary workspace/bootstrap tooling is removed from the final PR. No production tests or data writes.


### 20.14 Production release (2026-10-02) — supersedes earlier NOT APPLIED status

PR #399 is merged as e04eb16dc6fc70734f85868ab5235186d0ce4813. The production frontend is READY.
The exact reviewed policy migration is applied as version 20261002160849, with SQL SHA-256
15355717f39fe2cb6b33386334d785f672e167ea5774866322b262dcd9d551d5 (51,115 bytes).
Forward and rollback filenames are reconciled to that version without changing SQL contents.
Authenticated database-context reconciliation now confirms September 1–29 Policies Sold = 4,
daily chart = 4, and current-assignment agent counts 2 / 1 / 1. Private helpers and legacy seals
are verified; advisors were run. No customer rows or unrelated runtime behavior were changed.
Full release evidence, tested-head references and limitations are recorded in
docs/plans/2026-09-28-reports-analytics/POLICIES_RELEASE_2026-10-02.md.
Signed-in browser interaction is still unverified; old tabs should reload.


---

## §21. Team campaign lead visibility — display-only scope (October 2, 19:22 LA)

Chris clarified and approved: current Team leads show the existing full details grid without waiting for a call to connect; keep locking and ownership logic unchanged. The new manager review workflow and full-record access expansion are withdrawn from this release.

Implementation and release checks: `docs/plans/2026-09-29-team-campaign-visibility/implementation_plan.md`. Display-only changes retain canonical current-lock confirmation, stale-load masking, and existing Edit/Sold/Convert gates. No new RPC or Contacts read permission. Existing authorization may still limit master fields; retain the campaign-copy notice. The two earlier applied migrations remain recorded and are not rerun. Pending P2 and its frontend hook are removed. PR #401 is the narrowed review/release surface.


## §22. Floating dialer disposition agency scoping — APPROVED October 3, 2026

Chris explicitly approved the seven-file plan at 08:35 PDT for isolated implementation and verification. No publication, merge, deployment, or production mutation is authorized. Plan of record follows; approval supersedes its original awaiting-approval status.

# BUGFIX — Floating dialer disposition agency scoping

Date: October 3, 2026 (America/Los_Angeles)
Status: Proposed implementation; awaiting Chris's explicit approval
Repository: cgarness/agentflow-life-insure
Reviewed main: `40e0deaed008dafb3674235930bf7bb941546989`

## Outcome and authorization

The floating dialer will show the current agency's configured dispositions and conversion metadata. It will retain the existing layout, configured labels/colors/order, canonical disposition UUIDs, callback handling, conversion flow, and server-authoritative DNC persistence.

This document authorizes no implementation by itself. Chris requested the investigation and plan, and explicitly required approval before application edits or backend changes. This turn creates the review plan only. After approval, implement on an isolated branch and run local verification. Publication, merge, deployment, live customer calls, and production mutation remain outside this approval.

## Evidence and source review

- Reviewed repository rules, VISION.md, newest WORK_LOG.md entries, current FloatingDialer.tsx, disposition and pipeline services, disposition persistence, useOrganization, existing floating-dialer tests, and the current TwilioContext outbound path and guards.
- GitHub main still equals the reviewed local checkout. The source checkout was clean.
- `FloatingDialer.tsx` directly loads all RLS-visible dispositions and lead pipeline stages in two mount-only effects. Neither lookup has an organization filter; neither reports load failure.
- `dispositionsSupabaseApi.getAll(organizationId)` already requires an organization, filters explicitly, preserves configured order, and throws on query error. Its domain fields use camelCase.
- `pipelineSupabaseApi.getLeadStages(organizationId)` already scopes by organization and lead pipeline type and throws on query error. The new loader must require context itself because that service returns an empty array when organization is missing.
- Live read-only evidence collected in this conversation: Chris's home agency has six dispositions, with no duplicates. Other agencies have same-label rows. The live dispositions SELECT policy permits Super Admin cross-agency reads, so RLS cannot substitute for the missing UI query filter.
- The live `advance_campaign_lead` function resolves disposition UUID and actor organization together and raises "Disposition not found" on mismatch. Preserve this database protection.
- 1,669 home-agency calls with resolvable disposition IDs had zero foreign-agency references. This is a bounded reference audit, not proof of completeness or correctness of all historical outcomes.
- PR #402 shipped the DNC fix. WORK_LOG records migration 20261003043122, webhook v36, and frontend e5c15f7. The new plan does not revise those deployed database/telephony artifacts.

Source: https://github.com/cgarness/agentflow-life-insure/tree/40e0deaed008dafb3674235930bf7bb941546989

## Concurrent work

Open PRs checked: #398 underwriting, #383 leaderboard resilience, #382 containment records, #381 leaderboard work log, #378 Google OAuth, and #294 AI testing. Their retrieved changed-file lists do not overlap FloatingDialer or its disposition test. Several overlap shared documentation; #378 and #294 also touch root implementation_plan.md.

Preserve unrelated documentation byte content when adding this task. Recheck main, open changes, and the work log immediately before implementation and again before publication. This check does not establish the absence of unpublished work in other agents' workspaces.

## Implementation design

### 1. Load one complete, scoped configuration

Add `useFloatingDialerDispositions.ts`, kept under 200 lines where practical.

- Accept the resolved agency ID and authenticated user identity. No read occurs while either required context is absent.
- Reuse `dispositionsSupabaseApi.getAll` and `pipelineSupabaseApi.getLeadStages`. Do not modify those shared services.
- Adapt their returned objects to the existing floating-dialer field names and `isConvertedDisposition` shape. Preserve UUID, name, color, order, note requirements, callback flag, automation metadata, and pipeline-stage reference.
- Commit a configuration snapshot only when both reads succeed for the same current request and identity. A pipeline lookup error must never make Sold appear non-converting.
- Use an explicit request generation and scope identity. A superseded request, unmount, or A → B → A transition cannot publish an older result.
- Derive visible options synchronously from the current scope and snapshot identity. Waiting for an effect to clear old state is insufficient: there must be no render in which agency B sees agency A's options.
- Distinguish unresolved context, loading, valid empty configuration, error, and ready. Retry starts a new generation; repeated retry cannot let an older request overwrite it.
- No polling, storage persistence, new dependency, or global cache is required.

### 2. Integrate with the existing wrap-up

Replace the two unscoped effects in FloatingDialer with the hook.

- Keep the same two-column disposition grid.
- Show concise loading, empty, or failure text in the existing wrap-up area. Include a Retry action for failure/empty configuration.
- Derive selection validity from the active configuration identity, not just a matching label or UUID. Clear the previous selection when scope changes.
- Save & Close is enabled only for a ready, current configuration and a valid selected UUID, in addition to existing form requirements.
- Apply the same readiness/scope checks inside the save handler; a disabled button alone is insufficient.
- Bind pending wrap-up and conversion callbacks to the call's original user/agency context and call ID. A configuration switch must not retarget the old call to the new agency. Recheck context after asynchronous work before subsequent actions.
- Preserve wrap-up, notes, and the existing call ID after ordinary load/save failures in the same context. Do not expose an earlier user's draft after an account change. A changed identity blocks the pending save instead of reporting success.
- Keep canonical server persistence and PR #402's duplicate-save guard, idempotent call operation ID, conversion retry behavior, and success-only reset.
- Do not deduplicate by name or introduce hardcoded disposition lists.

No form fields are added. Existing validation behavior remains; if a form schema must change, use Zod. Use Tailwind for new UI. Preserve existing configured dynamic colors without a styling refactor.

## Exact proposed repository file list

| File | Proposed change |
| --- | --- |
| `src/components/layout/FloatingDialer.tsx` | Replace unscoped configuration effects, wire status/retry UI, and guard selection/save/conversion against stale scope. |
| `src/hooks/useFloatingDialerDispositions.ts` (new) | Scoped configuration loading, mapping, complete snapshot state, and request lifetime guards. |
| `src/hooks/__tests__/useFloatingDialerDispositions.test.tsx` (new) | Mixed-agency lookup and asynchronous scope/load/error regression coverage. |
| `src/components/layout/__tests__/floatingDialerDisposition.test.tsx` | Extend the existing real-component harness for scope, status, canonical-ID save, draft retention, callback, and conversion regressions. |
| `AGENT_RULES.md` | Add a short clarification under agency scoping: floating-dialer configuration must be explicitly scoped, including Super Admin, and stale configurations cannot save. |
| `implementation_plan.md` | Append this task and its approval/as-built record without replacing unrelated plans. |
| `WORK_LOG.md` | Add a newest-first implementation/verification entry after work is complete. |

Read/reuse only: `src/lib/supabase-dispositions.ts`, `src/lib/supabase-settings.ts`, `src/lib/dialer-api.ts`, `src/lib/dialer-disposition.ts`, `src/lib/report-utils.ts`, `src/hooks/useOrganization.ts`, and `src/contexts/TwilioContext.tsx`.

No migration, database function, RLS, Edge Function, package/lockfile, DialerPage, or TwilioContext edit is planned. Disclose any newly necessary file before editing it.

## Verification after approval

Use isolated synthetic fixtures with external boundaries mocked; never call customers or mutate production to verify this fix.

1. A Super Admin fixture exposes two agencies with identical names and different IDs/colors. Assert the actual service/query boundary applies organization filters to both configuration tables and that only the requested agency's rows reach the UI.
2. Cover missing organization, delayed resolution, user changes, A → B, A → B → A, out-of-order results, unmount, rapid retry, and stale errors after a successful newer result.
3. Test disposition failure, pipeline failure, valid empty results, retry recovery, and prevention of partial configuration use.
4. Verify configured IDs, labels, colors, order, note constraints, callback flags, and conversion references survive mapping. Do not test by name-only deduplication.
5. Verify both disabled-state and handler-level rejection of stale selection. No canonical RPC or conversion starts from unavailable or mismatched configuration.
6. Verify a successful selection submits its canonical disposition UUID and original call ID; save failure retains wrap-up and notes and retry creates no additional call.
7. Preserve and extend the existing Sold conversion-gate/retry test. Cover context changing while conversion is pending and stale conversion completion.
8. Cover the existing callback path, including responsible user/creator stamping, and retain DNC failure/replay tests. The appointment-scheduler feature gap below remains excluded.

Planned checks:
- Focused Vitest runs for the new hook and existing floating disposition suite.
- Existing `src/lib/dialer-disposition.test.ts`, `src/utils/dncCheck.test.ts`, and `src/lib/twilio-dnc-admission.test.ts`.
- `npx tsc --noEmit`.
- `npx tsc -p tsconfig.app.json --noEmit`; compare with the exact unchanged base because root tsc alone does not prove application typing.
- Targeted lint and `npm run build`.
- Review the diff to confirm no telephony, backend, dependency, or unrelated UI changes.

The latest work log reports 88 existing app TypeScript diagnostics versus an earlier baseline of 90. That is historical evidence, not this task's result; establish the actual same-base comparison after approval. Broaden testing only if these checks identify a concrete remaining risk.

## Preserved behavior and risks

- Browser Voice.js remains the outbound call initiator. TwilioContext continues to own call creation, re-entrancy, DNC admission, status handling, and lifecycle; Twilio webhooks own canonical duration.
- Database authorization remains authoritative. Frontend filtering is an additional correctness boundary, not replacement RLS.
- A failure to load either configuration source temporarily blocks disposition submission until Retry succeeds. This prevents an incomplete configuration from changing the interpretation of Sold.
- Existing pending-call protection must be preserved through asynchronous conversion and retries. Context changes may require returning to the original valid context; they must never silently move a draft or call between agencies.
- No disposition deletion, historical repair, name-based coalescing, or production cleanup is needed.

## Separate findings — not part of this approval

1. FloatingDialer loads and renders callback scheduling but omits `appointment_scheduler`; its Appointment Set button therefore lacks the main Dialer's scheduling parity. Fixing that adds workflow behavior and needs a separate task.
2. DialerPage's disposition list is scoped, but its separate `pipelineStagesConversion` query is unscoped and has an organization-independent query key. This is a related follow-up; this narrowly scoped plan does not edit the main Dialer.
3. The existing floating-dialer tests use mocks whose `.eq()` calls do not filter fixture rows. New tests must verify the actual scope behavior instead of allowing that mock to hide the defect.

## Context snapshot and approval

Changes made this turn: this review plan only.
Decisions: reuse scoped services; require complete current configuration; preserve layout and PR #402.
Migrations/deployments/production changes: none.
Verification: source and concurrency review completed; implementation checks not run because application edits await approval.
Blocker: explicit implementation approval required by Chris's FIRST step 4 and AGENT_RULES workflow §8.
Next: approve the seven-file implementation and isolated verification scope. Publication, merge, deployment, and any production mutation require their own explicit authorization.

### §22 as built — October 3, 2026

Chris approved implementation and isolated verification at 08:35 PDT. The seven-file implementation is complete on `codex/floating-dialer-agency-scope`, based on `40e0deaed008dafb3674235930bf7bb941546989`. No files beyond the approved list were changed in the candidate.

- New 85-line hook reuses both existing organization-scoped services, adapts their fields, waits for both results, and publishes only a complete current request snapshot. No dependency, shared-service, database or telephony change.
- Snapshot identity is checked during render and inside asynchronous continuations; account/agency/request changes immediately invalidate visible options and selection. Loading, valid empty, failure and Retry stay inside the existing wrap-up layout.
- Wrap-up is bound to the original call's user/agency. Foreign-context notes stay hidden. Pending conversion callbacks and subsequent save effects require the same current configuration and call. Ordinary persistence failures retain the call, draft and converted client for retry.
- Verification: all 54 focused tests pass across five files; no React act warnings/unhandled errors in the final run. The mixed-agency duplicate-button regression fails against the unchanged base and passes with the fix. Root tsc and build pass. App tsc retains exactly 88 base diagnostics after line/column normalization. Targeted lint has zero errors and the single pre-existing FloatingDialer dependency warning; build retains its existing large-chunk warning.
- Source and concurrency recheck: main is unchanged. Open PR code files do not overlap the floating-dialer changes; shared-doc merge conflicts remain possible. Preserve all unrelated work when eventually publishing.
- Scope review: PR #402's canonical persistence, DNC enforcement, Twilio re-entrancy/call creation/status/duration ownership and all backend files are unchanged. No production data/settings modifications, live calls, migration, Edge deploy, frontend deploy, or remote publication occurred.
- Appointment Set scheduling parity and DialerPage's separate conversion-stage query remain explicit follow-ups. No authenticated production-browser verification is claimed.
- Remaining authorization: publish branch/PR, then merge/release only after Chris's explicit approval. Implementation and local verification are complete; deployment is not complete.

### §22 release authorization — October 3, 2026, 09:00 PDT

Chris approved publishing the reviewed candidate, merging through its PR after checking results, and verifying the normal frontend production deployment. This supersedes the remaining-authorization statement above. The exact seven-file scope and all backend exclusions remain. Only this plan and WORK_LOG.md receive authorization/release evidence updates; no additional application files are planned. Record actual PR/check/deployment identities after observation, without claiming authenticated browser or live-call verification.

### §22 necessary verification correction — discovered in PR #404

The DNC CI runner stops before its assertions because `supabase/tests/dialer_dnc_upgrade.sql` still includes the authored migration filename `20261003022218`, removed when PR #403 reconciled the applied timestamp to `20261003043122`. Add exactly this eighth file to the implementation list before editing it: **supabase/tests/dialer_dnc_upgrade.sql**. Change only the include path to the existing shipped migration. This is a test-harness repair needed to execute the preserved DNC gate; no migration bytes, assertions, database schema, production state or application behavior change. The seven original files remain as listed above. Verify the complete DNC workflow on the new PR head; do not weaken its checks.

### §22 release closeout — October 3, 2026

PR #404 merged as `a6c01c2afa35bcfe4642d488df1ecee1bb5004bb` after all checks passed at `39d9c8e0c80d70ecf2f958f2f4de7cac2c121627`. Tested and merged trees match exactly (`cd3014dc28bddb82e1671a590b6fe00bb5e68d25`). DNC CI passed 486 tests plus real PostgreSQL transaction/concurrency/security/replay checks. The full frontend comparison passed with 4,002 passing candidate tests versus 3,981 on base, unchanged existing failures and 88 app type errors, zero unhandled errors; root tsc, Reports tests, lint and build passed. Both production Vercel projects are READY at the merge SHA. `www.fflagent.com` HTML and its served entry bundle returned 200 and contain the new configuration guards. Exact deployment IDs and limitations are in the newest WORK_LOG.md entry.

No migration, RLS/data change, Edge/telephony deployment or live call occurred. No authenticated production-browser verification is claimed. Scheduler parity and the main Dialer's separate stage reader remain out of scope. No release blockers; next step is refreshing existing tabs after calls end. Closeout changes only WORK_LOG.md and this implementation_plan.md, published through a documentation PR; all application and backend bytes remain at the verified release.

## §23. A2P registration — October 3, 2026

Chris approved implementation after the complete feature proposal. The isolated build, exact file list, provider prerequisites, verification, and production boundaries are recorded in `docs/plans/2026-10-03-a2p/implementation_plan.md`. No production registration, fee, migration, or deployment is authorized by this branch build.

### §23 production release authorization and backend verification

Chris approved applying the A2P migration, deploying the five backend functions, and merging PR #406 at 10:37 PDT on October 3. This supersedes the branch-only restriction above for those exact actions. Migration `20261003174429` and all five complete Edge bundles are deployed and verified; account configuration is empty and submissions remain disabled. Reconcile the migration filename/test reference without changing SQL bytes, append deployment evidence to the existing A2P docs/WORK_LOG/AGENT_RULES, rerun CI, and verify the frontend after merge. Twilio entitlement/mappings/fees, Event Streams and worker setup remain activation prerequisites; no paid registration or customer message is authorized.

## §24. Contact Details / Field Layout logical identity — October 3, 2026

Status: Chris explicitly authorized isolated branch implementation and verification in this task. No further proposal/approval pause for this build. Merge, deployment and production changes remain separately gated.

Base: main `84829dfe59e1da4d3ab5974bb1b763f5a886008c`, verified by fresh origin fetch. AGENT_RULES confirms production ref `jncvvsvckxhqgqvkppmj` (the alternate spelling in the request is incorrect); no production connection is needed. Open PR #407 (`codex/contact-history-20261003`, `dd6fd0dd`) changes this same Contact component's history/loading/save activity areas; retain main's implementation and verify local merge compatibility rather than pulling unrelated work into this branch. Other open PRs concern underwriting, leaderboard, OAuth and testing. Current source still has three overlapping custom render loops and physical-definition layout entries. Existing import normalization/representative selection, scoped getAll API, required validation, reserved metadata and save-policy helpers reviewed.

### Exact file list before application edits

- NEW `src/lib/contact-detail-fields.ts`: one deterministic, pure builder for standard/custom identity, placement, populated visibility and non-coercing editor metadata; reuse import-field-matching normalization and representatives. Keep each exact stored key separately, even case/space variants; exclude only exact reserved metadata. Active accessible definitions provide metadata/empty fields, never permission expansion. Preserve any required constraint across duplicate definitions.
- `src/components/contacts/FullScreenContactView.tsx`: render one list, exact-key custom reads/writes (including periods), populate-only viewing, complete permitted editing, preserve mismatched scalar/structured values and status/ownership positioning. Scope field configuration to current org/user/type at render time, reject late requests. Keep save/cancel/failure, columns, history, appointments and ownership controls.
- `src/components/settings/ContactManagement.tsx`: same builder for reorderable identities and standard-field registry; preserve physical-row custom administration and existing user/agency ownership; isolate Field Layout lifecycle across organization/user switches.
- NEW `src/lib/__tests__/contactDetailFields.test.ts`
- NEW `src/components/contacts/__tests__/fullScreenContactViewFieldVisibility.test.tsx`
- NEW `src/components/settings/__tests__/contactManagementFieldLayout.test.tsx`
- `implementation_plan.md` (append only), `AGENT_RULES.md` (document invariant), `WORK_LOG.md` (newest first).
- Necessary test-list adjustment: `src/lib/__tests__/clientCustomFieldsWriteGuard.test.ts` currently asserts FIVE literal guard calls and the three obsolete loops. Replace that structural assertion with a shared-builder wiring assertion plus behavioral reserved-key coverage; retain all write-boundary and policy-shape checks. No assertion will be removed merely to get a pass.

### Design and verification

Use synthetic ten-key fixtures with the audited duplication pattern, never personal/underwriting data. Saved order wins; repeated references collapse; supported standard fields and active custom fields append deterministically; stored values without a definition remain. Metadata disagreements use a non-destructive editor; no-op/unrelated edits preserve the entire bag and additional_policies. Definition-only grouping never renames JSONB keys. Preferences are never rewritten on open. Existing required standard checks remain; custom required constraints apply to the logical group without requiring duplicate aliases.

First add a mounted regression and run it against unchanged application code. Then cover one/three definitions, lead/client/recruit, populated/empty/0/false, unknown/inactive fields, repeated/stale layouts, variants, metadata conflicts, no-op/unrelated saves, cancel/failure/required guards, Admin/Agent and scope changes. Run existing import/layout/save/reserved suites and Contacts/deep-link entry tests. Run root tsc, actual app tsc against exact base, scoped lint and production build. Run desktop/narrow-screen browser with disposable synthetic fixture boundaries; no production network or synthetic production rows. Record pre-existing failures separately. Recheck main and PR #407 overlap before final commit. This plan preserves all unrelated existing bytes above.

### §24 verification adjustment and concurrent release integration

Before expanding tests: also edit `src/pages/__tests__/contactsFullScreenDuplicateParity.test.tsx` and `src/pages/__tests__/contactDeepLinkDuplicateParity.test.tsx`. The former currently replaces Contact Details with a recorder; retain those existing parent contract tests and add opt-in real-component fixture coverage for all three contact types. Add the equivalent field-preservation case to the latter's already-real page/component/API mount. This closes the composed entry-point verification gap without changing either application page.

PR #407 and its documentation closeout #408 merged during verification. Rebased this branch onto fresh main `c8b3a682f701a6421ba7439288f87b1e7d33b80f`; the field changes apply cleanly and the shipped history loaders, Activity refresh, appointment and contact-save paths remain intact. Re-run focused/history verification and app type comparison against this current base before committing.

Before the final test adjustment: also edit `src/components/contacts/__tests__/fullScreenContactViewScore.test.tsx`. Its existing read-mode test requires a DOB label although the fixture has no DOB. Update that single obsolete expectation to the approved populated-only viewing behavior, and positively assert the empty DOB editor remains available. Keep every Score-hiding and populated-field assertion intact. The initial expanded run found exactly this behavior-change failure (460 passed, 1 failed, 3 existing skipped); no production implementation is changed to satisfy an obsolete visibility expectation.

### §24 as built — branch implementation; browser gate outstanding

- Final base: `c8b3a682f701a6421ba7439288f87b1e7d33b80f` (includes shipped Contact history #407 and closeout #408). Branch: `codex/contact-detail-field-identity`. Exactly 13 planned/documented files: 3 application, 7 tests, 3 project documents. No dependency/config/backend/import/telephony file changes. Unrelated untracked A2P-wizard planning files are excluded.
- One shared projection replaces all three renderer paths and physical-row Field Layout construction. Exact JSONB keys (including dots and standard-field names), 0/false, unknown/inactive values, case/space conflicts, legacy amounts/dates/options, required group constraints and reserved metadata are retained. Legacy structured non-reserved values are displayed read-only. Order/visibility aliases resolve without writes on open. Role/ownership controls remain; current agency/user field snapshots replace stale ones.
- Mounted duplication regression fails against BOTH unchanged audit base `84829dfe` and unchanged current base `c8b3a682`: one definition produces two displays; three definitions produce four. Both pass with this branch. All fixtures are synthetic.
- Final focused run: **26 files pass, 461 tests pass, 3 existing timezone-conditional scheduling tests skip under UTC**. Separate `TZ=America/Los_Angeles` scheduling run: **18/18 pass**, including those three. Thus every one of the 464 distinct selected cases ran successfully in its supported timezone. New helper/renderer/settings coverage plus real Contacts-page/direct-link composition tests pass for leads, clients and recruits; existing import matching/create/import UI, field layout, save-integrity/refusal/duplicate/status, reserved-policy, schedule, Quick Call, score exclusion, Conversation/Activity/history suites pass. No failed test or unhandled error remains in these runs. The existing status-save suite emits React act warnings; no assertion was suppressed.
- Root `npx tsc --noEmit`: exit 0 (the existing root config is not an application check). Actual `npx tsc -p tsconfig.app.json --noEmit`: 88 diagnostics on current base and 88 on candidate, identical diagnostic multiset after removing line/column offsets. Earlier audit-base comparison likewise matched at 88. No new diagnostic; repository is not globally type-clean.
- Scoped ESLint: 0 errors, same 10 pre-existing warnings as base. `npm run build`: exit 0, production assets generated; existing Browserslist-age and large-chunk notices remain. `git diff --check`: pass.
- Test adjustments retain all contract assertions: obsolete five-loop structural checks now pin shared reserved-safe projection wiring plus behavioral coverage; the old blank-DOB visibility assertion now proves hidden in viewing and available in editing; composed entry-point tests extend existing parent save tests without replacing them.
- **Browser NOT verified.** An isolated Vite fixture was prepared outside the repo with synthetic data and service boundaries. Agent-browser cannot start its daemon; direct Chromium cannot create its local socket (`Operation not permitted`); browser tool navigation to localhost is blocked (`ERR_BLOCKED_BY_CLIENT`). The escalation request was automatically rejected because sandbox approvals are disabled. No desktop/narrow screenshot, authenticated walkthrough or production data verification is claimed. Do not mark ready for production approval until desktop and narrow-screen fixture checks (view/edit/save/cancel and layout reorder/save/reopen) can run in a permitted browser environment.
- No merge, push, deployment, production record/definition change, database connection, migration, RLS, Edge, telephony or import change occurred. Correct production project remains `jncvvsvckxhqgqvkppmj`; the request's alternate spelling was not used. Branch is reviewable; browser gate and separate production authorization remain.

### §24 release authorization and CI compatibility

Chris reviewed the hosted preview and approved release at 14:35 PDT on October 3. This supersedes the branch-only/no-release status above for this exact frontend fix. PR #410 targets current main c8b3a682; remote a41f4630 has exactly the tested local tree 534a0237c14c30617addea062def894cb44a6f6b. Preview dpl_FDi9S7bUWDwbrBM2zADup1d46jyS is READY. The preview loads in the hosted browser; Chris reported it looks good. No completed automated desktop/narrow walkthrough is claimed.

The existing CI compares raw TypeScript locations. Adding the builder import moved an existing MappableCustomField.active diagnostic from ContactManagement line 528 to 529; remove one extra blank line above it so the unchanged error retains its original location. This is whitespace only, not a weakened check or behavior change. Keep the 13-file scope; record release evidence in these existing documents. Merge only after the normal frontend/DNC/A2P gates pass. No database, definitions, RLS, Edge, import or telephony changes authorized.

### §24 production release closeout

Closeout scope: only AGENT_RULES.md, WORK_LOG.md and this plan; preserve all runtime/test/configuration bytes and all previous document bytes. Chris accepted the preview and approved the release. PR #410 merged as `fbce826377dc993e574934ef713d151eaa01d9c6` from green head `a08cc66c17c45a990ce7da00f2c270bc906f5cc7`; exact tested/merged tree `be2b99ec4019a95ee3aa047f891ff493d5d9279d`.

Full frontend run `37155866517` passes: 4,091 passing candidate tests vs 4,039 base; same one pre-existing failed test and 11 failed files (10 setup/configuration-dependent suites plus recording-retention failure); identical 88 raw app TypeScript diagnostics; zero unhandled errors; root tsc, Reports tests, scoped lint and build pass. DNC run `37155866523` and A2P run `37155866491` pass. Focused 464-case coverage and owner preview acceptance remain as recorded above; no automated desktop/narrow pass is claimed.

Production primary `dpl_FqDf3qezc99Agret25wgFCHutruW` and secondary `dpl_6msRSgs2i7uhYSTXaLq9JUCPDAsP` are READY at the merge SHA, production target. Primary serves www.fflagent.com / fflagent.com. Both domain HTML and entry assets returned HTTP 200; both contain the field-settings guard and preserved contact-history reader. Assets: primary `index-DaPV_ZqG.js` (SHA256 `2ef2b0c1a47c2c3412db14c01a4db8219d152afcffcfe44720fbe0314fc6dfa4`), secondary `index-DzC2gzDN.js` (`918d10f4edeaecbb6862d1189329fe262815290e54753e932cb817b141a0ed8a`).

Implemented, reviewed, merged and deployed. No production data/definitions, database connection, migration/RLS, Edge, telephony, import processing or customer call/message change occurred. No signed-in production walkthrough or automated narrow-screen visual acceptance is claimed. Existing loaded tabs need a refresh after active calls end.


## October 8 SMS activation authorization

Chris instructed getting SMS working after A2P approval. The prepared backend release and guarded mapping are now applied with sending/relay paused. Complete secret provisioning, authenticated recovery, five-number registration and controlled consenting-recipient verification before activation. Earlier pending-approval notes describe the previous phase.
