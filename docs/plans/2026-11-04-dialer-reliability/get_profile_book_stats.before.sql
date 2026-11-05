CREATE OR REPLACE FUNCTION public.get_profile_book_stats(p_scope text, p_time_zone text DEFAULT NULL::text)
 RETURNS TABLE(scope_agent_count integer, total_clients bigint, clients_without_policy_detail bigint, total_policies bigint, additional_policy_count bigint, malformed_additional_policies bigint, total_premium_monthly numeric, policies_missing_premium bigint, undated_policies bigint, distinct_carriers integer, distinct_licensed_states integer, carrier_breakdown jsonb, carrier_overflow_policies bigint, policy_type_mix jsonb, policy_type_overflow_policies bigint, achievements jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor    RECORD;
  v_org_wide boolean;
  v_scope    uuid[];
BEGIN
  -- Raises 42501 for unauthenticated / no org context / missing profile / org mismatch / non-Active.
  SELECT * INTO v_actor FROM private.campaign_actor();

  IF p_scope IS NULL OR p_scope NOT IN ('self', 'team') THEN
    RAISE EXCEPTION 'get_profile_book_stats: p_scope must be ''self'' or ''team''' USING ERRCODE = '22023';
  END IF;

  IF p_time_zone IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = p_time_zone) THEN
    RAISE EXCEPTION 'get_profile_book_stats: unknown IANA time zone' USING ERRCODE = '22023';
  END IF;

  v_org_wide := v_actor.actor_role IN ('Admin', 'Super Admin') OR v_actor.is_super;

  IF p_scope = 'self' THEN
    v_scope := ARRAY[v_actor.uid];
  ELSIF v_org_wide THEN
    SELECT pg_catalog.array_agg(p.id)
      INTO v_scope
      FROM public.profiles p
     WHERE p.organization_id = v_actor.org_id
       AND p.status = 'Active';
  ELSE
    SELECT pg_catalog.array_agg(d.agent_id)
      INTO v_scope
      FROM private.resolve_downline_ids(v_actor.uid, v_actor.org_id) d;
  END IF;

  -- Fail closed. An unresolved scope aggregates over the empty set; it never widens.
  IF v_scope IS NULL THEN
    v_scope := ARRAY[]::uuid[];
  END IF;

  RETURN QUERY
  WITH scoped_clients AS (
    SELECT c.id,
           c.policy_type,
           c.carrier,
           c.policy_number,
           c.premium,
           c.face_amount,
           c.sold_date,
           c.custom_fields
    FROM public.clients c
    WHERE c.organization_id = v_actor.org_id
      AND c.assigned_agent_id = ANY (v_scope)
  ),
  primary_policies AS (
    SELECT sc.id                                                      AS client_id,
           nullif(pg_catalog.btrim(sc.policy_type), '')    AS policy_type,
           nullif(pg_catalog.btrim(sc.carrier), '')        AS carrier,
           CASE WHEN sc.premium     > 0 THEN sc.premium     END       AS premium_monthly,
           CASE WHEN sc.face_amount > 0 THEN sc.face_amount END       AS face_amount,
           sc.sold_date                                               AS sold_date
    FROM scoped_clients sc
    -- D-3b: evidence-based. A clients row with no policy signal at all contributes no policy.
    WHERE nullif(pg_catalog.btrim(sc.carrier), '')       IS NOT NULL
       OR nullif(pg_catalog.btrim(sc.policy_number), '') IS NOT NULL
       OR sc.premium     > 0
       OR sc.face_amount > 0
       OR sc.sold_date   IS NOT NULL
  ),
  -- jsonb_array_elements() RAISES on a non-array ("cannot extract elements from a scalar"), and a
  -- non-array is exactly what the FullScreenContactView corruption produces. Guarding that with a
  -- WHERE clause would make correctness depend on the planner pushing a single-relation restriction
  -- below the LATERAL join — which it does today, but which is a plan property rather than a
  -- contract. Substituting an empty array INSIDE the LATERAL argument is unconditionally safe
  -- whatever plan is chosen, and the corrupted rows are still counted by the `malformed` CTE below.
  additional_elements AS (
    SELECT sc.id AS client_id, e.value AS entry
    FROM scoped_clients sc
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      CASE
        WHEN pg_catalog.jsonb_typeof(sc.custom_fields -> 'additional_policies') = 'array'
        THEN sc.custom_fields -> 'additional_policies'
        ELSE '[]'::jsonb
      END
    ) e
  ),
  additional_policies AS (
    SELECT ae.client_id,
           nullif(pg_catalog.btrim(ae.entry ->> 'policyType'), '') AS policy_type,
           nullif(pg_catalog.btrim(ae.entry ->> 'carrier'), '')    AS carrier,
           CASE WHEN private.profile_parse_currency(ae.entry ->> 'premiumAmount') > 0
                THEN private.profile_parse_currency(ae.entry ->> 'premiumAmount') END AS premium_monthly,
           CASE WHEN private.profile_parse_currency(ae.entry ->> 'faceAmount') > 0
                THEN private.profile_parse_currency(ae.entry ->> 'faceAmount') END    AS face_amount,
           -- Legacy tolerance: rows written before the Sold Date build carry issueDate.
           private.profile_parse_iso_date(
             coalesce(ae.entry ->> 'soldDate', ae.entry ->> 'issueDate')
           ) AS sold_date
    FROM additional_elements ae
    WHERE pg_catalog.jsonb_typeof(ae.entry) = 'object'
  ),
  all_policies AS (
    SELECT 'primary'::text AS source, * FROM primary_policies
    UNION ALL
    SELECT 'additional'::text AS source, * FROM additional_policies
  ),
  -- Honest data-quality signal, never a silent zero: a container that is present but is not an
  -- array (the FullScreenContactView text-input corruption path), plus any non-object element.
  malformed AS (
    SELECT (
      (SELECT pg_catalog.count(*)
         FROM scoped_clients sc
        WHERE sc.custom_fields ? 'additional_policies'
          AND pg_catalog.jsonb_typeof(sc.custom_fields -> 'additional_policies') <> 'array')
      +
      (SELECT pg_catalog.count(*)
         FROM additional_elements ae
        WHERE pg_catalog.jsonb_typeof(ae.entry) <> 'object')
    )::bigint AS malformed_count
  ),
  carrier_rows AS (
    SELECT ap.carrier                                                       AS carrier,
           pg_catalog.count(*)::bigint                                      AS policies,
           coalesce(pg_catalog.sum(ap.premium_monthly), 0)::numeric AS premium_monthly
    FROM all_policies ap
    GROUP BY ap.carrier
  ),
  carrier_ranked AS (
    SELECT cr.*, pg_catalog.row_number() OVER (
             ORDER BY cr.policies DESC, cr.premium_monthly DESC, cr.carrier ASC NULLS LAST
           ) AS rn
    FROM carrier_rows cr
  ),
  type_rows AS (
    SELECT ap.policy_type                                                   AS policy_type,
           pg_catalog.count(*)::bigint                                      AS policies,
           coalesce(pg_catalog.sum(ap.premium_monthly), 0)::numeric AS premium_monthly
    FROM all_policies ap
    GROUP BY ap.policy_type
  ),
  type_ranked AS (
    SELECT tr.*, pg_catalog.row_number() OVER (
             ORDER BY tr.policies DESC, tr.premium_monthly DESC, tr.policy_type ASC NULLS LAST
           ) AS rn
    FROM type_rows tr
  ),
  months AS (
    SELECT pg_catalog.to_char(pg_catalog.date_trunc('month', ap.sold_date), 'YYYY-MM') AS bucket,
           pg_catalog.count(*)::bigint                                                 AS policies,
           coalesce(pg_catalog.sum(ap.premium_monthly), 0)::numeric         AS premium_monthly
    FROM all_policies ap
    WHERE ap.sold_date IS NOT NULL
    GROUP BY 1
  ),
  dial_day AS (
    SELECT pg_catalog.to_char((cl.created_at AT TIME ZONE p_time_zone)::date, 'YYYY-MM-DD') AS bucket,
           pg_catalog.count(*)::bigint AS dials
    FROM public.calls cl
    WHERE p_time_zone IS NOT NULL
      AND p_scope = 'self'
      AND cl.organization_id = v_actor.org_id
      AND cl.agent_id = ANY (v_scope)
      AND pg_catalog.lower(coalesce(cl.direction, '')) = ANY (ARRAY['outbound', 'outgoing'])
    GROUP BY 1
  )
  SELECT
    pg_catalog.cardinality(v_scope)::integer,
    (SELECT pg_catalog.count(*)::bigint FROM scoped_clients),
    (SELECT pg_catalog.count(*)::bigint FROM scoped_clients sc
      WHERE NOT EXISTS (SELECT 1 FROM primary_policies pp WHERE pp.client_id = sc.id)),
    (SELECT pg_catalog.count(*)::bigint FROM all_policies),
    (SELECT pg_catalog.count(*)::bigint FROM additional_policies),
    (SELECT m.malformed_count FROM malformed m),
    (SELECT coalesce(pg_catalog.sum(ap.premium_monthly), 0)::numeric FROM all_policies ap),
    (SELECT pg_catalog.count(*)::bigint FROM all_policies ap WHERE ap.premium_monthly IS NULL),
    (SELECT pg_catalog.count(*)::bigint FROM all_policies ap WHERE ap.sold_date IS NULL),
    (SELECT pg_catalog.count(*)::integer FROM carrier_rows cr WHERE cr.carrier IS NOT NULL),
    (SELECT pg_catalog.count(DISTINCT public.normalize_us_state(l.state))::integer
       FROM public.agent_state_licenses l
      WHERE l.organization_id = v_actor.org_id
        AND l.agent_id = ANY (v_scope)),
    (SELECT coalesce(
              pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'carrier',         cr.carrier,
                  'policies',        cr.policies,
                  'premium_monthly', cr.premium_monthly
                ) ORDER BY cr.rn
              ), '[]'::jsonb)
       FROM carrier_ranked cr WHERE cr.rn <= 100),
    (SELECT coalesce(pg_catalog.sum(cr.policies), 0)::bigint
       FROM carrier_ranked cr WHERE cr.rn > 100),
    (SELECT coalesce(
              pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'policy_type',     tr.policy_type,
                  'policies',        tr.policies,
                  'premium_monthly', tr.premium_monthly
                ) ORDER BY tr.rn
              ), '[]'::jsonb)
       FROM type_ranked tr WHERE tr.rn <= 100),
    (SELECT coalesce(pg_catalog.sum(tr.policies), 0)::bigint
       FROM type_ranked tr WHERE tr.rn > 100),
    pg_catalog.jsonb_build_object(
      'largest_face', (
        SELECT pg_catalog.jsonb_build_object(
                 'face_amount', ap.face_amount,
                 'carrier',     ap.carrier,
                 'policy_type', ap.policy_type,
                 'sold_date',   ap.sold_date
               )
        FROM all_policies ap
        WHERE ap.face_amount IS NOT NULL
        ORDER BY ap.face_amount DESC, ap.sold_date DESC NULLS LAST
        LIMIT 1
      ),
      'largest_premium', (
        SELECT pg_catalog.jsonb_build_object(
                 'premium_monthly', ap.premium_monthly,
                 'carrier',         ap.carrier,
                 'policy_type',     ap.policy_type,
                 'sold_date',       ap.sold_date
               )
        FROM all_policies ap
        WHERE ap.premium_monthly IS NOT NULL
        ORDER BY ap.premium_monthly DESC, ap.sold_date DESC NULLS LAST
        LIMIT 1
      ),
      'best_premium_month', (
        SELECT pg_catalog.jsonb_build_object(
                 'month', m.bucket, 'premium_monthly', m.premium_monthly, 'policies', m.policies)
        FROM months m
        WHERE m.premium_monthly > 0
        ORDER BY m.premium_monthly DESC, m.bucket DESC
        LIMIT 1
      ),
      'most_policies_month', (
        SELECT pg_catalog.jsonb_build_object(
                 'month', m.bucket, 'policies', m.policies, 'premium_monthly', m.premium_monthly)
        FROM months m
        ORDER BY m.policies DESC, m.bucket DESC
        LIMIT 1
      ),
      'most_dials_day', (
        SELECT pg_catalog.jsonb_build_object(
                 'day', d.bucket, 'dials', d.dials, 'time_zone', p_time_zone)
        FROM dial_day d
        ORDER BY d.dials DESC, d.bucket DESC
        LIMIT 1
      )
    );
END;
$function$
