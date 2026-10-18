-- =====================================================================================================
-- D0 — seal public.list_unrestricted_users(): synthetic fixture + assertion library.
-- Loaded by scripts/run_seal_list_unrestricted_users_tests.sh into a THROWAWAY template database on a
-- loopback server (AGENT_RULES invariant #28). Never run this against a hosted project.
--
-- The fixture reproduces the production preimage exactly (read-only capture, 2026-10-18):
--   owner postgres, SECURITY DEFINER, LANGUAGE sql, body "\n  SELECT * FROM public.profiles;\n",
--   md5(pg_get_functiondef) 41b9e7d550c0d013c9306db9dd2b7b27 under search_path "$user", public, extensions,
--   ACL {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}.
-- The preimage constants below are never edited to make the fixture pass; a mismatch is a finding.
-- Every row is synthetic. The assertions are database-role checks only (no PostgREST, no browser).
-- =====================================================================================================
\set ON_ERROR_STOP on

-- Roles are cluster-global: create them only if this throwaway cluster does not have them yet.
DO $roles$
DECLARE r text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'fixture refused: connect as the bootstrap superuser postgres (got %)', current_user;
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $roles$;

CREATE SCHEMA seal_test;
CREATE TABLE seal_test.synthetic_sentinel (marker text PRIMARY KEY);
INSERT INTO seal_test.synthetic_sentinel VALUES ('agentflow-d0-synthetic-fixture');
CREATE TABLE seal_test.fixture_meta (k text PRIMARY KEY, v text NOT NULL);

-- Two synthetic agencies; every first_name starts with "Synthetic" (the runner refuses any other row).
CREATE TABLE public.profiles (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  first_name      text NOT NULL,
  role            text NOT NULL
);
INSERT INTO public.profiles (id, organization_id, first_name, role) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-00000000000a', 'Synthetic Admin A', 'Admin'),
  ('d0000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-00000000000a', 'Synthetic Agent A', 'Agent'),
  ('d0000000-0000-0000-0000-0000000000b1', 'd0000000-0000-0000-0000-00000000000b', 'Synthetic Admin B', 'Admin'),
  ('d0000000-0000-0000-0000-0000000000b2', 'd0000000-0000-0000-0000-00000000000b', 'Synthetic Agent B', 'Agent');

-- The function exactly as production holds it, then the production ACL in production's element order:
-- the first GRANT materializes the default {=X/postgres,postgres=X/postgres}; later grants append.
CREATE FUNCTION public.list_unrestricted_users() RETURNS SETOF public.profiles
  LANGUAGE sql SECURITY DEFINER
  AS $function$
  SELECT * FROM public.profiles;
$function$;
GRANT EXECUTE ON FUNCTION public.list_unrestricted_users() TO anon;
GRANT EXECUTE ON FUNCTION public.list_unrestricted_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_unrestricted_users() TO service_role;

-- ── Assertion library (seal_test schema only; plpgsql bodies create no pg_depend rows on the function) ─────
CREATE FUNCTION seal_test.preimage_md5() RETURNS text LANGUAGE sql IMMUTABLE
  AS $$ SELECT '41b9e7d550c0d013c9306db9dd2b7b27'::text $$;
CREATE FUNCTION seal_test.preimage_acl() RETURNS aclitem[] LANGUAGE sql IMMUTABLE
  AS $$ SELECT '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[] $$;
CREATE FUNCTION seal_test.sealed_acl() RETURNS aclitem[] LANGUAGE sql IMMUTABLE
  AS $$ SELECT '{postgres=X/postgres,service_role=X/postgres}'::aclitem[] $$;

-- Same search_path as the migration's guard, so the md5 is computed exactly as production's capture was.
CREATE FUNCTION seal_test.fn_md5() RETURNS text LANGUAGE sql STABLE
  SET search_path = "$user", public, extensions
  AS $$ SELECT md5(pg_catalog.pg_get_functiondef('public.list_unrestricted_users()'::regprocedure)) $$;
CREATE FUNCTION seal_test.fn_acl() RETURNS aclitem[] LANGUAGE sql STABLE
  AS $$ SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = 'public.list_unrestricted_users()'::regprocedure $$;
CREATE FUNCTION seal_test.data_fp() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT md5(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id)) FROM public.profiles p $$;

-- assert_state(label, 'open' | 'sealed'): definition, owner, SECURITY DEFINER and data are always the preimage's;
-- 'open' requires the production ACL and client EXECUTE; 'sealed' requires the sealed ACL, no client EXECUTE, and
-- EXECUTE kept for postgres and service_role.
CREATE FUNCTION seal_test.assert_state(p_label text, p_expect text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_fn     regprocedure := 'public.list_unrestricted_users()'::regprocedure;
  v_owner  text;
  v_secdef boolean;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef INTO v_owner, v_secdef
    FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF seal_test.fn_md5() IS DISTINCT FROM seal_test.preimage_md5() THEN
    RAISE EXCEPTION '% FAIL: definition md5 is %, preimage is %', p_label, seal_test.fn_md5(), seal_test.preimage_md5();
  END IF;
  IF v_owner IS DISTINCT FROM 'postgres' OR v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION '% FAIL: owner % / security definer %', p_label, v_owner, v_secdef;
  END IF;
  IF seal_test.data_fp() IS DISTINCT FROM (SELECT m.v FROM seal_test.fixture_meta m WHERE m.k = 'data_fp') THEN
    RAISE EXCEPTION '% FAIL: profiles data changed', p_label;
  END IF;
  IF p_expect = 'open' THEN
    IF seal_test.fn_acl() IS DISTINCT FROM seal_test.preimage_acl() THEN
      RAISE EXCEPTION '% FAIL: expected the preimage ACL, found %', p_label, seal_test.fn_acl();
    END IF;
    IF NOT pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% FAIL: an open fixture lost EXECUTE for a role', p_label;
    END IF;
  ELSIF p_expect = 'sealed' THEN
    IF seal_test.fn_acl() IS DISTINCT FROM seal_test.sealed_acl() THEN
      RAISE EXCEPTION '% FAIL: expected the sealed ACL, found %', p_label, seal_test.fn_acl();
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% FAIL: a client role can still execute', p_label;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('postgres', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% FAIL: postgres or service_role lost EXECUTE', p_label;
    END IF;
  ELSE
    RAISE EXCEPTION 'assert_state: unknown expectation %', p_expect;
  END IF;
  RETURN p_label || ' OK (' || p_expect || ')';
END $$;

-- expect_denied(label): runs as the CURRENT role (the runner switches with SET ROLE) and requires the platform
-- privilege error, not just any 42501.
CREATE FUNCTION seal_test.expect_denied(p_label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.list_unrestricted_users();
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM = 'permission denied for function list_unrestricted_users' THEN
      RETURN p_label || ' OK: ' || current_user || ' denied (42501 ' || SQLERRM || ')';
    END IF;
    RAISE EXCEPTION '% FAIL: unexpected 42501 message: %', p_label, SQLERRM;
  END;
  RAISE EXCEPTION '% FAIL: % executed public.list_unrestricted_users()', p_label, current_user;
END $$;

-- expect_rows(label, rows, agencies): runs as the CURRENT role and requires exactly that much visibility.
CREATE FUNCTION seal_test.expect_rows(p_label text, p_rows integer, p_orgs integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n integer; o integer;
BEGIN
  SELECT count(*), count(DISTINCT u.organization_id) INTO n, o FROM public.list_unrestricted_users() u;
  IF n IS DISTINCT FROM p_rows OR o IS DISTINCT FROM p_orgs THEN
    RAISE EXCEPTION '% FAIL: % read % rows across % agencies (expected % across %)', p_label, current_user, n, o, p_rows, p_orgs;
  END IF;
  RETURN p_label || ' OK: ' || current_user || ' read ' || n || ' rows across ' || o || ' agencies';
END $$;

-- S8 only: an inert event-trigger function. The runner attaches it (ddl_command_end WHEN TAG IN ('REVOKE')) in S8
-- databases only. REVOKE gives no object identity to pg_event_trigger_ddl_commands(), so it filters by tag alone.
CREATE FUNCTION seal_test.s8_fail_after_revoke() RETURNS event_trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'S8 injected failure after REVOKE (tag %)', tg_tag;
END $$;

-- S11 only: an inert event-trigger function that re-grants anon right after the REVOKE, so the migration's and the
-- rollback's own postconditions are what must refuse. Attached only in S11 databases; GRANT does not re-fire it.
CREATE FUNCTION seal_test.s11_regrant_anon_after_revoke() RETURNS event_trigger LANGUAGE plpgsql AS $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.list_unrestricted_users() TO anon;
END $$;

GRANT USAGE ON SCHEMA seal_test TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION seal_test.expect_denied(text), seal_test.expect_rows(text, integer, integer)
  TO anon, authenticated, service_role;

INSERT INTO seal_test.fixture_meta (k, v) VALUES ('data_fp', seal_test.data_fp());

-- Fixture fidelity: refuse to continue unless the template reproduces the production preimage exactly.
SELECT seal_test.assert_state('FIXTURE fidelity', 'open');
