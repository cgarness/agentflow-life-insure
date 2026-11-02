-- =====================================================================================================
-- Reports V2, PKG-A file 6 of 8: the nine v3 readers (plan §2.1, §2.4, §2.9, §2.10; D1 §3.1–§3.7; D3 §3.7;
-- D4 §3.1; D5 §3.4–§3.7).
--
-- PLACEHOLDER VERSION. Renumbered above the then-current production head, order kept, in a
-- filename-only commit before the PKG-A backend merge. Branch work only: not applied to production.
--
-- Privilege class C (plan §2.8): every function is created sealed (REVOKE ALL from PUBLIC, anon,
-- authenticated and service_role) and nothing is granted. The readers become executable only through the
-- separately approved class E enable (…17), which is not part of this file. No data is written, no RLS
-- setting or policy changes, and the v2 readers and legacy rpc_report_* functions are untouched.
--
-- Readers (LANGUAGE plpgsql STABLE SECURITY DEFINER, owner postgres, search_path pg_catalog, pg_temp). None
-- takes an organization, time zone or as_of argument; as_of = now(). Each windowed reader runs, in order:
--   1. private.report_access_v2(p_requested_scope, p_agent_id)   42501; NULL never widens, an agent only narrows
--   2. private.report_window(org, start, end)                    22023, then 55000
--   3. compute, with every population credit-scoped to the resolved agent_ids
--
--   get_report_scope_v3                    the scope gate: the scope_v2 fields, mirrored, plus v3 meta
--   get_report_summary_v3                  KPIs 1–11, 24, 25, 34; by_agent; production_by_date; call_population
--   get_report_journey_v3                  KPIs 14, 19, 21, 38; by_agent (★1 pending: the proposed option (a))
--   get_report_sales_appointments_v3       KPIs 12, 15–18 from the PKG-A stub (evidence_not_captured); by_agent
--   get_report_state_breakdown_v3          recorded-state split of KPIs 5, 6, 2, 1 (51 jurisdictions, 6 unmapped)
--   get_report_call_volume_v3              heatmap, by_date, by_hour, by_weekday, inbound_calls
--   get_report_disposition_breakdown_v3    outcomes, duration buckets, scoped deep dive
--   get_report_campaign_calls_v3           visible campaigns + "Calls without a campaign" + "Other campaigns"
--   get_report_lead_source_calls_v3        sources + "Not linked to a current lead"
--
-- Internal helpers (private, SECURITY INVOKER, sealed): report_v3_roster, report_v3_credit_map,
-- report_v3_agent_call_stats, report_v3_session_quality, report_v3_summary_metrics.
--
-- ★1 and ★4 are pending: the linked-history effects E1–E6 (including E4's campaign-copy fallback) are the
-- proposed branch design only. No agency-only fallback is implemented.
-- =====================================================================================================
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE f record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE (n.nspname = 'public' AND p.proname LIKE 'get\_report\_%\_v3')
                 OR (n.nspname = 'private' AND p.proname IN ('report_v3_roster', 'report_v3_credit_map',
                     'report_v3_agent_call_stats', 'report_v3_session_quality', 'report_v3_summary_metrics'))) THEN
    RAISE EXCEPTION 'Reports v3 readers: refusing replay; v3 readers already exist';
  END IF;
  IF to_regprocedure('private.report_v3_envelope(text,text,text,uuid,text,text,date,date,timestamptz,timestamptz)') IS NULL
     OR to_regprocedure('private.report_v3_production(uuid,uuid[],date,date,timestamptz)') IS NULL
     OR to_regprocedure('private.report_v3_journey_facts(uuid,uuid[],text,timestamptz,timestamptz,date,date,timestamptz)') IS NULL
     OR to_regprocedure('private.report_v3_call_kpis(jsonb,numeric)') IS NULL
     OR to_regprocedure('private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)') IS NULL
     OR to_regprocedure('private.report_v3_identity_states(uuid,text[])') IS NULL THEN
    RAISE EXCEPTION 'Reports v3 readers: the helpers (…10 to …14) must be applied first';
  END IF;
  -- The 15 v2 pins and the 12 closure helpers, re-verified as in …10 (D1 §3.10).
  FOR f IN SELECT * FROM (VALUES
    ('private.report_session_facts(uuid,timestamptz,timestamptz,uuid[])', '245c7ce4f7bf47f6347595822f70a947', false, 's'),
    ('private.report_session_seconds(uuid,timestamptz,timestamptz,uuid[])', '3d33b720751a1913c81ad284ae6ffd43', true, 's'),
    ('private.report_call_facts(uuid,timestamptz,timestamptz,uuid[])', 'bacbfd0629221957cae28ba28728c8bd', true, 's'),
    ('public.get_report_call_summary(date,date,uuid)', '34cdfab92f6acaa5a383c743088c1720', true, 's'),
    ('private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])', 'c1355d551fba0cc2217150f5531d1b31', false, 's'),
    ('private.report_access_v2(text,uuid)', 'a221335ae305cee01097bc796d5e7cdd', true, 's'),
    ('private.report_monthly_amount(text)', '405647c4982f4b9475f834efa6f2beee', false, 'i'),
    ('private.report_policy_value_facts(uuid,uuid[])', 'f543eeb4ee5aa7906e3225527d873935', false, 's'),
    ('private.report_premium_totals(bigint,bigint,numeric,bigint,bigint,bigint)', '31dcd20548aea901f074a5fd9526518c', false, 'i'),
    ('public.get_report_scope_v2(text)', '26a2d64831975668a492dfda2e369aac', true, 's'),
    ('public.get_report_call_summary_v2(date,date,uuid,text)', '23c21fa14b07edaeaa3901e76b243d66', true, 's'),
    ('public.get_report_call_volume_v2(date,date,uuid,text)', 'a4a5e82f36e124fa8ee9d581229ef455', true, 's'),
    ('public.get_report_disposition_breakdown_v2(date,date,uuid,text)', 'ae4611201b9add696bfd92f4576fdd7b', true, 's'),
    ('public.get_report_campaign_performance_v2(date,date,uuid,text)', '8d8bee228b2bed67076e2547f506264d', true, 's'),
    ('public.get_report_lead_source_performance_v2(date,date,uuid,text)', '8d85fff93300966502964b500eb46166', true, 's'),
    ('private.report_window(uuid,date,date)', '1107da185bfc1a3089b27e125c74646d', true, 's'),
    ('private.report_meta(text,uuid,text,text,date,date,timestamptz,timestamptz)', '6faa38495ac0bbd2d837c4c959cada25', false, 's'),
    ('private.report_agent_name(text,text)', '23d45e5c19d951d0d663c629ed85c945', false, 's'),
    ('private.report_visible_campaigns(uuid)', '1e37cb4b2b2a0696e129523b096a400f', false, 's'),
    ('private.report_policy_quality(uuid,uuid[])', 'cb7596ab38f91c765f869cccebf8a4ee', false, 's'),
    ('private.report_policy_facts(uuid,uuid[])', 'c902d5d2906d42dd85adb34dd524b9a7', false, 's'),
    ('private.report_policy_campaign_lineage(uuid,uuid[])', 'b99cd74ed7ab519a2ec180160e8cdfd5', false, 's'),
    ('private.report_agency_time_zone(uuid)', '27feaed00c03895fce8bfd6b2cd24207', true, 's'),
    ('private.report_permission_flags(uuid,text)', 'ba6abec7565525217b61f1a342123b65', true, 's'),
    ('private.campaign_actor()', '16cca1989b7648593f90244786d60958', true, 's'),
    ('private.resolve_downline_ids(uuid,uuid)', '4f760d7bc7bef6231176b3624ffd00b8', true, 's'),
    ('private.profile_parse_iso_date(text)', 'be24ed08bb42a71b29e3c44abebfd0c9', false, 'i')
  ) AS expected(signature, body_md5, is_definer, volatility) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure(f.signature)
                     AND md5(prosrc) = f.body_md5 AND proowner = 'postgres'::regrole AND prosecdef = f.is_definer
                     AND provolatile::text = f.volatility AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
      RAISE EXCEPTION 'Reports v3 readers: v2 or closure preimage drift: %', f.signature;
    END IF;
  END LOOP;
  -- Snapshot of every client EXECUTE on a report function; the postcondition proves this file adds none.
  PERFORM set_config('reports_v3.client_report_acl', coalesce((
    SELECT string_agg(p.oid::regprocedure::text || ':' || r, ',' ORDER BY p.oid::regprocedure::text, r)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
     WHERE ((n.nspname = 'private' AND p.proname LIKE 'report\_%')
            OR (n.nspname = 'public' AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'rpc\_report\_%')))
       AND has_function_privilege(r, p.oid, 'EXECUTE')), ''), true);
END $preflight$;

-- -----------------------------------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------------------------------

-- The by_agent roster (D1 §3.5, as v2 20261006043738:206-222): rows exist only for agents in agent_ids; at
-- unfiltered agency scope they are the Active profiles plus any credited agent.
CREATE FUNCTION private.report_v3_roster(p_org uuid, p_agent_ids uuid[], p_filter_agent uuid, p_credited uuid[])
RETURNS TABLE (agent_id uuid, name text, status text)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH ids AS (
    SELECT p.id FROM public.profiles p
     WHERE p.organization_id = p_org
       AND ((p_agent_ids IS NULL AND p.status = 'Active' AND p_filter_agent IS NULL)
            OR (p_agent_ids IS NOT NULL AND p.id = ANY (p_agent_ids) AND coalesce(p.status, '') IS DISTINCT FROM 'Deleted'))
    UNION
    SELECT c.id FROM unnest(p_credited) AS c(id)
     WHERE c.id IS NOT NULL AND (p_agent_ids IS NULL OR c.id = ANY (p_agent_ids))
  )
  SELECT i.id, private.report_agent_name(p.first_name, p.last_name), p.status
    FROM ids i LEFT JOIN public.profiles p ON p.id = i.id AND p.organization_id = p_org;
$$;

-- The per-KPI credit map of a reader's by_agent rows, from the metric registry (X5).
CREATE FUNCTION private.report_v3_credit_map(p_reader text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(jsonb_object_agg(r ->> 'id', r ->> 'credit'), '{}'::jsonb)
    FROM jsonb_array_elements(private.report_v3_metric_registry()) r
   WHERE (r ->> 'id')::int = ANY (private.report_v3_kpi_ids(p_reader));
$$;

-- Per credited agent: report_v3_call_counts' exact keys (one scan instead of one per agent) and the KPI 24
-- talk-time parts. Talk time is the canonical duration of attempt rows; its quality is disclosed, never
-- upgraded: estimated = elapsed_estimate, unknown = legacy_unknown, conflicting = duration_conflict,
-- provider_confirmed = provider or terminal_non_answer evidence with no conflict.
CREATE FUNCTION private.report_v3_agent_call_stats(p_org uuid, p_agents uuid[], p_start timestamptz, p_end timestamptz)
RETURNS TABLE (agent_id uuid, counts jsonb, talk jsonb)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH f AS MATERIALIZED (
    SELECT x.* FROM private.report_v3_call_facts(p_org, p_start, p_end) x
     WHERE x.direction_class = 'outbound' AND (p_agents IS NULL OR x.credited_agent_id = ANY (p_agents))
  ), dup AS (
    SELECT c.agent_id, count(*) AS n
      FROM private.performance_duplicate_rows d
      JOIN public.calls c ON c.id = d.duplicate_id AND c.organization_id = p_org
     WHERE d.organization_id = p_org AND d.kind = 'call' AND c.created_at >= p_start AND c.created_at < p_end
       AND (p_agents IS NULL OR c.agent_id = ANY (p_agents))
     GROUP BY c.agent_id
  ), g AS (
    SELECT f.credited_agent_id AS agent_id,
           count(*) FILTER (WHERE f.is_attempt) AS attempts,
           count(*) FILTER (WHERE f.attempt_class = 'non_attempt') AS non_attempts,
           count(*) FILTER (WHERE f.attempt_class = 'unverified') AS unverified,
           count(*) FILTER (WHERE f.is_attempt AND f.is_contacted) AS contacted,
           count(*) FILTER (WHERE f.is_attempt AND f.is_contacted AND f.identity_kind IS DISTINCT FROM 'recruit') AS contacted_eligible,
           count(*) FILTER (WHERE f.is_attempt AND f.is_contacted AND f.identity_kind IN ('lead', 'client')) AS contacted_resolved,
           count(*) FILTER (WHERE f.is_attempt AND f.is_contacted AND f.identity_key IS NULL) AS contacted_unresolved,
           count(DISTINCT f.identity_key) FILTER (WHERE f.is_attempt AND f.is_contacted AND f.identity_kind IN ('lead', 'client')) AS reached,
           count(*) FILTER (WHERE f.is_attempt AND f.is_lead_stage) AS lead_stage_attempts,
           count(DISTINCT f.identity_key) FILTER (WHERE f.is_attempt AND f.is_lead_stage) AS lead_identities,
           count(*) FILTER (WHERE f.is_attempt AND f.identity_key IS NULL) AS unresolved_attempts,
           count(*) FILTER (WHERE f.attempt_class = 'unverified' AND (f.is_lead_stage OR f.identity_key IS NULL)) AS lead_unverified,
           coalesce(sum(f.duration_seconds) FILTER (WHERE f.is_attempt), 0) AS seconds,
           count(*) FILTER (WHERE f.is_attempt AND f.duration_source = 'elapsed_estimate') AS estimated,
           count(*) FILTER (WHERE f.is_attempt AND f.duration_source = 'legacy_unknown') AS unknown,
           count(*) FILTER (WHERE f.is_attempt AND f.duration_conflict) AS conflicting,
           count(*) FILTER (WHERE f.is_attempt AND f.duration_source IN ('provider', 'terminal_non_answer')
                                  AND NOT f.duration_conflict) AS provider_confirmed
      FROM f GROUP BY f.credited_agent_id
  )
  SELECT coalesce(g.agent_id, dup.agent_id),
         jsonb_build_object(
           'attempts', coalesce(g.attempts, 0), 'non_attempts', coalesce(g.non_attempts, 0),
           'unverified', coalesce(g.unverified, 0), 'duplicates_excluded', coalesce(dup.n, 0),
           'contacted', coalesce(g.contacted, 0), 'contacted_eligible', coalesce(g.contacted_eligible, 0),
           'contacted_resolved', coalesce(g.contacted_resolved, 0), 'contacted_unresolved', coalesce(g.contacted_unresolved, 0),
           'reached', coalesce(g.reached, 0), 'lead_stage_attempts', coalesce(g.lead_stage_attempts, 0),
           'lead_identities', coalesce(g.lead_identities, 0), 'unresolved_attempts', coalesce(g.unresolved_attempts, 0),
           'lead_unverified', coalesce(g.lead_unverified, 0)),
         jsonb_build_object(
           'seconds', coalesce(g.seconds, 0), 'estimated', coalesce(g.estimated, 0), 'unknown', coalesce(g.unknown, 0),
           'conflicting', coalesce(g.conflicting, 0), 'provider_confirmed', coalesce(g.provider_confirmed, 0),
           'duplicates_excluded', coalesce(dup.n, 0))
    FROM g
    FULL JOIN dup ON coalesce(dup.agent_id, '00000000-0000-0000-0000-000000000000'::uuid)
                   = coalesce(g.agent_id, '00000000-0000-0000-0000-000000000000'::uuid);
$$;

-- KPI 25 quality per session agent, over the sessions that add clipped time to the window (the pinned
-- report_session_facts rules: window clipping, the 3-minute heartbeat cap for stale active sessions, and
-- the owner-preserved rule that an ended session counts until its recorded end). stale_capped = an active
-- session capped at its last heartbeat; late_ended = an end recorded more than 3 minutes after the last
-- heartbeat, which the preserved rule still counts to that end.
CREATE FUNCTION private.report_v3_session_quality(p_org uuid, p_start timestamptz, p_end timestamptz, p_agents uuid[])
RETURNS TABLE (agent_id uuid, stale_capped bigint, late_ended bigint)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT f.agent_id,
         count(*) FILTER (WHERE f.stale_capped),
         count(*) FILTER (WHERE s.ended_at IS NOT NULL AND s.ended_at > s.last_heartbeat_at + interval '3 minutes')
    FROM private.report_session_facts(p_org, p_start, p_end, p_agents) f
    JOIN public.dialer_sessions s ON s.id = f.session_id AND s.organization_id = p_org
   WHERE f.span_end > f.span_start
   GROUP BY f.agent_id;
$$;

-- The 14 summary envelopes, in report_v3_kpi_ids('summary') order, for one production counts object, one
-- call counts object and the KPI 24 and 25 parts. Detail on 24 and 25 only when quality is supplied
-- (the totals); by_agent rows pass none.
CREATE FUNCTION private.report_v3_summary_metrics(p_production jsonb, p_calls jsonb, p_talk_seconds numeric,
                                                  p_talk_quality jsonb, p_session_seconds numeric, p_session_quality jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_agg(m ORDER BY array_position(private.report_v3_kpi_ids('summary'), (m ->> 'id')::int))
    FROM jsonb_array_elements(
           private.report_v3_production_kpis(p_production)
           || private.report_v3_call_kpis(p_calls, (p_production ->> 'policy_count')::numeric)
           || jsonb_build_array(
                private.report_v3_total(24, p_talk_seconds, NULL, NULL,
                                        CASE WHEN p_talk_quality IS NOT NULL THEN jsonb_build_object('quality', p_talk_quality) END),
                private.report_v3_total(25, p_session_seconds, NULL, NULL,
                                        CASE WHEN p_session_quality IS NOT NULL THEN jsonb_build_object('quality', p_session_quality) END))) m;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 1. The scope gate (no window, no metrics)
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_scope_v3(p_requested_scope text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  tz record;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, NULL);
  SELECT * INTO tz FROM private.report_agency_time_zone(a.org_id);
  RETURN private.report_v3_envelope('scope', a.scope, a.requested_scope, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
    || jsonb_build_object(
      'available_scopes', to_jsonb(a.available_scopes),
      'role', a.actor_role,
      'can_export', a.can_export,
      'self_id', a.uid,
      'time_zone', tz.time_zone,
      'time_zone_source', tz.time_zone_source,
      'today', (now() AT TIME ZONE tz.time_zone)::date,
      'max_range_days', 366,
      'agents', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', private.report_agent_name(p.first_name, p.last_name),
                                            'status', p.status)
                         ORDER BY lower(private.report_agent_name(p.first_name, p.last_name)), p.id)
          FROM public.profiles p
         WHERE p.organization_id = a.org_id
           AND ((a.agent_ids IS NULL AND coalesce(p.status, '') IS DISTINCT FROM 'Deleted')
                OR (a.agent_ids IS NOT NULL AND p.id = ANY (a.agent_ids)))), '[]'::jsonb));
END $$;

-- -----------------------------------------------------------------------------------------------------
-- 2. Summary: KPIs 1–11, 24, 25, 34
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_summary_v3(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL,
                                             p_requested_scope text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  w record;
  sw record;
  v_as_of timestamptz := now();
  v_prod jsonb;
  v_counts jsonb;
  v_out jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);
  SELECT * INTO sw FROM private.report_v3_sold_window(w.start_date, w.end_date, (v_as_of AT TIME ZONE w.time_zone)::date);
  v_prod := private.report_v3_production(a.org_id, a.agent_ids, sw.sold_from, sw.sold_until, v_as_of);
  v_counts := private.report_v3_call_counts(a.org_id, a.agent_ids, w.start_at, w.end_at);

  WITH stats AS MATERIALIZED (
    SELECT * FROM private.report_v3_agent_call_stats(a.org_id, a.agent_ids, w.start_at, w.end_at)
  ), sess AS MATERIALIZED (
    SELECT * FROM private.report_session_seconds(a.org_id, w.start_at, w.end_at, a.agent_ids)
  ), sq AS MATERIALIZED (
    SELECT * FROM private.report_v3_session_quality(a.org_id, w.start_at, w.end_at, a.agent_ids)
  ), prod_agents AS (
    SELECT (e ->> 'agent_id')::uuid AS agent_id, e AS counts FROM jsonb_array_elements(v_prod -> 'by_agent') e
  ), roster AS (
    SELECT r.* FROM private.report_v3_roster(a.org_id, a.agent_ids, a.filter_agent_id, ARRAY(
      SELECT s.agent_id FROM stats s WHERE s.agent_id IS NOT NULL
      UNION SELECT x.agent_id FROM sess x WHERE x.agent_id IS NOT NULL
      UNION SELECT q.agent_id FROM sq q WHERE q.agent_id IS NOT NULL
      UNION SELECT p.agent_id FROM prod_agents p)) r
  ), totals AS (
    SELECT (SELECT coalesce(sum((s.talk ->> 'seconds')::numeric), 0) FROM stats s) AS talk_seconds,
           jsonb_build_object(
             'estimated', (SELECT coalesce(sum((s.talk ->> 'estimated')::bigint), 0) FROM stats s),
             'unknown', (SELECT coalesce(sum((s.talk ->> 'unknown')::bigint), 0) FROM stats s),
             'conflicting', (SELECT coalesce(sum((s.talk ->> 'conflicting')::bigint), 0) FROM stats s),
             'provider_confirmed', (SELECT coalesce(sum((s.talk ->> 'provider_confirmed')::bigint), 0) FROM stats s),
             'duplicates_excluded', v_counts -> 'duplicates_excluded') AS talk_quality,
           (SELECT coalesce(sum(x.session_seconds), 0) FROM sess x) AS session_seconds,
           jsonb_build_object(
             'stale_capped', (SELECT coalesce(sum(q.stale_capped), 0) FROM sq q),
             'late_ended', (SELECT coalesce(sum(q.late_ended), 0) FROM sq q)) AS session_quality
  )
  SELECT private.report_v3_envelope('summary', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
                                    w.time_zone_source, w.start_date, w.end_date, w.start_at, w.end_at)
         || jsonb_build_object(
           'metrics', private.report_v3_summary_metrics(v_prod -> 'totals', v_counts, t.talk_seconds, t.talk_quality,
                                                        t.session_seconds, t.session_quality),
           'by_agent', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'agent_id', r.agent_id, 'name', r.name, 'status', r.status,
                      'credit', private.report_v3_credit_map('summary'),
                      'metrics', private.report_v3_summary_metrics(
                        coalesce(pa.counts, '{"policy_count":0,"buyer_count":0,"known_count":0,"missing_count":0,"invalid_count":0,"annual_premium":0}'::jsonb),
                        coalesce(st.counts, '{"attempts":0,"non_attempts":0,"unverified":0,"duplicates_excluded":0,"contacted":0,"contacted_eligible":0,"contacted_resolved":0,"contacted_unresolved":0,"reached":0,"lead_stage_attempts":0,"lead_identities":0,"unresolved_attempts":0,"lead_unverified":0}'::jsonb),
                        coalesce((st.talk ->> 'seconds')::numeric, 0), NULL, coalesce(ss.session_seconds, 0), NULL))
                      ORDER BY lower(r.name) NULLS LAST, r.agent_id)
               FROM roster r
               LEFT JOIN prod_agents pa ON pa.agent_id = r.agent_id
               LEFT JOIN stats st ON st.agent_id = r.agent_id
               LEFT JOIN sess ss ON ss.agent_id = r.agent_id), '[]'::jsonb),
           'production_by_date', v_prod -> 'production_by_date',
           'call_population', jsonb_build_object('attempts', v_counts -> 'attempts', 'non_attempts', v_counts -> 'non_attempts',
                                                 'unverified', v_counts -> 'unverified',
                                                 'duplicates_excluded', v_counts -> 'duplicates_excluded'))
    INTO v_out
    FROM totals t;
  RETURN v_out;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- 3. Journey: KPIs 14, 19, 21, 38. ★1 is pending: the proposed option (a) linked-history design (E1–E3,
--    E5) with BC1 and BC2 applied; no scope restriction is implemented.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_journey_v3(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL,
                                             p_requested_scope text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  w record;
  sw record;
  v_as_of timestamptz := now();
  v_by_agent jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);
  SELECT * INTO sw FROM private.report_v3_sold_window(w.start_date, w.end_date, (v_as_of AT TIME ZONE w.time_zone)::date);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'agent_id', r.agent_id, 'name', r.name, 'status', r.status, 'credit', private.report_v3_credit_map('journey'),
           'metrics', private.report_v3_journey_kpis(private.report_v3_journey_facts(
             a.org_id, ARRAY[r.agent_id], w.time_zone, w.start_at, w.end_at, sw.sold_from, sw.sold_until, v_as_of)))
         ORDER BY lower(r.name) NULLS LAST, r.agent_id), '[]'::jsonb)
    INTO v_by_agent
    FROM private.report_v3_roster(a.org_id, a.agent_ids, a.filter_agent_id, ARRAY(
           SELECT DISTINCT m.credited_agent_id
             FROM private.report_v3_journey_members(a.org_id, a.agent_ids, w.time_zone, w.start_at, w.end_at,
                                                    sw.sold_from, sw.sold_until, v_as_of) m
            WHERE m.credited_agent_id IS NOT NULL)) r;

  RETURN private.report_v3_envelope('journey', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
                                    w.time_zone_source, w.start_date, w.end_date, w.start_at, w.end_at)
    || jsonb_build_object(
      'metrics', private.report_v3_journey_kpis(private.report_v3_journey_facts(
        a.org_id, a.agent_ids, w.time_zone, w.start_at, w.end_at, sw.sold_from, sw.sold_until, v_as_of)),
      'by_agent', v_by_agent);
END $$;

-- -----------------------------------------------------------------------------------------------------
-- 4. Sales Appointments: KPIs 12, 15–18 from the PKG-A stub (unavailable/evidence_not_captured until PKG-D)
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_sales_appointments_v3(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL,
                                                        p_requested_scope text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  w record;
  v_roster uuid[];
  v_facts jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);
  SELECT coalesce(array_agg(r.agent_id ORDER BY lower(r.name) NULLS LAST, r.agent_id), '{}')
    INTO v_roster
    FROM private.report_v3_roster(a.org_id, a.agent_ids, a.filter_agent_id, '{}') r;
  v_facts := private.report_v3_appointment_facts(a.org_id, a.agent_ids, v_roster, w.start_at, w.end_at, w.time_zone, now());

  RETURN private.report_v3_envelope('sales_appointments', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
                                    w.time_zone_source, w.start_date, w.end_date, w.start_at, w.end_at)
    || jsonb_build_object(
      'metrics', v_facts -> 'metrics',
      'by_agent', coalesce((
        SELECT jsonb_agg(jsonb_build_object('agent_id', r.agent_id, 'name', r.name, 'status', r.status,
                                            'credit', private.report_v3_credit_map('sales_appointments'),
                                            'metrics', e -> 'metrics') ORDER BY x.o)
          FROM jsonb_array_elements(v_facts -> 'by_agent') WITH ORDINALITY AS x(e, o)
          JOIN private.report_v3_roster(a.org_id, a.agent_ids, a.filter_agent_id, '{}') r
            ON r.agent_id = (x.e ->> 'agent_id')::uuid), '[]'::jsonb));
END $$;

-- -----------------------------------------------------------------------------------------------------
-- 5. Regional (D5 §3.4–§3.7): the recorded-state split of KPIs 5, 6, 2 and 1. Each call and policy gets at
--    most one state, from its D3 identity's current recorded state (never claimed as event-time residence),
--    through …14. Σ51 + Σ6 unmapped = totals for every count, and for AP to the cent.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_state_breakdown_v3(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL,
                                                     p_requested_scope text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  w record;
  sw record;
  v_as_of timestamptz := now();
  v_counts jsonb;
  v_prod jsonb;
  v_call_kpis jsonb;
  v_prod_kpis jsonb;
  v_out jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);
  SELECT * INTO sw FROM private.report_v3_sold_window(w.start_date, w.end_date, (v_as_of AT TIME ZONE w.time_zone)::date);
  v_counts := private.report_v3_call_counts(a.org_id, a.agent_ids, w.start_at, w.end_at);
  v_prod := private.report_v3_production(a.org_id, a.agent_ids, sw.sold_from, sw.sold_until, v_as_of);
  v_call_kpis := private.report_v3_call_kpis(v_counts, (v_prod #>> '{totals,policy_count}')::numeric);
  v_prod_kpis := private.report_v3_production_kpis(v_prod -> 'totals');

  WITH calls_f AS MATERIALIZED (
    SELECT f.created_at, f.is_contacted, f.identity_key
      FROM private.report_v3_call_facts(a.org_id, w.start_at, w.end_at) f
     WHERE f.direction_class = 'outbound' AND f.is_attempt
       AND (a.agent_ids IS NULL OR f.credited_agent_id = ANY (a.agent_ids))
  ), pol_f AS MATERIALIZED (
    SELECT s.recorded_at, s.monthly_premium, s.premium_state,
           private.report_v3_client_identity_key(a.org_id, s.buyer_id) AS identity_key
      FROM private.report_v3_sale_facts(a.org_id, a.agent_ids, sw.sold_from, sw.sold_until) s
     WHERE s.recorded_at <= v_as_of
  ), ist AS MATERIALIZED (
    SELECT * FROM private.report_v3_identity_states(a.org_id, ARRAY(
      SELECT c.identity_key FROM calls_f c WHERE c.identity_key LIKE 'lead:%' OR c.identity_key LIKE 'client:%'
      UNION SELECT p.identity_key FROM pol_f p WHERE p.identity_key LIKE 'lead:%' OR p.identity_key LIKE 'client:%'))
  ), call_rows AS (
    SELECT c.is_contacted,
           CASE WHEN c.identity_key LIKE 'recruit:%' THEN NULL ELSE i.state_code END AS state_code,
           CASE WHEN c.identity_key LIKE 'recruit:%' THEN 'non_prospect_contact'
                WHEN i.identity_key IS NULL THEN 'unresolved_identity' ELSE i.reason END AS reason,
           CASE WHEN c.identity_key NOT LIKE 'recruit:%' AND i.state_code IS NOT NULL THEN i.basis END AS basis,
           coalesce(c.identity_key NOT LIKE 'recruit:%' AND i.basis = 'current_record' AND i.state_code IS NOT NULL
                    AND i.last_state_change_at > c.created_at, false) AS changed_after
      FROM calls_f c LEFT JOIN ist i ON i.identity_key = c.identity_key
  ), pol_rows AS (
    SELECT p.monthly_premium, p.premium_state,
           CASE WHEN p.identity_key LIKE 'recruit:%' THEN NULL ELSE i.state_code END AS state_code,
           CASE WHEN p.identity_key LIKE 'recruit:%' THEN 'non_prospect_contact'
                WHEN i.identity_key IS NULL THEN 'unresolved_identity' ELSE i.reason END AS reason,
           CASE WHEN p.identity_key NOT LIKE 'recruit:%' AND i.state_code IS NOT NULL THEN i.basis END AS basis,
           coalesce(p.identity_key NOT LIKE 'recruit:%' AND i.basis = 'current_record' AND i.state_code IS NOT NULL
                    AND i.last_state_change_at > p.recorded_at, false) AS changed_after
      FROM pol_f p LEFT JOIN ist i ON i.identity_key = p.identity_key
  ), call_g AS (
    SELECT c.state_code, c.reason, count(*) AS calls_made, count(*) FILTER (WHERE c.is_contacted) AS contacted_calls,
           count(*) FILTER (WHERE c.basis = 'current_record') AS b_current, count(*) FILTER (WHERE c.basis = 'campaign_copy') AS b_copy,
           count(*) FILTER (WHERE c.changed_after) AS changed_after
      FROM call_rows c GROUP BY c.state_code, c.reason
  ), pol_g AS (
    SELECT p.state_code, p.reason, count(*) AS policy_count,
           count(*) FILTER (WHERE p.premium_state = 'known') AS known_count,
           count(*) FILTER (WHERE p.premium_state = 'missing') AS missing_count,
           count(*) FILTER (WHERE p.premium_state = 'invalid') AS invalid_count,
           coalesce(sum(p.monthly_premium * 12) FILTER (WHERE p.premium_state = 'known'), 0) AS annual_premium,
           count(*) FILTER (WHERE p.basis = 'current_record') AS b_current, count(*) FILTER (WHERE p.basis = 'campaign_copy') AS b_copy,
           count(*) FILTER (WHERE p.changed_after) AS changed_after
      FROM pol_rows p GROUP BY p.state_code, p.reason
  ), jur AS (
    SELECT j.code FROM unnest(ARRAY['AK', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'GA', 'HI', 'IA', 'ID', 'IL',
                                    'IN', 'KS', 'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE',
                                    'NH', 'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT',
                                    'VA', 'VT', 'WA', 'WI', 'WV', 'WY']) AS j(code)
  ), reasons AS (
    SELECT u.reason, u.o FROM unnest(ARRAY['missing_state', 'invalid_state', 'unresolved_identity', 'source_conflict',
                                           'unsupported_geography', 'non_prospect_contact']) WITH ORDINALITY AS u(reason, o)
  )
  SELECT private.report_v3_envelope('state_breakdown', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
                                    w.time_zone_source, w.start_date, w.end_date, w.start_at, w.end_at)
         || jsonb_build_object(
           'state_basis', jsonb_build_object(
             'version', 'state_v1', 'priority', jsonb_build_array('event_snapshot', 'current_record', 'campaign_copy'),
             'event_snapshot_available', false, 'campaign_copy_fallback', true, 'normalizer', 'public.normalize_us_state',
             'classifier', 'report_v3_state_classify_v1', 'history_capture_since', '2026-10-03'),
           'metrics', '[]'::jsonb,
           'modes', jsonb_build_object(
             'calls_made', (SELECT jsonb_build_object('metric_id', 5, 'status', e ->> 'status', 'reason', e -> 'reason')
                              FROM jsonb_array_elements(v_call_kpis) e WHERE (e ->> 'id')::int = 5),
             'contacted_calls', (SELECT jsonb_build_object('metric_id', 6, 'status', e ->> 'status', 'reason', e -> 'reason')
                                   FROM jsonb_array_elements(v_call_kpis) e WHERE (e ->> 'id')::int = 6),
             'policies_sold', (SELECT jsonb_build_object('metric_id', 2, 'status', e ->> 'status', 'reason', e -> 'reason')
                                 FROM jsonb_array_elements(v_prod_kpis) e WHERE (e ->> 'id')::int = 2),
             'ap', (SELECT jsonb_build_object('metric_id', 1, 'status', e ->> 'status', 'reason', e -> 'reason')
                      FROM jsonb_array_elements(v_prod_kpis) e WHERE (e ->> 'id')::int = 1)),
           'call_population', jsonb_build_object('attempts', v_counts -> 'attempts', 'non_attempts', v_counts -> 'non_attempts',
                                                 'unverified', v_counts -> 'unverified',
                                                 'duplicates_excluded', v_counts -> 'duplicates_excluded'),
           'jurisdictions', (
             SELECT jsonb_agg(jsonb_build_object(
                      'state', j.code,
                      'calls_made', coalesce(cg.calls_made, 0),
                      'contacted_calls', coalesce(cg.contacted_calls, 0),
                      'policies_sold', coalesce(pg.policy_count, 0),
                      'premium', jsonb_build_object(
                        'policy_count', coalesce(pg.policy_count, 0), 'known_count', coalesce(pg.known_count, 0),
                        'missing_count', coalesce(pg.missing_count, 0), 'invalid_count', coalesce(pg.invalid_count, 0),
                        'annual_premium', CASE WHEN coalesce(pg.policy_count, 0) = 0 THEN 0
                                               WHEN pg.known_count = 0 THEN NULL ELSE pg.annual_premium END),
                      'basis', jsonb_build_object(
                        'calls', jsonb_build_object('event_snapshot', 0, 'current_record', coalesce(cg.b_current, 0),
                                                    'campaign_copy', coalesce(cg.b_copy, 0)),
                        'policies', jsonb_build_object('event_snapshot', 0, 'current_record', coalesce(pg.b_current, 0),
                                                       'campaign_copy', coalesce(pg.b_copy, 0)),
                        'calls_changed_after_event', coalesce(cg.changed_after, 0),
                        'policies_changed_after_event', coalesce(pg.changed_after, 0)))
                    ORDER BY j.code)
               FROM jur j
               LEFT JOIN call_g cg ON cg.state_code = j.code
               LEFT JOIN pol_g pg ON pg.state_code = j.code),
           'unmapped', (
             SELECT jsonb_build_object(
                      'calls_made', coalesce(sum(cg.calls_made), 0),
                      'contacted_calls', coalesce(sum(cg.contacted_calls), 0),
                      'policies_sold', coalesce(sum(pg.policy_count), 0),
                      'premium', jsonb_build_object(
                        'policy_count', coalesce(sum(pg.policy_count), 0), 'known_count', coalesce(sum(pg.known_count), 0),
                        'missing_count', coalesce(sum(pg.missing_count), 0), 'invalid_count', coalesce(sum(pg.invalid_count), 0),
                        'annual_premium', CASE WHEN coalesce(sum(pg.policy_count), 0) = 0 THEN 0
                                               WHEN coalesce(sum(pg.known_count), 0) = 0 THEN NULL
                                               ELSE sum(pg.annual_premium) END),
                      'reasons', jsonb_agg(jsonb_build_object(
                        'reason', r.reason,
                        'calls_made', coalesce(cg.calls_made, 0),
                        'contacted_calls', coalesce(cg.contacted_calls, 0),
                        'policies_sold', coalesce(pg.policy_count, 0),
                        'premium', jsonb_build_object(
                          'policy_count', coalesce(pg.policy_count, 0), 'known_count', coalesce(pg.known_count, 0),
                          'missing_count', coalesce(pg.missing_count, 0), 'invalid_count', coalesce(pg.invalid_count, 0),
                          'annual_premium', CASE WHEN coalesce(pg.policy_count, 0) = 0 THEN 0
                                                 WHEN pg.known_count = 0 THEN NULL ELSE pg.annual_premium END))
                        ORDER BY r.o))
               FROM reasons r
               LEFT JOIN call_g cg ON cg.state_code IS NULL AND cg.reason = r.reason
               LEFT JOIN pol_g pg ON pg.state_code IS NULL AND pg.reason = r.reason),
           'totals', (
             SELECT jsonb_build_object(
                      'calls_made', (SELECT count(*) FROM calls_f),
                      'contacted_calls', (SELECT count(*) FROM calls_f WHERE is_contacted),
                      'policies_sold', count(*),
                      'premium', jsonb_build_object(
                        'policy_count', count(*), 'known_count', count(*) FILTER (WHERE p.premium_state = 'known'),
                        'missing_count', count(*) FILTER (WHERE p.premium_state = 'missing'),
                        'invalid_count', count(*) FILTER (WHERE p.premium_state = 'invalid'),
                        'annual_premium', CASE WHEN count(*) = 0 THEN 0
                                               WHEN count(*) FILTER (WHERE p.premium_state = 'known') = 0 THEN NULL
                                               ELSE sum(p.monthly_premium * 12) FILTER (WHERE p.premium_state = 'known') END))
               FROM pol_f p))
    INTO v_out;
  RETURN v_out;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- 6. Call volume (D3 §3.7): attempt rows only; inbound rows are counted separately, never as Calls made.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_call_volume_v3(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL,
                                                 p_requested_scope text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  w record;
  v_counts jsonb;
  v_out jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);
  v_counts := private.report_v3_call_counts(a.org_id, a.agent_ids, w.start_at, w.end_at);

  WITH f AS MATERIALIZED (
    SELECT x.is_attempt, x.is_contacted, x.direction_class, x.duration_seconds, (x.created_at AT TIME ZONE w.time_zone) AS local_ts
      FROM private.report_v3_call_facts(a.org_id, w.start_at, w.end_at) x
     WHERE (a.agent_ids IS NULL OR x.credited_agent_id = ANY (a.agent_ids))
       AND (x.is_attempt OR x.direction_class = 'inbound')
  ), days AS (
    SELECT d::date AS local_date FROM generate_series(w.start_date::timestamp, w.end_date::timestamp, interval '1 day') d
  ), day_calls AS (
    SELECT f.local_ts::date AS local_date,
           count(*) FILTER (WHERE f.is_attempt) AS calls_made,
           count(*) FILTER (WHERE f.is_attempt AND f.is_contacted) AS contacted,
           count(*) FILTER (WHERE f.direction_class = 'inbound') AS inbound_calls,
           coalesce(sum(f.duration_seconds) FILTER (WHERE f.is_attempt), 0) AS talk_time_seconds
      FROM f GROUP BY 1
  ), cells AS (
    SELECT extract(dow FROM f.local_ts)::int AS dow, extract(hour FROM f.local_ts)::int AS hour_of_day,
           count(*) AS calls_made, count(*) FILTER (WHERE f.is_contacted) AS contacted
      FROM f WHERE f.is_attempt GROUP BY 1, 2
  )
  SELECT private.report_v3_envelope('call_volume', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
                                    w.time_zone_source, w.start_date, w.end_date, w.start_at, w.end_at)
         || jsonb_build_object(
           'metrics', '[]'::jsonb,
           'heatmap', (SELECT jsonb_agg(jsonb_build_object('dow', d.d, 'hour', h.h, 'calls_made', coalesce(c.calls_made, 0),
                                                           'contacted', coalesce(c.contacted, 0)) ORDER BY d.d, h.h)
                         FROM generate_series(0, 6) d(d) CROSS JOIN generate_series(0, 23) h(h)
                         LEFT JOIN cells c ON c.dow = d.d AND c.hour_of_day = h.h),
           'by_date', (SELECT jsonb_agg(jsonb_build_object('date', to_char(dy.local_date, 'YYYY-MM-DD'),
                                                           'calls_made', coalesce(dc.calls_made, 0),
                                                           'contacted', coalesce(dc.contacted, 0),
                                                           'inbound_calls', coalesce(dc.inbound_calls, 0),
                                                           'talk_time_seconds', coalesce(dc.talk_time_seconds, 0))
                                        ORDER BY dy.local_date)
                         FROM days dy LEFT JOIN day_calls dc ON dc.local_date = dy.local_date),
           'by_hour', (SELECT jsonb_agg(jsonb_build_object('hour', h.h,
                                          'calls_made', coalesce((SELECT sum(c.calls_made) FROM cells c WHERE c.hour_of_day = h.h), 0),
                                          'contacted', coalesce((SELECT sum(c.contacted) FROM cells c WHERE c.hour_of_day = h.h), 0))
                                        ORDER BY h.h)
                         FROM generate_series(0, 23) h(h)),
           'by_weekday', (SELECT jsonb_agg(jsonb_build_object('dow', d.d,
                                             'calls_made', coalesce((SELECT sum(c.calls_made) FROM cells c WHERE c.dow = d.d), 0),
                                             'contacted', coalesce((SELECT sum(c.contacted) FROM cells c WHERE c.dow = d.d), 0))
                                           ORDER BY d.d)
                            FROM generate_series(0, 6) d(d)),
           'inbound_calls', (SELECT count(*) FROM f WHERE f.direction_class = 'inbound'),
           'call_population', jsonb_build_object('attempts', v_counts -> 'attempts', 'non_attempts', v_counts -> 'non_attempts',
                                                 'unverified', v_counts -> 'unverified',
                                                 'duplicates_excluded', v_counts -> 'duplicates_excluded'))
    INTO v_out;
  RETURN v_out;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- 7. Dispositions (D3 §3.7): outcomes (key 'none' = No outcome recorded), duration buckets with every attempt
--    row in exactly one, and a deep dive by in-scope agent and by visible campaign. A hidden campaign appears
--    only inside the other_campaigns count.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_disposition_breakdown_v3(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL,
                                                           p_requested_scope text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  w record;
  v_counts jsonb;
  v_out jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);
  v_counts := private.report_v3_call_counts(a.org_id, a.agent_ids, w.start_at, w.end_at);

  WITH visible AS MATERIALIZED (
    SELECT v.campaign_id FROM private.report_visible_campaigns(a.org_id) v
  ), f AS MATERIALIZED (
    SELECT x.credited_agent_id AS agent_id, x.campaign_id, x.duration_seconds, x.disposition_key, x.disposition_name,
           x.disposition_color, x.disp_counts_contacted, x.disp_converts, x.disp_dnc, x.disp_callback, x.disp_appointment,
           CASE WHEN x.campaign_id IS NULL THEN 'none'
                WHEN EXISTS (SELECT 1 FROM visible v WHERE v.campaign_id = x.campaign_id) THEN 'visible'
                ELSE 'hidden' END AS campaign_class
      FROM private.report_v3_call_facts(a.org_id, w.start_at, w.end_at) x
     WHERE x.is_attempt AND (a.agent_ids IS NULL OR x.credited_agent_id = ANY (a.agent_ids))
  ), disp AS (
    SELECT f.disposition_key, max(f.disposition_name) AS name, max(f.disposition_color) AS color, count(*) AS calls,
           sum(f.duration_seconds) AS duration_seconds, bool_or(f.disp_counts_contacted) AS counts_as_contacted,
           bool_or(f.disp_converts) AS converts, bool_or(f.disp_dnc) AS dnc, bool_or(f.disp_callback) AS callback,
           bool_or(f.disp_appointment) AS appointment
      FROM f GROUP BY f.disposition_key
  ), by_agent AS (
    SELECT x.agent_id, private.report_agent_name(p.first_name, p.last_name) AS name,
           jsonb_object_agg(x.disposition_key, x.calls) AS counts, sum(x.calls) AS total
      FROM (SELECT f.agent_id, f.disposition_key, count(*) AS calls FROM f WHERE f.agent_id IS NOT NULL GROUP BY 1, 2) x
      LEFT JOIN public.profiles p ON p.id = x.agent_id AND p.organization_id = a.org_id
     GROUP BY x.agent_id, p.first_name, p.last_name
  ), by_campaign AS (
    SELECT x.campaign_id, max(c.name) AS name, jsonb_object_agg(x.disposition_key, x.calls) AS counts, sum(x.calls) AS total
      FROM (SELECT f.campaign_id, f.disposition_key, count(*) AS calls FROM f WHERE f.campaign_class = 'visible' GROUP BY 1, 2) x
      JOIN public.campaigns c ON c.id = x.campaign_id AND c.organization_id = a.org_id
     GROUP BY x.campaign_id
  ), buckets AS (
    SELECT * FROM (VALUES (1, '0-30s', 0::bigint, 30::bigint), (2, '30s-1m', 30, 60), (3, '1-2m', 60, 120),
                          (4, '2-5m', 120, 300), (5, '5m+', 300, NULL)) v(ord, label, lo, hi)
  )
  SELECT private.report_v3_envelope('disposition_breakdown', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
                                    w.time_zone_source, w.start_date, w.end_date, w.start_at, w.end_at)
         || jsonb_build_object(
           'metrics', '[]'::jsonb,
           'by_disposition', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'key', d.disposition_key,
                      'name', CASE WHEN d.disposition_key = 'none' THEN 'No outcome recorded' ELSE d.name END,
                      'color', d.color, 'calls', d.calls, 'duration_seconds', d.duration_seconds,
                      'counts_as_contacted', d.counts_as_contacted, 'converts', d.converts, 'dnc', d.dnc,
                      'callback', d.callback, 'appointment', d.appointment)
                    ORDER BY d.calls DESC, lower(d.name), d.disposition_key)
               FROM disp d), '[]'::jsonb),
           'duration_buckets', (SELECT jsonb_agg(jsonb_build_object('range', b.label, 'calls', (
                                    SELECT count(*) FROM f WHERE f.duration_seconds >= b.lo AND (b.hi IS NULL OR f.duration_seconds < b.hi)))
                                  ORDER BY b.ord) FROM buckets b),
           'deep_dive', jsonb_build_object(
             'by_agent', coalesce((SELECT jsonb_agg(jsonb_build_object('agent_id', x.agent_id, 'name', x.name, 'total', x.total,
                                                                      'counts', x.counts) ORDER BY x.total DESC, lower(x.name), x.agent_id)
                                     FROM by_agent x), '[]'::jsonb),
             'by_campaign', coalesce((SELECT jsonb_agg(jsonb_build_object('campaign_id', x.campaign_id, 'name', x.name, 'total', x.total,
                                                                         'counts', x.counts) ORDER BY x.total DESC, lower(x.name), x.campaign_id)
                                        FROM by_campaign x), '[]'::jsonb),
             'other_campaigns', (SELECT jsonb_build_object('total', count(*), 'counts', coalesce(
                                   (SELECT jsonb_object_agg(y.disposition_key, y.calls) FROM (
                                      SELECT f2.disposition_key, count(*) AS calls FROM f f2 WHERE f2.campaign_class = 'hidden' GROUP BY 1) y),
                                   '{}'::jsonb)) FROM f WHERE f.campaign_class = 'hidden'),
             'without_campaign', (SELECT jsonb_build_object('total', count(*), 'counts', coalesce(
                                    (SELECT jsonb_object_agg(y.disposition_key, y.calls) FROM (
                                       SELECT f2.disposition_key, count(*) AS calls FROM f f2 WHERE f2.campaign_class = 'none' GROUP BY 1) y),
                                    '{}'::jsonb)) FROM f WHERE f.campaign_class = 'none'),
             'unattributed', CASE WHEN a.agent_ids IS NULL THEN (
                               SELECT jsonb_build_object('total', count(*), 'counts', coalesce(
                                 (SELECT jsonb_object_agg(y.disposition_key, y.calls) FROM (
                                    SELECT f2.disposition_key, count(*) AS calls FROM f f2 WHERE f2.agent_id IS NULL GROUP BY 1) y),
                                 '{}'::jsonb)) FROM f WHERE f.agent_id IS NULL) END),
           'call_population', jsonb_build_object('attempts', v_counts -> 'attempts', 'non_attempts', v_counts -> 'non_attempts',
                                                 'unverified', v_counts -> 'unverified',
                                                 'duplicates_excluded', v_counts -> 'duplicates_excluded'))
    INTO v_out;
  RETURN v_out;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- 8. Campaign calls (D3 §3.7): one row per visible campaign, then "Calls without a campaign" and "Other
--    campaigns" (in-scope calls on campaigns the viewer cannot see: counts only, no id, name or type).
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_campaign_calls_v3(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL,
                                                    p_requested_scope text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  w record;
  v_counts jsonb;
  v_out jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);
  v_counts := private.report_v3_call_counts(a.org_id, a.agent_ids, w.start_at, w.end_at);

  WITH visible AS MATERIALIZED (
    SELECT v.campaign_id FROM private.report_visible_campaigns(a.org_id) v
  ), f AS MATERIALIZED (
    SELECT x.campaign_id, x.is_contacted,
           CASE WHEN x.campaign_id IS NULL THEN 'none'
                WHEN EXISTS (SELECT 1 FROM visible v WHERE v.campaign_id = x.campaign_id) THEN 'visible'
                ELSE 'hidden' END AS campaign_class
      FROM private.report_v3_call_facts(a.org_id, w.start_at, w.end_at) x
     WHERE x.is_attempt AND (a.agent_ids IS NULL OR x.credited_agent_id = ANY (a.agent_ids))
  ), rows_ AS (
    SELECT f.campaign_id, c.name, c.type, count(*) AS calls_made, count(*) FILTER (WHERE f.is_contacted) AS contacted_calls
      FROM f JOIN public.campaigns c ON c.id = f.campaign_id AND c.organization_id = a.org_id
     WHERE f.campaign_class = 'visible'
     GROUP BY f.campaign_id, c.name, c.type
  )
  SELECT private.report_v3_envelope('campaign_calls', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
                                    w.time_zone_source, w.start_date, w.end_date, w.start_at, w.end_at)
         || jsonb_build_object(
           'metrics', '[]'::jsonb,
           'campaigns', coalesce((
             SELECT jsonb_agg(jsonb_build_object('campaign_id', r.campaign_id, 'name', r.name, 'type', r.type,
                                                 'calls_made', r.calls_made, 'contacted_calls', r.contacted_calls,
                                                 'contact_rate_numerator', r.contacted_calls,
                                                 'contact_rate_denominator', r.calls_made)
                              ORDER BY r.calls_made DESC, lower(r.name), r.campaign_id)
               FROM rows_ r), '[]'::jsonb),
           'calls_without_campaign', (SELECT jsonb_build_object('calls_made', count(*), 'contacted_calls', count(*) FILTER (WHERE is_contacted),
                                                                'contact_rate_numerator', count(*) FILTER (WHERE is_contacted),
                                                                'contact_rate_denominator', count(*))
                                        FROM f WHERE f.campaign_class = 'none'),
           'other_campaigns', (SELECT jsonb_build_object('calls_made', count(*), 'contacted_calls', count(*) FILTER (WHERE is_contacted),
                                                         'contact_rate_numerator', count(*) FILTER (WHERE is_contacted),
                                                         'contact_rate_denominator', count(*))
                                 FROM f WHERE f.campaign_class = 'hidden'),
           'call_population', jsonb_build_object('attempts', v_counts -> 'attempts', 'non_attempts', v_counts -> 'non_attempts',
                                                 'unverified', v_counts -> 'unverified',
                                                 'duplicates_excluded', v_counts -> 'duplicates_excluded'))
    INTO v_out;
  RETURN v_out;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- 9. Lead-source calls (D3 §3.7): one row per source, plus "Not linked to a current lead" (the v2 lead_id
--    IS NULL rule). New leads keep the v2 rule: created in the window, currently assigned in scope (E6).
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_lead_source_calls_v3(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL,
                                                       p_requested_scope text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  w record;
  v_counts jsonb;
  v_out jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);
  v_counts := private.report_v3_call_counts(a.org_id, a.agent_ids, w.start_at, w.end_at);

  WITH f AS MATERIALIZED (
    SELECT x.lead_id, x.lead_source, x.is_contacted
      FROM private.report_v3_call_facts(a.org_id, w.start_at, w.end_at) x
     WHERE x.is_attempt AND (a.agent_ids IS NULL OR x.credited_agent_id = ANY (a.agent_ids))
  ), call_agg AS (
    SELECT f.lead_source, count(*) AS calls_made, count(*) FILTER (WHERE f.is_contacted) AS contacted_calls
      FROM f WHERE f.lead_id IS NOT NULL GROUP BY f.lead_source
  ), new_leads AS (
    SELECT coalesce(nullif(btrim(l.lead_source), ''), '(No source)') AS lead_source, count(*) AS new_leads
      FROM public.leads l
     WHERE l.organization_id = a.org_id AND l.created_at >= w.start_at AND l.created_at < w.end_at
       AND (a.agent_ids IS NULL OR l.assigned_agent_id = ANY (a.agent_ids))
     GROUP BY 1
  ), rows_ AS (
    SELECT s.lead_source, coalesce(ca.calls_made, 0) AS calls_made, coalesce(ca.contacted_calls, 0) AS contacted_calls,
           coalesce(nl.new_leads, 0) AS new_leads
      FROM (SELECT lead_source FROM call_agg UNION SELECT lead_source FROM new_leads) s
      LEFT JOIN call_agg ca ON ca.lead_source = s.lead_source
      LEFT JOIN new_leads nl ON nl.lead_source = s.lead_source
  )
  SELECT private.report_v3_envelope('lead_source_calls', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
                                    w.time_zone_source, w.start_date, w.end_date, w.start_at, w.end_at)
         || jsonb_build_object(
           'metrics', '[]'::jsonb,
           'sources', coalesce((
             SELECT jsonb_agg(jsonb_build_object('lead_source', r.lead_source, 'new_leads', r.new_leads,
                                                 'calls_made', r.calls_made, 'contacted_calls', r.contacted_calls,
                                                 'contact_rate_numerator', r.contacted_calls,
                                                 'contact_rate_denominator', r.calls_made)
                              ORDER BY r.calls_made DESC, r.new_leads DESC, lower(r.lead_source))
               FROM rows_ r), '[]'::jsonb),
           'not_linked', (SELECT jsonb_build_object('calls_made', count(*), 'contacted_calls', count(*) FILTER (WHERE is_contacted),
                                                    'contact_rate_numerator', count(*) FILTER (WHERE is_contacted),
                                                    'contact_rate_denominator', count(*))
                            FROM f WHERE f.lead_id IS NULL),
           'call_population', jsonb_build_object('attempts', v_counts -> 'attempts', 'non_attempts', v_counts -> 'non_attempts',
                                                 'unverified', v_counts -> 'unverified',
                                                 'duplicates_excluded', v_counts -> 'duplicates_excluded'))
    INTO v_out;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION private.report_v3_roster(uuid, uuid[], uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_credit_map(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_agent_call_stats(uuid, uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_session_quality(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_summary_metrics(jsonb, jsonb, numeric, jsonb, numeric, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_report_scope_v3(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_report_summary_v3(date, date, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_report_journey_v3(date, date, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_report_sales_appointments_v3(date, date, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_report_state_breakdown_v3(date, date, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_report_call_volume_v3(date, date, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_report_disposition_breakdown_v3(date, date, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_report_campaign_calls_v3(date, date, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_report_lead_source_calls_v3(date, date, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

DO $postcondition$
DECLARE f record; r text; n_readers int := 0; n_helpers int := 0; v_acl text;
BEGIN
  FOR f IN SELECT p.oid, n.nspname, p.proname, p.prosecdef, p.proconfig, p.proowner, p.provolatile, l.lanname,
                  pg_get_function_identity_arguments(p.oid) AS args
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
            WHERE (n.nspname = 'public' AND p.proname LIKE 'get\_report\_%\_v3')
               OR (n.nspname = 'private' AND p.proname IN ('report_v3_roster', 'report_v3_credit_map',
                   'report_v3_agent_call_stats', 'report_v3_session_quality', 'report_v3_summary_metrics')) LOOP
    IF f.nspname = 'public' THEN
      n_readers := n_readers + 1;
      IF NOT f.prosecdef OR f.provolatile <> 's' OR f.lanname <> 'plpgsql' OR f.args ~ '(p_org|p_organization|p_time_zone|p_as_of)'
         OR f.args NOT IN ('p_requested_scope text',
                           'p_start_date date, p_end_date date, p_agent_id uuid, p_requested_scope text') THEN
        RAISE EXCEPTION 'Reports v3 readers: reader metadata mismatch: %', f.oid::regprocedure;
      END IF;
    ELSE
      n_helpers := n_helpers + 1;
      IF f.prosecdef THEN
        RAISE EXCEPTION 'Reports v3 readers: helper must run with invoker rights: %', f.oid::regprocedure;
      END IF;
    END IF;
    IF f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp'] OR f.proowner <> 'postgres'::regrole THEN
      RAISE EXCEPTION 'Reports v3 readers: owner or search_path mismatch: %', f.oid::regprocedure;
    END IF;
    FOREACH r IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(r, f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Reports v3 readers: % can execute % (created sealed; only the class E enable grants)', r, f.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
  IF n_readers <> 9 OR n_helpers <> 5 THEN
    RAISE EXCEPTION 'Reports v3 readers: expected 9 readers and 5 helpers, found % and %', n_readers, n_helpers;
  END IF;
  SELECT coalesce(string_agg(p.oid::regprocedure::text || ':' || r2, ',' ORDER BY p.oid::regprocedure::text, r2), '')
    INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r2
   WHERE ((n.nspname = 'private' AND p.proname LIKE 'report\_%')
          OR (n.nspname = 'public' AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'rpc\_report\_%')))
     AND has_function_privilege(r2, p.oid, 'EXECUTE');
  IF v_acl IS DISTINCT FROM current_setting('reports_v3.client_report_acl') THEN
    RAISE EXCEPTION 'Reports v3 readers: client EXECUTE on report functions changed';
  END IF;
END $postcondition$;
