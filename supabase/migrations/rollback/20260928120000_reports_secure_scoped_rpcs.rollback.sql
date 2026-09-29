-- =====================================================================================================
-- ROLLBACK for 20260928120000_reports_secure_scoped_rpcs.sql — FAIL-CLOSED (plan rev 2 §R2.3)
-- =====================================================================================================
-- ⚠ NOT EXECUTED ANYWHERE except disposable localhost test databases (scripts/run_reports_rpc_tests.sh).
--
-- WHAT IT DOES
--   * Drops the six public get_report_* RPCs and the eight private report_* helpers.
--   * RE-ASSERTS the seal on the four known-vulnerable legacy public.rpc_report_* functions
--     (idempotent REVOKE from PUBLIC, anon, authenticated) and ABORTS if any of them is still
--     executable by PUBLIC, anon or authenticated afterwards.
--
-- WHAT IT NEVER DOES
--   * It never re-grants EXECUTE on public.rpc_report_* to PUBLIC, anon or authenticated. Those
--     functions trust a caller-supplied organization id and are a cross-tenant data exposure.
--     There is deliberately NO script anywhere that restores those grants.
--   * It reads and writes no table data and changes no RLS policy.
--
-- RESULTING STATE: Reports is UNAVAILABLE. The frontend treats a missing function as a failure and
-- renders "Reports are temporarily unavailable" with Retry — never zeros. The legacy RPCs remain
-- inaccessible to clients. Prefer supabase/ops/reports_disable.sql for an emergency switch that keeps
-- the functions in place (reversible with reports_enable.sql).
-- =====================================================================================================

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.get_report_lead_source_performance(date, date, uuid);
DROP FUNCTION IF EXISTS public.get_report_campaign_performance(date, date, uuid);
DROP FUNCTION IF EXISTS public.get_report_disposition_breakdown(date, date, uuid);
DROP FUNCTION IF EXISTS public.get_report_call_volume(date, date, uuid);
DROP FUNCTION IF EXISTS public.get_report_call_summary(date, date, uuid);
DROP FUNCTION IF EXISTS public.get_report_scope();

DROP FUNCTION IF EXISTS private.report_meta(text, uuid, text, text, date, date, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS private.report_agent_name(text, text);
DROP FUNCTION IF EXISTS private.report_session_seconds(uuid, timestamptz, timestamptz, uuid[]);
DROP FUNCTION IF EXISTS private.report_call_facts(uuid, timestamptz, timestamptz, uuid[]);
DROP FUNCTION IF EXISTS private.report_window(uuid, date, date);
DROP FUNCTION IF EXISTS private.report_access(uuid);
DROP FUNCTION IF EXISTS private.report_permission_flags(uuid, text);
DROP FUNCTION IF EXISTS private.report_agency_time_zone(uuid);

-- Re-assert the legacy seal, then prove it. Fail closed.
DO $seal$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.rpc_report_call_summary(uuid,timestamptz,timestamptz,uuid)',
    'public.rpc_report_call_volume_timeseries(uuid,timestamptz,timestamptz,uuid)',
    'public.rpc_report_campaign_performance(uuid,timestamptz,timestamptz,uuid)',
    'public.rpc_report_disposition_breakdown(uuid,timestamptz,timestamptz,uuid)'
  ] LOOP
    IF pg_catalog.to_regprocedure(v_sig) IS NOT NULL THEN
      EXECUTE pg_catalog.format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
                                pg_catalog.to_regprocedure(v_sig)::text);
      IF pg_catalog.has_function_privilege('anon', v_sig, 'EXECUTE')
         OR pg_catalog.has_function_privilege('authenticated', v_sig, 'EXECUTE')
         OR EXISTS (
              SELECT 1
                FROM pg_catalog.pg_proc p
                CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
               WHERE p.oid = pg_catalog.to_regprocedure(v_sig)
                 AND a.grantee = 0
                 AND a.privilege_type = 'EXECUTE'
            ) THEN
        RAISE EXCEPTION 'reports rollback: legacy % is still client-executable; refusing', v_sig;
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE (n.nspname = 'public'  AND p.proname LIKE 'get\_report\_%')
        OR (n.nspname = 'private' AND p.proname LIKE 'report\_%')
  ) THEN
    RAISE EXCEPTION 'reports rollback: report objects remain; refusing';
  END IF;
END
$seal$;
