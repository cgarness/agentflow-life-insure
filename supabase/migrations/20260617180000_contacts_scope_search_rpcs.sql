-- =============================================================
-- Contacts Build 2 — Scope + server-side filter RPCs
-- Date: 2026-06-17  (revised after live-data verification — correction pass)
--
-- Adds the canonical server-side filter contract for the Contacts
-- Leads list so rows, exact total, and select-all matching IDs all use
-- ONE predicate (no client-side over-fetch + JS filtering drift).
--
-- Functions (all RLS-preserving, all SECURITY INVOKER):
--   * public._contacts_filtered_leads(jsonb)   — the ONE canonical filtered+ordered
--       lead-id set. Both public list RPCs consume it, so the WHERE can never
--       diverge between rows / count / ids.
--   * public.search_contacts_leads(jsonb)      — page of full lead rows (jsonb)
--       + exact filtered total_count.
--   * public.contacts_lead_ids_matching(jsonb) — ALL matching lead ids (ordered)
--       for select-all / bulk.
--   * public.get_contact_scope_agents()        — self + recursive hierarchy_path
--       downline (id/first/last only). SECURITY INVOKER: the WHERE does the
--       hierarchy filtering (is_ancestor_of); existing profiles RLS supplies
--       visibility (Agent→self, Team Leader→self+descendants, Admin→org,
--       Super Admin→home org). No DEFINER, no caller-supplied org.
--
-- Scope semantics (only ever NARROWS the RLS-authorized set):
--   mine   -> leads.user_id = auth.uid()
--   team   -> user_id = auth.uid() OR is_ancestor_of(auth.uid(), user_id)
--   agency -> organization_id = get_org_id()   (RLS already enforces org)
--
-- Attempt count (Build 2 D2, corrected) = COUNT(DISTINCT calls.id) linked to the
--   lead via the COMPATIBILITY relation (live prod has 0 calls with lead_id; lead
--   calls link via contact_id + contact_type='lead' — written by dialer-api
--   createCall/saveCall and the inbound webhook path; lead_id is reserved for a
--   future writer):
--       c.lead_id = l.id
--       OR (c.lead_id IS NULL AND c.contact_type = 'lead' AND c.contact_id = l.id)
--   The two branches are mutually exclusive (branch 2 requires lead_id IS NULL),
--   and COUNT(DISTINCT c.id) guarantees a row with both identifiers counts once.
--   Business rule: Attempts = distinct OUTBOUND dial rows linked to the lead
--   (`c.direction = 'outbound'`). Inbound calls are NOT attempts. Status is NOT a
--   filter — a failed/busy/no-answer/completed outbound row each counts as one
--   attempted dial (each outbound dial inserts exactly one calls row via
--   TwilioContext.makeCall / dialer-api; direction='outbound' is set on insert).
--   The queue-canonical counter campaign_leads.call_attempts is a separate,
--   campaign-scoped metric (advance_campaign_lead, invariant #19) and is NOT reused
--   here per D2. Buckets: 0 / 1-3 / 4+ (orphaned "5+" gone; 4 now matches).
--   Mirrors callBelongsToLead / countLeadCallAttempts in src/lib/contactsFilters.ts (tested).
-- Last Disposition uses the FULL linked call set (NOT outbound-only — a disposition
--   can be set on any call), mirroring Build 1 deriveLastDisposition: newest call
--   with disposition_id OR non-blank disposition_name; NULLIF(btrim(name),'') so an
--   id-only/blank-name call = No Disposition; "__none__" = no dispositioned call.
--
-- Full-dataset sorting (Build 2, server-side; before LIMIT/OFFSET):
--   p_filters carries sort_column + sort_direction. Both are ALLOWLISTED here via a
--   static CASE (no dynamic SQL, no caller string ever concatenated). Unknown column
--   OR invalid direction => default sort (created_at DESC). Every sort ends with a
--   deterministic id tie-break. _contacts_filtered_leads computes a row_number()
--   `ord` over the sorted set; both the page RPC and the ids RPC return `ord` and are
--   consumed in `ord` order, so visible rows and select-all matching-ids share ONE
--   ordering (range pagination stays gap/dupe-free). Allowlisted keys: name
--   (lower last,first), status, lead_source, state, phone, email, dob, best_time,
--   last_contacted, assigned_agent (displayed agent name; unassigned/missing profile
--   => NULL => NULLS LAST), attempt_count (outbound-only), last_disposition, created_at.
--   Mirrors LEAD_SORT_COLUMNS in src/lib/contactsFilters.ts (tested).
--
-- Indexes: NONE added. Prod already has idx_calls_lead_id AND idx_calls_contact_id,
--   which cover both linkage branches; leads has idx_leads_user_id /
--   idx_leads_assigned_agent_id / idx_leads_organization_id. No new/duplicate index
--   unless a checkpoint-2 EXPLAIN proves one is needed.
--
-- NO RLS policy / table / index change. Reversible via DROP FUNCTION.
-- =============================================================

-- -------------------------------------------------------------
-- Internal: the ONE canonical filtered + ordered lead set.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._contacts_filtered_leads(p_filters jsonb)
RETURNS TABLE (id uuid, ord bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT
      l.id,
      l.created_at,
      l.first_name, l.last_name, l.status, l.lead_source, l.state, l.phone, l.email,
      l.date_of_birth, l.best_time_to_call, l.last_contacted_at,
      -- Displayed agent name (getAgentName = "First L."); unassigned/missing profile => NULL.
      CASE WHEN pa.id IS NULL THEN NULL
           ELSE lower(btrim(coalesce(pa.first_name, '') || ' ' || coalesce(pa.last_name, ''))) END AS agent_sort,
      (
        -- Attempts = distinct OUTBOUND dial rows linked to the lead (inbound excluded).
        SELECT count(DISTINCT c.id)
        FROM public.calls c
        WHERE c.direction = 'outbound'
          AND (
            c.lead_id = l.id
            OR (c.lead_id IS NULL AND c.contact_type = 'lead' AND c.contact_id = l.id)
          )
      ) AS attempt_count,
      (
        -- Last Disposition uses the full linked set (NOT outbound-only) — a disposition
        -- can be set on any call; mirrors Build 1 deriveLastDisposition.
        SELECT NULLIF(btrim(c.disposition_name), '')
        FROM public.calls c
        WHERE (
            c.lead_id = l.id
            OR (c.lead_id IS NULL AND c.contact_type = 'lead' AND c.contact_id = l.id)
          )
          AND (c.disposition_id IS NOT NULL OR btrim(coalesce(c.disposition_name, '')) <> '')
        ORDER BY c.created_at DESC NULLS LAST, c.id DESC
        LIMIT 1
      ) AS last_disposition
    FROM public.leads l
    LEFT JOIN public.profiles pa ON pa.id = l.assigned_agent_id
    WHERE
      -- ---- scope (narrows within RLS) ----
      (
        (coalesce(p_filters->>'scope', 'mine') = 'mine'
          AND l.user_id = auth.uid())
        OR (p_filters->>'scope' = 'team'
          AND (l.user_id = auth.uid() OR public.is_ancestor_of(auth.uid(), l.user_id)))
        OR (p_filters->>'scope' = 'agency'
          AND l.organization_id = public.get_org_id())
      )
      -- ---- specific-agent narrowing (constrained within scope) ----
      AND (
        p_filters->'agent_ids' IS NULL
        OR jsonb_typeof(p_filters->'agent_ids') <> 'array'
        OR l.user_id = ANY (ARRAY(SELECT (jsonb_array_elements_text(p_filters->'agent_ids'))::uuid))
      )
      -- ---- simple equality filters ----
      AND (p_filters->>'status' IS NULL OR l.status = p_filters->>'status')
      AND (p_filters->>'source' IS NULL OR l.lead_source = p_filters->>'source')
      AND (p_filters->>'state'  IS NULL OR l.state = p_filters->>'state')
      -- ---- created date range ----
      AND (p_filters->>'created_start' IS NULL OR l.created_at >= (p_filters->>'created_start')::timestamptz)
      AND (p_filters->>'created_end'   IS NULL OR l.created_at <= (p_filters->>'created_end')::timestamptz)
      -- ---- timezone group state-set (resolved in TS) ----
      AND (
        p_filters->'timezone_states' IS NULL
        OR jsonb_typeof(p_filters->'timezone_states') <> 'array'
        OR l.state = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'timezone_states')))
      )
      -- ---- callable-now state-set (frozen snapshot, resolved in TS) ----
      AND (
        p_filters->'callable_states' IS NULL
        OR jsonb_typeof(p_filters->'callable_states') <> 'array'
        OR l.state = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'callable_states')))
      )
      -- ---- search ----
      AND (
        p_filters->>'search' IS NULL
        OR l.first_name ILIKE '%' || (p_filters->>'search') || '%'
        OR l.last_name  ILIKE '%' || (p_filters->>'search') || '%'
        OR l.phone      ILIKE '%' || (p_filters->>'search') || '%'
        OR l.email      ILIKE '%' || (p_filters->>'search') || '%'
      )
  ),
  filtered AS (
    SELECT * FROM base b
    WHERE
      -- ---- attempt-count buckets (0 / 1-3 / 4+) ----
      (
        p_filters->'attempt_buckets' IS NULL
        OR jsonb_typeof(p_filters->'attempt_buckets') <> 'array'
        OR (
          ('0'   = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'attempt_buckets'))) AND b.attempt_count = 0)
          OR ('1-3' = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'attempt_buckets'))) AND b.attempt_count BETWEEN 1 AND 3)
          OR ('4+'  = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'attempt_buckets'))) AND b.attempt_count >= 4)
        )
      )
      -- ---- last disposition (matches Build 1 display derivation) ----
      AND (
        p_filters->>'last_disposition' IS NULL
        OR (p_filters->>'last_disposition' = '__none__' AND b.last_disposition IS NULL)
        OR (
          p_filters->>'last_disposition' <> '__none__'
          AND lower(btrim(coalesce(b.last_disposition, ''))) = lower(btrim(p_filters->>'last_disposition'))
        )
      )
  ),
  -- ALLOWLISTED sort keys (static CASE — no dynamic SQL, no caller string ever used).
  -- Unknown column OR invalid direction => all keys NULL => default (created_at DESC).
  keyed AS (
    SELECT
      f.id, f.created_at,
      (lower(coalesce(p_filters->>'sort_direction', 'desc')) IN ('asc', 'desc')) AS dir_ok,
      (lower(coalesce(p_filters->>'sort_direction', 'desc')) = 'asc')            AS asc_dir,
      CASE lower(coalesce(p_filters->>'sort_column', ''))
        WHEN 'name'             THEN lower(btrim(coalesce(f.last_name, ''))) || ' ' || lower(btrim(coalesce(f.first_name, '')))
        WHEN 'status'           THEN f.status
        WHEN 'lead_source'      THEN lower(btrim(coalesce(f.lead_source, '')))
        WHEN 'state'            THEN f.state
        WHEN 'phone'            THEN f.phone
        WHEN 'email'            THEN lower(btrim(coalesce(f.email, '')))
        WHEN 'dob'              THEN f.date_of_birth::text
        WHEN 'best_time'        THEN f.best_time_to_call
        WHEN 'last_contacted'   THEN f.last_contacted_at::text
        WHEN 'assigned_agent'   THEN f.agent_sort
        WHEN 'last_disposition' THEN lower(btrim(f.last_disposition))
        ELSE NULL
      END AS text_key,
      CASE WHEN lower(coalesce(p_filters->>'sort_column', '')) = 'attempt_count' THEN f.attempt_count ELSE NULL END AS num_key,
      CASE WHEN lower(coalesce(p_filters->>'sort_column', '')) = 'created_at'     THEN f.created_at     ELSE NULL END AS ts_key
    FROM filtered f
  )
  SELECT
    k.id,
    row_number() OVER (
      ORDER BY
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.text_key END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.text_key END DESC NULLS LAST,
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.num_key  END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.num_key  END DESC NULLS LAST,
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.ts_key   END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.ts_key   END DESC NULLS LAST,
        k.created_at DESC, k.id DESC   -- default sort + deterministic id tie-break
    ) AS ord
  FROM keyed k;
$$;

REVOKE ALL ON FUNCTION public._contacts_filtered_leads(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._contacts_filtered_leads(jsonb) TO authenticated;

-- -------------------------------------------------------------
-- Page of full lead rows (jsonb) + exact filtered total_count.
-- Ordered by `ord` (the canonical sort) BEFORE LIMIT/OFFSET.
-- Attempt/disposition recomputed for the page only, via the SAME linkage.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_contacts_leads(p_filters jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH f AS (
    SELECT * FROM public._contacts_filtered_leads(p_filters)
  ),
  pg AS (
    SELECT f.id, f.ord
    FROM f
    ORDER BY f.ord
    LIMIT  COALESCE((p_filters->>'page_size')::int, 50)
    OFFSET COALESCE((p_filters->>'page')::int, 0) * COALESCE((p_filters->>'page_size')::int, 50)
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT count(*) FROM f),
    'rows', COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(l)
          || jsonb_build_object(
               'attempt_count',
                 (
                   SELECT count(DISTINCT c.id)
                   FROM public.calls c
                   WHERE c.direction = 'outbound'
                     AND (
                       c.lead_id = l.id
                       OR (c.lead_id IS NULL AND c.contact_type = 'lead' AND c.contact_id = l.id)
                     )
                 ),
               'last_disposition',
                 (
                   SELECT NULLIF(btrim(c.disposition_name), '')
                   FROM public.calls c
                   WHERE (
                       c.lead_id = l.id
                       OR (c.lead_id IS NULL AND c.contact_type = 'lead' AND c.contact_id = l.id)
                     )
                     AND (c.disposition_id IS NOT NULL OR btrim(coalesce(c.disposition_name, '')) <> '')
                   ORDER BY c.created_at DESC NULLS LAST, c.id DESC
                   LIMIT 1
                 )
             )
          ORDER BY pg.ord   -- preserve the canonical sort within the page
        )
        FROM pg
        JOIN public.leads l ON l.id = pg.id
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.search_contacts_leads(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_contacts_leads(jsonb) TO authenticated;

-- -------------------------------------------------------------
-- ALL matching lead ids for select-all / bulk. Returns (id, ord); the caller
-- adds `.order("ord").range(...)` so PostgREST range pagination slices the SAME
-- canonical order deterministically (no gaps/dupes across ranges).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contacts_lead_ids_matching(p_filters jsonb)
RETURNS TABLE (id uuid, ord bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT id, ord
  FROM public._contacts_filtered_leads(p_filters)
  ORDER BY ord;
$$;

REVOKE ALL ON FUNCTION public.contacts_lead_ids_matching(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contacts_lead_ids_matching(jsonb) TO authenticated;

-- =============================================================
-- CLIENTS — server-side filtered + sorted set (mirrors the leads pattern).
-- Sorting by Assigned Agent uses a SQL LEFT JOIN to profiles (NOT a PostgREST
-- embedded `!inner` order — that would drop unassigned clients). Unassigned /
-- missing-profile clients are KEPT and sort NULLS LAST. SECURITY INVOKER → RLS
-- + org scope preserved. p_filters: assigned_agent_ids, search, state,
-- policy_type, sort_column, sort_direction, page, page_size.
-- =============================================================
CREATE OR REPLACE FUNCTION public._contacts_filtered_clients(p_filters jsonb)
RETURNS TABLE (id uuid, ord bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT
      c.id, c.created_at, c.first_name, c.last_name, c.phone, c.email, c.state,
      c.policy_type, c.carrier, c.premium, c.face_amount, c.issue_date,
      CASE WHEN pa.id IS NULL THEN NULL
           ELSE lower(btrim(coalesce(pa.first_name, '') || ' ' || coalesce(pa.last_name, ''))) END AS agent_sort
    FROM public.clients c
    LEFT JOIN public.profiles pa ON pa.id = c.assigned_agent_id   -- LEFT JOIN keeps unassigned
    WHERE
      (
        p_filters->'assigned_agent_ids' IS NULL
        OR jsonb_typeof(p_filters->'assigned_agent_ids') <> 'array'
        OR c.assigned_agent_id = ANY (ARRAY(SELECT (jsonb_array_elements_text(p_filters->'assigned_agent_ids'))::uuid))
      )
      AND (p_filters->>'state'       IS NULL OR c.state = p_filters->>'state')
      AND (p_filters->>'policy_type' IS NULL OR c.policy_type = p_filters->>'policy_type')
      AND (
        p_filters->>'search' IS NULL
        OR c.first_name ILIKE '%' || (p_filters->>'search') || '%'
        OR c.last_name  ILIKE '%' || (p_filters->>'search') || '%'
        OR c.phone      ILIKE '%' || (p_filters->>'search') || '%'
        OR c.email      ILIKE '%' || (p_filters->>'search') || '%'
      )
  ),
  keyed AS (
    SELECT
      b.id, b.created_at,
      (lower(coalesce(p_filters->>'sort_direction', 'desc')) IN ('asc', 'desc')) AS dir_ok,
      (lower(coalesce(p_filters->>'sort_direction', 'desc')) = 'asc')            AS asc_dir,
      CASE lower(coalesce(p_filters->>'sort_column', ''))
        WHEN 'name'           THEN lower(btrim(coalesce(b.last_name, '')) || ' ' || btrim(coalesce(b.first_name, '')))
        WHEN 'phone'          THEN b.phone
        WHEN 'email'          THEN lower(btrim(coalesce(b.email, '')))
        WHEN 'state'          THEN b.state
        WHEN 'policy_type'    THEN b.policy_type
        WHEN 'carrier'        THEN lower(btrim(coalesce(b.carrier, '')))
        WHEN 'issue_date'     THEN b.issue_date          -- 'YYYY-MM-DD' text sorts chronologically
        WHEN 'assigned_agent' THEN b.agent_sort
        ELSE NULL
      END AS text_key,
      CASE lower(coalesce(p_filters->>'sort_column', ''))
        WHEN 'premium'     THEN b.premium                -- numeric columns sort numerically
        WHEN 'face_amount' THEN b.face_amount
        ELSE NULL
      END AS num_key,
      CASE WHEN lower(coalesce(p_filters->>'sort_column', '')) = 'created_at' THEN b.created_at ELSE NULL END AS ts_key
    FROM base b
  )
  SELECT
    k.id,
    row_number() OVER (
      ORDER BY
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.text_key END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.text_key END DESC NULLS LAST,
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.num_key  END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.num_key  END DESC NULLS LAST,
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.ts_key   END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.ts_key   END DESC NULLS LAST,
        k.created_at DESC, k.id DESC
    ) AS ord
  FROM keyed k;
$$;

REVOKE ALL ON FUNCTION public._contacts_filtered_clients(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._contacts_filtered_clients(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_contacts_clients(p_filters jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH f AS (SELECT * FROM public._contacts_filtered_clients(p_filters)),
  pg AS (
    SELECT f.id, f.ord FROM f
    ORDER BY f.ord
    LIMIT  COALESCE((p_filters->>'page_size')::int, 50)
    OFFSET COALESCE((p_filters->>'page')::int, 0) * COALESCE((p_filters->>'page_size')::int, 50)
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT count(*) FROM f),
    'rows', COALESCE(
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY pg.ord) FROM pg JOIN public.clients c ON c.id = pg.id),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.search_contacts_clients(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_contacts_clients(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.contacts_client_ids_matching(p_filters jsonb)
RETURNS TABLE (id uuid, ord bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT id, ord FROM public._contacts_filtered_clients(p_filters) ORDER BY ord;
$$;

REVOKE ALL ON FUNCTION public.contacts_client_ids_matching(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contacts_client_ids_matching(jsonb) TO authenticated;

-- =============================================================
-- RECRUITS — server-side filtered + sorted set (same LEFT JOIN agent-name sort;
-- unassigned kept, NULLS LAST). p_filters: assigned_agent_ids, search, state,
-- sort_column, sort_direction, page, page_size.
-- =============================================================
CREATE OR REPLACE FUNCTION public._contacts_filtered_recruits(p_filters jsonb)
RETURNS TABLE (id uuid, ord bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT
      r.id, r.created_at, r.first_name, r.last_name, r.phone, r.email, r.state, r.status,
      CASE WHEN pa.id IS NULL THEN NULL
           ELSE lower(btrim(coalesce(pa.first_name, '') || ' ' || coalesce(pa.last_name, ''))) END AS agent_sort
    FROM public.recruits r
    LEFT JOIN public.profiles pa ON pa.id = r.assigned_agent_id   -- LEFT JOIN keeps unassigned
    WHERE
      (
        p_filters->'assigned_agent_ids' IS NULL
        OR jsonb_typeof(p_filters->'assigned_agent_ids') <> 'array'
        OR r.assigned_agent_id = ANY (ARRAY(SELECT (jsonb_array_elements_text(p_filters->'assigned_agent_ids'))::uuid))
      )
      AND (p_filters->>'state' IS NULL OR r.state = p_filters->>'state')
      AND (
        p_filters->>'search' IS NULL
        OR r.first_name ILIKE '%' || (p_filters->>'search') || '%'
        OR r.last_name  ILIKE '%' || (p_filters->>'search') || '%'
        OR r.phone      ILIKE '%' || (p_filters->>'search') || '%'
        OR r.email      ILIKE '%' || (p_filters->>'search') || '%'
      )
  ),
  keyed AS (
    SELECT
      b.id, b.created_at,
      (lower(coalesce(p_filters->>'sort_direction', 'desc')) IN ('asc', 'desc')) AS dir_ok,
      (lower(coalesce(p_filters->>'sort_direction', 'desc')) = 'asc')            AS asc_dir,
      CASE lower(coalesce(p_filters->>'sort_column', ''))
        WHEN 'name'           THEN lower(btrim(coalesce(b.last_name, '')) || ' ' || btrim(coalesce(b.first_name, '')))
        WHEN 'phone'          THEN b.phone
        WHEN 'email'          THEN lower(btrim(coalesce(b.email, '')))
        WHEN 'state'          THEN b.state
        WHEN 'status'         THEN b.status
        WHEN 'assigned_agent' THEN b.agent_sort
        ELSE NULL
      END AS text_key,
      CASE WHEN lower(coalesce(p_filters->>'sort_column', '')) = 'created_at' THEN b.created_at ELSE NULL END AS ts_key
    FROM base b
  )
  SELECT
    k.id,
    row_number() OVER (
      ORDER BY
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.text_key END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.text_key END DESC NULLS LAST,
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.ts_key   END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.ts_key   END DESC NULLS LAST,
        k.created_at DESC, k.id DESC
    ) AS ord
  FROM keyed k;
$$;

REVOKE ALL ON FUNCTION public._contacts_filtered_recruits(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._contacts_filtered_recruits(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_contacts_recruits(p_filters jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH f AS (SELECT * FROM public._contacts_filtered_recruits(p_filters)),
  pg AS (
    SELECT f.id, f.ord FROM f
    ORDER BY f.ord
    LIMIT  COALESCE((p_filters->>'page_size')::int, 50)
    OFFSET COALESCE((p_filters->>'page')::int, 0) * COALESCE((p_filters->>'page_size')::int, 50)
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT count(*) FROM f),
    'rows', COALESCE(
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY pg.ord) FROM pg JOIN public.recruits r ON r.id = pg.id),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.search_contacts_recruits(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_contacts_recruits(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.contacts_recruit_ids_matching(p_filters jsonb)
RETURNS TABLE (id uuid, ord bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT id, ord FROM public._contacts_filtered_recruits(p_filters) ORDER BY ord;
$$;

REVOKE ALL ON FUNCTION public.contacts_recruit_ids_matching(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contacts_recruit_ids_matching(jsonb) TO authenticated;

-- -------------------------------------------------------------
-- Self + recursive downline (names only), org-scoped.
-- SECURITY INVOKER: the WHERE (is_ancestor_of + self) does the hierarchy
-- filtering; existing profiles RLS supplies visibility for every role
-- (Agent→self, Team Leader→self+descendants, Admin→org, Super Admin→home org),
-- and is_ancestor_of resolves the descendant subset even for Admin. get_org_id()
-- + auth.uid() are the only scope inputs (no caller-supplied org). Names/ids only.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_contact_scope_agents()
RETURNS TABLE (id uuid, first_name text, last_name text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.first_name, p.last_name
  FROM public.profiles p
  WHERE p.organization_id = public.get_org_id()
    AND coalesce(p.status, '') IS DISTINCT FROM 'Deleted'
    AND (p.id = auth.uid() OR public.is_ancestor_of(auth.uid(), p.id))
  ORDER BY p.first_name, p.last_name;
$$;

REVOKE ALL ON FUNCTION public.get_contact_scope_agents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contact_scope_agents() TO authenticated;

NOTIFY pgrst, 'reload schema';
