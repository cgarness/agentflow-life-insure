# Commissions center — Overview, Payments, Policies, Calculator

**Status:** approved by Chris on 2026-10-20 for **local implementation and disposable-database testing only**. Branch
`claude/epic-tesla-fe96b0` (the session's designated branch; the prompt suggested `claude/commissions-center`) from
`main` `0312520b4933b1474ad14089b77b3cb16c956b85` (re-fetched 2026-10-20, unchanged). Feature-branch commits, pushes and
a draft PR are approved. **Not approved:** production migration, RLS or grant change in production, production reads
or test writes, merge, deployment, data cleanup or backfill. Each needs Chris's separate approval.

Public document: synthetic examples only; no compensation values, carrier products or private grid data (D1).

## 0. Source of truth (read 2026-10-20)

- AGENT_RULES (Phase 2A invariant, commission grids invariant, View As, multi-tenancy), VISION, WORK_LOG newest
  entries (Gate 3, Gate 3b, §13.7), the Phase 2A plan and `verification.md` §§13–15.
- **Phase 2A is released.** PR #469 was merged on 2026-10-20 at 15:37:01 UTC as `0312520` (reviewed head
  `6b09fdf`); its PR body is the Gate 4 release record (both production deployments READY at the merge commit, no
  migration applied or replayed, 338 history rows, latest `20261020040000`, one estimate / four installments / zero
  receipts / one event at 15:39:26 UTC). Repository lines that still say "frontend NOT released" or "not live until
  Gate 4" are reconciled in this change (AGENT_RULES, the Phase 2A plan status, `verification.md` §16, root
  `implementation_plan.md`) without changing any financial, permission or audit invariant.
- Open PRs checked for overlap (2026-10-20): #461, #451, #444, #442, #441, #429, #425, #398, #383, #382, #381, #378,
  #294 — none touches `src/components/commission*`, `src/lib/commission`, the commission migrations, the calculator
  route or the sidebar commission entry.
- Applied and immutable: `20261019170000_policy_commission_tracking.sql`,
  `20261020040000_policy_commission_expected_windows.sql`. Not edited, renamed or replayed. The preview conversion
  (client `2325bc9d` / estimate `7e2c476a`) is not touched or classified.

## 1. Outcome

"Commission Calculator" in the sidebar becomes **Commissions** (same position, below Resources). `/commissions` has
four directly addressable tabs — **Overview · Payments · Policies · Calculator** — that report the signed-in user's
own saved estimates, expected installments and manual receipts (**My commissions**, every authorized role). The
calculator stays the hypothetical tool it is. Estimates are AgentFlow projections and receipts are manual records;
neither is carrier-verified, earned, paid, payroll or booked commission, and nothing here reconciles them.

Not in scope: agency-wide or team views, leaderboards, a team selector, new permissions or settings, reminders, cron,
calendar integration, carrier imports, chargebacks, renewals, payroll, exports, Reports-page changes, telephony.

## 2. Navigation, routes and guards

| Path | Shows |
|---|---|
| `/commissions` | Overview (default) |
| `/commissions/payments` | Payments (`?view=scheduled` default, `?view=history`) |
| `/commissions/policies` | Policies |
| `/commissions/calculator` | Calculator |
| `/commission-calculator` | `<Navigate replace>` to `/commissions/calculator` (legacy links) |
| `/commissions/<anything else>` | `<Navigate replace>` to `/commissions` |

- One route `/commissions/:tab?` renders one page instance, so switching tabs never remounts the page. Tabs are links
  (push history), and every filter lives in the URL search params, so back/forward and card/chart drill-downs work.
- **Access gate (unchanged permission model):** the nav item, the route and every read require the existing
  "View Own Commission Percentage" toggle (`usePermissions().canSeeCommission`, D3) — the same toggle
  `policy_commission_authz.access(<self>)` enforces on the server. No other commission toggle is added or consulted.
  The nav item no longer waits for a calculator grid: reporting is available without one; only the Calculator tab
  needs a ready grid and shows the existing "not set up yet" notice otherwise.
- **View As:** `/commissions` is not on the View As allow-list, so `AppLayout` never mounts it; the nav item is hidden
  and every commissions query is disabled while impersonating (defence in depth inside the page and hooks).
- The sidebar is also the mobile navigation (same component in the drawer); the TopBar title map gains the four
  paths ("Commissions"). No other layout change.

## 3. Calculator tab

- Reuses `CalculatorWorkspace` unchanged (engine, inputs, exact rational money, matching, monthly premium as the
  basis, level parsing, disclaimer). The tab body is the former `CommissionCalculatorPage` body without its own `h1`
  (one "Commissions" heading on the page).
- The grid snapshot is requested only once the Calculator tab is opened; reporting never waits for it.
- Inputs are retained across tab switches: the panel stays mounted (hidden) after its first visit. The workspace keeps
  its `user:org:grid` key and the whole page content is keyed by `user:org`, so a user, organization or grid change
  remounts it; losing access replaces it with the notice (state discarded). Nothing is persisted.
- Hypothetical only: the calculator never calls a tracking, sale or reporting function and never invalidates or
  changes reporting data (asserted in tests).

## 4. Reporting definitions (the contract; server-computed, shared by every read)

All amounts are integer cents from saved rows; nothing is recalculated from today's grid or a client's current
premium. Dates are calendar dates (`date` columns). **Today** is the agency calendar date
`(now() AT TIME ZONE company_settings.timezone)::date` — the Reports convention (`private.report_agency_time_zone`):
an unset or invalid zone fails closed (`55000`), and the UI shows a configuration notice instead of figures.

**Scope (My commissions).** Rows whose `credited_agent_id` (the seller credited on the sale, `wins.agent_id`) is the
signed-in user, in the caller's organization (`policy_commission_authz.actor_org()`), under the existing commission
RLS (which also requires the Own toggle). Never the client's current assignee; no agent id or organization is
accepted from the browser. A caller without own access gets `42501`, never an empty $0 report.

**Current estimate.** `policy_commission_estimates.status IN ('active','on_hold')` (one per policy by the unique
index). Superseded estimates never count. **Held** = `on_hold`; held installments are reported separately and never in
Expected, Remaining, Next 90 days or Check payment; valid receipts on them still count in Received. Open captures
(`awaiting_confirmation` / `needs_attention`) are not estimates and never counted as amounts. A stored zero rate
gives real $0.00 installments.

**Per installment** (receipts aggregated per installment *before* any join):
- `received` = Σ `amount_cents` of its non-voided receipts (all dates);
- `remaining` = max(expected − received, 0); `excess` = max(received − expected, 0). An Advance excess never reduces
  Months 10–12.

**Expected window and allocation.** Stored timing only (never recomputed):
- `window_start` = `expected_on`; `window_end` = `expected_until` (automatic window), else `expected_on` (exact
  date), else the last day of the month (month timing). Unknown timing ⇒ no window ("Date needed").
- **Allocation rule:** an installment belongs to the period (and the month bucket) containing its `window_start`,
  counted exactly once; rows always show the full window (e.g. "Nov 27 – Dec 1, 2026" counts in November).
- **Past** ⇔ `window_end < today` (a month is not past until it ends; a window not until its last day).

**Row status** (first match): `received` (remaining = 0 and received > 0) · `on_hold` · `date_needed` · `check_payment`
(past and remaining > 0) · `upcoming` (not past and remaining > 0) · `none` (a real $0.00 installment with nothing
received). Copy: Received, On hold, Date needed, Check payment, Upcoming. "Check payment" is never "Overdue": missing
receipt history does not prove the carrier did not pay.

**Period** `[from, to]`, inclusive, resolved on the server from a preset against agency today: This month (default),
Last month, Next month, This year, Last year, or Custom (2000-01-01…2100-12-31, from ≤ to; the Overview allows at
most 731 days). Lists also accept All time. The resolved range and today are returned in every response.

**Cards (Overview)** — the *cohort* is the non-held, dated installments with `window_start` in the period:
| Card | Definition | Opens |
|---|---|---|
| Expected | Σ expected over the cohort | Payments › Scheduled, period, status All |
| Received | Σ non-voided receipts with `received_on` in the period (any estimate status) | Payments › History, period, voided hidden |
| Remaining | Σ remaining over the cohort (all valid receipts, any date — *not* Expected − Received) | Payments › Scheduled, period, status Remaining |
| Next 90 days | Σ remaining over non-held dated installments with remaining > 0, `window_end ≥ today` and `window_start ≤ today + 89` — independent of the selected period | Payments › Scheduled, Next 90 days |

Excess over the cohort and held amounts in the period are shown as small notes when non-zero. These are current
balances, not historical "as-of" balances; a missing receipt is not evidence that nothing was received.

**Timeline.** Months covering the period, padded to 12 (⌊(12 − n)/2⌋ before, the rest after) when the period spans
n < 12 months. A month inside the period is clipped to the period's dates; padding months are whole and marked as
outside the period. Per month: *Received* (receipts by `received_on`) and *Expected* (cohort allocation) split into
Advance and Months 10–12 — two grouped bars, never stacked on each other. In-period buckets sum exactly to the
Expected and Received cards. Clicking a month opens Payments filtered to that month's dates.

**Needs review** (independent of the period): Check payment (count, Σ remaining) · Date needed (non-held installments
with unknown timing and remaining > 0: count) · Needs review (open captures on policies with no current estimate:
count) · Missing commission (eligible policies with neither a current estimate nor an open capture: count).

**Eligible policies (denominator).** `public.wins` rows with a stable `policy_id` (FK to the policy registry),
`agent_id` = the signed-in user, `organization_id` = the caller's organization (explicit: `wins_select` also admits
Agency Group peers, which is never used here). Setup completeness = policies with a current estimate / eligible
policies. Missing values are shown as "—", never $0.

**Contact access is separate from financial access.** Client name, contact link and client-record policy fields
(carrier, type, effective date, premium, frequency) come only from `public.clients` read under the caller's own RLS
in the same function; when it returns nothing the row says **Restricted contact**, has no link, and shows only the
estimate's own saved carrier/product. `wins.contact_name` is never used.

**Consistency.** Each function is `STABLE`, so a response (rows, totals and counts) is one snapshot. Pages are
offset-paginated (≤ 100 rows) with an exact `total_count` and totals over the *whole* filter, never over a capped
fetch. If records change between page requests a later page can shift; the totals shown are always those of the
latest response, every tracking write invalidates all commission queries, and the UI shows "Updated" when a list's
totals change between pages.

## 5. Migration contract — `supabase/migrations/20261020180000_policy_commission_center_reads.sql`

One transaction; `lock_timeout 1s`, `statement_timeout 60s`. Read-only functions and two indexes. No change to any
existing function, table, column, RLS policy, grant, role, trigger or data.

**Guards:** refuse unless `20261019170000` and `20261020040000` objects exist (columns `expected_until`,
`schedule_assumed`); refuse replay (schema `policy_commission_reporting` or any new function exists); refuse unless
these existing definitions match their md5 preimages (authorization and RLS inputs the reads depend on):
`policy_commission_authz.actor_org()`, `policy_commission_authz.access(uuid)`, `private.campaign_actor()`,
`public.get_client_policy_commissions(uuid)` (the drawer parity reference).

**Schema** `policy_commission_reporting` — owner `postgres`; `USAGE` to `authenticated` only (revoked from `PUBLIC`);
not in PostgREST's exposed schemas. Holds the shared definitions so every read uses the same rules.

| Function | Kind | Owner | EXECUTE | search_path |
|---|---|---|---|---|
| `policy_commission_reporting.viewer()` | plpgsql STABLE INVOKER → (uid, org, today, time_zone) | postgres | authenticated | `pg_catalog, pg_temp` |
| `policy_commission_reporting.period(text, date, date, date, integer)` | IMMUTABLE → (from, to) | postgres | authenticated | same |
| `policy_commission_reporting.installments(uuid, uuid, date)` | SQL STABLE INVOKER, one row per current installment (§4 fields and status) | postgres | authenticated | same |
| `policy_commission_reporting.policies(uuid, uuid, date)` | SQL STABLE INVOKER, one row per eligible policy (estimate, capture, contact) | postgres | authenticated | same |
| `policy_commission_reporting.installment_json(…)`, `policy_detail(uuid, uuid, uuid)` | row / drawer JSON builders | postgres | authenticated | same |
| `public.get_my_commission_overview(p_period text, p_from date, p_to date)` | plpgsql STABLE INVOKER → jsonb | postgres | authenticated | same |
| `public.get_my_commission_installments(p_period, p_from, p_to, p_scope, p_status, p_kind, p_carrier, p_limit, p_offset)` | plpgsql STABLE INVOKER → jsonb page | postgres | authenticated | same |
| `public.get_my_commission_receipts(p_period, p_from, p_to, p_include_voided, p_limit, p_offset)` | plpgsql STABLE INVOKER → jsonb page | postgres | authenticated | same |
| `public.get_my_commission_policies(p_setup, p_carrier, p_limit, p_offset)` | plpgsql STABLE INVOKER → jsonb page | postgres | authenticated | same |
| `public.get_my_policy_commission(p_policy_id uuid)` | plpgsql STABLE INVOKER → jsonb (drawer) | postgres | authenticated | same |

- **SECURITY INVOKER everywhere:** the existing RLS on the six commission tables, `wins`, `clients` and
  `company_settings` applies to every row read; no privileged fallback. `PUBLIC`, `anon` and `service_role` are
  revoked on every new function (Supabase default privileges would grant them). The writer role gets nothing.
- `viewer()` raises `42501` without a signed-in actor, organization or own access (`access(auth.uid())` must be
  `'write'`) and `55000` for an unset/invalid agency zone (same rules as Reports). Every public read calls it first.
- Parameters are validated (`22023` with a human message): preset list, date bounds, Overview ≤ 731 days, scope
  `range | next_90 | any`, status `all | remaining | upcoming | check_payment | received | date_needed | on_hold`
  (`all` excludes held rows; `on_hold` lists them), kind `advance | month_10 | month_11 | month_12 | later`, setup
  `all | missing | needs_review | recorded | on_hold`, limit 1–100, offset ≥ 0.
- `get_my_policy_commission` returns `{policy, contact}` where `policy` has exactly the per-policy shape of
  `get_client_policy_commissions` (parity-tested for a visible client) and `contact` is `{client_id, name}` or null
  (restricted). `PT404` when the policy is not one of the caller's eligible policies.
- Reads never write (`STABLE`; tests assert no transaction id is assigned and every table's write counters are
  unchanged).

**Indexes (additive, on Phase 2A tables only):**
`policy_commission_receipts_agent_received (organization_id, credited_agent_id, received_on)` and
`policy_commission_captures_agent_open (organization_id, credited_agent_id) WHERE status IN ('awaiting_confirmation',
'needs_attention')`. Wins already have `performance_wins_org_agent_date (organization_id, agent_id, created_at)`.

**Rollback** `supabase/migrations/rollback/20261020180000_policy_commission_center_reads.rollback.sql`: drops exactly
the new functions, schema and indexes (refuses if not installed); touches no data (there is none of its own).

**Generated types:** `src/integrations/supabase/types.ts` gains the five public functions (postgres-meta output from
the disposable migrated schema, as for Phase 2A).

## 6. Frontend architecture

- `src/lib/commission/centerSchemas.ts` (Zod, strict, fails closed) and `centerApi.ts` (RPC calls; error kinds
  `denied` 42501, `time_zone` 55000, `invalid` 22023, `not_found` PT404, `unknown`).
- `src/lib/commission/centerFilters.ts`: URL search-param parsing with Zod (unknown values fall back to defaults).
- `src/hooks/useCommissionsCenter.ts`: access gate (permission, not impersonating, signed in, organization) and the
  five queries. Keys: `["policy-commissions", "center", userId, orgId, <read>, …filters]` — under the existing
  `["policy-commissions"]` prefix, so every tracking write (`useTrackingMutation` → `useRefreshPolicyCommissions`)
  refreshes the Overview, both Payments views, Policies, the drawer and the contact Commission section together.
  `retry: false`, `staleTime` 15 s, `placeholderData` keeps the previous page while paging.
- Drawer (`Sheet`): loads `get_my_policy_commission` and reuses `PolicyCommissionSummary`, `PolicyCommissionDetail`
  (Record payment, Edit dates, Edit date, Void with replacement, hold, replace), `CaptureAttentionNotice` and
  `RecordEstimateDialog` — the same `useTrackingMutation` registry, request ids and unresolved-write recovery. No new
  writer, no paid checkbox, no bulk action. "View policy" links to `/clients/:id` only for a visible contact.
- Small components (< 200 lines each), Tailwind tokens, emerald only for Received / accents, light and dark.

## 7. Copy (simple)

Heading "Commissions"; tabs Overview · Payments · Policies · Calculator; cards Expected · Received · Remaining ·
Next 90 days; sections Timeline · Upcoming · Needs review; actions Record payment · Edit dates · View policy · Record
estimate; states Date needed · Needs review · On hold · Check payment. No paragraphs under headings, no pay-grid name,
revision, contract level or rate. One ⓘ beside the heading: "AgentFlow estimates and payments you recorded. Not
carrier-verified. Expected dates assume payment 1–3 business days after each premium date." Card ⓘ tooltips hold the
definitions (Next 90 days: "From today through <date>. Not affected by the selected period."). Errors, payment
confirmations and unresolved-save warnings keep their existing wording. Body text ≥ 12 px.

## 8. Exact files

| File | Change |
|---|---|
| `supabase/migrations/20261020180000_policy_commission_center_reads.sql` | New migration (§5) |
| `supabase/migrations/rollback/20261020180000_policy_commission_center_reads.rollback.sql` | Guarded rollback |
| `supabase/tests/policy_commission_center.sql` | New suite: definitions, reconciliation, pagination, permissions, cross-org, reassignment, reads write nothing |
| `scripts/run_policy_commission_tests.sh` | Guards, inventory diff, suite, rollback/reapply for the new migration; benchmark |
| `scripts/tests/policy_commission/commission_center_postgrest.mjs` | Real PostgREST + supabase-js checks for the five reads |
| `.github/workflows/policy-commission-tracking.yml` | Path filters and frontend test list |
| `src/integrations/supabase/types.ts` | Five function signatures |
| `src/App.tsx` | `/commissions/:tab?` route and the legacy redirect |
| `src/components/layout/Sidebar.tsx`, `CommissionsNavItem.tsx` (replaces `CommissionCalculatorNavItem.tsx`) | Nav entry |
| `src/components/layout/TopBar.tsx` | Title map entries only |
| `src/pages/CommissionsPage.tsx` (new); `src/pages/CommissionCalculatorPage.tsx` → `src/components/commissions/CalculatorTab.tsx` | Page and calculator tab |
| `src/components/commissions/**` (new) | Tabs, period control, cards, timeline, upcoming, review, scheduled/history/policies tables, filters, pager, drawer, notices |
| `src/hooks/useCommissionsCenter.ts` (new), `src/hooks/useCommissionCalculator.ts` | Center hooks; calculator hook unchanged except the shared access helper |
| `src/lib/commission/{centerSchemas,centerApi,centerFilters}.ts` (new) | Parsing, calls, URL filters |
| Tests: `src/lib/commission/__tests__/center*.test.ts`, `src/components/commissions/__tests__/*`, `src/pages/__tests__/commissionsPage.test.tsx` (replaces `commissionCalculatorPage.test.tsx`), `src/components/layout/__tests__/viewAsSidebarNav.test.tsx`, `src/hooks/__tests__/useCommissionsCenter.test.tsx` | New and updated |
| `docs/plans/2026-10-20-commissions-center/{implementation_plan,verification}.md`, `screenshots/` | Records |
| `implementation_plan.md`, `WORK_LOG.md`, `AGENT_RULES.md`, Phase 2A `implementation_plan.md` / `verification.md` (status lines, §16 release note) | Records and reconciliation |

Unchanged: both applied migrations, sale writers, companions, handoff, tracking functions, receipt idempotency,
schedule rules, `CalculatorWorkspace` and the calculator engine, `TwilioContext`, dialer, callbacks, Reports.

## 9. Verification (local and CI, synthetic data only)

Fresh frontend baseline at `0312520` (full Vitest, app typecheck); `npx tsc --noEmit`; app typecheck parity; focused
and regression suites (commission, contacts, sale handoff, sidebar/View As, calculator); scoped ESLint; build;
`git diff --check`. Database: disposable PostgreSQL 16.15 locally and 17.6 + PostgREST 12.2.3 in CI — guards,
inventory, the new suite (multiple/partial/excess/voided/replaced receipts, holds, superseded, month-crossing windows,
month timing, unknown dates, non-monthly, zero rate, missing estimates, open captures, pagination reconciliation,
same-org denial, cross-org, Agency Group peer, reassignment with restricted contact, Own toggle off, time zone unset,
reads write nothing), rollback/reapply, PostgREST checks, local advisors. Browser: an uncommitted visual harness with
synthetic fixtures (real sidebar, page and dialogs; stubbed auth and RPCs) at 1440 px and 390 px, light and dark.

## 10. Gates

1. **Local build and draft PR** (this approval).
2. Production migration `20261020180000` (database only, read functions and two indexes) — separate approval.
3. Frontend release (merge, deploy) — separate approval; the new UI calls functions that exist only after gate 2.
