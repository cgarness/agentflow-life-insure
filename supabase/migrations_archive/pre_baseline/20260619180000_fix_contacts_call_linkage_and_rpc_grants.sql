-- =============================================================
-- Contacts Build 2 — corrective follow-up to 20260617180000_contacts_scope_search_rpcs
-- Date: 2026-06-19
--
-- Two corrections found during post-apply real-data verification. The original
-- migration file (recorded in prod as MCP version 20260619172143) is LEFT IMMUTABLE
-- so repo migration history keeps matching production; this new migration supersedes
-- the affected function bodies via CREATE OR REPLACE and tightens grants.
--
-- (1) Call→Lead linkage. PRODUCTION FINDING: the Dialer's call writers
--     (dialer-api createCall/saveCall) persist a Lead's id in calls.contact_id but
--     frequently leave calls.contact_type NULL (it is written as `contact_type || null`).
--     The original strict `contact_type = 'lead'` fallback therefore matched ZERO
--     production lead calls (the only `contact_type='lead'` rows are orphaned/deleted
--     leads). Corrected polymorphic fallback (per review):
--         c.lead_id = l.id
--         OR (c.lead_id IS NULL AND c.contact_id = l.id
--             AND (c.contact_type = 'lead' OR c.contact_type IS NULL))
--     Keeps the future-compatible lead_id branch, counts current null-typed lead
--     calls, and still EXCLUDES explicitly client/recruit-typed calls. Applied
--     identically to the attempt-count AND last-disposition subqueries in BOTH
--     _contacts_filtered_leads (rows/total/ids/sort source) and search_contacts_leads
--     (page rows), so display / filter / sort / rows / total / matching-ids all agree.
--     Attempts: COUNT(DISTINCT c.id), OUTBOUND only, every linked outbound row counts
--     regardless of terminal status, inbound excluded. Last Disposition: NOT
--     direction-gated; newest call with disposition_id OR nonblank disposition_name;
--     NULLIF(btrim(name),'') ; never calls.status.
--     (Clients/Recruits RPCs have NO call linkage and are unchanged.)
--
-- (2) Grants. Supabase ALTER DEFAULT PRIVILEGES auto-granted EXECUTE to anon on the
--     new public functions; the original REVOKE ... FROM PUBLIC did not remove it.
--     Explicitly REVOKE FROM anon (and PUBLIC) and GRANT only authenticated, for all
--     10 Contacts functions. service_role left unchanged (frontend uses the anon
--     publishable key only — no service-role dependency).
--
-- NO table / RLS-policy / trigger / index / destructive-data / Edge / Twilio /
-- telemetry change. SECURITY INVOKER + fixed search_path preserved.
-- =============================================================

-- (1) Corrected linkage — _contacts_filtered_leads (the canonical filtered+ordered set).
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
      CASE WHEN pa.id IS NULL THEN NULL
           ELSE lower(btrim(coalesce(pa.first_name, '') || ' ' || coalesce(pa.last_name, ''))) END AS agent_sort,
      (
        -- Attempts = distinct OUTBOUND dial rows linked to the lead (inbound excluded).
        SELECT count(DISTINCT c.id)
        FROM public.calls c
        WHERE c.direction = 'outbound'
          AND (
            c.lead_id = l.id
            OR (c.lead_id IS NULL AND c.contact_id = l.id AND (c.contact_type = 'lead' OR c.contact_type IS NULL))
          )
      ) AS attempt_count,
      (
        -- Last Disposition uses the full linked set (NOT outbound-only); mirrors Build 1.
        SELECT NULLIF(btrim(c.disposition_name), '')
        FROM public.calls c
        WHERE (
            c.lead_id = l.id
            OR (c.lead_id IS NULL AND c.contact_id = l.id AND (c.contact_type = 'lead' OR c.contact_type IS NULL))
          )
          AND (c.disposition_id IS NOT NULL OR btrim(coalesce(c.disposition_name, '')) <> '')
        ORDER BY c.created_at DESC NULLS LAST, c.id DESC
        LIMIT 1
      ) AS last_disposition
    FROM public.leads l
    LEFT JOIN public.profiles pa ON pa.id = l.assigned_agent_id
    WHERE
      (
        (coalesce(p_filters->>'scope', 'mine') = 'mine'
          AND l.user_id = auth.uid())
        OR (p_filters->>'scope' = 'team'
          AND (l.user_id = auth.uid() OR public.is_ancestor_of(auth.uid(), l.user_id)))
        OR (p_filters->>'scope' = 'agency'
          AND l.organization_id = public.get_org_id())
      )
      AND (
        p_filters->'agent_ids' IS NULL
        OR jsonb_typeof(p_filters->'agent_ids') <> 'array'
        OR l.user_id = ANY (ARRAY(SELECT (jsonb_array_elements_text(p_filters->'agent_ids'))::uuid))
      )
      AND (p_filters->>'status' IS NULL OR l.status = p_filters->>'status')
      AND (p_filters->>'source' IS NULL OR l.lead_source = p_filters->>'source')
      AND (p_filters->>'state'  IS NULL OR l.state = p_filters->>'state')
      AND (p_filters->>'created_start' IS NULL OR l.created_at >= (p_filters->>'created_start')::timestamptz)
      AND (p_filters->>'created_end'   IS NULL OR l.created_at <= (p_filters->>'created_end')::timestamptz)
      AND (
        p_filters->'timezone_states' IS NULL
        OR jsonb_typeof(p_filters->'timezone_states') <> 'array'
        OR l.state = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'timezone_states')))
      )
      AND (
        p_filters->'callable_states' IS NULL
        OR jsonb_typeof(p_filters->'callable_states') <> 'array'
        OR l.state = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'callable_states')))
      )
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
      (
        p_filters->'attempt_buckets' IS NULL
        OR jsonb_typeof(p_filters->'attempt_buckets') <> 'array'
        OR (
          ('0'   = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'attempt_buckets'))) AND b.attempt_count = 0)
          OR ('1-3' = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'attempt_buckets'))) AND b.attempt_count BETWEEN 1 AND 3)
          OR ('4+'  = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'attempt_buckets'))) AND b.attempt_count >= 4)
        )
      )
      AND (
        p_filters->>'last_disposition' IS NULL
        OR (p_filters->>'last_disposition' = '__none__' AND b.last_disposition IS NULL)
        OR (
          p_filters->>'last_disposition' <> '__none__'
          AND lower(btrim(coalesce(b.last_disposition, ''))) = lower(btrim(p_filters->>'last_disposition'))
        )
      )
  ),
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
        k.created_at DESC, k.id DESC
    ) AS ord
  FROM keyed k;
$$;

-- (1) Corrected linkage — search_contacts_leads (page rows + exact total).
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
                       OR (c.lead_id IS NULL AND c.contact_id = l.id AND (c.contact_type = 'lead' OR c.contact_type IS NULL))
                     )
                 ),
               'last_disposition',
                 (
                   SELECT NULLIF(btrim(c.disposition_name), '')
                   FROM public.calls c
                   WHERE (
                       c.lead_id = l.id
                       OR (c.lead_id IS NULL AND c.contact_id = l.id AND (c.contact_type = 'lead' OR c.contact_type IS NULL))
                     )
                     AND (c.disposition_id IS NOT NULL OR btrim(coalesce(c.disposition_name, '')) <> '')
                   ORDER BY c.created_at DESC NULLS LAST, c.id DESC
                   LIMIT 1
                 )
             )
          ORDER BY pg.ord
        )
        FROM pg
        JOIN public.leads l ON l.id = pg.id
      ),
      '[]'::jsonb
    )
  );
$$;

-- (2) Tighten grants on ALL 10 Contacts functions: revoke PUBLIC + anon, grant authenticated.
REVOKE ALL ON FUNCTION public._contacts_filtered_leads(jsonb)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._contacts_filtered_leads(jsonb)    TO authenticated;
REVOKE ALL ON FUNCTION public.search_contacts_leads(jsonb)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_contacts_leads(jsonb)       TO authenticated;
REVOKE ALL ON FUNCTION public.contacts_lead_ids_matching(jsonb)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contacts_lead_ids_matching(jsonb)  TO authenticated;
REVOKE ALL ON FUNCTION public.get_contact_scope_agents()           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_scope_agents()         TO authenticated;
REVOKE ALL ON FUNCTION public._contacts_filtered_clients(jsonb)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._contacts_filtered_clients(jsonb)  TO authenticated;
REVOKE ALL ON FUNCTION public.search_contacts_clients(jsonb)       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_contacts_clients(jsonb)     TO authenticated;
REVOKE ALL ON FUNCTION public.contacts_client_ids_matching(jsonb)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contacts_client_ids_matching(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public._contacts_filtered_recruits(jsonb)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._contacts_filtered_recruits(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.search_contacts_recruits(jsonb)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_contacts_recruits(jsonb)    TO authenticated;
REVOKE ALL ON FUNCTION public.contacts_recruit_ids_matching(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contacts_recruit_ids_matching(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
