-- =====================================================================================================
-- ALL Reports OFF: v1, v2 and v3 (plan §9.6 R2). Privilege class R (plan §2.8): REVOKE only.
-- Apply as a NEW migration or a protected runner stage only with Chris's approval.
--
-- Revokes every privilege on public.get_report_%, public.rpc_report_% and private.report_% from PUBLIC, anon,
-- authenticated and service_role, then checks that no report function is executable by any client role. Class W
-- application RPCs (corrections, sale call links, appointment outcomes and links) are not report functions and are
-- untouched. Restore with reports_v3_enable.sql, or with reports_integrity_enable.sql (v2 only; it also seals v3)
-- after a frontend rollback. Reads and writes no table data; changes no RLS policy. Never re-enables rpc_report_*.
-- =====================================================================================================
SET LOCAL lock_timeout = '5s';

DO $disable$
DECLARE f record; v_role text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'private' AND p.proname LIKE 'report\_%')
               OR (n.nspname = 'public' AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'rpc\_report\_%')) LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f.oid::regprocedure);
  END LOOP;
  FOR f IN SELECT p.oid, p.proacl, p.proowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'private' AND p.proname LIKE 'report\_%')
               OR (n.nspname = 'public' AND (p.proname LIKE 'get\_report\_%' OR p.proname LIKE 'rpc\_report\_%')) LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'Reports all disable: PUBLIC can still execute %', f.oid::regprocedure;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF pg_catalog.has_function_privilege(v_role, f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Reports all disable: % can still execute %', v_role, f.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
END $disable$;
NOTIFY pgrst, 'reload schema';
