# Implementation Plan | Queue / Campaign Behavior — Build 1: Backend Lock/RPC Foundation

**Status:** PLAN — awaiting Chris approval before writing migration SQL / touching code
**Date:** 2026-05-29
**Production project:** `jncvvsvckxhqgqvkppmj` (read-only re-inspection done this session via Supabase MCP)
**Production changes this session:** NONE
**Scope:** Backend database/RPC foundation only. No frontend lifecycle rewrite. No Twilio. No P0/P1 stat changes. No disposition behavior changes. No Sold/Convert gating changes.

---

## 0. Build 1 goal

Stabilize the backend foundation so Team/Open queue locking is correct and safe to build a frontend on (Build 2+). Today: 4 Personal campaigns, **0 Team/Open**, **0 active locks**, 15 `campaign_leads` rows — so the broken Team/Open claim path is unexercised in prod and safe to repair.

---

## 1. Phase A — Frontend claim path (CRITICAL, resolved)

Grep + trace of `src/`:

| Code path | RPC called | Live status |
|-----------|-----------|-------------|
| `DialerPage.loadLockModeLead` (line 911) → `useLeadLock.getNextLead` (`useLeadLock.ts:101`) | **`get_next_queue_lead`** | **THE LIVE PATH** |
| `dialer-queue.ts:fetchNextQueuedLead` → `fetch_and_lock_next_lead` | `fetch_and_lock_next_lead` | **DEAD CODE — `fetchNextQueuedLead` is imported nowhere.** `DialerPage` imports only `releaseAllAgentLocks` / `releaseAllAgentLocksBeacon` from `dialer-queue.ts` (line 107). |

**Return contract:** `get_next_queue_lead` returns `SETOF campaign_leads`. The frontend uses only `lock.id` (campaign_lead id) then re-queries `campaign_leads, lead:leads(*)` for full data, and passes `lock.id` to `startHeartbeat`. ⇒ Keeping `RETURNS SETOF public.campaign_leads` requires **no `types.ts` regen**.

### Canonical decision

- **Canonical claim function = `public.get_next_queue_lead`** — it is the function the live frontend actually calls; the lock TTL there is already `5 minutes`.
- **`fetch_and_lock_next_lead` → converted to a thin deprecated wrapper** that calls `get_next_queue_lead` (identical signature `(uuid, jsonb)` and `SETOF campaign_leads` return). This removes the divergent 90s-TTL / `created_at ASC`-only implementation while satisfying "do not delete either claim RPC without explicit approval."
- After Build 1 there is **one** real implementation; the second name is a documented legacy alias.

---

## 2. Phase A — Live schema re-confirmation (16-point checklist)

| # | Question | Live answer |
|---|----------|-------------|
| 1 | `dialer_lead_locks` columns | ✅ `id, campaign_lead_id, campaign_id, locked_by, organization_id, locked_at, expires_at` — all NOT NULL (id default). Canonical. No `lead_id`/`agent_id`. |
| 2 | Which claim RPC frontend calls | ✅ `get_next_queue_lead` (canonical). |
| 3 | `get_next_queue_lead` references wrong lock columns | ✅ **YES** — INSERTs `(lead_id, agent_id, …)` and reads `dll.lead_id`; both nonexistent. |
| 4 | `fetch_and_lock_next_lead` correct + 90s TTL | ✅ Structurally correct vs prod schema, TTL = **90 seconds** — but **unused (dead code)**. |
| 5 | `renew_lead_lock` missing | ✅ **MISSING.** Frontend heartbeat call is a server no-op today. |
| 6 | `release_lead_lock` canonical + safe | ✅ `release_lead_lock(p_campaign_lead_id)` deletes WHERE `campaign_lead_id = p_campaign_lead_id AND locked_by = auth.uid()`. Correct. |
| 7 | `release_all_agent_locks` auth-scoped | ✅ `release_all_agent_locks(p_campaign_id)` deletes WHERE `campaign_id = p_campaign_id AND locked_by = auth.uid()`. No cross-agent release. |
| 8 | `campaigns.retry_interval_hours` exists | ✅ **EXISTS** — `integer DEFAULT 24`. |
| 9 | `campaigns.retry_interval_minutes` exists | ❌ **MISSING.** (See Decision 1 — both fields present is the conflict the spec told me to stop on.) |
| 10 | `calling_hours_start` / `_end` exist | ✅ **EXIST** — `time` defaults `09:00:00` / `21:00:00`. (Spec wanted 08:00 default — see Decision 3.) |
| 11 | `campaigns.queue_filters` exists | ❌ **MISSING.** Frontend `loadLockModeLead` already selects it → currently a silently-swallowed error, filters fall back to `{}`. |
| 12 | `campaign_leads.callback_due_at` / `callback_agent_id` | `callback_due_at` ✅, `scheduled_callback_at` ✅, `retry_eligible_at` ✅; **`callback_agent_id` ❌**, `callback_note` ❌. |
| 13 | Appointment linkage for queue priority | ❌ **No clean link.** `appointments` has `contact_id` (polymorphic), `start_time`, `end_time`, `status`, `type` — **no `campaign_id`/`lead_id`/`campaign_lead_id`.** ⇒ Appointment priority **deferred to Build 3**. |
| 14 | Lead timezone / local-calling helper columns | ❌ **None.** `leads` has `state`, `best_time_to_call` (free text) — **no timezone column.** ⇒ Lead-local calling-window enforcement **deferred to Build 3**. |
| 15 | `dialer_lead_locks` unique on `campaign_lead_id` | ✅ `dialer_lead_locks_campaign_lead_id_key UNIQUE (campaign_lead_id)`. ⇒ `ON CONFLICT (campaign_lead_id)` valid. |
| 16 | RLS uses `public.get_org_id()` | ✅ `campaigns`, `campaign_leads`, `dialer_lead_locks` all key off `get_org_id()`; lock insert `with_check (locked_by = auth.uid() AND organization_id = get_org_id())`. |

**Other confirmed facts**
- `campaign_leads` status CHECK: `Queued, Locked, Claimed, Called, Skipped, Completed, Failed, Removed, DNC`. (No `Sold`/`Converted` — conversion lands as `Completed`/`Removed`, already excluded.)
- `campaign_leads` has **no `assigned_agent_id`** — confirmed. Team must NOT filter per-lead by agent (shared pool).
- Indexes present that support the waterfall: `idx_campaign_leads_callback_due_at`, `idx_campaign_leads_retry_eligible_at`, `idx_campaign_leads_scheduled_callback`, `idx_campaign_leads_status`, `idx_campaign_leads_campaign_id`, `idx_campaign_leads_org`; `dialer_lead_locks` `idx_dialer_lead_locks_campaign_expires (campaign_id, expires_at)` + unique `(campaign_lead_id)`.
- Triggers on `campaign_leads`: `trg_sync_campaign_leads_called`, `trg_sync_campaign_total_leads` only (no contacted/converted — out of scope).
- `get_org_id()`: JWT claim → `profiles` fallback. Safe to use in `SECURITY DEFINER`.

---

## 3. Open decisions for Chris (resolve before SQL)

**Decision 1 — `retry_interval_hours` vs `retry_interval_minutes` (spec told me to stop here).**
`retry_interval_hours integer DEFAULT 24` already exists and is read by `DialerPage` (`retryIntervalHours`). The spec wants minute precision and says "stop and propose."
- **Recommendation:** ADD `retry_interval_minutes integer NOT NULL DEFAULT 1440`; **backfill** `retry_interval_minutes = COALESCE(retry_interval_hours,24)*60` for existing rows; treat **minutes as canonical** going forward. **Keep `retry_interval_hours`** (deprecated, not dropped — frontend still reads it) and migrate the frontend to minutes in Build 2. No dual writes from the backend.

**Decision 2 — callback columns.**
Two due-time columns already exist (`callback_due_at`, `scheduled_callback_at`) but **no owning-agent column**, which the product rule "callbacks return only to the agent who set them" (#17) requires.
- **Recommendation:** ADD `callback_agent_id uuid` (FK `auth.users`) and `callback_note text`. For Build 1 the canonical RPC prioritizes `COALESCE(callback_due_at, scheduled_callback_at)` scoped to `callback_agent_id = auth.uid()` **only when `callback_agent_id` is set** (so no behavior change for existing rows that have neither owner). Pick **`callback_due_at`** as the canonical write column in Build 2; `scheduled_callback_at` stays a read fallback.

**Decision 3 — calling-hours default 09:00 vs spec's 08:00.**
Columns exist with `09:00` default. Spec #19 says default window is 08:00–21:00.
- **Recommendation:** Leave existing rows untouched; optionally `ALTER COLUMN calling_hours_start SET DEFAULT '08:00'` for future campaigns. **Lowest-risk = do nothing in Build 1** (admins edit later, and the RPC does not enforce the window in Build 1 anyway — see §4.1). Flagging only; your call.

---

## 4. Phase B — Migration plan (after approval)

**Proposed migration filename:** `supabase/migrations/20260529170000_queue_lock_rpc_foundation.sql`
> Per the Build 3A precedent, the recorded `schema_migrations` version is the apply-time timestamp; the local filename will be aligned to the recorded version after apply.

Ends with `NOTIFY pgrst, 'reload schema';`

### 4.1 Rebuild canonical `public.get_next_queue_lead`

**Signature (unchanged):** `get_next_queue_lead(p_campaign_id uuid, p_filters jsonb DEFAULT '{}'::jsonb) RETURNS SETOF public.campaign_leads`
`SECURITY DEFINER`, `SET search_path = public, pg_temp`, org via `public.get_org_id()`, user via `auth.uid()`.

Body logic:
1. Delete expired locks for the campaign (`expires_at <= now()`).
2. Load campaign (`type, assigned_agent_ids, organization_id, max_attempts`) scoped to `get_org_id()`; empty if not found.
3. **Eligibility gate:** `TEAM` → require `auth.uid()::text = ANY(assigned_agent_ids)` else return empty. `OPEN`/`OPEN POOL` → org-scoped (any org agent). (`PERSONAL` does not use this RPC; still safe.)
4. Candidate filter on `campaign_leads cl JOIN leads l ON l.id = cl.lead_id`:
   - `cl.organization_id = get_org_id()`, `cl.campaign_id = p_campaign_id`
   - status **NOT IN** (`DNC, Completed, Removed, Failed`)
   - max attempts: `v_campaign.max_attempts IS NULL OR COALESCE(cl.call_attempts,0) < v_campaign.max_attempts`
   - retry eligibility: `cl.retry_eligible_at IS NULL OR cl.retry_eligible_at <= now()`
   - **exclude active locks held by others:** `NOT EXISTS (SELECT 1 FROM dialer_lead_locks dll WHERE dll.campaign_lead_id = cl.id AND dll.expires_at > now() AND dll.locked_by <> auth.uid())`
   - **exclude current-user suppressions:** `NOT EXISTS (SELECT 1 FROM campaign_lead_agent_suppressions s WHERE s.campaign_lead_id = cl.id AND s.agent_id = auth.uid() AND s.suppressed_until > now())`
   - filters from `p_filters` (tolerant): `state`, `lead_source`, `max_attempts`/attempt count, `status`. **No score filter** (per #20 — `min_score`/`max_score` keys ignored if sent).
5. **Ordering (priority):**
   - `1` Appointments — **DEFERRED** (no `appointments`↔`campaign_lead` link; documented Build 3).
   - `2` Callbacks: rows where `COALESCE(callback_due_at, scheduled_callback_at) IS NOT NULL AND callback_agent_id = auth.uid() AND COALESCE(callback_due_at, scheduled_callback_at) <= now() + interval '5 minutes'`, ordered by due time.
   - `3` New leads (`COALESCE(call_attempts,0) = 0`).
   - `4` Retries (`call_attempts > 0`, retry-eligible), ordered by `last_called_at`/`created_at`.
   - Implemented via a single `ORDER BY <priority bucket>, <due/created>` with `LIMIT 1 FOR UPDATE OF cl SKIP LOCKED`.
   - **Calling window: NOT enforced in Build 1** (no lead timezone) — documented Build 3.
6. Insert lock: `INSERT INTO dialer_lead_locks (campaign_lead_id, locked_by, campaign_id, organization_id, expires_at) VALUES (v_id, auth.uid(), p_campaign_id, get_org_id(), now() + interval '5 minutes') ON CONFLICT (campaign_lead_id) DO NOTHING;`
7. Return the locked `campaign_leads` row.

### 4.2 Add `public.renew_lead_lock`

```
renew_lead_lock(p_campaign_lead_id uuid) RETURNS boolean
SECURITY DEFINER, SET search_path = public, pg_temp
-- UPDATE dialer_lead_locks SET expires_at = now() + interval '5 minutes'
--   WHERE campaign_lead_id = p_campaign_lead_id
--     AND locked_by = auth.uid() AND organization_id = public.get_org_id();
-- RETURN (ROW_COUNT > 0);   false = lock lost/expired/not owned
-- GRANT EXECUTE TO authenticated; REVOKE FROM PUBLIC/anon.
```
Returns `boolean` to match the frontend's `data === false` "lock lost" branch.
**Canonical arg = `p_campaign_lead_id`.** The Build-1 frontend still calls `renew_lead_lock({ p_lead_id })`, so heartbeat stays a no-op until the **Build 2** arg rename. Acceptable: 0 Team/Open campaigns in prod. No overloads added.

### 4.3 `public.release_lead_lock` — UNCHANGED
Already canonical (`p_campaign_lead_id`, `locked_by = auth.uid()`). **Frontend passes `p_lead_id` (wrong arg NAME, correct VALUE) — fix is Build 2.** No compatibility overload added in Build 1.

### 4.4 `public.release_all_agent_locks` — UNCHANGED
Already safe (`locked_by = auth.uid()`, no cross-agent release). Used by End Session + beforeunload beacon.

### 4.5 `public.fetch_and_lock_next_lead` — convert to deprecated wrapper
```
fetch_and_lock_next_lead(p_campaign_id uuid, p_filters jsonb DEFAULT '{}') RETURNS SETOF campaign_leads
-- RETURN QUERY SELECT * FROM public.get_next_queue_lead(p_campaign_id, p_filters);
```
Eliminates the divergent 90s/`created_at`-only logic. (Pending your OK per "don't delete/alter either claim RPC without approval.")

### 4.6 Columns

```
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS queue_filters jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Decision 1:
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS retry_interval_minutes integer NOT NULL DEFAULT 1440;
UPDATE public.campaigns SET retry_interval_minutes = COALESCE(retry_interval_hours,24)*60
  WHERE retry_interval_minutes = 1440;   -- backfill existing
-- Decision 2:
ALTER TABLE public.campaign_leads
  ADD COLUMN IF NOT EXISTS callback_agent_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS callback_note text;
```
(`calling_hours_*` and `retry_interval_hours` left as-is — already present.)

### 4.7 New table `public.campaign_lead_agent_suppressions` (per-agent skip suppression)

```
id uuid PK default gen_random_uuid()
organization_id uuid NOT NULL
campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE
campaign_lead_id uuid NOT NULL REFERENCES campaign_leads(id) ON DELETE CASCADE
agent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
suppressed_until timestamptz NOT NULL
reason text NOT NULL DEFAULT 'skip'
created_at timestamptz NOT NULL DEFAULT now()
updated_at timestamptz NOT NULL DEFAULT now()
UNIQUE (organization_id, campaign_lead_id, agent_id, reason)
```
- **RLS ENABLED.** Policies key off `public.get_org_id()`:
  - SELECT: `organization_id = get_org_id() AND (agent_id = auth.uid() OR get_user_role() IN ('Admin','Team Leader','Team Lead'))`
  - INSERT/UPDATE/DELETE: `agent_id = auth.uid() AND organization_id = get_org_id()` (own rows only).
- Indexes: `(organization_id)`, `(campaign_id)`, `(campaign_lead_id)`, `(agent_id)`, `(suppressed_until)`.
- Build 1 only **reads** this table (claim RPC exclusion). Frontend **write path = Build 2.**

---

## 5. Phase C — Security / RLS (applies to all new objects)
- New functions: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `get_org_id()` + `auth.uid()`, no service-role assumptions, no cross-org access, `GRANT EXECUTE TO authenticated`, `REVOKE FROM PUBLIC` where appropriate.
- New table: RLS enabled, policies via `get_org_id()`, indexes listed in §4.7.

---

## 6. Exact objects to LEAVE UNCHANGED
`calls.duration`, `twilio-voice-status`, `twilio-voice-webhook`, `answerOnBridge`, `TwilioContext` guards, all P0/P1 stats logic, disposition save behavior, Sold/Convert gating, `claim_lead`, `get_enterprise_queue_leads`, `release_lead_lock`, `release_all_agent_locks`, `sync_campaign_leads_called` / `sync_campaign_total_leads` triggers, `calling_hours_*`, `retry_interval_hours`, all Edge Functions (no deploys).

## 7. Files to touch (Build 1)
- `supabase/migrations/20260529170000_queue_lock_rpc_foundation.sql` (NEW — after approval)
- `AGENT_RULES.md` (queue invariants — §9)
- `WORK_LOG.md` (newest-first entry)
- `implementation_plan.md` (this file)
- **No `.ts`/`.tsx` changes in Build 1.** `types.ts` regen **not required** (signatures/return shapes unchanged; new objects optional). `renew_lead_lock`/`queue_filters`/suppressions types land when the frontend wires them in Build 2.

## 8. Deferred to Builds 2–5
- **Build 2:** frontend arg fixes (`release_lead_lock`/`renew_lead_lock` → `p_campaign_lead_id`), heartbeat wiring, Save Only lock-retention / Save & Next release, skip→suppression write path, hard-claim ≥30s on disposition path, `retry_interval_minutes` frontend cutover, remove/ignore dead `fetchNextQueuedLead`.
- **Build 3:** appointment↔campaign_lead linkage + appointment priority; lead timezone source + calling-window enforcement; full callback/appointment UI; 5-minute-early window + manual-dial warning.
- **Build 4:** campaign card `leads_contacted`/`leads_converted`.
- **Build 5:** two-agent contention QA, manager stuck-lock release UI, polish.

## 9. AGENT_RULES additions planned (Phase D)
- Production lock schema is canonical: `campaign_lead_id` / `locked_by`.
- Team/Open queue claiming goes through **one** canonical RPC (`get_next_queue_lead`); `fetch_and_lock_next_lead` is a deprecated wrapper.
- Locks use **5-minute TTL**, 30-second heartbeat (`renew_lead_lock(p_campaign_lead_id)`).
- Save Only keeps lock; Save & Next releases; Skip = per-agent suppression (not global removal).
- Personal remains a no-lock private queue.
- Only actual calls increment attempts.

## 10. Phase E — Pre-apply verification (before prod)
1. Show full SQL diff. 2. `npx tsc --noEmit`. 3. `npm test -- --run`. 4. Static checks: no Twilio files, no `calls.duration` writes, no frontend queue behavior change, no disposition/Sold/Convert/Reports change. 5. **Stop for Chris approval before applying.**

## 11. Phase F — Post-apply verification (after approval) — read-only
Migration in `schema_migrations`; canonical RPC uses `FOR UPDATE SKIP LOCKED` + `campaign_lead_id`/`locked_by` (not `lead_id`/`agent_id`); no `campaign_leads.assigned_agent_id` reference; `fetch_and_lock_next_lead` is the wrapper; `renew_lead_lock` exists + updates only own/org lock; `release_lead_lock`/`release_all_agent_locks` still safe; expired-lock cleanup works; `retry_interval_minutes`/`queue_filters`/`callback_agent_id` present; suppressions table + RLS enabled; 0 Postgres errors; P0 duration/Twilio untouched.

---

## 12. Context snapshot
| Item | Detail |
|------|--------|
| **Canonical claim fn** | `public.get_next_queue_lead` (live frontend path); `fetch_and_lock_next_lead` → deprecated wrapper |
| **DB objects to change** | rebuild `get_next_queue_lead`; add `renew_lead_lock`; wrap `fetch_and_lock_next_lead`; add cols `campaigns.queue_filters`, `campaigns.retry_interval_minutes`, `campaign_leads.callback_agent_id`, `campaign_leads.callback_note`; new table `campaign_lead_agent_suppressions` + RLS |
| **Left unchanged** | `release_lead_lock`, `release_all_agent_locks`, `claim_lead`, `get_enterprise_queue_leads`, `calling_hours_*`, `retry_interval_hours`, triggers, all Twilio/P0/P1/disposition/Sold paths |
| **Deferred (no clean source)** | appointment priority (no link), lead-local calling window (no lead tz) → Build 3 |
| **Open decisions** | (1) retry minutes vs hours, (2) callback columns, (3) calling-hours default 08:00 vs 09:00 |
| **Remaining for Build 2** | frontend arg/heartbeat/skip-suppression/hard-claim wiring |
| **Production changes** | NONE this session |

**Next step for Chris:** approve §3 decisions + §4 migration plan → then I write the migration SQL (no apply). Separate approval gates for (a) applying to prod and (b) commit/push.
