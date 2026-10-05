-- Approved isolated build. No historical repairs or duplicate exclusions in this migration.
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.get_org_leaderboard_stats(timestamptz,timestamptz)'::regprocedure))<>'ad7a611db564d737d1dc50a7622f3500'
 OR md5(pg_get_functiondef('public.get_agency_group_leaderboard(uuid,text)'::regprocedure))<>'8bd49ee01e0b92abd3e66548569f36bb' THEN
 RAISE EXCEPTION 'Performance reader preimage changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid IN ('public.get_org_leaderboard_stats(timestamptz,timestamptz)'::regprocedure,'public.get_agency_group_leaderboard(uuid,text)'::regprocedure)
  AND (proowner<>'postgres'::regrole OR NOT prosecdef OR has_function_privilege('anon',oid,'EXECUTE') OR NOT has_function_privilege('authenticated',oid,'EXECUTE'))) THEN
  RAISE EXCEPTION 'Performance reader authorization metadata changed'; END IF;
END $guard$;

CREATE TABLE private.performance_duplicate_rows(
 organization_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('call','appointment')),
 duplicate_id uuid NOT NULL,
 canonical_id uuid NOT NULL,
 evidence_hash text NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,kind,duplicate_id),
 CHECK(duplicate_id<>canonical_id)
);
ALTER TABLE private.performance_duplicate_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.performance_duplicate_rows FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.check_performance_duplicate() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE valid boolean;
BEGIN
 IF NEW.kind='call' THEN
  SELECT count(*)=2 INTO valid FROM public.calls WHERE organization_id=NEW.organization_id AND id=ANY(ARRAY[NEW.duplicate_id,NEW.canonical_id]);
 ELSE
  SELECT count(*)=2 INTO valid FROM public.appointments WHERE organization_id=NEW.organization_id AND id=ANY(ARRAY[NEW.duplicate_id,NEW.canonical_id]);
 END IF;
 IF NOT valid OR EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=NEW.organization_id AND d.kind=NEW.kind
  AND (d.duplicate_id=NEW.canonical_id OR d.canonical_id=NEW.duplicate_id)) THEN
  RAISE EXCEPTION 'Invalid canonical mapping; targets must be same-org and mappings cannot chain' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.check_performance_duplicate() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER performance_duplicate_guard BEFORE INSERT OR UPDATE ON private.performance_duplicate_rows
FOR EACH ROW EXECUTE FUNCTION private.check_performance_duplicate();

CREATE FUNCTION private.performance_orgs(p_group uuid DEFAULT NULL) RETURNS uuid[]
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid; result uuid[];
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
 SELECT p.organization_id INTO org FROM public.profiles p WHERE p.id=auth.uid();
 IF org IS NULL THEN RAISE EXCEPTION 'No organization for caller' USING ERRCODE='42501'; END IF;
 IF p_group IS NULL THEN RETURN ARRAY[org]; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agency_group_members m
  WHERE m.agency_group_id=p_group AND m.organization_id=org AND m.status='active') THEN
  RAISE EXCEPTION 'Not an active group member' USING ERRCODE='42501';
 END IF;
 SELECT array_agg(DISTINCT m.organization_id ORDER BY m.organization_id) INTO result
 FROM public.agency_group_members m WHERE m.agency_group_id=p_group AND m.status='active';
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.performance_orgs(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.performance_monthly(p_snapshot boolean,p_win numeric,p_client numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN amount>=0 THEN amount END FROM (
  SELECT CASE WHEN p_snapshot THEN p_win ELSE coalesce(nullif(p_win,0),nullif(p_client,0)) END amount
 ) v
$$;
REVOKE ALL ON FUNCTION private.performance_monthly(boolean,numeric,numeric) FROM PUBLIC,anon,authenticated,service_role;

-- Additional-policy legacy values must never borrow a primary client's premium.
CREATE FUNCTION private.performance_sale_monthly(p_win public.wins,p_client numeric) RETURNS numeric
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT private.performance_monthly(p_win.premium_snapshot,p_win.premium_amount,
  CASE WHEN p_win.idempotency_key ~ ':policy:[0-9]+$' OR EXISTS(SELECT 1 FROM private.policy_identities i WHERE i.policy_id=p_win.policy_id AND i.organization_id=p_win.organization_id AND i.source='additional')
   THEN NULL ELSE p_client END)
$$;
REVOKE ALL ON FUNCTION private.performance_sale_monthly(public.wins,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.performance_rows(p_orgs uuid[],p_start timestamptz,p_end timestamptz,p_agents uuid[] DEFAULT NULL)
RETURNS TABLE(organization_id uuid,organization_name text,agent_id uuid,first_name text,last_name text,agent_status text,
 calls_made bigint,appointments_set bigint,policies_sold bigint,annualized_premium numeric,unknown_premiums bigint,
 talk_time_seconds bigint,recent_wins_7d bigint,estimated_duration_calls bigint,unknown_duration_calls bigint,conflicting_duration_calls bigint)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 WITH call_stats AS (
  SELECT c.organization_id org,c.agent_id agent,count(*) n,sum(greatest(coalesce(c.duration,0),0)) seconds,
   count(*) FILTER(WHERE to_jsonb(c)->>'duration_source'='elapsed_estimate') estimates,
   count(*) FILTER(WHERE coalesce(to_jsonb(c)->>'duration_source','legacy_unknown')='legacy_unknown' OR c.duration IS NULL) unknown_duration,
   count(*) FILTER(WHERE to_jsonb(c)->>'duration_conflict'='true') conflicts
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
$$;
REVOKE ALL ON FUNCTION private.performance_rows(uuid[],timestamptz,timestamptz,uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_leaderboard_snapshot(p_period text,p_group_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET statement_timeout='25s' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.get_leaderboard_snapshot(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_snapshot(text,uuid) TO authenticated,service_role;

CREATE FUNCTION public.get_leaderboard_recent_wins(p_group_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET statement_timeout='25s' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.get_leaderboard_recent_wins(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_recent_wins(uuid) TO authenticated,service_role;

-- Compatible original org endpoint: preserve signature, authorization, guard, metadata and 35-day limit.
DO $org$
DECLARE original text; head text; marker text:=E'  RETURN QUERY\n  WITH call_stats AS (';
BEGIN
 SELECT pg_get_functiondef('public.get_org_leaderboard_stats(timestamptz,timestamptz)'::regprocedure) INTO original;
 IF position(marker IN original)=0 THEN RAISE EXCEPTION 'Original organization reader body changed'; END IF;
 head:=substring(original FROM 1 FOR position(marker IN original)-1);
 EXECUTE head || $body$  RETURN QUERY
  SELECT r.agent_id,r.first_name,r.last_name,NULL::text,r.calls_made,r.appointments_set,r.policies_sold,
    r.annualized_premium,r.talk_time_seconds,r.recent_wins_7d
  FROM private.performance_rows(ARRAY[v_org],p_start,p_end) r WHERE r.agent_status='Active'
  ORDER BY r.last_name,r.first_name,r.agent_id;
END;
$function$
$body$;
END $org$;

-- Old Group clients retain the same return columns but receive the corrected source definitions.
CREATE OR REPLACE FUNCTION public.get_agency_group_leaderboard(p_group_id uuid,p_period text DEFAULT 'month')
RETURNS TABLE(organization_id uuid,organization_name text,agent_id uuid,agent_first_name text,agent_last_name text,
 agent_avatar_url text,calls_made bigint,appointments_set bigint,policies_sold bigint,talk_time_seconds bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET statement_timeout='25s' AS $$
DECLARE snapshot jsonb;
BEGIN
 snapshot:=public.get_leaderboard_snapshot(p_period,p_group_id);
 RETURN QUERY SELECT r.organization_id,r.organization_name,r.agent_id,r.first_name,r.last_name,NULL::text,
  r.calls_made,r.appointments_set,r.policies_sold,r.talk_time_seconds
 FROM jsonb_to_recordset(snapshot->'rows') AS r(organization_id uuid,organization_name text,agent_id uuid,first_name text,last_name text,
 calls_made bigint,appointments_set bigint,policies_sold bigint,talk_time_seconds bigint);
END $$;
