# Commissions Overview — breakdowns, comparisons, Months 10–12, monthly goal and Hide amounts

**Gate 2 completion update — 2026-10-21 05:33 UTC (October 20, 10:33 PM PDT):** migration `20261021180000` applied once through the authorized cloud SQL Editor as `postgres`; exact stored text verified. Fresh preflight 20/20, read-back 24/24; all six fingerprints and all existing catalog objects unchanged; both advisors unchanged. Gate 3 remains unapproved and PR #474 remains draft. See `verification.md` §8 for the execution record. Earlier preparation entries below are retained as history.

**Status:** local build done; Gate 2 database release APPLIED and verified (2026-10-21 ~05:32 UTC, October 20 PDT)
for source `0aebd01` and the exact migration bytes. Fresh preflight 20/20, read-back 24/24; all six fingerprints,
existing catalog and both advisors unchanged (§11; `verification.md` §8). Gate 3 frontend release remains unapproved.
Draft PR #474 stays on `claude/zen-clarke-wdwrrb` from `main` `e762454`. No direct `main` push, merge, frontend
release or production test write.

Public document: synthetic examples only; no compensation values, carrier products or private grid data (D1).

## 0. Source of truth (read 2026-10-21)

- AGENT_RULES (Commissions center, Phase 2A, commission grids, Sold Date #42, View As, multi-tenancy, §7 component
  standards, §10 forbidden patterns), VISION, WORK_LOG newest entries (Gate 2/3 release of the center). No conflict
  with this task.
- Released contract: `docs/plans/2026-10-20-commissions-center/implementation_plan.md` §4 (definitions) and §5
  (migration `20261020212000`). This plan adds to it and changes none of its definitions.
- Hosted migration history (read-only `list_migrations`, 2026-10-21): head `20261020212000 /
  policy_commission_center_reads`. The new version **`20261021180000`** sorts after it and after every repository
  file; re-check against hosted history immediately before any release.
- Applied and immutable, not edited or replayed: `20261019170000`, `20261020040000`, `20261020212000`.
- Concurrent PRs: #473 (navigation icon) changes only `src/components/layout/CommissionsNavItem.tsx`, its plan and a
  WORK_LOG entry. This task does not touch `CommissionsNavItem.tsx`; WORK_LOG entries are both kept (newest first).
  No other open PR touches the commission paths.
- Existing storage reviewed for goals: `profiles.monthly_premium_goal` (premium, not commission; must not be reused),
  `public.goals` (agency-wide, no owner, no month — wrong scope), `public.user_preferences` (one jsonb blob per user, no
  organization, no month; read-modify-write races). None fits, so goals get one small owner-scoped table (§5).

## 1. Outcome

The released Overview gains, from Chris's approved visual: **By carrier** (horizontal bars), **By product** (doughnut
with a readable legend), compact **comparisons**, a compact **Months 10–12** highlight, an optional **monthly goal**
beside Received and an **eye control** (Hide amounts) beside the Commissions heading. Overview · Payments · Policies ·
Calculator, the four summary cards and their meanings, Timeline, Upcoming and Needs review are kept. Averages live in
expanded breakdown details, not new cards. Short labels; definitions in ⓘ popovers. Nothing from the generated mockup
(metric definitions, carriers, clients, statuses, navigation) is copied.

Not in scope: reminders, cron, carrier imports, renewals, chargebacks, payroll, team/admin reporting or management of
another person's goals, Reports-page work, financial-data cleanup, This week/Next week shortcuts, setup widgets, new
permissions, changes to sale logic, receipt writers, retries, calculator math or dialer telemetry.

## 2. Definitions (server-computed; shared by charts, totals and drill-downs)

All rules of the released contract hold: My commissions only (credited seller = `auth.uid()`, caller's organization,
existing RLS and the Own toggle), agency calendar dates, saved integer cents, nothing recalculated from today's grid or
a client's current premium, reads never write.

**Sales cohort (Policies, Est. commission).** Eligible policies are the released `policy_commission_reporting.policies()`
rows (wins with a stable `policy_id`, `agent_id` = me, my organization; Agency Group peers excluded). A policy is in
the period when its sale's **`wins.sold_date`** is in `[from, to]` (Sold Date #42). Unknown Sold Date is never placed
in a period; it is disclosed as `undated_count`.
- **Policies** = count of distinct eligible `policy_id`s in the cohort, with or without an estimate. Installments are
  never counted as policies.
- **Est. commission** = Σ `first_year_cents` of the cohort's **current, active** estimates (the saved first-year
  figure; superseded never counts). Held estimates are excluded and disclosed (`on_hold_count`, `on_hold_cents`), as on
  the Expected card. A policy without an estimate is "missing", never $0.
- **With estimates** = cohort policies with an active estimate; the average is Est. commission ÷ With estimates and is
  shown only when that count is > 0. Labels say "saved estimate", never earned/paid/carrier-verified.
- This is **not** the Expected card (payment-window dates). Copy: "Est. commission · by sale date" with ⓘ "Saved
  first-year estimates on policies sold in this period. Not Expected, which uses payment dates."

**Received (by carrier).** Σ non-voided receipts with `received_on` in the period, whatever the sale date or estimate
status — exactly the Received card. Receipts are grouped by their estimate's saved carrier; amounts are never joined
before aggregation in a way that could repeat a receipt (one receipt ↔ one estimate row).

**Carrier (authoritative source, fallback order).**
1. The current estimate's saved `product_carrier` (snapshot when the estimate was recorded); for a receipt, its own
   estimate's `product_carrier`.
2. Otherwise the client record's carrier (primary policy column or the matching additional-policy entry), **only when
   the contact is visible under the caller's own RLS**.
3. Otherwise **Unknown** (always shown as its own group; never dropped, never folded into Other, never filled by
   bypassing contact RLS).

Grouping key = `lower(btrim(carrier))` — case and surrounding spaces only, identical to every released carrier filter
and the Phase 1 exact-identity rule; distinct carriers are never fuzzy-merged. Display name = the most common stored
spelling in the group (ties: first in order). Top 5 by the selected metric are drawn, plus **Other carriers** (the
rest, summed) when more exist; **View all** lists every group. Other is not a drill-down (it expands View all).

**Product (mutually exclusive categories).** Term · Whole Life · IUL · Final Expense · Other type · Unknown.
Source and fallback: (1) the sale's own `wins.policy_type` snapshot; (2) only if that is blank, the visible client
record's policy type; (3) Unknown. Normalized by case and spacing only to the four product types; any other non-blank
type is **Other type**. The estimate's grid category is **never** used: a `whole_life` grid product also serves Final
Expense sales, so it cannot distinguish them (Final Expense never counts as Whole Life and is never inferred from a
grid category).

**Comparisons** (policies sold, est. commission on those sales, received). Server-resolved windows:
| Selected period | Current | Previous |
|---|---|---|
| Starts after today (e.g. Next month) | — | no comparison |
| Whole calendar month(s), ended (Last month, Last year, a custom whole-month span) | the period | the same number of whole months immediately before |
| Whole calendar month(s) including today (This month, This year) | first day → today | same elapsed portion one span earlier (day clamped to month end; Mar 31 → Feb 28/29) |
| Other custom range, ended | the range | equal-length range immediately before |
| Other custom range including today | start → today | equal-length range immediately before that |
Labels name both windows whenever the current window differs from the selected range ("Oct 1 – 21 vs Sep 1 – 21").
A change is shown as the absolute difference; a percentage only when the previous value is > 0 (never ∞ or a made-up
%). Neutral styling: no good/bad colour. Remaining is not compared.

**Months 10–12 (next agency month).** Σ remaining (`max(expected − all valid receipts, 0)`) over **active** Month 10,
11 and 12 installments whose saved window **starts** in the next agency calendar month, with remaining > 0 — the
released allocation rule; held and superseded excluded; an Advance overpayment never settles them. Also the payment
count and the distinct policy count. First-year installments, not renewals. Link: Payments › Scheduled, Next month,
Status Remaining, Type Months 10–12 — whose totals equal the highlight.

**Monthly goal.** Optional, owner-only target in whole cents (1 … 100,000,000) per organization, owner and agency
calendar month. Progress numerator = the same month's **Received** (non-voided manual receipts by `received_on`);
never premium, Expected, calculator or deposits. Shown only when the Overview period is exactly one whole calendar
month (This month by default; hidden for multi-month or partial ranges). Bar capped at 100 %; the figure may exceed it
(floor, so 99.6 % shows 99 %). Set / Edit / Clear goal; no default target; opening the page never creates one.

## 3. Drill-downs (exactly matching lists)

| Chart element | Opens | Filters (URL) |
|---|---|---|
| Carrier bar, Policies or Est. commission | Policies | Sold period (`period`/`from`/`to`), `carrier=<name>` or `carrier_unknown=1` |
| Carrier bar, Received | Payments › History | `period`/`from`/`to`, `carrier` or `carrier_unknown=1`, voided hidden |
| Product slice or legend item | Policies | Sold period, `type=<category>` |
| Months 10–12 | Payments › Scheduled | `period=next_month`, `status=remaining`, `kind=later` |

Policies gains a **Sold** period control (default **All time**, so its existing address keeps its meaning), a **Type**
select and an **Unknown carrier** option; its totals line shows Policies · With estimates · Est. commission (· on hold
not included). History gains a **Carrier** select. They compose with the existing Setup, Carrier, Show voided and page
filters (AND). Lists read the new list functions, which return the whole-filter totals the charts use, so every
bar/slice equals its list's totals (proved in SQL across pagination). Scheduled is unchanged.

## 4. Hide amounts (display preference; not an authorization boundary)

- One eye button beside the heading: **Hide amounts** / **Show amounts** (icon button, visible tooltip text, state
  announced in a polite live region). Applies to the whole Commissions Center: Overview, Payments, Policies,
  Calculator, the drawer and every financial dialog opened from them. The contact view outside the center is unchanged
  (the context defaults to visible).
- Hidden: every amount becomes `••••`; monetary plots (Timeline, carrier/product money metrics, goal bar, money
  comparisons, the Timeline's sr-only table) are replaced by a neutral "Amounts hidden" panel — no axis, tooltip,
  label, `aria-label`, `title`, sr-only text or CSS blur carries a value. Policy-count charts, carrier names, counts,
  dates and navigation stay.
- Editing requires an explicit **Show amounts** first: Record payment, Void, Record/Replace estimate, hold, dates,
  Edit dates, capture confirm/dismiss, goal editing and the Calculator inputs show a small gate with a Show amounts
  button. Forms stay mounted (`hidden`), so typed values, request ids and unresolved-operation recovery survive the
  toggle; nothing auto-reveals when a drawer or dialog opens; a blind payment confirmation is impossible.
- Stored only in this browser's `localStorage` as `agentflow.commissions.hideAmounts.v1:<user>:<organization>` = `1`,
  read synchronously before the first render (no flash), synced across tabs by the `storage` event, ignored when
  storage is unavailable (defaults to shown). The page is keyed by user and organization, so an identity change
  discards the previous state and late responses (query keys already include the identity). No financial data is
  stored.

## 5. Migration — `supabase/migrations/20261021180000_policy_commission_center_insights.sql`

One transaction; `lock_timeout 1s`, `statement_timeout 60s`. Additive only: no existing function, table, column,
policy, grant or data changes.

**Guards:** refuse unless `20261020212000` objects exist; refuse replay (schema `policy_commission_insights` or table
`policy_commission_goals` exists); refuse unless the reused definitions match their applied md5 preimages
(`policy_commission_reporting.viewer()`, `.period(...)`, `.installments(...)`, `.policies(...)`, `.contact_json(...)`,
`.iso_or_null(text)`, `policy_commission_authz.actor_org()`, `policy_commission_authz.access(uuid)`).

**Table `public.policy_commission_goals`** (owner `postgres`):
`organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE`, `owner_id uuid NOT NULL`,
`month date NOT NULL CHECK (first day of a month, 2000-01 … 2100-12)`, `target_cents bigint NOT NULL CHECK (1 …
100000000)`, `created_at`, `updated_at`; primary key `(organization_id, owner_id, month)`.
- RLS enabled; one policy `policy_commission_goals_owner` FOR ALL TO authenticated, USING and WITH CHECK
  `owner_id = auth.uid() AND organization_id = policy_commission_authz.actor_org() AND
  policy_commission_authz.access(auth.uid()) = 'write'` (own toggle). No admin, Team Leader, Agency Group or
  service-role path.
- Grants: revoke all from `PUBLIC`, `anon`, `authenticated`, `service_role`; grant `SELECT, INSERT, DELETE` and
  `UPDATE (target_cents, updated_at)` to `authenticated`. The app writes goals through `set_/clear_my_commission_goal`;
  authorized owners also have direct table writes on their own rows (insert, delete, update of the target), limited by
  the same owner-only RLS policy, the column grants and the CHECK constraints. A direct write may set its own
  `created_at` / `updated_at`; it can never reach another owner's, organization's or month's row.

**Schema `policy_commission_insights`** (not exposed; USAGE `authenticated` only) — helpers:
`carrier_key(text)`, `category(text)`, `policy_category(policy_fact)`, `policy_carrier(policy_fact)` (IMMUTABLE) and
`comparison(date, date, date)` (IMMUTABLE → basis, current and previous windows).

**Public functions** (owner `postgres`, `SECURITY INVOKER`, `search_path = pg_catalog, pg_temp`, EXECUTE
`authenticated` only — revoked from `PUBLIC`, `anon`, `service_role`; the writer role gets nothing):
| Function | Kind | Returns |
|---|---|---|
| `get_my_commission_breakdown(p_period, p_from, p_to)` | STABLE | meta, cohort totals and coverage, carrier groups, product groups, comparison, Months 10–12 |
| `get_my_commission_policy_list(p_setup, p_carrier, p_carrier_unknown, p_category, p_period, p_from, p_to, p_limit, p_offset)` | STABLE | the released policy page + `category`, `sold_date`, whole-filter `totals`, carrier names, `has_unknown_carrier` |
| `get_my_commission_receipt_list(p_period, p_from, p_to, p_include_voided, p_carrier, p_carrier_unknown, p_limit, p_offset)` | STABLE | the released receipt page + carrier filter, carrier names, `has_unknown_carrier` |
| `get_my_commission_goal(p_month)` | STABLE | `{month, target_cents | null, updated_at}` + meta |
| `set_my_commission_goal(p_month, p_target_cents)` | VOLATILE | upsert of the caller's row for that month only |
| `clear_my_commission_goal(p_month)` | VOLATILE | delete of the caller's row for that month only (explicit action) |

Every function calls the released `viewer()` first (42501 without own access; 55000 for an unset agency zone).
Validation `22023` with a human message (period, setup, category, carrier/unknown together, limit 1–100, offset ≥ 0,
first-of-month, target range). Distinct names, not default-argument overloads; the released five reads stay for
browsers opened before the frontend release.

**Rollback** `rollback/20261021180000_policy_commission_center_insights.rollback.sql`: refuses while any goal row
exists; otherwise drops exactly the new functions, schema and table.

**Generated types:** `src/integrations/supabase/types.ts` gains the table and six functions.

## 6. Frontend

- `centerSchemas.ts` (strict Zod: breakdown, policy list, receipt list, goal), `centerApi.ts` (new reads; goal set
  and clear), `centerFilters.ts` (Policies sold period/type/unknown carrier, History carrier, drill-down hrefs),
  new `insights.ts` (top-N + Other, comparison labels and deltas, single-month detection, goal progress, goal form
  Zod), new `amountsPreference.ts`.
- `useCommissionsCenter.ts`: breakdown and goal queries and the goal mutation under the existing
  `["policy-commissions", "center", user, org, …]` keys (every tracking write already refreshes them; goal writes
  refresh the goal); Policies and History use the new list reads with the released placeholder rule.
- Components (< 200 lines each, Tailwind tokens, light/dark): carrier bars as keyboard-accessible HTML rows (direct
  labels, no axis), product doughnut (Recharts; ≤ 6 slices; 2px surface gaps; categorical slots 1–5 in fixed order,
  Unknown neutral) with a legend of links, breakdown details tables (also the accessible data view), comparisons
  strip, Months 10–12 card, goal progress/editor inside the Received card, eye toggle and gates.
- Overview layout: period · cards (goal under Received) · comparisons · By carrier | By product · Timeline | Months
  10–12 + Needs review · Upcoming.

## 7. Exact intended files

| File | Change |
|---|---|
| `supabase/migrations/20261021180000_policy_commission_center_insights.sql` | New migration (§5) |
| `supabase/migrations/rollback/20261021180000_policy_commission_center_insights.rollback.sql` | Guarded rollback |
| `supabase/tests/policy_commission_insights.sql` | New suite (§8) |
| `scripts/run_policy_commission_tests.sh` | Guards, drift refusal, inventory, suite, released center suite on the final state, rollback/reapply |
| `scripts/tests/policy_commission/commission_insights_postgrest.mjs` | Real PostgREST + supabase-js checks |
| `.github/workflows/policy-commission-tracking.yml` | Path filters for the new migration |
| `src/integrations/supabase/types.ts` | Table and six function signatures |
| `src/lib/commission/{centerSchemas,centerApi,centerFilters}.ts`; new `insights.ts`, `amountsPreference.ts` | Data layer |
| `src/hooks/useCommissionsCenter.ts` | New queries and goal mutation |
| `src/pages/CommissionsPage.tsx` | Provider and eye toggle |
| `src/components/commission/ui/AmountsVisibility.tsx` (new) | Context, toggle, gate, `useAmounts` |
| `src/components/commissions/overview/*` | `OverviewTab`, `SummaryCards`, `CommissionTimeline`, `NeedsReview`, `UpcomingList`; new `CarrierBreakdown`, `ProductBreakdown`, `BreakdownDetails`, `Comparisons`, `MonthsTenToTwelve`, `GoalProgress` |
| `src/components/commissions/payments/{PaymentsTab,ScheduledView,ScheduledTable,HistoryView}.tsx` | Masking; History carrier filter |
| `src/components/commissions/policies/{PoliciesTab,PoliciesTable}.tsx`; new `PoliciesFilters.tsx` | Sold/Type/Unknown carrier filters, totals, masking |
| `src/components/commissions/CommissionDrawer.tsx`, `shared/{Bits,CarrierSelect}.tsx` | Masking, Show amounts action, shared carrier select |
| `src/components/commission/policy/{PolicyCommissionSummary,InstallmentRow,ReceiptList,CaptureAttentionNotice,ScheduleBasisControl,RecordPaymentDialog,VoidReceiptDialog,RecordEstimateDialog,CommissionHoldDialog,InstallmentTimingDialog}.tsx` | `useAmounts` masking and edit gates only (default visible: contact view unchanged) |
| `src/components/commission/calculator/{CalculatorWorkspace,CalculatorResults}.tsx` | Masking and input gate only (engine unchanged) |
| Tests: `src/lib/commission/__tests__/{centerSchemas,centerFilters,insights,amountsPreference}.test.ts`, `src/hooks/__tests__/useCommissionsCenter.test.tsx`, `src/components/commissions/__tests__/{breakdowns,goal,hideAmounts,…}`, `src/components/commission/policy/__tests__/hideAmountsDialogs.test.tsx`, `src/pages/__tests__/commissionsPage.test.tsx` | New and updated |
| `docs/plans/2026-10-21-commissions-insights/{implementation_plan,verification}.md`, `screenshots/` | Records |
| `implementation_plan.md`, `WORK_LOG.md`, `AGENT_RULES.md` (proposed amendment, marked not live) | Records |

Unchanged: the three applied migrations, sale writers, companions, tracking functions and writer role, receipt
idempotency, schedule rules, calculator engine and matching, `CommissionsNavItem.tsx` (PR #473), Reports, dialer.

## 8. Verification (synthetic data only)

- Fresh baseline at `e762454` in a separate worktree: `npx tsc --noEmit`, app typecheck (`tsc -p tsconfig.app.json`),
  full Vitest (inert Supabase env); compared with the branch.
- Disposable PostgreSQL 16 (local) and 17.6 + PostgREST 12.2.3 (CI): guards, drift refusal, inventory (existing objects
  unchanged), the new suite — carrier/product totals equal an independent recomputation; every bar/slice equals its
  list's totals walked across pagination; multiple policies, missing estimates, unknown carrier and type, restricted
  contacts, partial receipts, voids, holds, replacement/supersede, Final Expense vs whole-life grid category;
  comparison windows (MTD, completed months, custom, future, month ends, leap years, zero baselines); Months 10–12
  reconciliation with Scheduled; goal isolation (owner, organization, month), set/edit/clear, no write on read,
  validation, RLS on direct table access, overachievement; reads assign no transaction id; ACLs. The released center
  suite also runs on the final state. Rollback refusal/restore/reapply. Supabase advisors only after an approved
  database change (none here).
- Frontend: schemas, filters, insights math, preference storage, hooks (keys by identity; nothing under View As),
  charts and drill-down hrefs, comparisons, Months 10–12, goal flows, Hide amounts on every tab, drawer and dialogs
  (no amount in text, `aria-label` or `title`; reload; identity change; failed fetch; typed data and unresolved
  payment preserved), calculator gate; regressions (commission, contacts, sale handoff, sidebar/View As, calculator).
  Scoped ESLint, `vite build`, `git diff --check`.
- Screenshots: uncommitted Vite harness with synthetic fixtures at 1440 px and 390 px, light and dark, real controls
  and keyboard.

## 9. Gates

1. Local build, disposable tests and draft PR (this approval).
2. Production migration `20261021180000` (new table, RLS policy, grants, functions) — separate exact-action approval;
   re-check hosted history; advisors before/after.
3. Frontend release (merge, deploy) — separate approval, only after gate 2 (the new UI calls functions that exist
   only after it).

## 10. Implementation record — deviations and findings (local build, 2026-10-21)

- **Extra files beyond §7:** `src/components/commission/ui/amountsContext.ts` (context, hook and placeholder split from
  `AmountsVisibility.tsx` so the component file exports components only — lint's fast-refresh rule);
  `src/components/commissions/overview/GoalEditor.tsx` (keeps `GoalProgress` small);
  `src/components/commissions/CommissionPeriodControl.tsx` (optional `label`, for "Sold");
  `scripts/tests/policy_commission/measure_center_reads.sh` (times the four new reads when the migration is present).
- **Generated types:** the six function signatures only, as the released center did (the commission tables are not in
  `Tables`).
- **Missing estimates in charts:** a carrier or product with no saved estimate shows "—" in the Est. commission view
  (found in self-review; a `$0.00` there would have read as a real zero).
- **Goal progress accessibility:** the shared `Progress` component does not forward `value` to Radix, so the goal bar
  passes `aria-valuenow` (capped) and `aria-valuetext` (the real percentage) itself; the shared component is unchanged.
- **Doughnut** starts at 12 o'clock and runs clockwise; colours are categorical slots 1–5 (validated light and dark;
  the light-mode contrast warning is relieved by the labelled legend and the details table) with Unknown neutral.
- **Disposable cluster location:** PostgreSQL refuses to run as root and the session scratchpad is root-only, so the
  loopback test cluster lived in `/tmp/pc_cluster_55432`.

- **Carrier groups after the draft PR (`0aebd01`, found in self-review):** the breakdown check no longer re-derives
  carrier keys in the browser (JS trimming and case folding differ from the server's `lower(btrim())` for tabs and some
  non-ASCII letters, which could reject a valid breakdown); it checks that group labels are distinct, which the server
  guarantees. The carrier filter's matching now trims spaces only, like `btrim`. No SQL change.

## 11. Gate 2 — database-only release (approved by Chris 2026-10-21; source `0aebd01`)

**Approval.** Gate 2 only, for source `0aebd014002341a92e04cba65fd1ffce6a68a1c9` and migration
`20261021180000_policy_commission_center_insights.sql`, SHA-256
`d390cc8e267a86fdc829da3a514d184b74f6d270d4199af1d57f2c9e465b3345`, 34,179 bytes: these exact bytes, including the
owner-only goal table, its RLS policy and grants, and the reviewed functions. Not approved: merge, frontend release,
backfill, cleanup, production goal/receipt/sale/test-policy writes, any SQL change. PR #474 stays draft; PR #473 is
untouched. An application fix would need a plan amendment, an exact file list and Chris's explicit approval first.

**Source check.** Recomputed from `git show 0aebd01:<file>`: SHA-256 `d390cc8e…5b3345`, MD5
`428020c9b8264e85dc9fcff992c426de`, 34,179 bytes; the working-tree file is byte-identical.

**Method** (the Commissions center's Gate 2 method, `docs/plans/2026-10-20-commissions-center/verification.md`
§13–§15, with this migration's values):
1. **Read-only preflight** immediately before apply: `list_migrations` (hosted head must be `20261020212000`; nothing
   recorded at or after `20261021180000`); `release/preflight.sql` (server version; the three applied commission
   migrations recorded with their stored-text SHA-256; new objects absent; the eight preimage fingerprints the
   migration requires; prerequisite objects; RLS on the six commission tables; no lock waits); `release/catalog.sql`
   (count and digest per catalog category for every existing object, excluding exactly what this migration creates, so
   before and after must be equal); six-table fingerprints (row count, full-row MD5, insert/update/delete counters,
   session time zone); security and performance advisors.
2. **Apply package.** `release/build_apply.py` reads the exact file and refuses unless SHA-256, MD5 and length are the
   approved values; it prints one ASCII-only statement, sent as one request (one implicit transaction): the file's own
   `lock_timeout 1s` / `statement_timeout 60s`; a DO block holding the file text with its non-ASCII characters expanded
   server-side; refusal unless the expanded text's MD5, SHA-256 and UTF-8 length equal the approved values, the three
   prerequisites are recorded, nothing is recorded at or after `20261021180000` and the caller is `postgres`; then
   `EXECUTE` of the text unchanged (the file's own prerequisite, replay and eight-preimage guards run inside), a role
   re-check and the history row `('20261021180000', 'policy_commission_center_insights', ARRAY[text])`. Any refusal or
   error rolls everything back. No timestamp substitution, no blanket push, no replay.
3. **Rehearsal** before production on a disposable PostgreSQL with the released history: preflight; lock-timeout
   refusal; changed-byte refusal; later-version refusal; apply; read-back; catalog and fingerprint equality; replay
   refusal; rollback restore; equality with a reference `psql -1 -f` apply.
4. **Execution route.** The established route is the project's Supabase SQL Editor, signed in as `postgres` in a
   browser (secure sign-in by browser takeover, never credentials in chat), or an authorized direct database
   connection. Supabase MCP `execute_sql` is a read-only audit tool here (AGENT_RULES §11) and `apply_migration`
   stamps its own version; neither applies this migration. If neither route is available, stop before execution and
   report that blocker. Apply once; if the outcome is unclear, inspect history and objects before any retry; if
   another migration is recorded first, stop for review.
5. **Read-back** (read-only): `release/readback.sql` (exact history row; recorded last; goal table columns,
   constraints, foreign key, RLS, its single owner policy and exact grants; insights schema owner and USAGE; the 12 new
   functions' invoker, owner, `search_path`, volatility and EXECUTE `authenticated` only; the eight preimages and RLS
   on six tables unchanged); `release/catalog.sql` equal to the preflight; six-table fingerprints equal; advisor delta
   explained. No production goal, receipt, sale or test policy is created.
6. **Stop conditions:** any not-ok row, hash or length mismatch, a later recorded version, an unexpected catalog or
   advisor change, or a fingerprint difference: stop, report, no blind retry.

Locks: the goal table's foreign key takes a brief `SHARE ROW EXCLUSIVE` lock on `organizations` (blocks writes to it,
not reads); on a lock timeout, retry later and never raise the timeouts.

**Documentation files (only; no application code, no SQL migration change):**
- `docs/plans/2026-10-21-commissions-insights/implementation_plan.md` — this section; goal-write wording (§5); the
  `0aebd01` record (§10).
- `docs/plans/2026-10-21-commissions-insights/release/preflight.sql`, `catalog.sql`, `readback.sql`,
  `build_apply.py` — new: read-only checks and the package builder.
- `docs/plans/2026-10-21-commissions-insights/verification.md` — Gate 2 record; goal-write wording.
- `AGENT_RULES.md` — proposed section: goal-write wording and migration status.
- `implementation_plan.md` (root) — entry status.
- `WORK_LOG.md` — newest-first Gate 2 entry.
- PR #474 description — status and goal-write wording.

**Execution result (2026-10-21, ~04:50 UTC): stopped before apply — route unavailable.** Source check, package build
(SHA-256 `3cee7e7c…3778`, 37,157 bytes), full rehearsal and the production read-only preflight all passed (preflight
20/20 with the eight preimage fingerprints; history head `20261020212000`; six-table fingerprints identical to the
2026-10-20 record; catalog and advisor baselines captured). This cloud session has neither a signed-in SQL Editor
(no browser on Chris's computer, no browser takeover here) nor an authorized direct connection, so nothing was
applied and no route was improvised. Evidence and the remaining steps: `verification.md` §7.
