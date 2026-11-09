-- =====================================================================================================
-- Reports v3 harness controls (plan §2.8). Disposable synthetic database only, through
-- scripts/run_reports_v3_tests.sh, which refuses any non-loopback host and hosted platform roles.
-- Builds on the v2 controls in reports_integrity_controls.sql (rt.expect_sql_failure, rt.assert_sealed).
-- =====================================================================================================

-- A fresh role that holds only what PUBLIC holds, and a fresh member of authenticated (inherited grants).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reports_v3_public_only') THEN
    CREATE ROLE reports_v3_public_only NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reports_v3_inherits_authenticated') THEN
    CREATE ROLE reports_v3_inherits_authenticated NOLOGIN IN ROLE authenticated;
  END IF;
END $$;

-- The 15 report readers that class E may grant (plan §2.8): the 6 v2 readers and the 9 v3 readers.
CREATE FUNCTION rt.v2_readers() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['get_report_scope_v2', 'get_report_call_summary_v2', 'get_report_call_volume_v2',
               'get_report_disposition_breakdown_v2', 'get_report_campaign_performance_v2',
               'get_report_lead_source_performance_v2'];
$$;
CREATE FUNCTION rt.v3_readers() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['get_report_scope_v3', 'get_report_summary_v3', 'get_report_journey_v3',
               'get_report_sales_appointments_v3', 'get_report_state_breakdown_v3', 'get_report_call_volume_v3',
               'get_report_disposition_breakdown_v3', 'get_report_campaign_calls_v3',
               'get_report_lead_source_calls_v3'];
$$;

-- Effective-privilege seal for every report function (v1, v2, v3, legacy rpc_report_*, private helpers):
-- authenticated, service_role and an inheriting member of authenticated may execute exactly the enabled
-- readers; anon and a PUBLIC-only role execute nothing; private helpers are never client-executable.
CREATE FUNCTION rt.assert_sealed_v3(p_v2 boolean, p_v3 boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; r text; want boolean;
BEGIN
  FOR f IN SELECT p.oid, n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'private' AND p.proname LIKE 'report\_%')
               OR (n.nspname = 'public' AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'rpc\_report\_%')) LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'reports_v3_public_only',
                             'reports_v3_inherits_authenticated'] LOOP
      want := f.nspname = 'public'
              AND r IN ('authenticated', 'service_role', 'reports_v3_inherits_authenticated')
              AND ((p_v2 AND f.proname = ANY (rt.v2_readers())) OR (p_v3 AND f.proname = ANY (rt.v3_readers())));
      IF has_function_privilege(r, f.oid, 'EXECUTE') IS DISTINCT FROM want THEN
        RAISE EXCEPTION 'v3 seal mismatch: % for % (want %)', f.oid::regprocedure, r, want;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'reports_v3_public_only'] LOOP
    IF has_schema_privilege(r, 'private', 'USAGE') THEN
      RAISE EXCEPTION 'v3 seal mismatch: % has USAGE on schema private', r;
    END IF;
  END LOOP;
END $$;

-- Every v3 private helper: SECURITY INVOKER, search_path pinned, owned by postgres.
CREATE FUNCTION rt.assert_v3_helper_shape() RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) owner
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname LIKE 'report\_v3\_%' LOOP
    IF f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp'] OR f.owner <> 'postgres' THEN
      RAISE EXCEPTION 'v3 helper shape mismatch: % (definer %, config %, owner %)',
        f.oid::regprocedure, f.prosecdef, f.proconfig, f.owner;
    END IF;
  END LOOP;
END $$;
