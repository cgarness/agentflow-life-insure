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
