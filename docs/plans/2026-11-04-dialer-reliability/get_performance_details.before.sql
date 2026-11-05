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
