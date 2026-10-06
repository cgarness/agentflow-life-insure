SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF to_regprocedure('private.report_session_facts(uuid,timestamptz,timestamptz,uuid[])') IS NOT NULL THEN RAISE EXCEPTION 'Reports integrity: refusing replay'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.report_call_facts(uuid,timestamptz,timestamptz,uuid[])') AND md5(prosrc)='469c7b1895c44cbea7e7ca5caa412f23' AND proowner='postgres'::regrole AND provolatile='s' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports preimage or authorization drift: private.report_call_facts'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.report_session_seconds(uuid,timestamptz,timestamptz,uuid[])') AND md5(prosrc)='2dd314578b1a87bc3b86d2c74687a56c' AND proowner='postgres'::regrole AND provolatile='s' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports preimage or authorization drift: private.report_session_seconds'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.get_report_call_summary(date,date,uuid)') AND md5(prosrc)='826736e666a12d0d85ec3797b2556792' AND proowner='postgres'::regrole AND provolatile='s' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND NOT has_function_privilege('anon',oid,'EXECUTE')) THEN RAISE EXCEPTION 'Reports preimage or authorization drift: public.get_report_call_summary'; END IF;
END $guard$;

-- Read-only correction. No historical UPDATE, mapping insertion, writer or RLS changes.
-- Includes assessed stale sessions even if capping leaves no overlap, for honest quality counts.
CREATE FUNCTION private.report_session_facts(p_org uuid,p_start timestamptz,p_end timestamptz,p_agents uuid[])
RETURNS TABLE(session_id uuid,agent_id uuid,campaign_id uuid,span_start timestamptz,span_end timestamptz,stale_capped boolean,missing_evidence boolean)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT s.id,s.agent_id,s.campaign_id,greatest(s.started_at,p_start),
        least(p_end,now(),coalesce(s.ended_at,
          CASE WHEN s.status='active' AND s.last_heartbeat_at>=now()-interval '3 minutes' THEN now()
               ELSE coalesce(s.last_heartbeat_at,s.started_at) END)),
        s.ended_at IS NULL AND s.status='active' AND (s.last_heartbeat_at IS NULL OR s.last_heartbeat_at<now()-interval '3 minutes'),
        s.started_at IS NULL OR (s.ended_at IS NULL AND s.last_heartbeat_at IS NULL)
          OR coalesce(s.ended_at,s.last_heartbeat_at,s.started_at)<s.started_at
 FROM public.dialer_sessions s
 WHERE s.organization_id=p_org AND (p_agents IS NULL OR s.agent_id=ANY(p_agents))
   AND s.started_at<least(p_end,now())
   AND coalesce(s.ended_at,CASE WHEN s.status='active' THEN now() ELSE s.last_heartbeat_at END,s.started_at)>=p_start;
$$;

-- Union overlapping spans per agent before summing; simultaneous campaigns cannot create extra hours.
CREATE OR REPLACE FUNCTION private.report_session_seconds(p_org uuid,p_start timestamptz,p_end timestamptz,p_agent_ids uuid[])
RETURNS TABLE(agent_id uuid,session_seconds bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH spans AS (
  SELECT s.agent_id,range_agg(tstzrange(s.span_start,s.span_end,'[)')) AS spans
  FROM private.report_session_facts(p_org,p_start,p_end,p_agent_ids) s
  WHERE s.span_end>s.span_start GROUP BY s.agent_id
 )
 SELECT s.agent_id,floor(sum(extract(epoch FROM upper(r)-lower(r))))::bigint
 FROM spans s CROSS JOIN LATERAL unnest(s.spans) r GROUP BY s.agent_id;
$$;
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
$function$;
CREATE OR REPLACE FUNCTION public.get_report_call_summary(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL::uuid)
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
  SELECT * INTO v_access FROM private.report_access(p_agent_id);
  SELECT * INTO v_win FROM private.report_window(v_access.org_id, p_start_date, p_end_date);

  WITH f AS (
    SELECT * FROM private.report_call_facts(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids)
  ),
  -- Policies Sold = normalized STORED policies (evidence-based primary + valid additional_policies
  -- objects) whose business sale date falls on an agency calendar date of the window. Never wins.
  pol AS (
    SELECT pf.agent_id
      FROM private.report_policy_facts(v_access.org_id, v_access.agent_ids) pf
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
  pol_agg  AS (SELECT pol.agent_id, count(*) AS policies_sold    FROM pol GROUP BY pol.agent_id),
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
           coalesce(ss.session_seconds, 0)      AS session_seconds
      FROM roster r
      LEFT JOIN public.profiles p ON p.id = r.agent_id AND p.organization_id = v_access.org_id
      LEFT JOIN call_agg ca ON ca.agent_id = r.agent_id
      LEFT JOIN pol_agg  wa ON wa.agent_id = r.agent_id
      LEFT JOIN appt_agg aa ON aa.agent_id = r.agent_id
      LEFT JOIN s        ss ON ss.agent_id = r.agent_id
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
        'session_seconds',           t.session_seconds
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
                   'session_seconds',   pa.session_seconds
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
        'appointments_set',  coalesce((SELECT aa.appointments_set  FROM appt_agg aa WHERE aa.agent_id IS NULL), 0)
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

  RETURN v_result;
END;
$function$;

CREATE FUNCTION private.report_integrity_quality(p_org uuid,p_start timestamptz,p_end timestamptz,p_agents uuid[])
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 WITH c AS MATERIALIZED (
  SELECT c.id,c.duration,c.duration_source,c.duration_conflict FROM public.calls c WHERE c.organization_id=p_org AND c.created_at>=p_start AND c.created_at<p_end
    AND (p_agents IS NULL OR c.agent_id=ANY(p_agents)) AND lower(coalesce(c.direction,'')) IN ('outbound','outgoing')
 ), calls AS (
  SELECT c.* FROM c WHERE NOT EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=p_org AND d.kind='call' AND d.duplicate_id=c.id)
 ), a AS MATERIALIZED (
  SELECT a.id,a.booking_kind FROM public.appointments a WHERE a.organization_id=p_org AND a.created_at>=p_start AND a.created_at<p_end
    AND (p_agents IS NULL OR coalesce(a.created_by,a.user_id)=ANY(p_agents))
 ), bookings AS (
  SELECT a.* FROM a WHERE NOT EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=p_org AND d.kind='appointment' AND d.duplicate_id=a.id)
 ), s AS MATERIALIZED (SELECT * FROM private.report_session_facts(p_org,p_start,p_end,p_agents))
 SELECT jsonb_build_object(
  'basis','reports_integrity_v2','as_of',now(),
  'duration',jsonb_build_object('outbound_calls',(SELECT count(*) FROM calls),
    'estimated_calls',(SELECT count(*) FROM calls WHERE duration_source='elapsed_estimate'),
    'unknown_calls',(SELECT count(*) FROM calls WHERE duration_source='legacy_unknown' OR duration IS NULL),
    'conflicting_calls',(SELECT count(*) FROM calls WHERE duration_conflict)),
  'duplicates',jsonb_build_object('excluded_outbound_calls',(SELECT count(*) FROM c)-(SELECT count(*) FROM calls),
    'excluded_bookings',(SELECT count(*) FROM a)-(SELECT count(*) FROM bookings),'basis','reviewed_mappings_only'),
  'bookings',jsonb_build_object('all_types',(SELECT count(*) FROM bookings),
    'appointment_kind',(SELECT count(*) FROM bookings WHERE booking_kind='appointment'),
    'callback_kind',(SELECT count(*) FROM bookings WHERE booking_kind='callback'),
    'unknown_kind',(SELECT count(*) FROM bookings WHERE booking_kind IS NULL OR booking_kind NOT IN ('appointment','callback'))),
  'sessions',jsonb_build_object('stale_capped',(SELECT count(*) FROM s WHERE stale_capped),
    'missing_evidence',(SELECT count(*) FROM s WHERE missing_evidence),
    'overlapping_rows',(SELECT count(*) FROM s WHERE s.span_end>s.span_start AND EXISTS(
      SELECT 1 FROM s other WHERE other.session_id<>s.session_id AND other.agent_id=s.agent_id
       AND other.span_end>other.span_start AND other.span_start<s.span_end AND other.span_end>s.span_start)),
    'overlap_seconds_removed',greatest(0,(SELECT coalesce(floor(sum(extract(epoch FROM span_end-span_start))),0) FROM s WHERE span_end>span_start)
      -(SELECT coalesce(sum(session_seconds),0) FROM private.report_session_seconds(p_org,p_start,p_end,p_agents)))));
$$;
REVOKE ALL ON FUNCTION private.report_session_facts(uuid,timestamptz,timestamptz,uuid[]), private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
-- Replaced helpers retain their existing ACLs. No client can invoke a private fact reader.
REVOKE ALL ON FUNCTION private.report_call_facts(uuid,timestamptz,timestamptz,uuid[]),private.report_session_seconds(uuid,timestamptz,timestamptz,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
