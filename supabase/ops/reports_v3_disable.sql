-- =====================================================================================================
-- Reports V2 (v3) OFF (plan §9.6 R1). Privilege class R (plan §2.8): REVOKE only.
-- Apply as a NEW migration or a protected runner stage only with Chris's approval.
--
-- Revokes every privilege on public.get_report_%_v3 and private.report_v3_% from PUBLIC, anon, authenticated and
-- service_role, and re-asserts the seal on the legacy public.rpc_report_* functions. The v2 readers, the v1 functions
-- and every class W application RPC (corrections, sale call links, appointment outcomes and links) are untouched, so
-- old Reports tabs keep working and the new page shows "Reports unavailable". Restore with reports_v3_enable.sql.
-- Refuses (changes nothing) when no v3 reader exists. Reads and writes no table data; changes no RLS policy.
-- =====================================================================================================
SET LOCAL lock_timeout = '5s';

DO $disable$
DECLARE f record; v_role text;
BEGIN
  IF pg_catalog.to_regprocedure('public.get_report_summary_v3(date,date,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Reports v3 disable: no v3 reader exists; refusing';
  END IF;
  FOR f IN SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'private' AND p.proname LIKE 'report\_v3\_%')
               OR (n.nspname = 'public' AND (p.proname LIKE 'get\_report\_%\_v3' OR p.proname LIKE 'rpc\_report\_%')) LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f.oid::regprocedure);
  END LOOP;
  FOR f IN SELECT p.oid, p.proacl, p.proowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'private' AND p.proname LIKE 'report\_v3\_%')
               OR (n.nspname = 'public' AND (p.proname LIKE 'get\_report\_%\_v3' OR p.proname LIKE 'rpc\_report\_%')) LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'Reports v3 disable: PUBLIC can still execute %', f.oid::regprocedure;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF pg_catalog.has_function_privilege(v_role, f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Reports v3 disable: % can still execute %', v_role, f.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
END $disable$;
NOTIFY pgrst, 'reload schema';
