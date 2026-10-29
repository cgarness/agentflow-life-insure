# Dashboard Premium Redesign + Client Milestones — Implementation Plan

**Date:** 2026-10-29 · **Branch:** `claude/great-clarke-c1gpw6` · **Base:** `main` `2a18e263`
**Mode:** FEATURE / REFACTOR · **Status:** **G1 APPROVED with revisions (rev 1, below)** — frontend implementation on
the feature branch only. G2 package prepared as files only; no database change executed. No merge, no deploy.

## Rev 1 — Chris's G1 approval adjustments (2026-10-29; supersede anything below that conflicts)

| # | Adjustment | Resolution in this plan |
|---|---|---|
| R1 | First Payment Reminders start 3 days before the existing Draft Date and stay pending until reviewed. No historical overdue reminders. Existing clients with valid future Draft Dates stay eligible. | §6.1 rule rewritten. "Historical" means a Draft Date before the **reminders start date** (the production go-live date, configured at release). It also covers a client entered after go-live whose Draft Date had already passed. Every client with a Draft Date on/after go-live is eligible, including clients created long before go-live. |
| R2 | Address the Team Leader widget/modal scope inconsistency. No permission or RLS change without separate approval. | New §2A. **A detail modal always uses the scope of the surface that opened it.** List-widget modals use the widget rule; KPI-card modals use the KPI rule. Implemented in one shared resolver, with no permission or RLS change. A Team Leader in Team perspective sees a visible "your own items" note on list surfaces. |
| R3 | Remind Later must allow follow-up after an anniversary date (Tomorrow / In 3 Days / Next Week). | §6.5: all three options are always offered. A snoozed birthday or anniversary **resurfaces at its reminder time even after the date has passed**, as a "Follow-up", until it is reviewed or snoozed again (D8 revised). |
| R4 | Large client datasets must never silently appear complete when truncated. | §6.6: exact-count paging. Completeness is decided by the server's exact count, never by page length, so a smaller server row limit cannot hide rows. Any shortfall marks the result **incomplete**, the UI says so, and counts read "at least N". Preview lists that are capped by design (Schedule 8, Missed Calls 5) say they are previews. |

D1–D14 otherwise accepted as recommended, with D8 revised by R3 and D10 replaced by R2.

## Implementation status (2026-10-29, branch only — not merged, not deployed)

**Done on `claude/great-clarke-c1gpw6`:** the G1 frontend (§4–§8 with rev 1) and the G2 package as files.

**G2 (approved for the exact file) is NOT applied:**
- Two MCP `apply_migration` calls timed out on an unanswered Supabase confirmation. Production was read back
  unchanged after each.
- The cloud session has no Supabase authentication and no network route to production.
- `supabase db push` is unsafe because of history drift.
- The proposed authorized route, a protected dispatch-only workflow, is designed for separate review in
  `g2-release-workflow-design.md` (beside this plan).

**Deviations from the plan, and why:**
- **No rank medallions on the Leaderboard widget.** `leaderboardWidget.test.tsx` pins an approved rule: "no
  award-style decoration of any kind inside the standings rows" (no SVG, trophy, medal or star). The widget gets the
  gold tone, an accessible segmented control and gold "View Full Standings" only.
- **`src/integrations/supabase/types.ts` is NOT modified.** The table and RPCs do not exist yet. The data layer uses
  the narrow `(supabase as any)` cast the repository already uses for ungenerated objects. Regenerate the types after
  G2 is applied.
- **Migration path:** `supabase/migrations/pending/20261029120000_dashboard_milestone_reviews.sql`, not
  `supabase/migrations/`. This is the repository's convention for unapplied migrations, so no merge or preview can
  apply it. Rollback: `supabase/migrations/rollback/20261029120000_dashboard_milestone_reviews.rollback.sql`.
- **Release switches are Vercel environment variables, not a code constant:** `VITE_DASHBOARD_MILESTONE_REVIEWS` and
  `VITE_FIRST_PAYMENT_REMINDERS_START` (`src/lib/dashboard-milestones-config.ts`, fail-closed).
- **Extra small modules** keep components under 200 lines and keep non-component exports out of component files:
  `src/lib/calendar-date.ts`, `src/components/dashboard/ui/dashboardWidgetMeta.ts`,
  `src/components/dashboard/ui/DashboardScopeNote.tsx`, `src/components/dashboard/dashboardRecordText.ts`,
  `src/components/dashboard/milestones/milestoneCopy.ts`. `DashboardStatusPill`, `DashboardEmptyState` and the row
  skeleton live in `ui/DashboardListRow.tsx` instead of their own files.
- **Rows use a CSS fade** (`animate-in fade-in-0`, `motion-reduce:animate-none`) instead of framer-motion. The
  remaining framer uses sit under `<MotionConfig reducedMotion="user">`, and the Goal Progress bar honours
  `useReducedMotion()`.
- **Found and fixed during verification:**
  1. Radix restores focus only to a `Dialog.Trigger`, and these modals are opened from code, so focus fell to
     `<body>` on close. That affected the old Callbacks modal too. `DashboardModalShell` now returns focus to the
     element that opened it.
  2. A review stored from the detail view did not refresh the widget behind it. A
     `agentflow:client-milestones-changed` event now reloads the widget through its section lane.
  3. A server that ignored the keyset filter could make the paged read loop. `readAllExact` now stops and reports
     incomplete when a page adds nothing new.
- **Missed Calls in the detail modal:** a Call back button is shown, but it is enabled only when the row's contact
  type resolves. Most `calls.contact_type` values are NULL (§5), and the modal does no contact lookup, unchanged.

**Approval gates (each separate):**

| Gate | What it approves | Touches |
|---|---|---|
| **G1** | This plan + the frontend work in §5–§8 on this branch | Frontend, tests, docs |
| **G2** | The milestone-review migration in §9 (**schema + RLS — STOP point**) | Database (new table, 2 RPCs) |
| **G3** | Merge to `main` (Vercel production build) after CI and verification | Release |

G1 can proceed without G2. The milestone **review actions** (Mark Reviewed / Remind Later / Undo) need G2;
see §10 for how the branch behaves until G2 is applied.

---

## 1. Preparation done (read-only)

- Read `AGENT_RULES.md` (§3 tenancy, §5 schema gotchas, §7 component standards, §8 workflow, §10 forbidden,
  invariants #22 callbacks / refresh lanes, #23 leaderboard request discipline, #34–#35 book of business and
  `additional_policies`, #40 policy identity, #42 Sold Date, lead→client conversion preservation), `VISION.md`,
  `WORK_LOG.md`.
- **Work Log conflicts:** the two newest entries (2026-10-28) are Google Sheets only (`src/components/settings/google-sheets/*`,
  Sheets migrations). No overlap with any Dashboard file. No open Dashboard branch is recorded.
- **Live migration history (metadata only, `list_migrations`, no tenant data read):** head is
  `20261028040215_standard_lead_fields`. `20261021200000_lead_client_conversion_preservation` **is applied**, so
  `clients.date_of_birth` exists in production. The AGENT_RULES heading for that section still says "NOT applied" —
  stale; corrected in the doc commit of this work (§11). There is **no** table for per-user dashboard acknowledgments.
- Audited: `src/pages/Dashboard.tsx` (705 lines), all 7 widgets, `DashboardDetailModal.tsx` (876 lines),
  `DashboardCallbacksModal.tsx`, `DashboardSectionNotice.tsx`, `StatCards.tsx`, `useDashboardSection`,
  `dashboardRefresh`, `dashboard-callbacks`, `dashboard-contact-identity`, `local-calendar`,
  `profile/normalized-policy.ts`, `client-policy-display.ts`, `dobUtils.ts`, `index.css` tokens, the 14 dashboard
  test files, and the `notifications` / `user_preferences` / `campaign_lead_agent_suppressions` DDL.

## 2. Defects found during the audit (fixed by this work)

**Client Milestones (current "Anniversaries")**
1. `DashboardDetailModal.tsx:335-379` includes **lead** birthdays (`leads.date_of_birth`). The spec says clients only.
2. `DashboardDetailModal.tsx:350-357,381` ignores both query errors (`birthdaysRes.error`, `policiesRes.error`):
   a failed read renders "No records found". That breaks the invariant #22 rule that a failure is never a valid empty.
3. `DashboardDetailModal.tsx:411` labels anniversaries "Upcoming **Renewals** (90 Days)" (mislabel; spec forbids).
4. `AnniversariesWidget.tsx:49` and `DashboardDetailModal.tsx:382` parse `effective_date` (`YYYY-MM-DD` text) with
   `new Date(...)`, i.e. as **UTC** midnight. In every US zone that is the previous local day, so anniversaries are
   computed a day early.
5. `AnniversariesWidget.tsx:55` compares this year's local-midnight anniversary with the **current instant**, so
   an anniversary falling *today* is pushed to next year after 00:00. "Today!" can never show.
6. Neither path excludes the effective date itself: a policy effective in 12 days is shown as an "anniversary".
7. Only the primary policy's `clients.effective_date` is read; additional policies
   (`custom_fields.additional_policies[].effectiveDate`) are ignored. Clients with no policy evidence (CSV-import
   phantoms, AGENT_RULES #34) are counted.
8. The clients read is unbounded and silently truncates at PostgREST's row limit.

**Presentation / accessibility**
9. Widget headers that open a modal are a clickable `<div>` (`Dashboard.tsx:637-641`): no role, not focusable,
   no keyboard activation. Edit-mode drag and hide buttons have no accessible name (`Dashboard.tsx:154-176`).
10. The generic detail modal (`DashboardDetailModal.tsx:691-873`) is a custom overlay: no `role="dialog"`, no focus
    trap, no Escape, no focus return. Rows are clickable `<div>`s (`:781-787`). The "Start Call" button is
    `opacity-0` until hover (`:814`), so keyboard and touch users cannot see it.
11. A failed modal load says "Close and reopen to try again" (`:762`); there is no Retry button (Callbacks has one).
12. Modal header colors fall back to `primary` for Missed Calls, Anniversaries and Premium (`:718-723`), so they do not
    match the category colors.
13. Inline styles, which the Tailwind-only rule forbids: `CallbacksWidget.tsx:180-183` (dot color) and
    `GoalProgressWidget.tsx:67` (shimmer size).
14. Goal Progress bar colors contradict the category system. Appointments is drawn amber and Premium violet
    (`GoalProgressWidget.tsx:183-199`); they should be purple and gold.
15. Animations ignore `prefers-reduced-motion` (no `MotionConfig`, no `motion-reduce:` variants anywhere on the Dashboard).
16. Body text is mostly 10 px bold uppercase metadata, which is hard to read. Several `*-500` text colors on white
    fall below AA contrast (pink-500, amber-500).

## 2A. Team Leader scope consistency (rev 1, R2)

**Today's rules (audited):**

| Surface | Rule | Team Leader in Team perspective |
|---|---|---|
| KPI cards (`useDashboardStats.ts:45`) | `getDataScope("reports") === "own" \|\| perspective === "my"` → server RPC `get_performance_summary` (own/team, downline resolved **server-side**) | team (server-scoped downline) |
| Callbacks / Schedule / Missed Calls / Anniversaries widgets | `role !== "Admin" \|\| perspective === "my"` → own filter, else unfiltered | **own** |
| `DashboardDetailModal` (every type) | the KPI rule | **unfiltered** (whatever RLS returns) |

So a TL in Team perspective sees their own callbacks / missed calls / anniversaries in a widget, but clicking the
header opens a modal showing RLS-bounded rows. For `campaign_leads` and `calls` those rows are not necessarily
the TL's downline. The Schedule widget (own, today) opens the performance Appointments modal (server team), a
different set again.

**Resolution — principle: a detail modal uses the scope of the surface that opened it.**
- New `src/lib/dashboard-scope.ts`:
  - `kpiScopeIsFiltered(reportsScope, perspective)` — the existing KPI expression, unchanged.
  - `listScopeIsFiltered(role, perspective)` — the existing widget expression, unchanged.
  - `dashboardScopeNote(role, perspective)` — the disclosure text.
- `DashboardDetailModal` gains `origin: "kpi" | "widget"`. Dashboard passes `"kpi"` from a card click and
  `"widget"` from a widget header or "View all".
  - `origin="widget"`: list feeds (callbacks, missed calls, milestones) and the Schedule-opened Appointments modal use
    the **widget rule**. Performance modals pass the corresponding `own` / `team` mode to `get_performance_details`,
    which is still server-scoped.
  - `origin="kpi"`: the KPI rule, exactly as today, so a KPI card and its modal always agree.
- **No permission, role, RLS or RPC change.** The only behavior change: a TL's widget-opened list modal in Team
  perspective now matches the widget (own) instead of showing RLS-bounded rows. That narrows the view; it never
  widens it.
- **Disclosure:** for a Team Leader in Team perspective, list widgets and their modals show "Showing your own
  {items}. Team lists for this section aren't available on the Dashboard yet." Team totals stay in the KPI cards.
- **Follow-up (needs separate approval, not started):** true downline lists on these widgets through the audited
  resolver (`usersSupabaseApi.getAgentScopeIds`, query-enforced, fail-closed), which requires changing the protected
  `dashboard-callbacks.ts` contract.

---

## 3. Constraints carried into the design

- **KPI cards untouched.** `StatCards.tsx` gets no edits, including its own `hover:-translate-y-1`. Click-to-modal
  wiring is unchanged.
- **Layout and customization untouched.** Grid (`grid-cols-1 lg:grid-cols-2`), dnd-kit sortable edit mode,
  hide/restore, Save/Reset, and `user_preferences.settings.dashboard_widget_order/hidden` keys are unchanged.
  The persisted widget key stays **`anniversaries`**; only its label changes to "Client Milestones". This follows
  the `appointments` → "Schedule" precedent (D6 of an earlier build). The section lane key also stays `anniversaries`.
- **Data contracts untouched:** `dashboard-callbacks.ts` (dual source, ownership, paging after merge, request lifetime),
  `dashboard-contact-identity.ts`, `get_performance_details`, the leaderboard request gate, `useDashboardSection` lanes,
  Refresh tracker, and stale/failed/offline notices. Callback rows keep `__rowKey` (source-qualified) and contact
  identity separate.
- **Pagination / loading / error behavior preserved:** request generations, the pagination lock, page size 20, the
  scroll trigger and the callback "Load more" all move without change. Retry is *added* where only "close and reopen"
  existed.
- Tailwind only, Zod for new forms/inputs, `.maybeSingle()` for zero-or-one reads, no mock data in production paths,
  no service role or secrets in the browser.

---

## 4. Visual system (shared, Tailwind-only)

### 4.1 Category tones — one source of truth

New `src/components/dashboard/ui/dashboardTones.ts`: a map of **literal** Tailwind class strings (so JIT keeps them).
Each tone has an icon chip gradient, a soft surface, a border, accessible text (`600` light / `400` dark), a
focus ring, a status pill and a left accent bar.

| Tone | Used by |
|---|---|
| **blue** | Callbacks widget/modal, Calls Made modal |
| **purple** (violet) | Schedule widget, Appointments modal |
| **green** (emerald) | Goal Progress widget, Policies Sold modal |
| **gold** (amber) | Leaderboard widget, Annual Premium modal |
| **red** | Missed Calls widget/modal |
| **pink** | Client Milestones widget/modal |

This replaces `WIDGET_COLORS` in `Dashboard.tsx` and the hard-coded ternaries in `DashboardDetailModal.tsx`. The
existing `premium-gradient-*` CSS classes remain for StatCards; no `index.css` change.

### 4.2 Shared building blocks (`src/components/dashboard/ui/`)

| Component | Purpose |
|---|---|
| `DashboardWidgetFrame` | Card shell used in both grid modes. Header has a tone icon chip, title, optional count badge, and an explicit **"Open details" button** (`aria-label="Open Callbacks details"`) instead of a clickable div. Edit-mode drag handle (`aria-label="Reorder …"`, dnd-kit keyboard sensor kept) and hide button (`aria-label="Hide … widget"`). Consistent `rounded-2xl`, `border`, `px-5 py-4` header, `p-5` body. |
| `DashboardListRow` | One row primitive: 40 px leading icon/avatar, title (`text-sm font-semibold`, truncates), meta line (`text-xs text-muted-foreground`, readable, not 10 px uppercase), status pill, actions slot. `focus-within` tone ring. On narrow screens actions wrap under the text (`flex-wrap`, `sm:flex-nowrap`); tap targets ≥ 36 px. |
| `DashboardStatusPill` | Tone + neutral variants, text always present (never color-only). |
| `DashboardEmptyState` | Icon, sentence, optional action. Used only after a **successful** empty read. |
| `DashboardRowActions` | Primary visible button (e.g. Call) plus a Radix `DropdownMenu` "More actions for {name}". Arrow keys, Escape, focus return and typeahead come from Radix. Disabled items show the blocked reason. |
| `DashboardModalShell` | Radix `Dialog` (focus trap, Escape, `aria-modal`, focus return, labelled title/description). Tone header, optional summary chips, toolbar slot (filters + search), scrolling body that keeps the existing `onScroll` pagination, footer "Showing X of Y loaded" + Load more / Retry page / Close. `max-h-[min(90dvh,780px)]`, full-width sheet-like on mobile. |
| `DashboardFilterChips` | Toggle buttons (`aria-pressed`) with counts. "Filters apply to loaded records" when the list is paginated. Search input with `aria-label`. |

### 4.3 Motion

- `<MotionConfig reducedMotion="user">` wraps the Dashboard page and each modal shell. With reduced motion,
  framer-motion drops transforms and keeps opacity.
- Entry animation: 150 ms fade/4 px slide, stagger capped at the first 6 rows. No `whileHover` translations.
- CSS: `motion-reduce:animate-none` on skeletons/spinners, `motion-reduce:transition-none` on hover transitions.
- Goal Progress bar fill animates width only when motion is allowed. The shimmer moves to a Tailwind arbitrary
  value class and is disabled under reduced motion.

### 4.4 Theming

Every surface uses semantic tokens (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`) plus
tone classes with explicit `dark:` variants. Verified in both themes (§12).

---

## 5. Widgets (presentation only — queries unchanged)

| Widget | Changes |
|---|---|
| **Callbacks** (blue) | Shared rows. Overdue / Due today / Due soon group headers use Tailwind dot classes (no inline style). Row meta: due time, source chip ("Campaign" / "Follow-up"), one-line note. Actions: **Call** (existing guard) and **View contact** (existing `contactsTabFor`; disabled with `blockedReason`). "View all N callbacks" opens the **Callbacks modal** instead of navigating to `/contacts` (D11). Page size 15, the exact total, and the shared contract are unchanged. |
| **Schedule** (purple) | Time block + contact/title + type pill + status pill (text labels). Row action "Open in Calendar" (existing `/calendar` target) as a real button. Empty state and "View full calendar" kept. The query (`user_id` workload, half-open day) is unchanged. |
| **Goal Progress** (green) | Bars use category tones (calls blue, policies green, **appointments purple**, **premium gold**). `role="progressbar"` with `aria-valuenow/min/max` and a percent label. The "Unavailable" premium state and the unknown-premium note are kept. |
| **Leaderboard** (gold) | Gold tone. #1–#3 rank medallions. Agency/Group toggle becomes a segmented control with `aria-pressed`. No score rendered (unchanged). All gate, stale, offline and maintenance states are untouched. |
| **Missed Calls** (red) | Rows show the outcome-label pill, relative time and voicemail player (kept). Actions: **Call back** (existing guard) and **View contact** when the contact type is resolved. Query/scope (`buildMyMissedCallsOrFilter`) unchanged. |
| **Client Milestones** (pink) | Replaces `AnniversariesWidget` — see §6. |

---

## 6. Client Milestones

### 6.1 Categories and rules

All calendar math uses **calendar dates** (`YYYY-MM-DD`), never `new Date("YYYY-MM-DD")`. "Today" is the
**browser-local** calendar date, consistent with the Schedule and Callbacks widgets (`local-calendar.ts`) (D5).
Windows are inclusive day counts from today.

| | **Client Birthdays** | **Policy Anniversaries** | **First Payment Reminders** |
|---|---|---|---|
| Icon | `Cake` | `CalendarHeart` | `Wallet` (D13) |
| Source | `clients.date_of_birth` only (text; parsed with `parseDOB`, any stored format). **Leads never queried.** | Every policy from `getClientPolicyDisplay` → `normalizeClientPolicies` (primary + additional, the existing model) with a valid `effectiveDate` | `clients.draft_date` (client-level only) |
| Window | today … +14 days (widget and modal) | widget today … +30; modal today … +90 | appears at draft − 3 days; **stays pending until reviewed** |
| Recurrence | annual | annual, **years ≥ 1 only** (the effective date itself is never an anniversary) | **one-time per client**, never monthly |
| Feb 29 | observed Feb 28 in non-leap years (D4) | same | n/a (a real date) |
| Row text | "Birthday · Nov 3 · turns 66" (age only when the birth year is valid) | "1-year policy anniversary · Nov 12 · Final Expense · Carrier" — **never "renewal" or "expiration"** | "First draft in 3 days · Nov 5" / "First draft today" / "Draft date was Nov 5 — not yet reviewed" |

**First-payment eligibility (D3, revised by R1)** — all must hold:
1. `draft_date` (the existing client Draft Date) is a valid ISO calendar date.
2. **Not historical at go-live:** `draft_date ≥ reminders start date`.
   - The start date is the production go-live date, set at release through
     `VITE_FIRST_PAYMENT_REMINDERS_START=YYYY-MM-DD`. This follows the house Vercel-flag pattern
     (`VITE_GOOGLE_SHEETS_MAPPING_V2`).
   - Launch therefore creates no overdue reminders for Draft Dates that had already passed.
   - Every client, however old, whose Draft Date is on/after go-live **is eligible**.
3. **Not historical at entry:** `draft_date ≥` the client's local creation date. This only matters for clients
   entered after go-live; for older clients it is implied by rule 2.
4. **Visible from `draft_date − 3` calendar days, and pending until reviewed.** It never expires by itself and never
   repeats monthly.
5. No `first_payment` review row exists for (user, organization, client), whatever its date. This makes it one-time:
   Draft Date is documented as "the next scheduled draft" (AGENT_RULES, commissions §), so a later edit of the date
   must not re-arm a reviewed reminder.
6. Fail closed: if reviews are not enabled (G2 not live) or the start date is missing or invalid, the First Payment
   category is **not shown at all**. It never shows without a way to clear it.

The reminder never says paid, missed, failed or late. It does not use additional policies and does not invent
per-policy payment dates.

**Policy set (D6):** the normalized model counts a primary policy only with policy evidence (AGENT_RULES #34).
So a client that has `effective_date` but no carrier, number, premium, face or sold date **no longer** shows an
anniversary — a deliberate behavior change. A malformed `additional_policies` container is never read as a policy;
it is counted and disclosed ("1 client has additional-policy data that couldn't be read").

### 6.2 Event identity (for review state)

| Kind | `event_key` | `occurrence_year` | Match rule |
|---|---|---|---|
| `client_birthday` | `birthday` | year of the observed birthday | same kind/client/key/year **and** stored `occurrence_date` = computed date |
| `policy_anniversary` | the policy's stored identity (`clients.primary_policy_id` / additional `policyId`). A legacy primary without one → `primary`. A legacy additional entry without `policyId` → review actions disabled with a reason (D7). | year of the anniversary | same as birthday |
| `first_payment` | `first_payment` | year of the draft date when reviewed | any row for the client (one-time) |

If a stored date no longer matches (DOB or effective date edited), the item is pending again; the next action
overwrites that year's row.

### 6.3 Widget

- Header: "Client Milestones" (pink) with a pending count and "Open details".
- Category chips with counts (All · Birthdays · Anniversaries · First payments) filter the list (`aria-pressed`).
- Up to 6 pending rows. First-payment reminders whose draft date has passed sort first, then by date. Snoozed and
  reviewed items are hidden.
- Row: category icon chip, client name, rule text, a relative-date pill ("Today", "Tomorrow", "In 5 days").
  Primary **Call** button (`dispatchQuickCall`, type `client`, error when no phone). **More** menu: View contact,
  Mark reviewed, Remind later ▸ (Tomorrow · In 3 days · Next week), each with helper text "Only hides this reminder
  for you. The client record isn't changed."
- Empty: "No upcoming client milestones" + "Birthdays appear for clients with a date of birth on file."
- Failure / offline / stale: the existing `DashboardSectionNotice` / `DashboardSectionUnavailable` with label
  "client milestones".

### 6.4 Modal (`DashboardMilestonesModal`)

- Pink shell. Description: "Birthdays: next 14 days · Anniversaries: next 90 days · First payments: from 3 days
  before the draft date until reviewed".
- Filters: category chips + status chips (**Pending · Snoozed · Reviewed**) + search. The list is a single complete
  load (as anniversaries are today), so counts are exact. If the clients read hit the cap, they are marked
  incomplete instead (§6.6).
- Snoozed rows show "Reminds you {date}". Reviewed rows show "Reviewed {date}". Both have **Restore** (= Undo).
  Pending rows have the full action set.

### 6.5 Actions and their integrity

| Action | Effect | Never does |
|---|---|---|
| Call | `dispatchQuickCall` (existing canonical path); reports only a call that actually started | — |
| View Contact | `/contacts?contact={id}&tab=Clients` | — |
| Mark Reviewed | RPC upsert → state `reviewed` for (user, org, kind, client, event_key, year) | change `clients`, policies, wins, tasks, notifications |
| Remind Later | RPC upsert → state `snoozed`, `remind_at` = local start of day +1/+3/+7 (DST-safe `startOfLocalDayPlus`). **All three options are always offered (R3)**, including after a birthday or anniversary date. A snoozed annual occurrence resurfaces at `remind_at` even when its date has passed, labelled **"Follow-up · anniversary was Nov 12"**, and stays until it is reviewed or snoozed again. The server allows `remind_at` up to 31 days ahead. | — |
| Undo / Restore | RPC delete of **this user's row**, conditional on the `updated_at` the action returned, so an Undo can never erase a newer action from another tab | — |

- Every write is awaited. The row leaves the list only after the server confirms one affected row; zero rows is a
  failure. On failure: an error toast, and the row stays pending (no optimistic fake success, no local-only state).
- After success: a Sonner toast "Marked reviewed — Undo" (≈8 s). The section reloads through its lane, so the
  widget and modal stay consistent. Rapid double-clicks are guarded by a per-row in-flight lock.
- Input to the RPCs is validated with **Zod** before sending (kind enum, UUID client id, ISO date, remind option enum).
- View As: the Dashboard is not a View As surface (`viewAsSurfaces.ts`). Write actions are additionally hidden
  whenever View As is active.

### 6.6 Data loading

- `loadClientMilestones(scope, signal)` in `src/lib/dashboard-milestones-data.ts`:
  - **Clients:** `id, first_name, last_name, phone, created_at, date_of_birth, effective_date, draft_date,
    primary_policy_id, policy_type, carrier, policy_number, premium, face_amount, sold_date, custom_fields`.
    Scope: the widget rule (`listScopeIsFiltered`) for both the widget and its modal (R2):
    `assigned_agent_id = me` unless Admin + Team.
  - **Truncation is never silent (R4).** The first page requests `count: "exact"`. Pages advance by the number of
    rows actually returned, so a server row limit below the page size cannot end the read early. Reading stops at the
    exact count, at the 5,000-row cap (D14), or at an empty page. Whenever loaded < exact count, or the count is
    unavailable, the result is `incomplete` with `{ loaded, total }`.
    - The widget and modal then show "Milestones from the first 5,000 of 6,212 clients — some may be missing".
    - Category counts read "at least N".
    - The empty state is never shown for an incomplete read.
    - Rows are de-duplicated by `id` if a client was inserted mid-read.
  - The same paging helper reads the review rows.
  - **Review rows** (after G2): own rows (`user_id = me`, `organization_id = my org`) where
    `milestone_kind = 'first_payment' OR occurrence_date ≥ today − 1 year`.
  - Both reads run through `settleAll` / `linkedAbort` (invariant #22: no bare `Promise.all` in a lane-serialized
    load). Any returned error throws (`assertNoQueryError`), never an empty result.
- Pure engine `src/lib/dashboard-milestones.ts` (no React, no Supabase): date parsing, next occurrence, windows,
  eligibility, identity, merge with review rows, sorting. It takes `today` as an argument, so tests are
  timezone-independent.

---

## 7. Dashboard detail modals (unified)

`DashboardDetailModal` keeps **all** its data logic (request generations, pagination lock, `fetchCallbackPage`,
`loadPerformanceDetails`, missed-calls query, `isStale` guards). Only presentation moves:

| Type | Tone | Header description | Filters (loaded records) | Row status | Row actions |
|---|---|---|---|---|---|
| Callbacks | blue | unchanged (lookback/lookahead) | unchanged: All/Overdue/Today/Upcoming + search | Overdue/Today/Upcoming | View, Call (unchanged) |
| Calls Made | blue | period + scope (server `scope`) | search (name/phone/disposition) | disposition + duration (display only; no client-side "contacted") | View contact; Call again (when the type resolves) |
| Appointments | purple | period + scope | type chips from loaded rows + search | type + status | Open in Calendar (existing) |
| Policies Sold | green | period + scope | Premium known / unknown + search | "Sold MM/DD/YYYY", monthly premium or "Premium unknown" | View client |
| Annual Premium | gold | period + scope | Premium known / unknown + search | annual premium / unknown, Sold date | View client |
| Missed Calls | red | last 24 hours | Voicemail / Linked / Unlinked + search | outcome label | Call back, View contact, voicemail player |
| Client Milestones | pink | §6.4 | §6.4 | §6.4 | §6.5 |

- All types get the Radix shell, visible (not hover-only) actions, a Retry on initial failure (same
  `fetchData(0, true)` the callbacks modal already uses), Retry page on pagination failure, and a Load more
  button next to the existing scroll trigger.
- Dismissing an alert is never presented as completing a record: no "Done", "Complete" or "Resolve" on callbacks,
  appointments or calls; milestones use "Mark reviewed".

---

## 8. Component size (AGENT_RULES §7: < 200 lines)

`Dashboard.tsx` (705) and `DashboardDetailModal.tsx` (876) are over budget and not documented exceptions. Because
this work edits both heavily, the recommendation (D12) is **verbatim extraction**: same code, new file, so behavior
cannot drift.
- `Dashboard.tsx` → `useDashboardLayout` (prefs load/save/reset, moved unchanged), `DashboardWidgetFrame`,
  `DashboardLayoutEditorBar`, `DashboardControls` (period tabs, perspective, Refresh, Customize).
- `DashboardDetailModal.tsx` → `useDashboardDetailFeed` (fetch/generation/pagination, moved unchanged minus the
  anniversaries branch), `DashboardRecordsModal` + `DashboardRecordRow` (presentation),
  `DashboardMilestonesModal`.
Each new component stays < 200 lines. Hooks and libs are not components; they are kept cohesive.

---

## 9. ⛔ Backend change requiring separate approval (G2) — NOT to be applied without `#APPROVE_RLS_CHANGE`-level sign-off

**Why a schema change is unavoidable:** reviewed/snoozed state must persist per **user + organization + event +
occurrence year**. Every existing store fails that requirement:
- `user_preferences.settings` has no `organization_id`. The browser rewrites the whole blob (the layout save is a
  read-modify-write), so two tabs lose each other's acknowledgments, and the blob grows without bound alongside
  layout prefs.
- `notifications` belongs to the global notification center (out of scope) and would surface in the bell.
- Frontend-only state (memory or `localStorage`) is forbidden by the spec.
- Writing to `clients` or policies to hide a milestone is forbidden.

**Proposed migration** `supabase/migrations/<applied-version>_dashboard_milestone_reviews.sql` (authored with a
placeholder timestamp; filename reconciled to the recorded version after apply, per the AGENT_RULES rule):

```sql
CREATE TABLE public.dashboard_milestone_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id)          ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES public.clients(id)      ON DELETE CASCADE,
  milestone_kind  text NOT NULL CHECK (milestone_kind IN ('client_birthday','policy_anniversary','first_payment')),
  event_key       text NOT NULL CHECK (char_length(event_key) BETWEEN 1 AND 64),
  occurrence_year integer NOT NULL CHECK (occurrence_year BETWEEN 2000 AND 2200),
  occurrence_date date NOT NULL,
  state           text NOT NULL CHECK (state IN ('reviewed','snoozed')),
  remind_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'snoozed') = (remind_at IS NOT NULL)),
  CHECK (milestone_kind <> 'client_birthday' OR event_key = 'birthday'),
  CHECK (milestone_kind <> 'first_payment'   OR event_key = 'first_payment'),
  CHECK (milestone_kind =  'first_payment'   OR extract(year FROM occurrence_date)::int = occurrence_year)
);
-- Annual events: one row per user/org/event/occurrence year.
CREATE UNIQUE INDEX ... ON public.dashboard_milestone_reviews
  (organization_id, user_id, milestone_kind, client_id, event_key, occurrence_year)
  WHERE milestone_kind <> 'first_payment';
-- First payment is one-time: one row per user/org/client, any year.
CREATE UNIQUE INDEX ... ON public.dashboard_milestone_reviews (organization_id, user_id, client_id)
  WHERE milestone_kind = 'first_payment';
CREATE INDEX ... (user_id, organization_id, occurrence_date);
-- updated_at trigger (existing house pattern).
```

**RLS (enabled, FORCE not used, same as peer tenant tables):**
- SELECT / DELETE: `user_id = auth.uid() AND organization_id = public.get_org_id()`.
- INSERT / UPDATE (USING + WITH CHECK): the same, **and**
  `EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.organization_id = organization_id)`,
  evaluated under the caller's `clients` RLS. A user cannot record state for a client they cannot see; a Team
  Leader can for a visible downline client.
- Grants: `REVOKE ALL FROM PUBLIC, anon`; `GRANT SELECT, INSERT, UPDATE, DELETE TO authenticated`;
  `GRANT SELECT TO service_role`.

**RPCs — `SECURITY INVOKER`** (RLS stays the authority; the functions only derive identity and validate), with
`search_path = pg_catalog, pg_temp` and schema-qualified objects. EXECUTE goes to `authenticated` only (revoked
from PUBLIC/anon).
- `public.set_dashboard_milestone_review(p_kind text, p_client_id uuid, p_event_key text, p_occurrence_date date,
  p_state text, p_remind_at timestamptz) RETURNS public.dashboard_milestone_reviews`
  - `user_id := auth.uid()`; `organization_id := get_org_id()`. It also requires the caller's own `profiles` row to
    be Active with the same organization (DB/JWT agreement). Nothing identity-bearing is taken from the browser.
  - It validates the kind, key shape, the year derived from the date, that `remind_at` is in the future and ≤ 30
    days ahead, and that the client is visible.
  - `INSERT … ON CONFLICT` targets the matching partial index, then `RETURNING *`.
  - Errors: 22023 invalid input, 42501 denied, PT404 client not visible (never P0002).
- `public.clear_dashboard_milestone_review(p_id uuid, p_expected_updated_at timestamptz) RETURNS boolean` —
  deletes only the caller's row with that exact `updated_at` and returns whether one row was deleted.

**Also in G2:** `supabase/rollback/<version>_dashboard_milestone_reviews.rollback.sql` (drops the RPCs and table;
never applied by default), `supabase/tests/dashboard_milestone_reviews.sql`, `scripts/run_dashboard_milestone_tests.sh`
(disposable PostgreSQL, same harness as `run_lead_conversion_preservation_tests.sh`), and
`.github/workflows/dashboard-milestones-backend.yml`. The SQL suite covers own-row isolation, the cross-org refusal,
the refusal for a client hidden by RLS (Agent vs other agent's client), TL access to a downline client, anon denied,
every CHECK, idempotent upsert, first-payment one-time uniqueness across years, a conditional delete that refuses
a stale `updated_at`, remind_at bounds, and the profile/JWT org mismatch refusal.

**Apply route:** decided at G2 (prior releases used the SQL Editor as `postgres` with a hashed package; AGENT_RULES
says `apply_migration` stamps its own version). No data backfill; no existing row is read or changed.
`src/integrations/supabase/types.ts` gets a surgical addition for the table and RPCs.

---

## 10. Sequencing and behavior before G2

1. **Commit A (G1):** shared UI kit, tones, verbatim extractions, restyled widgets and modals, milestone engine +
   read path (clients only), widget/modal with **Call** and **View contact**. Review-state reads and writes sit
   behind one capability check, `VITE_DASHBOARD_MILESTONE_REVIEWS === "true"` (unset until G2 is applied and read
   back). While it is off:
   - Mark Reviewed / Remind Later / Undo are **not rendered** (no dead buttons, no fake persistence).
   - No review table is read.
   - The First Payment category is hidden (R1 rule 6).
2. **Commit B (G2 package):** migration, rollback, SQL suite, runner, CI, type additions — files only, nothing applied.
   The action hooks and RPC calls are already written in Commit A, behind the flag, and covered by unit tests with a
   mocked client.
3. **After G2 is applied and read back, at G3:** set both Vercel variables:
   - `VITE_DASHBOARD_MILESTONE_REVIEWS=true`;
   - `VITE_FIRST_PAYMENT_REMINDERS_START=<go-live date>`.

   No code change is needed to turn it on. Release order is database first, then frontend.
4. **G3:** merge only with Chris's separate approval.

**Recommendation (D2):** the First Payment category depends on "pending until reviewed", so it should not ship to
production before G2. The production merge (G3) should wait for G2. If Chris prefers to release Commit A first, the
First Payment category would be hidden in that release.

---

## 11. Exact files proposed

**New — frontend**
- `src/components/dashboard/ui/dashboardTones.ts`
- `src/components/dashboard/ui/DashboardWidgetFrame.tsx`
- `src/components/dashboard/ui/DashboardListRow.tsx`
- `src/components/dashboard/ui/DashboardStatusPill.tsx`
- `src/components/dashboard/ui/DashboardEmptyState.tsx`
- `src/components/dashboard/ui/DashboardRowActions.tsx`
- `src/components/dashboard/ui/DashboardModalShell.tsx`
- `src/components/dashboard/ui/DashboardFilterChips.tsx`
- `src/components/dashboard/DashboardControls.tsx`
- `src/components/dashboard/DashboardLayoutEditorBar.tsx`
- `src/components/dashboard/DashboardRecordsModal.tsx`
- `src/components/dashboard/DashboardRecordRow.tsx`
- `src/components/dashboard/DashboardMilestonesModal.tsx`
- `src/components/dashboard/milestones/MilestoneRow.tsx`
- `src/components/dashboard/milestones/MilestoneCategoryChips.tsx`
- `src/components/dashboard/widgets/ClientMilestonesWidget.tsx` (`git mv` from `AnniversariesWidget.tsx`)
- `src/hooks/useDashboardLayout.ts`
- `src/hooks/useDashboardDetailFeed.ts`
- `src/hooks/useMilestoneActions.ts`
- `src/lib/dashboard-milestones.ts`
- `src/lib/dashboard-milestones-data.ts`
- `src/lib/dashboard-milestones-config.ts` (rev 1: env flags, fail-closed parsing)
- `src/lib/dashboard-scope.ts` (rev 1, R2: KPI/list scope rules + TL disclosure)
- `src/lib/paged-exact-read.ts` (rev 1, R4: exact-count paging helper)

**Modified — frontend**
- `src/pages/Dashboard.tsx` (label, frame, MotionConfig, extractions; KPI/StatCards usage unchanged)
- `src/components/dashboard/DashboardDetailModal.tsx` (presentation routed to the shells; anniversaries branch removed)
- `src/components/dashboard/DashboardCallbacksModal.tsx` (re-skinned on the shell; behavior unchanged)
- `src/components/dashboard/widgets/CallbacksWidget.tsx`
- `src/components/dashboard/widgets/AppointmentsWidget.tsx`
- `src/components/dashboard/widgets/GoalProgressWidget.tsx`
- `src/components/dashboard/widgets/LeaderboardWidget.tsx`
- `src/components/dashboard/widgets/LeaderboardPreviewRow.tsx`
- `src/components/dashboard/widgets/MissedCallsWidget.tsx`
- `src/integrations/supabase/types.ts` (Commit B only: new table + RPC types)

**Explicitly NOT modified:** `StatCards.tsx`, `useDashboardStats.ts`, `dashboard-callbacks.ts`,
`dashboard-contact-identity.ts`, `dashboardRefresh.ts`, `useDashboardSection.ts`, `dashboard-widget-prefs.ts`,
`normalized-policy.ts`, `client-policy-display.ts`, `quick-call.ts`, every Contacts/Settings/Dialer/Twilio file,
`index.css`, the notification center.

**Tests — new**
- `src/lib/__tests__/dashboardMilestones.test.ts`
- `src/lib/__tests__/dashboardMilestonesData.test.ts`
- `src/components/dashboard/__tests__/clientMilestonesWidget.test.tsx`
- `src/components/dashboard/__tests__/dashboardMilestonesModal.test.tsx`
- `src/components/dashboard/__tests__/dashboardModalShell.test.tsx`
- `src/components/dashboard/__tests__/dashboardWidgetFrame.test.tsx`
- `scripts/tests/dashboard-ui/verify.mjs` (mocked-Supabase Playwright run, same pattern as `google-sheets-ui/verify.mjs`)

**Tests — updated** (selector/label changes only; assertions about data contracts unchanged)
- `src/components/dashboard/__tests__/dashboardSections.test.tsx` (Anniversaries → Client Milestones label/empty text)
- `src/components/dashboard/__tests__/dashboardCallbacksModal.test.tsx`
- `src/components/dashboard/__tests__/dashboardDetailModalVoicemail.test.tsx`
- `src/components/dashboard/__tests__/dashboardPremiumLabels.test.tsx` (only if markup moves; label text preserved)
- `src/components/dashboard/__tests__/leaderboardWidget.test.tsx` (only if markup moves)

**Backend — G2 only (files written in Commit B, never applied without approval)**
- `supabase/migrations/<version>_dashboard_milestone_reviews.sql`
- `supabase/rollback/<version>_dashboard_milestone_reviews.rollback.sql`
- `supabase/tests/dashboard_milestone_reviews.sql`
- `scripts/run_dashboard_milestone_tests.sh`
- `.github/workflows/dashboard-milestones-backend.yml`

**Docs**
- `docs/plans/2026-10-29-dashboard-premium-redesign/implementation_plan.md` (this file)
- `WORK_LOG.md` (newest-first entry after code changes)
- `AGENT_RULES.md`:
  - a new "Client Milestones" invariant (rules in §6, identity in §6.2, the G2 contract);
  - invariant #22 rev 1.2 section list "Anniversaries" → "Client Milestones (key `anniversaries`)";
  - a one-line status correction: `20261021200000` is applied.

---

## 12. Verification plan

- **Focused Vitest:** `npx vitest run src/components/dashboard src/lib/__tests__/dashboardMilestones*.test.ts
  src/lib/__tests__/dashboardWidgetPrefs.test.ts src/lib/__tests__/dashboardRefresh.test.ts
  src/lib/__tests__/normalizedPolicy.test.ts`, repeated with `TZ=America/Los_Angeles`, `TZ=Pacific/Auckland`
  and `TZ=UTC`.
- **Engine cases:**
  - Client-only birthdays: the lead table is never queried (the data test asserts the tables touched).
  - Multiple policies: primary + 2 additional, a legacy `issueDate`, a malformed container, a phantom client.
  - Inclusive boundaries: days 0/14/15 (birthdays) and 0/30/31/90/91 (anniversaries).
  - Dec 28 → Jan 10 rollover; Feb 29 on 2027-02-28 and 2028-02-29.
  - Year-0 exclusion; an anniversary today shows "Today"; DST weeks 2026-11-01 and 2027-03-14.
  - First payment: draft − 4 hidden, − 3 shown, draft day shown, + 10 still pending, reviewed hidden forever after
    a draft-date change, pre-epoch hidden, created-after-draft hidden.
  - Non-ISO DOB (`03/15/1960`), invalid dates ignored.
- **Action integrity:** a write sends the derived identity, a zero-row result is a failure, double clicks are
  locked, Undo after a newer write is refused, View As hides actions, and the section reloads after success.
- **Permissions:** a widget/modal scope test per role (Agent / TL / Admin × My / Team), plus the SQL RLS suite (G2).
- **Refresh:** milestones join the Refresh tracker. A failed refresh keeps the rows with the stale note; a first
  failure is never the empty message.
- **Gates:** `npx tsc --noEmit` (vacuous by design) **and** `npx tsc -p tsconfig.app.json --noEmit`, compared with
  the error count at base `2a18e263` (no new errors). `npx eslint` on changed files, `npm run build`.
- **Browser:** `scripts/tests/dashboard-ui/verify.mjs` at 1440 px and 390 px, light and dark,
  `prefers-reduced-motion: reduce` emulated. It checks no horizontal overflow, widget header buttons reachable by
  Tab, menus operable by keyboard (Enter/Arrow/Escape), modal focus trap and return, and that the KPI cards render
  pixel-identical to base (screenshot diff of the StatCards region).

---

## 13. Decisions for Chris (recommendation first)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Review-state storage | **New table + INVOKER RPCs (§9)**. Rejected: `user_preferences` (no org, lost updates), `notifications` (out-of-scope bell), local storage (forbidden). |
| D2 | Release sequencing | **G2 before production merge**; build A on the branch now. |
| D3 | First-payment "historical" rule | **Go-live date constant + `draft_date ≥ client creation date`**. |
| D4 | Feb 29 in non-leap years | **Feb 28**. |
| D5 | Whose "today" | **Browser-local**, like the rest of the Dashboard (agency timezone stays the Reports authority). |
| D6 | Policy set for anniversaries | **Normalized model** (drops policy-less phantom clients — behavior change). |
| D7 | Legacy policies without stored identity | Primary → `primary` key; additional without `policyId` → actions disabled with a reason. |
| D8 | Remind Later options | **Tomorrow / In 3 days / Next week** (local start of day), always offered; resurfaces as a Follow-up after the date (R3). |
| D9 | Undo semantics | **Delete own row only if unchanged since the action**; toast Undo + Restore in modal. |
| D10 | Scope rules | **Replaced by R2 / §2A:** the modal uses the opener's scope; TL Team note; no permission/RLS change. |
| D11 | Callbacks "View all" | **Open the Callbacks modal** (currently navigates to `/contacts`). |
| D12 | 200-line rule | **Verbatim extraction** of `Dashboard.tsx` / `DashboardDetailModal.tsx` logic into hooks. |
| D13 | Category icons | **Cake / CalendarHeart / Wallet**. |
| D14 | Large books | **Paged reads to 5,000 clients + "incomplete" note**; a server-side milestones RPC is a later follow-up. |

## 14. Out of scope (unchanged)

Top KPI cards, the global notification center, Contacts/Settings/other pages, Twilio/dialer behavior, any SMS or
email to clients, and any database/RLS change beyond the G2 package. Also out: unrelated refactors, a hierarchy or
scope change, and the TL widget/modal scope alignment.

## 15. Context snapshot

- **Changes so far:** this plan file only.
- **Migrations/deploys:** none. Read-only `list_migrations` metadata check only (no tenant data).
- **Blockers:** G1 approval to start code. G2 approval for the schema/RLS package before review actions can work.
- **Next:** on G1, implement Commit A, run §12 gates, append `WORK_LOG.md`, report. Then prepare Commit B for G2.
