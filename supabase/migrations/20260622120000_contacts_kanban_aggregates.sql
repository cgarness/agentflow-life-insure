-- Contacts Build 4 — Kanban + List Consistency
-- Read-only Kanban aggregate RPCs for Leads and Recruits.
--
-- WHY: The Kanban board previously rendered the table's paginated page slice
-- (<=50 rows), so columns and counts were page-local and understated the real
-- pipeline (e.g. 517 leads showed as <=50 cards). These RPCs return EXACT
-- per-status full counts plus a bounded per-column card slice, reusing the SAME
-- canonical filtered set the table uses (`_contacts_filtered_leads` /
-- `_contacts_filtered_recruits`) so Kanban and table can never contradict.
--
-- SECURITY MODEL: SECURITY INVOKER (mirrors search_contacts_*). RLS applies to
-- the caller exactly as the table path; no new tenant-exposure surface. No
-- schema change, no data mutation, no RLS change.
--
-- KANBAN SEMANTICS:
--   * The single-status filter is IGNORED here (Kanban columns ARE the
--     statuses) — the key is stripped before delegating to the canonical
--     filter. All other filters/scope/agent narrowing apply identically.
--   * Pagination is irrelevant (the helper returns the full filtered set; these
--     RPCs never LIMIT/OFFSET the set — only per-column card hydration is bounded).
--   * Every status PRESENT in the filtered set is returned, including statuses
--     that match no configured pipeline_stage (the UI buckets those into an
--     explicit "Unmapped" column — records never disappear).
--   * p_per_column is clamped server-side to [1, 200].

-- ===========================================================================
-- Leads
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_contacts_lead_kanban(
  p_filters jsonb,
  p_per_column int DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH lim AS (
    SELECT LEAST(GREATEST(COALESCE(p_per_column, 50), 1), 200) AS n
  ),
  -- Kanban ignores any single-status filter (columns ARE the statuses).
  f AS (
    SELECT * FROM public._contacts_filtered_leads(COALESCE(p_filters, '{}'::jsonb) - 'status')
  ),
  joined AS (
    SELECT f.id, f.ord, l.status
    FROM f JOIN public.leads l ON l.id = f.id
  ),
  counts AS (
    SELECT status, count(*) AS total
    FROM joined
    GROUP BY status
  ),
  ranked AS (
    SELECT j.id, j.ord, j.status,
           row_number() OVER (PARTITION BY j.status ORDER BY j.ord) AS rn
    FROM joined j
  ),
  sliced AS (
    SELECT r.id, r.ord, r.status
    FROM ranked r CROSS JOIN lim
    WHERE r.rn <= lim.n
  ),
  cards AS (
    SELECT s.status,
           jsonb_agg(
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
             ORDER BY s.ord
           ) AS cards
    FROM sliced s JOIN public.leads l ON l.id = s.id
    GROUP BY s.status
  )
  SELECT jsonb_build_object(
    'grand_total', COALESCE((SELECT sum(total) FROM counts), 0),
    'per_column_limit', (SELECT n FROM lim),
    'stages', COALESCE(
      (
        SELECT jsonb_agg(
            jsonb_build_object(
              'status', co.status,
              'total',  co.total,
              'cards',  COALESCE(ca.cards, '[]'::jsonb)
            )
            ORDER BY co.status NULLS LAST
          )
        FROM counts co
        LEFT JOIN cards ca ON ca.status IS NOT DISTINCT FROM co.status
      ),
      '[]'::jsonb
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.get_contacts_lead_kanban(jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_contacts_lead_kanban(jsonb, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_contacts_lead_kanban(jsonb, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contacts_lead_kanban(jsonb, int) TO service_role;

-- ===========================================================================
-- Recruits (no call aggregates; recruits have no status filter by design)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_contacts_recruit_kanban(
  p_filters jsonb,
  p_per_column int DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH lim AS (
    SELECT LEAST(GREATEST(COALESCE(p_per_column, 50), 1), 200) AS n
  ),
  f AS (
    SELECT * FROM public._contacts_filtered_recruits(COALESCE(p_filters, '{}'::jsonb) - 'status')
  ),
  joined AS (
    SELECT f.id, f.ord, r.status
    FROM f JOIN public.recruits r ON r.id = f.id
  ),
  counts AS (
    SELECT status, count(*) AS total
    FROM joined
    GROUP BY status
  ),
  ranked AS (
    SELECT j.id, j.ord, j.status,
           row_number() OVER (PARTITION BY j.status ORDER BY j.ord) AS rn
    FROM joined j
  ),
  sliced AS (
    SELECT r.id, r.ord, r.status
    FROM ranked r CROSS JOIN lim
    WHERE r.rn <= lim.n
  ),
  cards AS (
    SELECT s.status,
           jsonb_agg(to_jsonb(r) ORDER BY s.ord) AS cards
    FROM sliced s JOIN public.recruits r ON r.id = s.id
    GROUP BY s.status
  )
  SELECT jsonb_build_object(
    'grand_total', COALESCE((SELECT sum(total) FROM counts), 0),
    'per_column_limit', (SELECT n FROM lim),
    'stages', COALESCE(
      (
        SELECT jsonb_agg(
            jsonb_build_object(
              'status', co.status,
              'total',  co.total,
              'cards',  COALESCE(ca.cards, '[]'::jsonb)
            )
            ORDER BY co.status NULLS LAST
          )
        FROM counts co
        LEFT JOIN cards ca ON ca.status IS NOT DISTINCT FROM co.status
      ),
      '[]'::jsonb
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.get_contacts_recruit_kanban(jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_contacts_recruit_kanban(jsonb, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_contacts_recruit_kanban(jsonb, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contacts_recruit_kanban(jsonb, int) TO service_role;

NOTIFY pgrst, 'reload schema';
