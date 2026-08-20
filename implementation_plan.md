# Implementation Plan — Dialer Campaign Selection: balanced expandable table + active-agent presence

**Task branch:** `claude/dialer-campaign-table-redesign-djapzb` (from `620ab9f` = PR #361 squash-merge; local `origin/main` ref is stale at `cbc4c49` — the branch base already carries the merged notifications work)
**Date:** 2026-08-20 · **Status:** **AWAITING CHRIS'S APPROVAL — nothing implemented, nothing committed.** All production access in this audit was read-only. This file supersedes the shipped Notifications Build 1 plan.
**Reading:** AGENT_RULES.md (v5.0.0, full) · VISION.md (full) · WORK_LOG.md newest entries (2026-08-19 notifications corrective passes, 2026-08-18 disposition colors, 2026-08-17 conversation redesign, 2026-08-12 policy dates) plus the full dialer/campaign-selection history back to 2026-05-16. **No overlapping campaign-selection work is in flight.** Conflict scan results in §1.9.
**Scope:** Replace the Dialer campaign-selection cards with the approved Variation 1 balanced expandable table; leadership (Variation 3) visibility as a role-aware mode of the SAME component; one new read-only presence RPC. Strictly the selection screen + its presence data. The active dialing screen, campaign management pages, telephony, queue behavior, and the campaign settings modal are untouched.

---

## 1. Current-state findings (verified: repo @ `620ab9f` + live production read-only, 2026-08-20)

### 1.1 The selection screen today

- `src/components/dialer/CampaignSelection.tsx` — **273 lines** (over the 200-line standard; flagged-but-unrefactored since 2026-06-07). Small fixed-width cards (`w-44`), oldest-first by `created_at`, showing: name, type pill (hand-rolled, TEAM=blue / PERSONAL=purple / *POOL*=emerald), total contacts (sum of state-chip counts), up to 6 state chips, Created date, Last dialed (absolute date or "Never"), Start button, Settings gear.
- All data arrives via props from `DialerPage.tsx` (~4,990 lines, documented size exception — no new inline features allowed there):
  - `campaigns` — from `useDialerSession.refetchCampaigns`: org-scoped Active campaigns, filtered through **`filterCampaignsForDialing`** (dialer scope, never management scope), localStorage-cached per org+user with **re-filter on read**.
  - `campaignStateStats` — React Query `["campaignStateStats", org, visibleCampaignIdsKey]`, direct `campaign_leads` select, per-campaign state buckets, seeded `[]` per visible id, localStorage `initialData` cache (`af:dialer:campaignStats:v1:*`).
  - `campaignLastDialed` — React Query `["campaignLastDialed", org]`, RPC `get_campaign_last_dialed()` (narrow `(supabase as any).rpc` cast), map campaign_id → ISO; **absent key = "Never"**.
  - `campaignEditPermissions` — UX mirror of `can_edit_campaign_settings` via `canEditCampaignSettings(...)`; **fails open** when the policy map hasn't loaded (`!== false` gating on the gear); server trigger/RPC is the enforcement.
  - `onPrefetchCampaign` = `prefetchCampaignHeaderStats` — warms the header-stats localStorage cache on card **hover/focus** and Start **pointerdown**, once per campaign+local-day.
  - `onSelectCampaign` = `handleSelectCampaign` — **awaits `startServerSession(campaignId)` and only switches the campaign on success** (server refuses unauthorized/mismatched sessions with 42501). Selecting a campaign is the ONLY session-starting action; no call is dispatched.
- **Refresh ownership today:** `useCampaignSelectionLive(org, isSelectionScreen, refetchCampaigns)` — 15 s `setInterval` → invalidate `["campaignStateStats", org]` (prefix match) + silent `refetchCampaigns`; Supabase Realtime on `campaign_leads`/`campaigns` (org-filtered); window-focus listener. The two selection queries additionally set `refetchOnWindowFocus` while on the screen. There is exactly one interval.
- **Render-stability budget (must stay green):** `src/pages/__tests__/dialerRenderStability.test.tsx` mounts the real DialerPage on the selection screen and pins: ≤ 30 Profiler commits/400 ms, ≤ 4 `campaigns` builder creations, ≤ 4 `dialer_daily_stats` builders, no update-depth errors. Root-cause class it guards (2026-08-10 render-loop fix): **never destructure `useQuery` with an inline `= []` default** — use frozen module constants.
- **No test anywhere renders `CampaignSelection`** — the redesign is otherwise unpinned; the fail-first suite below creates the pins.

### 1.2 `dialer_sessions` (live production, reconfirmed 2026-08-20)

- Columns: `id, agent_id (NOT NULL → auth.users), campaign_id (nullable → campaigns ON DELETE SET NULL), campaign_name, mode, started_at, ended_at, calls_made, calls_connected, policies_sold, total_talk_time, created_at, auto_dial_enabled, organization_id (NOT NULL), last_heartbeat_at (NOT NULL), status ('active'|'ended'|'abandoned', DEFAULT 'ended'), updated_at`.
- Indexes: pkey; `(agent_id)`; `(organization_id)`; `(organization_id, agent_id, started_at DESC)`; **`idx_dialer_sessions_org_status_heartbeat (organization_id, status, last_heartbeat_at)`**; **UNIQUE partial `(organization_id, agent_id) WHERE status='active'`** — one active session per agent per org.
- RLS (all `TO authenticated`): agent own-row INSERT/SELECT/UPDATE (`org = get_org_id() AND agent_id = auth.uid()`); `dialer_sessions_manager_select` — org-wide SELECT for profiles-read role IN (**'Admin','Team Leader'** — exact strings, no legacy `'Team Lead'`). **A plain Agent can only see their own rows → any cross-agent aggregate requires SECURITY DEFINER.** No DELETE policy.
- Table grants: `GRANT ALL … TO anon, authenticated, service_role` (RLS is the effective gate; pre-existing ACL breadth — documented, NOT repaired here).
- **NOT in the `supabase_realtime` publication** (publication holds exactly: call_scripts, calls, campaign_leads, campaigns, dnc_list, notifications, phone_numbers, phone_settings, wins).

### 1.3 Session lifecycle + heartbeat/staleness (live definitions pulled)

- Frontend heartbeat: `useDialerSession` `HEARTBEAT_INTERVAL_MS = 45_000`; explicit end + keepalive best-effort end on tab close.
- `private.close_stale_dialer_sessions(org, agent, p_stale_minutes DEFAULT 3)` — marks `status='abandoned', ended_at=last_heartbeat_at` where `last_heartbeat_at < now() - 3 minutes`. **Scoped to the calling agent only and invoked only from `start_dialer_session`/`heartbeat_dialer_session`(both pass 3). There is no global sweeper and no cron** → rows can sit `status='active'` with stale heartbeats indefinitely. Presence must therefore filter on `last_heartbeat_at` itself; the exact fresh-complement of the cleanup predicate is **`last_heartbeat_at >= now() - interval '3 minutes'`**.
- `start_dialer_session(p_campaign_id)` (live = migration `20260807165620…`, applied to prod as version `20260811201401`): `SECURITY DEFINER`, `search_path = pg_catalog, pg_temp`, requires `get_org_id()` + `auth.uid()`, **gates campaign-scoped sessions on `public.can_dial_campaign` (42501 fail-closed), re-authorizes resumed sessions, refuses campaign mismatch**, never rewrites session telemetry. ACL: authenticated + service_role only.
- `heartbeat_dialer_session` / `end_dialer_session`: own-row, SECURITY DEFINER, older `'public','private','pg_temp'` search_path; **residual PUBLIC + anon EXECUTE grants** — a known pre-existing ACL finding this task deliberately does NOT repair (mandate).
- `public.can_dial_campaign(uuid)`: STABLE SECURITY DEFINER `pg_catalog, pg_temp`; actor via `private.campaign_actor()` (auth.uid + get_org_id + **profiles-read role/status, must be 'Active', org must match — never the JWT role claim**); Open Pool/Open → true; **Personal → owner only, no admin/view-all branch**; Team → uid ∈ `assigned_agent_ids`. Fail-closed on every error.

### 1.4 Production presence evidence (reconfirmed live, 2026-08-20 — state HAS changed since the earlier capture)

- `dialer_sessions`: **133 rows** (was 132). Status values: active/ended/abandoned. **79 rows have `campaign_id` NULL.**
- **3 rows `status='active'`** (was 2): **1 genuinely fresh** (heartbeat age ~0 min, campaign `ad3987c5-…`, started 2026-08-20 20:00 UTC — an agent is dialing right now) and **2 stale** (heartbeat ages ≈ 77 days and ≈ 14 days, **both `campaign_id` NULL**). Counting every `status='active'` row would still be wrong the moment a stale campaign-scoped session exists; the 3-minute filter is mandatory and cheap.
- **EXPLAIN (ANALYZE, BUFFERS) on the presence aggregate** (`org = 'a0000000-…0001'`, status='active', heartbeat ≥ now()-3min, campaign_id NOT NULL, GROUP BY campaign_id): **Index Scan on `idx_dialer_sessions_org_status_heartbeat`, 7 shared-hit buffers, 0.198 ms execution.** → **The existing index is sufficient. No new index is proposed.**

### 1.5 No presence RPC exists; nothing to reuse

- Exhaustive search (live catalog + all migrations): **no function returns per-campaign session presence.** `get_queue_metrics(p_campaign_id).active_agents` is `COUNT(DISTINCT locked_by)` over unexpired `dialer_lead_locks` — lock-holders, not heartbeat presence, single-campaign (N+1 across the grid), no identities. Not a substitute; untouched.
- `get_campaign_last_dialed()`: no-arg, org-scoped `MAX(calls.created_at)` per campaign, SECURITY DEFINER `'public','pg_temp'`, anon EXECUTE granted (harmless: null org → 0 rows). **Kept as the authoritative Last-Dialed source, contract unchanged.** Known limitation (documented, not fixed here): it is org-scoped only, without per-campaign dial-scope gating.
- `profiles.availability_status` exists but is NOT presence and is explicitly forbidden as a source. No "On Call"/"Paused"/"Wrap-Up" server-authoritative per-status source exists → **no sub-status labels will be shipped.**

### 1.6 Campaign + profile shapes (live)

- `campaigns.type` CHECK: `'Open Pool' | 'Personal' | 'Team'` (predicates everywhere tolerate legacy `'OPEN'` via `upper(btrim(...))`). **`assigned_agent_ids` is `jsonb`** (array of uuid strings; unwrap with `jsonb_array_elements_text(COALESCE(…,'[]'))` — never `= ANY(...)`). `max_attempts` NULL = Unlimited (`setIsUnlimited(max_attempts === null)` in DialerPage). `ring_timeout_seconds` NULL = org default (`phone_settings.ring_timeout` fallback). `retry_interval_minutes` NOT NULL DEFAULT 1440 is canonical (`retry_interval_hours` deprecated compat; frontend `getRetryIntervalMinutes()` mirrors). `calling_hours_start/end` default 08:00/21:00. `description` exists (default '').
- `profiles`: `role` CHECK `('Agent','Team Leader','Admin','Super Admin')`; `first_name`/`last_name` NOT NULL default `''`; `avatar_url` exists (default `''`); `status` (no CHECK; `campaign_actor` requires `'Active'`).
- **Profiles visibility (matters for the Assigned column):** live SELECT policies are `profiles_select_hierarchical` (role-scoped) **OR `profiles_select_org` — `organization_id = get_user_org_id()` applied to ALL roles**. So teammate names/avatars are already org-readable to every org member under existing RLS (this is how the settings-modal user picker works for non-admins today). The redesign does not widen this; the Assigned column simply gates the UI + fetch to leadership.

### 1.7 Migration history state

- Prod history (MCP `list_migrations`): latest `20260819163413` (notifications — the repo's `20260819000000` file, **authored + locally proven, NOT applied**; its Edge deploys are also gated). The three `202608071656*` files are applied as `20260811200920/201250/201401` (apply-time re-stamp; S1 history reconciliation deliberately BLOCKED). **File-on-disk ≠ applied is the current normal; nothing here conflicts.**
- Repo-standard for a NEW privileged function (machine-enforced by the T31-style test in `supabase/tests/import_campaign_attachment.sql`): `SECURITY DEFINER` + exactly **`SET search_path = pg_catalog, pg_temp`** (lowercase, `=`, one space), every object schema-qualified, `REVOKE ALL … FROM PUBLIC, anon` + `GRANT EXECUTE … TO authenticated, service_role`, actor via `private.campaign_actor()` (never `get_user_role()`).

### 1.8 Supabase docs check (current guidance, fetched 2026-08-20)

- SECURITY DEFINER requires a pinned `search_path` ("If you ever use `security definer`, you *must* set the `search_path`"); a locked-down non-empty path (`pg_catalog`) with fully-qualified objects satisfies the invariant. Functions in exposed schemas get EXECUTE for PUBLIC/anon/authenticated **by default** (platform default moving toward revoke-by-default); revoking requires BOTH `FROM PUBLIC` and `FROM anon`. "For functions, RLS does not apply" — EXECUTE grants + in-function checks are the only control. All reflected in §4.
- Realtime `postgres_changes` delivery is RLS-filtered per subscriber → adding `dialer_sessions` to the publication could never give an Agent peers' events anyway. Moot: **no Realtime changes are proposed** (mandate).

### 1.9 Conflict scan

- PR #361 (notifications) is merged and is this branch's base; its migration/Edge deploys remain gated — **this task touches neither `supabase/functions/**` nor that migration.**
- The import-campaign-attachment work (PR #352 era) has landed — its `useDialerSession` re-filter-on-read cache and `activeSessionCampaignRef` are present in HEAD. No pending branch overlaps `CampaignSelection.tsx`.
- Live regression classes to respect: dialer render-loop (frozen empty constants; stability suite), redial-loop advancement canon (untouched paths), the 273-line component debt (resolved by this split).
- App-project `tsc -p tsconfig.app.json` = **73 errors** is the accepted baseline (verified multiset-vs-clean-worktree per house convention); root `npx tsc --noEmit` exit 0.

---

## 2. Approved product design (restated as build contract)

Variation 1 balanced expandable table for everyone; Variation 3 leadership additions as a **role-aware mode of the same component** (one screen, no fork).

**Columns — Agent:** Campaign · Contacts · Active Agents · Last Dialed · Action.
**Columns — Team Leader / Admin / Super Admin:** Campaign · Contacts · Active Agents · **Assigned** · Last Dialed · Action.

- **Header:** "Select a Campaign" + "Choose an active campaign to start dialing." + compact status-dot total ("6 active agents") **derived from the same presence response** (no second query, no double counting — safe because the UNIQUE partial index guarantees one active session per agent org-wide, so summing per-campaign distinct counts cannot double-count an agent).
- **Campaign cell:** name, exact type badge (Personal / Team / Open Pool), optional one-line truncated existing description.
- **Contacts cell:** the truthful existing total (sum of the current state-bucket counts — byte-same source and semantics as today, including its "Loading counts…"/error states). **NOT renamed "Ready"** — no authoritative ready-to-dial metric exists on this screen (`eligible_leads` lives in single-campaign `get_queue_metrics`; using it would be an N+1 — excluded). Expanded row shows the existing state breakdown.
- **Active Agents cell:** count > 0 → green dot + "3 active"; authoritative 0 → gray dot + "No active agents"; presence not loaded (error/absent row) → **"—", never a fabricated zero**. Agent-role users get counts only — identities never reach their client (server-enforced, §4).
- **Assigned cell (leadership only):** Team → avatar stack (+N overflow) from `assigned_agent_ids`; Personal → owner name/avatar; Open Pool → "Open to agency". Agents never receive the column or the roster fetch.
- **Last Dialed cell:** authoritative `get_campaign_last_dialed` preserved; relative copy ("Just now" / "12 min ago" / "3 hr ago" / "Yesterday", older → existing absolute format); exact timestamp via tooltip + screen-reader text; "Never" only when the RPC returned no entry/null for the campaign (existing rule).
- **Action cell:** visible primary **"Start Dialing"** button on every collapsed row; preserves `onSelectCampaign` (wait-for-session-success unchanged), preserves hover/focus/pointerdown prefetch; `stopPropagation` so it never toggles expansion. **Row/chevron click expands only — never starts a session; no auto-first-call; no new confirmation step.**
- **Expanded row (existing data only):** state breakdown · Created date · Calling window (`calling_hours_start–end`) · Ring timeout (NULL → "Org default") · Max attempts (NULL → "Unlimited") · Retry interval (`retry_interval_minutes`, house fallback) · leadership: assigned-user details + active-agent identities (from the presence response) · Campaign Settings action with the existing `campaignEditPermissions` gate and existing `CAMPAIGN_SETTINGS_COPY.noPermission` copy (title + aria-label + disabled, fail-open-when-unknown preserved). **No AMD/Double-Dial or any non-listed setting.**
- Keep current ordering (oldest-first by `created_at`). **No search, sorting, pagination, favorites, or filters.** Expansion model: single-open accordion (house `WorkflowExecutionLog` pattern) — flagged as decision D4 below.

---

## 3. Active-presence definition and data contract

**"Active agent on campaign C" (server-side, authoritative):**
`dialer_sessions.status = 'active'` **AND** `campaign_id = C` **AND** `last_heartbeat_at >= now() - interval '3 minutes'` **AND** `organization_id = caller's org`; counted as **`COUNT(DISTINCT agent_id)`**. The 3-minute window is the exact complement of `close_stale_dialer_sessions`' predicate (`< now() - 3 min` abandons), so presence and the stale-cleanup canon can never disagree at the boundary. NULL-campaign sessions never match. **The presence read excludes stale rows; it never mutates them** (no abandon/UPDATE from the selection screen).

**Explicitly NOT presence sources:** login state, `profiles.availability_status`, open pages, browser/localStorage state, call counters, `dialer_lead_locks`. No sub-status labels ("On Call"/"Paused"/"Wrap-Up") — no server-authoritative source exists and none is being invented.

**Data contract (one call for the whole screen — no N+1):**

```
public.get_dialer_campaign_presence(p_campaign_ids uuid[])
  RETURNS TABLE(campaign_id uuid, active_agent_count integer, active_agents jsonb)
```

- Returns **one row per requested campaign the caller may dial** (authorized-but-idle campaigns return `active_agent_count = 0` — that is the authoritative zero). Unauthorized / cross-org / unknown ids return **no row** (client renders "—", never zero).
- `active_agents`: **always `'[]'` for Agent-role callers.** For leadership (server-verified): array of `{agent_id, display_name, avatar_url, last_heartbeat_at}`, heartbeat-desc. `display_name` = trimmed `first_name last_name` (null when empty — client renders "Unknown"); `avatar_url` null when blank. **No email, no phone, no role, nothing else.** `last_heartbeat_at` is included for the leadership expanded row's freshness ordering/labeling only.
- Client derivations: header total = Σ `active_agent_count` over returned rows (dedupe-safe per the unique-active-session invariant); per-row cell state machine = `row present ? (count > 0 ? active : authoritative-zero) : unavailable`.
- **A returned Supabase error is a failure state ("—"), never an empty/zero result. Presence is never persisted to localStorage** (unlike the contacts-stats cache) — a stale cached live count would lie.

**Refresh ownership (exactly one owner):** `useCampaignSelectionLive.refreshAll` (the existing 15 s interval + window-focus + org-filtered `campaigns` Realtime events) additionally invalidates `["dialerCampaignPresence", organizationId]` (prefix). The presence `useQuery` itself has **no `refetchInterval` and `refetchOnWindowFocus: false`** — no second poller, no duplicate focus fetch. Cadence stays the existing ~15 s + focus.

---

## 4. Proposed migration/RPC (authored in this task; **applied only with separate approval**)

One migration, one read-only aggregate function, no table, no index (per the EXPLAIN evidence), no RLS change, no Realtime change, no Edge Function, no trigger, no dynamic SQL.

**File creation:** via the installed CLI's documented command (`npx supabase migration new get_dialer_campaign_presence_rpc` — `--help` checked first; no hand-invented timestamp).

**Why SECURITY DEFINER (required justification):** `dialer_sessions` Agent RLS exposes only the caller's own rows. A SECURITY INVOKER aggregate run by an Agent would count at most their own session (1 on their campaign, 0 elsewhere) — structurally unable to meet the "aggregate counts for Agents" requirement. The manager-select policy would make INVOKER work for Admin/TL only, which would fork the data path by role. DEFINER with explicit in-function authorization is the established house pattern for exactly this situation (`get_queue_metrics`, `get_campaign_card_stats`, `get_org_leaderboard_stats`).

**Proposed SQL (final wording refined at implementation; structure and every security property fixed here):**

```sql
CREATE OR REPLACE FUNCTION public.get_dialer_campaign_presence(p_campaign_ids uuid[])
RETURNS TABLE(campaign_id uuid, active_agent_count integer, active_agents jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor  RECORD;
  v_leader boolean;
BEGIN
  -- Explicit auth: raises 42501 for unauthenticated / no org / org mismatch /
  -- non-Active profile. Role comes from public.profiles (DB-authoritative),
  -- never a browser flag and never the JWT role claim.
  SELECT * INTO v_actor FROM private.campaign_actor();

  IF p_campaign_ids IS NULL OR pg_catalog.array_length(p_campaign_ids, 1) IS NULL THEN
    RETURN;                                   -- empty input → empty result, no error
  END IF;
  IF pg_catalog.array_length(p_campaign_ids, 1) > 200 THEN
    RAISE EXCEPTION 'too many campaign ids (max 200)' USING ERRCODE = '22023';
  END IF;

  v_leader := v_actor.is_super
           OR v_actor.actor_role IN ('Admin', 'Team Leader', 'Super Admin');

  RETURN QUERY
  WITH req AS (                               -- dedupe caller-supplied ids
    SELECT DISTINCT u.id FROM pg_catalog.unnest(p_campaign_ids) AS u(id)
  ),
  camp AS (                                   -- AUTHORIZATION BOUNDARY: the input can only
    SELECT c.id                               -- narrow the caller's DIALABLE set — the exact
    FROM public.campaigns c                   -- mirror of public.can_dial_campaign (Personal
    JOIN req ON req.id = c.id                 -- owner-only; NO admin/view-all branch).
    WHERE c.organization_id = v_actor.org_id
      AND (
        pg_catalog.upper(pg_catalog.btrim(COALESCE(c.type,''))) IN ('OPEN POOL','OPEN')
        OR (pg_catalog.upper(pg_catalog.btrim(COALESCE(c.type,''))) = 'PERSONAL'
            AND c.user_id = v_actor.uid)
        OR (pg_catalog.upper(pg_catalog.btrim(COALESCE(c.type,''))) = 'TEAM'
            AND v_actor.uid::text IN (
              SELECT pg_catalog.jsonb_array_elements_text(
                COALESCE(c.assigned_agent_ids, '[]'::jsonb))))
      )
  ),
  fresh AS (                                  -- ACTIVE = active status + fresh heartbeat.
    SELECT ds.campaign_id AS cid, ds.agent_id,
           pg_catalog.max(ds.last_heartbeat_at) AS last_heartbeat_at
    FROM public.dialer_sessions ds
    JOIN camp ON camp.id = ds.campaign_id     -- NULL-campaign sessions can never join
    WHERE ds.organization_id = v_actor.org_id
      AND ds.status = 'active'
      AND ds.last_heartbeat_at >= pg_catalog.now() - interval '3 minutes'
    GROUP BY ds.campaign_id, ds.agent_id
  ),
  counts AS (
    SELECT f.cid, pg_catalog.count(DISTINCT f.agent_id)::integer AS cnt
    FROM fresh f GROUP BY f.cid
  ),
  idents AS (                                 -- built ONLY for leadership; minimal fields
    SELECT f.cid,
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'agent_id',          f.agent_id,
               'display_name',      NULLIF(pg_catalog.btrim(
                                      COALESCE(p.first_name,'') || ' ' ||
                                      COALESCE(p.last_name,'')), ''),
               'avatar_url',        NULLIF(p.avatar_url, ''),
               'last_heartbeat_at', f.last_heartbeat_at
             ) ORDER BY f.last_heartbeat_at DESC) AS agents
    FROM fresh f
    LEFT JOIN public.profiles p
      ON p.id = f.agent_id AND p.organization_id = v_actor.org_id
    WHERE v_leader                            -- Agent callers: this CTE yields no rows
    GROUP BY f.cid
  )
  SELECT camp.id, COALESCE(counts.cnt, 0),
         CASE WHEN v_leader THEN COALESCE(idents.agents, '[]'::jsonb)
              ELSE '[]'::jsonb END
  FROM camp
  LEFT JOIN counts ON counts.cid = camp.id
  LEFT JOIN idents ON idents.cid = camp.id;
END;
$$;

COMMENT ON FUNCTION public.get_dialer_campaign_presence(uuid[]) IS
  'Dialer selection-screen presence: per-campaign COUNT(DISTINCT agent_id) of active dialer '
  'sessions with a heartbeat inside 3 minutes (the stale-session complement). Input ids only '
  'narrow the caller''s dialable scope (mirrors can_dial_campaign). Identity details are '
  'returned only to DB-verified Admin/Team Leader/Super Admin callers; Agent callers get '
  'counts only. Read-only; never mutates stale sessions.';

-- CREATE OR REPLACE does not reset an ACL, and functions in public get PUBLIC/anon
-- EXECUTE by default — revoke both explicitly (house standard, 20260807165620 precedent).
REVOKE ALL ON FUNCTION public.get_dialer_campaign_presence(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dialer_campaign_presence(uuid[]) TO authenticated, service_role;
```

**Security model, point by point (mandate checklist):** explicit `auth.uid()` + tenant scope + Active-profile + org-match via `private.campaign_actor()` (raises 42501) · requested campaigns restricted to the caller's **dialable** scope — the `camp` CTE mirrors `can_dial_campaign` exactly (Personal owner-only preserved; `filterCampaignsForDialing` is never replaced by management scope; the SQL suite includes a drift test asserting the CTE and `public.can_dial_campaign()` agree over the fixture matrix) · server-authoritative role from `profiles` — exact string `'Team Leader'` (legacy `'Team Lead'` deliberately NOT accepted, matching `dialer_sessions_manager_select` and the profiles CHECK; noted as D2) · Super Admin stays home-org-scoped (campaign_actor's org-match + `org_id` filters; `is_super` only widens the identity payload, never the campaign set) · `SET search_path = pg_catalog, pg_temp`, fully qualified · `REVOKE FROM PUBLIC, anon`; `GRANT authenticated, service_role` · no dynamic SQL, no new table, no service-role key anywhere near the frontend · `dialer_sessions` RLS untouched (if any RLS change ever appears necessary, work stops for separate approval) · pre-existing ACL findings on `heartbeat_dialer_session`/`end_dialer_session`/table grants documented in §1 and deliberately not repaired.

**Rollback:** inverse documented in the migration header — `DROP FUNCTION public.get_dialer_campaign_presence(uuid[]);` (no data, no dependents; frontend degrades to "—" cells by design if the RPC is absent/failing).

---

## 5. Frontend architecture (exact files)

React + TypeScript, Tailwind tokens only (no inline styles, no hardcoded palette), shadcn/Radix reuse, every component < 200 lines, semantic `<table>` markup via the house `Table` primitives, dark/light via existing tokens, frozen module constants for all query-result defaults (render-loop invariant).

**NEW files**

| File | Responsibility |
|---|---|
| `src/components/dialer/CampaignSelectionTable.tsx` | Semantic table shell: `Table/TableHeader/TableBody`, role-aware column set, one `TooltipProvider` for the table, maps rows, single-open `expandedId` state |
| `src/components/dialer/CampaignSelectionRow.tsx` | Collapsed row: campaign cell (name/badge/description), contacts, active-agents cell, assigned cell (leadership), last-dialed (tooltip + sr-only exact time), chevron (`aria-expanded`/`aria-controls`), Start Dialing button (stopPropagation, pointerdown prefetch), row hover/focus prefetch |
| `src/components/dialer/CampaignSelectionRowDetails.tsx` | Expanded `<tr id=…>` (colSpan): state breakdown, Created, Calling window, Ring timeout, Max attempts/Unlimited, Retry interval, leadership assigned details + active-agent identities, Settings action (existing gate + `CAMPAIGN_SETTINGS_COPY.noPermission`) |
| `src/components/dialer/CampaignAvatarStack.tsx` | Small overlapping-avatar stack (+N overflow), `Avatar` primitive + `ring-2 ring-background`, reuses the `LeaderboardAgentAvatar` fallback styling convention |
| `src/components/dialer/campaignSelectionModel.ts` | Pure helpers + types: campaign-type normalization/badge classes (existing color semantics), `formatLastDialedRelative(iso, nowMs)` (injectable clock, "Never" rule preserved), presence cell state machine (`active / zero / unavailable`), header-total derivation, assigned-cell resolution (Team/Personal/Open Pool copy), oldest-first sort (moved from the old file), contacts-total calc |
| `src/hooks/useDialerCampaignPresence.ts` | Two focused hooks: `useDialerCampaignPresence(orgId, visibleCampaignIds, key, enabled)` — React Query `["dialerCampaignPresence", orgId, key]`, **no interval, no focus refetch, no localStorage**; `useCampaignAssigneeProfiles(orgId, neededIds, enabled)` — leadership-only minimal `profiles` fetch (`id, first_name, last_name, avatar_url`, `.in("id", union of visible campaigns' assigned ids + owners)`), staleTime 5 min |
| `src/lib/supabase-dialer-presence.ts` | RPC wrapper (narrow `(supabase as any).rpc` cast — house pattern for post-typegen RPCs): one call for all ids, response → `Record<campaignId, {activeAgentCount, activeAgents[]}>`, throws on error (error ≠ empty) |
| `supabase/migrations/<CLI-timestamp>_get_dialer_campaign_presence_rpc.sql` | §4 |
| `supabase/tests/dialer_campaign_presence.sql` | §6 SQL suite |

**MODIFIED files**

| File | Change |
|---|---|
| `src/components/dialer/CampaignSelection.tsx` | Rewritten as the orchestrator only (header + presence total, error banners, table-skeleton state, empty state, table) — target **< 200 lines** (from 273); props extended with `presence`, `presenceUnavailable`, `leadershipView`, `assigneeProfiles` |
| `src/pages/DialerPage.tsx` | Wiring only (~40–60 lines): `isLeadershipViewer` memo (`is_super_admin === true \|\| role in ('Admin','Team Leader','Super Admin')`), the two hook calls, new props pass-through. No feature logic inline; `handleSelectCampaign`, prefetch, stats/last-dialed/settings queries byte-preserved |
| `src/hooks/useCampaignSelectionLive.ts` | `refreshAll` additionally invalidates `["dialerCampaignPresence", organizationId]` (the single refresh owner; interval count unchanged) |
| `src/components/dialer/DialerSkeletons.tsx` | Add `CampaignTableSkeleton` (table-row skeletons — replaces the card blocks) |
| `WORK_LOG.md` | New entry (newest-first) + Migration History row — at completion |
| `implementation_plan.md` | This file |

**Explicitly untouched:** `TwilioContext.tsx` (confirmed: the selection screen never reaches `device.connect()` — selection only calls `startServerSession` → sets the campaign; Twilio init/dial live behind the selected-campaign screen) · `CampaignSettingsModal.tsx` + settings save path · `useDialerSession.ts` (campaign fetch/filter/session semantics stay byte-identical) · `supabase-dialer-sessions.ts` · queue/claim/disposition/caller-ID/telemetry code · all Edge Functions · the gated notifications migration.

**Role behavior (client + server):** Agent — campaigns from `filterCampaignsForDialing` (unchanged), counts only, no Assigned column, no roster fetch (`useCampaignAssigneeProfiles` disabled), no identities (server returns `[]` regardless of client claims). Leadership — same dialable campaign set (no management widening; another agent's Personal campaign remains invisible/undialable), Assigned column, expanded identities from the RPC. The server enforces identity gating independently via the profiles-read role check; the assigned-roster names rely on the pre-existing org-wide profiles RLS documented in §1.6 (no new exposure).

---

## 6. Test plan (fail-first: written and run red against the current cards before any implementation)

**Frontend (Vitest + RTL, `fireEvent`, house harness conventions):**

- NEW `src/components/dialer/__tests__/campaignSelectionTable.test.tsx` — mandated cases 1–9, 16–18: semantic table replaces cards (`role="table"`, no card grid); Agent column set exact; Assigned only for leadership; Agent markup never contains active-agent names (leadership fixture names absent from Agent render even when props are maliciously fed identities); leadership expanded row renders permitted assigned + active identities; Team/Personal/Open Pool assigned copy ("Open to agency"); count>0 active state; authoritative 0 → "No active agents"; presence unavailable → "—" and never "0"; header total from the same response (and hidden/em-dash on failure); table-row skeletons while loading; truthful empty state; Last-Dialed "Never" + real relative timestamp + exact-time tooltip/sr text.
- NEW `src/components/dialer/__tests__/campaignSelectionInteractions.test.tsx` — cases 10–15: expand/collapse via mouse (row + chevron) and keyboard (chevron focus + Enter/Space), `aria-expanded`/`aria-controls` correctness; expanding never invokes `onSelectCampaign`; Start Dialing invokes it exactly once (and does not toggle expansion); hover/focus/pointerdown prefetch calls preserved; Settings gate: disabled gear + exact `noPermission` copy when `false`, enabled/fail-open when unknown; lead-count error banner + Retry preserved.
- NEW `src/components/dialer/__tests__/campaignSelectionModel.test.ts` — pure helpers: relative-time buckets with injectable `nowMs` (incl. "Yesterday" and the absolute fallback), "Never" rules, presence state machine, header-total dedupe reasoning, assigned resolution, oldest-first sort stability.
- NEW `src/lib/__tests__/dialerPresence.test.ts` — case 20 + contract: exactly ONE rpc invocation for N visible campaigns (no per-row calls), error propagation (throws — never resolves to zeros), '[]'-identity and missing-row handling.
- NEW `src/hooks/__tests__/campaignSelectionLive.test.ts` — fake timers: exactly one interval; a tick invalidates both `campaignStateStats` and `dialerCampaignPresence` prefixes; no second poller anywhere (case 20's other half).
- Case 19 (visibility stays `filterCampaignsForDialing`): pinned by the existing `campaignAccessScope.test.ts` + `dialerSessionCampaignScope.test.ts` (both must stay green; `useDialerSession` untouched) + a table-level pin that exactly the passed campaigns render (no widening in the component).
- Regressions that must stay green: `dialerRenderStability.test.tsx` (≤ 30 commits, ≤ 4 campaigns builders — new queries use frozen defaults and are disabled until campaigns exist), `dialerCallGate.test.ts`, full suite.

**Database (NEW `supabase/tests/dialer_campaign_presence.sql`, `import_campaign_attachment.sql` harness conventions: `BEGIN;`…`ROLLBACK;`, T0 existence fail-first, T0a fixture-collision preflight, `pg_temp._sim/_as/_expect_error/_assert`, per-scenario `DO` blocks):** same-org aggregate counts · distinct-agent counting · the 3-minute boundary (fresh at exactly −3:00 counts; the cleanup predicate's complement) · stale active excluded · ended + abandoned excluded · NULL-campaign sessions excluded · cross-org campaigns return no row · unauthorized Personal campaigns return no row (drift test: `camp` CTE ≡ `can_dial_campaign()` across the fixture matrix) · Agent gets counts with `active_agents = '[]'` (no names/emails anywhere in the payload) · Team Leader/Admin/Super Admin get exactly `{agent_id, display_name, avatar_url, last_heartbeat_at}` · inactive-profile caller 42501 · anonymous EXECUTE denied · PUBLIC EXECUTE denied (T30q proacl scan, all overloads) · T31 `prosecdef` + literal `search_path=pg_catalog, pg_temp` · empty input → empty result · duplicate ids → deduped single rows · 201 ids → errors safely (22023). **Run ONLY on a proven-local disposable stack (connection URL printed, host must be localhost, prod ref absent) or an approved isolated preview branch — never production. Known replay-drift rule honored: if a faithful local stack cannot be built, the SQL suite is reported BLOCKED, not "passing".**

**Verification gates after approved implementation:** focused fail-first suites red→green · all Dialer/campaign/session regression suites · full `npx vitest run` under `TZ=UTC` and `TZ=America/Los_Angeles` vs the current baseline · root `npx tsc --noEmit` exit 0 + app-project tsc 73-error multiset identical vs a clean base worktree · `npm run build` · touched-file ESLint · `git diff --check` · full-diff review for telephony/telemetry side effects (expected: zero lines under `src/contexts/`, `supabase/functions/`) · no secrets/service-role in frontend · no N+1 presence requests · statement that no production backend mutation occurred.

---

## 7. Risks & mitigations

1. **False "No active agents" through error masking** — cell state machine keys off row presence vs query error; error → "—" (pinned by tests 8/9).
2. **Render-loop regression on the selection screen** — frozen empty constants, no inline query defaults, stability suite in the gate.
3. **Presence RPC absent at frontend ship time** (frontend and migration are separately gated) — the frontend degrades to "—" cells + no header badge (exactly the presence-unavailable state); nothing else on the screen depends on it. Safe in either ship order; ideal order: apply migration first.
4. **Double-refresh** — presence query has no interval/focus refetch of its own; single-owner test pins it.
5. **Leadership identity leak to Agents** — server returns `[]` based on DB-read role (SQL tests); client additionally never renders identity sections for non-leadership (component tests); a tampered client gains nothing.
6. **Row-click vs Start-button conflict** — stopPropagation + exactly-once tests (11/12).
7. **Legacy `'Team Lead'` role string** — deliberately not leadership for presence identity (matches `dialer_sessions_manager_select`; profiles CHECK forbids new rows). Flagged as D2 for Chris.
8. **`campaign_actor` raises for non-Active profiles** — selection screen for such users already cannot start sessions (same gate in `start_dialer_session`); presence shows "—". Documented, consistent.

**Rollback:** frontend = revert commit(s) (component swap is self-contained; old cards restorable from git). Migration = header-documented `DROP FUNCTION`; no schema/data dependencies.

---

## 8. Explicit exclusions (documented, NOT done)

- Active dialing screen, campaign management pages, campaign settings modal internals, telephony (`TwilioContext.tsx`, `device.connect()`, single-leg WebRTC), calls/call_logs telemetry, `calls.duration` ownership, session start/heartbeat/end semantics, `startServerSession` gate, wait-for-session-success behavior, queue claiming/SKIP LOCKED/hard claims/dispositions/advancement, caller-ID selection, ring-timeout application, trusted-stat caches/RPCs, management-vs-dialing access separation.
- No Realtime publication change, no Broadcast trigger, no Edge Function, no Supabase Presence, no new heartbeat system, no cron/sweeper, no new index (EXPLAIN-backed), no localStorage presence cache.
- No sub-status labels (On Call/Paused/Wrap-Up) — no authoritative source.
- No search/sort/pagination/favorites/filters; ordering unchanged.
- No repair of pre-existing findings: PUBLIC/anon EXECUTE on `heartbeat_dialer_session`/`end_dialer_session`, broad `dialer_sessions`/function table-grants, `get_campaign_last_dialed`'s org-scope breadth, `get_queue_metrics`' Personal gate — all documented in §1 for separate tasks.
- No RLS modification of any kind (an RLS need = stop + separate approval). No `dialer_sessions` mutation from the selection screen.
- No production apply/deploy/commit/push/PR/merge in this task phase.

---

## 9. Decisions for Chris (defaults chosen; veto/adjust freely)

- **D1 — RPC name/shape:** `get_dialer_campaign_presence(p_campaign_ids uuid[])` returning `(campaign_id, active_agent_count, active_agents jsonb)` as in §4.
- **D2 — Legacy `'Team Lead'`:** NOT treated as leadership (matches `dialer_sessions_manager_select` + profiles CHECK). Alternative: accept it like `get_campaign_card_stats` does.
- **D3 — Assigned-name source:** leadership-only client fetch of minimal org profiles (existing RLS already permits org-wide profile reads; no new exposure) rather than widening the presence RPC beyond presence.
- **D4 — Expansion model:** single-open accordion (house pattern). Multi-open is a trivial switch if preferred.
- **D5 — Header zero state:** gray dot + "No active agents" when the org total is authoritative 0; badge omitted entirely while presence is unavailable.
- **D6 — Input cap:** 200 ids (errors 22023 above it). Current org has ~7 campaigns.

## Recommended implementation sequence (after approval)

1. Fail-first frontend suites (red against current cards) + SQL suite T0 (red: function absent).
2. Migration file via CLI `migration new`; prove SQL suite green on a verified-local disposable stack (locality printed) — **no production apply**.
3. Components + hooks + wiring; suites green; render-stability green.
4. Full verification gates (§6); WORK_LOG entry + Migration History row; context snapshot.
5. Chris's separate approvals, in order: commit/push/PR → migration apply (then advisors + surgical typegen check) → frontend release.

**STOP — file edits, backend commands, migration apply, commit/push/PR, and deploy all remain gated on Chris's explicit approval of this plan.**
