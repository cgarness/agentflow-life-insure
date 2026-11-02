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
-- Batch 6: the summary, the state reader and the four call readers each run one constant statement per call
-- (EXECUTE ... USING) over the shared call-row block (-- @call-rows, with -- @call-pointers and -- @call-identity),
-- copied byte for byte (reportsV3Contracts.test.ts). The journey reads one member set for the scope and every
-- by_agent row (report_v3_journey_facts_by). report_v3_agent_call_stats keeps its suite; no reader calls it now.
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
     OR to_regprocedure('private.report_v3_journey_facts_by(uuid,uuid[],boolean,text,timestamptz,timestamptz,date,date,timestamptz)') IS NULL
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
  v_calls jsonb;
  v_counts jsonb;
  v_out jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);
  SELECT * INTO sw FROM private.report_v3_sold_window(w.start_date, w.end_date, (v_as_of AT TIME ZONE w.time_zone)::date);
  v_prod := private.report_v3_production(a.org_id, a.agent_ids, sw.sold_from, sw.sold_until, v_as_of);
  -- One pass over the window's calls with identities resolved once per pointer: the scope counts and every agent's
  -- counts and talk time come from one sort. Scope distinct counts read the identity level, agent distinct counts the
  -- identity and agent level; nothing is summed across agents. Only outbound rows count (inbound and other rows carry
  -- no attempt class); an outbound row's credited agent is its placing agent. $1 org, $2 start, $3 end, $4 agent_ids.
  EXECUTE $q$
  WITH
  -- @call-rows begin: every call in [$2, $3) of organization $1, one row each, by the pinned v2 report_call_facts rules
  -- (same rows, same carried columns, reviewed duplicates excluded) plus the v3 evidence columns. The text between the
  -- markers is byte-identical wherever it appears (reportsV3Contracts.test.ts); a reader keeps only what it reads.
  dm AS NOT MATERIALIZED (   -- the organization's dispositions with the stage conversion flag; lower(name) is unique per
            -- organization (dispositions_org_lower_name_unique), so a call matches at most one by id and at most one by
            -- name. Inlined at both references, so the call scan keeps its parallel plan.
    SELECT d.id, lower(d.name) AS lname, d.name, d.color, d.counts_as_contacted, d.dnc_auto_add, d.callback_scheduler,
           d.appointment_scheduler, ps.convert_to_client
      FROM public.dispositions d
      LEFT JOIN public.pipeline_stages ps ON ps.id = d.pipeline_stage_id AND ps.organization_id = $1
     WHERE d.organization_id = $1
  ), cr AS (
    SELECT c.id AS call_id, c.created_at, c.agent_id AS placing_agent_id, c.contact_id, c.contact_type,
           c.campaign_lead_id AS raw_campaign_lead_id, c.contact_phone, c.answered_by_agent_id, c.outcome, c.voicemail_id,
           c.dialer_admission_required, adm.admitted, c.duration AS raw_duration, c.duration_source, c.duration_conflict,
           c.disposition_name AS raw_disposition_name,
           -- v2's classes of lower(coalesce(direction, '')): outbound/outgoing, inbound/incoming, else other. An exact
           -- lower-case value is matched first (lower() leaves it unchanged), so most rows never call lower().
           CASE c.direction WHEN 'outbound' THEN 'outbound' WHEN 'outgoing' THEN 'outbound' WHEN 'inbound' THEN 'inbound'
                WHEN 'incoming' THEN 'inbound'
                ELSE CASE lower(coalesce(c.direction, '')) WHEN 'outbound' THEN 'outbound' WHEN 'outgoing' THEN 'outbound'
                          WHEN 'inbound' THEN 'inbound' WHEN 'incoming' THEN 'inbound' ELSE 'other' END END AS direction_class,
           greatest(coalesce(c.duration, 0), 0)::bigint AS duration_seconds,
           CASE WHEN c.campaign_id IS NOT NULL THEN cmp.id ELSE mc.campaign_id END AS campaign_id,
           coalesce(l1.id, l2.id) AS lead_id,
           coalesce(nullif(btrim(coalesce(l1.lead_source, l2.lead_source)), ''), '(No source)') AS lead_source,
           coalesce(di.id, dn.id) AS resolved_disposition_id,
           coalesce(di.name, dn.name) AS resolved_disposition_name,
           coalesce(di.color, dn.color, '#6B7280') AS disposition_color,
           coalesce(di.counts_as_contacted, dn.counts_as_contacted, false) AS disp_counts_contacted,
           coalesce(di.convert_to_client, dn.convert_to_client, false) AS disp_converts,
           coalesce(di.dnc_auto_add, dn.dnc_auto_add, false) AS disp_dnc,
           coalesce(di.callback_scheduler, dn.callback_scheduler, false) AS disp_callback,
           coalesce(di.appointment_scheduler, dn.appointment_scheduler, false) AS disp_appointment
      FROM public.calls c
      -- v2: by id when the call has one (only an id of this organization matches, with no fallback to the name), else
      -- by lower(name); the stage of whichever matched. Two keyed joins: the uuid, and the lowered name only for calls
      -- without an id.
      LEFT JOIN dm di ON di.id = c.disposition_id
      LEFT JOIN dm dn ON dn.lname = CASE WHEN c.disposition_id IS NULL THEN lower(c.disposition_name) END
      -- v2: the campaign is campaigns(coalesce(call campaign, membership campaign)) in the organization. Two joins, each
      -- provably unique, so a reader that does not read the campaign keeps neither.
      LEFT JOIN public.campaigns cmp ON cmp.id = c.campaign_id AND cmp.organization_id = $1
      LEFT JOIN (SELECT cl.id, (array_agg(k.id))[1] AS campaign_id
                   FROM public.campaign_leads cl
                   JOIN public.campaigns k ON k.id = cl.campaign_id AND k.organization_id = $1
                  GROUP BY cl.id) mc ON mc.id = c.campaign_lead_id
      LEFT JOIN public.leads l1 ON l1.id = c.lead_id AND l1.organization_id = $1
      LEFT JOIN public.leads l2
             ON c.lead_id IS NULL AND l2.id = c.contact_id AND (c.contact_type = 'lead' OR c.contact_type IS NULL)
            AND l2.organization_id = $1
      LEFT JOIN private.dialer_outbound_admissions adm ON adm.organization_id = $1 AND adm.call_id = c.id
     WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3
       AND NOT EXISTS (SELECT 1 FROM private.performance_duplicate_rows d
                        WHERE d.organization_id = $1 AND d.kind = 'call' AND d.duplicate_id = c.id)
  ), cf AS (
    SELECT cr.*,
           CASE WHEN cr.direction_class = 'inbound' THEN coalesce(cr.placing_agent_id, cr.answered_by_agent_id)
                ELSE cr.placing_agent_id END AS credited_agent_id,
           CASE WHEN cr.resolved_disposition_id IS NOT NULL THEN cr.resolved_disposition_id::text
                WHEN nullif(btrim(cr.raw_disposition_name), '') IS NOT NULL THEN 'name:' || lower(btrim(cr.raw_disposition_name))
                ELSE 'none' END AS disposition_key,
           coalesce(cr.resolved_disposition_name, nullif(btrim(cr.raw_disposition_name), ''), '(No disposition)') AS disposition_name,
           CASE WHEN cr.direction_class <> 'outbound' THEN false
                WHEN lower(coalesce(cr.resolved_disposition_name, cr.raw_disposition_name, '')) = 'no answer' THEN false
                WHEN cr.duration_seconds > 45 THEN true
                WHEN cr.disp_counts_contacted THEN true
                ELSE false END AS is_contacted,
           CASE WHEN cr.direction_class <> 'outbound' THEN NULL
                WHEN NOT cr.dialer_admission_required OR cr.admitted IS TRUE THEN 'attempt'
                WHEN cr.admitted IS FALSE THEN 'non_attempt'
                ELSE 'unverified' END AS attempt_class,
           (cr.direction_class = 'inbound' AND (cr.placing_agent_id IS NOT NULL OR cr.outcome = 'forwarded_answered')
              AND cr.voicemail_id IS NULL) AS is_answered_inbound
      FROM cr
  ), cg AS (
    SELECT cf.*,
           coalesce(cf.attempt_class = 'attempt', false) AS is_attempt,
           (coalesce(cf.attempt_class = 'attempt', false) AND cf.is_contacted)
             OR (cf.is_answered_inbound AND CASE WHEN lower(cf.disposition_name) = 'no answer' THEN false
                                                 WHEN cf.duration_seconds > 45 THEN true
                                                 WHEN cf.disp_counts_contacted THEN true
                                                 ELSE false END) AS is_journey_contact,
           (lower(cf.disposition_name) <> 'no answer'
             AND (cf.disp_counts_contacted OR cf.raw_duration IS NULL OR cf.raw_duration > 45)) AS could_qualify,
           public.phone_last10(cf.contact_phone) AS phone_last10
      FROM cf
  ),
  -- @call-rows end
  -- @call-pointers begin: each pointer of the window resolved once (report_v3_contact_identity rules 1–8, its exact
  -- CASE order), one row per pointer. Pointers are read only from calls a scope could credit ($4: placing or answering
  -- agent), a superset of every row a caller keeps. Byte-identical wherever it appears (reportsV3Contracts.test.ts).
  ic AS (   -- contact pointers (rules 1–6)
    SELECT p.id,
           CASE WHEN r.id IS NOT NULL THEN 'recruit'
                WHEN k.id IS NOT NULL THEN CASE WHEN k.lead_id IS NOT NULL THEN 'lead' ELSE 'client' END
                WHEN l.id IS NOT NULL OR kc.id IS NOT NULL OR coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'lead'
           END AS identity_kind,
           CASE WHEN r.id IS NOT NULL THEN r.id
                WHEN k.id IS NOT NULL THEN coalesce(k.lead_id, k.id)
                WHEN l.id IS NOT NULL THEN l.id
                WHEN kc.id IS NOT NULL THEN p.id
                ELSE coalesce(cl.lead_id, lin.original_lead_id)
           END AS identity_uuid,
           CASE WHEN r.id IS NOT NULL THEN 'recruit'
                WHEN k.id IS NOT NULL THEN 'client'
                WHEN l.id IS NOT NULL THEN 'lead'
                WHEN kc.id IS NOT NULL THEN 'converted_lead_pointer'
                WHEN cl.id IS NOT NULL AND coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'legacy_membership_as_contact'
                WHEN cl.id IS NOT NULL THEN 'unresolved_membership_without_lead'
                ELSE 'unresolved_dangling_contact'
           END AS resolution,
           CASE WHEN ck.id IS NOT NULL THEN coalesce((ck.lead_conversion ->> 'converted_at')::timestamptz, ck.created_at) END
             AS converted_at
      FROM (SELECT DISTINCT c.contact_id AS id FROM public.calls c
             WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3 AND c.contact_id IS NOT NULL
               AND ($4::uuid[] IS NULL OR c.agent_id = ANY ($4) OR c.answered_by_agent_id = ANY ($4))) p
      LEFT JOIN public.recruits r ON r.id = p.id AND r.organization_id = $1
      LEFT JOIN public.clients k ON k.id = p.id AND k.organization_id = $1
      LEFT JOIN public.leads l ON l.id = p.id AND l.organization_id = $1
      LEFT JOIN public.clients kc ON kc.lead_id = p.id AND kc.organization_id = $1
      LEFT JOIN public.campaign_leads cl ON cl.id = p.id AND cl.organization_id = $1
      LEFT JOIN private.dialer_conversion_lineage lin ON lin.organization_id = $1 AND lin.campaign_lead_id = p.id
      LEFT JOIN public.clients ck
             ON ck.lead_id = CASE WHEN r.id IS NULL AND (k.id IS NULL OR k.lead_id IS NOT NULL) THEN
                               CASE WHEN k.id IS NOT NULL THEN k.lead_id WHEN l.id IS NOT NULL THEN l.id
                                    WHEN kc.id IS NOT NULL THEN p.id ELSE coalesce(cl.lead_id, lin.original_lead_id) END END
            AND ck.organization_id = $1
  ), im AS (   -- campaign-membership pointers of calls with no contact (rules 7–8)
    SELECT p.id,
           CASE WHEN coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'lead' END AS identity_kind,
           coalesce(cl.lead_id, lin.original_lead_id) AS identity_uuid,
           CASE WHEN cl.lead_id IS NOT NULL THEN 'campaign_membership'
                WHEN lin.original_lead_id IS NOT NULL THEN 'campaign_lineage'
                WHEN cl.id IS NOT NULL THEN 'unresolved_membership_without_lead'
                ELSE 'unresolved_no_link' END AS resolution,
           CASE WHEN ck.id IS NOT NULL THEN coalesce((ck.lead_conversion ->> 'converted_at')::timestamptz, ck.created_at) END
             AS converted_at
      FROM (SELECT DISTINCT c.campaign_lead_id AS id FROM public.calls c
             WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3
               AND c.contact_id IS NULL AND c.campaign_lead_id IS NOT NULL
               AND ($4::uuid[] IS NULL OR c.agent_id = ANY ($4) OR c.answered_by_agent_id = ANY ($4))) p
      LEFT JOIN public.campaign_leads cl ON cl.id = p.id AND cl.organization_id = $1
      LEFT JOIN private.dialer_conversion_lineage lin ON lin.organization_id = $1 AND lin.campaign_lead_id = p.id
      LEFT JOIN public.clients ck ON ck.lead_id = coalesce(cl.lead_id, lin.original_lead_id) AND ck.organization_id = $1
  ),
  -- @call-pointers end
  -- @call-identity begin: each call's identity from its pointer (the contact pointer when the call has one, else its
  -- campaign membership; a recruit contact stays a recruit). identity_key is rebuilt as kind || ':' || uuid, the
  -- resolver's own format. Byte-identical wherever it appears (reportsV3Contracts.test.ts).
  cy AS (
    SELECT cg.*,
           CASE WHEN cg.contact_type = 'recruit' AND cg.contact_id IS NOT NULL THEN 'recruit'
                ELSE coalesce(xc.identity_kind, xm.identity_kind) END AS identity_kind,
           CASE WHEN cg.contact_type = 'recruit' AND cg.contact_id IS NOT NULL THEN cg.contact_id
                ELSE coalesce(xc.identity_uuid, xm.identity_uuid) END AS identity_uuid,
           CASE WHEN cg.contact_type = 'recruit' AND cg.contact_id IS NOT NULL THEN 'recruit'
                ELSE coalesce(xc.resolution, xm.resolution, 'unresolved_no_link') END AS resolution,
           coalesce(xc.converted_at, xm.converted_at) AS converted_at
      FROM cg
      -- The contact pointer when the call has one, else its campaign membership: two single-key hash joins. ic and im
      -- hold one row per pointer (each join above is on a primary or unique key), so DISTINCT ON changes no row; it
      -- tells the planner the key is unique even when the set is materialized for a second reader, so the pointer set
      -- is hashed and the calls stream past it.
      LEFT JOIN (SELECT DISTINCT ON (u.id) u.* FROM ic u) xc ON xc.id = cg.contact_id
      LEFT JOIN (SELECT DISTINCT ON (u.id) u.* FROM im u) xm ON cg.contact_id IS NULL AND xm.id = cg.raw_campaign_lead_id
  ), cx AS (
    SELECT cy.*, cy.identity_kind || ':' || cy.identity_uuid AS identity_key,
           (cy.identity_kind = 'lead' AND (cy.converted_at IS NULL OR cy.created_at < cy.converted_at)) AS is_lead_stage
      FROM cy
  ),
  -- @call-identity end
  pa AS (
    -- Narrow per-call flags first (the sort carries booleans, not text), then one sort serves both the identity and
    -- identity-and-agent levels; one roll-up below reads them as they stream.
    SELECT grouping(y.agent_id) AS g_agent, y.agent_id,
           count(*) FILTER (WHERE y.outbound) AS outbound_rows,
           count(*) FILTER (WHERE y.att) AS attempts,
           count(*) FILTER (WHERE y.non_att) AS non_attempts,
           count(*) FILTER (WHERE y.unv) AS unverified,
           count(*) FILTER (WHERE y.att AND y.con) AS contacted,
           count(*) FILTER (WHERE y.att AND y.con AND NOT y.recruit) AS contacted_eligible,
           count(*) FILTER (WHERE y.att AND y.con AND y.linked) AS contacted_resolved,
           count(*) FILTER (WHERE y.att AND y.con AND y.unresolved) AS contacted_unresolved,
           coalesce(bool_or(y.att AND y.con AND y.linked), false) AS reached,
           count(*) FILTER (WHERE y.att AND y.lead_stage) AS lead_stage_attempts,
           coalesce(bool_or(y.att AND y.lead_stage), false) AS lead_identity,
           count(*) FILTER (WHERE y.att AND y.unresolved) AS unresolved_attempts,
           count(*) FILTER (WHERE y.unv AND (y.lead_stage OR y.unresolved)) AS lead_unverified,
           coalesce(sum(y.duration_seconds) FILTER (WHERE y.att), 0) AS seconds,
           count(*) FILTER (WHERE y.att AND y.estimated) AS estimated,
           count(*) FILTER (WHERE y.att AND y.unknown) AS unknown,
           count(*) FILTER (WHERE y.att AND y.conflicting) AS conflicting,
           count(*) FILTER (WHERE y.att AND y.provider_confirmed) AS provider_confirmed
      FROM (SELECT x.placing_agent_id AS agent_id, CASE x.identity_kind WHEN 'lead' THEN 1 WHEN 'client' THEN 2 WHEN 'recruit' THEN 3 END
                     AS kind_code, x.identity_uuid,
                   x.attempt_class IS NOT NULL AS outbound, x.is_attempt AS att, x.attempt_class = 'non_attempt' AS non_att,
                   x.attempt_class = 'unverified' AS unv, x.is_contacted AS con,
                   coalesce(x.identity_kind = 'recruit', false) AS recruit, coalesce(x.identity_kind IN ('lead', 'client'), false) AS linked,
                   x.identity_kind IS NULL AS unresolved, coalesce(x.is_lead_stage, false) AS lead_stage, x.duration_seconds,
                   x.duration_source = 'elapsed_estimate' AS estimated, x.duration_source = 'legacy_unknown' AS unknown,
                   x.duration_conflict AS conflicting,
                   x.duration_source IN ('provider', 'terminal_non_answer') AND NOT x.duration_conflict AS provider_confirmed
              FROM cx x
             WHERE $4::uuid[] IS NULL OR x.placing_agent_id = ANY ($4)) y
     GROUP BY GROUPING SETS ((y.kind_code, y.identity_uuid, y.agent_id), (y.kind_code, y.identity_uuid))
  ), roll AS MATERIALIZED (
    -- Per agent from the identity-and-agent level; the scope from the identity level (distinct identities, never a sum
    -- of agent rows).
    SELECT p.g_agent, CASE WHEN p.g_agent = 0 THEN p.agent_id END AS agent_id, sum(p.outbound_rows) AS outbound_rows,
           sum(p.attempts) AS attempts, sum(p.non_attempts) AS non_attempts, sum(p.unverified) AS unverified,
           sum(p.contacted) AS contacted, sum(p.contacted_eligible) AS contacted_eligible,
           sum(p.contacted_resolved) AS contacted_resolved, sum(p.contacted_unresolved) AS contacted_unresolved,
           count(*) FILTER (WHERE p.reached) AS reached, sum(p.lead_stage_attempts) AS lead_stage_attempts,
           count(*) FILTER (WHERE p.lead_identity) AS lead_identities, sum(p.unresolved_attempts) AS unresolved_attempts,
           sum(p.lead_unverified) AS lead_unverified, sum(p.seconds) AS seconds, sum(p.estimated) AS estimated,
           sum(p.unknown) AS unknown, sum(p.conflicting) AS conflicting, sum(p.provider_confirmed) AS provider_confirmed
      FROM pa p
     GROUP BY p.g_agent, CASE WHEN p.g_agent = 0 THEN p.agent_id END
  ), ag AS (
    SELECT r.* FROM roll r WHERE r.g_agent = 0 AND r.outbound_rows > 0
  ), sc AS (
    SELECT coalesce(sum(r.attempts), 0) AS attempts, coalesce(sum(r.non_attempts), 0) AS non_attempts,
           coalesce(sum(r.unverified), 0) AS unverified, coalesce(sum(r.contacted), 0) AS contacted,
           coalesce(sum(r.contacted_eligible), 0) AS contacted_eligible, coalesce(sum(r.contacted_resolved), 0) AS contacted_resolved,
           coalesce(sum(r.contacted_unresolved), 0) AS contacted_unresolved, coalesce(sum(r.reached), 0) AS reached,
           coalesce(sum(r.lead_stage_attempts), 0) AS lead_stage_attempts, coalesce(sum(r.lead_identities), 0) AS lead_identities,
           coalesce(sum(r.unresolved_attempts), 0) AS unresolved_attempts, coalesce(sum(r.lead_unverified), 0) AS lead_unverified
      FROM roll r WHERE r.g_agent = 1
  ), dup AS (
    -- Reviewed duplicates in the window, by placing agent: driven from the reviewed rows, one key lookup each.
    SELECT x.agent_id, count(*) AS n
      FROM private.performance_duplicate_rows d
     CROSS JOIN LATERAL (SELECT c.agent_id FROM public.calls c
                          WHERE c.id = d.duplicate_id AND c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3
                            AND ($4::uuid[] IS NULL OR c.agent_id = ANY ($4))) x
     WHERE d.organization_id = $1 AND d.kind = 'call'
     GROUP BY x.agent_id
  )
  SELECT jsonb_build_object(
    'counts', (SELECT jsonb_build_object(
                 'attempts', s.attempts, 'non_attempts', s.non_attempts, 'unverified', s.unverified,
                 'duplicates_excluded', (SELECT coalesce(sum(d.n), 0) FROM dup d),
                 'contacted', s.contacted, 'contacted_eligible', s.contacted_eligible, 'contacted_resolved', s.contacted_resolved,
                 'contacted_unresolved', s.contacted_unresolved, 'reached', s.reached,
                 'lead_stage_attempts', s.lead_stage_attempts, 'lead_identities', s.lead_identities,
                 'unresolved_attempts', s.unresolved_attempts, 'lead_unverified', s.lead_unverified) FROM sc s),
    'stats', coalesce((SELECT jsonb_agg(jsonb_build_object(
                 'agent_id', coalesce(g.agent_id, d.agent_id),
                 'counts', jsonb_build_object(
                   'attempts', coalesce(g.attempts, 0), 'non_attempts', coalesce(g.non_attempts, 0),
                   'unverified', coalesce(g.unverified, 0), 'duplicates_excluded', coalesce(d.n, 0),
                   'contacted', coalesce(g.contacted, 0), 'contacted_eligible', coalesce(g.contacted_eligible, 0),
                   'contacted_resolved', coalesce(g.contacted_resolved, 0), 'contacted_unresolved', coalesce(g.contacted_unresolved, 0),
                   'reached', coalesce(g.reached, 0), 'lead_stage_attempts', coalesce(g.lead_stage_attempts, 0),
                   'lead_identities', coalesce(g.lead_identities, 0), 'unresolved_attempts', coalesce(g.unresolved_attempts, 0),
                   'lead_unverified', coalesce(g.lead_unverified, 0)),
                 'talk', jsonb_build_object(
                   'seconds', coalesce(g.seconds, 0), 'estimated', coalesce(g.estimated, 0), 'unknown', coalesce(g.unknown, 0),
                   'conflicting', coalesce(g.conflicting, 0), 'provider_confirmed', coalesce(g.provider_confirmed, 0),
                   'duplicates_excluded', coalesce(d.n, 0))))
                 FROM ag g
                 FULL JOIN dup d ON coalesce(d.agent_id, '00000000-0000-0000-0000-000000000000'::uuid)
                                  = coalesce(g.agent_id, '00000000-0000-0000-0000-000000000000'::uuid)), '[]'::jsonb))
  $q$ INTO v_calls USING a.org_id, w.start_at, w.end_at, a.agent_ids;
  v_counts := v_calls -> 'counts';

  WITH stats AS MATERIALIZED (
    SELECT (e ->> 'agent_id')::uuid AS agent_id, e -> 'counts' AS counts, e -> 'talk' AS talk
      FROM jsonb_array_elements(v_calls -> 'stats') e
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
  v_scope_facts jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);
  SELECT * INTO sw FROM private.report_v3_sold_window(w.start_date, w.end_date, (v_as_of AT TIME ZONE w.time_zone)::date);

  -- The scope's journey rows are read once (report_v3_journey_facts_by): the scope's counts and each credited agent's
  -- come from the same member rows, each group counting only its own; a roster agent with no members reads the
  -- empty group.
  WITH f AS MATERIALIZED (
    SELECT * FROM private.report_v3_journey_facts_by(a.org_id, a.agent_ids, true, w.time_zone, w.start_at, w.end_at,
                                                     sw.sold_from, sw.sold_until, v_as_of)
  )
  SELECT (SELECT x.facts FROM f x WHERE x.grp = 'scope'),
         coalesce(jsonb_agg(jsonb_build_object(
           'agent_id', r.agent_id, 'name', r.name, 'status', r.status, 'credit', private.report_v3_credit_map('journey'),
           'metrics', private.report_v3_journey_kpis(coalesce(fa.facts, (SELECT x.facts FROM f x WHERE x.grp = 'empty'))))
           ORDER BY lower(r.name) NULLS LAST, r.agent_id), '[]'::jsonb)
    INTO v_scope_facts, v_by_agent
    FROM private.report_v3_roster(a.org_id, a.agent_ids, a.filter_agent_id,
                                  ARRAY(SELECT x.agent_id FROM f x WHERE x.grp = 'agent')) r
    LEFT JOIN f fa ON fa.grp = 'agent' AND fa.agent_id = r.agent_id;

  RETURN private.report_v3_envelope('journey', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
                                    w.time_zone_source, w.start_date, w.end_date, w.start_at, w.end_at)
    || jsonb_build_object(
      'metrics', private.report_v3_journey_kpis(v_scope_facts),
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
  v_body jsonb;
  v_counts jsonb;
  v_call_kpis jsonb;
  v_prod_kpis jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);
  SELECT * INTO sw FROM private.report_v3_sold_window(w.start_date, w.end_date, (v_as_of AT TIME ZONE w.time_zone)::date);

  -- One pass over the window's calls with identities resolved once per pointer; the identity states are read once for
  -- the window's linked identities and the buyers. In-scope attempt rows (an outbound row's credited agent is its
  -- placing agent) are grouped by state group as they stream; call_population comes from the same groups.
  -- $1 org, $2 start, $3 end, $4 agent_ids, $5/$6 sold window, $7 as_of.
  EXECUTE $q$
  WITH
  -- @call-rows begin: every call in [$2, $3) of organization $1, one row each, by the pinned v2 report_call_facts rules
  -- (same rows, same carried columns, reviewed duplicates excluded) plus the v3 evidence columns. The text between the
  -- markers is byte-identical wherever it appears (reportsV3Contracts.test.ts); a reader keeps only what it reads.
  dm AS NOT MATERIALIZED (   -- the organization's dispositions with the stage conversion flag; lower(name) is unique per
            -- organization (dispositions_org_lower_name_unique), so a call matches at most one by id and at most one by
            -- name. Inlined at both references, so the call scan keeps its parallel plan.
    SELECT d.id, lower(d.name) AS lname, d.name, d.color, d.counts_as_contacted, d.dnc_auto_add, d.callback_scheduler,
           d.appointment_scheduler, ps.convert_to_client
      FROM public.dispositions d
      LEFT JOIN public.pipeline_stages ps ON ps.id = d.pipeline_stage_id AND ps.organization_id = $1
     WHERE d.organization_id = $1
  ), cr AS (
    SELECT c.id AS call_id, c.created_at, c.agent_id AS placing_agent_id, c.contact_id, c.contact_type,
           c.campaign_lead_id AS raw_campaign_lead_id, c.contact_phone, c.answered_by_agent_id, c.outcome, c.voicemail_id,
           c.dialer_admission_required, adm.admitted, c.duration AS raw_duration, c.duration_source, c.duration_conflict,
           c.disposition_name AS raw_disposition_name,
           -- v2's classes of lower(coalesce(direction, '')): outbound/outgoing, inbound/incoming, else other. An exact
           -- lower-case value is matched first (lower() leaves it unchanged), so most rows never call lower().
           CASE c.direction WHEN 'outbound' THEN 'outbound' WHEN 'outgoing' THEN 'outbound' WHEN 'inbound' THEN 'inbound'
                WHEN 'incoming' THEN 'inbound'
                ELSE CASE lower(coalesce(c.direction, '')) WHEN 'outbound' THEN 'outbound' WHEN 'outgoing' THEN 'outbound'
                          WHEN 'inbound' THEN 'inbound' WHEN 'incoming' THEN 'inbound' ELSE 'other' END END AS direction_class,
           greatest(coalesce(c.duration, 0), 0)::bigint AS duration_seconds,
           CASE WHEN c.campaign_id IS NOT NULL THEN cmp.id ELSE mc.campaign_id END AS campaign_id,
           coalesce(l1.id, l2.id) AS lead_id,
           coalesce(nullif(btrim(coalesce(l1.lead_source, l2.lead_source)), ''), '(No source)') AS lead_source,
           coalesce(di.id, dn.id) AS resolved_disposition_id,
           coalesce(di.name, dn.name) AS resolved_disposition_name,
           coalesce(di.color, dn.color, '#6B7280') AS disposition_color,
           coalesce(di.counts_as_contacted, dn.counts_as_contacted, false) AS disp_counts_contacted,
           coalesce(di.convert_to_client, dn.convert_to_client, false) AS disp_converts,
           coalesce(di.dnc_auto_add, dn.dnc_auto_add, false) AS disp_dnc,
           coalesce(di.callback_scheduler, dn.callback_scheduler, false) AS disp_callback,
           coalesce(di.appointment_scheduler, dn.appointment_scheduler, false) AS disp_appointment
      FROM public.calls c
      -- v2: by id when the call has one (only an id of this organization matches, with no fallback to the name), else
      -- by lower(name); the stage of whichever matched. Two keyed joins: the uuid, and the lowered name only for calls
      -- without an id.
      LEFT JOIN dm di ON di.id = c.disposition_id
      LEFT JOIN dm dn ON dn.lname = CASE WHEN c.disposition_id IS NULL THEN lower(c.disposition_name) END
      -- v2: the campaign is campaigns(coalesce(call campaign, membership campaign)) in the organization. Two joins, each
      -- provably unique, so a reader that does not read the campaign keeps neither.
      LEFT JOIN public.campaigns cmp ON cmp.id = c.campaign_id AND cmp.organization_id = $1
      LEFT JOIN (SELECT cl.id, (array_agg(k.id))[1] AS campaign_id
                   FROM public.campaign_leads cl
                   JOIN public.campaigns k ON k.id = cl.campaign_id AND k.organization_id = $1
                  GROUP BY cl.id) mc ON mc.id = c.campaign_lead_id
      LEFT JOIN public.leads l1 ON l1.id = c.lead_id AND l1.organization_id = $1
      LEFT JOIN public.leads l2
             ON c.lead_id IS NULL AND l2.id = c.contact_id AND (c.contact_type = 'lead' OR c.contact_type IS NULL)
            AND l2.organization_id = $1
      LEFT JOIN private.dialer_outbound_admissions adm ON adm.organization_id = $1 AND adm.call_id = c.id
     WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3
       AND NOT EXISTS (SELECT 1 FROM private.performance_duplicate_rows d
                        WHERE d.organization_id = $1 AND d.kind = 'call' AND d.duplicate_id = c.id)
  ), cf AS (
    SELECT cr.*,
           CASE WHEN cr.direction_class = 'inbound' THEN coalesce(cr.placing_agent_id, cr.answered_by_agent_id)
                ELSE cr.placing_agent_id END AS credited_agent_id,
           CASE WHEN cr.resolved_disposition_id IS NOT NULL THEN cr.resolved_disposition_id::text
                WHEN nullif(btrim(cr.raw_disposition_name), '') IS NOT NULL THEN 'name:' || lower(btrim(cr.raw_disposition_name))
                ELSE 'none' END AS disposition_key,
           coalesce(cr.resolved_disposition_name, nullif(btrim(cr.raw_disposition_name), ''), '(No disposition)') AS disposition_name,
           CASE WHEN cr.direction_class <> 'outbound' THEN false
                WHEN lower(coalesce(cr.resolved_disposition_name, cr.raw_disposition_name, '')) = 'no answer' THEN false
                WHEN cr.duration_seconds > 45 THEN true
                WHEN cr.disp_counts_contacted THEN true
                ELSE false END AS is_contacted,
           CASE WHEN cr.direction_class <> 'outbound' THEN NULL
                WHEN NOT cr.dialer_admission_required OR cr.admitted IS TRUE THEN 'attempt'
                WHEN cr.admitted IS FALSE THEN 'non_attempt'
                ELSE 'unverified' END AS attempt_class,
           (cr.direction_class = 'inbound' AND (cr.placing_agent_id IS NOT NULL OR cr.outcome = 'forwarded_answered')
              AND cr.voicemail_id IS NULL) AS is_answered_inbound
      FROM cr
  ), cg AS (
    SELECT cf.*,
           coalesce(cf.attempt_class = 'attempt', false) AS is_attempt,
           (coalesce(cf.attempt_class = 'attempt', false) AND cf.is_contacted)
             OR (cf.is_answered_inbound AND CASE WHEN lower(cf.disposition_name) = 'no answer' THEN false
                                                 WHEN cf.duration_seconds > 45 THEN true
                                                 WHEN cf.disp_counts_contacted THEN true
                                                 ELSE false END) AS is_journey_contact,
           (lower(cf.disposition_name) <> 'no answer'
             AND (cf.disp_counts_contacted OR cf.raw_duration IS NULL OR cf.raw_duration > 45)) AS could_qualify,
           public.phone_last10(cf.contact_phone) AS phone_last10
      FROM cf
  ),
  -- @call-rows end
  -- @call-pointers begin: each pointer of the window resolved once (report_v3_contact_identity rules 1–8, its exact
  -- CASE order), one row per pointer. Pointers are read only from calls a scope could credit ($4: placing or answering
  -- agent), a superset of every row a caller keeps. Byte-identical wherever it appears (reportsV3Contracts.test.ts).
  ic AS (   -- contact pointers (rules 1–6)
    SELECT p.id,
           CASE WHEN r.id IS NOT NULL THEN 'recruit'
                WHEN k.id IS NOT NULL THEN CASE WHEN k.lead_id IS NOT NULL THEN 'lead' ELSE 'client' END
                WHEN l.id IS NOT NULL OR kc.id IS NOT NULL OR coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'lead'
           END AS identity_kind,
           CASE WHEN r.id IS NOT NULL THEN r.id
                WHEN k.id IS NOT NULL THEN coalesce(k.lead_id, k.id)
                WHEN l.id IS NOT NULL THEN l.id
                WHEN kc.id IS NOT NULL THEN p.id
                ELSE coalesce(cl.lead_id, lin.original_lead_id)
           END AS identity_uuid,
           CASE WHEN r.id IS NOT NULL THEN 'recruit'
                WHEN k.id IS NOT NULL THEN 'client'
                WHEN l.id IS NOT NULL THEN 'lead'
                WHEN kc.id IS NOT NULL THEN 'converted_lead_pointer'
                WHEN cl.id IS NOT NULL AND coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'legacy_membership_as_contact'
                WHEN cl.id IS NOT NULL THEN 'unresolved_membership_without_lead'
                ELSE 'unresolved_dangling_contact'
           END AS resolution,
           CASE WHEN ck.id IS NOT NULL THEN coalesce((ck.lead_conversion ->> 'converted_at')::timestamptz, ck.created_at) END
             AS converted_at
      FROM (SELECT DISTINCT c.contact_id AS id FROM public.calls c
             WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3 AND c.contact_id IS NOT NULL
               AND ($4::uuid[] IS NULL OR c.agent_id = ANY ($4) OR c.answered_by_agent_id = ANY ($4))) p
      LEFT JOIN public.recruits r ON r.id = p.id AND r.organization_id = $1
      LEFT JOIN public.clients k ON k.id = p.id AND k.organization_id = $1
      LEFT JOIN public.leads l ON l.id = p.id AND l.organization_id = $1
      LEFT JOIN public.clients kc ON kc.lead_id = p.id AND kc.organization_id = $1
      LEFT JOIN public.campaign_leads cl ON cl.id = p.id AND cl.organization_id = $1
      LEFT JOIN private.dialer_conversion_lineage lin ON lin.organization_id = $1 AND lin.campaign_lead_id = p.id
      LEFT JOIN public.clients ck
             ON ck.lead_id = CASE WHEN r.id IS NULL AND (k.id IS NULL OR k.lead_id IS NOT NULL) THEN
                               CASE WHEN k.id IS NOT NULL THEN k.lead_id WHEN l.id IS NOT NULL THEN l.id
                                    WHEN kc.id IS NOT NULL THEN p.id ELSE coalesce(cl.lead_id, lin.original_lead_id) END END
            AND ck.organization_id = $1
  ), im AS (   -- campaign-membership pointers of calls with no contact (rules 7–8)
    SELECT p.id,
           CASE WHEN coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'lead' END AS identity_kind,
           coalesce(cl.lead_id, lin.original_lead_id) AS identity_uuid,
           CASE WHEN cl.lead_id IS NOT NULL THEN 'campaign_membership'
                WHEN lin.original_lead_id IS NOT NULL THEN 'campaign_lineage'
                WHEN cl.id IS NOT NULL THEN 'unresolved_membership_without_lead'
                ELSE 'unresolved_no_link' END AS resolution,
           CASE WHEN ck.id IS NOT NULL THEN coalesce((ck.lead_conversion ->> 'converted_at')::timestamptz, ck.created_at) END
             AS converted_at
      FROM (SELECT DISTINCT c.campaign_lead_id AS id FROM public.calls c
             WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3
               AND c.contact_id IS NULL AND c.campaign_lead_id IS NOT NULL
               AND ($4::uuid[] IS NULL OR c.agent_id = ANY ($4) OR c.answered_by_agent_id = ANY ($4))) p
      LEFT JOIN public.campaign_leads cl ON cl.id = p.id AND cl.organization_id = $1
      LEFT JOIN private.dialer_conversion_lineage lin ON lin.organization_id = $1 AND lin.campaign_lead_id = p.id
      LEFT JOIN public.clients ck ON ck.lead_id = coalesce(cl.lead_id, lin.original_lead_id) AND ck.organization_id = $1
  ),
  -- @call-pointers end
  pol_f AS MATERIALIZED (
    SELECT s.recorded_at, s.monthly_premium, s.premium_state, s.buyer_id,
           private.report_v3_client_identity_key($1, s.buyer_id) AS identity_key
      FROM private.report_v3_sale_facts($1, $4, $5, $6) s
     WHERE s.recorded_at <= $7
  ), ist AS MATERIALIZED (
    SELECT * FROM private.report_v3_identity_states($1, ARRAY(
      SELECT x.identity_kind || ':' || x.identity_uuid FROM ic x WHERE x.identity_kind IN ('lead', 'client')
      UNION SELECT x.identity_kind || ':' || x.identity_uuid FROM im x WHERE x.identity_kind IN ('lead', 'client')
      UNION SELECT p.identity_key FROM pol_f p WHERE p.identity_key LIKE 'lead:%' OR p.identity_key LIKE 'client:%'))
  ), sp_c AS MATERIALIZED (   -- each contact pointer once: its identity kind and that identity's state
    SELECT p.id, p.identity_kind, i.identity_key AS state_key, i.state_code, i.reason, i.basis, i.last_state_change_at
      FROM ic p
      -- One row per key (report_v3_identity_states), declared to the planner so the states are hashed.
      LEFT JOIN (SELECT DISTINCT ON (u.identity_key) u.* FROM ist u) i
             ON p.identity_kind IN ('lead', 'client') AND i.identity_key = p.identity_kind || ':' || p.identity_uuid
  ), sp_m AS MATERIALIZED (   -- each campaign-membership pointer once, likewise
    SELECT p.id, p.identity_kind, i.identity_key AS state_key, i.state_code, i.reason, i.basis, i.last_state_change_at
      FROM im p
      LEFT JOIN (SELECT DISTINCT ON (u.identity_key) u.* FROM ist u) i
             ON p.identity_kind IN ('lead', 'client') AND i.identity_key = p.identity_kind || ':' || p.identity_uuid
  ), pg AS (
    -- In-scope rows grouped by pointer before any state is attached. A row is later than its identity's last state
    -- change when the pointer's identity has a current-record state whose last change follows the row.
    SELECT cg.contact_id IS NOT NULL AS by_contact, coalesce(cg.contact_id, cg.raw_campaign_lead_id) AS pid,
           coalesce(cg.contact_type = 'recruit' AND cg.contact_id IS NOT NULL, false) AS recruit_contact,
           cg.attempt_class, cg.is_contacted,
           coalesce(CASE WHEN cg.contact_id IS NOT NULL THEN tc.last_state_change_at ELSE tm.last_state_change_at END
                      > cg.created_at, false) AS before_change,
           count(*) AS n
      FROM cg
      LEFT JOIN (SELECT DISTINCT ON (u.id) u.id, u.last_state_change_at FROM sp_c u
                  WHERE u.basis = 'current_record' AND u.state_code IS NOT NULL AND u.last_state_change_at IS NOT NULL) tc
             ON tc.id = cg.contact_id
      LEFT JOIN (SELECT DISTINCT ON (u.id) u.id, u.last_state_change_at FROM sp_m u
                  WHERE u.basis = 'current_record' AND u.state_code IS NOT NULL AND u.last_state_change_at IS NOT NULL) tm
             ON cg.contact_id IS NULL AND tm.id = cg.raw_campaign_lead_id
     WHERE $4::uuid[] IS NULL OR cg.placing_agent_id = ANY ($4)
     GROUP BY 1, 2, 3, 4, 5, 6
  ), call_g AS MATERIALIZED (
    -- Each pointer group takes its pointer's state exactly as cy/cx attach identities: the contact pointer when the call
    -- has one, else its campaign membership, and a recruit contact is a non-prospect.
    SELECT y.state_code, y.reason, y.attempt_class,
           sum(y.n)::bigint AS rows_, coalesce(sum(y.n) FILTER (WHERE y.is_contacted), 0)::bigint AS contacted_calls,
           coalesce(sum(y.n) FILTER (WHERE y.basis = 'current_record'), 0)::bigint AS b_current,
           coalesce(sum(y.n) FILTER (WHERE y.basis = 'campaign_copy'), 0)::bigint AS b_copy,
           coalesce(sum(y.n) FILTER (WHERE y.changed_after), 0)::bigint AS changed_after
      FROM (SELECT z.attempt_class, z.is_contacted, z.n,
                   CASE WHEN z.recruit THEN NULL ELSE z.state_code END AS state_code,
                   CASE WHEN z.recruit THEN 'non_prospect_contact'
                        WHEN z.state_key IS NULL THEN 'unresolved_identity' ELSE z.reason END AS reason,
                   CASE WHEN NOT z.recruit AND z.state_code IS NOT NULL THEN z.basis END AS basis,
                   NOT z.recruit AND z.basis IS NOT DISTINCT FROM 'current_record' AND z.state_code IS NOT NULL
                     AND z.before_change AS changed_after
              FROM (SELECT g.attempt_class, g.is_contacted, g.n, g.before_change,
                           g.recruit_contact OR coalesce(CASE WHEN g.by_contact THEN xc.identity_kind ELSE xm.identity_kind END
                                                         = 'recruit', false) AS recruit,
                           CASE WHEN g.by_contact THEN xc.state_key ELSE xm.state_key END AS state_key,
                           CASE WHEN g.by_contact THEN xc.state_code ELSE xm.state_code END AS state_code,
                           CASE WHEN g.by_contact THEN xc.reason ELSE xm.reason END AS reason,
                           CASE WHEN g.by_contact THEN xc.basis ELSE xm.basis END AS basis
                      FROM pg g
                      -- sp_c/sp_m hold one row per pointer, declared to the planner so the pointers are hashed.
                      LEFT JOIN (SELECT DISTINCT ON (u.id) u.* FROM sp_c u) xc ON g.by_contact AND xc.id = g.pid
                      LEFT JOIN (SELECT DISTINCT ON (u.id) u.* FROM sp_m u) xm ON NOT g.by_contact AND xm.id = g.pid) z) y
     GROUP BY 1, 2, 3
  ), att_g AS (
    SELECT g.state_code, g.reason, sum(g.rows_) AS calls_made, sum(g.contacted_calls) AS contacted_calls,
           sum(g.b_current) AS b_current, sum(g.b_copy) AS b_copy, sum(g.changed_after) AS changed_after
      FROM call_g g WHERE g.attempt_class = 'attempt' GROUP BY 1, 2
  ), pol_rows AS (
    SELECT p.monthly_premium, p.premium_state,
           CASE WHEN p.identity_key LIKE 'recruit:%' THEN NULL ELSE i.state_code END AS state_code,
           CASE WHEN p.identity_key LIKE 'recruit:%' THEN 'non_prospect_contact'
                WHEN i.identity_key IS NULL THEN 'unresolved_identity' ELSE i.reason END AS reason,
           CASE WHEN p.identity_key NOT LIKE 'recruit:%' AND i.state_code IS NOT NULL THEN i.basis END AS basis,
           coalesce(p.identity_key NOT LIKE 'recruit:%' AND i.basis = 'current_record' AND i.state_code IS NOT NULL
                    AND i.last_state_change_at > p.recorded_at, false) AS changed_after
      FROM pol_f p LEFT JOIN ist i ON i.identity_key = p.identity_key
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
  SELECT jsonb_build_object(
           -- KPI 1 and 2 statuses (the modes) from the same facts and counts report_v3_production totals them with.
           'production', (SELECT jsonb_build_object(
                            'policy_count', count(*), 'buyer_count', count(DISTINCT p.buyer_id),
                            'known_count', count(*) FILTER (WHERE p.premium_state = 'known'),
                            'missing_count', count(*) FILTER (WHERE p.premium_state = 'missing'),
                            'invalid_count', count(*) FILTER (WHERE p.premium_state = 'invalid'),
                            'annual_premium', coalesce(sum(p.monthly_premium * 12) FILTER (WHERE p.premium_state = 'known'), 0))
                            FROM pol_f p),
           'counts', (SELECT jsonb_build_object(
                        'attempts', coalesce(sum(g.rows_) FILTER (WHERE g.attempt_class = 'attempt'), 0),
                        'non_attempts', coalesce(sum(g.rows_) FILTER (WHERE g.attempt_class = 'non_attempt'), 0),
                        'unverified', coalesce(sum(g.rows_) FILTER (WHERE g.attempt_class = 'unverified'), 0),
                        'contacted', coalesce(sum(g.contacted_calls) FILTER (WHERE g.attempt_class = 'attempt'), 0)) FROM call_g g),
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
               LEFT JOIN att_g cg ON cg.state_code = j.code
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
               LEFT JOIN att_g cg ON cg.state_code IS NULL AND cg.reason = r.reason
               LEFT JOIN pol_g pg ON pg.state_code IS NULL AND pg.reason = r.reason),
           'totals', (
             SELECT jsonb_build_object(
                      'calls_made', (SELECT coalesce(sum(cg.calls_made), 0) FROM att_g cg),
                      'contacted_calls', (SELECT coalesce(sum(cg.contacted_calls), 0) FROM att_g cg),
                      'policies_sold', count(*),
                      'premium', jsonb_build_object(
                        'policy_count', count(*), 'known_count', count(*) FILTER (WHERE p.premium_state = 'known'),
                        'missing_count', count(*) FILTER (WHERE p.premium_state = 'missing'),
                        'invalid_count', count(*) FILTER (WHERE p.premium_state = 'invalid'),
                        'annual_premium', CASE WHEN count(*) = 0 THEN 0
                                               WHEN count(*) FILTER (WHERE p.premium_state = 'known') = 0 THEN NULL
                                               ELSE sum(p.monthly_premium * 12) FILTER (WHERE p.premium_state = 'known') END))
               FROM pol_f p))
  $q$ INTO v_body USING a.org_id, w.start_at, w.end_at, a.agent_ids, sw.sold_from, sw.sold_until, v_as_of;
  v_counts := (v_body -> 'counts') || jsonb_build_object(
    'duplicates_excluded', private.report_v3_duplicates_excluded(a.org_id, a.agent_ids, w.start_at, w.end_at));
  v_call_kpis := private.report_v3_attempt_kpis(v_counts);
  v_prod_kpis := private.report_v3_production_kpis(v_body -> 'production');

  RETURN private.report_v3_envelope('state_breakdown', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
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
           'jurisdictions', v_body -> 'jurisdictions',
           'unmapped', v_body -> 'unmapped',
           'totals', v_body -> 'totals');
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
  v_body jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);

  -- One pass over the window. EXECUTE plans the constant text for this call's actual bounds (a cached generic
  -- plan would assume a tiny window). $1 org, $2 start, $3 end, $4 agent_ids, $5 time zone, $6/$7 window dates.
  EXECUTE $q$
  WITH
  -- @call-rows begin: every call in [$2, $3) of organization $1, one row each, by the pinned v2 report_call_facts rules
  -- (same rows, same carried columns, reviewed duplicates excluded) plus the v3 evidence columns. The text between the
  -- markers is byte-identical wherever it appears (reportsV3Contracts.test.ts); a reader keeps only what it reads.
  dm AS NOT MATERIALIZED (   -- the organization's dispositions with the stage conversion flag; lower(name) is unique per
            -- organization (dispositions_org_lower_name_unique), so a call matches at most one by id and at most one by
            -- name. Inlined at both references, so the call scan keeps its parallel plan.
    SELECT d.id, lower(d.name) AS lname, d.name, d.color, d.counts_as_contacted, d.dnc_auto_add, d.callback_scheduler,
           d.appointment_scheduler, ps.convert_to_client
      FROM public.dispositions d
      LEFT JOIN public.pipeline_stages ps ON ps.id = d.pipeline_stage_id AND ps.organization_id = $1
     WHERE d.organization_id = $1
  ), cr AS (
    SELECT c.id AS call_id, c.created_at, c.agent_id AS placing_agent_id, c.contact_id, c.contact_type,
           c.campaign_lead_id AS raw_campaign_lead_id, c.contact_phone, c.answered_by_agent_id, c.outcome, c.voicemail_id,
           c.dialer_admission_required, adm.admitted, c.duration AS raw_duration, c.duration_source, c.duration_conflict,
           c.disposition_name AS raw_disposition_name,
           -- v2's classes of lower(coalesce(direction, '')): outbound/outgoing, inbound/incoming, else other. An exact
           -- lower-case value is matched first (lower() leaves it unchanged), so most rows never call lower().
           CASE c.direction WHEN 'outbound' THEN 'outbound' WHEN 'outgoing' THEN 'outbound' WHEN 'inbound' THEN 'inbound'
                WHEN 'incoming' THEN 'inbound'
                ELSE CASE lower(coalesce(c.direction, '')) WHEN 'outbound' THEN 'outbound' WHEN 'outgoing' THEN 'outbound'
                          WHEN 'inbound' THEN 'inbound' WHEN 'incoming' THEN 'inbound' ELSE 'other' END END AS direction_class,
           greatest(coalesce(c.duration, 0), 0)::bigint AS duration_seconds,
           CASE WHEN c.campaign_id IS NOT NULL THEN cmp.id ELSE mc.campaign_id END AS campaign_id,
           coalesce(l1.id, l2.id) AS lead_id,
           coalesce(nullif(btrim(coalesce(l1.lead_source, l2.lead_source)), ''), '(No source)') AS lead_source,
           coalesce(di.id, dn.id) AS resolved_disposition_id,
           coalesce(di.name, dn.name) AS resolved_disposition_name,
           coalesce(di.color, dn.color, '#6B7280') AS disposition_color,
           coalesce(di.counts_as_contacted, dn.counts_as_contacted, false) AS disp_counts_contacted,
           coalesce(di.convert_to_client, dn.convert_to_client, false) AS disp_converts,
           coalesce(di.dnc_auto_add, dn.dnc_auto_add, false) AS disp_dnc,
           coalesce(di.callback_scheduler, dn.callback_scheduler, false) AS disp_callback,
           coalesce(di.appointment_scheduler, dn.appointment_scheduler, false) AS disp_appointment
      FROM public.calls c
      -- v2: by id when the call has one (only an id of this organization matches, with no fallback to the name), else
      -- by lower(name); the stage of whichever matched. Two keyed joins: the uuid, and the lowered name only for calls
      -- without an id.
      LEFT JOIN dm di ON di.id = c.disposition_id
      LEFT JOIN dm dn ON dn.lname = CASE WHEN c.disposition_id IS NULL THEN lower(c.disposition_name) END
      -- v2: the campaign is campaigns(coalesce(call campaign, membership campaign)) in the organization. Two joins, each
      -- provably unique, so a reader that does not read the campaign keeps neither.
      LEFT JOIN public.campaigns cmp ON cmp.id = c.campaign_id AND cmp.organization_id = $1
      LEFT JOIN (SELECT cl.id, (array_agg(k.id))[1] AS campaign_id
                   FROM public.campaign_leads cl
                   JOIN public.campaigns k ON k.id = cl.campaign_id AND k.organization_id = $1
                  GROUP BY cl.id) mc ON mc.id = c.campaign_lead_id
      LEFT JOIN public.leads l1 ON l1.id = c.lead_id AND l1.organization_id = $1
      LEFT JOIN public.leads l2
             ON c.lead_id IS NULL AND l2.id = c.contact_id AND (c.contact_type = 'lead' OR c.contact_type IS NULL)
            AND l2.organization_id = $1
      LEFT JOIN private.dialer_outbound_admissions adm ON adm.organization_id = $1 AND adm.call_id = c.id
     WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3
       AND NOT EXISTS (SELECT 1 FROM private.performance_duplicate_rows d
                        WHERE d.organization_id = $1 AND d.kind = 'call' AND d.duplicate_id = c.id)
  ), cf AS (
    SELECT cr.*,
           CASE WHEN cr.direction_class = 'inbound' THEN coalesce(cr.placing_agent_id, cr.answered_by_agent_id)
                ELSE cr.placing_agent_id END AS credited_agent_id,
           CASE WHEN cr.resolved_disposition_id IS NOT NULL THEN cr.resolved_disposition_id::text
                WHEN nullif(btrim(cr.raw_disposition_name), '') IS NOT NULL THEN 'name:' || lower(btrim(cr.raw_disposition_name))
                ELSE 'none' END AS disposition_key,
           coalesce(cr.resolved_disposition_name, nullif(btrim(cr.raw_disposition_name), ''), '(No disposition)') AS disposition_name,
           CASE WHEN cr.direction_class <> 'outbound' THEN false
                WHEN lower(coalesce(cr.resolved_disposition_name, cr.raw_disposition_name, '')) = 'no answer' THEN false
                WHEN cr.duration_seconds > 45 THEN true
                WHEN cr.disp_counts_contacted THEN true
                ELSE false END AS is_contacted,
           CASE WHEN cr.direction_class <> 'outbound' THEN NULL
                WHEN NOT cr.dialer_admission_required OR cr.admitted IS TRUE THEN 'attempt'
                WHEN cr.admitted IS FALSE THEN 'non_attempt'
                ELSE 'unverified' END AS attempt_class,
           (cr.direction_class = 'inbound' AND (cr.placing_agent_id IS NOT NULL OR cr.outcome = 'forwarded_answered')
              AND cr.voicemail_id IS NULL) AS is_answered_inbound
      FROM cr
  ), cg AS (
    SELECT cf.*,
           coalesce(cf.attempt_class = 'attempt', false) AS is_attempt,
           (coalesce(cf.attempt_class = 'attempt', false) AND cf.is_contacted)
             OR (cf.is_answered_inbound AND CASE WHEN lower(cf.disposition_name) = 'no answer' THEN false
                                                 WHEN cf.duration_seconds > 45 THEN true
                                                 WHEN cf.disp_counts_contacted THEN true
                                                 ELSE false END) AS is_journey_contact,
           (lower(cf.disposition_name) <> 'no answer'
             AND (cf.disp_counts_contacted OR cf.raw_duration IS NULL OR cf.raw_duration > 45)) AS could_qualify,
           public.phone_last10(cf.contact_phone) AS phone_last10
      FROM cf
  ),
  -- @call-rows end
  hc AS MATERIALIZED (
    SELECT (cg.created_at AT TIME ZONE $5)::date AS local_date, extract(hour FROM cg.created_at AT TIME ZONE $5)::int AS hour_of_day,
           count(*) FILTER (WHERE cg.is_attempt) AS calls_made,
           count(*) FILTER (WHERE cg.is_attempt AND cg.is_contacted) AS contacted,
           count(*) FILTER (WHERE cg.direction_class = 'inbound') AS inbound_calls,
           coalesce(sum(cg.duration_seconds) FILTER (WHERE cg.is_attempt), 0) AS talk_time_seconds,
           count(*) FILTER (WHERE cg.direction_class = 'outbound' AND cg.is_attempt) AS attempts,
           count(*) FILTER (WHERE cg.direction_class = 'outbound' AND cg.attempt_class = 'non_attempt') AS non_attempts,
           count(*) FILTER (WHERE cg.direction_class = 'outbound' AND cg.attempt_class = 'unverified') AS unverified
      FROM cg
     WHERE $4::uuid[] IS NULL OR cg.credited_agent_id = ANY ($4)
     GROUP BY 1, 2
  ), cells AS (
    SELECT extract(dow FROM hc.local_date)::int AS dow, hc.hour_of_day, sum(hc.calls_made) AS calls_made, sum(hc.contacted) AS contacted
      FROM hc GROUP BY 1, 2
  ), day_calls AS (
    SELECT hc.local_date, sum(hc.calls_made) AS calls_made, sum(hc.contacted) AS contacted, sum(hc.inbound_calls) AS inbound_calls,
           sum(hc.talk_time_seconds) AS talk_time_seconds
      FROM hc GROUP BY 1
  )
  SELECT jsonb_build_object(
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
                         FROM (SELECT d::date AS local_date FROM generate_series($6::timestamp, $7::timestamp, interval '1 day') d) dy
                         LEFT JOIN day_calls dc ON dc.local_date = dy.local_date),
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
           'inbound_calls', (SELECT coalesce(sum(hc.inbound_calls), 0) FROM hc),
           'call_population', (SELECT jsonb_build_object('attempts', coalesce(sum(hc.attempts), 0),
                                                         'non_attempts', coalesce(sum(hc.non_attempts), 0),
                                                         'unverified', coalesce(sum(hc.unverified), 0)) FROM hc))
  $q$ INTO v_body USING a.org_id, w.start_at, w.end_at, a.agent_ids, w.time_zone, w.start_date, w.end_date;

  RETURN private.report_v3_envelope('call_volume', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
                                    w.time_zone_source, w.start_date, w.end_date, w.start_at, w.end_at)
         || jsonb_build_object('metrics', '[]'::jsonb) || v_body
         || jsonb_build_object('call_population', (v_body -> 'call_population') || jsonb_build_object(
              'duplicates_excluded', private.report_v3_duplicates_excluded(a.org_id, a.agent_ids, w.start_at, w.end_at)));
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
  v_visible uuid[];
  v_body jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);
  SELECT coalesce(array_agg(v.campaign_id), '{}') INTO v_visible FROM private.report_visible_campaigns(a.org_id) v;

  -- One pass over the window's in-scope outbound rows, grouped once; every view and call_population reads the
  -- groups. $1 org, $2 start, $3 end, $4 agent_ids, $5 campaigns visible to the viewer.
  EXECUTE $q$
  WITH
  -- @call-rows begin: every call in [$2, $3) of organization $1, one row each, by the pinned v2 report_call_facts rules
  -- (same rows, same carried columns, reviewed duplicates excluded) plus the v3 evidence columns. The text between the
  -- markers is byte-identical wherever it appears (reportsV3Contracts.test.ts); a reader keeps only what it reads.
  dm AS NOT MATERIALIZED (   -- the organization's dispositions with the stage conversion flag; lower(name) is unique per
            -- organization (dispositions_org_lower_name_unique), so a call matches at most one by id and at most one by
            -- name. Inlined at both references, so the call scan keeps its parallel plan.
    SELECT d.id, lower(d.name) AS lname, d.name, d.color, d.counts_as_contacted, d.dnc_auto_add, d.callback_scheduler,
           d.appointment_scheduler, ps.convert_to_client
      FROM public.dispositions d
      LEFT JOIN public.pipeline_stages ps ON ps.id = d.pipeline_stage_id AND ps.organization_id = $1
     WHERE d.organization_id = $1
  ), cr AS (
    SELECT c.id AS call_id, c.created_at, c.agent_id AS placing_agent_id, c.contact_id, c.contact_type,
           c.campaign_lead_id AS raw_campaign_lead_id, c.contact_phone, c.answered_by_agent_id, c.outcome, c.voicemail_id,
           c.dialer_admission_required, adm.admitted, c.duration AS raw_duration, c.duration_source, c.duration_conflict,
           c.disposition_name AS raw_disposition_name,
           -- v2's classes of lower(coalesce(direction, '')): outbound/outgoing, inbound/incoming, else other. An exact
           -- lower-case value is matched first (lower() leaves it unchanged), so most rows never call lower().
           CASE c.direction WHEN 'outbound' THEN 'outbound' WHEN 'outgoing' THEN 'outbound' WHEN 'inbound' THEN 'inbound'
                WHEN 'incoming' THEN 'inbound'
                ELSE CASE lower(coalesce(c.direction, '')) WHEN 'outbound' THEN 'outbound' WHEN 'outgoing' THEN 'outbound'
                          WHEN 'inbound' THEN 'inbound' WHEN 'incoming' THEN 'inbound' ELSE 'other' END END AS direction_class,
           greatest(coalesce(c.duration, 0), 0)::bigint AS duration_seconds,
           CASE WHEN c.campaign_id IS NOT NULL THEN cmp.id ELSE mc.campaign_id END AS campaign_id,
           coalesce(l1.id, l2.id) AS lead_id,
           coalesce(nullif(btrim(coalesce(l1.lead_source, l2.lead_source)), ''), '(No source)') AS lead_source,
           coalesce(di.id, dn.id) AS resolved_disposition_id,
           coalesce(di.name, dn.name) AS resolved_disposition_name,
           coalesce(di.color, dn.color, '#6B7280') AS disposition_color,
           coalesce(di.counts_as_contacted, dn.counts_as_contacted, false) AS disp_counts_contacted,
           coalesce(di.convert_to_client, dn.convert_to_client, false) AS disp_converts,
           coalesce(di.dnc_auto_add, dn.dnc_auto_add, false) AS disp_dnc,
           coalesce(di.callback_scheduler, dn.callback_scheduler, false) AS disp_callback,
           coalesce(di.appointment_scheduler, dn.appointment_scheduler, false) AS disp_appointment
      FROM public.calls c
      -- v2: by id when the call has one (only an id of this organization matches, with no fallback to the name), else
      -- by lower(name); the stage of whichever matched. Two keyed joins: the uuid, and the lowered name only for calls
      -- without an id.
      LEFT JOIN dm di ON di.id = c.disposition_id
      LEFT JOIN dm dn ON dn.lname = CASE WHEN c.disposition_id IS NULL THEN lower(c.disposition_name) END
      -- v2: the campaign is campaigns(coalesce(call campaign, membership campaign)) in the organization. Two joins, each
      -- provably unique, so a reader that does not read the campaign keeps neither.
      LEFT JOIN public.campaigns cmp ON cmp.id = c.campaign_id AND cmp.organization_id = $1
      LEFT JOIN (SELECT cl.id, (array_agg(k.id))[1] AS campaign_id
                   FROM public.campaign_leads cl
                   JOIN public.campaigns k ON k.id = cl.campaign_id AND k.organization_id = $1
                  GROUP BY cl.id) mc ON mc.id = c.campaign_lead_id
      LEFT JOIN public.leads l1 ON l1.id = c.lead_id AND l1.organization_id = $1
      LEFT JOIN public.leads l2
             ON c.lead_id IS NULL AND l2.id = c.contact_id AND (c.contact_type = 'lead' OR c.contact_type IS NULL)
            AND l2.organization_id = $1
      LEFT JOIN private.dialer_outbound_admissions adm ON adm.organization_id = $1 AND adm.call_id = c.id
     WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3
       AND NOT EXISTS (SELECT 1 FROM private.performance_duplicate_rows d
                        WHERE d.organization_id = $1 AND d.kind = 'call' AND d.duplicate_id = c.id)
  ), cf AS (
    SELECT cr.*,
           CASE WHEN cr.direction_class = 'inbound' THEN coalesce(cr.placing_agent_id, cr.answered_by_agent_id)
                ELSE cr.placing_agent_id END AS credited_agent_id,
           CASE WHEN cr.resolved_disposition_id IS NOT NULL THEN cr.resolved_disposition_id::text
                WHEN nullif(btrim(cr.raw_disposition_name), '') IS NOT NULL THEN 'name:' || lower(btrim(cr.raw_disposition_name))
                ELSE 'none' END AS disposition_key,
           coalesce(cr.resolved_disposition_name, nullif(btrim(cr.raw_disposition_name), ''), '(No disposition)') AS disposition_name,
           CASE WHEN cr.direction_class <> 'outbound' THEN false
                WHEN lower(coalesce(cr.resolved_disposition_name, cr.raw_disposition_name, '')) = 'no answer' THEN false
                WHEN cr.duration_seconds > 45 THEN true
                WHEN cr.disp_counts_contacted THEN true
                ELSE false END AS is_contacted,
           CASE WHEN cr.direction_class <> 'outbound' THEN NULL
                WHEN NOT cr.dialer_admission_required OR cr.admitted IS TRUE THEN 'attempt'
                WHEN cr.admitted IS FALSE THEN 'non_attempt'
                ELSE 'unverified' END AS attempt_class,
           (cr.direction_class = 'inbound' AND (cr.placing_agent_id IS NOT NULL OR cr.outcome = 'forwarded_answered')
              AND cr.voicemail_id IS NULL) AS is_answered_inbound
      FROM cr
  ), cg AS (
    SELECT cf.*,
           coalesce(cf.attempt_class = 'attempt', false) AS is_attempt,
           (coalesce(cf.attempt_class = 'attempt', false) AND cf.is_contacted)
             OR (cf.is_answered_inbound AND CASE WHEN lower(cf.disposition_name) = 'no answer' THEN false
                                                 WHEN cf.duration_seconds > 45 THEN true
                                                 WHEN cf.disp_counts_contacted THEN true
                                                 ELSE false END) AS is_journey_contact,
           (lower(cf.disposition_name) <> 'no answer'
             AND (cf.disp_counts_contacted OR cf.raw_duration IS NULL OR cf.raw_duration > 45)) AS could_qualify,
           public.phone_last10(cf.contact_phone) AS phone_last10
      FROM cf
  ),
  -- @call-rows end
  dg AS MATERIALIZED (
    -- Grouped once by attempt class, agent, campaign, outcome and duration bucket; every view reads these groups.
    -- Inbound and other rows carry no attempt class and are not read below. An outbound row's credited agent is its
    -- placing agent, so the scope test reads the base column. A resolved outcome's color and flags are its
    -- disposition row's (joined after grouping); only the name varies by row, for outcomes known by name alone.
    SELECT cg.attempt_class, cg.placing_agent_id AS agent_id, cg.campaign_id, cg.disposition_key,
           CASE WHEN cg.duration_seconds < 30 THEN 1 WHEN cg.duration_seconds < 60 THEN 2 WHEN cg.duration_seconds < 120 THEN 3
                WHEN cg.duration_seconds < 300 THEN 4 ELSE 5 END AS bucket,
           count(*) AS calls, sum(cg.duration_seconds) AS duration_seconds, max(cg.disposition_name) AS name
      FROM cg
     WHERE $4::uuid[] IS NULL OR cg.placing_agent_id = ANY ($4)
     GROUP BY 1, 2, 3, 4, 5
  ), f AS (
    SELECT dg.*, CASE WHEN dg.campaign_id IS NULL THEN 'none' WHEN dg.campaign_id = ANY ($5) THEN 'visible' ELSE 'hidden' END
             AS campaign_class
      FROM dg WHERE dg.attempt_class = 'attempt'
  ), disp AS (
    SELECT k.disposition_key, k.name, k.calls, k.duration_seconds,
           coalesce(d.color, '#6B7280') AS color, coalesce(d.counts_as_contacted, false) AS counts_as_contacted,
           coalesce(ps.convert_to_client, false) AS converts, coalesce(d.dnc_auto_add, false) AS dnc,
           coalesce(d.callback_scheduler, false) AS callback, coalesce(d.appointment_scheduler, false) AS appointment
      FROM (SELECT f.disposition_key, max(f.name) AS name, sum(f.calls) AS calls, sum(f.duration_seconds) AS duration_seconds
              FROM f GROUP BY f.disposition_key) k
      LEFT JOIN public.dispositions d
             ON d.id = CASE WHEN k.disposition_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            THEN k.disposition_key::uuid END
            AND d.organization_id = $1
      LEFT JOIN public.pipeline_stages ps ON ps.id = d.pipeline_stage_id AND ps.organization_id = $1
  ), by_agent AS (
    SELECT x.agent_id, private.report_agent_name(p.first_name, p.last_name) AS name,
           jsonb_object_agg(x.disposition_key, x.calls) AS counts, sum(x.calls) AS total
      FROM (SELECT f.agent_id, f.disposition_key, sum(f.calls) AS calls FROM f WHERE f.agent_id IS NOT NULL GROUP BY 1, 2) x
      LEFT JOIN public.profiles p ON p.id = x.agent_id AND p.organization_id = $1
     GROUP BY x.agent_id, p.first_name, p.last_name
  ), by_campaign AS (
    SELECT x.campaign_id, max(c.name) AS name, jsonb_object_agg(x.disposition_key, x.calls) AS counts, sum(x.calls) AS total
      FROM (SELECT f.campaign_id, f.disposition_key, sum(f.calls) AS calls FROM f WHERE f.campaign_class = 'visible' GROUP BY 1, 2) x
      JOIN public.campaigns c ON c.id = x.campaign_id AND c.organization_id = $1
     GROUP BY x.campaign_id
  ), part AS (
    SELECT y.part, coalesce(sum(y.calls), 0) AS total, coalesce(jsonb_object_agg(y.disposition_key, y.calls), '{}'::jsonb) AS counts
      FROM (SELECT CASE WHEN f.campaign_class = 'hidden' THEN 'other_campaigns' ELSE 'without_campaign' END AS part,
                   f.disposition_key, sum(f.calls) AS calls
              FROM f WHERE f.campaign_class IN ('hidden', 'none') GROUP BY 1, 2
            UNION ALL
            SELECT 'unattributed', f.disposition_key, sum(f.calls) FROM f WHERE f.agent_id IS NULL GROUP BY 1, 2) y
     GROUP BY y.part
  )
  SELECT jsonb_build_object(
           'by_disposition', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'key', d.disposition_key,
                      'name', CASE WHEN d.disposition_key = 'none' THEN 'No outcome recorded' ELSE d.name END,
                      'color', d.color, 'calls', d.calls, 'duration_seconds', d.duration_seconds,
                      'counts_as_contacted', d.counts_as_contacted, 'converts', d.converts, 'dnc', d.dnc,
                      'callback', d.callback, 'appointment', d.appointment)
                    ORDER BY d.calls DESC, lower(d.name), d.disposition_key)
               FROM disp d), '[]'::jsonb),
           'duration_buckets', (SELECT jsonb_agg(jsonb_build_object('range', b.label,
                                                  'calls', coalesce((SELECT sum(f.calls) FROM f WHERE f.bucket = b.ord), 0))
                                  ORDER BY b.ord)
                                  FROM (VALUES (1, '0-30s'), (2, '30s-1m'), (3, '1-2m'), (4, '2-5m'), (5, '5m+')) b(ord, label)),
           'deep_dive', jsonb_build_object(
             'by_agent', coalesce((SELECT jsonb_agg(jsonb_build_object('agent_id', x.agent_id, 'name', x.name, 'total', x.total,
                                                                      'counts', x.counts) ORDER BY x.total DESC, lower(x.name), x.agent_id)
                                     FROM by_agent x), '[]'::jsonb),
             'by_campaign', coalesce((SELECT jsonb_agg(jsonb_build_object('campaign_id', x.campaign_id, 'name', x.name, 'total', x.total,
                                                                         'counts', x.counts) ORDER BY x.total DESC, lower(x.name), x.campaign_id)
                                        FROM by_campaign x), '[]'::jsonb),
             'other_campaigns', coalesce((SELECT jsonb_build_object('total', p.total, 'counts', p.counts) FROM part p
                                            WHERE p.part = 'other_campaigns'), jsonb_build_object('total', 0, 'counts', '{}'::jsonb)),
             'without_campaign', coalesce((SELECT jsonb_build_object('total', p.total, 'counts', p.counts) FROM part p
                                             WHERE p.part = 'without_campaign'), jsonb_build_object('total', 0, 'counts', '{}'::jsonb)),
             'unattributed', CASE WHEN $4::uuid[] IS NULL THEN coalesce((
                               SELECT jsonb_build_object('total', p.total, 'counts', p.counts) FROM part p WHERE p.part = 'unattributed'),
                               jsonb_build_object('total', 0, 'counts', '{}'::jsonb)) END),
           'call_population', (SELECT jsonb_build_object('attempts', coalesce(sum(dg.calls) FILTER (WHERE dg.attempt_class = 'attempt'), 0),
                                                         'non_attempts', coalesce(sum(dg.calls) FILTER (WHERE dg.attempt_class = 'non_attempt'), 0),
                                                         'unverified', coalesce(sum(dg.calls) FILTER (WHERE dg.attempt_class = 'unverified'), 0))
                                 FROM dg))
  $q$ INTO v_body USING a.org_id, w.start_at, w.end_at, a.agent_ids, v_visible;

  RETURN private.report_v3_envelope('disposition_breakdown', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
                                    w.time_zone_source, w.start_date, w.end_date, w.start_at, w.end_at)
         || jsonb_build_object('metrics', '[]'::jsonb) || v_body
         || jsonb_build_object('call_population', (v_body -> 'call_population') || jsonb_build_object(
              'duplicates_excluded', private.report_v3_duplicates_excluded(a.org_id, a.agent_ids, w.start_at, w.end_at)));
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
  v_visible uuid[];
  v_body jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);
  SELECT coalesce(array_agg(v.campaign_id), '{}') INTO v_visible FROM private.report_visible_campaigns(a.org_id) v;

  -- One pass over the window's in-scope outbound rows, grouped once by attempt class and campaign.
  -- $1 org, $2 start, $3 end, $4 agent_ids, $5 campaigns visible to the viewer.
  EXECUTE $q$
  WITH
  -- @call-rows begin: every call in [$2, $3) of organization $1, one row each, by the pinned v2 report_call_facts rules
  -- (same rows, same carried columns, reviewed duplicates excluded) plus the v3 evidence columns. The text between the
  -- markers is byte-identical wherever it appears (reportsV3Contracts.test.ts); a reader keeps only what it reads.
  dm AS NOT MATERIALIZED (   -- the organization's dispositions with the stage conversion flag; lower(name) is unique per
            -- organization (dispositions_org_lower_name_unique), so a call matches at most one by id and at most one by
            -- name. Inlined at both references, so the call scan keeps its parallel plan.
    SELECT d.id, lower(d.name) AS lname, d.name, d.color, d.counts_as_contacted, d.dnc_auto_add, d.callback_scheduler,
           d.appointment_scheduler, ps.convert_to_client
      FROM public.dispositions d
      LEFT JOIN public.pipeline_stages ps ON ps.id = d.pipeline_stage_id AND ps.organization_id = $1
     WHERE d.organization_id = $1
  ), cr AS (
    SELECT c.id AS call_id, c.created_at, c.agent_id AS placing_agent_id, c.contact_id, c.contact_type,
           c.campaign_lead_id AS raw_campaign_lead_id, c.contact_phone, c.answered_by_agent_id, c.outcome, c.voicemail_id,
           c.dialer_admission_required, adm.admitted, c.duration AS raw_duration, c.duration_source, c.duration_conflict,
           c.disposition_name AS raw_disposition_name,
           -- v2's classes of lower(coalesce(direction, '')): outbound/outgoing, inbound/incoming, else other. An exact
           -- lower-case value is matched first (lower() leaves it unchanged), so most rows never call lower().
           CASE c.direction WHEN 'outbound' THEN 'outbound' WHEN 'outgoing' THEN 'outbound' WHEN 'inbound' THEN 'inbound'
                WHEN 'incoming' THEN 'inbound'
                ELSE CASE lower(coalesce(c.direction, '')) WHEN 'outbound' THEN 'outbound' WHEN 'outgoing' THEN 'outbound'
                          WHEN 'inbound' THEN 'inbound' WHEN 'incoming' THEN 'inbound' ELSE 'other' END END AS direction_class,
           greatest(coalesce(c.duration, 0), 0)::bigint AS duration_seconds,
           CASE WHEN c.campaign_id IS NOT NULL THEN cmp.id ELSE mc.campaign_id END AS campaign_id,
           coalesce(l1.id, l2.id) AS lead_id,
           coalesce(nullif(btrim(coalesce(l1.lead_source, l2.lead_source)), ''), '(No source)') AS lead_source,
           coalesce(di.id, dn.id) AS resolved_disposition_id,
           coalesce(di.name, dn.name) AS resolved_disposition_name,
           coalesce(di.color, dn.color, '#6B7280') AS disposition_color,
           coalesce(di.counts_as_contacted, dn.counts_as_contacted, false) AS disp_counts_contacted,
           coalesce(di.convert_to_client, dn.convert_to_client, false) AS disp_converts,
           coalesce(di.dnc_auto_add, dn.dnc_auto_add, false) AS disp_dnc,
           coalesce(di.callback_scheduler, dn.callback_scheduler, false) AS disp_callback,
           coalesce(di.appointment_scheduler, dn.appointment_scheduler, false) AS disp_appointment
      FROM public.calls c
      -- v2: by id when the call has one (only an id of this organization matches, with no fallback to the name), else
      -- by lower(name); the stage of whichever matched. Two keyed joins: the uuid, and the lowered name only for calls
      -- without an id.
      LEFT JOIN dm di ON di.id = c.disposition_id
      LEFT JOIN dm dn ON dn.lname = CASE WHEN c.disposition_id IS NULL THEN lower(c.disposition_name) END
      -- v2: the campaign is campaigns(coalesce(call campaign, membership campaign)) in the organization. Two joins, each
      -- provably unique, so a reader that does not read the campaign keeps neither.
      LEFT JOIN public.campaigns cmp ON cmp.id = c.campaign_id AND cmp.organization_id = $1
      LEFT JOIN (SELECT cl.id, (array_agg(k.id))[1] AS campaign_id
                   FROM public.campaign_leads cl
                   JOIN public.campaigns k ON k.id = cl.campaign_id AND k.organization_id = $1
                  GROUP BY cl.id) mc ON mc.id = c.campaign_lead_id
      LEFT JOIN public.leads l1 ON l1.id = c.lead_id AND l1.organization_id = $1
      LEFT JOIN public.leads l2
             ON c.lead_id IS NULL AND l2.id = c.contact_id AND (c.contact_type = 'lead' OR c.contact_type IS NULL)
            AND l2.organization_id = $1
      LEFT JOIN private.dialer_outbound_admissions adm ON adm.organization_id = $1 AND adm.call_id = c.id
     WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3
       AND NOT EXISTS (SELECT 1 FROM private.performance_duplicate_rows d
                        WHERE d.organization_id = $1 AND d.kind = 'call' AND d.duplicate_id = c.id)
  ), cf AS (
    SELECT cr.*,
           CASE WHEN cr.direction_class = 'inbound' THEN coalesce(cr.placing_agent_id, cr.answered_by_agent_id)
                ELSE cr.placing_agent_id END AS credited_agent_id,
           CASE WHEN cr.resolved_disposition_id IS NOT NULL THEN cr.resolved_disposition_id::text
                WHEN nullif(btrim(cr.raw_disposition_name), '') IS NOT NULL THEN 'name:' || lower(btrim(cr.raw_disposition_name))
                ELSE 'none' END AS disposition_key,
           coalesce(cr.resolved_disposition_name, nullif(btrim(cr.raw_disposition_name), ''), '(No disposition)') AS disposition_name,
           CASE WHEN cr.direction_class <> 'outbound' THEN false
                WHEN lower(coalesce(cr.resolved_disposition_name, cr.raw_disposition_name, '')) = 'no answer' THEN false
                WHEN cr.duration_seconds > 45 THEN true
                WHEN cr.disp_counts_contacted THEN true
                ELSE false END AS is_contacted,
           CASE WHEN cr.direction_class <> 'outbound' THEN NULL
                WHEN NOT cr.dialer_admission_required OR cr.admitted IS TRUE THEN 'attempt'
                WHEN cr.admitted IS FALSE THEN 'non_attempt'
                ELSE 'unverified' END AS attempt_class,
           (cr.direction_class = 'inbound' AND (cr.placing_agent_id IS NOT NULL OR cr.outcome = 'forwarded_answered')
              AND cr.voicemail_id IS NULL) AS is_answered_inbound
      FROM cr
  ), cg AS (
    SELECT cf.*,
           coalesce(cf.attempt_class = 'attempt', false) AS is_attempt,
           (coalesce(cf.attempt_class = 'attempt', false) AND cf.is_contacted)
             OR (cf.is_answered_inbound AND CASE WHEN lower(cf.disposition_name) = 'no answer' THEN false
                                                 WHEN cf.duration_seconds > 45 THEN true
                                                 WHEN cf.disp_counts_contacted THEN true
                                                 ELSE false END) AS is_journey_contact,
           (lower(cf.disposition_name) <> 'no answer'
             AND (cf.disp_counts_contacted OR cf.raw_duration IS NULL OR cf.raw_duration > 45)) AS could_qualify,
           public.phone_last10(cf.contact_phone) AS phone_last10
      FROM cf
  ),
  -- @call-rows end
  kg AS MATERIALIZED (
    -- Inbound and other rows carry no attempt class and are not read; an outbound row's credited agent is its
    -- placing agent, so the scope test reads the base column.
    SELECT cg.attempt_class, cg.campaign_id, count(*) AS calls_made, count(*) FILTER (WHERE cg.is_contacted) AS contacted_calls
      FROM cg
     WHERE $4::uuid[] IS NULL OR cg.placing_agent_id = ANY ($4)
     GROUP BY 1, 2
  ), f AS (
    SELECT kg.*, CASE WHEN kg.campaign_id IS NULL THEN 'none' WHEN kg.campaign_id = ANY ($5) THEN 'visible' ELSE 'hidden' END
             AS campaign_class
      FROM kg WHERE kg.attempt_class = 'attempt'
  ), rows_ AS (
    SELECT f.campaign_id, c.name, c.type, sum(f.calls_made) AS calls_made, sum(f.contacted_calls) AS contacted_calls
      FROM f JOIN public.campaigns c ON c.id = f.campaign_id AND c.organization_id = $1
     WHERE f.campaign_class = 'visible'
     GROUP BY f.campaign_id, c.name, c.type
  )
  SELECT jsonb_build_object(
           'campaigns', coalesce((
             SELECT jsonb_agg(jsonb_build_object('campaign_id', r.campaign_id, 'name', r.name, 'type', r.type,
                                                 'calls_made', r.calls_made, 'contacted_calls', r.contacted_calls,
                                                 'contact_rate_numerator', r.contacted_calls,
                                                 'contact_rate_denominator', r.calls_made)
                              ORDER BY r.calls_made DESC, lower(r.name), r.campaign_id)
               FROM rows_ r), '[]'::jsonb),
           'calls_without_campaign', (SELECT jsonb_build_object('calls_made', coalesce(sum(f.calls_made), 0),
                                                                'contacted_calls', coalesce(sum(f.contacted_calls), 0),
                                                                'contact_rate_numerator', coalesce(sum(f.contacted_calls), 0),
                                                                'contact_rate_denominator', coalesce(sum(f.calls_made), 0))
                                        FROM f WHERE f.campaign_class = 'none'),
           'other_campaigns', (SELECT jsonb_build_object('calls_made', coalesce(sum(f.calls_made), 0),
                                                         'contacted_calls', coalesce(sum(f.contacted_calls), 0),
                                                         'contact_rate_numerator', coalesce(sum(f.contacted_calls), 0),
                                                         'contact_rate_denominator', coalesce(sum(f.calls_made), 0))
                                 FROM f WHERE f.campaign_class = 'hidden'),
           'call_population', (SELECT jsonb_build_object('attempts', coalesce(sum(kg.calls_made) FILTER (WHERE kg.attempt_class = 'attempt'), 0),
                                                         'non_attempts', coalesce(sum(kg.calls_made) FILTER (WHERE kg.attempt_class = 'non_attempt'), 0),
                                                         'unverified', coalesce(sum(kg.calls_made) FILTER (WHERE kg.attempt_class = 'unverified'), 0))
                                 FROM kg))
  $q$ INTO v_body USING a.org_id, w.start_at, w.end_at, a.agent_ids, v_visible;

  RETURN private.report_v3_envelope('campaign_calls', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
                                    w.time_zone_source, w.start_date, w.end_date, w.start_at, w.end_at)
         || jsonb_build_object('metrics', '[]'::jsonb) || v_body
         || jsonb_build_object('call_population', (v_body -> 'call_population') || jsonb_build_object(
              'duplicates_excluded', private.report_v3_duplicates_excluded(a.org_id, a.agent_ids, w.start_at, w.end_at)));
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
  v_body jsonb;
BEGIN
  SELECT * INTO a FROM private.report_access_v2(p_requested_scope, p_agent_id);
  SELECT * INTO w FROM private.report_window(a.org_id, p_start_date, p_end_date);

  -- One pass over the window's in-scope outbound rows, grouped once by attempt class, link and source; New leads keep
  -- the v2 rule (created in the window, currently assigned in scope). $1 org, $2 start, $3 end, $4 agent_ids.
  EXECUTE $q$
  WITH
  -- @call-rows begin: every call in [$2, $3) of organization $1, one row each, by the pinned v2 report_call_facts rules
  -- (same rows, same carried columns, reviewed duplicates excluded) plus the v3 evidence columns. The text between the
  -- markers is byte-identical wherever it appears (reportsV3Contracts.test.ts); a reader keeps only what it reads.
  dm AS NOT MATERIALIZED (   -- the organization's dispositions with the stage conversion flag; lower(name) is unique per
            -- organization (dispositions_org_lower_name_unique), so a call matches at most one by id and at most one by
            -- name. Inlined at both references, so the call scan keeps its parallel plan.
    SELECT d.id, lower(d.name) AS lname, d.name, d.color, d.counts_as_contacted, d.dnc_auto_add, d.callback_scheduler,
           d.appointment_scheduler, ps.convert_to_client
      FROM public.dispositions d
      LEFT JOIN public.pipeline_stages ps ON ps.id = d.pipeline_stage_id AND ps.organization_id = $1
     WHERE d.organization_id = $1
  ), cr AS (
    SELECT c.id AS call_id, c.created_at, c.agent_id AS placing_agent_id, c.contact_id, c.contact_type,
           c.campaign_lead_id AS raw_campaign_lead_id, c.contact_phone, c.answered_by_agent_id, c.outcome, c.voicemail_id,
           c.dialer_admission_required, adm.admitted, c.duration AS raw_duration, c.duration_source, c.duration_conflict,
           c.disposition_name AS raw_disposition_name,
           -- v2's classes of lower(coalesce(direction, '')): outbound/outgoing, inbound/incoming, else other. An exact
           -- lower-case value is matched first (lower() leaves it unchanged), so most rows never call lower().
           CASE c.direction WHEN 'outbound' THEN 'outbound' WHEN 'outgoing' THEN 'outbound' WHEN 'inbound' THEN 'inbound'
                WHEN 'incoming' THEN 'inbound'
                ELSE CASE lower(coalesce(c.direction, '')) WHEN 'outbound' THEN 'outbound' WHEN 'outgoing' THEN 'outbound'
                          WHEN 'inbound' THEN 'inbound' WHEN 'incoming' THEN 'inbound' ELSE 'other' END END AS direction_class,
           greatest(coalesce(c.duration, 0), 0)::bigint AS duration_seconds,
           CASE WHEN c.campaign_id IS NOT NULL THEN cmp.id ELSE mc.campaign_id END AS campaign_id,
           coalesce(l1.id, l2.id) AS lead_id,
           coalesce(nullif(btrim(coalesce(l1.lead_source, l2.lead_source)), ''), '(No source)') AS lead_source,
           coalesce(di.id, dn.id) AS resolved_disposition_id,
           coalesce(di.name, dn.name) AS resolved_disposition_name,
           coalesce(di.color, dn.color, '#6B7280') AS disposition_color,
           coalesce(di.counts_as_contacted, dn.counts_as_contacted, false) AS disp_counts_contacted,
           coalesce(di.convert_to_client, dn.convert_to_client, false) AS disp_converts,
           coalesce(di.dnc_auto_add, dn.dnc_auto_add, false) AS disp_dnc,
           coalesce(di.callback_scheduler, dn.callback_scheduler, false) AS disp_callback,
           coalesce(di.appointment_scheduler, dn.appointment_scheduler, false) AS disp_appointment
      FROM public.calls c
      -- v2: by id when the call has one (only an id of this organization matches, with no fallback to the name), else
      -- by lower(name); the stage of whichever matched. Two keyed joins: the uuid, and the lowered name only for calls
      -- without an id.
      LEFT JOIN dm di ON di.id = c.disposition_id
      LEFT JOIN dm dn ON dn.lname = CASE WHEN c.disposition_id IS NULL THEN lower(c.disposition_name) END
      -- v2: the campaign is campaigns(coalesce(call campaign, membership campaign)) in the organization. Two joins, each
      -- provably unique, so a reader that does not read the campaign keeps neither.
      LEFT JOIN public.campaigns cmp ON cmp.id = c.campaign_id AND cmp.organization_id = $1
      LEFT JOIN (SELECT cl.id, (array_agg(k.id))[1] AS campaign_id
                   FROM public.campaign_leads cl
                   JOIN public.campaigns k ON k.id = cl.campaign_id AND k.organization_id = $1
                  GROUP BY cl.id) mc ON mc.id = c.campaign_lead_id
      LEFT JOIN public.leads l1 ON l1.id = c.lead_id AND l1.organization_id = $1
      LEFT JOIN public.leads l2
             ON c.lead_id IS NULL AND l2.id = c.contact_id AND (c.contact_type = 'lead' OR c.contact_type IS NULL)
            AND l2.organization_id = $1
      LEFT JOIN private.dialer_outbound_admissions adm ON adm.organization_id = $1 AND adm.call_id = c.id
     WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3
       AND NOT EXISTS (SELECT 1 FROM private.performance_duplicate_rows d
                        WHERE d.organization_id = $1 AND d.kind = 'call' AND d.duplicate_id = c.id)
  ), cf AS (
    SELECT cr.*,
           CASE WHEN cr.direction_class = 'inbound' THEN coalesce(cr.placing_agent_id, cr.answered_by_agent_id)
                ELSE cr.placing_agent_id END AS credited_agent_id,
           CASE WHEN cr.resolved_disposition_id IS NOT NULL THEN cr.resolved_disposition_id::text
                WHEN nullif(btrim(cr.raw_disposition_name), '') IS NOT NULL THEN 'name:' || lower(btrim(cr.raw_disposition_name))
                ELSE 'none' END AS disposition_key,
           coalesce(cr.resolved_disposition_name, nullif(btrim(cr.raw_disposition_name), ''), '(No disposition)') AS disposition_name,
           CASE WHEN cr.direction_class <> 'outbound' THEN false
                WHEN lower(coalesce(cr.resolved_disposition_name, cr.raw_disposition_name, '')) = 'no answer' THEN false
                WHEN cr.duration_seconds > 45 THEN true
                WHEN cr.disp_counts_contacted THEN true
                ELSE false END AS is_contacted,
           CASE WHEN cr.direction_class <> 'outbound' THEN NULL
                WHEN NOT cr.dialer_admission_required OR cr.admitted IS TRUE THEN 'attempt'
                WHEN cr.admitted IS FALSE THEN 'non_attempt'
                ELSE 'unverified' END AS attempt_class,
           (cr.direction_class = 'inbound' AND (cr.placing_agent_id IS NOT NULL OR cr.outcome = 'forwarded_answered')
              AND cr.voicemail_id IS NULL) AS is_answered_inbound
      FROM cr
  ), cg AS (
    SELECT cf.*,
           coalesce(cf.attempt_class = 'attempt', false) AS is_attempt,
           (coalesce(cf.attempt_class = 'attempt', false) AND cf.is_contacted)
             OR (cf.is_answered_inbound AND CASE WHEN lower(cf.disposition_name) = 'no answer' THEN false
                                                 WHEN cf.duration_seconds > 45 THEN true
                                                 WHEN cf.disp_counts_contacted THEN true
                                                 ELSE false END) AS is_journey_contact,
           (lower(cf.disposition_name) <> 'no answer'
             AND (cf.disp_counts_contacted OR cf.raw_duration IS NULL OR cf.raw_duration > 45)) AS could_qualify,
           public.phone_last10(cf.contact_phone) AS phone_last10
      FROM cf
  ),
  -- @call-rows end
  sg AS MATERIALIZED (
    -- Inbound and other rows carry no attempt class and are not read; an outbound row's credited agent is its
    -- placing agent, so the scope test reads the base column.
    SELECT cg.attempt_class, cg.lead_id IS NULL AS not_linked, cg.lead_source,
           count(*) AS calls_made, count(*) FILTER (WHERE cg.is_contacted) AS contacted_calls
      FROM cg
     WHERE $4::uuid[] IS NULL OR cg.placing_agent_id = ANY ($4)
     GROUP BY 1, 2, 3
  ), call_agg AS (
    SELECT sg.lead_source, sum(sg.calls_made) AS calls_made, sum(sg.contacted_calls) AS contacted_calls
      FROM sg WHERE sg.attempt_class = 'attempt' AND NOT sg.not_linked GROUP BY sg.lead_source
  ), new_leads AS (
    SELECT coalesce(nullif(btrim(l.lead_source), ''), '(No source)') AS lead_source, count(*) AS new_leads
      FROM public.leads l
     WHERE l.organization_id = $1 AND l.created_at >= $2 AND l.created_at < $3
       AND ($4::uuid[] IS NULL OR l.assigned_agent_id = ANY ($4))
     GROUP BY 1
  ), rows_ AS (
    SELECT s.lead_source, coalesce(ca.calls_made, 0) AS calls_made, coalesce(ca.contacted_calls, 0) AS contacted_calls,
           coalesce(nl.new_leads, 0) AS new_leads
      FROM (SELECT lead_source FROM call_agg UNION SELECT lead_source FROM new_leads) s
      LEFT JOIN call_agg ca ON ca.lead_source = s.lead_source
      LEFT JOIN new_leads nl ON nl.lead_source = s.lead_source
  )
  SELECT jsonb_build_object(
           'sources', coalesce((
             SELECT jsonb_agg(jsonb_build_object('lead_source', r.lead_source, 'new_leads', r.new_leads,
                                                 'calls_made', r.calls_made, 'contacted_calls', r.contacted_calls,
                                                 'contact_rate_numerator', r.contacted_calls,
                                                 'contact_rate_denominator', r.calls_made)
                              ORDER BY r.calls_made DESC, r.new_leads DESC, lower(r.lead_source))
               FROM rows_ r), '[]'::jsonb),
           'not_linked', (SELECT jsonb_build_object('calls_made', coalesce(sum(sg.calls_made), 0),
                                                    'contacted_calls', coalesce(sum(sg.contacted_calls), 0),
                                                    'contact_rate_numerator', coalesce(sum(sg.contacted_calls), 0),
                                                    'contact_rate_denominator', coalesce(sum(sg.calls_made), 0))
                            FROM sg WHERE sg.attempt_class = 'attempt' AND sg.not_linked),
           'call_population', (SELECT jsonb_build_object('attempts', coalesce(sum(sg.calls_made) FILTER (WHERE sg.attempt_class = 'attempt'), 0),
                                                         'non_attempts', coalesce(sum(sg.calls_made) FILTER (WHERE sg.attempt_class = 'non_attempt'), 0),
                                                         'unverified', coalesce(sum(sg.calls_made) FILTER (WHERE sg.attempt_class = 'unverified'), 0))
                                 FROM sg))
  $q$ INTO v_body USING a.org_id, w.start_at, w.end_at, a.agent_ids;

  RETURN private.report_v3_envelope('lead_source_calls', a.scope, a.requested_scope, a.filter_agent_id, w.time_zone,
                                    w.time_zone_source, w.start_date, w.end_date, w.start_at, w.end_at)
         || jsonb_build_object('metrics', '[]'::jsonb) || v_body
         || jsonb_build_object('call_population', (v_body -> 'call_population') || jsonb_build_object(
              'duplicates_excluded', private.report_v3_duplicates_excluded(a.org_id, a.agent_ids, w.start_at, w.end_at)));
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
