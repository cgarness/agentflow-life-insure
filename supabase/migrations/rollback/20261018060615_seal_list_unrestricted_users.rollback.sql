-- Re-assert only. Not an inverse. Never re-grants EXECUTE.
-- Rollback companion for the D0 seal (the migration with this version and name). Apply only with Chris's
-- separate approval. It re-asserts that PUBLIC, anon and authenticated cannot execute public.list_unrestricted_users().
-- It never grants EXECUTE to PUBLIC, anon or authenticated, never revokes from postgres (owner) or service_role, never
-- drops the function, and reads or writes no data. It refuses, changing nothing, if postgres or service_role would be
-- left without EXECUTE (possible only where service_role's access came through PUBLIC; production grants service_role
-- explicitly), or if the REVOKE would change the ACL while catalog objects depend on the function (invariant #37).
-- No inverse is provided: re-opening client EXECUTE would expose every agency's profiles to the public anon key
-- (AGENT_RULES invariant #20). After this runs, re-applying the forward migration is refused by its preimage guard
-- because the ACL is already sealed; that refusal is expected.
DO $reassert$
DECLARE
  v_fn     regprocedure := to_regprocedure('public.list_unrestricted_users()');
  v_old_lt text := pg_catalog.current_setting('lock_timeout');
  v_old_sp text := pg_catalog.current_setting('search_path');
  v_before aclitem[];
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '1s', true);
  PERFORM pg_catalog.set_config('search_path', '"$user", public, extensions', true);

  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'D0 rollback refused: public.list_unrestricted_users() not found';
  END IF;

  SELECT p.proacl INTO v_before FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;

  REVOKE EXECUTE ON FUNCTION public.list_unrestricted_users() FROM PUBLIC, anon, authenticated;

  -- On an already sealed function the REVOKE changes nothing; it only matters (and is only refused) when it seals.
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) IS DISTINCT FROM v_before
     AND EXISTS (SELECT 1
                   FROM pg_catalog.pg_depend d
                  WHERE d.refclassid = 'pg_catalog.pg_proc'::regclass
                    AND d.refobjid = v_fn::oid
                    AND d.deptype <> 'p') THEN
    RAISE EXCEPTION 'D0 rollback refused: catalog objects depend on public.list_unrestricted_users()';
  END IF;

  IF NOT pg_catalog.has_function_privilege('postgres', v_fn, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'D0 rollback refused: postgres or service_role would be left without EXECUTE';
  END IF;

  -- A NULL proacl means the default ACL, which lets PUBLIC execute; the REVOKE above always materializes it.
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) IS NULL
     OR EXISTS (SELECT 1
                  FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                 WHERE p.oid = v_fn AND a.grantee = 0)
     OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'D0 rollback postcondition failed: a client role can still execute public.list_unrestricted_users()';
  END IF;

  PERFORM pg_catalog.set_config('search_path', v_old_sp, true);
  PERFORM pg_catalog.set_config('lock_timeout', v_old_lt, true);
  PERFORM pg_catalog.pg_notify('pgrst', 'reload schema');
END $reassert$;
