-- =====================================================================================================
-- Contacts Unassigned Visibility Hardening — importer provenance + scoped unassigned pool
-- =====================================================================================================
-- [#APPROVE_RLS_CHANGE] Approved by Chris 2026-06-29.
--
-- WHY: leads_select_unassigned_pool (20260624120000) grants the ENTIRE org unassigned pool to any
-- role holding contacts.leads.view_unassigned. Team Leaders default to view_unassigned = true, so a
-- Team Leader can currently SELECT every unassigned (user_id IS NULL AND assigned_agent_id IS NULL)
-- lead in the org. Desired:
--   * Admin / Super Admin → ALL org unassigned (kept via contacts.leads.view_all short-circuit).
--   * Team Leader        → ONLY unassigned leads they personally imported.
--   * Agent              → NONE (already: view_unassigned default false).
--
-- public.leads has no provenance column today, and import_history.imported_lead_ids is not RLS-grade
-- (population gaps + un-indexed jsonb containment evaluated per-row). So we add an explicit, indexed
-- importer column and scope the pool policy to it.
--
-- The list path (search_contacts_leads -> _contacts_filtered_leads) is SECURITY INVOKER, so RLS is the
-- authoritative gate; we also mirror the predicate in the helper's `unassigned` branch so the RPC and
-- RLS never diverge (defense-in-depth if the helper is ever switched to SECURITY DEFINER).
-- =====================================================================================================

BEGIN;

-- 1. Provenance column (additive, nullable) -----------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS imported_by_user_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.leads.imported_by_user_id IS
  'Importer provenance: the user who imported this lead (set by import-contacts on every import, '
  'incl. the unassigned strategy). Drives leads_select_unassigned_pool so Team Leaders see only '
  'unassigned leads they personally imported. NULL = not import-attributable (manual add / seed).';

-- Partial index sized for the RLS predicate (only imported rows are ever matched).
CREATE INDEX IF NOT EXISTS idx_leads_imported_by_user_id
  ON public.leads (imported_by_user_id)
  WHERE imported_by_user_id IS NOT NULL;

-- 2. One-time backfill from recorded import provenance ------------------------------------------------
-- Recovers leads whose import_history row recorded imported_lead_ids + agent_id (real CSV imports
-- after migration 20260620184619). Org-scoped; only fills NULLs; ignores empty/legacy/non-array arrays.
UPDATE public.leads l
   SET imported_by_user_id = ih.agent_id
  FROM public.import_history ih,
       LATERAL jsonb_array_elements_text(ih.imported_lead_ids) AS e(lead_id)
 WHERE l.id = e.lead_id::uuid
   AND l.organization_id = ih.organization_id
   AND ih.agent_id IS NOT NULL
   AND ih.imported_lead_ids IS NOT NULL
   AND jsonb_typeof(ih.imported_lead_ids) = 'array'
   AND l.imported_by_user_id IS NULL;

-- 3. Tighten the unassigned-pool SELECT policy [#APPROVE_RLS_CHANGE] ----------------------------------
DROP POLICY IF EXISTS leads_select_unassigned_pool ON public.leads;
CREATE POLICY leads_select_unassigned_pool ON public.leads
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND user_id IS NULL
    AND assigned_agent_id IS NULL
    AND public.has_contacts_permission('contacts.leads.view_unassigned')
    AND (
      -- Admin / Super Admin / explicit view_all override → ALL org unassigned.
      public.has_contacts_permission('contacts.leads.view_all')
      -- Everyone else (Team Leaders) → only the unassigned leads they personally imported.
      OR imported_by_user_id = auth.uid()
    )
  );

-- 4. Mirror the predicate in the canonical INVOKER list helper ----------------------------------------
-- Full body reproduced verbatim from the applied 20260624120000 definition; ONLY the `unassigned`
-- branch of the scope WHERE changes (adds the same view_all-OR-imported_by_self predicate).
CREATE OR REPLACE FUNCTION public._contacts_filtered_leads(p_filters jsonb)
  RETURNS TABLE(id uuid, ord bigint)
  LANGUAGE sql
  STABLE
  SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT
      l.id,
      l.created_at,
      l.first_name, l.last_name, l.status, l.lead_source, l.state, l.phone, l.email,
      l.date_of_birth, l.best_time_to_call, l.last_contacted_at,
      CASE WHEN pa.id IS NULL THEN NULL
           ELSE lower(btrim(coalesce(pa.first_name, '') || ' ' || coalesce(pa.last_name, ''))) END AS agent_sort,
      (
        SELECT count(DISTINCT c.id)
        FROM public.calls c
        WHERE c.direction = 'outbound'
          AND (
            c.lead_id = l.id
            OR (c.lead_id IS NULL AND c.contact_id = l.id AND (c.contact_type = 'lead' OR c.contact_type IS NULL))
          )
      ) AS attempt_count,
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
        -- CHANGED (2026-06-29): importer-scoped unassigned — mirrors leads_select_unassigned_pool.
        -- view_all (Admin/Super) → all unassigned; otherwise only self-imported unassigned.
        OR (p_filters->>'scope' = 'unassigned'
          AND l.organization_id = public.get_org_id()
          AND l.user_id IS NULL AND l.assigned_agent_id IS NULL
          AND (
            public.has_contacts_permission('contacts.leads.view_all')
            OR l.imported_by_user_id = auth.uid()
          ))
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
$function$;

-- Ensure PostgREST exposes the new leads.imported_by_user_id column immediately (the import-contacts
-- edge function inserts it via PostgREST). Mirrors the NOTIFY in 20260624120000.
NOTIFY pgrst, 'reload schema';

COMMIT;
