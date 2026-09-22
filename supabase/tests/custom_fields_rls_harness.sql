-- =====================================================================================================
-- Client-role + RLS harness for the custom-field WRITE-PATH suite.
-- STATUS: run ONLY on a disposable LOCAL PostgreSQL database (AGENT_RULES invariant #28).
-- Load order (scripts/run_custom_field_guard_tests.sh, client-role stage):
--   custom_fields_harness.sql → THIS FILE → 20260919052941 guard → REPRODUCTION →
--   20260922222659 grant → custom_field_authenticated_writes.sql → grant ROLLBACK → REPRODUCTION again.
-- =====================================================================================================
-- WHY THIS EXISTS. The guard suite (custom_field_logical_name_guard.sql) runs every statement as the
-- connecting SUPERUSER and deliberately does not replay RLS. Superusers skip ACL checks, so that suite
-- could not see the 2026-09-19 outage, in which every CLIENT-role INSERT of an active organization field
-- failed in index maintenance with 42501 `permission denied for function custom_field_norm`.
--
-- This file adds what a real PostgREST write has:
--   * Supabase's `auth.uid()` (the JWT `sub` claim);
--   * the four RLS resolvers, VERBATIM from production `pg_get_functiondef` (read-only, 2026-09-22);
--   * the four public.custom_fields policies, VERBATIM from production `pg_policies` (2026-09-22);
--   * `service_role BYPASSRLS` (production: rolbypassrls = true, rolsuper = false), USAGE on
--     public/auth, and SELECT on profiles (get_org_id()'s fallback reads it as the invoker);
--   * Team Leader and Super Admin fixtures in org A;
--   * cf_test.* helpers that run ONE statement as a client role with given JWT claims and REPORT the
--     outcome (SQLSTATE + message + returned row) instead of raising, the reproduction of the production
--     failure, and a fingerprint of everything the grant must NOT change.

-- ---- Supabase auth.uid() -------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

GRANT USAGE ON SCHEMA auth   TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.profiles TO authenticated, service_role;

ALTER ROLE service_role BYPASSRLS;

-- ---- RLS resolvers — VERBATIM from production pg_get_functiondef (2026-09-22) --------------------
CREATE OR REPLACE FUNCTION public.get_org_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  -- Primary: JWT claim (fast path — no table access)
  v_org := NULLIF(
    current_setting('request.jwt.claims', true)::json
      ->'app_metadata'->>'organization_id',
    ''
  )::uuid;

  IF v_org IS NOT NULL THEN
    RETURN v_org;
  END IF;

  -- Fallback: profile table lookup (handles stale/missing JWT claims)
  SELECT organization_id INTO v_org
  FROM public.profiles
  WHERE id = auth.uid();

  RETURN v_org;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role', '');
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::json->>'is_super_admin')::BOOLEAN,
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.super_admin_own_org(row_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN row_org IS NULL THEN false
    WHEN NOT public.is_super_admin() THEN false
    WHEN public.get_org_id() IS NULL THEN false
    ELSE row_org = public.get_org_id()
  END;
$function$;

-- ---- The four custom_fields policies — VERBATIM from production pg_policies (2026-09-22) ---------
ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_fields_delete ON public.custom_fields;
CREATE POLICY custom_fields_delete ON public.custom_fields FOR DELETE TO authenticated
  USING ((super_admin_own_org(organization_id) OR ((organization_id IS NOT NULL) AND (organization_id = get_org_id()) AND (((created_by IS NOT NULL) AND (created_by = auth.uid())) OR ((created_by IS NULL) AND ((get_user_role() = 'Admin'::text) OR is_super_admin()))))));

DROP POLICY IF EXISTS custom_fields_insert ON public.custom_fields;
CREATE POLICY custom_fields_insert ON public.custom_fields FOR INSERT TO authenticated
  WITH CHECK (((organization_id IS NOT NULL) AND (organization_id = get_org_id()) AND ((created_by = auth.uid()) OR ((created_by IS NULL) AND ((get_user_role() = 'Admin'::text) OR is_super_admin())))));

DROP POLICY IF EXISTS custom_fields_select ON public.custom_fields;
CREATE POLICY custom_fields_select ON public.custom_fields FOR SELECT TO authenticated
  USING ((super_admin_own_org(organization_id) OR ((organization_id IS NULL) AND (created_by IS NULL)) OR ((organization_id IS NOT NULL) AND (organization_id = get_org_id()) AND ((created_by IS NULL) OR (created_by = auth.uid()) OR (get_user_role() = 'Admin'::text) OR is_super_admin()))));

DROP POLICY IF EXISTS custom_fields_update ON public.custom_fields;
CREATE POLICY custom_fields_update ON public.custom_fields FOR UPDATE TO authenticated
  USING ((super_admin_own_org(organization_id) OR ((organization_id IS NOT NULL) AND (organization_id = get_org_id()) AND (((created_by IS NOT NULL) AND (created_by = auth.uid())) OR ((created_by IS NULL) AND ((get_user_role() = 'Admin'::text) OR is_super_admin()))))))
  WITH CHECK ((super_admin_own_org(organization_id) OR ((organization_id IS NOT NULL) AND (organization_id = get_org_id()) AND (((created_by IS NOT NULL) AND (created_by = auth.uid())) OR ((created_by IS NULL) AND ((get_user_role() = 'Admin'::text) OR is_super_admin()))))));

-- ---- Fixtures: every role the fix must serve, all in org A ---------------------------------------
-- The base harness already holds the Admin (…ad) and two Agents (…a1, …a2) in org A and an Agent in
-- org B. Production's Super Admin is `role = 'Admin'` plus the `is_super_admin` claim.
INSERT INTO public.profiles (id, organization_id, role, status) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-00000000000a','Team Leader','Active'),
  ('aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-00000000000a','Admin','Active')
ON CONFLICT (id) DO NOTHING;

-- ---- Helpers -------------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS cf_test;

-- The JWT claims a real session carries: custom_access_token_hook's top-level org_id / user_role /
-- is_super_admin, plus the raw_app_meta_data projection under app_metadata (what get_org_id() and
-- get_user_role() read).
CREATE OR REPLACE FUNCTION cf_test.claims(p_sub uuid, p_org uuid, p_role text, p_super boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'sub', p_sub,
    'role', 'authenticated',
    'org_id', p_org,
    'user_role', p_role,
    'is_super_admin', p_super,
    'app_metadata', jsonb_build_object('organization_id', p_org, 'role', p_role))
$$;

-- Run ONE statement as p_role with p_claims inside its own subtransaction and REPORT the outcome.
-- p_sql must yield a single jsonb value; writes use `RETURNING to_jsonb(<table>.*)`, as PostgREST's
-- return=representation does, so the SELECT policy is enforced on the returned row exactly as in
-- production. On error the subtransaction abort reverts the role and the claims; on success they are
-- reset explicitly before returning.
CREATE OR REPLACE FUNCTION cf_test.run_as(p_role text, p_claims jsonb, p_sql text)
RETURNS TABLE (out_state text, out_message text, out_row jsonb)
LANGUAGE plpgsql AS $$
DECLARE v_row jsonb;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', coalesce(p_claims, '{}'::jsonb)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql INTO v_row;
    EXECUTE 'SET LOCAL ROLE NONE';
    PERFORM set_config('request.jwt.claims', '{}', true);
    out_state := '00000'; out_message := 'ok'; out_row := v_row;
  EXCEPTION WHEN OTHERS THEN
    out_state := SQLSTATE; out_message := SQLERRM; out_row := NULL;
  END;
  RETURN NEXT;
END$$;

CREATE OR REPLACE FUNCTION cf_test.expect_written(
  p_label text, p_state text, p_message text, p_row jsonb, p_org uuid, p_created_by uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_state IS DISTINCT FROM '00000' THEN
    RAISE EXCEPTION '% FAILED: expected the write to succeed, got % "%"', p_label, p_state, p_message;
  END IF;
  IF p_row IS NULL THEN
    RAISE EXCEPTION '% FAILED: the write returned no row', p_label;
  END IF;
  IF (p_row->>'organization_id')::uuid IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION '% FAILED: organization_id is %, expected %', p_label, p_row->>'organization_id', p_org;
  END IF;
  IF (p_row->>'created_by')::uuid IS DISTINCT FROM p_created_by THEN
    RAISE EXCEPTION '% FAILED: created_by is %, expected %', p_label, coalesce(p_row->>'created_by', 'NULL'),
      coalesce(p_created_by::text, 'NULL');
  END IF;
END$$;

CREATE OR REPLACE FUNCTION cf_test.expect_refused(
  p_label text, p_state text, p_message text, p_want_state text, p_want_message_like text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_state IS DISTINCT FROM p_want_state OR p_message NOT LIKE p_want_message_like THEN
    RAISE EXCEPTION '% FAILED: expected % "%", got % "%"',
      p_label, p_want_state, p_want_message_like, p_state, p_message;
  END IF;
END$$;

-- THE PRODUCTION FAILURE, reproduced. Every client-role write path that forms an entry in
-- custom_fields_org_norm_active_idx must fail with EXACTLY the production error. Called by the runner
-- BEFORE the grant, and again AFTER the grant is rolled back (the re-break proof). Seeds are created as
-- the table owner with unique names, so the function can run more than once in one database.
CREATE OR REPLACE FUNCTION cf_test.assert_writes_blocked_by_norm_privilege()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  c_org_a  constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  c_admin  constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000ad';
  c_agent  constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  c_state  constant text := '42501';
  c_msg    constant text := 'permission denied for function custom_field_norm';
  v_tag    text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  v_active uuid;
  v_idle   uuid;
  r        record;
BEGIN
  -- (1) Exactly what customFieldsSupabaseApi.create() sends for an Admin's personal field.
  SELECT * INTO r FROM cf_test.run_as('authenticated', cf_test.claims(c_admin, c_org_a, 'Admin'), format(
    $q$INSERT INTO public.custom_fields
         (name, type, applies_to, organization_id, created_by, active, required, default_value, dropdown_options)
       VALUES (%L, 'Text', '["Leads"]'::jsonb, %L, %L, true, false, '', '[]'::jsonb)
       RETURNING to_jsonb(custom_fields.*)$q$, 'Repro Create ' || v_tag, c_org_a, c_admin));
  PERFORM cf_test.expect_refused('REPRO insert (Admin personal)', r.out_state, r.out_message, c_state, c_msg);

  -- Seeds owned by the Agent, written by the table owner (which holds EXECUTE).
  INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by, active)
  VALUES ('Repro Active ' || v_tag, 'Text', '["Leads"]'::jsonb, c_org_a, c_agent, true)
  RETURNING id INTO v_active;
  INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by, active)
  VALUES ('Repro Idle ' || v_tag, 'Text', '["Leads"]'::jsonb, c_org_a, c_agent, false)
  RETURNING id INTO v_idle;

  -- (2) Renaming an own active field forms a new index entry.
  SELECT * INTO r FROM cf_test.run_as('authenticated', cf_test.claims(c_agent, c_org_a, 'Agent'), format(
    $q$UPDATE public.custom_fields SET name = %L WHERE id = %L RETURNING to_jsonb(custom_fields.*)$q$,
    'Repro Renamed ' || v_tag, v_active));
  PERFORM cf_test.expect_refused('REPRO rename (Agent own field)', r.out_state, r.out_message, c_state, c_msg);

  -- (3) Re-activating an own inactive field enters the partial index.
  SELECT * INTO r FROM cf_test.run_as('authenticated', cf_test.claims(c_agent, c_org_a, 'Agent'), format(
    $q$UPDATE public.custom_fields SET active = true WHERE id = %L RETURNING to_jsonb(custom_fields.*)$q$,
    v_idle));
  PERFORM cf_test.expect_refused('REPRO re-activate (Agent own field)', r.out_state, r.out_message, c_state, c_msg);

  -- (4) service_role bypasses RLS but not ACL checks.
  SELECT * INTO r FROM cf_test.run_as('service_role', '{}'::jsonb, format(
    $q$INSERT INTO public.custom_fields (name, type, applies_to, organization_id, created_by, active)
       VALUES (%L, 'Text', '["Leads"]'::jsonb, %L, NULL, true)
       RETURNING to_jsonb(custom_fields.*)$q$, 'Repro Service ' || v_tag, c_org_a));
  PERFORM cf_test.expect_refused('REPRO insert (service_role)', r.out_state, r.out_message, c_state, c_msg);

  RETURN 'REPRODUCED: 4/4 client-role writes failed with 42501 "' || c_msg || '"';
END$$;

-- One digest of everything the grant migration must NOT change: every custom_fields row, the table
-- ACL, the four policies, every index on the table, both triggers, the guard's definition and ACL,
-- the normalizer's definition (its ACL is the one thing that SHOULD change, asserted separately) and
-- the private schema's ACL. PL/pgSQL, not SQL: a SQL-language body is analysed at CREATE time, and the
-- two `private` functions it names do not exist yet when this harness loads (the guard migration runs
-- after it).
CREATE OR REPLACE FUNCTION cf_test.fingerprint() RETURNS text LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN (SELECT md5(concat_ws(E'\n',
    (SELECT string_agg(to_jsonb(c)::text, ',' ORDER BY c.id) FROM public.custom_fields c),
    (SELECT relacl::text FROM pg_class WHERE oid = 'public.custom_fields'::regclass),
    (SELECT string_agg(polname::text || ':' || polcmd::text || ':' || coalesce(pg_get_expr(polqual, polrelid), '')
                       || ':' || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ',' ORDER BY polname)
       FROM pg_policy WHERE polrelid = 'public.custom_fields'::regclass),
    (SELECT string_agg(pg_get_indexdef(indexrelid), ',' ORDER BY indexrelid::regclass::text)
       FROM pg_index WHERE indrelid = 'public.custom_fields'::regclass),
    (SELECT string_agg(tgname::text || ':' || tgfoid::regprocedure::text || ':' || tgenabled::text, ',' ORDER BY tgname)
       FROM pg_trigger WHERE tgrelid = 'public.custom_fields'::regclass AND NOT tgisinternal),
    (SELECT md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, '')
       FROM pg_proc p WHERE p.oid = 'private.custom_fields_logical_name_guard()'::regprocedure),
    (SELECT md5(pg_get_functiondef(p.oid))
       FROM pg_proc p WHERE p.oid = 'private.custom_field_norm(text)'::regprocedure),
    (SELECT nspacl::text FROM pg_namespace WHERE nspname = 'private')
  )));
END$$;

DO $$
BEGIN
  RAISE NOTICE 'client-role harness ready: auth.uid(), 4 resolvers, 4 policies, RLS on, TL + Super Admin fixtures';
END$$;
