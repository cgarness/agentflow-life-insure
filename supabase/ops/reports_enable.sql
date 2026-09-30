-- =====================================================================================================
-- Reports RE-ENABLE (inverse of supabase/ops/reports_disable.sql). Apply as a NEW migration only with
-- Chris's approval.
-- =====================================================================================================
-- Grants EXECUTE on the six public get_report_* RPCs to authenticated only. It NEVER grants anything on
-- the legacy public.rpc_report_* functions: it first re-asserts their seal and refuses if they would
-- remain client-executable. Refuses (changes nothing) unless every get_report_* function exists with
-- its audited security metadata (SECURITY DEFINER, STABLE, search_path = pg_catalog, pg_temp).
-- Since 20260930120000 it also refuses unless summary / volume / campaign performance carry the verified
-- normalized-policy bodies (POLICY-SOURCE GUARD below), so Reports can never be re-enabled on win counts.
-- =====================================================================================================

SET LOCAL lock_timeout = '5s';

-- POLICY-SOURCE GUARD (plan §20.11.4; 20260930120000_reports_policies_sold_normalized_source.sql)
-- Re-enabling is refused unless the three policy-bearing RPCs carry the VERIFIED normalized-policy
-- bodies. While the win-based bodies are installed (e.g. after the preimage fixture) Reports stays
-- disabled: an older browser tab would otherwise render COUNT(wins) as policy totals. It runs
-- BEFORE any grant below, so a refusal grants nothing.
DO $policy_guard$
DECLARE
  v_expected constant jsonb := pg_catalog.jsonb_build_object(
    'public.get_report_call_summary(date,date,uuid)',         '826736e666a12d0d85ec3797b2556792',
    'public.get_report_call_volume(date,date,uuid)',          'b4f7d891d7fb29962c86b668a1a2aee6',
    'public.get_report_campaign_performance(date,date,uuid)', 'ad2e005906f5d38dc1ee0308ad368f04'
  );
  v_sig text;
  v_md5 text;
BEGIN
  FOR v_sig, v_md5 IN SELECT e.key, e.value #>> '{}' FROM pg_catalog.jsonb_each(v_expected) e LOOP
    IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig))
       IS DISTINCT FROM v_md5 THEN
      RAISE EXCEPTION 'reports enable: % is not the verified normalized-policy implementation; refusing (re-apply 20260930120000 first)', v_sig;
    END IF;
  END LOOP;
END
$policy_guard$;

DO $enable$
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
         OR pg_catalog.has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'reports enable: legacy % is still client-executable; refusing', v_sig;
      END IF;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_report_scope()',
    'public.get_report_call_summary(date,date,uuid)',
    'public.get_report_call_volume(date,date,uuid)',
    'public.get_report_disposition_breakdown(date,date,uuid)',
    'public.get_report_campaign_performance(date,date,uuid)',
    'public.get_report_lead_source_performance(date,date,uuid)'
  ] LOOP
    IF pg_catalog.to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'reports enable: % is missing; refusing', v_sig;
    END IF;
    IF NOT (SELECT p.prosecdef AND p.provolatile = 's'
                   AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
              FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig)) THEN
      RAISE EXCEPTION 'reports enable: % security metadata drifted; refusing', v_sig;
    END IF;
    EXECUTE pg_catalog.format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',
                              pg_catalog.to_regprocedure(v_sig)::text);
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',
                              pg_catalog.to_regprocedure(v_sig)::text);
    IF pg_catalog.has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'reports enable: anon can execute %; refusing', v_sig;
    END IF;
  END LOOP;
END
$enable$;
