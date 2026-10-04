SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF md5(pg_get_functiondef('public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)'::regprocedure))<>'477390a34331c7f0c19389a12e383374' THEN
 RAISE EXCEPTION 'Trusted dialer reader preimage changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)'::regprocedure
 AND (proowner<>'postgres'::regrole OR NOT prosecdef
 OR proacl IS DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[])) THEN
 RAISE EXCEPTION 'Trusted dialer authorization changed'; END IF;
END $$;
-- Chris approved this precise ACL amendment on 2026-10-04 at 05:46 PDT.
-- Preserve signed-in/service access; remove anonymous/public execution explicitly.
REVOKE ALL ON FUNCTION public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz) FROM PUBLIC,anon;
-- Keep the published signature; canonical exclusions affect only approved mappings.
CREATE OR REPLACE FUNCTION public.get_trusted_today_dialer_stats(p_campaign_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(calls_made integer, contacted_calls integer, total_talk_seconds integer, policies_sold integer, session_duration_seconds integer, closed_session_duration_seconds integer, active_session_id uuid, active_session_started_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
        AND w.created_at >= p_start
        AND w.created_at < least(p_end,now()))                                          AS policies_sold,
    (SELECT coalesce(sum(span), 0)::int FROM sess)                          AS session_duration_seconds,
    (SELECT coalesce(sum(span), 0)::int FROM sess WHERE NOT is_active)      AS closed_session_duration_seconds,
    (SELECT id FROM active_sess)                                            AS active_session_id,
    (SELECT started_at FROM active_sess)                                    AS active_session_started_at;
$function$;
