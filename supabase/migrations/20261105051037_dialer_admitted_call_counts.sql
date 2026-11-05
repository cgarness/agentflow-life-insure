-- Dependent P0 counting correction. Each captured reader changes by one admission predicate only.
-- Preserves legacy rows, signed provider failures, tenancy, attribution, dates and duration rules.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $preimage$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure('public.get_campaign_card_stats(uuid[])') AND md5(p.prosrc)='4d5cdfd5281ed0f9f6e3bcd40a5ff0ac' AND p.proowner='postgres'::regrole AND p.prosecdef IS true AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[] AND p.proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'Dialer hotfix preimage drift: public.get_campaign_card_stats'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure('private.report_call_facts(uuid,timestamptz,timestamptz,uuid[])') AND md5(p.prosrc)='bacbfd0629221957cae28ba28728c8bd' AND p.proowner='postgres'::regrole AND p.prosecdef IS true AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND p.proacl::text='{postgres=X/postgres}') THEN RAISE EXCEPTION 'Dialer hotfix preimage drift: private.report_call_facts'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure('private.performance_rows(uuid[],timestamptz,timestamptz,date,date,uuid[])') AND md5(p.prosrc)='d7f486b3b303ce96d3c96c64b511c76d' AND p.proowner='postgres'::regrole AND p.prosecdef IS false AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND p.proacl::text='{postgres=X/postgres}') THEN RAISE EXCEPTION 'Dialer hotfix preimage drift: private.performance_rows'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure('public.get_performance_details(text,text,text,uuid,timestamptz,integer)') AND md5(p.prosrc)='f583b067528b38b6713007ecccd84650' AND p.proowner='postgres'::regrole AND p.prosecdef IS true AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp','statement_timeout=25s']::text[] AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'Dialer hotfix preimage drift: public.get_performance_details'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure('public.get_profile_book_stats(text,text)') AND md5(p.prosrc)='38e98ae690b7dc781fadb5d1a858f11e' AND p.proowner='postgres'::regrole AND p.prosecdef IS true AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'Dialer hotfix preimage drift: public.get_profile_book_stats'; END IF;
END $preimage$;

CREATE OR REPLACE FUNCTION public.get_campaign_card_stats(p_campaign_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(campaign_id uuid, total_leads integer, called_leads integer, contacted_leads integer, converted_leads integer, policies_sold integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Resolve caller identity / org / view-all ONCE (single evaluation).
  WITH me AS (
    SELECT
      public.get_org_id() AS org_id,
      auth.uid()          AS uid,
      (
        public.get_user_role() = ANY (ARRAY['Admin', 'Team Leader', 'Team Lead'])
        OR public.is_super_admin()
      )                   AS view_all
  ),
  -- Campaigns the caller may see: org-scoped AND access-scoped to the frontend
  -- `canUserAccessCampaign` rules. `p_campaign_ids` can only narrow this set.
  camp AS (
    SELECT c.id, c.organization_id
    FROM public.campaigns c
    CROSS JOIN me
    WHERE me.org_id IS NOT NULL
      AND c.organization_id = me.org_id
      AND (p_campaign_ids IS NULL OR c.id = ANY (p_campaign_ids))
      AND (
            upper(btrim(c.type)) = ANY (ARRAY['OPEN POOL', 'OPEN'])
         OR (upper(btrim(c.type)) = 'PERSONAL' AND c.user_id = me.uid)
         OR (upper(btrim(c.type)) = 'TEAM'
             AND me.uid::text = ANY (
               ARRAY(SELECT jsonb_array_elements_text(coalesce(c.assigned_agent_ids, '[]'::jsonb)))
             ))
         OR (me.view_all AND upper(btrim(c.type)) = 'TEAM')
      )
  ),
  -- One row per (campaign_lead, OUTBOUND call) with resolved disposition flags.
  call_facts AS (
    SELECT
      cl.campaign_id            AS campaign_id,
      cl.id                     AS campaign_lead_id,
      CASE
        WHEN lower(coalesce(di.name, dn.name, ca.disposition_name, '')) = 'no answer'
          THEN false
        WHEN coalesce(ca.duration, 0) > 45
          THEN true
        WHEN coalesce(di.counts_as_contacted, false)
          THEN true
        WHEN ca.disposition_id IS NULL AND coalesce(dn.counts_as_contacted, false)
          THEN true
        ELSE false
      END AS is_contacted,
      CASE
        WHEN coalesce(psi.convert_to_client, false)
          THEN true
        WHEN ca.disposition_id IS NULL AND coalesce(psn.convert_to_client, false)
          THEN true
        ELSE false
      END AS is_converting
    FROM camp
    JOIN public.campaign_leads cl ON cl.campaign_id = camp.id
    JOIN public.calls ca
      ON ca.campaign_lead_id = cl.id
     AND (NOT ca.dialer_admission_required OR ca.dialer_provider_admitted IS TRUE)
     AND lower(coalesce(ca.direction, '')) = ANY (ARRAY['outbound', 'outgoing'])
    LEFT JOIN public.dispositions di     ON di.id = ca.disposition_id
    LEFT JOIN public.pipeline_stages psi ON psi.id = di.pipeline_stage_id
    LEFT JOIN public.dispositions dn
      ON ca.disposition_id IS NULL
     AND lower(dn.name) = lower(ca.disposition_name)
     AND dn.organization_id = camp.organization_id
    LEFT JOIN public.pipeline_stages psn ON psn.id = dn.pipeline_stage_id
  )
  SELECT
    camp.id AS campaign_id,
    (SELECT count(*)::int
       FROM public.campaign_leads cl
      WHERE cl.campaign_id = camp.id)                                    AS total_leads,
    (SELECT count(*)::int
       FROM public.campaign_leads cl
      WHERE cl.campaign_id = camp.id
        AND coalesce(cl.call_attempts, 0) > 0)                          AS called_leads,
    (SELECT count(DISTINCT cf.campaign_lead_id)::int
       FROM call_facts cf
      WHERE cf.campaign_id = camp.id
        AND cf.is_contacted)                                            AS contacted_leads,
    (SELECT count(DISTINCT cf.campaign_lead_id)::int
       FROM call_facts cf
      WHERE cf.campaign_id = camp.id
        AND cf.is_converting)                                           AS converted_leads,
    (SELECT count(*)::int
       FROM public.wins w
      WHERE w.campaign_id = camp.id
        AND w.organization_id = camp.organization_id)                  AS policies_sold
  FROM camp;
$function$

;

CREATE OR REPLACE FUNCTION private.report_call_facts(p_org uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_agent_ids uuid[])
 RETURNS TABLE(call_id uuid, agent_id uuid, direction_class text, created_at timestamp with time zone, duration_seconds bigint, campaign_id uuid, campaign_lead_id uuid, converted_key text, lead_id uuid, lead_source text, disposition_key text, disposition_name text, disposition_color text, disp_counts_contacted boolean, disp_converts boolean, disp_dnc boolean, disp_callback boolean, disp_appointment boolean, is_contacted boolean, is_converting boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT
      c.id,
      c.agent_id,
      CASE
        WHEN lower(coalesce(c.direction, '')) = ANY (ARRAY['outbound', 'outgoing']) THEN 'outbound'
        WHEN lower(coalesce(c.direction, '')) = ANY (ARRAY['inbound', 'incoming'])  THEN 'inbound'
        ELSE 'other'
      END                                                     AS direction_class,
      c.created_at,
      greatest(coalesce(c.duration, 0), 0)::bigint           AS duration_seconds,
      cmp.id                                                  AS campaign_id,
      CASE WHEN cl.campaign_id = cmp.id THEN cl.id END        AS campaign_lead_id,
      c.contact_id,
      coalesce(l1.id, l2.id)                                  AS lead_id,
      coalesce(l1.lead_source, l2.lead_source)                AS raw_lead_source,
      c.disposition_id,
      c.disposition_name                                      AS raw_disposition_name,
      coalesce(di.id, dn.id)                                  AS resolved_disposition_id,
      coalesce(di.name, dn.name)                              AS resolved_disposition_name,
      coalesce(di.color, dn.color)                            AS resolved_color,
      coalesce(di.counts_as_contacted, dn.counts_as_contacted, false) AS counts_contacted,
      coalesce(ps.convert_to_client, false)                   AS converts,
      coalesce(di.dnc_auto_add, dn.dnc_auto_add, false)       AS dnc,
      coalesce(di.callback_scheduler, dn.callback_scheduler, false) AS callback,
      coalesce(di.appointment_scheduler, dn.appointment_scheduler, false) AS appointment
    FROM public.calls c
    LEFT JOIN public.dispositions di
           ON di.id = c.disposition_id
          AND di.organization_id = p_org
    LEFT JOIN public.dispositions dn
           ON c.disposition_id IS NULL
          AND c.disposition_name IS NOT NULL
          AND lower(dn.name) = lower(c.disposition_name)
          AND dn.organization_id = p_org
    LEFT JOIN public.pipeline_stages ps
           ON ps.id = coalesce(di.pipeline_stage_id, dn.pipeline_stage_id)
          AND ps.organization_id = p_org
    LEFT JOIN public.campaign_leads cl
           ON cl.id = c.campaign_lead_id
    LEFT JOIN public.campaigns cmp
           ON cmp.id = coalesce(c.campaign_id, cl.campaign_id)
          AND cmp.organization_id = p_org
    LEFT JOIN public.leads l1
           ON l1.id = c.lead_id
          AND l1.organization_id = p_org
    LEFT JOIN public.leads l2
           ON c.lead_id IS NULL
          AND l2.id = c.contact_id
          AND (c.contact_type = 'lead' OR c.contact_type IS NULL)
          AND l2.organization_id = p_org
    WHERE c.organization_id = p_org
      AND (NOT c.dialer_admission_required OR c.dialer_provider_admitted IS TRUE)
      AND NOT EXISTS (SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=p_org AND d.kind='call' AND d.duplicate_id=c.id)
      AND c.created_at >= p_start
      AND c.created_at <  p_end
      AND (p_agent_ids IS NULL OR c.agent_id = ANY (p_agent_ids))
  )
  SELECT
    b.id,
    b.agent_id,
    b.direction_class,
    b.created_at,
    b.duration_seconds,
    b.campaign_id,
    b.campaign_lead_id,
    -- Converted identity: contact first, so one person reached through two campaign_lead memberships
    -- counts once. Prefixed so ids from different tables can never collide.
    coalesce('contact:' || b.contact_id::text, 'campaign_lead:' || b.campaign_lead_id::text, 'call:' || b.id::text),
    b.lead_id,
    coalesce(nullif(btrim(b.raw_lead_source), ''), '(No source)'),
    CASE
      WHEN b.resolved_disposition_id IS NOT NULL THEN b.resolved_disposition_id::text
      WHEN nullif(btrim(b.raw_disposition_name), '') IS NOT NULL
        THEN 'name:' || lower(btrim(b.raw_disposition_name))
      ELSE 'none'
    END,
    coalesce(b.resolved_disposition_name, nullif(btrim(b.raw_disposition_name), ''), '(No disposition)'),
    coalesce(b.resolved_color, '#6B7280'),
    b.counts_contacted,
    b.converts,
    b.dnc,
    b.callback,
    b.appointment,
    -- Canonical Contacted (outbound only). No Answer is tested first, on the resolved name.
    CASE
      WHEN b.direction_class <> 'outbound' THEN false
      WHEN lower(coalesce(b.resolved_disposition_name, b.raw_disposition_name, '')) = 'no answer' THEN false
      WHEN b.duration_seconds > 45 THEN true
      WHEN b.counts_contacted THEN true
      ELSE false
    END,
    (b.direction_class = 'outbound' AND b.converts)
  FROM base b;
$function$

;

CREATE OR REPLACE FUNCTION private.performance_rows(p_orgs uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_sold_from date, p_sold_until date, p_agents uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(organization_id uuid, organization_name text, agent_id uuid, first_name text, last_name text, agent_status text, calls_made bigint, appointments_set bigint, policies_sold bigint, annualized_premium numeric, unknown_premiums bigint, talk_time_seconds bigint, recent_wins_7d bigint, estimated_duration_calls bigint, unknown_duration_calls bigint, conflicting_duration_calls bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
 WITH call_stats AS (
  SELECT c.organization_id org,c.agent_id agent,count(*) n,sum(greatest(coalesce(c.duration,0),0)) seconds,
   count(*) FILTER(WHERE c.duration_source='elapsed_estimate') estimates,
   count(*) FILTER(WHERE coalesce(c.duration_source,'legacy_unknown')='legacy_unknown' OR c.duration IS NULL) unknown_duration,
   count(*) FILTER(WHERE c.duration_conflict) conflicts
  FROM public.calls c WHERE c.organization_id=ANY(p_orgs) AND (p_agents IS NULL OR c.agent_id=ANY(p_agents)) AND c.created_at>=p_start AND c.created_at<p_end
   AND (NOT c.dialer_admission_required OR c.dialer_provider_admitted IS TRUE)
   AND lower(coalesce(c.direction,'')) IN ('outbound','outgoing')
   AND NOT EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=c.organization_id AND d.kind='call' AND d.duplicate_id=c.id)
  GROUP BY c.organization_id,c.agent_id
 ), appointment_stats AS (
  SELECT a.organization_id org,coalesce(a.created_by,a.user_id) agent,count(*) n
  FROM public.appointments a WHERE a.organization_id=ANY(p_orgs) AND (p_agents IS NULL OR coalesce(a.created_by,a.user_id)=ANY(p_agents)) AND a.created_at>=p_start AND a.created_at<p_end
   AND NOT EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=a.organization_id AND d.kind='appointment' AND d.duplicate_id=a.id)
  GROUP BY a.organization_id,coalesce(a.created_by,a.user_id)
 ), win_values AS (
  SELECT w.organization_id org,w.agent_id agent,w.sold_date,
   private.performance_sale_monthly(w,c.premium) monthly
  FROM public.wins w LEFT JOIN public.clients c ON c.id=w.contact_id AND c.organization_id=w.organization_id
  WHERE w.organization_id=ANY(p_orgs) AND (p_agents IS NULL OR w.agent_id=ANY(p_agents))
   AND w.sold_date>=least(p_sold_from,p_sold_until-7) AND w.sold_date<p_sold_until
 ), win_stats AS (
  SELECT v.org,v.agent,count(*) FILTER(WHERE v.sold_date>=p_sold_from) n,
   sum(v.monthly*12) FILTER(WHERE v.sold_date>=p_sold_from) annual,
   count(*) FILTER(WHERE v.sold_date>=p_sold_from AND v.monthly IS NULL) unknown,
   count(*) FILTER(WHERE v.sold_date>=p_sold_until-7) recent
  FROM win_values v GROUP BY v.org,v.agent
 ), subjects AS (
  SELECT p.organization_id org,p.id agent FROM public.profiles p WHERE p.organization_id=ANY(p_orgs) AND (p_agents IS NULL OR p.id=ANY(p_agents))
  UNION SELECT c.org,c.agent FROM call_stats c
  UNION SELECT a.org,a.agent FROM appointment_stats a
  UNION SELECT w.org,w.agent FROM win_stats w
 )
 SELECT s.org,o.name,s.agent,p.first_name,p.last_name,coalesce(p.status,'Unattributed'),
  coalesce(c.n,0)::bigint,coalesce(a.n,0)::bigint,coalesce(w.n,0)::bigint,coalesce(w.annual,0)::numeric,
  coalesce(w.unknown,0)::bigint,coalesce(c.seconds,0)::bigint,coalesce(w.recent,0)::bigint,coalesce(c.estimates,0)::bigint,coalesce(c.unknown_duration,0)::bigint,coalesce(c.conflicts,0)::bigint
 FROM subjects s JOIN public.organizations o ON o.id=s.org
 LEFT JOIN public.profiles p ON p.id=s.agent AND p.organization_id=s.org
 LEFT JOIN call_stats c ON c.org=s.org AND c.agent IS NOT DISTINCT FROM s.agent
 LEFT JOIN appointment_stats a ON a.org=s.org AND a.agent IS NOT DISTINCT FROM s.agent
 LEFT JOIN win_stats w ON w.org=s.org AND w.agent IS NOT DISTINCT FROM s.agent
 WHERE private.performance_require_sale_window(p_sold_from,p_sold_until)
$function$

;

CREATE OR REPLACE FUNCTION public.get_performance_details(p_kind text, p_period text, p_mode text DEFAULT 'own'::text, p_agent_id uuid DEFAULT NULL::uuid, p_asof timestamp with time zone DEFAULT now(), p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET statement_timeout TO '25s'
AS $function$
DECLARE scope record; bounds record; sale record; rows jsonb;
BEGIN
 SELECT * INTO scope FROM private.performance_scope(p_agent_id,p_mode);
 SELECT * INTO bounds FROM private.performance_bounds(scope.org,p_period,p_asof);
 SELECT * INTO sale FROM private.performance_sale_window(bounds.time_zone,p_period,bounds.end_at);
 IF p_offset IS NULL OR p_offset<0 OR p_offset>100000 THEN RAISE EXCEPTION 'Invalid detail offset' USING ERRCODE='22023'; END IF;
 IF p_kind IN ('policies_sold','premium_sold') THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO rows FROM (
   SELECT w.id,w.contact_id,'client'::text contact_type,w.contact_name,w.created_at,w.sold_date,
    coalesce(w.recorded_at,w.created_at) entered_at,w.policy_type,
    private.performance_sale_monthly(w,c.premium) premium_amount,
    12*private.performance_sale_monthly(w,c.premium) annual_premium,
    w.agent_id
   FROM public.wins w LEFT JOIN public.clients c ON c.id=w.contact_id AND c.organization_id=w.organization_id
   WHERE w.organization_id=scope.org AND (scope.agents IS NULL OR w.agent_id=ANY(scope.agents))
    AND w.sold_date>=sale.sold_from AND w.sold_date<sale.sold_until
   ORDER BY w.sold_date DESC,w.created_at DESC,w.id DESC LIMIT 20 OFFSET p_offset
  ) x;
 ELSIF p_kind='calls_today' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO rows FROM (
   SELECT c.id,c.contact_id,c.contact_type,c.contact_name,c.created_at,c.disposition_name,c.duration,c.status,c.direction
   FROM public.calls c WHERE c.organization_id=scope.org AND (scope.agents IS NULL OR c.agent_id=ANY(scope.agents))
    AND (NOT c.dialer_admission_required OR c.dialer_provider_admitted IS TRUE)
    AND c.created_at>=bounds.start_at AND c.created_at<bounds.end_at AND lower(coalesce(c.direction,'')) IN ('outbound','outgoing')
    AND NOT EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=c.organization_id AND d.kind='call' AND d.duplicate_id=c.id)
   ORDER BY c.created_at DESC,c.id DESC LIMIT 20 OFFSET p_offset
  ) x;
 ELSIF p_kind='appointments' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO rows FROM (
   SELECT a.id,a.contact_id,NULL::text contact_type,a.contact_name,a.start_time,a.status,a.type,a.title
   FROM public.appointments a WHERE a.organization_id=scope.org AND (scope.agents IS NULL OR a.user_id=ANY(scope.agents))
    AND a.status='Scheduled' AND a.start_time>=bounds.start_at AND a.start_time<bounds.calendar_end
   ORDER BY a.start_time,a.id LIMIT 20 OFFSET p_offset
  ) x;
 ELSE RAISE EXCEPTION 'Invalid detail kind' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('rows',rows,'start_at',bounds.start_at,'end_at',bounds.end_at,'workload_end',bounds.calendar_end,
  'time_zone',bounds.time_zone,'scope',scope.scope_label,'organization_id',scope.org,
  'policy_date_basis','sold_date','sold_date_from',sale.sold_from,'sold_date_through',sale.sold_until-1);
END $function$

;

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
      AND (NOT cl.dialer_admission_required OR cl.dialer_provider_admitted IS TRUE)
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

;

COMMIT;
