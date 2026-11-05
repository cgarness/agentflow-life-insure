-- =====================================================================================================
-- Reports V2 (v3) read-back (plan §9.1 A10, §9.2 B4, §9.3 C6, §9.4 D7). Privilege class R: read-only.
-- One READ ONLY transaction that rolls back; no privilege statement, no table write, no output but pass/fail.
-- Run after apply-enable, before record-history, at any package state (contract 3.0.0, 3.1.0, 3.2.0 or 3.3.0).
--
-- 1. Pins: the report closure (as reports_v3_enable.sql computes it) has exactly the harness fingerprint recorded
--    below for the installed contract version (count and md5 of signature|md5(prosrc)|definer|volatility|proconfig),
--    and every member is owned by postgres. Regenerate with scripts/reports_v3_fixture.py --part enable-pins.
-- 2. Privilege matrix (catalog ACLs and existing role memberships): exactly the 15 report readers are executable,
--    by authenticated and service_role only; no report function has a PUBLIC or anon entry; anon is not a member of
--    authenticated or service_role; anon and authenticated have no USAGE on schema private.
-- 3. Class W application RPCs that are installed are executable by authenticated only, or sealed (a guarded package
--    rollback seals them); the package tables have RLS on and no client privilege; the concurrent calls index is valid
--    and ready.
-- 4. Role-simulated reads of all nine v3 readers over the agency's last 30 days, at agency, team, personal and
--    agent-filter scope, each as the matching actor of the busiest organization that has one (team is skipped, with a
--    notice, only when no Team Leader has an active downline): each response is a v3 payload of the installed
--    contract and each read takes at most 4 s (the statement limit is 60 s per scope).
-- 5. §2.10 invariant at agency scope: v2 calls_made − v3 KPI 5 = non_attempts + unverified.
-- Payloads never leave the transaction; only the check that failed is reported.
-- =====================================================================================================
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '60s';

DO $readback$
DECLARE
  f record; v_role text; v_contract text; v_count bigint; v_md5 text; v_owner bigint; v_expected boolean;
  v_readers text[] := ARRAY[
    'public.get_report_scope_v2(text)',
    'public.get_report_call_summary_v2(date,date,uuid,text)',
    'public.get_report_call_volume_v2(date,date,uuid,text)',
    'public.get_report_disposition_breakdown_v2(date,date,uuid,text)',
    'public.get_report_campaign_performance_v2(date,date,uuid,text)',
    'public.get_report_lead_source_performance_v2(date,date,uuid,text)',
    'public.get_report_scope_v3(text)',
    'public.get_report_summary_v3(date,date,uuid,text)',
    'public.get_report_journey_v3(date,date,uuid,text)',
    'public.get_report_sales_appointments_v3(date,date,uuid,text)',
    'public.get_report_state_breakdown_v3(date,date,uuid,text)',
    'public.get_report_call_volume_v3(date,date,uuid,text)',
    'public.get_report_disposition_breakdown_v3(date,date,uuid,text)',
    'public.get_report_campaign_calls_v3(date,date,uuid,text)',
    'public.get_report_lead_source_calls_v3(date,date,uuid,text)'];
  v_writers text[] := ARRAY[
    'public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)',
    'public.get_client_policy_sale_premiums(uuid)',
    'public.record_client_policy_handoff_v2(uuid,uuid,jsonb,boolean,jsonb,uuid)',
    'public.convert_lead_to_client_with_sales_handoff_v2(uuid,uuid,uuid,jsonb,uuid,jsonb,uuid)',
    'public.retry_policy_sale_call_link(uuid)',
    'public.get_policy_sale_call_link_status(uuid[])',
    'public.record_appointment_outcome(uuid,uuid,timestamptz,text)',
    'public.get_policy_appointment_links(uuid)',
    'public.link_policy_appointment(uuid,uuid,uuid,timestamptz,text,text)',
    'public.correct_policy_appointment_link(uuid,uuid,uuid,uuid,timestamptz,text)'];
BEGIN
  v_contract := private.report_v3_basis_flags() ->> 'contract_version';
  WITH RECURSIVE report_closure(oid) AS (
    SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE (n.nspname = 'private' AND p.proname LIKE 'report\_v3\_%')
        OR (n.nspname = 'public' AND p.proname LIKE 'get\_report\_%\_v3')
    UNION
    SELECT pg_catalog.to_regprocedure(s)::oid FROM unnest(ARRAY[
      'private.report_session_facts(uuid,timestamptz,timestamptz,uuid[])',
      'private.report_session_seconds(uuid,timestamptz,timestamptz,uuid[])',
      'private.report_call_facts(uuid,timestamptz,timestamptz,uuid[])',
      'public.get_report_call_summary(date,date,uuid)',
      'private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])',
      'private.report_access_v2(text,uuid)',
      'private.report_monthly_amount(text)',
      'private.report_policy_value_facts(uuid,uuid[])',
      'private.report_premium_totals(bigint,bigint,numeric,bigint,bigint,bigint)',
      'public.get_report_scope_v2(text)',
      'public.get_report_call_summary_v2(date,date,uuid,text)',
      'public.get_report_call_volume_v2(date,date,uuid,text)',
      'public.get_report_disposition_breakdown_v2(date,date,uuid,text)',
      'public.get_report_campaign_performance_v2(date,date,uuid,text)',
      'public.get_report_lead_source_performance_v2(date,date,uuid,text)',
      'private.report_window(uuid,date,date)',
      'private.report_meta(text,uuid,text,text,date,date,timestamptz,timestamptz)',
      'private.report_agent_name(text,text)',
      'private.report_visible_campaigns(uuid)',
      'private.report_policy_quality(uuid,uuid[])',
      'private.report_policy_facts(uuid,uuid[])',
      'private.report_policy_campaign_lineage(uuid,uuid[])',
      'private.report_agency_time_zone(uuid)',
      'private.report_permission_flags(uuid,text)',
      'private.campaign_actor()',
      'private.resolve_downline_ids(uuid,uuid)',
      'private.profile_parse_iso_date(text)']) s
    UNION
    SELECT q.oid FROM report_closure c JOIN pg_catalog.pg_proc p ON p.oid = c.oid
     CROSS JOIN LATERAL pg_catalog.regexp_matches(p.prosrc, '(public|private)\.([a-z_][a-z0-9_]*)\s*\(', 'g') m
     JOIN pg_catalog.pg_namespace qn ON qn.nspname = m[1]
     JOIN pg_catalog.pg_proc q ON q.pronamespace = qn.oid AND q.proname = m[2])
  SELECT count(*), md5(string_agg(concat_ws('|', p.oid::regprocedure::text, md5(p.prosrc), p.prosecdef::text, p.provolatile::text, coalesce(p.proconfig::text, '')), E'\n' ORDER BY p.oid::regprocedure::text COLLATE "C")),
         count(*) FILTER (WHERE p.proowner <> 'postgres'::regrole)
    INTO v_count, v_md5, v_owner
    FROM report_closure c JOIN pg_proc p ON p.oid = c.oid;
  IF (v_contract, v_count, v_md5) NOT IN (VALUES
      ('3.0.0', 88::bigint, 'eb073e36ec1ef37eacfd1b9a162b3afa'),
      ('3.1.0', 88::bigint, 'cbbba0e89ad15d28f77b4e2bc9aacfdb'),
      ('3.2.0', 88::bigint, '6ef7697afd9ca9195079f767f891470b'),
      ('3.3.0', 97::bigint, '60276040ffd4d8acfd5425deadd5349d')) THEN
    RAISE EXCEPTION 'Reports v3 read-back: report closure does not match the harness pins for contract %', v_contract;
  END IF;
  IF v_owner <> 0 THEN
    RAISE EXCEPTION 'Reports v3 read-back: a report closure function is not owned by postgres';
  END IF;

  FOR f IN SELECT p.oid, p.proacl, p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'private' AND p.proname LIKE 'report\_%')
               OR (n.nspname = 'public' AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'rpc\_report\_%')) LOOP
    v_expected := f.oid = ANY (SELECT to_regprocedure(r)::oid FROM unnest(v_readers) r);
    IF (SELECT coalesce(string_agg(DISTINCT a.grantee::regrole::text, ',' ORDER BY a.grantee::regrole::text), '')
          FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a WHERE a.grantee <> f.proowner)
       IS DISTINCT FROM (CASE WHEN v_expected THEN 'authenticated,service_role' ELSE '' END) THEN
      RAISE EXCEPTION 'Reports v3 read-back: unexpected privileges on %', f.oid::regprocedure;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(v_role, f.oid, 'EXECUTE') IS DISTINCT FROM (v_expected AND v_role <> 'anon') THEN
        RAISE EXCEPTION 'Reports v3 read-back: effective privilege mismatch for % on %', v_role, f.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
  IF (SELECT count(*) FROM unnest(v_readers) r WHERE to_regprocedure(r) IS NULL) <> 0 THEN
    RAISE EXCEPTION 'Reports v3 read-back: a report reader is missing';
  END IF;
  IF pg_has_role('anon', 'authenticated', 'MEMBER') OR pg_has_role('anon', 'service_role', 'MEMBER') THEN
    RAISE EXCEPTION 'Reports v3 read-back: anon inherits a reader role';
  END IF;
  IF has_schema_privilege('anon', 'private', 'USAGE') OR has_schema_privilege('authenticated', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'Reports v3 read-back: a client role has USAGE on schema private';
  END IF;

  FOR f IN SELECT to_regprocedure(w) AS oid, w FROM unnest(v_writers) w LOOP
    CONTINUE WHEN f.oid IS NULL;
    IF (SELECT coalesce(string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' ORDER BY a.grantee::regrole::text), '')
          FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         WHERE p.oid = f.oid AND a.grantee <> p.proowner) NOT IN ('authenticated:EXECUTE', '') THEN
      RAISE EXCEPTION 'Reports v3 read-back: class W privileges drifted on %', f.w;
    END IF;
  END LOOP;
  IF v_contract <> '3.0.0' AND (to_regprocedure(v_writers[1]) IS NULL OR to_regprocedure(v_writers[2]) IS NULL) THEN
    RAISE EXCEPTION 'Reports v3 read-back: the PKG-B correction RPCs are missing at contract %', v_contract;
  END IF;
  IF v_contract = '3.3.0' AND (SELECT count(*) FROM unnest(v_writers[7:10]) w WHERE to_regprocedure(w) IS NULL) <> 0 THEN
    RAISE EXCEPTION 'Reports v3 read-back: the PKG-D RPCs are missing at contract %', v_contract;
  END IF;
  FOR f IN SELECT c.oid, c.relname, c.relrowsecurity FROM pg_class c
            WHERE c.relnamespace = 'private'::regnamespace AND c.relkind = 'r' AND c.relname IN (
              'policy_sale_premium_corrections', 'policy_sale_call_links', 'policy_sale_call_link_failures',
              'policy_appointment_attributions', 'appointment_evidence_capture_windows', 'appointment_evidence_capture_gaps',
              'appointment_evidence_observations', 'appointment_occurrences', 'appointment_assignment_events',
              'appointment_outcome_events', 'appointment_type_category_events') LOOP
    IF NOT f.relrowsecurity THEN
      RAISE EXCEPTION 'Reports v3 read-back: RLS is off on private.%', f.relname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_table_privilege(v_role, f.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'Reports v3 read-back: % has a privilege on private.%', v_role, f.relname;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.report_v3_calls_org_campaign_lead')
                    AND indisvalid AND indisready) THEN
    RAISE EXCEPTION 'Reports v3 read-back: report_v3_calls_org_campaign_lead is missing or not valid';
  END IF;

  PERFORM set_config('reports_readback.contract', v_contract, true);
END $readback$;
SET LOCAL statement_timeout = '60s';
DO $read_agency$
DECLARE
  c record; v_org uuid; v_actor uuid; v_agent uuid; v_scope text := 'agency';
  v_contract text := current_setting('reports_readback.contract');
  v_tz text; v_start date; v_end date; v_t timestamptz; v_payload jsonb; v_reader text;
BEGIN
  -- The actor: the first active Admin with Reports access, from the busiest organization (calls in the last 31 days).
  FOR c IN SELECT p.id, p.organization_id FROM public.profiles p
            WHERE p.role = 'Admin' AND p.status = 'Active'
            ORDER BY (SELECT count(*) FROM public.calls k WHERE k.organization_id = p.organization_id
                        AND k.created_at >= now() - interval '31 days') DESC, p.organization_id, p.id
            LIMIT 25 LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', c.id, 'role', 'authenticated',
        'app_metadata', json_build_object('organization_id', c.organization_id))::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM public.get_report_scope_v3(v_scope);
      EXECUTE 'RESET ROLE';
      v_actor := c.id; v_org := c.organization_id;
      EXIT;
    EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
      IF SQLERRM NOT LIKE '%Reports access is not enabled%' THEN RAISE; END IF;
    END;
  END LOOP;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Reports v3 read-back: no active Admin with Reports access to read as';
  END IF;
  SELECT z.time_zone INTO v_tz FROM private.report_agency_time_zone(v_org) z;
  v_end := (now() AT TIME ZONE v_tz)::date;
  v_start := v_end - 29;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_actor, 'role', 'authenticated',
    'app_metadata', json_build_object('organization_id', v_org))::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH v_reader IN ARRAY ARRAY['get_report_scope_v3', 'get_report_summary_v3', 'get_report_journey_v3', 'get_report_sales_appointments_v3', 'get_report_state_breakdown_v3', 'get_report_call_volume_v3', 'get_report_disposition_breakdown_v3', 'get_report_campaign_calls_v3', 'get_report_lead_source_calls_v3'] LOOP
    v_t := clock_timestamp();
    IF v_reader = 'get_report_scope_v3' THEN
      EXECUTE format('SELECT public.%I(%L)', v_reader, v_scope) INTO v_payload;
    ELSE
      EXECUTE format('SELECT public.%I(%L::date, %L::date, %L::uuid, %L)', v_reader, v_start, v_end, v_agent, v_scope) INTO v_payload;
    END IF;
    IF clock_timestamp() - v_t > interval '4 seconds' THEN
      RAISE EXCEPTION 'Reports v3 read-back: % at agency scope took more than 4 s', v_reader;
    END IF;
    IF v_payload ->> 'basis_version' IS DISTINCT FROM 'reports_v3'
       OR (v_reader <> 'get_report_scope_v3' AND v_payload ->> 'contract_version' IS DISTINCT FROM v_contract) THEN
      RAISE EXCEPTION 'Reports v3 read-back: % at agency scope is not a v3 % payload', v_reader, v_contract;
    END IF;
  END LOOP;
  IF v_scope = 'agency' AND v_agent IS NULL THEN
    EXECUTE format('SELECT public.get_report_call_summary_v2(%L::date, %L::date, NULL, %L)', v_start, v_end, v_scope) INTO v_payload;
    IF (v_payload #>> '{totals,calls_made}')::bigint
       - (SELECT (e ->> 'value')::bigint FROM jsonb_array_elements(public.get_report_summary_v3(v_start, v_end, NULL, v_scope) -> 'metrics') e
           WHERE (e ->> 'id')::int = 5)
       IS DISTINCT FROM (SELECT (x.pop ->> 'non_attempts')::bigint + (x.pop ->> 'unverified')::bigint
                           FROM (SELECT public.get_report_call_volume_v3(v_start, v_end, NULL, v_scope) -> 'call_population' AS pop) x) THEN
      RAISE EXCEPTION 'Reports v3 read-back: v2 calls_made − v3 KPI 5 is not non_attempts + unverified';
    END IF;
  END IF;
  EXECUTE 'RESET ROLE';
END $read_agency$;
SET LOCAL statement_timeout = '60s';
DO $read_team$
DECLARE
  c record; v_org uuid; v_actor uuid; v_agent uuid; v_scope text := 'team';
  v_contract text := current_setting('reports_readback.contract');
  v_tz text; v_start date; v_end date; v_t timestamptz; v_payload jsonb; v_reader text;
BEGIN
  -- The actor: the first active Team Leader with Reports access, from the busiest organization (calls in the last 31 days).
  FOR c IN SELECT p.id, p.organization_id FROM public.profiles p
            WHERE p.role = 'Team Leader' AND p.status = 'Active'
       AND EXISTS (SELECT 1 FROM public.profiles d WHERE d.upline_id = p.id AND d.status = 'Active')
            ORDER BY (SELECT count(*) FROM public.calls k WHERE k.organization_id = p.organization_id
                        AND k.created_at >= now() - interval '31 days') DESC, p.organization_id, p.id
            LIMIT 25 LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', c.id, 'role', 'authenticated',
        'app_metadata', json_build_object('organization_id', c.organization_id))::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM public.get_report_scope_v3(v_scope);
      EXECUTE 'RESET ROLE';
      v_actor := c.id; v_org := c.organization_id;
      EXIT;
    EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
      IF SQLERRM NOT LIKE '%Reports access is not enabled%' THEN RAISE; END IF;
    END;
  END LOOP;
  IF v_actor IS NULL THEN
    RAISE NOTICE 'Reports v3 read-back: no Team Leader with an active downline and Reports access; team reads skipped';
    RETURN;
  END IF;
  SELECT z.time_zone INTO v_tz FROM private.report_agency_time_zone(v_org) z;
  v_end := (now() AT TIME ZONE v_tz)::date;
  v_start := v_end - 29;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_actor, 'role', 'authenticated',
    'app_metadata', json_build_object('organization_id', v_org))::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH v_reader IN ARRAY ARRAY['get_report_scope_v3', 'get_report_summary_v3', 'get_report_journey_v3', 'get_report_sales_appointments_v3', 'get_report_state_breakdown_v3', 'get_report_call_volume_v3', 'get_report_disposition_breakdown_v3', 'get_report_campaign_calls_v3', 'get_report_lead_source_calls_v3'] LOOP
    v_t := clock_timestamp();
    IF v_reader = 'get_report_scope_v3' THEN
      EXECUTE format('SELECT public.%I(%L)', v_reader, v_scope) INTO v_payload;
    ELSE
      EXECUTE format('SELECT public.%I(%L::date, %L::date, %L::uuid, %L)', v_reader, v_start, v_end, v_agent, v_scope) INTO v_payload;
    END IF;
    IF clock_timestamp() - v_t > interval '4 seconds' THEN
      RAISE EXCEPTION 'Reports v3 read-back: % at team scope took more than 4 s', v_reader;
    END IF;
    IF v_payload ->> 'basis_version' IS DISTINCT FROM 'reports_v3'
       OR (v_reader <> 'get_report_scope_v3' AND v_payload ->> 'contract_version' IS DISTINCT FROM v_contract) THEN
      RAISE EXCEPTION 'Reports v3 read-back: % at team scope is not a v3 % payload', v_reader, v_contract;
    END IF;
  END LOOP;
  EXECUTE 'RESET ROLE';
END $read_team$;
SET LOCAL statement_timeout = '60s';
DO $read_personal$
DECLARE
  c record; v_org uuid; v_actor uuid; v_agent uuid; v_scope text := 'personal';
  v_contract text := current_setting('reports_readback.contract');
  v_tz text; v_start date; v_end date; v_t timestamptz; v_payload jsonb; v_reader text;
BEGIN
  -- The actor: the first active Agent with Reports access, from the busiest organization (calls in the last 31 days).
  FOR c IN SELECT p.id, p.organization_id FROM public.profiles p
            WHERE p.role = 'Agent' AND p.status = 'Active'
            ORDER BY (SELECT count(*) FROM public.calls k WHERE k.organization_id = p.organization_id
                        AND k.created_at >= now() - interval '31 days') DESC, p.organization_id, p.id
            LIMIT 25 LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', c.id, 'role', 'authenticated',
        'app_metadata', json_build_object('organization_id', c.organization_id))::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM public.get_report_scope_v3(v_scope);
      EXECUTE 'RESET ROLE';
      v_actor := c.id; v_org := c.organization_id;
      EXIT;
    EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
      IF SQLERRM NOT LIKE '%Reports access is not enabled%' THEN RAISE; END IF;
    END;
  END LOOP;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Reports v3 read-back: no active Agent with Reports access to read as';
  END IF;
  SELECT z.time_zone INTO v_tz FROM private.report_agency_time_zone(v_org) z;
  v_end := (now() AT TIME ZONE v_tz)::date;
  v_start := v_end - 29;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_actor, 'role', 'authenticated',
    'app_metadata', json_build_object('organization_id', v_org))::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH v_reader IN ARRAY ARRAY['get_report_scope_v3', 'get_report_summary_v3', 'get_report_journey_v3', 'get_report_sales_appointments_v3', 'get_report_state_breakdown_v3', 'get_report_call_volume_v3', 'get_report_disposition_breakdown_v3', 'get_report_campaign_calls_v3', 'get_report_lead_source_calls_v3'] LOOP
    v_t := clock_timestamp();
    IF v_reader = 'get_report_scope_v3' THEN
      EXECUTE format('SELECT public.%I(%L)', v_reader, v_scope) INTO v_payload;
    ELSE
      EXECUTE format('SELECT public.%I(%L::date, %L::date, %L::uuid, %L)', v_reader, v_start, v_end, v_agent, v_scope) INTO v_payload;
    END IF;
    IF clock_timestamp() - v_t > interval '4 seconds' THEN
      RAISE EXCEPTION 'Reports v3 read-back: % at personal scope took more than 4 s', v_reader;
    END IF;
    IF v_payload ->> 'basis_version' IS DISTINCT FROM 'reports_v3'
       OR (v_reader <> 'get_report_scope_v3' AND v_payload ->> 'contract_version' IS DISTINCT FROM v_contract) THEN
      RAISE EXCEPTION 'Reports v3 read-back: % at personal scope is not a v3 % payload', v_reader, v_contract;
    END IF;
  END LOOP;
  EXECUTE 'RESET ROLE';
END $read_personal$;
SET LOCAL statement_timeout = '60s';
DO $read_agent_filter$
DECLARE
  c record; v_org uuid; v_actor uuid; v_agent uuid; v_scope text := 'agency';
  v_contract text := current_setting('reports_readback.contract');
  v_tz text; v_start date; v_end date; v_t timestamptz; v_payload jsonb; v_reader text;
BEGIN
  -- The actor: the first active Admin with Reports access, from the busiest organization (calls in the last 31 days).
  FOR c IN SELECT p.id, p.organization_id FROM public.profiles p
            WHERE p.role = 'Admin' AND p.status = 'Active'
              AND EXISTS (SELECT 1 FROM public.profiles a WHERE a.organization_id = p.organization_id AND a.role = 'Agent' AND a.status = 'Active')
            ORDER BY (SELECT count(*) FROM public.calls k WHERE k.organization_id = p.organization_id
                        AND k.created_at >= now() - interval '31 days') DESC, p.organization_id, p.id
            LIMIT 25 LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', c.id, 'role', 'authenticated',
        'app_metadata', json_build_object('organization_id', c.organization_id))::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM public.get_report_scope_v3(v_scope);
      EXECUTE 'RESET ROLE';
      v_actor := c.id; v_org := c.organization_id;
      EXIT;
    EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
      IF SQLERRM NOT LIKE '%Reports access is not enabled%' THEN RAISE; END IF;
    END;
  END LOOP;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Reports v3 read-back: no active Admin with Reports access to read as';
  END IF;
    v_agent := (SELECT p.id FROM public.profiles p WHERE p.organization_id = v_org AND p.role = 'Agent' AND p.status = 'Active'
                 ORDER BY p.id LIMIT 1);
    IF v_agent IS NULL THEN
      RAISE NOTICE 'Reports v3 read-back: no active Agent in the Admin''s organization; agent_filter reads skipped';
      RETURN;
    END IF;
  SELECT z.time_zone INTO v_tz FROM private.report_agency_time_zone(v_org) z;
  v_end := (now() AT TIME ZONE v_tz)::date;
  v_start := v_end - 29;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_actor, 'role', 'authenticated',
    'app_metadata', json_build_object('organization_id', v_org))::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH v_reader IN ARRAY ARRAY['get_report_scope_v3', 'get_report_summary_v3', 'get_report_journey_v3', 'get_report_sales_appointments_v3', 'get_report_state_breakdown_v3', 'get_report_call_volume_v3', 'get_report_disposition_breakdown_v3', 'get_report_campaign_calls_v3', 'get_report_lead_source_calls_v3'] LOOP
    v_t := clock_timestamp();
    IF v_reader = 'get_report_scope_v3' THEN
      EXECUTE format('SELECT public.%I(%L)', v_reader, v_scope) INTO v_payload;
    ELSE
      EXECUTE format('SELECT public.%I(%L::date, %L::date, %L::uuid, %L)', v_reader, v_start, v_end, v_agent, v_scope) INTO v_payload;
    END IF;
    IF clock_timestamp() - v_t > interval '4 seconds' THEN
      RAISE EXCEPTION 'Reports v3 read-back: % at agent_filter scope took more than 4 s', v_reader;
    END IF;
    IF v_payload ->> 'basis_version' IS DISTINCT FROM 'reports_v3'
       OR (v_reader <> 'get_report_scope_v3' AND v_payload ->> 'contract_version' IS DISTINCT FROM v_contract) THEN
      RAISE EXCEPTION 'Reports v3 read-back: % at agent_filter scope is not a v3 % payload', v_reader, v_contract;
    END IF;
  END LOOP;
  EXECUTE 'RESET ROLE';
END $read_agent_filter$;
ROLLBACK;
