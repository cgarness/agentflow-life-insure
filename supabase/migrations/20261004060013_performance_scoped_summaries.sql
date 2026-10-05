-- Separate bounded endpoint: the leaderboard's 35-day contract remains unchanged.
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
CREATE FUNCTION private.performance_scope(p_agent uuid,p_mode text)
RETURNS TABLE(org uuid,agents uuid[],scope_label text)
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor record; allowed_scope text; ids uuid[];
BEGIN
 SELECT * INTO actor FROM private.campaign_actor();
 IF p_mode NOT IN ('own','team') OR p_mode IS NULL THEN RAISE EXCEPTION 'Invalid performance scope' USING ERRCODE='22023'; END IF;
 IF p_agent IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_agent AND p.organization_id=actor.org_id)
   OR NOT coalesce(p_agent=actor.uid OR actor.actor_role IN ('Admin','Super Admin')
    OR(actor.actor_role IN ('Team Leader','Team Lead') AND public.is_ancestor_of(actor.uid,p_agent)),false) THEN
   RAISE EXCEPTION 'Agent outside permitted performance scope' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT actor.org_id,ARRAY[p_agent],'selected agent'::text; RETURN;
 END IF;
 IF p_mode='own' THEN RETURN QUERY SELECT actor.org_id,ARRAY[actor.uid],'personal'::text; RETURN; END IF;
 IF actor.actor_role IN ('Admin','Super Admin') THEN
  RETURN QUERY SELECT actor.org_id,NULL::uuid[],'agency activity (all statuses)'::text; RETURN;
 END IF;
 SELECT f.data_scope INTO allowed_scope FROM private.report_permission_flags(actor.org_id,actor.actor_role) f;
 IF allowed_scope='all' THEN RETURN QUERY SELECT actor.org_id,NULL::uuid[],'agency activity (all statuses)'::text; RETURN; END IF;
 IF allowed_scope='team' AND actor.actor_role IN ('Team Leader','Team Lead') THEN
  SELECT array_agg(p.id) INTO ids FROM public.profiles p WHERE p.organization_id=actor.org_id
   AND (p.id=actor.uid OR public.is_ancestor_of(actor.uid,p.id));
  RETURN QUERY SELECT actor.org_id,ids,'self and downline'::text; RETURN;
 END IF;
 RAISE EXCEPTION 'Team performance access denied' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION private.performance_scope(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.performance_bounds(p_org uuid,p_period text,p_asof timestamptz)
RETURNS TABLE(time_zone text,start_at timestamptz,end_at timestamptz,previous_start timestamptz,previous_end timestamptz,calendar_end timestamptz)
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE zone text; unit text; step interval; local_start timestamp;
BEGIN
 SELECT z.time_zone INTO zone FROM private.report_agency_time_zone(p_org) z;
 unit:=CASE p_period WHEN 'day' THEN 'day' WHEN 'week' THEN 'week' WHEN 'month' THEN 'month' WHEN 'year' THEN 'year' END;
 IF unit IS NULL OR p_asof IS NULL OR p_asof>now() OR p_asof<now()-interval '2 days' THEN
  RAISE EXCEPTION 'Invalid performance period or expired snapshot' USING ERRCODE='22023'; END IF;
 step:=('1 '||unit)::interval; local_start:=date_trunc(unit,p_asof AT TIME ZONE zone);
 RETURN QUERY SELECT zone,local_start AT TIME ZONE zone,p_asof,(local_start-step) AT TIME ZONE zone,
  local_start AT TIME ZONE zone,(local_start+step) AT TIME ZONE zone;
END $$;
REVOKE ALL ON FUNCTION private.performance_bounds(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.performance_summary(p_org uuid,p_agents uuid[],p_start timestamptz,p_end timestamptz,p_workload_end timestamptz)
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
 FROM private.performance_rows(ARRAY[p_org],p_start,p_end,p_agents) r
$$;
REVOKE ALL ON FUNCTION private.performance_summary(uuid,uuid[],timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_performance_summary(p_period text DEFAULT 'month',p_mode text DEFAULT 'own',p_agent_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET statement_timeout='25s' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.get_performance_summary(text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_performance_summary(text,text,uuid) TO authenticated,service_role;

-- Minimal details for the same source rows/scope. Never joins private contact fields.
CREATE FUNCTION public.get_performance_details(p_kind text,p_period text,p_mode text DEFAULT 'own',p_agent_id uuid DEFAULT NULL,p_asof timestamptz DEFAULT now(),p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET statement_timeout='25s' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.get_performance_details(text,text,text,uuid,timestamptz,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_performance_details(text,text,text,uuid,timestamptz,integer) TO authenticated,service_role;
