-- Sold Date sales reporting. Approved for development 2026-10-17; production apply needs Chris's separate approval.
-- Sales production periods use wins.sold_date: agency calendar dates for shared readers, the agent-local date
-- for the Dialer. created_at/recorded_at stay audit timestamps. No table, RLS, writer or data change.
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';

DO $guard$
DECLARE k text;
 expected constant jsonb:=jsonb_build_object(
  'private.performance_rows(uuid[],timestamptz,timestamptz,uuid[])','a8fcaed391c64ea3ad96bb7a748d177c',
  'private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz)','c6da6384fe749c5b5e18fb5b0d68284e',
  'public.get_leaderboard_snapshot(text,uuid)','6895ef2eacd8762fc2ec012f654775d6',
  'public.get_leaderboard_recent_wins(uuid)','d912b5768301e8bb00b4233ecaa60fbb',
  'public.get_performance_summary(text,text,uuid)','72ad61ca0fb903cc59667e70cd336f30',
  'public.get_performance_details(text,text,text,uuid,timestamptz,integer)','f33f867a40b1241f4191bbfb6a73577c',
  'public.get_org_leaderboard_stats(timestamptz,timestamptz)','c71440b40abbac0b5953aaaaa786f508',
  'public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)','c6cddd40cb7e85a1fab4ac565a3c7949',
  'public.get_agency_group_leaderboard(uuid,text)','0c5d586f1e3932e4a6b3523fe59ec441',
  'private.performance_bounds(uuid,text,timestamptz)','d52cfede6da1bd2f99a9a598d803cad6',
  'private.performance_scope(uuid,text)','b923259556a920ba02434ac5dc6ccd45',
  'private.performance_sale_monthly(public.wins,numeric)','51e06b46a13c3a8eec4d672bec158376',
  'private.report_agency_time_zone(uuid)','4e94e389294d20c4f342948ca149d58c',
  'private.insert_policy_sale(uuid,jsonb,text,uuid)','3f600b757802c0fa8cc1e17fa5c25575');
BEGIN
 FOR k IN SELECT jsonb_object_keys(expected) LOOP
  IF to_regprocedure(k) IS NULL OR md5(pg_get_functiondef(to_regprocedure(k)))<>expected->>k THEN
   RAISE EXCEPTION 'Sold Date reporting preimage changed: %',k; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN('public.get_leaderboard_snapshot(text,uuid)'::regprocedure,
   'public.get_leaderboard_recent_wins(uuid)'::regprocedure,'public.get_performance_summary(text,text,uuid)'::regprocedure,
   'public.get_performance_details(text,text,text,uuid,timestamptz,integer)'::regprocedure,
   'public.get_org_leaderboard_stats(timestamptz,timestamptz)'::regprocedure,
   'public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)'::regprocedure)
   AND (p.proowner<>'postgres'::regrole OR NOT p.prosecdef
    OR p.proacl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]))
 OR EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN('private.performance_rows(uuid[],timestamptz,timestamptz,uuid[])'::regprocedure,
   'private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz)'::regprocedure)
   AND (p.proowner<>'postgres'::regrole OR p.prosecdef OR p.proacl IS DISTINCT FROM '{postgres=X/postgres}'::aclitem[]))
 OR to_regprocedure('public.get_trusted_today_dialer_stats_v2(uuid,timestamptz,timestamptz,date)') IS NOT NULL
 OR to_regprocedure('private.performance_sale_window(text,text,timestamptz)') IS NOT NULL THEN
  RAISE EXCEPTION 'Sold Date reporting authorization metadata changed or already applied';
 END IF;
END $guard$;

-- Functions replaced in place keep every attribute except their body.
CREATE TEMP TABLE sold_date_replaced_meta ON COMMIT DROP AS
SELECT p.oid,jsonb_build_object('owner',p.proowner::regrole::text,'secdef',p.prosecdef,'volatile',p.provolatile,
 'strict',p.proisstrict,'parallel',p.proparallel,'lang',p.prolang,'config',p.proconfig,'acl',p.proacl::text,
 'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) meta
FROM pg_proc p WHERE p.oid IN('public.get_leaderboard_snapshot(text,uuid)'::regprocedure,
 'public.get_leaderboard_recent_wins(uuid)'::regprocedure,'public.get_performance_summary(text,text,uuid)'::regprocedure,
 'public.get_performance_details(text,text,text,uuid,timestamptz,integer)'::regprocedure,
 'public.get_org_leaderboard_stats(timestamptz,timestamptz)'::regprocedure);

-- Agency calendar windows from a frozen as-of: pure date arithmetic, so DST never moves a Sold Date.
-- Half-open [from, until); weeks start Monday.
CREATE FUNCTION private.performance_sale_window(p_zone text,p_period text,p_asof timestamptz)
RETURNS TABLE(sold_from date,sold_until date,previous_sold_from date,previous_sold_until date)
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE unit text; local_today date; local_start date;
BEGIN
 unit:=CASE p_period WHEN 'today' THEN 'day' WHEN 'day' THEN 'day' WHEN 'week' THEN 'week' WHEN 'month' THEN 'month' WHEN 'year' THEN 'year' END;
 IF unit IS NULL OR nullif(btrim(p_zone),'') IS NULL OR p_asof IS NULL THEN
  RAISE EXCEPTION 'Invalid Sold Date period' USING ERRCODE='22023'; END IF;
 local_today:=(p_asof AT TIME ZONE p_zone)::date;
 local_start:=date_trunc(unit,local_today::timestamp)::date;
 RETURN QUERY SELECT local_start,local_today+1,(local_start-('1 '||unit)::interval)::date,local_start;
END $$;
REVOKE ALL ON FUNCTION private.performance_sale_window(text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.performance_require_sale_window(p_from date,p_until date) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_from IS NULL OR p_until IS NULL OR p_until<p_from OR p_until-p_from>366 THEN
  RAISE EXCEPTION 'Invalid Sold Date window' USING ERRCODE='22023'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.performance_require_sale_window(date,date) FROM PUBLIC,anon,authenticated,service_role;

-- The browser computes the agent-local day. The server cannot know that zone, so it accepts only a date that a
-- real UTC offset (-12h..+14h) could give the window start, never one inferred from UTC alone.
CREATE FUNCTION private.dialer_sale_day_check(p_start timestamptz,p_end timestamptz,p_day date) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_day IS NULL OR p_start IS NULL OR p_end IS NULL
  OR p_end-p_start<interval '22 hours' OR p_end-p_start>interval '26 hours'
  OR p_day<((p_start AT TIME ZONE 'UTC')-interval '12 hours')::date
  OR p_day>((p_start AT TIME ZONE 'UTC')+interval '14 hours')::date
  OR p_day>((now() AT TIME ZONE 'UTC')+interval '14 hours')::date THEN
  RAISE EXCEPTION 'Invalid Dialer sale date for this local day' USING ERRCODE='22023'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.dialer_sale_day_check(timestamptz,timestamptz,date) FROM PUBLIC,anon,authenticated,service_role;

-- Calls and appointments keep their instant window. Wins count by Sold Date; recent_wins_7d covers the
-- 7 agency dates ending the day before p_sold_until. A missing or reversed window fails instead of returning zeros.
DROP FUNCTION private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz);
DROP FUNCTION private.performance_rows(uuid[],timestamptz,timestamptz,uuid[]);
CREATE FUNCTION private.performance_rows(p_orgs uuid[],p_start timestamptz,p_end timestamptz,p_sold_from date,p_sold_until date,p_agents uuid[] DEFAULT NULL)
RETURNS TABLE(organization_id uuid,organization_name text,agent_id uuid,first_name text,last_name text,agent_status text,
 calls_made bigint,appointments_set bigint,policies_sold bigint,annualized_premium numeric,unknown_premiums bigint,
 talk_time_seconds bigint,recent_wins_7d bigint,estimated_duration_calls bigint,unknown_duration_calls bigint,conflicting_duration_calls bigint)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
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
$$;
REVOKE ALL ON FUNCTION private.performance_rows(uuid[],timestamptz,timestamptz,date,date,uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.performance_summary(p_org uuid,p_agents uuid[],p_start timestamptz,p_end timestamptz,p_workload_end timestamptz,p_sold_from date,p_sold_until date)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
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
 FROM private.performance_rows(ARRAY[p_org],p_start,p_end,p_sold_from,p_sold_until,p_agents) r
$$;
REVOKE ALL ON FUNCTION private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz,date,date) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_leaderboard_snapshot(p_period text,p_group_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET statement_timeout='25s' AS $$
DECLARE orgs uuid[]; org uuid; zone text; start_at timestamptz; end_at timestamptz:=now(); result jsonb; unit text; sale record;
BEGIN
 orgs:=private.performance_orgs(p_group_id);
 SELECT p.organization_id INTO org FROM public.profiles p WHERE p.id=auth.uid();
 SELECT time_zone INTO zone FROM private.report_agency_time_zone(org);
 unit:=CASE p_period WHEN 'today' THEN 'day' WHEN 'week' THEN 'week' WHEN 'month' THEN 'month' END;
 IF unit IS NULL THEN RAISE EXCEPTION 'Invalid leaderboard period' USING ERRCODE='22023'; END IF;
 start_at:=date_trunc(unit,end_at AT TIME ZONE zone) AT TIME ZONE zone;
 SELECT * INTO sale FROM private.performance_sale_window(zone,p_period,end_at);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('agentflow:leaderboard:v1:'||org,0))
   OR(p_group_id IS NOT NULL AND NOT pg_try_advisory_xact_lock(hashtextextended('agentflow:leaderboard:group:'||p_group_id,0))) THEN
  RAISE SQLSTATE 'PT429' USING MESSAGE='Standings are busy';
 END IF;
 WITH rows AS MATERIALIZED(SELECT * FROM private.performance_rows(orgs,start_at,end_at,sale.sold_from,sale.sold_until))
 SELECT jsonb_build_object('period',p_period,'time_zone',zone,'start_at',start_at,'end_at',end_at,
  'organization_id',org,'group_id',p_group_id,'roster','active',
  'policy_date_basis','sold_date','sold_date_from',sale.sold_from,'sold_date_through',sale.sold_until-1,
  'undated_policies',(SELECT count(*) FROM public.wins w WHERE w.organization_id=ANY(orgs) AND w.sold_date IS NULL),
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.last_name,r.first_name,r.agent_id) FROM rows r WHERE r.agent_status='Active'),'[]'),
  'excluded',jsonb_build_object(
   'calls_made',coalesce((SELECT sum(r.calls_made) FROM rows r WHERE r.agent_status<>'Active'),0),
   'appointments_set',coalesce((SELECT sum(r.appointments_set) FROM rows r WHERE r.agent_status<>'Active'),0),
   'policies_sold',coalesce((SELECT sum(r.policies_sold) FROM rows r WHERE r.agent_status<>'Active'),0)
  )) INTO result;
 RETURN result;
END $$;

-- Latest recorded events first (unchanged order); each item also carries its Sold Date and true entry time.
CREATE OR REPLACE FUNCTION public.get_leaderboard_recent_wins(p_group_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET statement_timeout='25s' AS $$
DECLARE orgs uuid[]; result jsonb;
BEGIN
 orgs:=private.performance_orgs(p_group_id);
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id),'[]') INTO result FROM (
  SELECT w.id,w.agent_id,w.agent_name,w.contact_id,w.contact_name,w.campaign_name,w.policy_type,w.premium_amount,w.premium_snapshot,
   w.created_at,w.sold_date,coalesce(w.recorded_at,w.created_at) AS entered_at,w.celebrated,12*private.performance_sale_monthly(w,c.premium) AS "premiumSold",
   private.performance_sale_monthly(w,c.premium) IS NOT NULL AS premium_known
  FROM public.wins w LEFT JOIN public.clients c ON c.id=w.contact_id AND c.organization_id=w.organization_id
  WHERE w.organization_id=ANY(orgs) AND w.created_at<now()
  ORDER BY w.created_at DESC,w.id LIMIT 20
 ) x;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.get_performance_summary(p_period text DEFAULT 'month',p_mode text DEFAULT 'own',p_agent_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET statement_timeout='25s' AS $$
DECLARE scope record; bounds record; sale record; result jsonb;
BEGIN
 SELECT * INTO scope FROM private.performance_scope(p_agent_id,p_mode);
 SELECT * INTO bounds FROM private.performance_bounds(scope.org,p_period,now());
 SELECT * INTO sale FROM private.performance_sale_window(bounds.time_zone,p_period,bounds.end_at);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('agentflow:performance:summary:'||auth.uid(),0)) THEN
  RAISE SQLSTATE 'PT429' USING MESSAGE='Performance summary busy'; END IF;
 SELECT jsonb_build_object('organization_id',scope.org,'agent_ids',scope.agents,'scope',scope.scope_label,'period',p_period,
  'time_zone',bounds.time_zone,'start_at',bounds.start_at,'end_at',bounds.end_at,
  'previous_start',bounds.previous_start,'previous_end',bounds.previous_end,'workload_end',bounds.calendar_end,
  'policy_date_basis','sold_date','sold_date_from',sale.sold_from,'sold_date_through',sale.sold_until-1,
  'previous_sold_date_from',sale.previous_sold_from,'previous_sold_date_through',sale.previous_sold_until-1,
  'undated_policies',(SELECT count(*) FROM public.wins w WHERE w.organization_id=scope.org
   AND (scope.agents IS NULL OR w.agent_id=ANY(scope.agents)) AND w.sold_date IS NULL),
  'current',private.performance_summary(scope.org,scope.agents,bounds.start_at,bounds.end_at,bounds.calendar_end,sale.sold_from,sale.sold_until),
  'previous',private.performance_summary(scope.org,scope.agents,bounds.previous_start,bounds.previous_end,bounds.previous_end,sale.previous_sold_from,sale.previous_sold_until)) INTO result;
 RETURN result;
END $$;

-- Minimal details for the same source rows/scope. Never joins private contact fields.
CREATE OR REPLACE FUNCTION public.get_performance_details(p_kind text,p_period text,p_mode text DEFAULT 'own',p_agent_id uuid DEFAULT NULL,p_asof timestamptz DEFAULT now(),p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET statement_timeout='25s' AS $$
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
END $$;

-- Legacy compatibility endpoint (no current caller): same signature, ACL, guard and 35-day limit. Its instant
-- window maps to agency Sold Dates through agency today.
CREATE OR REPLACE FUNCTION public.get_org_leaderboard_stats(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(agent_id uuid, first_name text, last_name text, avatar_url text, calls_made bigint, appointments_set bigint, policies_sold bigint, annualized_premium numeric, talk_time_seconds bigint, recent_wins_7d bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_org uuid;
  v_zone text;
  v_sold_from date;
  v_sold_until date;
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

  -- Sales count by agency Sold Date; a sale dated after agency today never counts.
  SELECT z.time_zone INTO v_zone FROM private.report_agency_time_zone(v_org) z;
  v_sold_from := (p_start AT TIME ZONE v_zone)::date;
  v_sold_until := greatest(v_sold_from,
    least(((p_end - interval '1 microsecond') AT TIME ZONE v_zone)::date, (now() AT TIME ZONE v_zone)::date) + 1);

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
  FROM private.performance_rows(ARRAY[v_org],p_start,p_end,v_sold_from,v_sold_until) r WHERE r.agent_status='Active'
  ORDER BY r.last_name,r.first_name,r.agent_id;
END;
$function$;

-- Versioned Dialer header stats (D2). Calls, contacted, talk time and sessions are the legacy logic unchanged.
-- Policies Sold is the caller's own campaign wins sold on the validated agent-local date, and the echoed basis
-- lets the browser refuse any response that is not Sold Date based.
CREATE FUNCTION public.get_trusted_today_dialer_stats_v2(p_campaign_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_sale_date date)
 RETURNS TABLE(calls_made integer, contacted_calls integer, total_talk_seconds integer, policies_sold integer, session_duration_seconds integer, closed_session_duration_seconds integer, active_session_id uuid, active_session_started_at timestamp with time zone, policy_date_basis text, policy_sale_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  WITH me AS (
    SELECT a.org_id, a.uid FROM private.campaign_actor() a
  ),
  call_facts AS (
    SELECT
      coalesce(ca.duration, 0) AS duration,
      CASE
        WHEN lower(coalesce(di.name, ca.disposition_name, '')) = 'no answer'
          THEN false
        WHEN coalesce(ca.duration, 0) > 45
          THEN true
        WHEN coalesce(di.counts_as_contacted, false)
          THEN true
        WHEN ca.disposition_id IS NULL AND coalesce(dn.counts_as_contacted, false)
          THEN true
        ELSE false
      END AS is_contacted
    FROM me
    JOIN public.calls ca
      ON ca.agent_id = me.uid
     AND ca.organization_id = me.org_id
     AND ca.campaign_id = p_campaign_id
     AND ca.created_at >= p_start
     AND ca.created_at < least(p_end,now())
     AND lower(coalesce(ca.direction, '')) = ANY (ARRAY['outbound', 'outgoing'])
     AND NOT EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=ca.organization_id AND d.kind='call' AND d.duplicate_id=ca.id)
    LEFT JOIN public.dispositions di ON di.id = ca.disposition_id AND di.organization_id=me.org_id
    LEFT JOIN LATERAL (SELECT bool_or(d.counts_as_contacted) AS counts_as_contacted
      FROM public.dispositions d WHERE ca.disposition_id IS NULL
        AND lower(d.name)=lower(ca.disposition_name) AND d.organization_id=me.org_id) dn ON true
    WHERE me.org_id IS NOT NULL AND me.uid IS NOT NULL
  ),
  sess AS (
    SELECT
      s.id,
      s.started_at,
      (s.status = 'active' AND s.ended_at IS NULL) AS is_active,
      GREATEST(0, floor(extract(epoch FROM (
        least(p_end, now(), coalesce(
          s.ended_at,
          CASE
            WHEN s.status = 'active' AND s.ended_at IS NULL THEN now()
            ELSE coalesce(s.last_heartbeat_at, s.started_at)
          END
        )) - s.started_at
      )))::int) AS span
    FROM me
    JOIN public.dialer_sessions s
      ON s.agent_id = me.uid
     AND s.organization_id = me.org_id
     AND s.campaign_id = p_campaign_id
     AND s.started_at >= p_start
     AND s.started_at < least(p_end,now())
    WHERE me.org_id IS NOT NULL AND me.uid IS NOT NULL
  ),
  active_sess AS (
    SELECT id, started_at FROM sess WHERE is_active ORDER BY started_at LIMIT 1
  )
  SELECT
    (SELECT count(*)::int FROM call_facts)                                  AS calls_made,
    (SELECT count(*)::int FROM call_facts WHERE is_contacted)               AS contacted_calls,
    (SELECT coalesce(sum(duration), 0)::int FROM call_facts)                AS total_talk_seconds,
    (SELECT count(*)::int
       FROM public.wins w, me
      WHERE w.agent_id = me.uid
        AND w.organization_id = me.org_id
        AND w.campaign_id = p_campaign_id
        AND w.sold_date = p_sale_date)                                      AS policies_sold,
    (SELECT coalesce(sum(span), 0)::int FROM sess)                          AS session_duration_seconds,
    (SELECT coalesce(sum(span), 0)::int FROM sess WHERE NOT is_active)      AS closed_session_duration_seconds,
    (SELECT id FROM active_sess)                                            AS active_session_id,
    (SELECT started_at FROM active_sess)                                    AS active_session_started_at,
    'sold_date'::text                                                       AS policy_date_basis,
    p_sale_date                                                             AS policy_sale_date
  WHERE private.dialer_sale_day_check(p_start, p_end, p_sale_date);
$function$;
REVOKE ALL ON FUNCTION public.get_trusted_today_dialer_stats_v2(uuid,timestamptz,timestamptz,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_trusted_today_dialer_stats_v2(uuid,timestamptz,timestamptz,date) TO authenticated,service_role;

-- The legacy reader stays byte-identical for browser tabs opened before this release.
COMMENT ON FUNCTION public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz) IS
 'Legacy compatibility for Dialer tabs opened before the Sold Date release. policies_sold counts entry time and is not a Sold Date total; current clients use get_trusted_today_dialer_stats_v2. Drop only with separate approval once no callers remain.';

DO $verify$
DECLARE r record; after jsonb;
BEGIN
 FOR r IN SELECT m.oid,m.meta FROM pg_temp.sold_date_replaced_meta m LOOP
  SELECT jsonb_build_object('owner',p.proowner::regrole::text,'secdef',p.prosecdef,'volatile',p.provolatile,
   'strict',p.proisstrict,'parallel',p.proparallel,'lang',p.prolang,'config',p.proconfig,'acl',p.proacl::text,
   'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) INTO after FROM pg_proc p WHERE p.oid=r.oid;
  IF after IS DISTINCT FROM r.meta THEN RAISE EXCEPTION 'Sold Date reporting changed function metadata: %',r.oid::regprocedure; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_temp.sold_date_replaced_meta)<>5
  OR md5(pg_get_functiondef('public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)'::regprocedure))<>'c6cddd40cb7e85a1fab4ac565a3c7949'
  OR md5(pg_get_functiondef('public.get_agency_group_leaderboard(uuid,text)'::regprocedure))<>'0c5d586f1e3932e4a6b3523fe59ec441'
  OR (SELECT proacl FROM pg_proc WHERE oid='public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)'::regprocedure)
   IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]
  OR to_regprocedure('private.performance_rows(uuid[],timestamptz,timestamptz,uuid[])') IS NOT NULL
  OR to_regprocedure('private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz)') IS NOT NULL THEN
  RAISE EXCEPTION 'Sold Date reporting postimage check failed';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN('private.performance_rows(uuid[],timestamptz,timestamptz,date,date,uuid[])'::regprocedure,
   'private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz,date,date)'::regprocedure,
   'private.performance_sale_window(text,text,timestamptz)'::regprocedure,'private.performance_require_sale_window(date,date)'::regprocedure,
   'private.dialer_sale_day_check(timestamptz,timestamptz,date)'::regprocedure)
   AND (p.proowner<>'postgres'::regrole OR p.prosecdef OR p.proacl IS DISTINCT FROM '{postgres=X/postgres}'::aclitem[]))
 OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.get_trusted_today_dialer_stats_v2(uuid,timestamptz,timestamptz,date)'::regprocedure
   AND p.proowner='postgres'::regrole AND p.prosecdef AND p.provolatile='s'
   AND p.proacl='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]) THEN
  RAISE EXCEPTION 'Sold Date reporting new-object authorization check failed';
 END IF;
END $verify$;
