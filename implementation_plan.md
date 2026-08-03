# Implementation Plan — AgentFlow Dashboard Closeout

**Status:** **PLAN ONLY — AWAITING CHRIS'S EXPLICIT APPROVAL.** Nothing has been implemented, migrated, or deployed. The only file changed by this phase is `implementation_plan.md`.
**Date:** 2026-08-01
**Baseline:** `origin/main` = **`09976ac7ff22b7e0a3164a0078e0f20dd4e0aad8`** — matches the handoff commit exactly (verified by `git fetch origin` + `git rev-parse origin/main`). Plan branch `claude/dashboard-closeout-plan`, cut from that commit.
**Pre-existing dirty files excluded from every commit, as in prior tasks:** `deno.lock`, `.claude/`, `.cursor/`, `tsconfig*.tsbuildinfo`.

> Supersedes the previous plan (Onboarding Wizard Redesign — "Focused Console"), which shipped as **PR #342** and is recorded in `WORK_LOG.md`. Its durable record is preserved in **Appendix H**.

**Prior work reviewed:** `AGENT_RULES.md` (all 260 lines, invariants #1–#21), `VISION.md` (all 122 lines), `WORK_LOG.md` (7,988 lines; newest entries read in full), and git history `ff8499a…09976ac`. The commits since the previous plan's baseline (PR #342, onboarding) touch **no Dashboard file** — verified with `git diff --stat`.

---

## 0. How this was audited

- **Code:** every primary file read in full at `09976ac` — `Dashboard.tsx` (595), `useDashboardStats.ts` (185), `DashboardDetailModal.tsx` (614), `StatCards.tsx` (160), all six `widgets/*`, `FloatingDialer.tsx` (1,363), `TwilioContext.tsx` (2,359, relevant regions), `usePermissions.ts` (237), `permissionDefaults.ts` (379), `useLeaderboardData.ts` (581), `leaderboardPremium.ts`, `leaderboardTypes.ts`, `supabase-dashboard.ts` (626), `supabase-dialer-stats.ts`, `package.json`, `vitest.config.ts`.
- **Live database:** introspected **read-only** via Supabase MCP `execute_sql` on project `jncvvsvckxhqgqvkppmj` — `information_schema.columns`, `pg_constraint`, `pg_policies`, `pg_proc`, `pg_trigger`, `pg_index`, `pg_timezone_names`, plus row counts and value distributions. **No DDL, no writes, no deploys, no mutations, no Edge Function calls.**
- Every claim carries a `path:line` or live-SQL citation. Where a handoff claim proved imprecise, the corrected statement is given and marked.

---

## 1. Current-state evidence

### 1.1 The handoff defect list — adjudicated

| # | Claim as handed over | Verdict | What the code actually does |
|---|---|---|---|
| 1 | Dashboard dispatches `agentflow:open-dialer`; FloatingDialer listens for `quick-call` | ✅ **CONFIRMED** | `CallbacksWidget.tsx:118`, `AnniversariesWidget.tsx:93`, `MissedCallsWidget.tsx:98` dispatch `"agentflow:open-dialer"`. `FloatingDialer.tsx:279` listens for `"quick-call"`. A repo-wide grep finds **zero** listeners for `agentflow:open-dialer` — every Dashboard call button is a silent no-op. **Additional defect not in the handoff:** the payload field names are also wrong. Canonical (`Contacts.tsx:2452`) is `{ name, phone, contactId }`; the Dashboard sends `{ contactId, contactName, phone }` — `contactName` is never read, and `type` is omitted so `FloatingDialer.tsx:267` defaults every contact to `'lead'`. |
| 2 | Nested button clicks bubble into outer handlers | ⚠️ **PARTIALLY CONFIRMED** | `DashboardDetailModal.handleStartCall` **does** call `e.stopPropagation()` (`:342`) — that case is already guarded. The real defect is on the page: `Dashboard.tsx:530-531` puts `onClick={() => handleWidgetClick(key)}` on the `<div>` that **wraps `renderWidget(key)`** (`:541`), so every button inside every widget bubbles up and opens the detail modal. |
| 3 | Team Leaders offered Team Overview while hooks return personal data | ✅ **CONFIRMED — and worse than reported** | `Dashboard.tsx:411` shows the toggle to `Admin` **and** `Team Leader`. `useDashboardStats.ts:33-35` explicitly logs `"[Dashboard] Team scope deferred — falling back to own"`; `:36` `isFiltered = reportsScope !== "all" \|\| adminToggle === "my"` forces `.eq("agent_id", userId)` for any non-`all` scope. **Root cause is deeper than the frontend — see Blocker B2:** production `profiles.hierarchy_path` is broken, so even a correct query returns only the leader. |
| 4 | Several widgets use `role !== "Admin"` as their scoping rule | ✅ **CONFIRMED** | Exactly four: `CallbacksWidget.tsx:30`, `AnniversariesWidget.tsx:29`, `MissedCallsWidget.tsx:38`, `AppointmentsWidget.tsx:47` — all `const isFiltered = role !== "Admin" \|\| adminToggle === "my";` |
| 5 | Dashboard counts `clients` as policies instead of `wins` | ✅ **CONFIRMED** | `useDashboardStats.ts:93-101` `buildSalesQuery` reads **`clients`**; `:158` `policiesThisMonth: salesNow.count`; `:163` `winsThisMonth: salesNow.count` — the field named *wins* is a **clients** count. `DashboardDetailModal.tsx:265,273` and `LeaderboardWidget.tsx:48` also read `clients`. **Exception:** `GoalProgressWidget.tsx:97` already reads `wins` correctly. |
| 6 | `makeCall()` gets an invalid third argument, is not awaited, reports success unconditionally | ✅ **CONFIRMED (all three)** | Signature `TwilioContext.tsx:178` — `(destinationNumber: string, callerNumber?: string, opts?: MakeCallOptions) => Promise<string \| undefined>`. Call site `DashboardDetailModal.tsx:360` — `makeCall(item.phone, undefined, item.id);` passes a **string** where `MakeCallOptions` (an object, `:134-147`) is required; not awaited; `:361` `toast.success(...)` fires unconditionally even though `undefined` is the documented failure return. **Why `tsc` misses it:** `item` is typed `any`, so `item.id` is `any` and assignable. |
| 7 | Call / missed-call rows navigate with the call ID | ✅ **CONFIRMED** | `DashboardDetailModal.tsx:331-332` — for `calls_today` / `missed_calls`, ``navigate(`/contacts?contact=${id}&tab=Leads`)`` where `id = item.id` = the **`calls.id`**. The queries at `:255-257` and `:270` already `select(… contact_id …)`, so the correct value is present and simply unused. `tab` is also hardcoded `Leads`. |
| 8 | Current-period appointment queries lack an upper bound | ✅ **CONFIRMED** | `useDashboardStats.ts:139` calls `buildApptQuery(startStr)` with no `end`, and `:103-112` applies `.lte` only when `end` is passed. Same for calls (`:135`), sales (`:137`), leads (`:141`), talk time (`:124-132`). |
| 9 | Callbacks are oldest-first, unbounded, limited to 15, total = result length | ✅ **CONFIRMED (all four)** | `CallbacksWidget.tsx:43` `.order("start_time", { ascending: true })`; `:42` `.lte("start_time", threeDaysOut)` with **no lower bound**; `:44` `.limit(15)`; `:54` `setTotalCount(data.length)`. **Additional defect:** `:38-41` reads **`appointments`** filtered `type IN ('Follow Up','Call Back')`, but the canonical callback model is `campaign_leads.callback_due_at` / `callback_agent_id` (AGENT_RULES #16). All 11 production appointments are `type='Sales Call'`, so this widget is **empty in production**. |
| 10 | Preference saves can report false success | ✅ **CONFIRMED** | `Dashboard.tsx:295-303` — `await supabase.from("user_preferences").upsert(...)` **discards the result**, then `toast.success("Dashboard layout saved")`. supabase-js returns `{ error }` and does not throw, so the `catch` at `:305` never fires for a DB error. Identical in `resetLayout` (`:323-336`). |
| 11 | Date calculations rely on browser-local `Date` | ✅ **CONFIRMED** | `useDashboardStats.ts:49,67,72` and `DashboardDetailModal.tsx:124-141` build boundaries with `new Date(y, m, d)` (local) then `.toISOString()`. `leaderboardTypes.ts:108-118` `getPeriodRange` uses browser-local date-fns. Two viewers in different zones see different numbers for the same org and period. |
| 12 | Period ranges are not half-open | ✅ **CONFIRMED** | Every bound is `.lte(...)` (`useDashboardStats.ts:88,98,109,119`; `DashboardDetailModal.tsx:257,262,272`), with `setMilliseconds(-1)` / `23:59:59.999` fudging (`useDashboardStats.ts:53,69,74`). |
| 13 | "Real-time Intelligence Feed" is misleading | ✅ **CONFIRMED** | `DashboardDetailModal.tsx:481` renders that label beside an `animate-pulse` dot; `:588` "End of intelligence feed". **No `supabase.channel(...)` subscription exists anywhere** in `src/components/dashboard/` or `src/pages/Dashboard.tsx`. (By contrast `useLeaderboardData.ts:522` *does* have a real subscription.) |
| 14 | Interactive rows are not keyboard accessible | ✅ **CONFIRMED** | `Dashboard.tsx:525-532` — clickable `<div>` with `cursor-pointer` and `onClick`, no `role`, `tabIndex`, or `onKeyDown`. Same pattern in the modal's rows. |
| 15 | The detail modal lacks dialog focus behavior | ✅ **CONFIRMED** | `DashboardDetailModal.tsx:443-456` is a hand-rolled `<div className="fixed inset-0 z-[100]">` + `motion.div` — **not** a Radix Dialog. No `role="dialog"`, no `aria-modal`, no `aria-labelledby`, no focus trap, no focus restore, no Escape handler. `@radix-ui/react-dialog@^1.1.14` **is already a dependency**. |
| 16 | Initial load makes many overlapping / full-row requests | ✅ **CONFIRMED** | `useDashboardStats.ts:134-144` issues **9** queries per period change, one of which (`buildTalkTimeQuery`, `:124-132`) selects **every matching `calls.duration` row** and sums in JS with no upper bound — O(call volume) over the wire. Six widgets each fire their own queries on mount → **~17 round-trips** for one paint. `:180` re-runs all 9 every 120 s. |
| 17 | `Dashboard.tsx` and `DashboardDetailModal.tsx` exceed the size guideline | ✅ **CONFIRMED** | 595 and 614 lines vs. the AGENT_RULES §7 limit of **200**. Neither is on the sanctioned exception list (`DialerPage.tsx`, `TwilioContext.tsx`). |
| 18 | Dashboard automated coverage is missing | ✅ **CONFIRMED** | 45 test files exist under `src/**/__tests__`; **zero** cover `Dashboard.tsx`, any widget, `useDashboardStats`, `supabase-dashboard.ts`, `useLeaderboardData`, or `leaderboardPremium`. |
| 19 | Vercel READY does not prove `npx tsc --noEmit` | ✅ **CONFIRMED (structural)** | `package.json` has **no `typecheck` script**; `build` is `vite build`, which transpiles via esbuild without type-checking. Defect #6 is live proof — it ships green. |
| 20 | Mobile controls / hover-only actions need verification | ⏳ **DEFERRED TO BUILD 3** | Requires a viewport matrix run, not static reading. Covered in §7.4. |

### 1.2 Additional defects found during this audit (not in the handoff)

| # | Finding | Evidence |
|---|---|---|
| A1 | **Default period is `month`, not Today.** | `Dashboard.tsx:162` `useState<…>("month")`. Contract §3 requires Today. |
| A2 | **Scope is a 2-way boolean, not the 3 required views, and defaults to Personal for Admins.** | `Dashboard.tsx:161` `useState<"team" \| "my">("my")`. No Agency view exists; Admin does not default to Agency. |
| A3 | **No persistence of the last-selected view.** | `Dashboard.tsx:161` is plain `useState`. Contract §5 requires Team Leader last-view restore. |
| A4 | **No `organization_id` filter on any Dashboard query.** | Zero occurrences in `useDashboardStats.ts`, `DashboardDetailModal.tsx`, or any `widgets/*`. With Blocker B3 this is the peer-leak vector. |
| A5 | **Appointments Set uses occurrence time and drops cancelled bookings.** | `useDashboardStats.ts:107-108` — `.eq("status","Scheduled").gte("start_time", …)`. Contract §7 requires `created_at` (booking time) and retention after cancel/reschedule. |
| A6 | **`GoalProgressWidget` contradicts the approved Appointments Set rule.** | `GoalProgressWidget.tsx:105` excludes `Canceled/Cancelled/Rescheduled`. It is otherwise the **most correct** surface (uses `wins`, uses `created_at`). Needs alignment. |
| A7 | **Premium annualization is inconsistent across four surfaces.** | `useDashboardStats.ts:164` `premiumNow * 12` on `clients.premium`; `DashboardDetailModal.tsx:426` `* 12`; `GoalProgressWidget.tsx:118` **does not** annualize; `AgentScorecardModal.tsx:66` does not. |
| A8 | **`talkTimeMinutes` can render `NaN`.** | `useDashboardStats.ts:149-151` — `Math.round(undefined / 60)` → `NaN`, and `NaN ?? 0` is `NaN` (`??` only catches null/undefined). |
| A9 | **No widget-key normalization.** | `Dashboard.tsx:229-234` accepts any array from `user_preferences.settings` verbatim. An unknown key renders a card with an `undefined` title (`:538`) and an empty body (`renderWidget` default → `null`, `:380`). A newly added widget never appears for existing users. `visibleWidgets` (`:254`) and `hiddenWidgetKeys` (`:385`) apply **different** filters. |
| A10 | **`LeaderboardWidget` ignores the Dashboard period and scope entirely.** | `Dashboard.tsx:363` passes only `userId`. `LeaderboardWidget.tsx:48` reads `clients` for a hardcoded `startOfMonth`. |
| A11 | **Anniversaries / Missed Calls / Schedule ignore the selected period.** | `DashboardDetailModal.tsx:171-227` hardcodes 14-day birthday and 90-day renewal windows; `:270` hardcodes 24 h for missed calls; `AppointmentsWidget.tsx:67-68` is today-only. |
| A12 | **`now` is mutated during week calculation.** | `DashboardDetailModal.tsx:128` `new Date(now.setDate(diff))` mutates `now` in place; `useDashboardStats.ts:59` does the same to `today`. |
| A13 | **Policy anniversaries derive from a TEXT column.** | `clients.effective_date` is `text` (`YYYY-MM-DD`), parsed with `new Date(c.effective_date)` (`DashboardDetailModal.tsx:210`) — timezone-fragile parsing of a date-only string. |
| A14 | **Duplicate goal columns on `profiles`.** | Both `weekly_appointment_goal` and `weekly_appointments_goal` exist. Unused by the Dashboard; recorded as debt only. |
| A15 | **Two of the named primary files are entirely DEAD CODE.** | `src/lib/supabase-dashboard.ts` (**626 lines, 26 queries**) and `src/components/dashboard/CustomizeDrawer.tsx` (147 lines) have **zero importers** repo-wide — verified by grep excluding their own definitions. `supabase-dashboard.ts` still contains the stale-stored-counter bug that AGENT_RULES §17 (line 119) explicitly calls out as an inherited defect, so the rule text should be corrected when it is removed. `CustomizeDrawer` duplicates the layout-editing model now inlined in `Dashboard.tsx`. |
| A16 | **The live `get_agency_group_leaderboard` RPC has the same wins-vs-clients defect, plus three more.** | Its `policies_sold` counts **`clients`** (`cli.assigned_agent_id`), not `wins`; its `calls` LATERAL has **no `direction = 'outbound'` filter** so inbound calls inflate Calls Made; **no `organization_id` predicate** on the `calls`/`appointments`/`clients` LATERALs (it leans entirely on the peer policies); and the period is **`>= v_period_start` with no upper bound**. Out of Dashboard scope but recorded — it means the Agency Group leaderboard and the org leaderboard measure different things today. |
| A17 | **A second dead dialer event exists outside the Dashboard.** | `DayAgendaPanel.tsx:113` — `toast.success(\`Opening dialer for …\`)` followed by `dispatchEvent(new CustomEvent("openDialer"))`, with **no listener anywhere** and **no detail payload at all**. Same class of defect as #1: a success toast for an action that never happens. Out of Dashboard scope; flagged for a follow-up. |
| A18 | **CORRECTED — stale client-model residue, NOT a failing production write.** *(non-blocking; owner: D9-a)* | An earlier revision of this plan called `supabase-users.ts:107/159` "writes". **That was wrong.** Re-verified against the exact baseline with `git show 09976ac:src/lib/supabase-users.ts`: lines **39, 107, 159, 252** are all **read-side mapping defaults** — `rowToUser({ ...row, onboarding_items: [], … })` on reduced-column fallback paths, and `row.onboarding_items \|\| []`. `AgentModal.tsx:79/86` are likewise **reads** that coalesce (`data.monthly_talk_time_goal_hours \|\| 0`, `data.onboarding_items \|\| []`). Neither column appears in `allExpectedColumns` or in any of the 11 `.update()`/`.insert()` payloads in that file. **The one true write is `supabase-users.ts:497` `updateOnboardingItems()` — and it has ZERO callers repo-wide, so it is unreachable dead code.** Net: the TS `User` model carries `onboardingItems` and `monthlyTalkTimeGoalHours` properties whose backing columns were removed (`20260428120000_rename_monthly_talk_time_to_premium_goal.sql` renamed `monthly_talk_time_goal_hours` → `monthly_premium_goal`). Reads coalesce to defaults, so **nothing fails at runtime**. Classification: **model debt, non-blocking.** |
| A19 | **A separate `goals` table exists and must not be confused with the per-agent goal columns.** | `public.goals(id, metric, target_value, period, created_at, updated_at, organization_id)` — **org-scoped and generic, with no `user_id`**, and **0 rows**. Contract §10's "My Monthly Goal Progress" is per-user, so the correct source stays `profiles.monthly_*_goal` (as `GoalProgressWidget.tsx:86` already does). Recorded so the implementer does not wire the wrong table. |
| A20 | **The second `wins` write path records NO premium at all.** *(owner: **D1** / Build 2)* | There are exactly two `triggerWin` call sites. `supabase-conversion.ts:106-114` passes `premiumAmount: premium`. **`FloatingDialer.tsx:790-797` passes no `premiumAmount` field whatsoever**, so those wins land with `premium_amount = NULL`. Such a win contributes **1 to Policies Sold but $0 to Annualized Premium**. `annualPremiumForWin` has a `clients.premium` fallback keyed on `contact_id`, but FloatingDialer passes `selectedContact?.id`, which for a lead-originated quick call is a **lead** id and will not match any `clients` row. It also passes no `idempotencyKey` and no `campaignId`. **This is a live data-integrity defect in the KPI the contract cares most about**, and it is invisible today only because `wins` has 0 rows. |
| A21 | **The sale-entry modal has no Zod validation.** *(owner: **D1** / Build 2)* | `src/components/contacts/ConvertLeadModal.tsx` contains **zero** `zod` / `z.` references. Premium is a free-text `string` (`:38`) coerced by `parseCurrencyToNumber`, which strips everything except `[0-9.-]`. AGENT_RULES §7 and the mandated build rules both require Zod on forms and editable modal state. A typo'd premium enters `wins` and `clients` unvalidated. |
| A23 | **A multi-policy sale produces exactly ONE win — the extra policies become JSON on the client.** *(owner: **D1** / Build 2)* | `ConvertLeadModal` collects an array of `PolicyRow` (`:32-41`) and the agent may add any number. At submit, `:132` `const [primary, ...rest] = policies;` — only `primary` populates the client policy columns and the single `triggerWin` call; `rest` is mapped to `additionalPolicies` (`:134-144`) and stashed in **`clients.custom_fields[ADDITIONAL_POLICIES_KEY]`** as opaque JSON (`supabase-conversion.ts:32-34`). **Three policies entered ⇒ Policies Sold counts 1, and Annualized Premium counts only the primary policy's premium.** No `wins` row exists for policies 2..n, so no fallout state could ever be tracked for them either. |
| A24 | **The conversion commits first; a failed win is swallowed, leaving a client with no canonical sale record.** *(owner: **D1** / Build 2)* | `supabase-conversion.ts:89-96` calls `convert_lead_to_client_atomic` and **commits**. Only then, at `:104-120`, `if (!result.idempotent) { try { await triggerWin(…) } catch (e) { console.warn("Win celebration failed (conversion already committed):", e); } }`. The catch is deliberate — it protects the committed conversion — but the consequence is a **client with no `wins` row**, i.e. a sale that exists in the CRM and is invisible to every production metric, with no retry and no reconciliation. |
| A22 | **`cascade_hierarchy_update` only ever recomputes DIRECT children — grandchildren stay stale.** *(owner: **D3** / migration M1)* | `trg_cascade_hierarchy_update` is `AFTER UPDATE **OF upline_id**`. `cascade_hierarchy_update()` then `UPDATE public.profiles SET hierarchy_path = compute_hierarchy_path(...)` on direct children only. Because that UPDATE touches `hierarchy_path` and **not** `upline_id`, it does **not** re-fire the cascade trigger, so descendants below depth 1 are never recomputed. This is a **second, independent** hierarchy bug alongside **B2** and must be fixed in the same migration or Team scope silently truncates at one level after any upline move. |

### 1.3 Blockers established from the live database

All read-only verified. These determine what is and is not implementable.

> **B1 — `public.wins` has NO status column. The approved fallout rule (§8) cannot be implemented against the current schema.**
> Live columns: `id, agent_id, agent_name, contact_id, contact_name, campaign_id, campaign_name, call_id, policy_type, notes, celebrated, created_at, organization_id, premium_amount, idempotency_key`. There is **no** `status`, `is_active`, `voided`, `chargeback` or equivalent, and **no CHECK constraint on `wins` at all**. `clients` likewise has no policy-status column. There is therefore **no existing win/policy status taxonomy to document** — the contract asks for the exact included and excluded statuses, and the honest answer is that the set is empty because the concept does not exist in the schema yet. **Requires Chris's decision (D1).**

> **B2 — `profiles.hierarchy_path` is broken in production, and the trigger that maintains it has a reproducible bug. Team scope is unimplementable until this is fixed.**
> Live stored vs. `compute_hierarchy_path()`:
> | Role | Stored | Correct | Match |
> |---|---|---|---|
> | Admin `ADMIN-A` | `<admin-a>` | `<admin-a>` | ✅ |
> | Team Leader `TEAM-LEADER` | `<team-leader>` | `<admin-a>.<team-leader>` | ❌ |
> | Agent `AGENT` | `<agent>` | `<admin-a>.<team-leader>.<agent>` | ❌ |
>
> Live truth table: `is_ancestor_of(TL, Agent)` = **false** · `is_ancestor_of(Admin, TL)` = **false** · `is_ancestor_of(TL, TL)` = true.
> **Root cause (precisely diagnosed):** `trg_update_hierarchy_path` is `BEFORE INSERT OR UPDATE OF upline_id` → `update_hierarchy_path()` → `compute_hierarchy_path(NEW.id)`. But `compute_hierarchy_path` walks the chain by reading **`SELECT upline_id FROM public.profiles WHERE id = current_id`** — committed *table* state, not `NEW`. On `BEFORE INSERT` the row does not exist yet, so the lookup returns nothing, the loop exits on its first iteration, and the stored path is the self-label only. On `BEFORE UPDATE` the table still holds the *old* `upline_id`, so the path is one edit stale.
> **Consequence:** every ltree Team branch in production (`calls`, `clients`, `profiles`) resolves to *self only*. **A backfill alone is insufficient** — without the trigger fix every newly created user reacquires a broken path.

> **B3 — Agency Group peer-read is LIVE on all three Dashboard-relevant tables. RLS alone cannot satisfy the "no peer data" requirement.**
> | Table | Policy | `USING` |
> |---|---|---|
> | `calls` | `Calls Agency Group Peer Read` | `is_agency_group_peer_organization(organization_id)` |
> | `wins` | `wins_select` | `organization_id = get_user_org_id()` **OR** `is_agency_group_peer_organization(organization_id)` |
> | `agent_scorecards` | `agent_scorecards_agency_group_peer_read` | `is_agency_group_peer_organization(organization_id)` |
>
> Policies are permissive and OR together, so RLS **widens** these tables rather than narrowing them. Currently latent — `agency_groups` = 0 rows, active members = 0 — but it activates the moment the first group is onboarded. Explicit `organization_id` scoping is mandatory, exactly as the contract states.

> **B4 — `wins_select` has no per-agent scoping at all.**
> The policy is org-wide (plus peers). Any authenticated user in the org can `SELECT` **every** win in the organization. An Agent's personal Policies Sold / Annualized Premium is therefore enforced **only** by a client-side `.eq("agent_id", …)`. A client that omits it — by bug, stale bundle, or intent — reads agency-wide production. This is the strongest single argument for deriving sales aggregates server-side.

> **B5 — The `appointments` Team-Leader RLS branch is dead, and uses a different hierarchy mechanism.**
> `appointments_select` gates Team Leaders on `profiles.team_id` (`p.team_id IS NOT NULL AND appointments.user_id IN (SELECT id FROM profiles WHERE team_id = p.team_id)`), **not** ltree `is_ancestor_of` like `calls`/`clients`/`profiles`. Live: `profiles.team_id` is **NULL for all four profiles**, so the branch never matches. Even populated, `team_id` is single-level and cannot express "all descendants at every level".

> **B6 — There is no production sales data.** `wins` = **0** rows, `clients` = **0** rows. (`calls` 85 · `appointments` 11 · `leads` 517 · `campaign_leads` 66 · `profiles` 4 · `organizations` 1 · `agency_groups` 0.) **A read-only production comparison cannot validate Policies Sold or Annualized Premium** — those must be covered by tests and fixtures. Build 4's production comparison is meaningful only for Calls Made and Appointments.

### 1.4 Findings that make the work *easier* than expected

| Finding | Evidence | Consequence |
|---|---|---|
| **A canonical agency timezone already exists.** | `company_settings.timezone text DEFAULT 'America/Chicago'`, with `UNIQUE INDEX company_settings_org_unique (organization_id)` — exactly one row per org. Live value for the production org is `America/Los_Angeles`, and `timezone IN (SELECT name FROM pg_timezone_names)` returns **true**. | **No new timezone table or column is required.** Contract §4's conditional ("if it does not exist, propose the schema change") does not trigger. `profiles.timezone` is a Rails label (`'Eastern Time (US & Canada)'`) and must **not** be used — consistent with AGENT_RULES #14. |
| **A canonical premium utility already exists and annualizes exactly once.** | `leaderboardPremium.ts` — `annualPremiumForWin()` reads `wins.premium_amount`, falls back to `clients.premium ?? clients.premium_amount`, and calls `monthlyPremiumToAnnual()` (`leaderboardTypes.ts:78-79` = `monthly * ANNUAL_PREMIUM_MULTIPLIER`). `fetchWinsForPremium()` **already takes and applies an explicit `organization_id`**. | Reuse it; do not write a second annualizer. It also settles the monthly-vs-annual question — see D2. |
| **A DST-correct half-open zoned-bounds helper already exists.** | `supabase-dialer-stats.ts:194-223` `userLocalDayBounds(timeZone, date)` returns `{ startIso, endIso }` as a **half-open** UTC pair for a *zoned* calendar day, with an explicit midnight-DST refinement (`:173-187`). | The Dashboard needs the same algorithm generalized to week/month/year and fed the **agency** zone instead of the browser zone. A generalization of proven code, not new math. |
| **Required dependencies are already installed.** | `date-fns@^3.6.0`, **`date-fns-tz@^3.2.0`**, `@radix-ui/react-dialog@^1.1.14`, `zod@^3.25.76`, `@testing-library/react@^16`, `vitest@^3.2.4`. | Agency-timezone math and the accessible dialog need **no new dependency**. |
| **Three precedent aggregate RPCs establish the house pattern.** | `get_trusted_today_dialer_stats(p_campaign_id, p_start, p_end)`, `get_campaign_card_stats(p_campaign_ids)`, `get_queue_metrics(p_campaign_id)` — all `SECURITY DEFINER`, all `proconfig = {"search_path=public, pg_temp"}`, all `RETURNS TABLE(…)` counts-only. | A Dashboard RPC follows established practice rather than introducing a novel risk. |
| **Agency-timezone period math already exists in SQL, in production.** | `public.get_agency_group_leaderboard` resolves `SELECT COALESCE(cs.timezone,'UTC') FROM public.company_settings WHERE cs.organization_id = v_caller_org` and then computes `date_trunc('day'\|'week'\|'month'\|'quarter'\|'year', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz`. | **A direct in-repo precedent for exactly the timezone approach contract §4 requires**, and independent evidence that `company_settings.timezone` is the intended canonical agency zone. Postgres `date_trunc('week', …)` is **Monday-based**, matching contract §3. Copy the pattern, but fix the four defects in A16 (add the upper bound, the `direction='outbound'` filter, the explicit `organization_id` predicate, and default to `'America/Chicago'` rather than `'UTC'`). |
| **The recursive "leader + all descendants" resolver already exists.** | `public.get_contact_scope_agents()` — `STABLE`, `SET search_path TO 'public','pg_temp'`, returns profiles where `p.organization_id = public.get_org_id() AND coalesce(p.status,'') IS DISTINCT FROM 'Deleted' AND (p.id = auth.uid() OR public.is_ancestor_of(auth.uid(), p.id))`. | **This is precisely the contract §5 team set** — leader plus every descendant at every level, org-scoped, self-inclusive, derived from `auth.uid()` and never from a client-supplied list. The new RPC should reuse this predicate verbatim rather than inventing one. (Note the frontend's other helper, `getDownlineAgents()`, is **direct-reports-only** and must **not** be used for Team scope.) |
| **The full Leaderboard page is already built correctly.** | `useLeaderboardData.ts` defaults `period` to `"Today"` (`:45`), scopes `organization_id` explicitly (`:250,256,262,382,399,434`), and has a real realtime subscription (`:522`). | The Dashboard's `LeaderboardWidget` is a separate, worse implementation. Converge on the good one rather than patching the bad one. |
| **The KPI row already has the right four cards.** | `StatCards.tsx:33,49,65,79` — Calls Made, Policies Sold, Appointments, Annual Premium Sold. | Contract §2 needs data correctness and a label change, not a redesign. Contacts Reached / Talk Time are correctly absent. |

### 1.5 Canonical values confirmed live (for the implementation to bind against)

```
calls_direction_check      CHECK (direction IN ('outbound','inbound'))     <- canonical outbound
calls_status_check         CHECK (status IN ('ringing','connected','completed','failed','no-answer'))
calls_contact_type_check   CHECK (contact_type IN ('lead','client','recruit'))
profiles_role_check        CHECK (role IN ('Agent','Team Leader','Admin','Super Admin'))
appointments.status        text NOT NULL DEFAULT 'Scheduled'   -- NO CHECK constraint
appointments               has contact_id but NO contact_type column
calls.contact_type         NULL for 68 of 85 live rows (AGENT_RULES gotcha confirmed)
Callbacks live on          campaign_leads.{callback_due_at, scheduled_callback_at, callback_agent_id, callback_note}
Goals live on              profiles.{monthly_call_goal, monthly_appointment_goal, monthly_policies_goal, monthly_premium_goal}
Scope helpers              get_org_id()      STABLE, not sec-def, JWT claim + profiles FALLBACK
                           get_user_role()   STABLE, not sec-def, NO search_path, JWT claim ONLY, no fallback (AGENT_RULES #19 trap)
                           get_user_org_id() STABLE SECURITY DEFINER, profiles lookup
                           is_ancestor_of(a,d) STABLE SECURITY DEFINER, ltree `d.path <@ a.path` (reflexive: leader included)
```

---

## 2. Approved product contract (restated as the build target)

Chris's contract governs. Condensed here so each build can be checked against it; **where the current implementation contradicts it, the contract wins.**

1. **Purpose** — balanced agent overview. Not a dialer launcher, not a report page. Premium, fast, life-insurance-specific.
2. **Primary KPIs** — exactly: Calls Made · Appointments Set · Policies Sold · Annualized Premium. Contacts Reached and Talk Time stay out of the primary row.
3. **Period** — default **Today**; options Today / This Week / This Month / This Year; week starts **Monday**.
4. **Timezone** — the organization's agency timezone for all four periods. Store UTC, convert agency-local boundaries to UTC, half-open `[start, end)`. Identical results for every viewer of the same org/scope/period. Display the agency timezone near the period selector. Never browser-local, never hardcoded.
5. **Scope** — Agent: personal only. Team Leader: Personal ↔ Combined Team (leader + **all** descendants, every level), last view restored. Admin: defaults to **Agency**; may switch Agency / Personal / Team; Team = admin + all descendants; Agency = home org. No arbitrary agent/team pickers this closeout. Security: `own` = auth user; `team` = leader + authorized descendants; `agency` = admin's home org. Every org-wide query explicitly scopes `organization_id`. Agency Group peer data never enters the normal Dashboard. Frontend role strings are never the authorization.
6. **Calls Made** — outbound calls by AgentFlow's canonical direction definition, in the selected period/timezone/org/scope. `calls.duration` stays Twilio-owned; the Dashboard never writes it.
7. **Appointments Set** — credited at **booking (creation) time**, not occurrence. Credit survives cancel and reschedule. A reschedule re-counts only if it creates a genuinely new appointment row. Never removed based on current status. Kept distinct from the Schedule widget.
8. **Policies Sold / Annualized Premium** — counted as soon as the agent records the sale; **`wins` is canonical, never `clients`**; a win counts until it enters a fallout status, at which point it is removed from currently displayed totals **including its original period** (totals reflect current standing, not immutable gross production). Reuse the canonical premium utility; annualize exactly once; label the KPI *Annualized Premium*.
9. **Global period** governs KPIs + drill-downs, Leaderboard, Callbacks, Missed Calls, Schedule, Policy Anniversaries. **Deliberate exception:** Today's callbacks show overdue **plus** due-today. Widget date semantics: Schedule = occurrence; Appointments Set = booking; Callbacks = due; Missed Calls = call time; Anniversaries = anniversary occurrence in period; Leaderboard = selected period.
10. **My Monthly Goal Progress** — the **only** widget exempt from period and scope. Always the logged-in user's own goals and production, always the current agency-timezone calendar month, visually clear that it is current-month-only. No team/agency aggregation, no proration, no per-period goals.
11. **Supporting widgets retained** — Leaderboard, Missed Calls, Callbacks, Policy Anniversaries, Schedule, My Monthly Goal Progress.
12. **Leaderboard** — follows period and view. Team view ranks the authorized team; Agency view ranks the home org; Personal view shows the user's agency rank with ~2 above and ~2 below, user highlighted, "#X of Y in the agency", plus View Full Leaderboard. Never Agency Group peer metrics.
13. **Leadership actions** — in Team/Agency, Callbacks/Schedule/Missed Calls show combined authorized results with the responsible user shown on every cross-user item, actions enabled. Acting on another user's item prompts every time: **A** Handle for [Owner] (responsibility stays; activity recorded under the acting leader) · **B** Reassign to me and handle (transfer, then canonical call workflow) · **C** Cancel. Missed-call history and original attribution are never rewritten; reassignment affects follow-up responsibility only.
14. **Calling** — the existing canonical FloatingDialer/quick-call path only; correct payload; never claim a call started until the canonical path confirms; stop nested-click bubbling; navigate by `contact_id`/`contact_type`. Preserve Voice.js `device.connect()`, TwilioContext re-entrancy guards, call-record/CallSid linkage, status callbacks, dispositions, telemetry. Never introduce REST outbound, two-legged dialing, SIP bridging, Telnyx, `dialer-start-call`, or browser writes to `calls.duration`.
15. **Layout customization** — keep reorder/hide/restore/reset, per-user preferences, safe persistence, **no success toast when Supabase returned an error**, defined normalization for old/removed/duplicated/unknown keys, safe default when preferences are invalid.

---

## 3. Architecture decision

### 3.1 Recommendation

> **HYBRID — Option B (a server-side aggregate RPC) for the numbers; Option A (centralized typed RLS-backed frontend queries) for the PII-bearing list widgets.**
>
> Concretely: **one** new `SECURITY DEFINER` RPC returns the four KPIs, their comparison values, and the leaderboard ranking. The Callbacks / Schedule / Missed Calls / Anniversaries lists stay as typed frontend queries behind RLS, routed through **one** new centralized, explicitly org-scoped data module.

### 3.2 Why not pure Option A

Option A can fix presentation, ordering, bounds and bubbling. It **cannot** meet three hard contract requirements, for structural rather than stylistic reasons:

1. **§5 "Do not rely solely on frontend role strings for authorization" is unachievable for sales data.** Per **B4**, `wins_select` is org-wide with no per-agent predicate. Under Option A an Agent's personal Policies Sold is enforced only by a client-side `.eq("agent_id", …)`. Remove that line and the agent reads the whole agency's production, with no RLS backstop. Only server-side derivation from `auth.uid()` closes it.
2. **§5 "Agency Group peer-readable data must never enter the normal agency Dashboard" is not enforceable client-side.** Per **B3**, `calls`, `wins` and `agent_scorecards` carry permissive peer-read policies that *widen* access. A frontend `.eq("organization_id", orgId)` is defence-in-depth, but `orgId` is client-supplied; substituting a peer org id yields data RLS willingly returns. Only `get_org_id()` evaluated server-side makes the guarantee absolute.
3. **§4 "All viewers must receive identical results" becomes a client-trust assumption under Option A.** Correct agency-timezone boundaries would depend on every client computing them correctly from `company_settings.timezone`. Server-derived boundaries make it structural.

Additionally, **§5 team scope** under Option A requires the client to fetch the descendant user-ID list from `profiles` (org-readable to everyone via the `profiles_select_org` policy, `TO public`, `USING organization_id = get_user_org_id()`) and pass `.in("agent_id", ids)`. For `calls` the RLS Team branch would still constrain the result; for `wins` (**B4**) it would not. That is precisely the "arbitrary user-ID list from the frontend" the contract forbids.

### 3.3 Why not pure Option B

The list widgets return rows the user is entitled to see, are naturally bounded by pagination, and are already correctly constrained per-row by RLS on `appointments` / `calls` / `campaign_leads`. Moving them into a `SECURITY DEFINER` function would **increase** blast radius — the function would have to re-implement per-row visibility RLS already gets right — for no correctness gain, and would return PII from a definer context, against the house convention that these RPCs return "aggregates rather than PII" (AGENT_RULES #16, #17). It would also make the leadership Handle/Reassign flows (§13) harder to build, since those need row identity and ownership, not counts.

### 3.4 Comparison on the required axes

| Axis | A — centralized frontend queries | B — aggregate RPC | Hybrid (recommended) |
|---|---|---|---|
| **Correctness** | Logic in TS, unit-testable with vitest; but ~17 call sites must each get period/scope/org right | Logic defined once in SQL; a client cannot bypass it | Numbers defined once server-side; list semantics unit-testable in TS |
| **RLS / SECURITY DEFINER safety** | ❌ Cannot close **B3** or **B4** | ⚠️ Definer blast radius, mitigated by the house pattern | ✅ Definer limited to counts-only aggregates; PII stays under RLS |
| **Query count (initial paint)** | ~17 today; realistically ~10 after consolidation | 1 for the KPI row + leaderboard | **1 aggregate + 4 list queries = 5** |
| **Rows transferred** | ❌ `buildTalkTimeQuery` streams every `calls.duration` row; leaderboard streams every win | ✅ Counts only | ✅ Counts for aggregates; paginated rows for lists |
| **Scale** | Degrades linearly with call and win volume | Constant-size response | Constant + bounded |
| **Timezone consistency** | Client-trusted | Server-derived, structural | Server-derived for numbers; the same bounds reused by list queries |
| **Testability** | ✅ vitest throughout | ❌ **No pgTAP / SQL test infrastructure exists in this repo** (verified: no `supabase/tests/`, no pgTAP dependency) | ⚠️ Mitigated — see §7.5 |
| **Migration risk** | None | One additive `CREATE FUNCTION`; no table or RLS change | Same as B |
| **Rollback** | `git revert` | `DROP FUNCTION` + revert the frontend adapter | Same as B |

### 3.5 Honest costs of the recommendation, and their mitigations

| Cost | Mitigation |
|---|---|
| SQL cannot be tested by vitest, and this repo has **no** pgTAP infrastructure. | Do **not** invent a SQL test framework in this closeout. Instead: (a) the RPC's inputs (period bounds, scope enum) are computed in TS and **are** unit-tested; (b) a scripted read-only verification matrix runs the RPC via MCP `execute_sql` against seeded fixtures and asserts exact expected numbers (§7.5); (c) the frontend adapter is unit-tested against recorded response shapes. This is the same evidence standard the three precedent RPCs shipped under. |
| Premium annualization would exist in both TS (`monthlyPremiumToAnnual`) and SQL. | Keep `ANNUAL_PREMIUM_MULTIPLIER` as the single documented constant and assert equality in a test that compares the TS constant against RPC output for a known fixture. The duplication is one integer. |
| `SECURITY DEFINER` blast radius. | Copy the house pattern exactly: hard-scope to `auth.uid()` and `public.get_org_id()`, never accept an `organization_id` or user-ID list, `SET search_path = public, pg_temp`, `STABLE`, counts-only return, `REVOKE ALL … FROM PUBLIC, anon` then `GRANT EXECUTE … TO authenticated`. **Note:** the three precedent RPCs currently retain `anon=X` EXECUTE; this plan proposes revoking `anon` on the new function and flags the existing three as a separate, non-blocking follow-up. |

### 3.6 Dependency on the blockers

The RPC's scope resolution depends on `is_ancestor_of`, which is inert until **B2** is fixed. Its sales predicate depends on **B1**, which does not exist yet.

**The architecture is sound either way, but Build 2 does not start until the fallout lifecycle is explicitly designed and approved (D1) and the B2 migration is approved (D3).** There is no interim path in which Build 2 ships gross `wins` and treats contract §8 as satisfied.

**Build 1 is fully independent of both** — it touches no sales KPI beyond the date-bound and `NaN` fixes in `useDashboardStats.ts`, and it neither adds nor changes any Policies Sold / Annualized Premium behavior.

---

## 4. Proposed migrations and RPCs

Everything below is **proposed only**. Nothing is created, applied, or deployed in this phase. Per AGENT_RULES #5, `list_migrations` will be re-run before any apply.

### 4.1 M1 — `fix_hierarchy_path_trigger_and_backfill` *(required for Team scope; approval-gated)*

**Problem:** §1.3 **B2**. **Two parts, both required:**

1. **Fix the trigger function** so the path derives from the row being written rather than committed table state. Proposed shape: `update_hierarchy_path()` walks the chain starting from `NEW.upline_id` (correct at BEFORE-time) and prepends `NEW.id`, instead of calling `compute_hierarchy_path(NEW.id)`. `compute_hierarchy_path(uuid)` stays as-is for the cascade trigger and the backfill, where committed state *is* correct.
2. **Backfill** `UPDATE public.profiles SET hierarchy_path = public.compute_hierarchy_path(id)` in dependency order (roots first), so each child's recomputation sees a corrected parent.

**Risk:** `hierarchy_path` gates the Team branch of live RLS on `calls`, `clients` and `profiles`. The backfill **widens** what Team Leaders can see — from *self only* today to *self + descendants*, the intended and documented behavior. It does **not** widen Agent or cross-org access. Blast radius: 4 production rows.
**Verification:** re-run the stored-vs-computed comparison and the `is_ancestor_of` truth table from §1.3 and assert all match / all true.
**Rollback:** pre-change `hierarchy_path` values captured verbatim before applying; restore by `UPDATE` from the snapshot, and restore both function bodies from `pg_get_functiondef` output archived at the same moment.
**Note:** this is arguably a **production bug fix in its own right** — the hierarchy feature is silently non-functional today, independently of the Dashboard.

### 4.2 M2 — `get_dashboard_overview` RPC *(the architecture; approval-gated, and gated on D1)*

**Proposed contract:**

```sql
CREATE OR REPLACE FUNCTION public.get_dashboard_overview(
  p_scope       text,          -- 'own' | 'team' | 'agency'  (validated against a literal allowlist)
  p_start       timestamptz,   -- half-open [start, end), agency-tz derived, supplied by the caller
  p_end         timestamptz,
  p_prev_start  timestamptz,   -- comparison window, same half-open rule
  p_prev_end    timestamptz
)
RETURNS TABLE (
  calls_made             integer,
  calls_made_prev        integer,
  appointments_set       integer,
  appointments_set_prev  integer,
  policies_sold          integer,
  policies_sold_prev     integer,
  annual_premium         numeric,
  annual_premium_prev    numeric,
  agency_timezone        text,     -- echoed back so the UI labels what was actually used
  scope_user_count       integer,  -- how many users the scope resolved to (aggregate, not a list)
  resolved_scope         text      -- the scope actually applied after authorization
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
```

**Security rules it must obey (mirroring the house pattern):**
- Derives the caller from **`auth.uid()`** and the tenant from **`public.get_org_id()`**. **Never accepts an `organization_id` or a user-ID list.**
- Resolves the authorized user set **internally**, reusing the predicate already proven by `public.get_contact_scope_agents()`: `own` → `auth.uid()`; `team` → profiles where `organization_id = get_org_id() AND coalesce(status,'') IS DISTINCT FROM 'Deleted' AND (id = auth.uid() OR is_ancestor_of(auth.uid(), id))`; `agency` → all non-deleted profiles in `get_org_id()`.
- **Downgrades rather than errors on over-request:** reads the caller's role from **`public.profiles`**, not `get_user_role()` — per AGENT_RULES #19 that function reads the JWT claim only, with no profiles fallback, and a stale claim would silently mis-scope. An Agent requesting `agency` is served `own`, and `resolved_scope` says so.
- Every internal query filters **`organization_id = public.get_org_id()` explicitly**, so Agency Group peer rows on `calls` / `wins` can never enter (**B3**).
- Resolves the agency timezone **itself** from `company_settings.timezone` for the caller's org — following the `get_agency_group_leaderboard` precedent, but defaulting to `'America/Chicago'` (the column default) rather than `'UTC'` — and echoes it back as `agency_timezone` so the UI can only ever label the zone that was actually used. The caller still supplies the boundaries; the RPC **validates** that they match the boundaries the agency zone implies for the requested period, and rejects the call if they do not, so a client cannot widen its own window.
- Validates `p_start < p_end`, rejects windows beyond a sane maximum, and treats every range as `>= start AND < end`.
- Returns **counts and sums only — no PII**.
- Grants: `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION … TO authenticated;`

**Metric definitions inside the RPC:**
- **Calls Made** — `calls` where `agent_id IN (scope)`, `organization_id = get_org_id()`, `created_at >= p_start AND < p_end`, and the direction matches the app's canonical constant. **Note the mismatch:** `OUTBOUND_CALL_DIRECTIONS` (`webrtcInboundCaller.ts:22`) is `["outbound","outgoing"]`, but the live `calls_direction_check` permits only `('outbound','inbound')`, so `'outgoing'` is unreachable in the table. The RPC should mirror the app constant (`direction IN ('outbound','outgoing')`) so the two definitions cannot drift, even though only `'outbound'` matches today.
- **Appointments Set** — `appointments` where `user_id IN (scope)`, `organization_id = get_org_id()`, **`created_at`** in window. **No status filter** (contract §7: the credit survives cancel/reschedule).
- **Policies Sold / Annualized Premium** — `wins` where `agent_id IN (scope)`, `organization_id = get_org_id()`, `created_at` in window; premium = `SUM(premium_amount) * ANNUAL_PREMIUM_MULTIPLIER`, annualized exactly once. **The fallout predicate is a placeholder until D1 is decided.**

**Rollback:** `DROP FUNCTION public.get_dashboard_overview(text,timestamptz,timestamptz,timestamptz,timestamptz);` plus reverting the frontend adapter. Additive — touches no table, policy, or existing function.

### 4.3 M3 / M3b — sales production lifecycle *(HARD BLOCK on D1 — deliberately not drafted)*

Contract §8 requires removing fallen-out sales from currently displayed totals. The problem is wider than a missing column:

- **B1** — no status column, no write path that could set one, no UI that could reach it.
- **A23** — a multi-policy sale produces **one** win (primary only); policies 2..n become opaque JSON on `clients.custom_fields`.
- **A24** — the conversion commits first and a failed `triggerWin` is swallowed, so a client can exist with **no** canonical sale record.
- **A20** — the dialer converted-disposition path creates a win with **no premium** and no policy details.
- **A21** — sale entry has **no Zod**; premium is free-text coerced by a regex strip.

The recommended schema contract and write sequence are in **§8 / D1** (option **A+**: extend `wins` into the canonical per-policy production record). **No migration is drafted here**, because inventing a status taxonomy is exactly what the handoff instructed not to do, and because a status column without a writer would make the metric *look* net-of-fallout while behaving as gross.

Two migrations will be proposed once D1 is decided: **M3** (per-policy columns, `policy_seq`, `status` + CHECK, audit triple) and **M3b** (extend `convert_lead_to_client_atomic` to insert every policy's win **in the same transaction** as the client). A **new Admin-only UPDATE policy on `wins`** is also required and carries its own `#APPROVE_RLS_CHANGE`.

**Build 2 does not begin until D1 is decided.**

### 4.4 M4 — `company_settings.timezone` validation *(optional, low priority)*

The column exists, is unique per org, and holds a valid IANA value in production. It is nullable with an `'America/Chicago'` default. A `CHECK` against `pg_timezone_names` is not possible directly (subqueries are disallowed in CHECK). **Recommendation: validate in the settings UI with zod; no migration.** The RPC and the frontend both `COALESCE(…, 'America/Chicago')`.

### 4.5 Migrations explicitly NOT proposed

- **No change to any existing RLS policy.** The Agency Group peer-read policies are **correct for the Leaderboard's cross-org feature** and must stay; the Dashboard's job is to scope `organization_id` explicitly, not to remove peer access. **No `#APPROVE_RLS_CHANGE` is required by this plan.**
- No change to `calls`, `calls.duration`, any Twilio path, any Edge Function, `dialer_lead_locks`, queue RPCs, or dispositions.
- No `profiles.team_id` population — the ltree path in M1 is the canonical mechanism; `team_id` is left alone and the `appointments` policy divergence is raised as **D4**.

---

## 5. Files proposed per build

### Build 1 — Functional correctness
*No schema, no migration, no deploy. Independent of D1/D2/D3 — can ship as soon as it is approved.*

> **Scope guard:** Build 1 **does not implement, change, or claim any Policies Sold / Annualized Premium behavior.** Its only touch on `useDashboardStats.ts` is the half-open bounds, the missing upper bound, and the `NaN` talk-time fix. The sales KPIs keep reading `clients` — knowingly wrong, and fixed in Build 2 — because correcting them without the approved fallout lifecycle (D1) would present gross production as the finished contract §8 behavior.

| File | Change |
|---|---|
| `src/lib/quick-call.ts` | **NEW** — one typed `dispatchQuickCall({ contactId, name, phone, type })` so no surface can get the event name or payload wrong again |
| `src/lib/dashboard-widget-prefs.ts` | **NEW** — pure, unit-testable normalization + safe-default resolution for saved widget preferences |
| `src/components/dashboard/widgets/CallbacksWidget.tsx` | Canonical `quick-call`; overdue → due-today ordering; lower bound; exact `count` instead of `data.length`; `stopPropagation` on the call button |
| `src/components/dashboard/widgets/MissedCallsWidget.tsx` | Canonical `quick-call`; `stopPropagation` |
| `src/components/dashboard/widgets/AnniversariesWidget.tsx` | Canonical `quick-call` incl. correct `type` for clients vs leads; `stopPropagation` |
| `src/components/dashboard/widgets/AppointmentsWidget.tsx` | `stopPropagation`; half-open bounds |
| `src/components/dashboard/DashboardDetailModal.tsx` | Fix `makeCall` → proper `MakeCallOptions`, `await` it, toast only on a truthy result; navigate by `contact_id` + `contact_type`, not `item.id` and not a hardcoded `tab`; half-open `[start,end)`; stop mutating `now`; remove the "Real-time Intelligence Feed" wording |
| `src/pages/Dashboard.tsx` | Stop widget-body clicks bubbling into `handleWidgetClick`; check the Supabase `{ error }` on save **and** reset before toasting; wire widget-key normalization; default period → **Today** |
| `src/hooks/useDashboardStats.ts` | Half-open bounds; upper bound on the current period; fix the `NaN` talk-time path *(full data rework lands in Build 2)* |
| `src/lib/__tests__/quickCall.test.ts` | **NEW** — asserts the event name is exactly `quick-call` and the payload matches what `FloatingDialer` reads |
| `src/lib/__tests__/dashboardWidgetPrefs.test.ts` | **NEW** |
| `src/components/dashboard/__tests__/dashboardDetailModal.test.tsx` | **NEW** — makeCall args/await/no-false-success; contact navigation |
| `src/pages/__tests__/dashboardLayoutPrefs.test.tsx` | **NEW** — no success toast when Supabase returns an error |
| `src/lib/supabase-dashboard.ts` | **DELETE** (626 lines, zero importers) — *pending D8* |
| `src/components/dashboard/CustomizeDrawer.tsx` | **DELETE** (147 lines, zero importers) — *pending D8* |
| `AGENT_RULES.md` | EDIT — correct §17 (line 119), which cites `supabase-dashboard.ts` as a live surface carrying the stored-counter bug — *pending D8* |

### Build 2 — Data accuracy, timezone, authorization *(migrations M1 + M2; gated on D1, D2, D3)*

`src/lib/dashboard-period.ts` **(NEW — agency-tz half-open bounds for day/week(Mon)/month/year, generalizing `userLocalDayBounds`)** · `src/hooks/useAgencyTimezone.ts` **(NEW)** · `src/lib/supabase-dashboard-overview.ts` **(NEW — the single typed RPC adapter)** · `src/hooks/useDashboardScope.ts` **(NEW — Agency/Personal/Team resolution + persistence)** · `src/hooks/useDashboardStats.ts` *(rewrite onto the RPC)* · `src/components/dashboard/widgets/GoalProgressWidget.tsx` · `src/components/dashboard/widgets/LeaderboardWidget.tsx` · `src/components/dashboard/DashboardDetailModal.tsx` · `src/pages/Dashboard.tsx` · `src/components/dashboard/StatCards.tsx` · `src/components/leaderboard/leaderboardTypes.ts` *(extend `Period` with This Year)* · `src/components/leaderboard/leaderboardPremium.ts` *(half-open bounds)* · `src/integrations/supabase/types.ts` *(surgical add for the new RPC)* · `supabase/migrations/<ts>_fix_hierarchy_path_trigger_and_backfill.sql` **(NEW)** · `supabase/migrations/<ts>_get_dashboard_overview_rpc.sql` **(NEW)** · tests for each new module.

### Build 3 — Leadership actions, UI, accessibility

`src/components/dashboard/DashboardDetailModal.tsx` *(split; migrate to Radix Dialog)* · `src/components/dashboard/detail/*` **(NEW — extracted rows/sections)** · `src/components/dashboard/CrossUserActionDialog.tsx` **(NEW — Handle / Reassign / Cancel)** · `src/lib/callback-ownership.ts` **(NEW)** · `src/components/dashboard/widgets/LeaderboardWidget.tsx` *(personal nearby-rank)* · `src/pages/Dashboard.tsx` *(split; keyboard-accessible cards)* · `src/components/dashboard/DashboardControls.tsx` **(NEW — period + scope + timezone label)** · `src/components/dashboard/DashboardWidgetGrid.tsx` **(NEW)** · tests.

### Build 4 — Verification and release closeout

`src/**/__tests__/*` (role/scope matrix, DST/boundary matrix) · `WORK_LOG.md` · `AGENT_RULES.md` *(new invariant, if one is established)* · `implementation_plan.md`.

---

## 6. Security and RLS analysis

| Requirement (§5) | Status today | After the plan |
|---|---|---|
| `own` = authenticated user only | ⚠️ Client-side `.eq` only for `wins` (**B4**) | ✅ Server-derived from `auth.uid()` |
| `team` = leader + authorized descendants, all levels | ❌ **Non-functional** (**B2**) — resolves to self | ✅ M1 restores `is_ancestor_of`; RPC resolves the set internally |
| `agency` = Admin's home org only | ⚠️ Relies on `get_user_role()`, JWT-claim-only with no fallback (AGENT_RULES #19) | ✅ RPC reads `profiles.role` directly and downgrades on over-request |
| Every org-wide query explicitly scopes `organization_id` | ❌ Zero Dashboard queries do (**A4**) | ✅ Explicit in the RPC and in the centralized list module |
| Agency Group peer data never enters the agency Dashboard | ❌ Latent hole (**B3**) — permissive peer policies on `calls`/`wins`/`agent_scorecards` | ✅ Server-side `get_org_id()` filter makes it structural |
| Never rely solely on frontend role strings | ❌ `usePermissions.getDataScope` is entirely client-derived | ✅ The frontend decides what to *show*; the server decides what to *return* |

**Advisor posture.** The baseline recorded at the 2026-08-01 release is 189 security / 397 performance lints. This plan proposes **one** new `SECURITY DEFINER` function, adding one `authenticated_security_definer_function_executable` info lint consistent with the three precedent RPCs. `get_advisors(security)` will be re-run after M1/M2 and the delta reported. The plan does not propose fixing unrelated pre-existing lints.

---

## 7. Test matrix

Every row from the handoff matrix is covered. **Zero Dashboard tests exist today**, so all are new. House conventions followed: vitest 3.2.4, `@testing-library/react` 16, mocked `@/integrations/supabase/client`.

**7.1 Scope & role** — Agent personal · Team Leader Personal · Team Leader Combined Team · Team Leader last-view persistence · Admin default **Agency** · Admin Personal · Admin Team · Admin Team = admin + **all** descendants (≥3 levels, asserting the multi-level case **B2** currently breaks) · Admin Agency = home org only · Agency Group membership present → **no peer rows in any Dashboard number** · over-request downgrade (Agent asking for `agency` gets `own`, and `resolved_scope` reports it).

**7.2 Date & timezone** — Today/Week/Month/Year in the **agency** timezone · Monday week boundary · **DST spring-forward and fall-back** (the agency zone is `America/Los_Angeles`, so both transitions are live) · half-open `[start,end)` asserted at the exact boundary instant (a row at `end` excluded, a row at `start` included) · two viewers in different browser zones get **identical** numbers · agency timezone displayed next to the period selector.

**7.3 Metric semantics** — wins-vs-clients regression (a `clients` row with no `wins` row must **not** count) · included vs fallout statuses *(pending D1)* · annualized premium computed **exactly once** (assert `× 12`, not `× 144`) · premium sourced from `wins.premium_amount` with the `clients.premium` fallback · appointment booking stays credited after cancel · after reschedule · a genuinely new appointment row counts again · Appointments Set (booking) ≠ Schedule (occurrence) for the same data · Today's callbacks include overdue **and** due-today · callback totals are exact counts, not limited-result lengths · Calls Made counts only `direction='outbound'`.

**7.4 Interaction & UI** — canonical `quick-call` payload and event name · no `agentflow:open-dialer` remains anywhere · nested action does not bubble to the widget/row handler · navigation uses `contact_id`+`contact_type` · cross-user Handle / Reassign / Cancel · acting-user telemetry recorded while original owner preserved · missed-call history never rewritten · preference save surfaces a returned error and does **not** toast success · invalid/legacy/duplicate/unknown widget keys normalize to a safe layout · keyboard activation (Enter/Space), Escape, focus trap, focus restore · `prefers-reduced-motion` · mobile/touch reachability of hover-only actions · loading, empty, partial-error, unauthorized, large-data states · My Monthly Goal Progress ignores every period and scope change.

**7.5 SQL verification (compensating control for the absent pgTAP infrastructure)**
A scripted, **read-only** matrix executed via MCP `execute_sql` against seeded non-production fixtures: for each (role × scope × period) combination, call `get_dashboard_overview` and assert exact expected counts; assert an Agency Group peer org's rows are absent; assert the over-request downgrade; assert the boundary instants. Results recorded in `WORK_LOG.md`. **Fixtures are created and removed in the same session and cleanup verified back to baseline**, using the discipline from the 2026-08-01 release closeout. **Blocked on D5.**

**7.6 Gates on every build** — `npx tsc --noEmit` · targeted Dashboard tests · full `npx vitest run` (baseline **532/532**, 51 files — must not regress) · `npx eslint` on every touched file · `git diff --check`.

---

## 8. Decision register — D1 through D9

> Each entry is written so Chris can approve or reject it **without reading the rest of the plan**. Every "Evidence" row is first-hand: a `path:line` from the repo at `09976ac`, or a read-only query against production project `jncvvsvckxhqgqvkppmj`. Nothing here has been executed.
>
> **Standing constraints on this register:**
> 1. Build 1 stays independent and may ship on its own, but **Build 1 must not present gross `wins` as the finished "Policies Sold" behavior**. It does not touch the sales KPIs beyond the date-bound and `NaN` fixes (see §8.2).
> 2. **Build 2 remains blocked until the full sales production lifecycle in D1 is explicitly designed and approved** — no "ship gross and call it done" path is offered.
> 3. **Approving a design is never approval to execute it.** Every migration, RLS change and production write is a separate approval, itemized in **§8.3**.
> 4. Test fixtures are **local/test-only**. Production is never seeded (D5).
>
> **Corrections in this revision:** **A18/D9-a** is withdrawn as a "silently failing production write" and reclassified as non-blocking stale client-model residue — the exact-baseline evidence is in D9. **D4** is reclassified from optional follow-up to **required**, and now blocks Build 2/3 Schedule behavior. **D1** is expanded from a status column to the full sales lifecycle. **D3** is split into design (D3-i) and production-apply (D3-ii).

---

### D1 — Sales production lifecycle: one canonical record per policy, and how it stops counting

**1. Exact decision required.**
Approve a **sale-entry and production-lifecycle design** covering the whole path from the agent typing a premium to the Dashboard counting it — not merely "add a status column". Specifically: the canonical record per policy, where monthly premium lives, how creation is made durable and idempotent, how converted-disposition workflows collect policy details, the counted-vs-fallout state machine with reasons and restoration, audit attribution, Zod validation, and the **single read predicate** shared by Dashboard, Leaderboard and My Monthly Goal Progress. **This is the hard block on Build 2.**

**2. Current repo and production evidence.**

*a. No fallout state exists.* Live `public.wins`: `id, agent_id, agent_name, contact_id, contact_name, campaign_id, campaign_name, call_id, policy_type, notes, celebrated, created_at, organization_id, premium_amount, idempotency_key`. **No status/voided/active/chargeback column; no CHECK constraint on the table at all.** `clients` has no policy-status column. No UPDATE path to `wins` exists anywhere in `src/`.

*b. Multi-policy sales collapse to one win (**A23**).* `ConvertLeadModal` collects a `PolicyRow[]` (`:32-41`). At submit `:132` `const [primary, ...rest] = policies;`. `primary` fills the client policy columns and the single `triggerWin`; `rest` becomes `additionalPolicies` (`:134-144`) stashed as opaque JSON in `clients.custom_fields[ADDITIONAL_POLICIES_KEY]` (`supabase-conversion.ts:32-34`). **Three policies ⇒ Policies Sold = 1, Annualized Premium = primary only**, and policies 2..n can never carry a fallout state because no record exists for them.

*c. The win is created after commit and its failure is swallowed (**A24**).* `supabase-conversion.ts:89-96` commits via `convert_lead_to_client_atomic`; `:104-120` then runs `triggerWin` inside `try { … } catch (e) { console.warn("Win celebration failed (conversion already committed):", e); }`. Result: **a client can exist with no canonical sale record**, invisible to every production metric, with no retry and no reconciliation.

*d. The dialer path creates an incomplete win (**A20**).* `FloatingDialer.tsx:790-797` calls `triggerWin` with `agentId, agentName, contactName, contactId, policyType: disp.name, organizationId` — **no `premiumAmount`, no carrier, no policy number, no face amount, no `campaignId`, no `idempotencyKey`.** `wins.premium_amount` lands `NULL` ⇒ **1 policy, $0 premium**. `policy_type` is set to the *disposition name*, not a policy type.

*e. The premium fallback must not be used to paper over (d).* `leaderboardPremium.annualPremiumForWin` does `fromWin || fromClient`, where `fromClient` is `clients.premium` keyed on `win.contact_id`. On the dialer path `contactId` is `selectedContact?.id` — for a lead-originated quick call that is a **lead** id and matches no client. Where it *did* match, it would attribute **the client's primary-policy premium to a different policy** — fabricating a number. This fallback is a leaderboard convenience and must not become the sales-integrity mechanism.

*f. No Zod on sale entry (**A21**).* `ConvertLeadModal.tsx` contains zero `zod`/`z.` references; `premiumAmount` is a free-text `string` (`:38`) coerced by `parseCurrencyToNumber`, which strips all but `[0-9.-]` — so `"12.5.5"`, `"-40"` and `"1-2"` all parse to something. AGENT_RULES §7 requires Zod on forms and editable modal state.

*g. Read predicate is duplicated four ways today.* `useDashboardStats.ts:93-101` (`clients`), `DashboardDetailModal.tsx:265,273` (`clients`), `LeaderboardWidget.tsx:48` (`clients`), `GoalProgressWidget.tsx:97` (`wins`), `useLeaderboardData.ts:397` (`wins`), and the live `get_agency_group_leaderboard` (`clients`). **Six surfaces, three different definitions.**

*h. Production:* `wins` = **0 rows**, `clients` = **0 rows**. Nothing to migrate; the entire cost is forward-looking. `wins.idempotency_key` already carries a unique-on-non-null index used as `conversion:<lead-id>`.

**3. Recommended option and why — the smallest design that satisfies every guarantee.**

> **Option A+ — extend `wins` into the canonical per-policy production record.** Keep one table. Do **not** introduce a second `policies` table in V1.

Rationale: every required guarantee is reachable by extending `wins`, and `wins` is already the table the Leaderboard, Goal Progress and the contract all name as canonical. Option B's separate `policies` table would add a one-to-one join, a second write path, a second RLS surface and a migration of the very concept the contract calls "wins" — for no capability that A+ lacks. A one-to-one relationship is a column set, not a table.

**Recommended schema contract** (for approval — **no migration is drafted or applied**):

| Column | Type | Notes |
|---|---|---|
| *(existing)* | | `id, agent_id, contact_id, campaign_id, call_id, organization_id, created_at, premium_amount, policy_type, idempotency_key, celebrated, …` unchanged |
| `premium_amount` | `numeric` | **unchanged meaning — MONTHLY premium, stored once** (D2). Becomes `NOT NULL` for new rows via the write contract, not a table-wide constraint (0 existing rows, but keep the constraint decision explicit). |
| `carrier` | `text NULL` | per-policy detail, today only on `clients` |
| `policy_number` | `text NULL` | per-policy detail |
| `face_amount` | `numeric NULL` | per-policy detail |
| `effective_date` | `date NULL` | per-policy; note `clients.effective_date` is `text` (**A13**) — the new column should be a real `date` |
| `policy_seq` | `smallint NOT NULL DEFAULT 1` | 1 = primary, 2..n = additional policies from the same sale |
| `status` | `text NOT NULL DEFAULT 'active'` | CHECK allowlist — **Chris names the values**; proposed: `active`, `declined`, `canceled`, `charged_back`, `lapsed`, `not_taken` |
| `status_reason` | `text NULL` | free-text detail for the transition |
| `status_changed_at` | `timestamptz NULL` | audit timestamp |
| `status_changed_by` | `uuid NULL` | audit attribution → `profiles.id` |
| `idempotency_key` | `text` | **extended convention**: `conversion:<lead-id>:<policy_seq>` so each policy in a multi-policy sale is independently idempotent; dialer path uses `disposition:<call-id>` |

**Recommended write sequence** (for approval — not implemented):

1. **Zod-validate the whole `PolicyRow[]`** in `ConvertLeadModal` before any network call: premium `> 0` and finite, face amount `>= 0`, policy type in the allowlist, dates parseable or blank. Reject the submit; never coerce silently.
2. **Create client + every win in ONE transaction.** Extend `convert_lead_to_client_atomic` to accept `p_policies jsonb` (the full array) and insert **one `wins` row per policy** inside the same transaction that creates the client. This is what closes **A23** and **A24** together: no client can commit without its canonical sale records, and there is no after-commit window to swallow.
3. **Idempotency** is per policy via `conversion:<lead-id>:<policy_seq>`; a retry is a no-op on the unique index, exactly as today.
4. **The dialer converted-disposition path stops creating bare wins.** `FloatingDialer` must route through the **canonical sale-entry flow** (the same Zod-validated policy form) and never call `triggerWin` with partial data. Until that UI exists, the correct behavior is to **block the conversion and prompt for policy details** — not to write a premium-less win. **The `clients.premium` fallback must not be used to synthesize a premium for these rows.**
5. **Fallout is a status transition, never a delete.** `wins` stays append-only; `status`, `status_reason`, `status_changed_at`, `status_changed_by` are set by an Admin-only update path. **Restoration/reinstatement** is the same mechanism in reverse — set `status` back to `active` with a new reason/timestamp/actor. Because every transition stamps the audit triple, a reinstated policy retains its history.
6. **One shared read predicate.** A single exported helper — proposed `isCountedWin(win)` in TS and the identical predicate inside the M2 RPC — defined as `status = 'active'`. Dashboard KPIs, the drill-down modal, the Leaderboard (org path) and My Monthly Goal Progress all consume it. No surface may inline its own.

**Guarantee check:**

| Required guarantee | How A+ delivers it |
|---|---|
| One canonical production record per policy entered | one `wins` row per `PolicyRow`, keyed by `policy_seq` |
| Monthly premium stored once | `wins.premium_amount` only; annualize at read via `monthlyPremiumToAnnual` |
| Idempotent / durable creation | per-policy `idempotency_key` + creation inside the conversion transaction |
| No client without its canonical sale record | client and wins commit together in `convert_lead_to_client_atomic` |
| Converted-disposition workflows collect policy details canonically | dialer routes through the same Zod-validated sale-entry flow; no bare-win path remains |
| Explicit counted vs fallout state | `status` + CHECK allowlist; `isCountedWin` = `status = 'active'` |
| Approved fallout reasons | the CHECK allowlist Chris names, plus free-text `status_reason` |
| Restoration / reinstatement | same transition mechanism back to `active`, fully audited |
| Status-change audit attribution + timestamp | `status_changed_by` + `status_changed_at` on every transition |
| Zod validation | on `PolicyRow[]` at sale entry, before any write |
| Single read predicate | `isCountedWin` in TS + the identical SQL predicate in the M2 RPC |

**4. Every viable alternative.**
- **A+ (recommended)** — extend `wins` as the V1 per-policy production record, as above.
- **A-minimal** — add only `status` + audit columns; leave multi-policy, the after-commit gap and the dialer path unfixed. **Rejected:** it satisfies contract §8 while leaving Policies Sold structurally undercounting, which is a worse failure than the one it fixes.
- **B — first-class `policies` table, one-to-one with `wins`.** `policies` holds carrier/number/face/dates/status; `wins` stays a celebration record. Cleaner long-term if policies later need their own lifecycle (riders, renewals, commission schedules) that genuinely diverges from "a sale happened". **Costs:** a new table, new RLS, a new write path, a join on every read, and two rows per sale to keep consistent. **Recommend deferring to V2** — adopt it when a policy needs to outlive or diverge from its win, which nothing in the current product requires.
- **C — defer §8 by name.** Build 2 ships gross production with a visible qualifier and the plan records contract §8 as unmet. Still available if Chris wants the smallest possible Build 2, but it leaves **A20/A23/A24** live.

**5. Affected files, migrations, RLS, production data.**
- **Migration M3** (schema contract above) — **not drafted**, pending this decision.
- **Migration M3b** — extend `convert_lead_to_client_atomic(p_lead_id, p_client, p_policies jsonb)` to insert wins in-transaction. Touches a live `SECURITY DEFINER` function; needs its own review.
- **Frontend:** `src/components/contacts/ConvertLeadModal.tsx` (Zod + multi-policy payload), `src/lib/supabase-conversion.ts` (single-transaction call, remove the swallow), `src/lib/win-trigger.ts` (per-policy contract), `src/components/layout/FloatingDialer.tsx` (route to canonical sale entry; stop bare wins), `src/lib/leaderboard-premium.ts` / `leaderboardPremium.ts` (drop the client fallback as a sales-integrity mechanism), plus the new shared `isCountedWin` module.
- **RLS:** a **new, narrow UPDATE policy on `wins`** is required (there is none today). Recommended: Admin/Super Admin within `organization_id = get_org_id()`, restricted to the status columns. **This is an RLS addition and needs `#APPROVE_RLS_CHANGE`.**
- **Production data:** `wins` = 0 rows, so the backfill is a no-op today. No existing row is rewritten.

**6. Build blocked.** **Build 2 (hard block).** Also gates the §7.3 sales rows and the Leaderboard production figures in **D7**.

**7. Security and telemetry implications.**
- `wins` SELECT is org-wide plus Agency Group peers (**B3/B4**). Adding a *writable* revenue-affecting status makes the new UPDATE policy security-critical: **an agent must not be able to change status on their own or anyone's win** — otherwise they can hide a chargeback or suppress a rival. Admin-only, same-org, status-columns-only.
- **Append-only is a security property, not just hygiene.** Deleting a win would destroy `idempotency_key` and let a retried conversion re-insert, so deletes must remain impossible for `authenticated`.
- **Telemetry:** unchanged. No `calls`, `calls.duration`, disposition, campaign or Twilio surface is touched. The dialer change is a **UI routing change** — the conversion still runs the existing disposition/save path; only the win-creation call site moves behind the canonical form.

**8. Verification and rollback.**
- *Verification (local fixtures only, D5):* a 3-policy conversion creates exactly 3 wins with `policy_seq` 1..3 and the correct per-policy premiums; a forced failure of the win insert **rolls back the client** (proving A24 closed); a retried conversion creates no duplicates; the dialer converted-disposition path **cannot** produce a win with a null premium; each fallout status removes the win from KPI, Leaderboard **and** Goal Progress simultaneously via the one predicate, including in its original period; reinstatement restores it and the audit triple is populated on both transitions; a non-Admin UPDATE on `wins.status` is rejected by RLS; Zod rejects `"12.5.5"`, `"-40"`, `""` and `"abc"`.
- *Rollback:* drop the added columns and the new UPDATE policy; revert `convert_lead_to_client_atomic` from its archived `pg_get_functiondef` body; `git revert` the frontend. With 0 production rows there is no data to restore.

**9. Exact approval language.**
> **D1-A+ (recommended):** "Approved: extend `public.wins` as the V1 canonical per-policy production record, per the schema contract and write sequence in §8/D1. The fallout status set is: `<Chris lists the exact values>`. One `wins` row per policy entered; client and wins commit in one transaction; monthly premium stored once in `wins.premium_amount`; the converted-disposition dialer path must collect policy details through the canonical Zod-validated sale-entry flow and must never fabricate a premium from the client fallback; wins are append-only and fallout is an audited status transition, reversible by reinstatement; only an Admin in the same organization may change status. Draft the migrations for separate approval — do not apply anything yet."
> **D1-B:** "Rejected A+; design a first-class `policies` table one-to-one with `wins` instead, and re-present."
> **D1-C:** "Approved: defer §8. Build 2 ships gross production, the KPI must visibly say so, and WORK_LOG must record that contract §8, A20, A23 and A24 remain unmet."

---

### D2 — Confirm `wins.premium_amount` is MONTHLY premium

**1. Exact decision required.**
Confirm that `wins.premium_amount` and `clients.premium` store **monthly** premium in dollars, and that Annualized Premium = that value **× 12, applied exactly once**.

**2. Current repo and production evidence.** *(traced end-to-end from the sale-entry UI, not inferred from empty production data)*
- **Sale-entry UI:** `src/components/contacts/ConvertLeadModal.tsx:304` — the field label is literally **`Monthly Premium ($)`**.
- **Validation schema:** **none.** `ConvertLeadModal.tsx` contains zero `zod` / `z.` references; `premiumAmount` is a raw `string` (`:38`). See **A21**.
- **Write path:** `supabase-conversion.ts:71` `const premium = parseCurrencyToNumber(policyInfo.premiumAmount)` → written to **`clients.premium`** (`:78`) and passed as **`premiumAmount: premium`** to `triggerWin` (`:113`) → `wins.premium_amount` (`win-trigger.ts:55`). **One parsed value populates both columns**, so the two are the same unit by construction.
- **Historical migration — authoritative:** `supabase/migrations/20260521220000_wins_premium_amount.sql`
  ```sql
  -- Monthly premium on wins (annual premium sold = premium_amount * 12 on leaderboard).
  COMMENT ON COLUMN public.wins.premium_amount IS
    'Monthly policy premium in dollars; leaderboard annual premium = premium_amount * 12';
  ```
  The live `COMMENT` is still present on the column.
- **Canonical utility:** `leaderboardTypes.ts:78-79` `monthlyPremiumToAnnual = (monthly) => monthly * ANNUAL_PREMIUM_MULTIPLIER`; `leaderboardPremium.annualPremiumForWin()` applies it exactly once over `wins.premium_amount` with a `clients.premium` fallback.
- **Corroborating rename:** `20260428120000_rename_monthly_talk_time_to_premium_goal.sql` renamed `profiles.monthly_talk_time_goal_hours` → `monthly_premium_goal` and reset the default to `0` "(dollars, not hours)" — so the goal it is compared against is also monthly dollars.
- **Apparent counter-evidence, resolved:** `GoalProgressWidget.tsx:118` and `AgentScorecardModal.tsx:66` sum `premium_amount` **without** annualizing — but both compare against `profiles.monthly_premium_goal`. Monthly-vs-monthly is correct and **consistent with** the monthly reading, not against it.

**3. Recommended option and why.** **Monthly — confirmed.** The column's own `COMMENT`, the migration that created it, and the UI label all say the same thing, and a single parsed value feeds both columns. This is as close to settled as repo evidence gets; the confirmation requested is a business sign-off, not a technical open question.

**4. Every viable alternative.**
- **(a, recommended)** Monthly; annualize `× ANNUAL_PREMIUM_MULTIPLIER` exactly once at the read boundary.
- **(b)** Annual — would contradict the column comment, the migration, and the UI label. Would require re-labelling the modal field and a data audit. **No supporting evidence found.**
- **(c)** Ambiguous / mixed by entry path — cannot be ruled out for hand-entered legacy data, but production has **0 rows**, so there is no legacy data to be ambiguous.

**5. Affected files, migrations, RLS, production data.**
Read-only confirmation. Consumers that would be aligned in Build 2: `useDashboardStats.ts:164` (currently `* 12` on `clients.premium` — wrong source), `DashboardDetailModal.tsx:426`, `LeaderboardWidget.tsx`, `supabase-users.ts:549`, and the M2 RPC's premium expression. **No migration, no RLS, no production data change.**

**6. Build blocked.** **Build 2** (§7.3 "annualized premium computed exactly once"). Build 1 is unaffected.

**7. Security and telemetry implications.**
None directly. One adjacent integrity issue surfaced while tracing the write path and needs its own answer: **A20** — `FloatingDialer.tsx:790` calls `triggerWin` with **no `premiumAmount`**, so quick-call conversion wins persist `premium_amount = NULL` and contribute **1 policy but $0 premium**. The `clients.premium` fallback in `annualPremiumForWin` keys on `contact_id`, which on that path is usually a **lead** id and will not match a client row. Also no `idempotencyKey` and no `campaignId` on that path. **Recommend folding the FloatingDialer premium fix into Build 2** — see the approval language.

**8. Verification and rollback.**
- *Verification:* a unit test pinning `monthlyPremiumToAnnual(100) === 1200`; a test asserting the RPC and the TS helper agree for a fixture; a grep-style test asserting no surface applies `* 12` twice; a test asserting a `premium_amount = NULL` win contributes 0 premium but still counts as 1 policy (documenting **A20** until it is fixed).
- *Rollback:* `git revert`. Nothing persisted.

**9. Exact approval language.**
> "Confirmed: `wins.premium_amount` and `clients.premium` store **monthly** premium in dollars. Annualized Premium = monthly × 12, applied exactly once at the read boundary, via the canonical `monthlyPremiumToAnnual` helper. Also approved: fix `FloatingDialer.tsx:790` in Build 2 to pass `premiumAmount` (and an idempotency key) so quick-call conversion wins are not recorded with a null premium."

---

### D3 — Repair the production hierarchy (`profiles.hierarchy_path`)

> **Two separate approvals.** This entry is deliberately split. Approving the **design** authorizes writing and locally testing the migration file. Applying it to production is a **second, separate approval**. Approval of the design is **not** approval to execute M1.

**1. Exact decision required.**
**(D3-i)** Approve the M1 *design* and authorize creating + locally testing the migration file.
**(D3-ii)** Separately, later, approve *applying* M1 to production — after the local verification evidence is presented.

**2. Current repo and production evidence.**

*The four production `profiles` rows, before and after (read-only; `compute_hierarchy_path()` was called but nothing was written):*

> **Live identifiers are intentionally omitted — this is a PUBLIC repository.** The rows below use stable labels rather than real `profiles` / `auth.users` UUIDs, and abstract `<label>` forms rather than real `ltree` paths, so no production identity mapping is published. Everything needed to review the decision (which rows change, at what depth, and the exact before/after shape) is preserved. When M1 is eventually authorized, the operator obtains the real ids **from the database directly** and from the pre-apply snapshot named in §8/D3.8 — nothing operational depends on them appearing here.

| # | Profile | role | upline | stored `hierarchy_path` (BEFORE) | correct path (AFTER) | changes? |
|---|---|---|---|---|---|---|
| 1 | `ADMIN-A` | Admin | `NULL` | `<admin-a>` | *(identical)* | **No** |
| 2 | `ADMIN-B` | Admin | `NULL` | `<admin-b>` | *(identical)* | **No** |
| 3 | `TEAM-LEADER` | Team Leader | `ADMIN-A` | `<team-leader>` (self only) | `<admin-a>.<team-leader>` | **Yes** |
| 4 | `AGENT` | Agent | `TEAM-LEADER` | `<agent>` (self only) | `<admin-a>.<team-leader>.<agent>` | **Yes** |

**Exactly 2 of 4 rows change. All four are in organization `a0000000-0000-0000-0000-000000000001`. No other table is written.**

*Live truth table today:* `is_ancestor_of(TL, Agent)` = **false** · `is_ancestor_of(Admin, TL)` = **false** · `is_ancestor_of(TL, TL)` = **true**.

*Bug 1 (**B2**).* `trg_update_hierarchy_path` is `BEFORE INSERT OR UPDATE OF upline_id` → `update_hierarchy_path()` → `compute_hierarchy_path(NEW.id)`, which resolves the chain via `SELECT upline_id FROM public.profiles WHERE id = current_id` — **committed table state, not `NEW`**. On `BEFORE INSERT` the row does not exist, so the loop exits immediately and the path is the self-label alone. On `BEFORE UPDATE` the table still holds the *old* `upline_id`.

*Bug 2 (**A22**).* `cascade_hierarchy_update()` updates only `WHERE upline_id = NEW.id`, and its `UPDATE` touches `hierarchy_path` — **not** `upline_id` — so it never re-fires the `AFTER UPDATE OF upline_id` cascade. **Depth ≥ 2 is never recomputed.**

*Guard interaction (verified).* `enforce_profile_field_authorization()` opens with `IF actor_id IS NULL THEN RETURN NEW; END IF;` — migration/service-role context is trusted, so the backfill passes. For an authenticated actor it enforces `NEW.hierarchy_path IS DISTINCT FROM OLD.hierarchy_path AND NEW.hierarchy_path IS DISTINCT FROM public.compute_hierarchy_path(NEW.id)` → **the fix must keep producing exactly `compute_hierarchy_path(NEW.id)`**, or legitimate Admin-driven cascades begin failing. The guard is named `trg_00_*` so it fires before the recompute trigger and inspects the client-supplied row.

**3. What M1 must repair (all six, in one migration).**

1. **BEFORE INSERT/UPDATE path computation from `NEW.upline_id`** — not from committed table state (Bug 1).
2. **Recursive descendant recomputation at every depth** — replace the direct-children loop with a recursive CTE (Bug 2).
3. **The two currently incorrect production paths** — rows #3 and #4, via a roots-first backfill.
4. **Cycle protection** — `compute_hierarchy_path` already has `max_depth := 20`; the new recursive CTEs add `p.id <> …` self-reference guards and must use `UNION` (not `UNION ALL`) so a cycle terminates.
5. **Cross-organization protection** — every recursive step must additionally constrain `p.organization_id = <the row's org>`, so a mis-set `upline_id` pointing at another tenant can never splice two orgs into one ltree path. **The current functions do not check this** — that is a latent tenancy hazard the repair should close while it is in there.
6. **Interaction with `enforce_profile_field_authorization()`** — verified compatible (above); the migration must include a post-apply assertion that an authenticated Admin can still change a downline `upline_id` without tripping the guard.

*Proposed SQL — **NOT executed**, for review:*
```sql
-- (1)+(5): derive from NEW, org-constrained.
CREATE OR REPLACE FUNCTION public.update_hierarchy_path()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_parent_path ltree;
BEGIN
  IF NEW.upline_id IS NULL OR NEW.upline_id = NEW.id THEN
    NEW.hierarchy_path := text2ltree(replace(NEW.id::text, '-', '_'));
  ELSE
    SELECT p.hierarchy_path INTO v_parent_path
      FROM public.profiles p
     WHERE p.id = NEW.upline_id
       AND p.organization_id IS NOT DISTINCT FROM NEW.organization_id;  -- (5)
    NEW.hierarchy_path := COALESCE(v_parent_path, ''::ltree)
                          || text2ltree(replace(NEW.id::text, '-', '_'));
  END IF;
  RETURN NEW;
END; $$;

-- (2)+(4): recursive, cycle-safe, org-constrained cascade.
CREATE OR REPLACE FUNCTION public.cascade_hierarchy_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  WITH RECURSIVE sub AS (
    SELECT id FROM public.profiles
     WHERE upline_id = NEW.id AND id <> NEW.id
       AND organization_id IS NOT DISTINCT FROM NEW.organization_id
    UNION                                   -- UNION, not UNION ALL: terminates on a cycle
    SELECT p.id FROM public.profiles p JOIN sub s ON p.upline_id = s.id
     WHERE p.id <> s.id
       AND p.organization_id IS NOT DISTINCT FROM NEW.organization_id
  )
  UPDATE public.profiles t
     SET hierarchy_path = public.compute_hierarchy_path(t.id)
    FROM sub WHERE t.id = sub.id;
  RETURN NEW;
END; $$;

-- (3): one-time roots-first backfill.
WITH RECURSIVE ordered AS (
  SELECT id, organization_id, 0 AS depth FROM public.profiles
   WHERE upline_id IS NULL OR upline_id = id
  UNION
  SELECT p.id, p.organization_id, o.depth + 1
    FROM public.profiles p JOIN ordered o ON p.upline_id = o.id
   WHERE p.id <> o.id AND p.organization_id IS NOT DISTINCT FROM o.organization_id
)
UPDATE public.profiles t
   SET hierarchy_path = public.compute_hierarchy_path(t.id)
  FROM ordered d WHERE t.id = d.id;
```
*Transaction strategy:* all parts in **one migration = one transaction**. Postgres DDL is transactional, so a backfill failure rolls back the function replacements — no half-applied state. Capture the pre-image immediately before applying.

**4. Every viable alternative.**
- **(a, recommended)** Fix both functions, add cycle + cross-org guards, and backfill.
- **(b)** Backfill only. **Rejected** — every new user reacquires a broken path (Bug 1).
- **(c)** Fix functions only. **Rejected** — rows #3/#4 stay broken until someone edits their `upline_id`.
- **(d)** Defer Team scope entirely: Build 2 ships Agent + Admin/Agency only, the Team Leader toggle is **hidden** rather than shown-and-broken, and contract §5 Team is recorded unmet. Legitimate if Chris wants zero production data change this closeout.

**5. Affected files, migrations, RLS, production data — full hierarchy-dependent surface.**

M1 alters **no policy text**. It changes the *data those policies read*, so every hierarchy-dependent surface changes behavior. Complete inventory, verified live from `pg_policies` and `pg_proc`:

**Policies (7) — Team Leader `TEAM-LEADER` before → after, all within org `a0000000…0001`:**

| Table | Policy | Cmd | Predicate | TL today | TL after M1 |
|---|---|---|---|---|---|
| `calls` | Calls Hierarchical Access | **ALL** | `is_ancestor_of(auth.uid(), agent_id)` in **USING and WITH CHECK** | own calls only | own **+ Agent's** calls — **read, insert, update, delete** |
| `clients` | Clients Hierarchical Access | **ALL** | `is_ancestor_of(auth.uid(), assigned_agent_id)` in **USING and WITH CHECK** | own only | own **+ Agent's** clients — **read and write** |
| `leads` | Leads Hierarchical Access | **ALL** | `is_ancestor_of(auth.uid(), user_id)` in **USING and WITH CHECK** | own only | own **+ Agent's** leads — **read and write** |
| `recruits` | Recruits Hierarchical Access | **ALL** | `is_ancestor_of(auth.uid(), assigned_agent_id)` in **USING and WITH CHECK** | own only | own **+ Agent's** recruits — **read and write** |
| `contact_emails` | contact_emails_select | SELECT | `is_ancestor_of(auth.uid(), owner_user_id)` | own only | own **+ Agent's** email threads — **read** |
| `profiles` | profiles_select_hierarchical | SELECT | `is_ancestor_of(auth.uid(), id)` | self | self + Agent — **no net change**: `profiles_select_org` (`TO public`, `organization_id = get_user_org_id()`) already grants org-wide profile SELECT |
| `tasks` | tasks_select_team_leader | SELECT | **raw ltree** `subject.hierarchy_path <@ viewer.hierarchy_path` (not via `is_ancestor_of`) | own only | own **+ Agent's** tasks — **read** |

**Functions that change behavior (11, verified via `pg_proc` body search):**
`get_contact_scope_agents` (TL set `{self}` → `{self, Agent}`) · `is_ancestor_of` · `compute_hierarchy_path` · `update_hierarchy_path` · `cascade_hierarchy_update` · `enforce_profile_field_authorization` · `_contacts_filtered_leads` (Contacts search/attempt-count RPC) · `add_leads_to_campaign` · `convert_lead_to_client_atomic` · `delete_contact` · `_import_undo_context`.

**This is materially wider than Dashboard reads** — Contacts search, campaign lead assignment, contact deletion and lead conversion authorization all widen for Team Leaders at the same moment.

- **Admins:** unaffected — they match via their own `get_user_role() = 'Admin'` branch on every policy above.
- **Agents:** unaffected — `id = auth.uid()` / `agent_id = auth.uid()` branches are untouched.
- **Cross-organization:** **no change.** Every branch above is additionally gated on `organization_id = get_org_id()`, and the repair adds an org constraint to the path computation itself.
- **Production data written:** `public.profiles.hierarchy_path`, **2 rows**. Nothing else.

**6. Build blocked.** **Build 2** (Team scope) and **Build 3** (leadership actions). Also a prerequisite for **D4**.

**7. Security and telemetry implications.**
- **This is a widening change across seven policies, four of them `FOR ALL`.** The most consequential consequence, stated plainly: **a Team Leader gains INSERT/UPDATE/DELETE on a descendant's `calls`, `clients`, `leads` and `recruits`**, because those policies put `is_ancestor_of` in the `WITH CHECK` as well as the `USING`. That is the documented intent of the hierarchy feature, but it has never actually been in force in this production database, so it will be new behavior on the day it is applied.
- **`calls` write access is the one to weigh most carefully.** A Team Leader being able to UPDATE a descendant's `calls` rows touches telemetry. Mitigating: AGENT_RULES #8 makes `twilio-voice-status` the sole writer of `calls.duration`, the browser never writes it, and this repair does not change that — but the *policy* would permit a hand-crafted client write. If Chris wants that closed, the correct follow-up is a column-scoped or restrictive policy on `calls`, tracked separately; it is pre-existing policy shape, not something M1 introduces.
- **Cross-org tenancy is strengthened**, not weakened: repair item (5) prevents a mis-set `upline_id` from splicing two organizations into one ltree path.
- **No Twilio, Edge Function, disposition, campaign-queue or `calls.duration` behavior changes.**

**8. Verification and rollback.**
- *Pre-apply (production):* archive `SELECT id, organization_id, upline_id, hierarchy_path::text FROM public.profiles ORDER BY id` and `pg_get_functiondef` for `update_hierarchy_path` and `cascade_hierarchy_update` to `~/agentflow-release-rollback/<date>-dashboard/`.
- *Local descendant-resolution tests (fixtures only, D5 — these gate D3-ii):* a **four-level** chain Admin → TL → Agent → Sub-Agent asserting the TL resolves **both** descendants (proves Bug 1 and Bug 2 together); a re-parent test asserting depth-2+ is recomputed; an insert-with-upline test asserting a nested path at creation; a **cycle** fixture (A→B→A) asserting termination and no infinite loop; a **cross-org** fixture with `upline_id` pointing into another organization, asserting the path does not splice and no cross-tenant row becomes visible; a sibling test asserting one TL never resolves another TL's downline; an authenticated-Admin `upline_id` change asserting `enforce_profile_field_authorization` does not reject the cascade.
- *Post-apply (production, read-only):* stored path = `compute_hierarchy_path(id)` for all 4 rows; truth table now `is_ancestor_of(TL, Agent) = true`, `is_ancestor_of(Admin, TL) = true`, `is_ancestor_of(Agent, TL) = false`; `get_contact_scope_agents()` returns 2 for the TL and 4 for the Admin; every returned profile has `organization_id = a0000000-…-0001`; `get_advisors(security)` delta reported.
- *Rollback:* one transaction — `UPDATE public.profiles SET hierarchy_path = <archived>::ltree` for the 2 changed rows, then restore both function bodies from the archived definitions. Restoring the pre-image re-breaks Team scope, which is the pre-change state.

**9. Exact approval language.**
> **D3-i (design + local test only):** "Approved: create migration M1 and test it locally. It must repair all six items in §8/D3.3 — NEW-based path computation, recursive descendant recomputation at every depth, the two incorrect production rows, cycle protection, cross-organization protection, and verified compatibility with `enforce_profile_field_authorization()`. **This is not approval to apply it to production.**"
> **D3-ii (production apply — separate, later):** "Approved: apply M1 to production. I have reviewed the local verification evidence. I accept that Team Leader `TEAM-LEADER` gains read **and write** access to Agent `AGENT`'s `calls`, `clients`, `leads` and `recruits`, and read access to their `contact_emails` and `tasks`, via the existing `FOR ALL` hierarchical policies. No policy text is altered. Capture the pre-image first."

---

### D4 — `appointments` must move to canonical hierarchy scoping *(REQUIRED, not optional)*

> **Corrected classification.** An earlier revision listed D4 as an optional follow-up. It is not. Contract §5 requires Team and Agency Schedule behavior, and §13 requires leadership actions on cross-user appointments. Neither is deliverable while the `appointments` Team Leader branch is dead. **D4 blocks the Schedule/appointment portions of Build 2 and Build 3.**

**1. Exact decision required.**
Approve replacing the dead `profiles.team_id` Team Leader branch on `appointments` with the canonical ltree resolver, **and** approve the exact Team Leader capability set (view / edit / create / reassign / delete). Requires `#APPROVE_RLS_CHANGE`, a separately approved migration, and a separate production-apply approval.

**2. Current repo and production evidence.**

All four policies, verbatim from `pg_policies` — **all PERMISSIVE, all `TO authenticated`**:

| Policy | Cmd | `USING` | `WITH CHECK` |
|---|---|---|---|
| `appointments_select` | SELECT | `organization_id = get_org_id()` AND (`user_id = auth.uid()` OR `created_by = auth.uid()` OR `get_user_role()='Admin'` OR `is_super_admin()` OR **team_id branch**) | — |
| `appointments_insert` | INSERT | — | `organization_id = get_org_id()` AND (`user_id = auth.uid()` OR `created_by = auth.uid()` OR **`get_user_role() IN ('Admin','Team Leader')`** OR `is_super_admin()`) |
| `appointments_update` | UPDATE | same as SELECT (incl. **team_id branch**) | `organization_id = get_org_id()` AND (`user_id = auth.uid()` OR `created_by = auth.uid()` OR **`get_user_role() IN ('Admin','Team Leader')`** OR `is_super_admin()`) |
| `appointments_delete` | DELETE | `organization_id = get_org_id()` AND (`user_id = auth.uid()` OR `created_by = auth.uid()` OR `get_user_role()='Admin'` OR `is_super_admin()`) — **no Team Leader branch** | — |

The team_id branch, in `SELECT` and `UPDATE` only:
```sql
EXISTS (SELECT 1 FROM profiles p
        WHERE p.id = auth.uid() AND p.role = 'Team Leader'
          AND p.team_id IS NOT NULL
          AND appointments.user_id IN (SELECT id FROM profiles WHERE team_id = p.team_id))
```

- **`profiles.team_id` is `NULL` for all four production profiles**, so the branch **never matches**. Team Leaders currently see only their own / created-by appointments.
- `team_id` is single-level by construction and **cannot** express "all descendants at every level" (contract §5).
- **`appointments` is the only hierarchical table not on ltree.** `calls`, `clients`, `leads`, `recruits`, `contact_emails`, `profiles` all use `is_ancestor_of`; `tasks` uses the raw ltree operator.
- **Pre-existing over-permission, and the reason a `USING`-only change is unsafe:** `appointments_insert` and `appointments_update` `WITH CHECK` grant any Team Leader `get_user_role() = 'Team Leader'` with **no ownership constraint whatsoever**. A Team Leader can today create an appointment for **any user in the organization**, and — if they can see a row — move it to **any user in the organization**. Changing only the `UPDATE USING` clause to ltree would let a leader read a descendant's appointment and then **reassign it outside their own downline**. Any migration must therefore tighten `WITH CHECK` in the same change.
- `appointments` has `contact_id` but **no `contact_type`**, and `organization_id` is `NOT NULL`.

**3. Recommended option and why.**
**Canonical hierarchy scoping.** Replace the `team_id` sub-clause with `public.is_ancestor_of(auth.uid(), appointments.user_id)` in `SELECT` and `UPDATE` `USING`, **and** replace the unconstrained `get_user_role() = 'Team Leader'` term in both `WITH CHECK` clauses with the same ltree predicate.
Rationale: it converges on the one mechanism the rest of the schema already uses, satisfies "all levels" (which `team_id` structurally cannot), needs no new data to be invented or maintained, and — critically — closes the reassign-anywhere hole rather than widening it. **Repairing/populating `team_id` is rejected**: it would require defining "team" as a new concept, backfilling it, keeping it forever in sync with `upline_id`, and it would *still* only ever resolve one level, so it cannot satisfy contract §5.

**Recommended Team Leader capability set** (each row is an explicit approval item):

| Capability | Recommendation | Mechanism |
|---|---|---|
| **View** descendant appointments | ✅ **Yes** | `SELECT USING` → `is_ancestor_of(auth.uid(), user_id)` |
| **Edit** descendant appointments (time, notes, status) | ✅ **Yes** | `UPDATE USING` → `is_ancestor_of(...)`; required by contract §13 |
| **Create** appointments for descendants | ✅ **Yes** | `INSERT WITH CHECK` → replace bare `'Team Leader'` with `is_ancestor_of(auth.uid(), user_id)` — **narrows** today's org-wide grant |
| **Reassign** between descendants | ✅ **Yes, but only within the downline** | `UPDATE WITH CHECK` → `is_ancestor_of(auth.uid(), user_id)` so the *destination* `user_id` must also be a descendant — **closes the reassign-anywhere hole** |
| **Delete** descendant appointments | ❌ **No** | `appointments_delete` left **unchanged** — no Team Leader branch. Contract §13 requires Handle/Reassign, not delete. |

**Admin remains home-organization scoped** — the `get_user_role() = 'Admin' AND organization_id = get_org_id()` branch is untouched on all four policies. **A Team Leader can never act outside their authorized descendant scope**, because every branch retains `organization_id = get_org_id()` and the new predicate is `is_ancestor_of`, which is reflexive (self included) and org-bounded.

**4. Every viable alternative.**
- **(a, recommended)** Canonical ltree on `SELECT`/`UPDATE` `USING` **and** `INSERT`/`UPDATE` `WITH CHECK`; `DELETE` unchanged.
- **(a-minus)** `USING` only, leaving `WITH CHECK` as-is. **Rejected explicitly** — creates read-then-reassign-anywhere, strictly worse than today.
- **(b)** Populate and maintain `profiles.team_id`. **Rejected** — invents data, needs perpetual sync with `upline_id`, still single-level, cannot satisfy §5.
- **(c)** Leave as-is. Team-scope appointment *aggregates* would come from the M2 RPC (`SECURITY DEFINER`, bypassing RLS, so the KPI is right) while the Schedule *list* shows only the leader's own rows — **the KPI and the list visibly disagree.** Worst outcome for trust.
- **(d)** Interim: keep RLS as-is and render Schedule as Personal-only even in Team view, with an explicit label. Honest, ships sooner, defers §13 leadership actions on appointments.

**5. Affected files, migrations, RLS, production data.**
- **Migration:** `supabase/migrations/<ts>_appointments_hierarchy_ltree.sql` — **not drafted**, pending approval.
- **Policies altered — 3 of 4** (`appointments_delete` untouched):

| Policy | Clause | Change |
|---|---|---|
| `appointments_select` | `USING` | team_id sub-clause → `is_ancestor_of(auth.uid(), user_id)`; all other branches byte-identical |
| `appointments_update` | `USING` | same substitution |
| `appointments_update` | `WITH CHECK` | `get_user_role() IN ('Admin','Team Leader')` → `get_user_role()='Admin' OR is_ancestor_of(auth.uid(), user_id)` |
| `appointments_insert` | `WITH CHECK` | same substitution |
| `appointments_delete` | — | **unchanged** |

- **Access-matrix change** (org `a0000000…0001`; assumes M1 has made `is_ancestor_of` functional):

| Actor | SELECT | INSERT | UPDATE (USING) | UPDATE (WITH CHECK / destination) | DELETE |
|---|---|---|---|---|---|
| Agent `AGENT` | own / created_by → **unchanged** | own → **unchanged** | own → **unchanged** | own → **unchanged** | own → **unchanged** |
| Team Leader `TEAM-LEADER` | own → **own + descendants** | **any org user → descendants only (NARROWED)** | own → **own + descendants** | **any org user → descendants only (NARROWED)** | own → **unchanged (no team branch)** |
| Admin | all in org → **unchanged** | all in org → **unchanged** | all in org → **unchanged** | all in org → **unchanged** | all in org → **unchanged** |
| Cross-org | none → **none** | none → **none** | none → **none** | none → **none** | none → **none** |

  Note this change is **two-directional**: it *widens* Team Leader SELECT/UPDATE to descendants and simultaneously *narrows* their INSERT/UPDATE destination from the whole organization to their own downline.
- **Frontend:** `src/components/dashboard/widgets/AppointmentsWidget.tsx`, `DashboardDetailModal.tsx`, and the Build 3 `CrossUserActionDialog`.
- **Production data:** **none written.** Policy definitions only.
- **Depends on M1** — `is_ancestor_of` is inert until D3-ii is applied.

**6. Build blocked.** **Build 2** — Team/Agency Schedule list and the Schedule widget's cross-user rows. **Build 3** — the §13 Handle / Reassign / Cancel workflow on appointments. Does **not** block the Appointments Set KPI, which is computed in the RPC.

**7. Security and telemetry implications.**
- Net effect is **a tightening plus a scoped widening**. The tightening (INSERT/UPDATE destination narrowed from org-wide to downline) closes a real pre-existing hole and should be called out as a security fix in its own right.
- The widening (SELECT/UPDATE on descendants) is required by contract §13 and is bounded by `organization_id = get_org_id()` plus `is_ancestor_of`.
- DELETE is deliberately not widened — a leader cannot destroy a descendant's appointment history.
- `is_ancestor_of` is `SECURITY DEFINER` reading only `profiles`; using it in a policy is the pattern already live on six other tables, so no new function exposure.
- **Telemetry:** none. `appointments` carries no call telemetry, and no Twilio or `calls` surface is touched.

**8. Verification and rollback.**
- *Pre-apply:* archive all four policy definitions verbatim from `pg_policies`.
- *Local tests (fixtures only, D5):* four-level chain — leader sees all descendants' appointments at every depth; leader can create for a descendant; leader **cannot** create for a non-descendant in the same org; leader **cannot** reassign a descendant's appointment to a non-descendant; leader **cannot** delete a descendant's appointment; sibling-leader isolation; agent sees only their own; Admin unchanged; cross-org isolation on all four commands.
- *Post-apply (read-only):* re-read `pg_policies` and diff against the archive to prove exactly the four intended clauses changed and `appointments_delete` is byte-identical; then walk the access matrix above as `EXISTS` probes; `get_advisors(security)` delta reported.
- *Rollback:* `DROP POLICY` + `CREATE POLICY` restoring the archived text verbatim for the three changed policies, in one transaction. No data to restore.

**9. Exact approval language.**
> **D4-i (design + local test only):** "Approved: draft and locally test the `appointments` hierarchy migration per §8/D4. Not approval to apply."
> **D4-ii (production apply — separate, later, requires the RLS token):** "**#APPROVE_RLS_CHANGE** — Approved: alter `appointments_select` (USING), `appointments_update` (USING **and** WITH CHECK) and `appointments_insert` (WITH CHECK) to use `public.is_ancestor_of(auth.uid(), appointments.user_id)` in place of the `profiles.team_id` branch and in place of the unconstrained `get_user_role() = 'Team Leader'` term. `appointments_delete` must remain byte-identical — Team Leaders may view, edit, create and reassign **within their descendant scope only**, and may not delete. Admin stays home-organization scoped. Apply only after M1, as its own migration and its own PR."

---

### D5 — Test fixtures for the SQL verification matrix

**1. Exact decision required.**
Approve creating throwaway fixture data — organizations, profiles at three hierarchy levels, `wins`, `calls`, `appointments` — **in a local/test environment only**, to verify the M2 RPC across the role × scope × period matrix.

**2. Current repo and production evidence.**
- Production: `wins` = **0**, `clients` = **0**, `profiles` = **4** (one Admin-rooted chain, max depth 2), `organizations` = **1**, `agency_groups` = **0**.
- Consequently: sales KPIs cannot be verified against production at all; Team scope cannot be verified beyond a single level; and **Agency Group peer isolation cannot be verified at all**, because no peer org exists.
- No pgTAP or SQL test infrastructure exists in the repo (no `supabase/tests/`, no pgTAP dependency) — §3.4.
- The repo has precedent for fixture scripts (`scripts/seed-test-leads.mjs`, `scripts/seed-leaderboard-demo-users.mjs`) with matching cleanup commands in `package.json`.

**3. Recommended option and why.**
**Local/test-only fixtures.** Per Chris's direction, **no fixture is created in production under any option.** A local Supabase stack (`supabase start`) reproduces the schema from `supabase/migrations/` and allows a genuine two-organization Agency Group peer test, which production physically cannot provide.

**4. Every viable alternative.**
- **(a, recommended)** Local Supabase stack, seeded from migrations, full matrix, torn down with the stack. Highest coverage, zero production risk. Cost: the local stack must reproduce production schema faithfully — and the repo **explicitly warns `supabase/migrations` is not a mirror of production** (noted in `20260731180000_p0_email_release_blockers.sql`), so any divergence must be reconciled first and reported.
- **(b)** A Supabase **preview branch** (`create_branch`), seeded and then deleted. Closest to real production schema; costs money and needs its own approval.
- **(c)** Unit tests only, against mocked Supabase responses. Zero infrastructure risk, but verifies only the TS adapter — **it cannot verify the SQL**, which is precisely where the authorization logic lives.
- **(d)** Fixtures in production. **Not offered** — excluded by Chris's direction.

**5. Affected files, migrations, RLS, production data.**
- New: `scripts/seed-dashboard-fixtures.mjs` + a cleanup command, following the existing seed-script convention, **guarded to refuse to run against the production project ref** (`jncvvsvckxhqgqvkppmj`).
- No migration. No RLS change. **No production data under any approved option.**

**6. Build blocked.** **Build 4** verification, and the confidence level attached to **Build 2**. Does not block writing Build 2's code.

**7. Security and telemetry implications.**
- The seed script must never hold a service-role key in the repo or in the frontend; it reads credentials from the environment, like the existing seed scripts.
- A hard project-ref guard is mandatory so the script cannot be pointed at production by accident.
- **Telemetry:** fixtures create `calls` rows locally. They must never reach production, or they would contaminate billing-minute and manager-truth reporting derived from `calls.duration`.

**8. Verification and rollback.**
- *Verification:* the matrix in §7.5, run locally; each assertion records expected vs. actual in `WORK_LOG.md`.
- *Rollback:* destroy the local stack (`supabase stop --no-backup`), or for option (b) delete the preview branch. **Production is never touched, so there is nothing to roll back there** — and this will be stated explicitly rather than merely implied.

**9. Exact approval language.**
> "Approved: create Dashboard verification fixtures in a **local Supabase stack only**. No fixture data may be written to the production project under any circumstances. The seed script must refuse to run against project ref `jncvvsvckxhqgqvkppmj`. Report any divergence found between `supabase/migrations` and the production schema rather than working around it."

---

### D6 — Rename the "Appointments" widget to "Schedule"

**1. Exact decision required.**
Approve (i) changing the widget's **display label** from "Appointments" to "Schedule", and (ii) whether to also change its **persisted preference key** from `appointments` to `schedule`.

**2. Current repo and production evidence.**
- `Dashboard.tsx:64` — `WIDGET_LABELS = { …, appointments: "Appointments", … }`.
- `Dashboard.tsx:53-60` — `DEFAULT_WIDGET_ORDER` contains the string `"appointments"`; the same literal keys `WIDGET_ICONS` (`:73`), `WIDGET_COLORS` (`:82`), `renderWidget` (`:352`), and `handleWidgetClick`'s `supportedTypes` map (`:193`).
- Persistence: `user_preferences.settings.dashboard_widget_order` / `.dashboard_hidden_widgets` (`Dashboard.tsx:229-233`, `:291-292`) — a free-form JSON blob with **no schema and no versioning**.
- The contract uses two distinct names for two distinct things: **Schedule** (occurrence-time widget) and **Appointments Set** (booking-time KPI). Today both surfaces say "Appointments", which is exactly the ambiguity §9 warns about.
- `DashboardDetailModal`'s `ModalType` also uses `"appointments"` (`:70`, `:329`).

**3. Recommended option and why.**
**Rename the label to "Schedule"; keep the persisted key `appointments`.** The user-visible ambiguity is resolved immediately, at zero migration risk. Renaming the key buys nothing a user can see while requiring a preference migration that could scramble saved layouts. The Build 1 normalization layer will nonetheless *accept* a legacy `schedule` key defensively, so a future rename stays cheap.

**4. Every viable alternative.**
- **(a, recommended)** Label → "Schedule", key stays `appointments`.
- **(b)** Rename both. Requires the normalization layer to map `appointments` → `schedule` on read and write; every user's saved order/hidden list is rewritten on next save. Risk: a partially-migrated blob (order renamed, hidden list not) hides the wrong widget.
- **(c)** Change nothing. Leaves "Appointments" the widget and "Appointments Set" the KPI — two different date semantics under near-identical names.
- **(d)** Label → "Schedule" and rename the KPI card to "Appointments Set" as well. **This is strictly better than (a) and is folded into the recommendation** — `StatCards.tsx:65` currently reads `"Appointments Today"` / `"Appointments (${timeRange})"`, which does not say *booking*.

**5. Affected files, migrations, RLS, production data.**
- `src/pages/Dashboard.tsx` (`WIDGET_LABELS` only, under (a)).
- `src/components/dashboard/StatCards.tsx:65` — KPI label → "Appointments Set".
- `src/lib/dashboard-widget-prefs.ts` (new) — accept and normalize a legacy `schedule` key.
- Under (b) only: `DEFAULT_WIDGET_ORDER`, `WIDGET_ICONS`, `WIDGET_COLORS`, `renderWidget`, `handleWidgetClick`, `ModalType`, plus a read-time preference migration.
- **No migration, no RLS, no production data.** `user_preferences` rows are only rewritten when a user saves a layout.

**6. Build blocked.** **Build 1** (the normalization layer needs to know whether to map the key). Cosmetic but cheap to get wrong.

**7. Security and telemetry implications.** None. Display strings and a client-side preference blob.

**8. Verification and rollback.**
- *Verification:* a test asserting the widget renders as "Schedule" and the KPI as "Appointments Set"; a normalization test asserting a saved blob containing `schedule` resolves to the same widget as `appointments` and is not duplicated; a test asserting an existing saved order containing `appointments` still renders in the saved position.
- *Rollback:* `git revert`. Under (a) nothing persisted changes, so rollback is total. Under (b) rollback would leave already-migrated preference blobs holding `schedule` keys — which is exactly why (a) is recommended.

**9. Exact approval language.**
> "Approved: rename the widget's display label to **Schedule** and the KPI card to **Appointments Set**. The persisted preference key stays `appointments`; the normalization layer must accept a legacy `schedule` key without duplicating the widget."

---

### D7 — Converge the Dashboard `LeaderboardWidget` onto the canonical leaderboard data path

**1. Exact decision required.**
Approve replacing `LeaderboardWidget`'s private data fetch with the canonical leaderboard path, and approve building the **personal nearby-rank** view (contract §12) that does not exist anywhere today.

**2. Current repo and production evidence.**
- `Dashboard.tsx:363` — `<LeaderboardWidget userId={userId} />`. **No `timeRange`, no `adminToggle`, no `role`.** It cannot follow the Dashboard period or scope (**A10**).
- `LeaderboardWidget.tsx:48` — `supabase.from("clients").select("assigned_agent_id").gte("created_at", startOfMonth)` — production ranked by **`clients`**, hardcoded to the current month, with **no `organization_id` predicate** and no role scoping.
- The canonical path `useLeaderboardData.ts` is materially better: defaults `period` to `"Today"` (`:45`), explicitly scopes `organization_id` (`:250, :256, :262, :382, :399, :434`), uses `wins` for production (`:397`), annualizes through `attachPremiumSoldToAgents` (`:339`), and holds a real realtime subscription (`:522`).
- **Neither** implementation has a nearby-rank capability — only whole-list ranking with an `isMe` highlight. Contract §12 (≈2 above / ≈2 below, "#X of Y in the agency") is **net-new**.
- `leaderboardTypes.ts:108-118` `Period` supports only `Today | This Week | This Month` — **no "This Year"**, which contract §3 requires.
- Route: `/leaderboard`.
- **No test covers any leaderboard module.**

**3. Recommended option and why.**
**Converge.** Keeping two implementations guarantees the Dashboard widget and the Leaderboard page disagree — they already do, on source table, period and org scoping. Convergence also deletes a `clients`-based sales count, which is the same defect as **#5**.

**4. Every viable alternative.**
- **(a, recommended)** Widget consumes the canonical path; extend `Period` with "This Year"; add nearby-rank; feed the widget the Dashboard's period and scope.
- **(b)** Minimal patch: leave the widget standalone but switch it to `wins`, add `organization_id`, and accept the props. Less churn; still two code paths that will drift again.
- **(c)** Leave the widget alone and only fix the KPI row. Cheapest; leaves a visibly wrong leaderboard on the Dashboard.
- **(d)** Drop the leaderboard widget from the Dashboard and link to `/leaderboard`. **Rejected — contract §11 requires the widget.**

**5. Affected files, migrations, RLS, production data.**
- `src/components/dashboard/widgets/LeaderboardWidget.tsx`, `src/pages/Dashboard.tsx` (pass period/scope), `src/hooks/useLeaderboardData.ts` (nearby-rank selector; "This Year"), `src/components/leaderboard/leaderboardTypes.ts` (`Period`, `getPeriodRange`), `src/components/leaderboard/leaderboardPremium.ts` (half-open bounds).
- If ranking moves into the M2 RPC, `supabase/migrations/<ts>_get_dashboard_overview_rpc.sql` gains the ranking rows.
- **No RLS change, no production data change.**

**6. Build blocked.** **Build 2** (period/scope correctness) and **Build 3** (nearby-rank UI).

**7. Security and telemetry implications.**
- **This is the decision with the sharpest security edge in the widget layer.** Contract §12 says Agency Group peer metrics must **never** enter this ranking, but `useLeaderboardData` has a **group view** that legitimately calls `get_agency_group_leaderboard` and legitimately crosses orgs. Convergence must therefore keep the two strictly separated: the Dashboard widget must be wired **only** to the org path with an explicit `organization_id`, never to the group path. Sharing a hook makes that easier to get wrong, so it needs an explicit test.
- Ranking exposes peer agents' production to every viewer. Today `LeaderboardWidget` has **no** org predicate and leans entirely on RLS — and per **B3/B4** RLS on `wins` is org-wide plus peers. Adding the explicit predicate is a tightening.
- **Telemetry:** none written.

**8. Verification and rollback.**
- *Verification:* tests that the widget's numbers equal `/leaderboard`'s for the same org, period and scope; that period and scope props actually change the result; that "This Year" resolves correctly across a year boundary; that nearby-rank returns the right window at the top, middle and bottom of the list, and with ties; **that a seeded Agency Group peer org never appears in the Dashboard widget** (fixtures, D5); that the org path always sends `organization_id`.
- *Rollback:* `git revert`. Frontend-only unless ranking is folded into the RPC, in which case `DROP FUNCTION` per D-M2.

**9. Exact approval language.**
> "Approved: converge the Dashboard `LeaderboardWidget` onto the canonical `useLeaderboardData` org path, pass it the Dashboard's period and scope, extend `Period` with **This Year**, and build the personal nearby-rank view (≈2 above / ≈2 below, '#X of Y in the agency', View Full Leaderboard). The Dashboard widget must never call the Agency Group path, and a test must prove peer-org agents cannot appear in it."

---

### D8 — Delete the two dead Dashboard files and correct AGENT_RULES §17

**1. Exact decision required.**
Approve deleting `src/lib/supabase-dashboard.ts` (626 lines) and `src/components/dashboard/CustomizeDrawer.tsx` (147 lines), **conditional on a three-part clearance check passing**, and correcting the AGENT_RULES §17 sentence that cites the former as a live surface.

**2. Current repo and production evidence.**
- `grep -rn "supabase-dashboard\|dashboardSupabaseApi" src/` excluding the file itself → **zero hits**.
- `grep -rn "CustomizeDrawer" src/` excluding the file itself → **zero hits**.
- `supabase-dashboard.ts` holds **26 Supabase queries** across `calls`, `wins`, `appointments`, `campaigns`, `leads`, `profiles`, `dispositions` — a complete parallel Dashboard data layer nothing calls, with **no `organization_id` predicates**.
- **AGENT_RULES.md:119** currently lists `supabase-dashboard.ts` alongside `CampaignDetail.tsx` and `reports-queries.ts` as surfaces that "inherit the same `0` bug and are deferred to a later build" — describing it as live. That is no longer accurate for this file.
- `CustomizeDrawer.tsx` is a second implementation of the reorder/hide/restore model now inlined in `Dashboard.tsx` — i.e. a divergent copy of a feature this closeout changes.

**3. Recommended option and why.**
**Delete both in Build 1 — but only after all three clearance checks pass** — and correct AGENT_RULES §17 in the same commit (AGENT_RULES §9 requires rules to be updated with the discovery). Removing 773 lines of unreferenced, partly-wrong Dashboard code *before* rewriting the Dashboard removes the main way a later agent edits the wrong file — a live risk, since `supabase-dashboard.ts` is named in the handoff's own inspect list.

**Mandatory clearance checks before either file is removed:**
1. **Static import check** — repo-wide (not just `src/`): `scripts/`, `services/`, `supabase/functions/`, `public/`, tests, config. Zero references.
2. **Lazy / dynamic import check** — grep for `import(`, `require(`, `React.lazy`, `loadable`, and any string-built module path that could resolve to either module. Zero references.
3. **Documented-intent check** — search `WORK_LOG.md`, `AGENT_RULES.md`, `docs/`, and open GitHub issues/PRs for either filename. If any document says the file is a planned or deferred surface, **do not delete**: record the reference and bring it back for decision. AGENT_RULES:119 is a known hit and is why the rules edit is part of this item rather than an afterthought.

**If any check fails, the file stays and the finding is re-reported.** Deletion is not authorized on a `src/`-only grep.

**4. Every viable alternative.**
- **(a, recommended)** Delete both in Build 1 after all three checks + correct AGENT_RULES §17.
- **(b)** Delete `CustomizeDrawer.tsx` only; keep `supabase-dashboard.ts` as reference during the rewrite, delete in Build 4. Safer if a query shape proves useful; costs a second commit and leaves the misleading rule text standing longer.
- **(c)** Keep both, add `@deprecated` headers and correct AGENT_RULES §17 anyway. Lowest risk, permanent confusion.
- **(d)** Leave untouched. Not recommended — the handoff lists `supabase-dashboard.ts` as a file to inspect, so its dead status must at minimum be recorded.

**5. Affected files, migrations, RLS, production data.**
- **Deleted:** `src/lib/supabase-dashboard.ts`, `src/components/dashboard/CustomizeDrawer.tsx`.
- **Edited:** `AGENT_RULES.md` §17 (line 119) — remove `supabase-dashboard.ts` from the inherited-bug list. `CampaignDetail.tsx` and `reports-queries.ts` **stay listed and stay untouched** by this closeout.
- **No migration, no RLS, no production data, no runtime behavior change** — by definition, if the checks pass.

**6. Build blocked.** **Build 1**, only in the sense that the deletion should land there. Nothing depends on the answer to proceed.

**7. Security and telemetry implications.**
- Mildly positive: 26 unscoped queries with no `organization_id` predicates are a ready-made template for a future leak. Dead code cannot leak, but it can be copied.
- **Telemetry:** none — never executed.

**8. Verification and rollback.**
- *Verification:* the three clearance checks above, evidenced in the PR; `npx tsc --noEmit` clean; full `npx vitest run` at the **532** baseline with no regression; `npx eslint` clean on touched files; production build succeeds.
- *Rollback:* `git revert` restores both files byte-for-byte. No persisted state, no schema, nothing deployed.

**9. Exact approval language.**
> "Approved: delete `src/lib/supabase-dashboard.ts` and `src/components/dashboard/CustomizeDrawer.tsx` in Build 1, **only after** the static-import, lazy/dynamic-import and documented-intent checks all come back clean — and report the results in the PR. Correct the AGENT_RULES §17 sentence that lists `supabase-dashboard.ts` as a live surface. `CampaignDetail.tsx` and `reports-queries.ts` stay listed and untouched."

---

### D9 — Defects found outside the Dashboard: fix now, or file as follow-ups?

**1. Exact decision required.**
For each of three confirmed non-Dashboard findings, decide: fold into a Dashboard build, spin out as its own PR, or record and leave.

**2. Current repo and production evidence.**

**D9-a — `profiles` stale client-model residue (CORRECTED classification, **A18**).**
An earlier revision of this plan called this a "silently failing production write". **That was wrong, and it is withdrawn.** Re-verified against the exact baseline (`git show 09976ac:…`):
- `supabase-users.ts:39, 107, 159, 252` are **read-side mapping defaults** — `rowToUser({ ...row, onboarding_items: [], … })` on reduced-column fallback paths, and `row.onboarding_items || []`. **Not writes.**
- `AgentModal.tsx:79, 86` are **reads** that coalesce: `data.monthly_talk_time_goal_hours || 0`, `data.onboarding_items || []`.
- Neither column appears in `allExpectedColumns` or in any of the 11 `.update()`/`.insert()` payloads in `supabase-users.ts`.
- **The one genuine write is `supabase-users.ts:497` `updateOnboardingItems()` — and it has ZERO callers repo-wide.** Unreachable dead code.
- Live schema: `monthly_talk_time_goal` **exists**; `monthly_talk_time_goal_hours` and `onboarding_items` **do not** (`20260428120000_rename_monthly_talk_time_to_premium_goal.sql` renamed the former).
**Net: the TS `User` model carries two properties whose backing columns were removed. Every read coalesces to a default, so nothing fails at runtime. This is model debt — non-blocking.**

**D9-b — `DayAgendaPanel` fires a success toast for an action that never happens.**
`DayAgendaPanel.tsx:113` — `onClick={() => { toast.success(\`Opening dialer for ${appointment.contactName}\`); window.dispatchEvent(new CustomEvent("openDialer")); }}`. `grep -rn "openDialer" src/` returns that line only: **no listener anywhere, and no `detail` payload at all.** Same class as defect #1; to work it needs `appointment.contactId` mapped into the canonical payload.

**D9-c — `get_agency_group_leaderboard` measures different things than the org leaderboard.**
From the live function body: `policies_sold` counts **`public.clients`** (`cli.assigned_agent_id`), not `wins` — the same wins-vs-clients defect as #5, inside a live `SECURITY DEFINER` RPC. Its `calls` LATERAL has **no `direction` filter**, so inbound calls inflate Calls Made and inbound duration inflates talk time. **No `organization_id` predicate** on the `calls`/`appointments`/`clients` LATERALs. Period is `created_at >= v_period_start` with **no upper bound**. Mitigating: `agency_groups` = **0 rows**, so it is unreachable in production today.

**3. Recommended option and why.**
**(a)** Record as model debt; clean up opportunistically when `supabase-users.ts` is next touched. **Not worth its own PR** now that it is correctly classified as non-failing. **(b)** Fast-follow to Build 1, using the `dispatchQuickCall` helper Build 1 introduces. **(c)** Separate approved project — it touches a live `SECURITY DEFINER` RPC and a cross-org feature, so it deserves its own review, not a ride-along.

**4. Every viable alternative.**
- (a) Record only *(recommended)* · fold the model cleanup into Build 1 · own PR.
- (b) Fast-follow after Build 1 *(recommended)* · fold into Build 1 (3 lines, but widens Build 1 beyond the Dashboard) · leave.
- (c) Separate project *(recommended)* · fold into Build 2 alongside the leaderboard work · leave until the first Agency Group is onboarded — **acceptable only if that onboarding is gated on the fix**, else the first customer group sees wrong numbers on day one.

**5. Affected files, migrations, RLS, production data.**
- (a) `src/lib/supabase-users.ts` (drop the dead `updateOnboardingItems` and the two stale model properties), `src/components/contacts/AgentModal.tsx`. No migration.
- (b) `src/components/calendar/DayAgendaPanel.tsx` + `src/lib/quick-call.ts` (from Build 1).
- (c) `supabase/migrations/<ts>_fix_agency_group_leaderboard.sql` — `CREATE OR REPLACE FUNCTION`. **No RLS change.** No production data.

**6. Build blocked.** **None.** All three are outside Dashboard scope. They are registered so they are not silently dropped.

**7. Security and telemetry implications.**
- (a) None. Cosmetic model debt.
- (b) **Truthfulness defect** — reports success for an action that did not occur; the same integrity issue contract §14 targets.
- (c) **The one with real weight.** Adding the missing `organization_id` predicates tightens a cross-org RPC. Counting `clients` rather than `wins` means the peer leaderboard reports a different production figure than the org leaderboard for the same agent. **Telemetry:** the missing `direction` filter reports inbound talk time as outbound production — the manager-truth class of defect AGENT_RULES #8 exists to prevent.

**8. Verification and rollback.**
- (a) `npx tsc --noEmit`; confirm no caller regressions.
- (b) Test asserting the canonical `quick-call` event fires with a complete payload and no toast appears unless the dispatch happened.
- (c) Read-only `execute_sql` comparison of old vs. new output on local two-org fixtures (D5); assert `wins`-based counts, outbound-only calls, explicit org predicates, half-open window. *Rollback:* `CREATE OR REPLACE FUNCTION` back to the archived body — capture `pg_get_functiondef` first.
- All: `git revert` for frontend parts.

**9. Exact approval language.**
> "Acknowledged: the `profiles` model residue is non-blocking debt, not a failing write — clean it up opportunistically. File the `DayAgendaPanel` dead `openDialer` event as a fast-follow to Build 1 using the new canonical helper. File the `get_agency_group_leaderboard` defects as a separate approved project, and do not onboard the first Agency Group until it is fixed."

---

### 8.1 Build blocker matrix

| Build | Hard blockers | Scope confirmations | Can start? |
|---|---|---|---|
| **Build 1** — functional correctness | **none** | **D6** (widget key rule), **D8** (whether deletions land here) | **Yes, on AP1 alone.** Touches no sales KPI, no scope resolution, no schema, no RLS, no production data. |
| **Build 2** — data accuracy, timezone, authorization | **D1** (sales lifecycle — hard block) · **D2** (premium unit) · **D3-i then D3-ii** (Team scope) · **D4-i then D4-ii** (Team/Agency Schedule list) | **D7** (leaderboard convergence) | **No.** Does not start until D1 is decided. |
| **Build 3** — leadership actions, UI, accessibility | **D3-ii** (Team scope live) · **D4-ii** (§13 Handle/Reassign on appointments) · **D7** (nearby-rank) | — | No — depends on Build 2. |
| **Build 4** — verification and closeout | **D5** (fixture strategy sets achievable coverage) | — | No — depends on Builds 1–3. |
| Out of scope | — | **D9** | Blocks nothing. |

**Per-decision blocking summary**

| Decision | Blocks | Type |
|---|---|---|
| **D1** — sales production lifecycle | **Build 2 (hard)**, Build 3 sales surfaces | Design + schema + RLS addition |
| **D2** — premium unit is monthly | Build 2 | Confirmation |
| **D3** — hierarchy repair | Build 2, Build 3; prerequisite for D4 | Migration (production data) |
| **D4** — appointments hierarchy scoping | **Build 2 Schedule list, Build 3 §13 appointment actions** | RLS migration |
| **D5** — local/test fixtures | Build 4 | Process |
| **D6** — Schedule naming | Build 1 | Scope confirmation |
| **D7** — leaderboard convergence | Build 2, Build 3 | Scope confirmation |
| **D8** — dead-code deletion | Build 1 | Scope confirmation |
| **D9** — out-of-scope defects | none | Triage |

**Minimum to unblock all four builds: D1, D2, D3, D4.** Build 1 needs only AP1.

---

### 8.2 Build 1 authorization boundary

What approving **AP1** does and does not authorize. Build 1 is deliberately drawn so it can ship while every other decision is still open.

**Build 1 MAY:**
- Route all Dashboard call actions through one typed `dispatchQuickCall()` helper emitting the canonical `{ contactId, name, phone, type }` payload on the `quick-call` event.
- Fix `makeCall(...)` at `DashboardDetailModal.tsx:360` to pass a proper `MakeCallOptions`, `await` it, and toast only on a truthy result.
- Stop widget-body clicks bubbling into `handleWidgetClick`; add `stopPropagation` to nested actions.
- Navigate by `contact_id` + `contact_type` instead of the `calls` row id.
- Make period bounds half-open `[start, end)` and add the missing upper bound on current-period queries.
- Fix callback ordering (overdue → due-today), add the missing lower bound, and replace `setTotalCount(data.length)` with an exact count.
- Check the Supabase `{ error }` on layout save **and** reset before toasting, and add widget-key normalization with a safe default layout.
- Fix the `NaN` talk-time path.
- Change the default period to **Today**.
- Remove the "Real-time Intelligence Feed" wording.
- Delete the two dead files and correct AGENT_RULES §17 — **only if D8 is approved and all three clearance checks pass**.
- Add new unit tests for all of the above.

**Build 1 MUST NOT:**
- **Implement, change, or claim any Policies Sold or Annualized Premium behavior.** The sales KPIs keep reading `clients` — knowingly wrong — because correcting them without the approved D1 lifecycle would present gross production as finished contract §8 behavior. **Build 1 does not close §8, A20, A23 or A24, and its PR description must say so.**
- Touch any migration, RLS policy, database object, or production data.
- Change scope/authorization behavior, the agency timezone, or any `organization_id` predicate *(Build 2)*.
- Alter `TwilioContext`, its re-entrancy guards, `calls.duration`, disposition handling, or any Twilio/Edge/queue path.
- Deploy anything.

**Gates before handoff:** `npx tsc --noEmit` · targeted Dashboard tests · full `npx vitest run` at the **532** baseline with no regression · `npx eslint` on every touched file · `git diff --check` · newest-first `WORK_LOG.md` entry · context snapshot.

---

### 8.3 Every future migration, RLS and production-impacting approval — itemized

Each row is a **separate** approval. None is implied by approving the design of another. Nothing in this table has been created or applied.

| # | Item | Type | Depends on | Production impact | Approval needed |
|---|---|---|---|---|---|
| **P1** | Create + locally test **M1** (`fix_hierarchy_path_trigger_and_backfill`) | Migration file | — | none (local only) | **D3-i** |
| **P2** | **Apply M1 to production** | Production data write | P1 + local evidence | `profiles.hierarchy_path` on **2 of 4 rows**; widens Team Leader access across **7 policies / 11 functions** | **D3-ii** — separate |
| **P3** | Create + locally test **M3** (`wins` per-policy production record: policy columns, `policy_seq`, `status`, audit triple) | Migration file | D1 | none (local only) | **D1** |
| **P4** | **Apply M3 to production** | Schema DDL | P3 | additive columns on `wins`; 0 existing rows | separate |
| **P5** | **New UPDATE policy on `public.wins`** (Admin-only, same-org, status columns) | **RLS addition** | D1 | first write policy on `wins` | **`#APPROVE_RLS_CHANGE`** — separate |
| **P6** | Create + locally test **M3b** (extend `convert_lead_to_client_atomic` to insert wins in-transaction) | Migration file | D1, P3 | none (local only) | **D1** |
| **P7** | **Apply M3b to production** | Replaces a live `SECURITY DEFINER` function | P6 | changes the live conversion path | separate |
| **P8** | Create + locally test **M2** (`get_dashboard_overview` RPC) | Migration file | D1 (sales predicate), D2, D3 | none (local only) | **AP12** |
| **P9** | **Apply M2 to production** | New `SECURITY DEFINER` function | P8 | additive; adds 1 advisor info lint | separate |
| **P10** | Create + locally test the **`appointments` hierarchy migration** | Migration file | D4, M1 | none (local only) | **D4-i** |
| **P11** | **Apply the appointments migration to production** | **RLS change on 3 of 4 policies** | P10, P2 | widens TL SELECT/UPDATE to descendants; **narrows** TL INSERT/UPDATE destination to descendants | **`#APPROVE_RLS_CHANGE`** — **D4-ii**, separate |
| **P12** | Local/test fixtures for the SQL verification matrix | Local only | D5 | **none — production never seeded** | **D5** |
| **P13** | Fix `get_agency_group_leaderboard` (wins-vs-clients, outbound filter, org predicates, upper bound) | Replaces a live `SECURITY DEFINER` function | D9-c | changes a cross-org RPC | separate project |
| **P14** | Any Vercel production deployment of Builds 1–4 | Deployment | per build | live frontend | separate, per build |

**Not proposed anywhere in this plan:** dropping or bypassing any existing RLS policy · any change to `calls`, `calls.duration`, Twilio, Edge Functions, dispositions, `dialer_lead_locks` or the queue RPCs · populating `profiles.team_id` · seeding production.

---

### 8.4 Confirmed: the canonical quick-call payload

Implementation must emit **exactly** the payload `FloatingDialer` consumes — read from the listener, not inferred:

```ts
// FloatingDialer.tsx:258-277 — the only listener for "quick-call"
window.addEventListener("quick-call", handler)          // :279
detail.phone      // REQUIRED — the handler no-ops entirely without it (:260)
detail.name       // split on " " into first_name / last_name (:261, :264-265)
detail.contactId  // -> selectedContact.id (:263)
detail.type       // 'lead' | 'client' | 'recruit'; DEFAULTS TO 'lead' when omitted (:267)
detail.fromNumber // optional caller-ID override (:269-271)
```

**Canonical payload: `{ contactId, name, phone, type }`** — matching the working precedent at `Contacts.tsx:2452`.
**The Dashboard's current `{ contactId, contactName, phone }` is wrong twice over:** `contactName` is never read (the name is lost), and the omitted `type` silently marks every contact a `lead` — wrong for the client and recruit rows the Anniversaries widget surfaces. Build 1 routes every dispatcher through one typed `dispatchQuickCall()` helper so the event name and field names cannot drift again.

## 9. Release and rollback plan

**Sequencing.** Build 1 → Build 2 → Build 3 → Build 4, each a separate PR off fresh `origin/main`, each ending with the mandated gate set and a context snapshot. **No push to `main`.** Build 1 needs no migration and no deploy. Build 2 is gated on D1/D2/D3.

**Migration order for Build 2:** M1 (hierarchy fix + backfill) **first** and verified — the RPC's team scope is meaningless until `is_ancestor_of` works — then M2 (the RPC), then merge the frontend. Both re-checked against `list_migrations` immediately beforehand (AGENT_RULES #5); the MCP timestamp-vs-filename repair noted in the 2026-08-01 release applies again.

**Rollback per component.**
| Component | Rollback |
|---|---|
| M1 hierarchy | Restore `hierarchy_path` from the pre-apply snapshot; restore both function bodies from archived `pg_get_functiondef` output |
| M2 RPC | `DROP FUNCTION public.get_dashboard_overview(…)` — additive, touches no table or policy |
| Frontend | Revert the merge commit, or restore the prior Vercel production deployment |
| Preferences | No schema change; normalization is read-time and non-destructive, so old `user_preferences.settings` values survive a revert intact |

**Durable artifacts.** Following the 2026-08-01 precedent, pre-change snapshots are copied outside the repo to `~/agentflow-release-rollback/<date>-dashboard/` with a README mapping each component to its rollback source.

**Deployment happens only after Chris's explicit approval**, per build.

---

## 10. Approval checklist

Each row points at the full entry in **§8**, where the exact approval language to quote back is given.

| # | Decision | Blocks | Kind | Recommendation |
|---|---|---|---|---|
| **AP1** | **Build 1** — functional correctness, within the §8.2 authorization boundary | — | Code only | **Approve** — no schema, no RLS, no production data, no deploy |
| **AP2** | Architecture: **HYBRID** (RPC for aggregates, RLS'd frontend queries for PII lists) | Build 2 | Design | **Approve** — no new evidence disproves it |
| **AP3** | **D1** — full sales production lifecycle: one canonical record per policy, in-transaction creation, canonical sale entry for the dialer path, counted-vs-fallout with reasons + restoration + audit, Zod, one shared read predicate | **Build 2 (hard)** | Design → P3/P4/P5/P6/P7 | **Recommend D1-A+** — extend `wins` as the V1 per-policy record; defer a separate `policies` table to V2 |
| **AP4** | **D2** — `wins.premium_amount` is **monthly**; annualize once. Includes fixing the null-premium dialer win (**A20**) | Build 2 | Confirmation | **Confirm** — the column `COMMENT`, its creating migration and the UI label all say monthly |
| **AP5** | **D3-i** — create + locally test **M1** (hierarchy repair) | Build 2, Build 3 | Migration file only | **Approve** — repairs all six items in §8/D3.3 |
| **AP6** | **D3-ii** — **apply M1 to production** | Build 2, Build 3 | **Production data write (2 rows)** | **Separate approval**, after local evidence. Widens TL access across **7 policies / 11 functions** |
| **AP7** | **D4-i** — create + locally test the `appointments` hierarchy migration | Build 2 Schedule, Build 3 §13 | Migration file only | **Approve** — canonical ltree, not `team_id` |
| **AP8** | **D4-ii** — **apply it to production** | Build 2 Schedule, Build 3 §13 | **RLS change (3 of 4 policies)** | **Separate**, needs **`#APPROVE_RLS_CHANGE`**, after AP6 |
| **AP9** | **D5** — verification fixtures, **local/test only**; production never seeded | Build 4 | Process | **Approve** local-only, or accept unit-test-only coverage |
| **AP10** | **D6** — label → **Schedule** and **Appointments Set**; keep the persisted key | Build 1 | Scope | **Recommend yes** |
| **AP11** | **D7** — converge `LeaderboardWidget` onto one canonical calculation/scope contract; add "This Year"; nearby-rank | Build 2, Build 3 | Scope | **Recommend yes** — with a test that peer-org agents can never appear |
| **AP12** | **D8** — delete 773 lines of dead code **after** import + lazy-import + documented-intent checks; correct AGENT_RULES §17 | Build 1 | Scope | **Recommend yes**, conditional on the checks |
| **AP13** | **D9** — model residue (non-blocking) · `DayAgendaPanel` dead event · `get_agency_group_leaderboard` defects | none | Triage | **Recommend:** (a) record only, (b) fast-follow, (c) separate project |
| **AP14** | **P8** — create + locally test **M2** (`get_dashboard_overview`) | Build 2 | Migration file only | Approve with AP2, **after** AP3 settles the sales predicate |
| **AP15** | **P9** — **apply M2 to production** | Build 2 | **New SECURITY DEFINER function** | **Separate** |
| **AP16** | Builds 3 and 4 | — | Code | Approve after Build 2 lands |
| **AP17** | **P14** — any Vercel production deployment | per build | **Deployment** | **Separate, per build** |

**Minimum to unblock all four builds: AP3 (D1), AP4 (D2), AP5+AP6 (D3), AP7+AP8 (D4).**
**Build 1 needs only AP1** (plus AP10/AP12 to settle its scope).
**Approving a design row never authorizes execution** — the production rows (AP6, AP8, AP15, AP17, and P4/P7 under AP3) are each separate. Full inventory in **§8.3**.

---

## 11. Approval record — Build 1 authorized 2026-08-03

**Chris approved Dashboard Closeout Build 1 only.** This is **not** approval of the complete closeout, Build 2, Build 3, Build 4, any migration, any RLS change, or any production action.

**Baseline reconfirmed at authorization:** `origin/main` = `09976ac7ff22b7e0a3164a0078e0f20dd4e0aad8` (re-fetched; unchanged, zero new commits since the plan was written). `AGENT_RULES.md`, `VISION.md` and `WORK_LOG.md` verified byte-identical to baseline. Working tree carried only the expected pre-existing noise (`deno.lock`, `.claude/`, `.cursor/settings.json`, `tsconfig*.tsbuildinfo`) plus this plan — **no unexpected user changes**. Build branch: **`claude/dashboard-build1`**, cut from `09976ac`.

### 11.1 Decisions locked at product/design level (not implemented in Build 1)

| # | Locked decision | Build 1 action |
|---|---|---|
| **D1** | **A+ V1 direction selected** — `wins` remains the canonical per-policy production record. Eventually requires: one win per policy · atomic client+win creation · per-policy idempotency · complete policy details · validated canonical sale entry · current/fallout status · audit attribution · one counted-win predicate. | **Not implemented.** Migration **not** designed or created. **Build 2 stays blocked** until the exact status values, CHECK constraints, counted predicate, transition behavior, schema diff, migration and rollback are reviewed. |
| **D2** | `wins.premium_amount` **is monthly premium**; Annualized Premium multiplies by 12 **exactly once**. | Recorded. No sales-KPI code changed. |
| **D3** | Canonical hierarchy repair is the selected direction. Design, migration-file implementation/local validation, and production application remain **three separate approvals**. | **No hierarchy work.** |
| **D4** | Appointments will move to canonical descendant hierarchy instead of `team_id`. **Team Leader capability contract: view ✅ · edit ✅ · create for descendants ✅ · reassign within authorized downline only ✅ · delete ❌.** | **No appointment RLS work.** |
| **D5** | Test fixtures are local/test-only and must refuse production project `jncvvsvckxhqgqvkppmj`. | No fixtures created in Build 1. |
| **D6** | **The approved widget name is Schedule.** | Widget label renamed. Persisted key `appointments` retained; the normalizer accepts a legacy `schedule` alias. **`StatCards.tsx` deliberately untouched** — it is outside the authorized file boundary and renaming a KPI card would touch sales-KPI surface. |
| **D7** | Dashboard and full Leaderboard will use one canonical calculation and scope contract. | **Not implemented.** No Leaderboard convergence. |
| **D8** | Dead code may be deleted only after import, lazy/dynamic-import, route, test, script and documented-intent checks. Also: correct the stale AGENT_RULES §17 statement claiming conversion does not set `clients.lead_id`. | **Both checks and both corrections performed** — see §11.3. |
| **D9** | A20 + A21 → D1/Build 2. A22 → D3. **A18 is non-blocking stale client-model residue — not modified in Build 1.** | Honored; `supabase-users.ts` and `AgentModal.tsx` untouched. |

### 11.2 Build 1 exclusions — explicitly NOT implemented and NOT claimed

Policies Sold correctness · Annualized Premium correctness · `wins` lifecycle/status · `ConvertLeadModal` sales-path changes · `FloatingDialer` sold-disposition changes · Leaderboard convergence · Team/Agency data scoping · hierarchy repair · appointment RLS · leadership Handle/Reassign/Cancel · **agency-timezone reporting completion** · Dashboard aggregate RPC · production comparison or release · any Supabase mutation or deployment.

`TwilioContext.tsx` was **not edited**. No REST outbound, two-legged dialing, SIP, Telnyx or `dialer-start-call` path was introduced. `calls.duration` behavior and all Twilio telemetry are untouched.

**Sales KPI status after Build 1: still reading `clients`, still wrong, still open.** Half-open bounds were applied to those queries as a date-correctness fix only; the source table and the annualization were deliberately left alone because correcting them without the approved D1 lifecycle would present gross production as finished contract §8 behavior.

**Timezone status after Build 1: still browser-local, still open.** Build 1 replaced inclusive/missing upper bounds with half-open `[start, end)` using the existing local-date derivation. It did **not** introduce new browser-local date logic beyond the bounds it corrected, and it does **not** claim any part of contract §4.

### 11.3 D8 clearance results (performed before any deletion)

| Check | `src/lib/supabase-dashboard.ts` | `src/components/dashboard/CustomizeDrawer.tsx` |
|---|---|---|
| 1. Static import (`src`, `scripts`, `services`, `supabase`) | **none** | **none** |
| 2. Lazy / dynamic import (`import(`, `require(`, `React.lazy`, `lazy(`) | **none** — the only dynamic imports in `src/` are `supabase-contacts`, `supabase/client`, `react-router-dom`, `onboardingTestUtils`, `workflow-types` | **none** |
| 3. Route (`App.tsx`, `src/pages/`) | **none** | **none** |
| 4. Test files | **none** | **none** |
| 5. Scripts / services / Edge Functions | **none** | **none** |
| 6. Documented intent | **1 hit — `AGENT_RULES.md:119`** lists it as a surface "deferred to a later build". Corrected in the same commit, as D8 directs. `docs/audits/2026-05-16/WORK_LOG.draft.md` and the 7 `WORK_LOG.md` hits are **historical records of past edits**, not forward intent. | **zero** hits in `AGENT_RULES.md`, `docs/`, `WORK_LOG.md` |

**Both cleared. Deleted.** No active Dashboard customization capability was removed — reorder, hide, restore and reset all live inline in `Dashboard.tsx` (`handleDragEnd`, `toggleHideWidget`, `restoreWidget`, `resetLayout`) and are retained.

**Second D8 correction — AGENT_RULES §17 `clients.lead_id`.** Line 121 claimed "the conversion path does not set `clients.lead_id`". That is **stale and contradicted by invariant #188 and by the live migration**: `20260620000200_lead_conversion_atomic.sql` inserts `lead_id` as the final column of `INSERT INTO public.clients (…, lead_id) VALUES (…, p_lead_id)`, creates `uq_clients_lead_id` (partial unique), and the RPC's own idempotency lookup is `WHERE lead_id = p_lead_id`. Corrected: `clients.lead_id` **is** set, as immutable source-lead lineage. The surrounding conclusion ("no reliable client→campaign fallback") still holds and was preserved — `clients` has no `campaign_id`, and lineage to a lead is not a campaign link.

### 11.4 Build 1 status

**Locally implemented. NOT committed, NOT pushed, NOT deployed, NOT released.** No PR opened. No Supabase mutation, migration, RLS change, or Vercel action. **The Dashboard and the sales KPIs are NOT closed.**

---
## Appendix H — Preserved historical record

### H.1 Onboarding Wizard Redesign ("Focused Console") — the plan this supersedes

**COMPLETE.** Approved and implemented 2026-08-01, shipped as **PR #342** (merge `09976ac`). Full plan text is preserved in git history at `implementation_plan.md` as of commit `f58421d`; the verification record is in `WORK_LOG.md`. Durable facts:

- Frontend-only redesign of `/onboarding` on the **Focused Console** direction. **No backend, schema, RLS, migration, Edge Function, env, or deployment change** — confirmed by inspection at the time.
- Chris's decisions as built: **D2** — stepper carries only `Step n of 3`, no time estimate anywhere. **D6** — chips cap at **4** with `+n more`, row is `hidden sm:flex` so narrow mobile shows only the count summary. D1, D3, D4, D5 took the recommended defaults.
- Extra extractions beyond the planned list, to hold the 200-line rule: `OnboardingField.tsx`, `fieldA11y.ts`; step three split into `OnboardingStepAgencyFounder.tsx` + `OnboardingStepWorkspace.tsx`, with `OnboardingStepAgency.tsx` kept as the discriminated-union entry point re-exporting `TeamSizeIntent` (import path unchanged).
- **cmdk filtering is disabled** (`shouldFilter={false}`) so the visible list comes from the pure `filterStates` helper; the empty state is rendered directly rather than via `CommandEmpty`, which behaves inconsistently when cmdk's own filter is off.
- **Test count:** 66 new tests (planned ≈55). Team-size cards must be queried by `role="radio"` (Radix renders a `<button>`, so `getByLabelText` does not resolve the wrapping label); the licensed-states trigger must be queried by id (cmdk's search box is also a `combobox` once open).
- **Environment note worth keeping:** this container has no `VITE_SUPABASE_*`, and **9 unrelated suites fail to collect without them**. Baseline (532/532) and branch (598/598) were both measured with throwaway placeholder values; nothing was added to the repo. **This applies to the Dashboard work too.**

### H.2 System Email Audit, Repair & Unification — the plan before that

**COMPLETE AND RELEASED.** Authoritative closeout: `WORK_LOG.md`, entry `2026-08-01 | [SHIPPED — PR #338 merged 5074c8d…; Vercel dpl_2fBEbgVgzF4buMLDWBKBhwXbG8tW READY on fflagent.com]`. Durable facts:

- One shared renderer (`supabase/functions/_shared/systemEmail.ts` + `systemEmailTemplates.ts` + `systemEmailAuth.ts`) for every AgentFlow-owned transactional email. Codified as **AGENT_RULES invariant #21**.
- **Edge Functions** (verify_jwt preserved): `send-email-previews` 21→**22** · `invite-to-agency-group` 20→**21** (fixed a live outage — a module-scope `logoUrl` `ReferenceError` meant *no group invite had ever been delivered*) · `invite-user` 220→**221** · `create-user` 51→**52** (`verify_jwt=true`) · `send-welcome-email` 250→**251** · `send-invite-email` 224→**225** (breaking `{invitation_id}` contract, deployed immediately after the Vercel deploy succeeded).
- **Migrations, both applied exactly once at their repo filename versions:** `20260731180000_p0_email_release_blockers.sql` (profile-authorization hardening → **AGENT_RULES #20**) and `20260730120000_welcome_email_delivery_v2.sql` (dropped the dead GUC/pg_net welcome trigger, added and backfilled `profiles.welcome_email_sent_at`; `IS NULL` count held at **0**, no mass send).
- **Verification gotcha worth keeping:** a batch Auth-template read-back via `history.pushState` returned the same stale editor model for all five templates — the Supabase dashboard SPA does not re-render on `pushState`. Always re-verify with a real navigation.
- **Rollback artifacts** outside the repo at `~/agentflow-release-rollback/2026-08-01-system-email/`, including `LIVE-invite-user-v220.ts` — **the only exact copy of that version; it is not in git.**
- **Rollbacks performed: none.**
- **Still open:** email-client inspection in Gmail / Apple Mail / Outlook was never done. Deferred and untouched: `public.workflow_dispatch_event` lockdown · profile SELECT/privacy ([#339](https://github.com/cgarness/agentflow-life-insure/issues/339)) · `create-organization` authorization (still v54) · cron repairs · general advisor cleanup.
