-- =====================================================================================================
-- PREIMAGE RESTORATION FIXTURE for 20260930120000_reports_policies_sold_normalized_source.sql
-- =====================================================================================================
-- THIS IS NOT A STANDALONE PRODUCTION ROLLBACK. Restoring the win-based bodies while Reports is enabled
-- would let an older browser tab (which does not require policy_source) render COUNT(wins) as policy
-- totals. The only approved recovery order (implementation_plan.md §20.11.4), each step a NEW migration
-- with Chris's separate approval:
--   (a) supabase/ops/reports_disable.sql   — every get_report_* unavailable to clients; legacy sealed;
--   (b) THIS FILE, only if a semantic rollback is really needed — it REFUSES unless (a) is in force,
--       restores the three applied 20260929152553 bodies verbatim, drops the three policy helpers, and
--       leaves Reports DISABLED;
--   (c) supabase/ops/reports_enable.sql   — refuses while these win-based bodies are installed, so
--       Reports can only be re-enabled after the forward migration is re-applied (it preserves the
--       disabled ACL it finds) and verified.
-- The legacy public.rpc_report_* functions stay sealed throughout; nothing here grants anything.
-- Tested end to end on a disposable local database by scripts/run_reports_rpc_tests.sh.
-- =====================================================================================================

SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_expected constant jsonb := pg_catalog.jsonb_build_object(
    'public.get_report_call_summary(date,date,uuid)',         '826736e666a12d0d85ec3797b2556792',
    'public.get_report_call_volume(date,date,uuid)',          'b4f7d891d7fb29962c86b668a1a2aee6',
    'public.get_report_campaign_performance(date,date,uuid)', 'ad2e005906f5d38dc1ee0308ad368f04'
  );
  v_sig text;
  v_md5 text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_report_scope()',
    'public.get_report_call_summary(date,date,uuid)',
    'public.get_report_call_volume(date,date,uuid)',
    'public.get_report_disposition_breakdown(date,date,uuid)',
    'public.get_report_campaign_performance(date,date,uuid)',
    'public.get_report_lead_source_performance(date,date,uuid)'
  ] LOOP
    IF pg_catalog.to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'reports policy fixture: % is missing; refusing', v_sig;
    END IF;
    IF pg_catalog.has_function_privilege('authenticated', v_sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'reports policy fixture: Reports must be DISABLED first (supabase/ops/reports_disable.sql): % is client-executable; refusing', v_sig;
    END IF;
  END LOOP;
  FOR v_sig, v_md5 IN SELECT e.key, e.value #>> '{}' FROM pg_catalog.jsonb_each(v_expected) e LOOP
    IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig)) <> v_md5 THEN
      RAISE EXCEPTION 'reports policy fixture: % is not the audited policy-based body; refusing', v_sig;
    END IF;
  END LOOP;
END
$guard$;

CREATE OR REPLACE FUNCTION public.get_report_call_summary(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
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
  w AS (
    SELECT wn.agent_id
      FROM public.wins wn
     WHERE wn.organization_id = v_access.org_id
       AND wn.created_at >= v_win.start_at
       AND wn.created_at <  v_win.end_at
       AND (v_access.agent_ids IS NULL OR wn.agent_id = ANY (v_access.agent_ids))
  ),
  ap AS (
    SELECT coalesce(a.created_by, a.user_id) AS agent_id
      FROM public.appointments a
     WHERE a.organization_id = v_access.org_id
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
  win_agg  AS (SELECT w.agent_id,  count(*) AS policies_sold    FROM w  GROUP BY w.agent_id),
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
    SELECT agent_id FROM win_agg  WHERE agent_id IS NOT NULL
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
      LEFT JOIN win_agg  wa ON wa.agent_id = r.agent_id
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
      (SELECT count(*) FROM w)                                                               AS policies_sold,
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
        'policies_sold',     coalesce((SELECT wa.policies_sold     FROM win_agg  wa WHERE wa.agent_id IS NULL), 0),
        'appointments_set',  coalesce((SELECT aa.appointments_set  FROM appt_agg aa WHERE aa.agent_id IS NULL), 0)
      )
    )
    INTO v_result
    FROM totals t;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_report_call_volume(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_access RECORD;
  v_win    RECORD;
  v_result jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access(p_agent_id);
  SELECT * INTO v_win FROM private.report_window(v_access.org_id, p_start_date, p_end_date);

  WITH f AS (
    SELECT fc.*, (fc.created_at AT TIME ZONE v_win.time_zone) AS local_ts
      FROM private.report_call_facts(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids) fc
  ),
  w AS (
    SELECT (wn.created_at AT TIME ZONE v_win.time_zone)::date AS local_date
      FROM public.wins wn
     WHERE wn.organization_id = v_access.org_id
       AND wn.created_at >= v_win.start_at
       AND wn.created_at <  v_win.end_at
       AND (v_access.agent_ids IS NULL OR wn.agent_id = ANY (v_access.agent_ids))
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
  day_wins AS (SELECT w.local_date, count(*) AS policies_sold FROM w GROUP BY 1),
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
                   'policies_sold',     coalesce(dw.policies_sold, 0)
                 )
                 ORDER BY dy.local_date
               )
          FROM days dy
          LEFT JOIN day_calls dc ON dc.local_date = dy.local_date
          LEFT JOIN day_wins  dw ON dw.local_date = dy.local_date
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
      )
    )
    INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_report_campaign_performance(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_access RECORD;
  v_win    RECORD;
  v_result jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access(p_agent_id);
  SELECT * INTO v_win FROM private.report_window(v_access.org_id, p_start_date, p_end_date);

  WITH f AS (
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
     GROUP BY f.campaign_id
  ),
  win_agg AS (
    SELECT wn.campaign_id, count(*) AS policies_sold
      FROM public.wins wn
      JOIN public.campaigns cmp ON cmp.id = wn.campaign_id AND cmp.organization_id = v_access.org_id
     WHERE wn.organization_id = v_access.org_id
       AND wn.created_at >= v_win.start_at
       AND wn.created_at <  v_win.end_at
       AND (v_access.agent_ids IS NULL OR wn.agent_id = ANY (v_access.agent_ids))
     GROUP BY wn.campaign_id
  ),
  ids AS (
    SELECT campaign_id FROM call_agg UNION SELECT campaign_id FROM win_agg
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
           coalesce(wa.policies_sold, 0)   AS policies_sold
      FROM ids i
      JOIN public.campaigns cmp ON cmp.id = i.campaign_id AND cmp.organization_id = v_access.org_id
      LEFT JOIN call_agg ca ON ca.campaign_id = i.campaign_id
      LEFT JOIN win_agg  wa ON wa.campaign_id = i.campaign_id
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
                   'policies_sold',    r.policies_sold
                 )
                 ORDER BY r.calls_made DESC, lower(r.name), r.campaign_id
               )
          FROM rows_ r
      ), '[]'::jsonb),
      'unattributed_calls', (SELECT count(*) FROM f WHERE f.campaign_id IS NULL)
    )
    INTO v_result;

  RETURN v_result;
END;
$$;

DROP FUNCTION private.report_policy_campaign_lineage(uuid, uuid[]);
DROP FUNCTION private.report_policy_quality(uuid, uuid[]);
DROP FUNCTION private.report_policy_facts(uuid, uuid[]);

DO $post$
DECLARE
  v_sig text;
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_report_call_summary(date,date,uuid)'::pg_catalog.regprocedure) <> 'f221e1d470fc70ec92937be66be56e69'
     OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_report_call_volume(date,date,uuid)'::pg_catalog.regprocedure) <> '604abca3774fc10daa2c86faa9ff7524'
     OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_report_campaign_performance(date,date,uuid)'::pg_catalog.regprocedure) <> '9d151bf9ce31bd602af8317f2dd8e124' THEN
    RAISE EXCEPTION 'reports policy fixture: restored bodies do not match the 20260929152553 preimage';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_report_scope()',
    'public.get_report_call_summary(date,date,uuid)',
    'public.get_report_call_volume(date,date,uuid)',
    'public.get_report_disposition_breakdown(date,date,uuid)',
    'public.get_report_campaign_performance(date,date,uuid)',
    'public.get_report_lead_source_performance(date,date,uuid)',
    'public.rpc_report_call_summary(uuid,timestamptz,timestamptz,uuid)',
    'public.rpc_report_call_volume_timeseries(uuid,timestamptz,timestamptz,uuid)',
    'public.rpc_report_campaign_performance(uuid,timestamptz,timestamptz,uuid)',
    'public.rpc_report_disposition_breakdown(uuid,timestamptz,timestamptz,uuid)'
  ] LOOP
    IF pg_catalog.has_function_privilege('authenticated', v_sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'reports policy fixture: % became client-executable; Reports must stay disabled', v_sig;
    END IF;
  END LOOP;
END
$post$;
