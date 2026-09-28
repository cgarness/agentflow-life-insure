-- =====================================================================================================
-- Reports EMERGENCY DISABLE (plan rev 2 §R2.3). Apply as a NEW migration only with Chris's approval.
-- =====================================================================================================
-- Revokes EXECUTE on the six public get_report_* RPCs from authenticated (and PUBLIC / anon), keeping
-- the functions in place, and RE-ASSERTS the seal on the four legacy public.rpc_report_* functions.
-- The Reports page then renders "Reports are temporarily unavailable" (never zeros). Reversible with
-- supabase/ops/reports_enable.sql. Reads and writes no table data; changes no RLS policy.
-- Refuses (changes nothing) unless every get_report_* function exists.
-- =====================================================================================================

SET LOCAL lock_timeout = '5s';

DO $disable$
DECLARE
  v_sig text;
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
      RAISE EXCEPTION 'reports disable: % is missing; refusing', v_sig;
    END IF;
    EXECUTE pg_catalog.format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
                              pg_catalog.to_regprocedure(v_sig)::text);
    IF pg_catalog.has_function_privilege('authenticated', v_sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'reports disable: % is still client-executable; refusing', v_sig;
    END IF;
  END LOOP;

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
         OR pg_catalog.has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'reports disable: legacy % is still client-executable; refusing', v_sig;
      END IF;
    END IF;
  END LOOP;
END
$disable$;
