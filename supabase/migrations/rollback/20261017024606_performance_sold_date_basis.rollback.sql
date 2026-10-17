-- Guarded rollback for 20261017024606_performance_sold_date_basis and the optional 20261017024610 index.
-- Apply only with Chris's separate approval, as a NEW migration (frontend rolled back first). It restores the
-- exact preimages recorded on 2026-10-17 and removes the Sold Date objects. No data is read or written.
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
DO $guard$
DECLARE k text;
 expected constant jsonb:=jsonb_build_object(
  'public.get_leaderboard_snapshot(text,uuid)','3e3202b60101cbba591c0937465ff44f',
  'public.get_leaderboard_recent_wins(uuid)','e0abea369e13d702d75941d8f2d21cc7',
  'public.get_performance_summary(text,text,uuid)','e0227b019019cfabb4d69aea5f5523e4',
  'public.get_performance_details(text,text,text,uuid,timestamptz,integer)','ee97c105a58ae67596c7b7875b6769e1',
  'public.get_org_leaderboard_stats(timestamptz,timestamptz)','dd72a2f210f36202ff81449f8d77801f',
  'private.performance_rows(uuid[],timestamptz,timestamptz,date,date,uuid[])','994de616abf9093a01e78d50b3b7d696',
  'private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz,date,date)','fd4c2cbb1c76472bfa2bd3198ce17149',
  'public.get_trusted_today_dialer_stats_v2(uuid,timestamptz,timestamptz,date)','8d15902bc5577dbb7c3c1e91296e5740',
  'private.performance_sale_window(text,text,timestamptz)','066eddcf18f07cffd8bbb30e5b718123',
  'private.performance_require_sale_window(date,date)','cdbca70c404e6b2c82610cef5e44ac0b',
  'private.dialer_sale_day_check(timestamptz,timestamptz,date)','963e64dfa65eec56e09be2fc02df49b6',
  'public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)','c6cddd40cb7e85a1fab4ac565a3c7949');
BEGIN
 FOR k IN SELECT jsonb_object_keys(expected) LOOP
  IF to_regprocedure(k) IS NULL OR md5(pg_get_functiondef(to_regprocedure(k)))<>expected->>k THEN
   RAISE EXCEPTION 'Sold Date rollback: postimage changed or already rolled back: %',k; END IF;
 END LOOP;
END $guard$;
DROP INDEX IF EXISTS public.performance_wins_org_sold_date;

CREATE OR REPLACE FUNCTION private.performance_rows(p_orgs uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_agents uuid[] DEFAULT NULL::uuid[])
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
   AND lower(coalesce(c.direction,'')) IN ('outbound','outgoing')
   AND NOT EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=c.organization_id AND d.kind='call' AND d.duplicate_id=c.id)
  GROUP BY c.organization_id,c.agent_id
 ), appointment_stats AS (
  SELECT a.organization_id org,coalesce(a.created_by,a.user_id) agent,count(*) n
  FROM public.appointments a WHERE a.organization_id=ANY(p_orgs) AND (p_agents IS NULL OR coalesce(a.created_by,a.user_id)=ANY(p_agents)) AND a.created_at>=p_start AND a.created_at<p_end
   AND NOT EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=a.organization_id AND d.kind='appointment' AND d.duplicate_id=a.id)
  GROUP BY a.organization_id,coalesce(a.created_by,a.user_id)
 ), win_values AS (
  SELECT w.organization_id org,w.agent_id agent,w.created_at,
   private.performance_sale_monthly(w,c.premium) monthly
  FROM public.wins w LEFT JOIN public.clients c ON c.id=w.contact_id AND c.organization_id=w.organization_id
  WHERE w.organization_id=ANY(p_orgs) AND (p_agents IS NULL OR w.agent_id=ANY(p_agents)) AND w.created_at>=least(p_start,p_end-interval '7 days') AND w.created_at<p_end
 ), win_stats AS (
  SELECT v.org,v.agent,count(*) FILTER(WHERE v.created_at>=p_start) n,
   sum(v.monthly*12) FILTER(WHERE v.created_at>=p_start) annual,
   count(*) FILTER(WHERE v.created_at>=p_start AND v.monthly IS NULL) unknown,
   count(*) FILTER(WHERE v.created_at>=p_end-interval '7 days') recent
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
$function$;

REVOKE ALL ON FUNCTION private.performance_rows(uuid[],timestamptz,timestamptz,uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.performance_summary(p_org uuid, p_agents uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_workload_end timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
 SELECT jsonb_build_object('calls',coalesce(sum(r.calls_made),0),'policies',coalesce(sum(r.policies_sold),0),
  'bookings',coalesce(sum(r.appointments_set),0),'annual_premium',coalesce(sum(r.annualized_premium),0),
  'monthly_premium',coalesce(sum(r.annualized_premium),0)/12,'unknown_premiums',coalesce(sum(r.unknown_premiums),0),
  'talk_seconds',coalesce(sum(r.talk_time_seconds),0),
  'estimated_duration_calls',coalesce(sum(r.estimated_duration_calls),0),'unknown_duration_calls',coalesce(sum(r.unknown_duration_calls),0),
  'conflicting_duration_calls',coalesce(sum(r.conflicting_duration_calls),0),
  'workload',(SELECT count(*) FROM public.appointments a WHERE a.organization_id=p_org AND (p_agents IS NULL OR a.user_id=ANY(p_agents))
   AND a.status='Scheduled' AND a.start_time>=p_start AND a.start_time<p_workload_end),
  'leads',(SELECT count(*) FROM public.leads l WHERE l.organization_id=p_org AND (p_agents IS NULL OR l.assigned_agent_id=ANY(p_agents))
   AND l.created_at>=p_start AND l.created_at<p_end))
 FROM private.performance_rows(ARRAY[p_org],p_start,p_end,p_agents) r
$function$;

REVOKE ALL ON FUNCTION private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_leaderboard_snapshot(p_period text, p_group_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET statement_timeout TO '25s'
AS $function$
DECLARE orgs uuid[]; org uuid; zone text; start_at timestamptz; end_at timestamptz:=now(); result jsonb; unit text;
BEGIN
 orgs:=private.performance_orgs(p_group_id);
 SELECT p.organization_id INTO org FROM public.profiles p WHERE p.id=auth.uid();
 SELECT time_zone INTO zone FROM private.report_agency_time_zone(org);
 unit:=CASE p_period WHEN 'today' THEN 'day' WHEN 'week' THEN 'week' WHEN 'month' THEN 'month' END;
 IF unit IS NULL THEN RAISE EXCEPTION 'Invalid leaderboard period' USING ERRCODE='22023'; END IF;
 start_at:=date_trunc(unit,end_at AT TIME ZONE zone) AT TIME ZONE zone;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('agentflow:leaderboard:v1:'||org,0))
   OR(p_group_id IS NOT NULL AND NOT pg_try_advisory_xact_lock(hashtextextended('agentflow:leaderboard:group:'||p_group_id,0))) THEN
  RAISE SQLSTATE 'PT429' USING MESSAGE='Standings are busy';
 END IF;
 WITH rows AS MATERIALIZED(SELECT * FROM private.performance_rows(orgs,start_at,end_at))
 SELECT jsonb_build_object('period',p_period,'time_zone',zone,'start_at',start_at,'end_at',end_at,
  'organization_id',org,'group_id',p_group_id,'roster','active',
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.last_name,r.first_name,r.agent_id) FROM rows r WHERE r.agent_status='Active'),'[]'),
  'excluded',jsonb_build_object(
   'calls_made',coalesce((SELECT sum(r.calls_made) FROM rows r WHERE r.agent_status<>'Active'),0),
   'appointments_set',coalesce((SELECT sum(r.appointments_set) FROM rows r WHERE r.agent_status<>'Active'),0),
   'policies_sold',coalesce((SELECT sum(r.policies_sold) FROM rows r WHERE r.agent_status<>'Active'),0)
  )) INTO result;
 RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.get_leaderboard_recent_wins(p_group_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET statement_timeout TO '25s'
AS $function$
DECLARE orgs uuid[]; result jsonb;
BEGIN
 orgs:=private.performance_orgs(p_group_id);
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id),'[]') INTO result FROM (
  SELECT w.id,w.agent_id,w.agent_name,w.contact_id,w.contact_name,w.campaign_name,w.policy_type,w.premium_amount,w.premium_snapshot,
   w.created_at,w.celebrated,12*private.performance_sale_monthly(w,c.premium) AS "premiumSold",
   private.performance_sale_monthly(w,c.premium) IS NOT NULL AS premium_known
  FROM public.wins w LEFT JOIN public.clients c ON c.id=w.contact_id AND c.organization_id=w.organization_id
  WHERE w.organization_id=ANY(orgs) AND w.created_at<now()
  ORDER BY w.created_at DESC,w.id LIMIT 20
 ) x;
 RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.get_performance_summary(p_period text DEFAULT 'month'::text, p_mode text DEFAULT 'own'::text, p_agent_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET statement_timeout TO '25s'
AS $function$
DECLARE scope record; bounds record; result jsonb;
BEGIN
 SELECT * INTO scope FROM private.performance_scope(p_agent_id,p_mode);
 SELECT * INTO bounds FROM private.performance_bounds(scope.org,p_period,now());
 IF NOT pg_try_advisory_xact_lock(hashtextextended('agentflow:performance:summary:'||auth.uid(),0)) THEN
  RAISE SQLSTATE 'PT429' USING MESSAGE='Performance summary busy'; END IF;
 SELECT jsonb_build_object('organization_id',scope.org,'agent_ids',scope.agents,'scope',scope.scope_label,'period',p_period,
  'time_zone',bounds.time_zone,'start_at',bounds.start_at,'end_at',bounds.end_at,
  'previous_start',bounds.previous_start,'previous_end',bounds.previous_end,'workload_end',bounds.calendar_end,
  'current',private.performance_summary(scope.org,scope.agents,bounds.start_at,bounds.end_at,bounds.calendar_end),
  'previous',private.performance_summary(scope.org,scope.agents,bounds.previous_start,bounds.previous_end,bounds.previous_end)) INTO result;
 RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.get_performance_details(p_kind text, p_period text, p_mode text DEFAULT 'own'::text, p_agent_id uuid DEFAULT NULL::uuid, p_asof timestamp with time zone DEFAULT now(), p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET statement_timeout TO '25s'
AS $function$
DECLARE scope record; bounds record; rows jsonb;
BEGIN
 SELECT * INTO scope FROM private.performance_scope(p_agent_id,p_mode);
 SELECT * INTO bounds FROM private.performance_bounds(scope.org,p_period,p_asof);
 IF p_offset IS NULL OR p_offset<0 OR p_offset>100000 THEN RAISE EXCEPTION 'Invalid detail offset' USING ERRCODE='22023'; END IF;
 IF p_kind IN ('policies_sold','premium_sold') THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO rows FROM (
   SELECT w.id,w.contact_id,'client'::text contact_type,w.contact_name,w.created_at,w.policy_type,
    private.performance_sale_monthly(w,c.premium) premium_amount,
    12*private.performance_sale_monthly(w,c.premium) annual_premium,
    w.agent_id
   FROM public.wins w LEFT JOIN public.clients c ON c.id=w.contact_id AND c.organization_id=w.organization_id
   WHERE w.organization_id=scope.org AND (scope.agents IS NULL OR w.agent_id=ANY(scope.agents))
    AND w.created_at>=bounds.start_at AND w.created_at<bounds.end_at
   ORDER BY w.created_at DESC,w.id DESC LIMIT 20 OFFSET p_offset
  ) x;
 ELSIF p_kind='calls_today' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO rows FROM (
   SELECT c.id,c.contact_id,c.contact_type,c.contact_name,c.created_at,c.disposition_name,c.duration,c.status,c.direction
   FROM public.calls c WHERE c.organization_id=scope.org AND (scope.agents IS NULL OR c.agent_id=ANY(scope.agents))
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
  'time_zone',bounds.time_zone,'scope',scope.scope_label,'organization_id',scope.org);
END $function$;

CREATE OR REPLACE FUNCTION public.get_org_leaderboard_stats(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(agent_id uuid, first_name text, last_name text, avatar_url text, calls_made bigint, appointments_set bigint, policies_sold bigint, annualized_premium numeric, talk_time_seconds bigint, recent_wins_7d bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_org uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'get_org_leaderboard_stats: not authenticated';
  END IF;

  SELECT pr.organization_id INTO v_org
  FROM public.profiles pr
  WHERE pr.id = v_uid;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'get_org_leaderboard_stats: no organization for caller';
  END IF;

  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'get_org_leaderboard_stats: invalid date bounds';
  END IF;

  IF (p_end - p_start) > interval '35 days' THEN
    RAISE EXCEPTION 'get_org_leaderboard_stats: unreasonable date window';
  END IF;

  -- AF_LEADERBOARD_CONCURRENCY_GUARD_V1_BEGIN
  -- A busy organization receives a retryable response; it never queues behind
  -- another standings aggregate or locks CRM rows. Transaction end releases it.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('agentflow:leaderboard:v1:' || v_org::text, 0)
  ) THEN
    RAISE SQLSTATE 'PT429' USING
      MESSAGE = 'Standings are busy',
      HINT = 'Retry after the client cooldown; do not overlap refreshes.';
  END IF;
  -- AF_LEADERBOARD_CONCURRENCY_GUARD_V1_END

  -- Each source table is scanned ONCE for the whole organization/window and
  -- grouped by agent — never rescanned per profile (the LATERAL formulation
  -- this replaced re-ran every subquery once per roster row).
  RETURN QUERY
  SELECT r.agent_id,r.first_name,r.last_name,NULL::text,r.calls_made,r.appointments_set,r.policies_sold,
    r.annualized_premium,r.talk_time_seconds,r.recent_wins_7d
  FROM private.performance_rows(ARRAY[v_org],p_start,p_end) r WHERE r.agent_status='Active'
  ORDER BY r.last_name,r.first_name,r.agent_id;
END;
$function$;

DROP FUNCTION public.get_trusted_today_dialer_stats_v2(uuid,timestamptz,timestamptz,date);
COMMENT ON FUNCTION public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz) IS NULL;
DROP FUNCTION private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz,date,date);
DROP FUNCTION private.performance_rows(uuid[],timestamptz,timestamptz,date,date,uuid[]);
DROP FUNCTION private.dialer_sale_day_check(timestamptz,timestamptz,date);
DROP FUNCTION private.performance_require_sale_window(date,date);
DROP FUNCTION private.performance_sale_window(text,text,timestamptz);
DO $verify$
DECLARE k text;
 restored constant jsonb:=jsonb_build_object(
  'private.performance_rows(uuid[],timestamptz,timestamptz,uuid[])','a8fcaed391c64ea3ad96bb7a748d177c',
  'private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz)','c6da6384fe749c5b5e18fb5b0d68284e',
  'public.get_leaderboard_snapshot(text,uuid)','6895ef2eacd8762fc2ec012f654775d6',
  'public.get_leaderboard_recent_wins(uuid)','d912b5768301e8bb00b4233ecaa60fbb',
  'public.get_performance_summary(text,text,uuid)','72ad61ca0fb903cc59667e70cd336f30',
  'public.get_performance_details(text,text,text,uuid,timestamptz,integer)','f33f867a40b1241f4191bbfb6a73577c',
  'public.get_org_leaderboard_stats(timestamptz,timestamptz)','c71440b40abbac0b5953aaaaa786f508');
BEGIN
 FOR k IN SELECT jsonb_object_keys(restored) LOOP
  IF md5(pg_get_functiondef(to_regprocedure(k)))<>restored->>k THEN RAISE EXCEPTION 'Sold Date rollback: preimage not restored: %',k; END IF;
 END LOOP;
 IF md5(pg_get_functiondef('public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)'::regprocedure))<>'c6cddd40cb7e85a1fab4ac565a3c7949'
  OR obj_description('public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)'::regprocedure,'pg_proc') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN('public.get_leaderboard_snapshot(text,uuid)'::regprocedure,'public.get_leaderboard_recent_wins(uuid)'::regprocedure,
   'public.get_performance_summary(text,text,uuid)'::regprocedure,'public.get_performance_details(text,text,text,uuid,timestamptz,integer)'::regprocedure,
   'public.get_org_leaderboard_stats(timestamptz,timestamptz)'::regprocedure,'public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)'::regprocedure)
   AND (p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.proacl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]))
  OR EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN('private.performance_rows(uuid[],timestamptz,timestamptz,uuid[])'::regprocedure,
   'private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz)'::regprocedure)
   AND (p.proowner<>'postgres'::regrole OR p.prosecdef OR p.proacl IS DISTINCT FROM '{postgres=X/postgres}'::aclitem[]))
  OR to_regprocedure('public.get_trusted_today_dialer_stats_v2(uuid,timestamptz,timestamptz,date)') IS NOT NULL
  OR to_regprocedure('private.performance_sale_window(text,text,timestamptz)') IS NOT NULL
  OR to_regclass('public.performance_wins_org_sold_date') IS NOT NULL THEN
  RAISE EXCEPTION 'Sold Date rollback: restored metadata check failed';
 END IF;
END $verify$;
