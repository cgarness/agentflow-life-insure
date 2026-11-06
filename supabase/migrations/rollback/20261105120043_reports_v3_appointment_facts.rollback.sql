-- Rollback for 20261105120043_reports_v3_appointment_facts (D4 §8). Privilege class C: no GRANT. Runs only while
-- Reports v3 is disabled. It restores the exact …13 stub and the PKG-C basis flags (3.2.0), then drops the helpers
-- …43 added. Evidence and attributions are kept. Refuses unless the …43 postimages are in place (a later package that
-- replaced the flags needs its own reviewed rollback).
SET LOCAL lock_timeout = '2s';
DO $rollback$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'get\_report\_%\_v3'
                AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'Reports v3 appointment facts rollback: Reports v3 must be disabled first' USING ERRCODE = '55000';
  END IF;
  IF private.report_v3_basis_flags() IS DISTINCT FROM
     '{"contract_version":"3.3.0","corrections":"audited_ledger","sale_call_links":"installed","appointment_evidence":"installed"}'::jsonb
     OR to_regprocedure('private.report_v3_appointment_counts(jsonb,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Reports v3 appointment facts rollback: the …43 postimages are not in place' USING ERRCODE = 'P0001';
  END IF;
  EXECUTE $restore$CREATE OR REPLACE FUNCTION private.report_v3_appointment_facts(p_org uuid, p_agents uuid[], p_roster uuid[],
                                                    p_start_at timestamptz, p_end_at timestamptz, p_time_zone text,
                                                    p_reader_as_of timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH stub AS (
    SELECT jsonb_build_array(
             private.report_v3_ratio(12, 0, 0, NULL, NULL, 'evidence_not_captured'),
             private.report_v3_total(15, 0, NULL, 'evidence_not_captured'),
             private.report_v3_total(16, 0, NULL, 'evidence_not_captured'),
             private.report_v3_rate(17, 0, 0, NULL, NULL, 'evidence_not_captured'),
             private.report_v3_rate(18, 0, 0, NULL, NULL, 'evidence_not_captured')) AS metrics
  ), roster AS (
    SELECT r.agent_id, min(r.ord) AS ord
      FROM unnest(p_roster) WITH ORDINALITY AS r(agent_id, ord)
     WHERE r.agent_id IS NOT NULL
     GROUP BY r.agent_id
  )
  SELECT jsonb_build_object(
           'metrics', s.metrics,
           'by_agent', coalesce((SELECT jsonb_agg(jsonb_build_object('agent_id', r.agent_id, 'metrics', s.metrics) ORDER BY r.ord)
                                   FROM roster r), '[]'::jsonb))
    FROM stub s;
$$;$restore$;
  EXECUTE $restore$CREATE OR REPLACE FUNCTION private.report_v3_basis_flags()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT '{"contract_version":"3.2.0","corrections":"audited_ledger","sale_call_links":"installed","appointment_evidence":"not_installed"}'::jsonb;
$$;$restore$;
  IF md5(pg_get_functiondef('private.report_v3_appointment_facts(uuid,uuid[],uuid[],timestamptz,timestamptz,text,timestamptz)'::regprocedure)) <> '22b1c13bfc5c20dbd9bbe2fe61d2e31e'
     OR md5(pg_get_functiondef('private.report_v3_basis_flags()'::regprocedure)) <> '9c6c9d5e9a2ca2b985e027e72cd5e10d' THEN
    RAISE EXCEPTION 'Reports v3 appointment facts rollback: preimages not restored exactly' USING ERRCODE = 'P0001';
  END IF;
  DROP FUNCTION private.report_v3_appointment_kpis(jsonb, text, text, jsonb, boolean);
  DROP FUNCTION private.report_v3_appointment_counts(jsonb, uuid, boolean);
  DROP FUNCTION private.report_v3_appointment_gap(uuid, uuid, timestamptz, timestamptz);
END $rollback$;
REVOKE ALL ON FUNCTION private.report_v3_appointment_facts(uuid, uuid[], uuid[], timestamptz, timestamptz, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_basis_flags() FROM PUBLIC, anon, authenticated, service_role;
