# Implementation Plan — Organization leaderboard aggregate RPC (fix Agent-RLS zero standings)

**Status:** **IMPLEMENTED LOCALLY on branch `bugfix/leaderboard-org-aggregate-rpc`** — Chris approved this plan on 2026-08-05 (D1 INCLUDED: the Dashboard `LeaderboardWidget` uses the canonical aggregate; the unapplied `20260614120000` tie-break migration stays a separate follow-up, untouched). NOT committed, NOT pushed, NOT merged, NOT deployed. Migration **`20260805090000_get_org_leaderboard_stats_rpc.sql` authored but NOT APPLIED to production** — awaiting Chris's separate apply approval. All local gates green (tsc 0 · new suites 17/17 fail-first-proven · full vitest 930/930 host TZ, 918+12 skipped UTC, 930/930 LA · ESLint clean · build OK). SQL suite `supabase/tests/leaderboard_aggregate_rpc.sql` is PENDING-EXECUTION (dev branch/local stack — no psql/docker on this machine); the RPC's aggregation body was validated read-only against prod as a plain SELECT. As-built deltas from this plan: none in scope; typing was done via a surgical hand-added `Functions` entry in `types.ts` (per Chris's no-`as any` constraint) that post-apply regeneration should reproduce byte-for-byte. See the 2026-08-05 `WORK_LOG.md` entry for full figures.
**Date:** 2026-08-04 (plan) · 2026-08-05 (implementation)
**Baseline:** `origin/main` = **`95b7b76`** (merge of PR #346, the agency-display-name bugfix). Newest `WORK_LOG.md` entry is that bugfix's record. No conflicting in-flight work found: Dashboard Closeout Build 1 (PR #343, merged) explicitly deferred "Leaderboard convergence" and "the Dashboard aggregate RPC"; Build 2 is hard-blocked on D1 (sales lifecycle) and has produced no leaderboard decisions.
**Branch plan:** cut **`bugfix/leaderboard-org-aggregate-rpc`** from `origin/main`. Pre-existing dirty files excluded from every commit, as always: `deno.lock`, `.claude/`, `.cursor/`, `tsconfig*.tsbuildinfo`.

> Supersedes the invited-Step-3 display plan (shipped as PR #346, merged as `95b7b76`; durable record in the 2026-08-04 `WORK_LOG.md` entry and git history).

---

## 1. Confirmed root cause (evidence, all verified read-only against prod `jncvvsvckxhqgqvkppmj`)

The organization Leaderboard computes every agent's metrics **in the browser** from raw tables ([useLeaderboardData.ts:236-302](src/hooks/useLeaderboardData.ts) `computeStats`), but the live RLS policies only let an **Agent** read their *own* rows:

| Table | Live SELECT policy (verified via `pg_policies`) | Agent can read peers? |
|---|---|---|
| `calls` | `Calls Hierarchical Access`: `agent_id = auth.uid()` OR Admin-org OR TL-downline OR unassigned-inbound (+ group peer read) | **No** |
| `appointments` | `appointments_select`: `user_id = auth.uid() OR created_by = auth.uid()` OR Admin OR TL-same-team | **No** |
| `clients` | `Clients Hierarchical Access`: `assigned_agent_id = auth.uid()` OR Admin OR TL-downline | **No** |
| `wins` | `wins_select`: `organization_id = get_user_org_id()` (+ peer orgs) | Yes (org-wide) |
| `profiles` | `profiles_select_org`: `organization_id = get_user_org_id()` | Yes (org-wide roster) |

So an Agent sees the full **roster** (profiles) and org-wide **wins**, but zero rows of other agents' **calls**, **appointments**, and **clients** — and the hook converts both RLS-filtered results and outright query errors into zeros (`callsRes.data || []` etc., [useLeaderboardData.ts:267-269](src/hooks/useLeaderboardData.ts:267), plus swallow sites at lines 386, 396-402, 444 and [leaderboardPremium.ts:19](src/components/leaderboard/leaderboardPremium.ts:19)). Result: on an Agent's screen, every other agent shows 0 Calls Made, 0 Talk Time, 0 Appointments — while Policies Sold/Premium (wins-backed) still show — i.e. corrupted mixed standings. A production role simulation confirmed 82 other-agent call rows and 11 other-agent appointment rows visible to Admin but 0 to an Agent session.

**Additional latent defects the same fix resolves (all verified in code + prod data):**

1. **Calls Made / Talk Time count inbound calls.** `computeStats` has **no direction filter** (4 inbound rows exist in prod). Canon (invariant #14's `get_trusted_today_dialer_stats`, `report-utils`/`webrtcInboundCaller.OUTBOUND_CALL_DIRECTIONS`) is `lower(coalesce(direction,'')) IN ('outbound','outgoing')`.
2. **Appointments undercount for everyone, including Admins.** The hook attributes by `created_by` **only** ([line 286](src/hooks/useLeaderboardData.ts:286)), but **11 of 12** live appointment rows have `created_by IS NULL` with `user_id` set (writers split: `dialer-api.saveAppointment` and `CalendarContext.addAppointment` set `user_id` only; `FloatingDialer` sets `created_by` only; `FullScreenContactView` sets both; prod has **0** rows where the two are set and differ).
3. **Premium fallback is itself RLS-broken.** `loadClientMonthlyPremiums` reads `clients` from the browser — an Agent cannot read peers' client rows, so the `clients.premium` fallback silently returns 0 for other agents.
4. **Wrong timestamp column.** The hook filters calls on `started_at`; the repo's canonical trusted-aggregate timestamp is **`calls.created_at`** (`get_trusted_today_dialer_stats`, `useDashboardStats`, `GoalProgressWidget`). Prod delta: **0 rows** differ by more than 5 minutes; both default `now()`.
5. **Inclusive `.lte` bounds** instead of the repo-standard half-open `[start, end)`.

**Fallout statuses:** inspected as required — `wins` has **no status/fallout/chargeback column**, no code path updates or deletes wins, and every reader counts all rows by `created_at`. There is **no currently implemented canonical exclusion path**; the RPC therefore counts all wins rows (exact parity with today) and invents no status labels. Appointment statuses in use: `Scheduled/Confirmed/Completed/Cancelled/No Show`; the leaderboard has never filtered them (booking credit is preserved after cancellation/reschedule — reschedules are `start_time` updates that leave `created_at` untouched). The Goals module's own cancel-exclusion stays untouched (different surface, out of scope).

---

## 2. Fix architecture — one server-side aggregate RPC

**Do not touch any RLS policy.** Raw-table policies stay exactly as they are; the browser stops trying to reconstruct org-wide metrics it cannot see and instead calls one `SECURITY DEFINER` aggregate that returns **standings only — no raw rows, no phone numbers, no contact names, no notes, no PII**.

### 2.1 RPC contract

```
public.get_org_leaderboard_stats(p_start timestamptz, p_end timestamptz)
RETURNS TABLE (
  agent_id            uuid,
  first_name          text,
  last_name           text,
  avatar_url          text,
  calls_made          bigint,
  appointments_set    bigint,
  policies_sold       bigint,
  annualized_premium  numeric,
  talk_time_seconds   bigint,
  recent_wins_7d      bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
```

- **No organization parameter, no agent-list parameter.** The caller's org comes from the **database-authoritative profiles row** (`SELECT organization_id FROM public.profiles WHERE id = auth.uid()`), not from the JWT claim and not from any argument. There is nothing a caller can vary except the time window.
- **Guards (all `RAISE EXCEPTION`):** `auth.uid()` NULL; caller org NULL; `p_start`/`p_end` NULL; `p_end <= p_start`; `p_end - p_start > interval '35 days'` (Today/Week/Month max ≈ 31 days; anything larger is not a UI-reachable window).
- **Roster:** `public.profiles WHERE organization_id = v_org AND status = 'Active'` — exact parity with the current org view (which deliberately has **no role filter**, unlike the group RPC). Every active profile returns a row, zeros included, `ORDER BY last_name, first_name, id` (the stable order the 2026-06-14 tie-break fix depends on).
- **Metrics — one half-open `[p_start, p_end)` window on every metric:**
  - `calls_made`: `COUNT(*)` of `public.calls c WHERE c.organization_id = v_org AND c.agent_id = p.id AND c.created_at >= p_start AND c.created_at < p_end AND lower(coalesce(c.direction,'')) IN ('outbound','outgoing')`.
  - `talk_time_seconds`: `SUM(GREATEST(coalesce(c.duration,0),0))` over the **same outbound rows** — `calls.duration` is the sole trusted talk-time source (invariant #8/#12); never browser timers, never `dialer_daily_stats`.
  - `appointments_set`: `COUNT(*)` of `public.appointments a WHERE a.organization_id = v_org AND COALESCE(a.created_by, a.user_id) = p.id AND a.created_at >= p_start AND a.created_at < p_end`. `created_by` is primary (booking credit); `user_id` rescues only the **verified** legacy/writer-gap rows where `created_by IS NULL` (11/12 prod rows; 0 conflicting rows). `COALESCE` yields exactly one attribution per row — double-counting is structurally impossible. **No status filter** — credit survives cancellation/reschedule.
  - `policies_sold`: `COUNT(*)` of `public.wins w WHERE w.organization_id = v_org AND w.agent_id = p.id AND w.created_at >= p_start AND w.created_at < p_end`. **Wins, never clients** (the wins-vs-clients decision is locked in invariant #17; multiple policies per client = multiple wins).
  - `annualized_premium`: `SUM(12 * CASE WHEN coalesce(w.premium_amount,0) <> 0 THEN w.premium_amount ELSE coalesce(cl.premium, 0) END)` with `LEFT JOIN public.clients cl ON cl.id = w.contact_id AND cl.organization_id = w.organization_id` (the org guard matters because DEFINER bypasses clients RLS — no cross-org premium can leak into an aggregate). Annualization happens **exactly once, server-side**; the frontend stops multiplying. Fallback is **`clients.premium` only** — the deferred-debt `clients.premium_amount` column is no longer read (task canon: never write or depend on it). Behavior delta: prod currently has **0 clients rows**, so nothing changes.
  - `recent_wins_7d`: `COUNT(*)` of org wins per agent with `w.created_at >= now() - interval '7 days'` (rolling window, no upper bound — exact parity with the extra query it replaces at [useLeaderboardData.ts:395-409](src/hooks/useLeaderboardData.ts:395)).
- **Conversion Rate** stays a client-side derivation: `policies_sold / calls_made * 100`, `0` when `calls_made = 0` (unchanged definition, [line 287](src/hooks/useLeaderboardData.ts:287)).
- All referenced objects fully qualified (`public.profiles`, `public.calls`, `public.appointments`, `public.wins`, `public.clients`, `auth.uid()`).

### 2.2 Why SECURITY DEFINER is required

Agents cannot SELECT peers' `calls`/`appointments`/`clients` rows (by design — that stays). An org-wide aggregate therefore cannot run as INVOKER for the Agent role. DEFINER is confined by: no caller-controlled org/agent inputs, profiles-derived org scoping on every subquery, counts/sums-only output over the already-org-visible roster, pinned `search_path`, and the grant lockdown below. This mirrors the repo's accepted precedents (`get_trusted_today_dialer_stats`, `get_campaign_card_stats`, `get_queue_metrics`).

### 2.3 Grants (current hardened convention — fullest form)

```sql
REVOKE ALL ON FUNCTION public.get_org_leaderboard_stats(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_org_leaderboard_stats(timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_org_leaderboard_stats(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_leaderboard_stats(timestamptz, timestamptz) TO service_role;
NOTIFY pgrst, 'reload schema';
```

(Observed live: the older leaderboard/group RPC still carries PUBLIC+anon EXECUTE — a pre-existing gap noted in §7, not widened here.)

### 2.4 Migration

**New file `supabase/migrations/<ts>_get_org_leaderboard_stats_rpc.sql`** containing the function + grants + one supporting index:

```sql
CREATE INDEX IF NOT EXISTS idx_calls_org_created_at ON public.calls (organization_id, created_at);
```

Rationale: the leaderboard polls every ~4s (`VITE_LEADERBOARD_POLL_MS` default 4000) and `calls` is the only high-write table without an `(organization_id, created_at)` path (`wins` and `appointments` already have org + time-adjacent indexes and tiny cardinality). Schema change is additive-only; no table/policy/trigger is altered. MCP `apply_migration` re-stamps the version (documented filename-drift precedent — local file realigned afterward as in Build 2b).

---

## 3. Frontend changes (surgical)

### 3.1 `src/hooks/useLeaderboardData.ts`

- **Delete** `computeStats` (the raw fan-out) and the org-view 7d-wins query. Org view roster now comes from the RPC rows themselves (same `status='Active'` filter, same ordering).
- `fetchOrgData` calls the RPC via the sanctioned narrow cast (`(supabase as any).rpc("get_org_leaderboard_stats", { p_start, p_end })` with inline eslint-disable — Build 1/3 precedent; types regen is a post-apply step). Bounds: existing `getPeriodRange(period)` (browser-local Today/Week/Month, untouched — **no agency-timezone expansion**; that architecture remains deferred and unapproved), serialized with `.toISOString()`. The end bound is "now", so `.lte` → `<` is behaviorally identical while making every metric share one half-open `[start, end)` window.
- **Row mapping** → existing `AgentStats` shape: `premiumSold = Number(annualized_premium) || 0` (**no client-side ×12** — the server already annualized), `conversionRate` derived client-side, `recentWins7d = Number(recent_wins_7d) || 0`. `rankAgents` → `applyRankAnimations` → `setAgents` exactly as today, so ranking, deterministic tie-breaks, rank motion, spotlight, odometer, podium, TV mode, and CSV all keep their inputs unchanged. (Note: `computeStats` used to leak an untyped `role` field via object spread; nothing in the leaderboard tree consumes it — re-verified by grep at implementation time.)
- **Error contract — RPC failures are never zeros.** New `loadError: string | null` + `retry()` in the hook's return. On `error !== null` (or malformed data): keep the last valid `agents` snapshot, set `loadError`, never call `setAgents` with fabricated rows, `console.error` the raw error (never rendered). On success: clear `loadError`. Initial-load failure ⇒ error state with retry (no fake empty board).
- **Stale-response guard.** `fetchGenerationRef` increments on every `fetchData` entry (org and group paths); every state commit (`setAgents`, `setWins` from the board path, `loadError`, `endFetch`) checks its captured generation first. Covers: period/metric/view switches mid-flight, overlapping 4s polls, realtime-debounce refreshes racing filter changes, and a stale group response landing after a switch back to org.
- **Unchanged:** the realtime channel + 4s poll (polling is the delivery mechanism for Agents, since peers' raw `calls` INSERT events are RLS-filtered out of their Realtime stream and `appointments` isn't in the publication at all), `fetchWins`/Recent Wins feed (`wins` is org-readable by RLS — no raw-table violation), the whole group-view path (`get_agency_group_leaderboard` + `attachPremiumSoldToAgents` + silent org fallback), win/spotlight sequencing, debounce.

### 3.2 `src/pages/Leaderboard.tsx` + new `src/components/leaderboard/LeaderboardErrorBanner.tsx`

Render the new error state: initial failure ⇒ error panel with Retry button; refresh failure over a valid snapshot ⇒ non-destructive banner ("standings may be stale — Retry") above the board, board keeps the last snapshot. Banner extracted to a new small component so `Leaderboard.tsx` (236 lines, already at the limit) doesn't grow past its size. No other page behavior changes.

### 3.3 `src/components/dashboard/widgets/LeaderboardWidget.tsx` — **decision D1 for Chris**

The Dashboard widget duplicates its own org fan-out and reads **raw `clients`** as its "wins" proxy (created-this-month clients per `assigned_agent_id`) — the same Agent-RLS zero bug *and* a metric that contradicts the locked wins-vs-clients canon. The task's frontend requirement ("no organization leaderboard reads of raw calls, appointments, or clients from the browser") pulls it in scope. **Recommended (planned): include it** — replace its clients query with the same RPC (`p_start = startOfMonth`, `p_end = now`), map `policies_sold` → its wins count, keep its own sort/UI, and on RPC error show its existing empty state rather than fake zeros. Note the visible semantic change: widget "Wins" becomes canonical wins-count instead of clients-created. Say the word and I'll drop it to a follow-up instead.

### 3.4 Explicitly untouched

`TwilioContext.tsx`, `DialerPage.tsx`, `FloatingDialer.tsx`, all call/disposition/telemetry writers, `leaderboardTypes.ts`, `leaderboardPremium.ts` (still used by group view + wins feed), `TVMode.tsx`, `RecentWinsPanel.tsx`, podium/table components, `AgentScorecardModal.tsx` (see §7), `get_agency_group_leaderboard`, every RLS policy, `supabase/functions/**`. No Zod needed (no new form/modal). Tailwind only. No mock data. No frontend secrets.

---

## 4. Tests (fail-first, both layers)

### 4.1 SQL — new `supabase/tests/leaderboard_aggregate_rpc.sql` (house harness: one `BEGIN…ROLLBACK`, synthetic fixture UUIDs, `pg_temp._sim()` JWT simulation + `SET LOCAL ROLE authenticated`, `DO $$ … RAISE EXCEPTION $$` asserts; run `psql "$DEV_BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f …` on the local stack or an approved dev branch — never production)

Fixtures: two orgs; org A has Admin + Agent1 + Agent2 (+ one `Deleted` profile); cross-attributed calls (outbound/outgoing/inbound, varied durations), appointments (`created_by`-only, `user_id`-only legacy, both-set, cancelled, rescheduled), wins (with/without premium), clients (premium fallback), boundary-timestamp rows at exact period edges; org B mirror data.

- **T0** — guard: fails loudly if the migration isn't applied (fail-first proof).
- **T1** — Agent1 and Admin (same org, same fixed `[start,end)`) receive **identical** row sets from the RPC (requirement 1).
- **T2** — Agent1 raw `SELECT` of Agent2's `calls` / `appointments` / `clients` returns **0 rows** — RLS unchanged (requirement 2).
- **T3** — org B's agents/data never appear for an org A caller; there is no parameter to request org B (structural) and org B rows never leak into org A aggregates (requirement 3).
- **T4** — `outbound` + legacy `outgoing` count; `inbound` doesn't, for both `calls_made` and `talk_time_seconds` (requirements 4, 5).
- **T5** — `talk_time_seconds` = `SUM(calls.duration)` over outbound rows exactly (requirement 5).
- **T6** — appointments count by `created_at`; still counted after `status → 'Cancelled'` and after a `start_time` reschedule; `created_by`-null legacy row attributes via `user_id`; both-set row attributes once to `created_by`; total row count equals sum of attributions (no double count) (requirement 6).
- **T7** — a `clients` insert alone moves nothing; a `wins` insert moves `policies_sold` (requirement 7).
- **T8** — win premium 100 ⇒ 1200; win premium NULL/0 + client premium 80 ⇒ 960; never ×12 twice (requirement 8, server half).
- **T9** — a row stamped exactly `p_end` is excluded; exactly `p_start` included; a midnight-boundary row lands in exactly one of two adjacent windows (requirement 9).
- **T10** — NULL bounds, reversed bounds, and a 36-day window each `RAISE`; cleared JWT claims (`_sys()`) `RAISE`s not-authenticated; `has_function_privilege('anon', …, 'EXECUTE')` is false and `authenticated` true (grant lockdown).
- **T11** — `Deleted` profile absent from results; zero-activity Active agent present with all-zero metrics.

### 4.2 Frontend — new `src/hooks/__tests__/useLeaderboardData.test.tsx` + `src/pages/__tests__/leaderboardPage.test.tsx` (Vitest/jsdom, module-mocked supabase per the dashboard-suite pattern; written and run against unmodified source first, failures recorded)

- Org view issues **one** `get_org_leaderboard_stats` call with ISO half-open bounds and **zero** `.from("calls"|"appointments"|"clients")` reads (spy on the mock).
- RPC error ⇒ `loadError` set, previous `agents` snapshot retained, **no zero standings rendered**; retry clears and refetches; initial-load error ⇒ error panel, never the valid-empty "No agents" state (requirement 10).
- Stale-guard: older in-flight response resolving after a newer one is discarded; period switch mid-flight cannot commit the old period's rows; overlapping poll + filter change commits exactly the newest (requirement 11).
- Mapping: `annualized_premium` passes through without a second ×12 (requirement 8, client half); conversion rate 0 when calls 0; `recent_wins_7d` mapped.
- Page suite: podium/table/CSV export (header row + line count from mocked standings), TV-mode entry, tie-break order (equal metric ⇒ last/first/id order), zero-activity banner, Agency Group toggle still routed to the group RPC — all intact on RPC-fed data (requirement 12).

### 4.3 Gates before handoff

`npx tsc --noEmit` · targeted leaderboard suites · full `npx vitest run` in host TZ **and** `TZ=UTC` **and** `TZ=America/Los_Angeles` (the DST-suite timezone per repo gates) · ESLint `--max-warnings 0` on touched files · `npm run build` · `git diff --check` · scope audit vs `origin/main`. After Chris-approved migration apply: `get_advisors(security)` + `get_advisors(performance)` with zero **new** findings, then the SQL suite against the applied schema.

---

## 5. Complete file list

| # | File | Action |
|---|---|---|
| 1 | `supabase/migrations/<ts>_get_org_leaderboard_stats_rpc.sql` | **NEW** — RPC + grants + `idx_calls_org_created_at` |
| 2 | `supabase/tests/leaderboard_aggregate_rpc.sql` | **NEW** — SQL regression suite (T0–T11) |
| 3 | `src/hooks/useLeaderboardData.ts` | EDIT — org view → RPC; error state; stale-guard; delete `computeStats` + org 7d query |
| 4 | `src/pages/Leaderboard.tsx` | EDIT — consume `loadError`/`retry`, render banner/panel |
| 5 | `src/components/leaderboard/LeaderboardErrorBanner.tsx` | **NEW** — small error/stale banner component |
| 6 | `src/components/dashboard/widgets/LeaderboardWidget.tsx` | EDIT (D1, recommended) — raw `clients` read → RPC |
| 7 | `src/hooks/__tests__/useLeaderboardData.test.tsx` | **NEW** — hook regression suite |
| 8 | `src/pages/__tests__/leaderboardPage.test.tsx` | **NEW** — page preservation suite |
| 9 | `AGENT_RULES.md` | EDIT — new invariant: org leaderboard metrics come **only** from the aggregate RPC; never reconstructed from browser-visible raw tables |
| 10 | `WORK_LOG.md` | EDIT — newest-first entry |
| 11 | `implementation_plan.md` | EDIT — this plan |
| 12 | `src/integrations/supabase/types.ts` | EDIT (post-apply only, optional) — regenerate via MCP so the RPC is typed; narrow cast works either way |

Nothing else. No RLS file, no Edge Function, no dependency change.

---

## 6. Sequencing, deployment, rollback

1. Chris approves plan → implement on branch, run fail-first tests + all gates locally. **STOP.**
2. Chris separately approves **production migration apply** → `apply_migration` via MCP → advisors (security + performance) → run SQL suite on a dev branch/local stack against the applied definition. **STOP.**
3. Chris approves merge/deploy → PR → merge → Vercel auto-deploy.

**Order matters:** migration before frontend deploy. If the frontend ever runs without the RPC (or it's rolled back), the org leaderboard shows the explicit error state with retry — degraded but honest, never fabricated zeros.

**Rollback:** frontend — revert the PR / redeploy previous Vercel build (old code path still works; it never depended on the new function). Backend — `DROP FUNCTION public.get_org_leaderboard_stats(timestamptz, timestamptz); DROP INDEX IF EXISTS idx_calls_org_created_at;` (safe: nothing else references either; raw-table RLS was never modified, so rollback restores exactly today's behavior).

---

## 7. Documented follow-ups (out of scope, NOT done here)

- **Agency Group metric parity** — `get_agency_group_leaderboard` counts `clients` as policies_sold, uses `appointments.user_id` only, has no direction filter, no upper bound, no premium math, and still grants EXECUTE to PUBLIC/anon. Reusing the new canonical contract cross-org changes peer-visible numbers and needs its own approval. Separately: the on-disk tie-break migration `20260614120000_leaderboard_rpc_tiebreak.sql` is **still not applied to prod** (verified via `list_migrations`) — pre-existing pending item, deliberately not bundled.
- **`AgentScorecardModal.tsx`** — per-agent raw fan-out (calls/appointments/wins, plus a 4-week trend loop); shows zeros to Agents viewing peers and sums premium without annualization. Needs its own aggregate contract.
- Reports page (`reports-queries.ts`) still filters calls on `started_at`; broad `profiles_select_org` policy (issue #339); `get_user_role()` no-profiles-fallback trap (invariant #19) — all pre-existing, untouched.

---

**Approval record:** Chris approved this plan on 2026-08-05 with two scope decisions: (1) **D1 included** — the Dashboard `LeaderboardWidget` consumes the canonical aggregate RPC so Dashboard and Leaderboard page share one set of metric definitions; (2) the pre-existing unapplied `20260614120000_leaderboard_rpc_tiebreak.sql` is **not bundled, not modified, not applied** — documented follow-up only. Additional constraints honored: no RLS loosening, no production migration apply, no deploy/merge, no `as any`/type-weakening for the RPC call, dialer/telemetry/disposition writers untouched. Implementation and local verification are recorded in the 2026-08-05 `WORK_LOG.md` entry; production apply, commit/push/PR, and deploy each await Chris's separate approval.
