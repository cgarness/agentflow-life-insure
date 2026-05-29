# Implementation Plan | P1 Build 1 — Backend Stats + Server Session Foundation

**Status:** Phase B complete — migration **APPLIED to prod** (`20260529003210`)  
**Scope:** Backend only (migration + docs). No frontend changes.  
**Hard constraints:** Do not touch `calls.duration`, Twilio files, `DialerPage.tsx`, `useDialerSession.ts`, `supabase-dialer-stats.ts`.

---

## Phase A — Read-Only Confirmation (Complete)

### Migrations applied on prod (`jncvvsvckxhqgqvkppmj`)

Relevant applied versions (via `list_migrations` MCP):

| Version | Name | Relevance |
|---------|------|-----------|
| `20260324000000` | `create_dialer_daily_stats` | Table + RLS + `increment_dialer_stats` v1 |
| `20260328014500` | `add_amd_skipped_to_stats` | `amd_skipped` column + RPC v2 |
| `20260404100000` | `dialer_rls_audit` | `dialer_sessions` RLS (not `dialer_daily_stats`) |
| `20260408010000` | `session_duration` | `session_duration_seconds` + RPC v3 (8-param) |
| `20260516230000` | `wipe_org_operational_data_ffl_chris` | Wiped org operational data incl. sessions |

Latest migration: `20260528231010` / `fix_dialer_dispositions_workflow_triggers`.

### Live `dialer_daily_stats` schema (prod)

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid | NO | PK |
| `agent_id` | uuid | NO | FK → `auth.users` |
| `stat_date` | date | NO | default `CURRENT_DATE` |
| `calls_made` | integer | NO | browser-derived today |
| `calls_connected` | integer | NO | browser-derived (≥7s gate in UI) |
| `total_talk_seconds` | integer | NO | browser-derived |
| `policies_sold` | integer | NO | browser-derived |
| `amd_skipped` | integer | NO | |
| `session_started_at` | timestamptz | YES | |
| `last_updated_at` | timestamptz | NO | |
| `session_duration_seconds` | integer | NO | browser `setInterval` |

**Missing:** `organization_id` — confirmed absent on prod.

**Constraints:** `UNIQUE (agent_id, stat_date)`, PK on `id`.

**Row count:** 4 rows — **all 4 backfillable** via `profiles.organization_id` (0 orphans).

### Live `dialer_daily_stats` RLS (prod)

| Policy | Cmd | Expression |
|--------|-----|------------|
| `agent_select_own` | SELECT | `auth.uid() = agent_id` |
| `agent_insert_own` | INSERT | `auth.uid() = agent_id` |
| `agent_update_own` | UPDATE | `auth.uid() = agent_id` |

**Material drift from audit / migration files:**

- `admin_select_all` (global Admin/Team Leader SELECT) is **not present on prod** — only in `20260324000000_create_dialer_daily_stats.sql`.
- `agent_delete_own` is **not present on prod** — `deleteTodayStats()` direct DELETE may fail RLS today.
- **Still critical:** table has no `organization_id`; when we add Admin/Team Leader visibility we must **not** recreate a global policy.
- **`increment_dialer_stats` is `SECURITY DEFINER`** with **no `auth.uid()` / org validation** — any caller can upsert stats for **any** `p_agent_id`. Grants include `authenticated`, `anon`, and `PUBLIC`. This is a cross-tenant write vector even without `admin_select_all`.

### Live `increment_dialer_stats` (prod)

Two overloads exist:

1. **7-param** (no `session_duration_seconds`) — legacy, from `add_amd_skipped_to_stats`
2. **8-param** (includes `p_session_duration_seconds`) — from `session_duration` migration

Neither overload sets or validates `organization_id`. Frontend calls the 8-param version via `supabase-dialer-stats.ts`.

**Code references:**

| File | Usage |
|------|-------|
| `src/lib/supabase-dialer-stats.ts` | Sole caller — `upsertDialerStats()` RPC + direct table read/delete |
| `src/pages/DialerPage.tsx` | Calls `upsertDialerStats` / `getTodayStats` / `deleteTodayStats` (unchanged this build) |

### Live `dialer_sessions` schema (prod)

Legacy table — **0 rows** on prod (wiped by `wipe_org_operational_data_ffl_chris`).

| Column | Present | Notes |
|--------|---------|-------|
| `id`, `agent_id`, `campaign_id`, `organization_id` | Yes | `agent_id` / `organization_id` nullable |
| `started_at`, `ended_at`, `created_at` | Yes | |
| `campaign_name`, `mode`, `calls_made`, `calls_connected`, `policies_sold`, `total_talk_time` | Yes | Legacy browser-aggregate columns; Reports still SELECT these |
| `auto_dial_enabled` | Yes | From auto-dialer migration |
| `last_heartbeat_at`, `status`, `updated_at` | **Missing** | Required for Build 1 session model |

**No session RPCs exist** on prod: `start_dialer_session`, `heartbeat_dialer_session`, `end_dialer_session`, `close_stale_dialer_sessions` — all absent.

### Live `dialer_sessions` RLS (prod)

| Policy | Issue |
|--------|-------|
| `dialer_sessions_select_own` | Agent-only, no org check |
| `dialer_sessions_insert_own` | Agent-only |
| `dialer_sessions_update_own` | Agent-only |
| `dialer_sessions_admin_select` | Uses `'Team Lead'` — **wrong role string** (`'Team Leader'` is canonical per AGENT_RULES) |

Policies use subquery on `profiles.organization_id`, **not** `public.get_org_id()`.

**Code references:**

| File | Usage |
|------|-------|
| `src/lib/reports-queries.ts` | `fetchDialerSessions()` — read-only, org-filtered in app layer |
| `src/integrations/supabase/types.ts` | Generated types (will need regen after migration — optional this build) |

No production writes to `dialer_sessions` anywhere in app code.

### Audit alignment

| Audit finding | Prod status |
|---------------|-------------|
| No `organization_id` on `dialer_daily_stats` | **Confirmed** |
| Admin global SELECT leak | Policy absent on prod, but **must not reintroduce**; RPC bypass remains |
| Browser-derived `calls_connected` / `total_talk_seconds` | **Confirmed** (unchanged this build) |
| Browser `session_duration_seconds` | **Confirmed** (unchanged this build) |
| `dialer_sessions` dead | **Confirmed** — 0 rows, no writers, no session RPCs |
| P0 `calls.duration` untouched | **Confirmed** — no changes planned |

**No material schema surprises** that block Build 1. Safe to proceed with migration design.

---

## Phase B — Proposed Migration

**File (to create after approval):**  
`supabase/migrations/20260529003210_dialer_stats_sessions_backend_foundation.sql`

### 1. Harden `dialer_daily_stats`

```sql
-- Add column + backfill
ALTER TABLE public.dialer_daily_stats
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

UPDATE public.dialer_daily_stats d
SET organization_id = p.organization_id
FROM public.profiles p
WHERE p.id = d.agent_id AND d.organization_id IS NULL;

-- 4/4 backfillable → SET NOT NULL
ALTER TABLE public.dialer_daily_stats
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dialer_daily_stats_org_agent_date
  ON public.dialer_daily_stats (organization_id, agent_id, stat_date);
```

**RLS replacement** — drop all existing policies; create tenant-scoped policies using `public.get_org_id()`:

| Policy | Role | Rule |
|--------|------|------|
| `dialer_daily_stats_agent_select` | Agent | `organization_id = get_org_id() AND agent_id = auth.uid()` |
| `dialer_daily_stats_agent_insert` | Agent | same WITH CHECK |
| `dialer_daily_stats_agent_update` | Agent | same |
| `dialer_daily_stats_agent_delete` | Agent | same (restores missing delete policy) |
| `dialer_daily_stats_manager_select` | Admin / Team Leader | `organization_id = get_org_id()` AND role check on `profiles` |

No global cross-tenant SELECT.

### 2. `increment_dialer_stats` — decision

**Decision: KEEP as legacy/display compatibility only — NOT a trusted stats source.**

Rationale:

- Frontend still calls it today (`DialerPage` hangup + session interval); removing it breaks the dialer before Build 2.
- Trusted talk time remains `calls.duration` (Twilio). Trusted session duration will be `dialer_sessions` server timestamps (Build 2 frontend).
- Must harden now to stop cross-tenant writes.

**Changes:**

- Drop 7-param overload (orphan signature).
- Replace 8-param function with hardened body:
  - `v_org := public.get_org_id()` — reject if NULL
  - Require `p_agent_id = auth.uid()` (agents only increment own row; managers use reporting queries, not this RPC)
  - INSERT/UPDATE includes `organization_id = v_org`
  - `ON CONFLICT (agent_id, stat_date)` unchanged for frontend compat
  - Comment block documenting: **not for billing, manager truth, connected/contacted counts**
- Revoke EXECUTE from `anon` and `PUBLIC` (keep `authenticated`, `service_role`)

### 3. Repair `dialer_sessions`

Table is empty — safe to alter in place. **Keep legacy aggregate columns** for Reports backward compatibility; new session lifecycle uses server timestamps only.

**Add / alter:**

```sql
ALTER TABLE public.dialer_sessions
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ended',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill status for any future rows with ended_at set (table empty today)
ALTER TABLE public.dialer_sessions
  ADD CONSTRAINT dialer_sessions_status_check
    CHECK (status IN ('active', 'ended', 'abandoned'));

ALTER TABLE public.dialer_sessions
  ALTER COLUMN agent_id SET NOT NULL,
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN started_at SET NOT NULL,
  ALTER COLUMN started_at SET DEFAULT now();
```

**Indexes:**

- `idx_dialer_sessions_org_agent_started` on `(organization_id, agent_id, started_at DESC)`
- `idx_dialer_sessions_org_status_heartbeat` on `(organization_id, status, last_heartbeat_at)`
- Keep existing `idx_dialer_sessions_agent_id`, `idx_dialer_sessions_org`

**RLS replacement** — all policies use `public.get_org_id()`:

| Policy | Access |
|--------|--------|
| Agent SELECT/INSERT/UPDATE | `organization_id = get_org_id() AND agent_id = auth.uid()` |
| Admin / Team Leader SELECT | `organization_id = get_org_id()` + role IN (`Admin`, `Team Leader`) — **correct role string** |

Session writes from frontend will go through SECURITY DEFINER RPCs in Build 2; direct INSERT policies remain for transitional compat.

**Optional:** `updated_at` trigger using existing project pattern if one exists (check before writing).

### 4. Server-timestamped session RPCs

All `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `GRANT EXECUTE TO authenticated`.

#### D. `close_stale_dialer_sessions`

```sql
close_stale_dialer_sessions(
  p_organization_id uuid,
  p_agent_id uuid DEFAULT NULL,
  p_stale_minutes integer DEFAULT 3
) RETURNS integer
```

- Marks `status = 'active'` rows where `last_heartbeat_at < now() - interval '1 minute' * p_stale_minutes` as `abandoned`
- Sets `ended_at = last_heartbeat_at`
- Scoped to `p_organization_id` and optionally `p_agent_id`
- Returns count closed

#### A. `start_dialer_session(p_campaign_id uuid DEFAULT NULL)`

1. `v_org := get_org_id()`; `v_agent := auth.uid()` — reject if either NULL
2. `PERFORM close_stale_dialer_sessions(v_org, v_agent, 3)`
3. If active session exists for `(v_org, v_agent)` → return it (idempotent)
4. Else INSERT new row: `status = 'active'`, `started_at = now()`, `last_heartbeat_at = now()`, `organization_id = v_org`, `agent_id = v_agent`, `campaign_id = p_campaign_id`
5. Returns `jsonb` or typed row: `{ id, started_at, last_heartbeat_at, status, campaign_id }`

#### B. `heartbeat_dialer_session(p_session_id uuid)`

1. Verify session belongs to `get_org_id()` and `auth.uid()` and `status = 'active'`
2. `PERFORM close_stale_dialer_sessions(v_org, v_agent, 3)` — **opportunistic cleanup**
3. `UPDATE … SET last_heartbeat_at = now(), updated_at = now()`
4. Return updated row

#### C. `end_dialer_session(p_session_id uuid)`

1. Verify org + agent ownership
2. Idempotent: if already `ended` or `abandoned`, return row unchanged
3. `UPDATE … SET status = 'ended', ended_at = now(), updated_at = now()`
4. Return final row

**Stale threshold:** 3 minutes (no existing configured value found in repo).

### 5. Schema reload

```sql
NOTIFY pgrst, 'reload schema';
```

---

## Phase C — Documentation (after migration written, before/at apply)

| File | Changes |
|------|---------|
| `AGENT_RULES.md` | Add invariants: trusted talk time = `calls.duration`; trusted session duration = `dialer_sessions` server timestamps; browser timers display-only; tenant tables require `organization_id` + `get_org_id()` RLS; stale session cleanup opportunistic via RPCs; `increment_dialer_stats` legacy-only |
| `WORK_LOG.md` | Newest-first entry with migration name, apply status, verification checklist |
| `implementation_plan.md` | Mark Build 1 complete after apply |

**Not touched this build:** `src/pages/DialerPage.tsx`, `src/hooks/useDialerSession.ts`, `src/lib/supabase-dialer-stats.ts`, Twilio files, `types.ts` (regen optional follow-up).

---

## Files / DB Objects — Inspect vs Touch

### Inspected (Phase A — read-only)

**Database (prod via MCP):**

- `public.dialer_daily_stats` — columns, constraints, indexes, RLS, row/backfill counts
- `public.dialer_sessions` — columns, indexes, RLS, row count
- `public.increment_dialer_stats` — both overload definitions, grants
- `public.get_org_id()` — definition confirmed
- Session RPCs — confirmed absent
- `supabase_migrations.schema_migrations` — via `list_migrations`

**Repo:**

- `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md`
- `supabase/migrations/20260324000000_create_dialer_daily_stats.sql`
- `supabase/migrations/20260328014500_add_amd_skipped_to_stats.sql`
- `supabase/migrations/20260404100000_dialer_rls_audit.sql`
- `supabase/migrations/20260408010000_session_duration.sql`
- `supabase/migrations/20260316120000_add_auto_dialer_support.sql`
- `src/lib/supabase-dialer-stats.ts`
- `src/hooks/useDialerSession.ts`
- `src/lib/reports-queries.ts`

### To touch (Phase B/C — after approval)

| Path | Action |
|------|--------|
| `supabase/migrations/20260529003210_dialer_stats_sessions_backend_foundation.sql` | **CREATE** |
| `AGENT_RULES.md` | **UPDATE** — new invariants |
| `WORK_LOG.md` | **APPEND** — Build 1 entry |
| `implementation_plan.md` | **UPDATE** — post-apply status |

### Explicitly NOT touched

- `src/pages/DialerPage.tsx`
- `src/hooks/useDialerSession.ts`
- `src/lib/supabase-dialer-stats.ts`
- `src/contexts/TwilioContext.tsx`
- `supabase/functions/twilio-voice-status/**`
- `supabase/functions/twilio-voice-webhook/**`
- Any `calls.duration` writers

---

## Verification Plan (pre-handoff)

1. `npx tsc --noEmit` — no TS changes expected; baseline check
2. `npm test -- --run` — if available
3. Show full migration SQL to Chris before prod apply
4. Post-apply read-only checks (MCP `execute_sql`):
   - Migration recorded in `schema_migrations`
   - `dialer_daily_stats.organization_id` NOT NULL, 4 rows backfilled
   - RLS policies use `get_org_id()`
   - `dialer_sessions` has `last_heartbeat_at`, `status`, `updated_at`
   - All 4 session RPCs exist
   - `close_stale_dialer_sessions` called from start + heartbeat
   - `NOTIFY pgrst` present in migration
   - P0 objects untouched

---

## Context Snapshot

| Item | State |
|------|-------|
| **Backend stats/session architecture** | Build 1 lays DB + RPC foundation; frontend still browser-driven until Build 2 |
| **`increment_dialer_stats` decision** | Keep hardened as **legacy/display only** — not trusted for talk time, connected, billing, or manager reporting |
| **Migration status** | **Not written** — awaiting approval |
| **Orphan backfill risk** | **None** — 0/4 orphan rows |
| **Next build** | Frontend session lifecycle in `useDialerSession.ts` — wire `start_dialer_session` / heartbeat / end RPCs |

---

## Approval Gate

**Phase B file writes:** COMPLETE (2026-05-28)

**Prod apply:** COMPLETE — `20260529003210` / `dialer_stats_sessions_backend_foundation` on `jncvvsvckxhqgqvkppmj` (13/13 verification PASS).

**Commit/push:** Pending Chris approval → done in same session after filename alignment.
