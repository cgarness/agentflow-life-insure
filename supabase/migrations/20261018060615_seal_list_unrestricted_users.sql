-- D0 (2026-10-18): seal public.list_unrestricted_users().
-- The function is SECURITY DEFINER, owned by postgres (BYPASSRLS), returns `SELECT * FROM public.profiles;` and was
-- executable by PUBLIC, anon and authenticated, so the public anon key could read every agency's profiles over
-- /rest/v1/rpc/list_unrestricted_users. It has no callers. This revokes client EXECUTE (PUBLIC, anon, authenticated);
-- postgres (owner) and service_role keep EXECUTE. Nothing is dropped and no data is read or written.
-- One top-level DO: the guard, the REVOKE and the postconditions commit or roll back together under any runner.
-- Plan: implementation_plan.md (2026-10-18, D0). Proof: scripts/run_seal_list_unrestricted_users_tests.sh.
-- Rollback (re-assert only, never re-grants): the file with this version and name under supabase/migrations/rollback.
DO $seal$
DECLARE
  v_fn     regprocedure := to_regprocedure('public.list_unrestricted_users()');
  v_old_lt text := pg_catalog.current_setting('lock_timeout');
  v_old_sp text := pg_catalog.current_setting('search_path');
  v_md5    text;
  v_owner  text;
  v_secdef boolean;
  v_acl    aclitem[];
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '1s', true);
  -- pg_get_functiondef prints the return type relative to search_path; the preimage md5 was captured under this path.
  PERFORM pg_catalog.set_config('search_path', '"$user", public, extensions', true);

  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'D0 refused: public.list_unrestricted_users() not found';
  END IF;

  SELECT md5(pg_catalog.pg_get_functiondef(p.oid)), pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proacl
    INTO v_md5, v_owner, v_secdef, v_acl
    FROM pg_catalog.pg_proc p
   WHERE p.oid = v_fn;

  IF v_md5 IS DISTINCT FROM '41b9e7d550c0d013c9306db9dd2b7b27'
     OR v_owner IS DISTINCT FROM 'postgres'
     OR v_secdef IS NOT TRUE
     OR v_acl IS DISTINCT FROM
        '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[] THEN
    RAISE EXCEPTION 'D0 refused: preimage drift (md5 %, owner %, secdef %, acl %)', v_md5, v_owner, v_secdef, v_acl;
  END IF;

  -- Invariant #37: a revoked function breaks any catalog object that evaluates it as the calling role.
  IF EXISTS (SELECT 1
               FROM pg_catalog.pg_depend d
              WHERE d.refclassid = 'pg_catalog.pg_proc'::regclass
                AND d.refobjid = v_fn::oid
                AND d.deptype <> 'p') THEN
    RAISE EXCEPTION 'D0 refused: catalog objects depend on public.list_unrestricted_users()';
  END IF;

  REVOKE EXECUTE ON FUNCTION public.list_unrestricted_users() FROM PUBLIC, anon, authenticated;

  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_fn)
       IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'::aclitem[]
     OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR md5(pg_catalog.pg_get_functiondef(v_fn)) IS DISTINCT FROM '41b9e7d550c0d013c9306db9dd2b7b27' THEN
    RAISE EXCEPTION 'D0 postcondition failed';
  END IF;

  -- set_config(..., true) lasts until the end of the transaction, not of this DO: restore both settings for anything a
  -- wrapping runner executes afterwards in the same transaction.
  PERFORM pg_catalog.set_config('search_path', v_old_sp, true);
  PERFORM pg_catalog.set_config('lock_timeout', v_old_lt, true);
  PERFORM pg_catalog.pg_notify('pgrst', 'reload schema');
END $seal$;
