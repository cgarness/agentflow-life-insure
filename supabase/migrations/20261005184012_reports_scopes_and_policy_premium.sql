SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF to_regprocedure('private.report_access_v2(text,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Reports integrity: refusing replay'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.report_access(uuid)') AND md5(prosrc)='27116a40687390dd31b93848446a2702' AND proowner='postgres'::regrole AND provolatile='s' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports preimage or authorization drift: private.report_access'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.get_report_scope()') AND md5(prosrc)='1163f59c6d2b2e32ecb88f7d5d9a3c98' AND proowner='postgres'::regrole AND provolatile='s' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports preimage or authorization drift: public.get_report_scope'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.get_report_call_volume(date,date,uuid)') AND md5(prosrc)='b4f7d891d7fb29962c86b668a1a2aee6' AND proowner='postgres'::regrole AND provolatile='s' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports preimage or authorization drift: public.get_report_call_volume'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.get_report_disposition_breakdown(date,date,uuid)') AND md5(prosrc)='ec8af7622230b39a92247a66d9c4c961' AND proowner='postgres'::regrole AND provolatile='s' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports preimage or authorization drift: public.get_report_disposition_breakdown'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.get_report_campaign_performance(date,date,uuid)') AND md5(prosrc)='843c9dd0e11dfd560d78d7d9f30f3729' AND proowner='postgres'::regrole AND provolatile='s' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports preimage or authorization drift: public.get_report_campaign_performance'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.get_report_lead_source_performance(date,date,uuid)') AND md5(prosrc)='1bee76ac701478303bdf47773090b655' AND proowner='postgres'::regrole AND provolatile='s' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports preimage or authorization drift: public.get_report_lead_source_performance'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.report_session_facts(uuid,timestamptz,timestamptz,uuid[])') AND md5(prosrc)='245c7ce4f7bf47f6347595822f70a947' AND proowner='postgres'::regrole AND prosecdef=false AND provolatile='s' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports shared-reader drift or order: private.report_session_facts'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.report_session_seconds(uuid,timestamptz,timestamptz,uuid[])') AND md5(prosrc)='3d33b720751a1913c81ad284ae6ffd43' AND proowner='postgres'::regrole AND prosecdef=true AND provolatile='s' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports shared-reader drift or order: private.report_session_seconds'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.report_call_facts(uuid,timestamp with time zone,timestamp with time zone,uuid[])') AND md5(prosrc)='bacbfd0629221957cae28ba28728c8bd' AND proowner='postgres'::regrole AND prosecdef=true AND provolatile='s' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports shared-reader drift or order: private.report_call_facts'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.get_report_call_summary(date,date,uuid)') AND md5(prosrc)='34cdfab92f6acaa5a383c743088c1720' AND proowner='postgres'::regrole AND prosecdef=true AND provolatile='s' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports shared-reader drift or order: public.get_report_call_summary'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])') AND md5(prosrc)='d330c5bea75fb160a0f55e72ed2fe191' AND proowner='postgres'::regrole AND prosecdef=false AND provolatile='s' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports shared-reader drift or order: private.report_integrity_quality'; END IF;
END $guard$;

CREATE FUNCTION private.report_access_v2(p_requested_scope text,p_agent_id uuid)
RETURNS TABLE(uid uuid,org_id uuid,actor_role text,scope text,can_export boolean,agent_ids uuid[],filter_agent_id uuid,requested_scope text,available_scopes text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record; f record; allowed text[]:=ARRAY[]::text[]; chosen text; ids uuid[]; exporting boolean;
BEGIN
 SELECT * INTO a FROM private.campaign_actor();
 IF a.is_super OR a.actor_role IN ('Admin','Super Admin') THEN
  allowed:=ARRAY['personal','team','agency']; exporting:=true;
 ELSIF a.actor_role IN ('Agent','Team Leader') THEN
  SELECT * INTO f FROM private.report_permission_flags(a.org_id,a.actor_role);
  IF NOT coalesce(f.page_access,false) THEN RAISE EXCEPTION 'reports: Reports access is not enabled' USING ERRCODE='42501'; END IF;
  IF coalesce(f.view_own,false) THEN allowed:=array_append(allowed,'personal'); END IF;
  IF coalesce(f.view_team,false) AND f.data_scope IN ('team','all') THEN allowed:=array_append(allowed,'team'); END IF;
  IF coalesce(f.view_team,false) AND f.data_scope='all' THEN allowed:=array_append(allowed,'agency'); END IF;
  exporting:=coalesce(f.can_export,false);
 END IF;
 chosen:=coalesce(p_requested_scope,allowed[cardinality(allowed)]);
 IF chosen IS NULL OR NOT(chosen=ANY(allowed)) THEN RAISE EXCEPTION 'reports: requested scope is not authorized' USING ERRCODE='42501'; END IF;
 IF chosen='personal' THEN ids:=ARRAY[a.uid];
 ELSIF chosen='team' THEN
  SELECT array_agg(d.agent_id ORDER BY d.agent_id) INTO ids FROM private.resolve_downline_ids(a.uid,a.org_id) d;
  IF ids IS NULL OR NOT(a.uid=ANY(ids)) THEN ids:=array_append(coalesce(ids,ARRAY[]::uuid[]),a.uid); END IF;
 END IF;
 IF p_agent_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_agent_id AND p.organization_id=a.org_id AND (ids IS NULL OR p.id=ANY(ids))) THEN
   RAISE EXCEPTION 'reports: agent is outside your requested scope' USING ERRCODE='42501'; END IF;
  ids:=ARRAY[p_agent_id];
 END IF;
 RETURN QUERY SELECT a.uid,a.org_id,a.actor_role,CASE chosen WHEN 'personal' THEN 'own' WHEN 'agency' THEN 'organization' ELSE 'team' END,exporting,ids,p_agent_id,chosen,allowed;
END $$;

-- Currency-tolerant current-book parser: dollars, commas, spaces and optional /mo or /month.
-- Never strips arbitrary letters/signs into a plausible number; negative/nonfinite/overflow is unknown.
CREATE FUNCTION private.report_monthly_amount(p_raw text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE t text; n numeric;
BEGIN
 t:=regexp_replace(btrim(p_raw),'[[:space:]]','','g');
 IF t IS NULL OR length(t)>80 OR t !~* '^\$?([0-9]+|[0-9]{1,3}(,[0-9]{3})+)(\.[0-9]+)?(/mo(nth)?)?$' THEN RETURN NULL; END IF;
 t:=regexp_replace(t,'(/mo(nth)?)$','','i'); t:=replace(replace(t,'$',''),',','');
 n:=t::numeric; IF n<0 OR n>999999999999 THEN RETURN NULL; END IF;
 RETURN n;
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RETURN NULL;
END $$;

CREATE FUNCTION private.report_policy_value_facts(p_org uuid,p_agents uuid[])
RETURNS TABLE(client_id uuid,agent_id uuid,source text,sold_date date,policy_id uuid,monthly_premium numeric,premium_state text)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 WITH c AS MATERIALIZED (SELECT c.* FROM public.clients c WHERE c.organization_id=p_org AND (p_agents IS NULL OR c.assigned_agent_id=ANY(p_agents))),
 facts AS (
  SELECT c.id,c.assigned_agent_id,'primary'::text source,c.sold_date,c.primary_policy_id policy_id,c.premium::text raw,
   c.premium=0 AND NOT EXISTS(SELECT 1 FROM public.wins w WHERE w.organization_id=p_org AND w.contact_id=c.id
    AND w.policy_id=c.primary_policy_id AND w.premium_snapshot AND w.premium_amount=0) AS ambiguous
  FROM c WHERE nullif(btrim(c.carrier),'') IS NOT NULL OR nullif(btrim(c.policy_number),'') IS NOT NULL OR c.premium>0 OR c.face_amount>0 OR c.sold_date IS NOT NULL
  UNION ALL
  SELECT c.id,c.assigned_agent_id,'additional',private.profile_parse_iso_date(coalesce(e.entry->>'soldDate',e.entry->>'issueDate')),
   CASE WHEN e.entry->>'policyId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (e.entry->>'policyId')::uuid END,
   e.entry->>'premiumAmount',false
  FROM c CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.custom_fields->'additional_policies')='array' THEN c.custom_fields->'additional_policies' ELSE '[]'::jsonb END) e(entry)
  WHERE jsonb_typeof(e.entry)='object'
 )
 SELECT f.id,f.assigned_agent_id,f.source,f.sold_date,f.policy_id,
  CASE WHEN NOT coalesce(f.ambiguous,false) THEN p.n END,
  CASE WHEN f.ambiguous THEN 'ambiguous_zero' WHEN nullif(btrim(f.raw),'') IS NULL THEN 'missing' WHEN p.n IS NULL THEN 'invalid' ELSE 'known' END
 FROM facts f CROSS JOIN LATERAL (SELECT private.report_monthly_amount(f.raw) n) p;
$$;

CREATE FUNCTION private.report_premium_totals(p_count bigint,p_known bigint,p_monthly numeric,p_invalid bigint,p_ambiguous bigint,p_identity_missing bigint)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('policy_count',p_count,'known_count',p_known,'unknown_count',p_count-p_known,
  'monthly_premium',CASE WHEN p_count=0 THEN 0 ELSE round(p_monthly,2) END,
  'annual_premium',CASE WHEN p_count=0 THEN 0 ELSE round(p_monthly*12,2) END,
  'average_annual_premium',CASE WHEN p_known>0 THEN round(p_monthly*12/p_known,2) END,
  'coverage_pct',CASE WHEN p_count>0 THEN round(100.0*p_known/p_count,1) END,
  'invalid_count',p_invalid,'ambiguous_zero_count',p_ambiguous,'missing_identity_count',p_identity_missing,
  'basis','current_stored_monthly_x12');
$$;
CREATE FUNCTION public.get_report_scope_v2(p_requested_scope text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_access RECORD;
  v_tz     RECORD;
  v_agents jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access_v2(p_requested_scope,NULL);
  SELECT * INTO v_tz FROM private.report_agency_time_zone(v_access.org_id);

  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',     p.id,
               'name',   private.report_agent_name(p.first_name, p.last_name),
               'status', p.status
             )
             ORDER BY lower(private.report_agent_name(p.first_name, p.last_name)), p.id
           ),
           '[]'::jsonb)
    INTO v_agents
    FROM public.profiles p
   WHERE p.organization_id = v_access.org_id
     AND (
           (v_access.agent_ids IS NULL AND coalesce(p.status, '') IS DISTINCT FROM 'Deleted')
        OR (v_access.agent_ids IS NOT NULL AND p.id = ANY (v_access.agent_ids))
         );

  RETURN jsonb_build_object(
    'scope', v_access.scope, 'requested_scope',v_access.requested_scope,'available_scopes',to_jsonb(v_access.available_scopes),'basis_version','reports_integrity_v2','as_of',now(),
    'role',             v_access.actor_role,
    'can_export',       v_access.can_export,
    'self_id',          v_access.uid,
    'time_zone',        v_tz.time_zone,
    'time_zone_source', v_tz.time_zone_source,
    'today',            (now() AT TIME ZONE v_tz.time_zone)::date,
    'max_range_days',   366,
    'agents',           v_agents
  );
END;
$function$;
CREATE FUNCTION public.get_report_call_summary_v2(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL::uuid, p_requested_scope text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_access RECORD;
  v_win    RECORD;
  v_result jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access_v2(p_requested_scope,p_agent_id);
  SELECT * INTO v_win FROM private.report_window(v_access.org_id, p_start_date, p_end_date);

  WITH f AS MATERIALIZED (
    SELECT * FROM private.report_call_facts(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids)
  ),
  -- Policies Sold = normalized STORED policies (evidence-based primary + valid additional_policies
  -- objects) whose business sale date falls on an agency calendar date of the window. Never wins.
  pol AS (
    SELECT pf.*
      FROM private.report_policy_value_facts(v_access.org_id, v_access.agent_ids) pf
     WHERE pf.sold_date >= v_win.start_date
       AND pf.sold_date <= v_win.end_date
  ),
  pq AS (
    SELECT * FROM private.report_policy_quality(v_access.org_id, v_access.agent_ids)
  ),
  ap AS (
    SELECT coalesce(a.created_by, a.user_id) AS agent_id
      FROM public.appointments a
     WHERE a.organization_id = v_access.org_id
       AND NOT EXISTS (SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=v_access.org_id AND d.kind='appointment' AND d.duplicate_id=a.id)
       AND a.created_at >= v_win.start_at
       AND a.created_at <  v_win.end_at
       AND (v_access.agent_ids IS NULL OR coalesce(a.created_by, a.user_id) = ANY (v_access.agent_ids))
  ),
  s AS (
    SELECT * FROM private.report_session_seconds(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids)
  ),
  session_cohorts AS MATERIALIZED (
    SELECT s.agent_id,s.campaign_id,range_agg(tstzrange(s.span_start,s.span_end,'[)')) spans
    FROM private.report_session_facts(v_access.org_id,v_win.start_at,v_win.end_at,v_access.agent_ids) s
    WHERE s.span_end>s.span_start AND s.campaign_id IS NOT NULL GROUP BY s.agent_id,s.campaign_id
  ), matched AS MATERIALIZED (
    SELECT f.* FROM f WHERE f.direction_class='outbound' AND EXISTS(
      SELECT 1 FROM session_cohorts s
      WHERE s.agent_id=f.agent_id AND s.campaign_id=f.campaign_id AND f.campaign_id IS NOT NULL
        AND s.spans @> f.created_at)
  ), matched_agg AS (SELECT agent_id,count(*) calls,count(*) FILTER(WHERE is_contacted) contacted,coalesce(sum(duration_seconds),0) talk FROM matched GROUP BY agent_id),
  call_agg AS (
    SELECT f.agent_id,
           count(*) FILTER (WHERE f.direction_class = 'outbound')                        AS calls_made,
           count(*) FILTER (WHERE f.direction_class = 'inbound')                         AS inbound_calls,
           count(*) FILTER (WHERE f.direction_class = 'other')                           AS other_calls,
           count(*) FILTER (WHERE f.is_contacted)                                        AS contacted,
           coalesce(sum(f.duration_seconds) FILTER (WHERE f.direction_class = 'outbound'), 0) AS talk_time_seconds,
           coalesce(sum(f.duration_seconds) FILTER (WHERE f.direction_class = 'inbound'), 0)  AS inbound_talk_seconds,
           count(DISTINCT f.converted_key) FILTER (WHERE f.is_converting)                AS converted,
           count(*) FILTER (WHERE f.direction_class = 'outbound' AND f.disp_dnc)         AS dnc_calls,
           count(*) FILTER (WHERE f.direction_class = 'outbound' AND f.disp_callback)    AS callback_calls
      FROM f
     GROUP BY f.agent_id
  ),
  pol_agg  AS (SELECT pol.agent_id, count(*) AS policies_sold, private.report_premium_totals(count(*),count(monthly_premium),sum(monthly_premium),count(*) FILTER(WHERE premium_state='invalid'),count(*) FILTER(WHERE premium_state='ambiguous_zero'),count(*) FILTER(WHERE policy_id IS NULL)) AS premium    FROM pol GROUP BY pol.agent_id),
  appt_agg AS (SELECT ap.agent_id, count(*) AS appointments_set FROM ap GROUP BY ap.agent_id),
  roster AS (
    SELECT p.id AS agent_id
      FROM public.profiles p
     WHERE p.organization_id = v_access.org_id
       AND (
             (v_access.agent_ids IS NULL AND p.status = 'Active' AND v_access.filter_agent_id IS NULL)
          OR (v_access.agent_ids IS NOT NULL AND p.id = ANY (v_access.agent_ids)
              AND coalesce(p.status, '') IS DISTINCT FROM 'Deleted')
           )
    UNION
    SELECT agent_id FROM call_agg WHERE agent_id IS NOT NULL
    UNION
    SELECT agent_id FROM pol_agg  WHERE agent_id IS NOT NULL
    UNION
    SELECT agent_id FROM appt_agg WHERE agent_id IS NOT NULL
    UNION
    SELECT agent_id FROM s        WHERE agent_id IS NOT NULL
  ),
  per_agent AS (
    SELECT r.agent_id,
           private.report_agent_name(p.first_name, p.last_name) AS name,
           p.status,
           coalesce(ca.calls_made, 0)           AS calls_made,
           coalesce(ca.inbound_calls, 0)        AS inbound_calls,
           coalesce(ca.contacted, 0)            AS contacted,
           coalesce(ca.talk_time_seconds, 0)    AS talk_time_seconds,
           coalesce(ca.converted, 0)            AS converted,
           coalesce(wa.policies_sold, 0)        AS policies_sold,
           coalesce(aa.appointments_set, 0)     AS appointments_set,
           coalesce(ss.session_seconds, 0) AS session_seconds, coalesce(wa.premium,private.report_premium_totals(0,0,0,0,0,0)) AS premium, coalesce(ma.calls,0) AS matched_calls, coalesce(ma.contacted,0) AS matched_contacted, coalesce(ma.talk,0) AS matched_talk
      FROM roster r
      LEFT JOIN public.profiles p ON p.id = r.agent_id AND p.organization_id = v_access.org_id
      LEFT JOIN call_agg ca ON ca.agent_id = r.agent_id
      LEFT JOIN pol_agg  wa ON wa.agent_id = r.agent_id
      LEFT JOIN appt_agg aa ON aa.agent_id = r.agent_id
      LEFT JOIN s ss ON ss.agent_id = r.agent_id
      LEFT JOIN matched_agg ma ON ma.agent_id=r.agent_id
  ),
  totals AS (
    SELECT
      (SELECT count(*) FROM f WHERE f.direction_class = 'outbound')                          AS calls_made,
      (SELECT count(*) FROM f WHERE f.direction_class = 'inbound')                           AS inbound_calls,
      (SELECT count(*) FROM f WHERE f.direction_class = 'other')                             AS other_calls,
      (SELECT count(*) FROM f)                                                               AS total_calls,
      (SELECT count(*) FROM f WHERE f.is_contacted)                                          AS contacted,
      (SELECT coalesce(sum(f.duration_seconds), 0) FROM f WHERE f.direction_class = 'outbound') AS talk_time_seconds,
      (SELECT coalesce(sum(f.duration_seconds), 0) FROM f WHERE f.direction_class = 'inbound')  AS inbound_talk_seconds,
      (SELECT count(DISTINCT f.converted_key) FROM f WHERE f.is_converting)                  AS converted,
      (SELECT count(*) FROM pol)                                                             AS policies_sold,
      (SELECT count(*) FROM ap)                                                              AS appointments_set,
      (SELECT count(*) FROM f WHERE f.direction_class = 'outbound' AND f.disp_dnc)           AS dnc_calls,
      (SELECT count(*) FROM f WHERE f.direction_class = 'outbound' AND f.disp_callback)      AS callback_calls,
      (SELECT coalesce(sum(s.session_seconds), 0) FROM s)                                    AS session_seconds
  )
  SELECT
    private.report_meta(v_access.scope, v_access.filter_agent_id, v_win.time_zone, v_win.time_zone_source,
                        v_win.start_date, v_win.end_date, v_win.start_at, v_win.end_at)
    || jsonb_build_object(
      'totals', jsonb_build_object(
        'calls_made',                t.calls_made,
        'inbound_calls',             t.inbound_calls,
        'other_calls',               t.other_calls,
        'total_calls',               t.total_calls,
        'contacted',                 t.contacted,
        'contact_rate_pct',          CASE WHEN t.calls_made > 0 THEN round(100.0 * t.contacted / t.calls_made, 1) END,
        'talk_time_seconds',         t.talk_time_seconds,
        'avg_talk_per_dial_seconds', CASE WHEN t.calls_made > 0 THEN round(t.talk_time_seconds::numeric / t.calls_made, 1) END,
        'inbound_talk_seconds',      t.inbound_talk_seconds,
        'converted',                 t.converted,
        'policies_sold',             t.policies_sold,
        'appointments_set',          t.appointments_set,
        'dnc_calls',                 t.dnc_calls,
        'callback_calls',            t.callback_calls,
        'session_seconds', t.session_seconds, 'premium',(SELECT private.report_premium_totals(count(*),count(monthly_premium),sum(monthly_premium),count(*) FILTER(WHERE premium_state='invalid'),count(*) FILTER(WHERE premium_state='ambiguous_zero'),count(*) FILTER(WHERE policy_id IS NULL)) FROM pol),
        'session_matched_calls',(SELECT count(*) FROM matched), 'session_matched_contacted',(SELECT count(*) FROM matched WHERE is_contacted), 'session_matched_talk_seconds',(SELECT coalesce(sum(duration_seconds),0) FROM matched), 'session_unmatched_calls',t.calls_made-(SELECT count(*) FROM matched)
      ),
      'by_agent', coalesce((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'agent_id',          pa.agent_id,
                   'name',              pa.name,
                   'status',            pa.status,
                   'calls_made',        pa.calls_made,
                   'inbound_calls',     pa.inbound_calls,
                   'contacted',         pa.contacted,
                   'contact_rate_pct',  CASE WHEN pa.calls_made > 0 THEN round(100.0 * pa.contacted / pa.calls_made, 1) END,
                   'talk_time_seconds', pa.talk_time_seconds,
                   'converted',         pa.converted,
                   'policies_sold',     pa.policies_sold,
                   'appointments_set',  pa.appointments_set,
                   'session_seconds', pa.session_seconds, 'premium',pa.premium, 'session_matched_calls',pa.matched_calls, 'session_matched_contacted',pa.matched_contacted, 'session_matched_talk_seconds',pa.matched_talk, 'session_unmatched_calls',pa.calls_made-pa.matched_calls
                 )
                 ORDER BY pa.calls_made DESC, lower(pa.name), pa.agent_id
               )
          FROM per_agent pa
      ), '[]'::jsonb),
      'unattributed', jsonb_build_object(
        'calls_made',        coalesce((SELECT ca.calls_made        FROM call_agg ca WHERE ca.agent_id IS NULL), 0),
        'inbound_calls',     coalesce((SELECT ca.inbound_calls     FROM call_agg ca WHERE ca.agent_id IS NULL), 0),
        'talk_time_seconds', coalesce((SELECT ca.talk_time_seconds FROM call_agg ca WHERE ca.agent_id IS NULL), 0),
        'policies_sold',     coalesce((SELECT wa.policies_sold     FROM pol_agg  wa WHERE wa.agent_id IS NULL), 0),
        'appointments_set', coalesce((SELECT aa.appointments_set FROM appt_agg aa WHERE aa.agent_id IS NULL),0), 'premium',(SELECT private.report_premium_totals(count(*),count(monthly_premium),sum(monthly_premium),count(*) FILTER(WHERE premium_state='invalid'),count(*) FILTER(WHERE premium_state='ambiguous_zero'),count(*) FILTER(WHERE policy_id IS NULL)) FROM pol WHERE agent_id IS NULL)
      ),
      'policy_source', 'normalized_policies',
      'policy_basis', jsonb_build_object(
        'sale_date',         'policy_sold_date',
        'agent_attribution', 'current_assignment'
      ),
      'policy_quality', (
        SELECT jsonb_build_object(
                 'basis',                         'scope_wide_all_time',
                 'undated_policies',              pq.undated_policies,
                 'malformed_additional_policies', pq.malformed_additional_policies
               )
          FROM pq
      )
    )
    INTO v_result
    FROM totals t;

  RETURN v_result || jsonb_build_object('requested_scope',v_access.requested_scope,'basis_version','reports_integrity_v2','as_of',now(),'quality',private.report_integrity_quality(v_access.org_id,v_win.start_at,v_win.end_at,v_access.agent_ids));
END;
$function$;
CREATE FUNCTION public.get_report_call_volume_v2(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL::uuid, p_requested_scope text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_access RECORD;
  v_win    RECORD;
  v_result jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access_v2(p_requested_scope,p_agent_id);
  SELECT * INTO v_win FROM private.report_window(v_access.org_id, p_start_date, p_end_date);

  WITH f AS (
    SELECT fc.*, (fc.created_at AT TIME ZONE v_win.time_zone) AS local_ts
      FROM private.report_call_facts(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids) fc
  ),
  -- A policy's sale date is already an agency CALENDAR date (a DATE, never a timestamp): it is bucketed
  -- on that date as-is, with no time-zone conversion and never by created_at.
  pol AS (
    SELECT pf.*, pf.sold_date AS local_date
      FROM private.report_policy_value_facts(v_access.org_id, v_access.agent_ids) pf
     WHERE pf.sold_date >= v_win.start_date
       AND pf.sold_date <= v_win.end_date
  ),
  pq AS (
    SELECT * FROM private.report_policy_quality(v_access.org_id, v_access.agent_ids)
  ),
  days AS (
    SELECT d::date AS local_date
      FROM generate_series(v_win.start_date::timestamp, v_win.end_date::timestamp, interval '1 day') d
  ),
  day_calls AS (
    SELECT f.local_ts::date AS local_date,
           count(*) FILTER (WHERE f.direction_class = 'outbound') AS calls_made,
           count(*) FILTER (WHERE f.is_contacted)                 AS contacted,
           count(*) FILTER (WHERE f.direction_class = 'inbound')  AS inbound_calls,
           coalesce(sum(f.duration_seconds) FILTER (WHERE f.direction_class = 'outbound'), 0) AS talk_time_seconds
      FROM f
     GROUP BY 1
  ),
  day_pols AS (SELECT pol.local_date, count(*) AS policies_sold, private.report_premium_totals(count(*),count(monthly_premium),sum(monthly_premium),count(*) FILTER(WHERE premium_state='invalid'),count(*) FILTER(WHERE premium_state='ambiguous_zero'),count(*) FILTER(WHERE policy_id IS NULL)) AS premium FROM pol GROUP BY 1),
  hours AS (SELECT h FROM generate_series(0, 23) h),
  dows  AS (SELECT d FROM generate_series(0, 6) d),
  cells AS (
    SELECT extract(dow  FROM f.local_ts)::int AS dow,
           extract(hour FROM f.local_ts)::int AS hour_of_day,
           count(*)                            AS calls_made,
           count(*) FILTER (WHERE f.is_contacted) AS contacted
      FROM f
     WHERE f.direction_class = 'outbound'
     GROUP BY 1, 2
  )
  SELECT
    private.report_meta(v_access.scope, v_access.filter_agent_id, v_win.time_zone, v_win.time_zone_source,
                        v_win.start_date, v_win.end_date, v_win.start_at, v_win.end_at)
    || jsonb_build_object(
      'by_date', (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'date',              to_char(dy.local_date, 'YYYY-MM-DD'),
                   'calls_made',        coalesce(dc.calls_made, 0),
                   'contacted',         coalesce(dc.contacted, 0),
                   'inbound_calls',     coalesce(dc.inbound_calls, 0),
                   'talk_time_seconds', coalesce(dc.talk_time_seconds, 0),
                   'policies_sold', coalesce(dw.policies_sold,0), 'premium',coalesce(dw.premium,private.report_premium_totals(0,0,0,0,0,0))
                 )
                 ORDER BY dy.local_date
               )
          FROM days dy
          LEFT JOIN day_calls dc ON dc.local_date = dy.local_date
          LEFT JOIN day_pols  dw ON dw.local_date = dy.local_date
      ),
      'by_hour', (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'hour',       hr.h,
                   'calls_made', coalesce((SELECT sum(c.calls_made) FROM cells c WHERE c.hour_of_day = hr.h), 0),
                   'contacted',  coalesce((SELECT sum(c.contacted)  FROM cells c WHERE c.hour_of_day = hr.h), 0)
                 )
                 ORDER BY hr.h
               )
          FROM hours hr
      ),
      'by_day_of_week', (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'dow',        dw.d,
                   'dow_name',   (ARRAY['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[dw.d + 1],
                   'calls_made', coalesce((SELECT sum(c.calls_made) FROM cells c WHERE c.dow = dw.d), 0),
                   'contacted',  coalesce((SELECT sum(c.contacted)  FROM cells c WHERE c.dow = dw.d), 0)
                 )
                 ORDER BY dw.d
               )
          FROM dows dw
      ),
      'heatmap', (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'dow',        dw.d,
                   'hour',       hr.h,
                   'calls_made', coalesce(cell.calls_made, 0),
                   'contacted',  coalesce(cell.contacted, 0)
                 )
                 ORDER BY dw.d, hr.h
               )
          FROM dows dw
          CROSS JOIN hours hr
          LEFT JOIN cells cell ON cell.dow = dw.d AND cell.hour_of_day = hr.h
      ),
      'policy_source', 'normalized_policies',
      'policy_quality', (
        SELECT jsonb_build_object(
                 'basis',                         'scope_wide_all_time',
                 'undated_policies',              pq.undated_policies,
                 'malformed_additional_policies', pq.malformed_additional_policies
               )
          FROM pq
      )
    )
    INTO v_result;

  RETURN v_result || jsonb_build_object('requested_scope',v_access.requested_scope,'basis_version','reports_integrity_v2','as_of',now(),'quality',private.report_integrity_quality(v_access.org_id,v_win.start_at,v_win.end_at,v_access.agent_ids));
END;
$function$;
CREATE FUNCTION public.get_report_disposition_breakdown_v2(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL::uuid, p_requested_scope text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_access RECORD;
  v_win    RECORD;
  v_result jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access_v2(p_requested_scope,p_agent_id);
  SELECT * INTO v_win FROM private.report_window(v_access.org_id, p_start_date, p_end_date);

  WITH visible_campaigns AS MATERIALIZED (
    SELECT campaign_id FROM private.report_visible_campaigns(v_access.org_id)
  ),
  f AS (
    SELECT *
      FROM private.report_call_facts(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids)
     WHERE direction_class = 'outbound'
  ),
  disp AS (
    SELECT f.disposition_key,
           max(f.disposition_name)          AS name,
           max(f.disposition_color)         AS color,
           count(*)                         AS calls,
           round(avg(f.duration_seconds), 1) AS avg_duration_seconds,
           bool_or(f.disp_counts_contacted) AS counts_as_contacted,
           bool_or(f.disp_converts)         AS converts,
           bool_or(f.disp_dnc)              AS dnc,
           bool_or(f.disp_callback)         AS callback,
           bool_or(f.disp_appointment)      AS appointment
      FROM f
     GROUP BY f.disposition_key
  ),
  by_agent AS (
    SELECT x.agent_id,
           private.report_agent_name(p.first_name, p.last_name) AS name,
           jsonb_object_agg(x.disposition_key, x.calls) AS counts,
           sum(x.calls) AS total
      FROM (SELECT f.agent_id, f.disposition_key, count(*) AS calls
              FROM f WHERE f.agent_id IS NOT NULL GROUP BY 1, 2) x
      LEFT JOIN public.profiles p ON p.id = x.agent_id AND p.organization_id = v_access.org_id
     GROUP BY x.agent_id, p.first_name, p.last_name
  ),
  by_campaign AS (
    SELECT x.campaign_id,
           max(cmp.name) AS name,
           jsonb_object_agg(x.disposition_key, x.calls) AS counts,
           sum(x.calls) AS total
      FROM (SELECT f.campaign_id, f.disposition_key, count(*) AS calls
              FROM f WHERE f.campaign_id IS NOT NULL GROUP BY 1, 2) x
      JOIN public.campaigns cmp ON cmp.id = x.campaign_id AND cmp.organization_id = v_access.org_id
      JOIN visible_campaigns vc ON vc.campaign_id = x.campaign_id
     GROUP BY x.campaign_id
  ),
  buckets AS (
    SELECT * FROM (VALUES
      (1, '0-30s',  0::bigint,   30::bigint),
      (2, '30s-1m', 30::bigint,  60::bigint),
      (3, '1-2m',   60::bigint,  120::bigint),
      (4, '2-5m',   120::bigint, 300::bigint),
      (5, '5m+',    300::bigint, NULL::bigint)
    ) v(ord, label, lo, hi)
  )
  SELECT
    private.report_meta(v_access.scope, v_access.filter_agent_id, v_win.time_zone, v_win.time_zone_source,
                        v_win.start_date, v_win.end_date, v_win.start_at, v_win.end_at)
    || jsonb_build_object(
      'total_calls', (SELECT count(*) FROM f),
      'campaign_visibility', 'caller_authorized',
      'campaign_attribution_unavailable_calls', (SELECT count(*) FROM f WHERE NOT EXISTS (
        SELECT 1 FROM visible_campaigns vc WHERE vc.campaign_id = f.campaign_id)),
      'by_disposition', coalesce((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'key',                 d.disposition_key,
                   'name',                d.name,
                   'color',               d.color,
                   'calls',               d.calls,
                   'avg_duration_seconds', d.avg_duration_seconds,
                   'counts_as_contacted', d.counts_as_contacted,
                   'converts',            d.converts,
                   'dnc',                 d.dnc,
                   'callback',            d.callback,
                   'appointment',         d.appointment
                 )
                 ORDER BY d.calls DESC, lower(d.name), d.disposition_key
               )
          FROM disp d
      ), '[]'::jsonb),
      'by_agent', coalesce((
        SELECT jsonb_agg(jsonb_build_object('agent_id', a.agent_id, 'name', a.name, 'total', a.total, 'counts', a.counts)
                         ORDER BY a.total DESC, lower(a.name), a.agent_id)
          FROM by_agent a
      ), '[]'::jsonb),
      'by_campaign', coalesce((
        SELECT jsonb_agg(jsonb_build_object('campaign_id', c.campaign_id, 'name', c.name, 'total', c.total, 'counts', c.counts)
                         ORDER BY c.total DESC, lower(c.name), c.campaign_id)
          FROM by_campaign c
      ), '[]'::jsonb),
      'duration_histogram', (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'range', b.label,
                   'calls', (SELECT count(*) FROM f
                              WHERE f.duration_seconds >= b.lo
                                AND (b.hi IS NULL OR f.duration_seconds < b.hi))
                 )
                 ORDER BY b.ord
               )
          FROM buckets b
      )
    )
    INTO v_result;

  RETURN v_result || jsonb_build_object('requested_scope',v_access.requested_scope,'basis_version','reports_integrity_v2','as_of',now(),'quality',private.report_integrity_quality(v_access.org_id,v_win.start_at,v_win.end_at,v_access.agent_ids));
END;
$function$;
CREATE FUNCTION public.get_report_campaign_performance_v2(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL::uuid, p_requested_scope text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_access RECORD;
  v_win    RECORD;
  v_result jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access_v2(p_requested_scope,p_agent_id);
  SELECT * INTO v_win FROM private.report_window(v_access.org_id, p_start_date, p_end_date);

  WITH visible_campaigns AS MATERIALIZED (
    SELECT campaign_id FROM private.report_visible_campaigns(v_access.org_id)
  ),
  f AS (
    SELECT *
      FROM private.report_call_facts(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids)
     WHERE direction_class = 'outbound'
  ),
  call_agg AS (
    SELECT f.campaign_id,
           count(*)                                                        AS calls_made,
           count(*) FILTER (WHERE f.is_contacted)                          AS contacted_calls,
           count(DISTINCT f.campaign_lead_id)                              AS leads_dialed,
           count(DISTINCT f.campaign_lead_id) FILTER (WHERE f.is_contacted)  AS contacted_leads,
           count(DISTINCT f.campaign_lead_id) FILTER (WHERE f.is_converting) AS converted_leads
      FROM f
     WHERE f.campaign_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM visible_campaigns vc WHERE vc.campaign_id = f.campaign_id)
     GROUP BY f.campaign_id
  ),
  -- In-scope normalized policies sold in the window, each carrying AT MOST ONE campaign: the client's
  -- conversion lineage (one row per client, so a join can never multiply a policy). NULL = no provable
  -- campaign; such a policy is counted in policies_attribution_unavailable and never inferred.
  pol AS (
    SELECT pf.*, vc.campaign_id
      FROM private.report_policy_value_facts(v_access.org_id, v_access.agent_ids) pf
      LEFT JOIN private.report_policy_campaign_lineage(v_access.org_id, v_access.agent_ids) l
        ON l.client_id = pf.client_id
      LEFT JOIN visible_campaigns vc ON vc.campaign_id = l.campaign_id
     WHERE pf.sold_date >= v_win.start_date
       AND pf.sold_date <= v_win.end_date
  ),
  pol_agg AS (
    SELECT pol.campaign_id, count(*) AS attributed_policies, private.report_premium_totals(count(*),count(monthly_premium),sum(monthly_premium),count(*) FILTER(WHERE premium_state='invalid'),count(*) FILTER(WHERE premium_state='ambiguous_zero'),count(*) FILTER(WHERE policy_id IS NULL)) AS premium
      FROM pol
     WHERE pol.campaign_id IS NOT NULL
     GROUP BY pol.campaign_id
  ),
  ids AS (
    SELECT campaign_id FROM call_agg UNION SELECT campaign_id FROM pol_agg
  ),
  rows_ AS (
    SELECT i.campaign_id,
           cmp.name,
           cmp.type,
           coalesce(ca.calls_made, 0)      AS calls_made,
           coalesce(ca.contacted_calls, 0) AS contacted_calls,
           coalesce(ca.leads_dialed, 0)    AS leads_dialed,
           coalesce(ca.contacted_leads, 0) AS contacted_leads,
           coalesce(ca.converted_leads, 0) AS converted_leads,
           coalesce(wa.attributed_policies, 0) AS attributed_policies, coalesce(wa.premium,private.report_premium_totals(0,0,0,0,0,0)) AS premium
      FROM ids i
      JOIN public.campaigns cmp ON cmp.id = i.campaign_id AND cmp.organization_id = v_access.org_id
      LEFT JOIN call_agg ca ON ca.campaign_id = i.campaign_id
      LEFT JOIN pol_agg  wa ON wa.campaign_id = i.campaign_id
  )
  SELECT
    private.report_meta(v_access.scope, v_access.filter_agent_id, v_win.time_zone, v_win.time_zone_source,
                        v_win.start_date, v_win.end_date, v_win.start_at, v_win.end_at)
    || jsonb_build_object(
      'campaigns', coalesce((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'campaign_id',      r.campaign_id,
                   'name',             r.name,
                   'type',             r.type,
                   'calls_made',       r.calls_made,
                   'contacted_calls',  r.contacted_calls,
                   'contact_rate_pct', CASE WHEN r.calls_made > 0 THEN round(100.0 * r.contacted_calls / r.calls_made, 1) END,
                   'leads_dialed',     r.leads_dialed,
                   'contacted_leads',  r.contacted_leads,
                   'converted_leads',  r.converted_leads,
                   'attributed_policies', r.attributed_policies, 'premium',r.premium
                 )
                 ORDER BY r.calls_made DESC, lower(r.name), r.campaign_id
               )
          FROM rows_ r
      ), '[]'::jsonb),
      'unattributed_calls', (SELECT count(*) FROM f WHERE f.campaign_id IS NULL),
      'calls_attribution_unavailable', (SELECT count(*) FROM f WHERE NOT EXISTS (
        SELECT 1 FROM visible_campaigns vc WHERE vc.campaign_id = f.campaign_id)),
      'campaign_visibility', 'caller_authorized',
      'policy_source',             'normalized_policies',
      'policy_attribution',        'conversion_lineage_only',
      'policies_in_period', (SELECT count(*) FROM pol), 'premium',(SELECT private.report_premium_totals(count(*),count(monthly_premium),sum(monthly_premium),count(*) FILTER(WHERE premium_state='invalid'),count(*) FILTER(WHERE premium_state='ambiguous_zero'),count(*) FILTER(WHERE policy_id IS NULL)) FROM pol), 'premium_attribution_unavailable',(SELECT private.report_premium_totals(count(*),count(monthly_premium),sum(monthly_premium),count(*) FILTER(WHERE premium_state='invalid'),count(*) FILTER(WHERE premium_state='ambiguous_zero'),count(*) FILTER(WHERE policy_id IS NULL)) FROM pol WHERE campaign_id IS NULL),
      'policies_attribution_unavailable', (SELECT count(*) FROM pol WHERE pol.campaign_id IS NULL)
    )
    INTO v_result;

  RETURN v_result || jsonb_build_object('requested_scope',v_access.requested_scope,'basis_version','reports_integrity_v2','as_of',now(),'quality',private.report_integrity_quality(v_access.org_id,v_win.start_at,v_win.end_at,v_access.agent_ids));
END;
$function$;
CREATE FUNCTION public.get_report_lead_source_performance_v2(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL::uuid, p_requested_scope text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_access RECORD;
  v_win    RECORD;
  v_result jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access_v2(p_requested_scope,p_agent_id);
  SELECT * INTO v_win FROM private.report_window(v_access.org_id, p_start_date, p_end_date);

  WITH f AS (
    SELECT *
      FROM private.report_call_facts(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids)
     WHERE direction_class = 'outbound'
  ),
  call_agg AS (
    SELECT f.lead_source,
           count(*)                                         AS calls_made,
           count(*) FILTER (WHERE f.is_contacted)           AS contacted_calls,
           count(DISTINCT f.lead_id)                        AS leads_dialed,
           count(DISTINCT f.lead_id) FILTER (WHERE f.is_contacted) AS contacted_leads
      FROM f
     WHERE f.lead_id IS NOT NULL
     GROUP BY f.lead_source
  ),
  new_leads AS (
    SELECT coalesce(nullif(btrim(l.lead_source), ''), '(No source)') AS lead_source,
           count(*) AS new_leads
      FROM public.leads l
     WHERE l.organization_id = v_access.org_id
       AND l.created_at >= v_win.start_at
       AND l.created_at <  v_win.end_at
       AND (v_access.agent_ids IS NULL OR l.assigned_agent_id = ANY (v_access.agent_ids))
     GROUP BY 1
  ),
  sources AS (
    SELECT lead_source FROM call_agg UNION SELECT lead_source FROM new_leads
  ),
  rows_ AS (
    SELECT s.lead_source,
           coalesce(ca.calls_made, 0)      AS calls_made,
           coalesce(ca.contacted_calls, 0) AS contacted_calls,
           coalesce(ca.leads_dialed, 0)    AS leads_dialed,
           coalesce(ca.contacted_leads, 0) AS contacted_leads,
           coalesce(nl.new_leads, 0)       AS new_leads
      FROM sources s
      LEFT JOIN call_agg  ca ON ca.lead_source = s.lead_source
      LEFT JOIN new_leads nl ON nl.lead_source = s.lead_source
  )
  SELECT
    private.report_meta(v_access.scope, v_access.filter_agent_id, v_win.time_zone, v_win.time_zone_source,
                        v_win.start_date, v_win.end_date, v_win.start_at, v_win.end_at)
    || jsonb_build_object(
      'sources', coalesce((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'lead_source',      r.lead_source,
                   'calls_made',       r.calls_made,
                   'contacted_calls',  r.contacted_calls,
                   'contact_rate_pct', CASE WHEN r.calls_made > 0 THEN round(100.0 * r.contacted_calls / r.calls_made, 1) END,
                   'leads_dialed',     r.leads_dialed,
                   'contacted_leads',  r.contacted_leads,
                   'new_leads',        r.new_leads,
                   'converted',        NULL
                 )
                 ORDER BY r.calls_made DESC, r.new_leads DESC, lower(r.lead_source)
               )
          FROM rows_ r
      ), '[]'::jsonb),
      'converted_available', false,
      'converted_unavailable_reason',
        'Conversion removes the source lead and clients carry no lead source, so conversions cannot be attributed to a lead source.',
      'unattributed_calls', (SELECT count(*) FROM f WHERE f.lead_id IS NULL)
    )
    INTO v_result;

  RETURN v_result || jsonb_build_object('requested_scope',v_access.requested_scope,'basis_version','reports_integrity_v2','as_of',now(),'quality',private.report_integrity_quality(v_access.org_id,v_win.start_at,v_win.end_at,v_access.agent_ids));
END;
$function$;

DO $acl$
DECLARE f record; old_sig text;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='private' AND p.proname IN ('report_access_v2','report_monthly_amount','report_policy_value_facts','report_premium_totals') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.oid::regprocedure);
 END LOOP;
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('get_report_scope_v2','get_report_call_summary_v2','get_report_call_volume_v2','get_report_disposition_breakdown_v2','get_report_campaign_performance_v2','get_report_lead_source_performance_v2') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.oid::regprocedure);
  old_sig:=replace(f.proname,'_v2','')||CASE WHEN f.proname='get_report_scope_v2' THEN '()' ELSE '(date,date,uuid)' END;
  IF has_function_privilege('authenticated',('public.'||old_sig)::regprocedure,'EXECUTE') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.oid::regprocedure);
  END IF;
 END LOOP;
END $acl$;
NOTIFY pgrst,'reload schema';
