-- =====================================================================================================
-- Commission grids — disposable LOCAL harness (AGENT_RULES invariant #28).
-- Load order (scripts/run_commission_grids_tests.sh):
--   THIS FILE → extracted private.campaign_actor() (verbatim from 20260811200920) → migrations under test
--   → suites.
--
-- What a real Supabase request has, reproduced here so authorization is proven with NON-BYPASS roles:
--   * roles anon / authenticated (NOLOGIN, no BYPASSRLS) and service_role (BYPASSRLS, not superuser);
--   * Supabase's default privileges in schema public (new tables/functions are granted to anon,
--     authenticated and service_role unless a migration revokes them) — so a missing REVOKE fails here;
--   * auth.uid() from the JWT `sub` claim;
--   * the tenant/role resolvers VERBATIM from production pg_get_functiondef (read-only, 2026-10-15);
--   * the two public.profiles SELECT policies VERBATIM from production pg_policies (2026-10-15);
--   * comp_test.run_as(): run ONE statement as a client role with given JWT claims and REPORT the
--     outcome (SQLSTATE, message, returned json) instead of raising.
-- Synthetic identities only. Nothing here resembles production data.
-- =====================================================================================================

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $roles$;

CREATE EXTENSION IF NOT EXISTS ltree;

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

-- Supabase's platform default privileges (the trap a migration must REVOKE against).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- ---- Minimal tenant tables (column subset of production) ------------------------------------------
CREATE TABLE public.organizations (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name   text NOT NULL,
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE public.profiles (
  id               uuid PRIMARY KEY,
  organization_id  uuid REFERENCES public.organizations(id),
  role             text NOT NULL DEFAULT 'Agent'
                   CHECK (role IN ('Agent', 'Team Leader', 'Admin', 'Super Admin')),
  status           text NOT NULL DEFAULT 'Active',
  is_super_admin   boolean DEFAULT false,
  platform_role    text,
  commission_level text DEFAULT '0%'::text,
  first_name       text,
  last_name        text,
  hierarchy_path   ltree
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizations, public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.organizations, public.profiles TO service_role;

-- ---- Resolvers — VERBATIM from production pg_get_functiondef (2026-10-15) --------------------------
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

CREATE OR REPLACE FUNCTION public.get_user_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT organization_id FROM profiles WHERE id = auth.uid()
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

CREATE OR REPLACE FUNCTION public.is_ancestor_of(ancestor_id uuid, descendant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles d
    WHERE d.id = descendant_id
    AND d.hierarchy_path <@ (
      SELECT p.hierarchy_path FROM public.profiles p WHERE p.id = ancestor_id
    )
  );
$function$;

-- ---- public.profiles SELECT policies — VERBATIM from production pg_policies (2026-10-15) -----------
CREATE POLICY profiles_select_org ON public.profiles FOR SELECT TO public
  USING ((organization_id = get_user_org_id()));
CREATE POLICY profiles_select_hierarchical ON public.profiles FOR SELECT TO authenticated
  USING ((((organization_id IS NOT NULL) AND super_admin_own_org(organization_id)) OR ((organization_id = get_org_id()) AND ((get_user_role() = 'Admin'::text) OR ((get_user_role() = 'Team Leader'::text) AND ((id = auth.uid()) OR is_ancestor_of(auth.uid(), id))) OR ((get_user_role() = 'Agent'::text) AND (id = auth.uid()))))));

-- ---- private schema (production: no USAGE for anon/authenticated) ---------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- ---- Test helpers (superuser-owned; never part of a migration) ------------------------------------
CREATE SCHEMA IF NOT EXISTS comp_test;

-- Claims as Supabase issues them: sub, app_metadata.organization_id / role, top-level is_super_admin.
CREATE OR REPLACE FUNCTION comp_test.claims(p_sub uuid, p_org uuid, p_role text, p_super boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'sub', p_sub, 'role', 'authenticated', 'is_super_admin', p_super,
    'app_metadata', jsonb_build_object('organization_id', p_org, 'role', p_role))
$$;

-- Claims for an existing synthetic profile (org/role/super from its own row).
CREATE OR REPLACE FUNCTION comp_test.claims_for(p_profile uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT comp_test.claims(p.id, p.organization_id, p.role, coalesce(p.is_super_admin, false))
  FROM public.profiles p WHERE p.id = p_profile
$$;

-- Run ONE statement as p_role with p_claims; report (sqlstate, message, json result). The statement
-- should return a single json/jsonb value (or nothing). Never raises.
CREATE OR REPLACE FUNCTION comp_test.run_as(p_role text, p_claims jsonb, p_sql text)
RETURNS TABLE (out_state text, out_message text, out_result jsonb)
LANGUAGE plpgsql AS $$
DECLARE v_result jsonb;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', coalesce(p_claims, '{}'::jsonb)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql INTO v_result;
    EXECUTE 'SET LOCAL ROLE NONE';
    PERFORM set_config('request.jwt.claims', '{}', true);
    out_state := '00000'; out_message := 'ok'; out_result := v_result;
  EXCEPTION WHEN OTHERS THEN
    out_state := SQLSTATE; out_message := SQLERRM; out_result := NULL;
  END;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION comp_test.ok(p_label text, p_state text, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_state IS DISTINCT FROM '00000' THEN
    RAISE EXCEPTION '% FAILED: expected success, got % "%"', p_label, p_state, p_message;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION comp_test.refused(p_label text, p_state text, p_message text,
                                             p_want_state text, p_want_like text DEFAULT '%')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_state IS DISTINCT FROM p_want_state OR p_message NOT LIKE p_want_like THEN
    RAISE EXCEPTION '% FAILED: expected % "%", got % "%"', p_label, p_want_state, p_want_like, p_state, p_message;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION comp_test.check(p_label text, p_condition boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS NOT TRUE THEN
    RAISE EXCEPTION '% FAILED', p_label;
  END IF;
END $$;

-- ---- Agency Groups (peer organizations) — column subset; helper VERBATIM from production (2026-10-15) --
-- Present so the access suite can prove that an ACTIVE peer agency still reads nothing: the commission
-- tables have no peer branch.
CREATE TABLE public.agency_groups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE public.agency_group_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_group_id uuid NOT NULL REFERENCES public.agency_groups(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  status          text NOT NULL DEFAULT 'active'
);
REVOKE ALL ON public.agency_groups, public.agency_group_members FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_agency_group_peer_organization(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.agency_group_members m1
    INNER JOIN public.agency_group_members m2
      ON m1.agency_group_id = m2.agency_group_id
      AND m2.status = 'active'
    WHERE m1.organization_id = public.get_org_id()
      AND m1.status = 'active'
      AND m2.organization_id = p_org_id
  );
$function$;

-- ---- Synthetic base fixtures (as the table owner, the way the reviewed import writes reference data) ---
-- Agencies: A (home), B (another agency), C (ACTIVE Agency Group peer of A).
-- People in A: two admins, an agent, a team leader, an INACTIVE admin, a super admin (home org A).
-- Shared grids: S1 active (a term product with two term variants, a whole-life product with two age bands
-- and an inactive IUL product; explicit zero rate; protected references), S2 active, S3 INACTIVE.
-- Availability: S1, S2 and S3 to agency A; S2 to agency B; nothing to C (decision D5).
-- Every identity, carrier, product, label and value is synthetic.
CREATE OR REPLACE FUNCTION comp_test.seed_base()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.organizations (id, name) VALUES
    ('aaaaaaaa-0000-0000-0000-00000000000a', 'Synthetic Agency A'),
    ('bbbbbbbb-0000-0000-0000-00000000000b', 'Synthetic Agency B'),
    ('cccccccc-0000-0000-0000-00000000000c', 'Synthetic Agency C');
  INSERT INTO public.profiles (id, organization_id, role, status, is_super_admin, commission_level, first_name, last_name) VALUES
    ('aaaaaaaa-0000-0000-0000-0000000000ad', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Admin',       'Active',   false, '120%', 'Ada',  'One'),
    ('aaaaaaaa-0000-0000-0000-0000000000ae', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Admin',       'Active',   false, '100',  'Abe',  'Two'),
    ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Agent',       'Active',   false, '100',  'Al',   'Agent'),
    ('aaaaaaaa-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Team Leader', 'Active',   false, '110',  'Tia',  'Leader'),
    ('aaaaaaaa-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Admin',       'Inactive', false, '100',  'Ina',  'Inactive'),
    ('aaaaaaaa-0000-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Admin',       'Active',   true,  '100',  'Sue',  'Super'),
    ('bbbbbbbb-0000-0000-0000-0000000000ad', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Admin',       'Active',   false, '90',   'Bea',  'Admin'),
    ('bbbbbbbb-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Agent',       'Active',   false, '80',   'Bo',   'Agent'),
    ('cccccccc-0000-0000-0000-0000000000ad', 'cccccccc-0000-0000-0000-00000000000c', 'Admin',       'Active',   false, '90',   'Cy',   'Admin'),
    ('cccccccc-0000-0000-0000-0000000000c1', 'cccccccc-0000-0000-0000-00000000000c', 'Agent',       'Active',   false, '80',   'Cal',  'Agent');

  INSERT INTO public.agency_groups (id, name) VALUES ('99999999-9999-0000-0000-000000000001', 'Synthetic Group');
  INSERT INTO public.agency_group_members (agency_group_id, organization_id, status) VALUES
    ('99999999-9999-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'active'),
    ('99999999-9999-0000-0000-000000000001', 'cccccccc-0000-0000-0000-00000000000c', 'active');

  -- S1 (active shared)
  INSERT INTO public.comp_grids (id, organization_id, name, effective_date, contract_levels, origin) VALUES
    ('51000000-0000-0000-0000-000000000001', NULL, 'Synthetic Shared One', '2025-01-01', ARRAY[130,120,110,100,90,80], 'agentflow_reference');
  INSERT INTO public.comp_products (id, grid_id, organization_id, category, carrier, product_name, is_active) VALUES
    ('51000000-0000-0000-0000-000000000101', '51000000-0000-0000-0000-000000000001', NULL, 'term',       'Carrier North', 'Level Term',  true),
    ('51000000-0000-0000-0000-000000000102', '51000000-0000-0000-0000-000000000001', NULL, 'whole_life', 'Carrier North', 'Final Plan',  true),
    ('51000000-0000-0000-0000-000000000103', '51000000-0000-0000-0000-000000000001', NULL, 'iul',        'Carrier South', 'Index Plan',  false);
  INSERT INTO public.comp_product_variants (id, grid_id, product_id, organization_id, label, min_age, max_age, term_years) VALUES
    ('51000000-0000-0000-0000-000000000201', '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000101', NULL, '10-15 yr', 18, 70, ARRAY[10,15]),
    ('51000000-0000-0000-0000-000000000202', '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000101', NULL, '20 yr',    18, 60, ARRAY[20]),
    ('51000000-0000-0000-0000-000000000203', '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000102', NULL, '0-70',     NULL, 70, NULL),
    ('51000000-0000-0000-0000-000000000204', '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000102', NULL, '71+',      71, NULL, NULL),
    ('51000000-0000-0000-0000-000000000205', '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000103', NULL, '',         0, 80, NULL);
  INSERT INTO public.comp_rates (grid_id, variant_id, organization_id, contract_level, rate_percent) VALUES
    ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000201', NULL, 130, 101.5),
    ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000201', NULL, 100, 70),
    ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000202', NULL, 100, 65.25),
    ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000203', NULL, 120, 91.75),
    ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000203', NULL, 100, 75.5),
    ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000204', NULL, 100, 0),
    ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000205', NULL, 100, 50);
  INSERT INTO public.comp_variant_references (variant_id, grid_id, organization_id, source, notes) VALUES
    ('51000000-0000-0000-0000-000000000203', '51000000-0000-0000-0000-000000000001', NULL, 'Synthetic schedule p.1', 'Synthetic protected note');

  -- S2 (active shared, minimal) and S3 (INACTIVE shared)
  INSERT INTO public.comp_grids (id, organization_id, name, effective_date, contract_levels, origin, is_active) VALUES
    ('52000000-0000-0000-0000-000000000001', NULL, 'Synthetic Shared Two',   '2025-06-01', ARRAY[100,90], 'agentflow_reference', true),
    ('53000000-0000-0000-0000-000000000001', NULL, 'Synthetic Shared Three', '2024-01-01', ARRAY[100,90], 'agentflow_reference', false);
  INSERT INTO public.comp_products (id, grid_id, organization_id, category, carrier, product_name) VALUES
    ('52000000-0000-0000-0000-000000000101', '52000000-0000-0000-0000-000000000001', NULL, 'whole_life', 'Carrier West', 'Basic Plan');
  INSERT INTO public.comp_product_variants (id, grid_id, product_id, organization_id, label) VALUES
    ('52000000-0000-0000-0000-000000000201', '52000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000101', NULL, '');
  INSERT INTO public.comp_rates (grid_id, variant_id, organization_id, contract_level, rate_percent) VALUES
    ('52000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000201', NULL, 100, 40);

  -- Availability (decision D5): AgentFlow makes a shared grid available to an agency explicitly; an agency
  -- admin can enable only an available grid. A: S1, S2 and S3 (inactive). B: S2 only. C (A's Agency Group
  -- peer): nothing.
  INSERT INTO public.organization_comp_grid_availability (organization_id, grid_id) VALUES
    ('aaaaaaaa-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-000000000001'),
    ('aaaaaaaa-0000-0000-0000-00000000000a', '52000000-0000-0000-0000-000000000001'),
    ('aaaaaaaa-0000-0000-0000-00000000000a', '53000000-0000-0000-0000-000000000001'),
    ('bbbbbbbb-0000-0000-0000-00000000000b', '52000000-0000-0000-0000-000000000001');
END $$;

-- Run p_sql as the given synthetic profile (claims from its own row) and return the outcome.
CREATE OR REPLACE FUNCTION comp_test.as_profile(p_profile uuid, p_sql text)
RETURNS TABLE (out_state text, out_message text, out_result jsonb)
LANGUAGE sql AS $$
  SELECT * FROM comp_test.run_as('authenticated', comp_test.claims_for(p_profile), p_sql)
$$;

-- Shorthand for the synthetic people (see comp_test.seed_base()).
CREATE OR REPLACE FUNCTION comp_test.p(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_name
    WHEN 'admin_a'   THEN 'aaaaaaaa-0000-0000-0000-0000000000ad'::uuid
    WHEN 'admin_a2'  THEN 'aaaaaaaa-0000-0000-0000-0000000000ae'::uuid
    WHEN 'agent_a'   THEN 'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid
    WHEN 'leader_a'  THEN 'aaaaaaaa-0000-0000-0000-0000000000a2'::uuid
    WHEN 'inactive_a' THEN 'aaaaaaaa-0000-0000-0000-0000000000a3'::uuid
    WHEN 'super_a'   THEN 'aaaaaaaa-0000-0000-0000-0000000000a4'::uuid
    WHEN 'admin_b'   THEN 'bbbbbbbb-0000-0000-0000-0000000000ad'::uuid
    WHEN 'agent_b'   THEN 'bbbbbbbb-0000-0000-0000-0000000000b1'::uuid
    WHEN 'admin_c'   THEN 'cccccccc-0000-0000-0000-0000000000ad'::uuid
    WHEN 'agent_c'   THEN 'cccccccc-0000-0000-0000-0000000000c1'::uuid
  END
$$;

-- count(*) of a table as a profile; returns the integer or raises with the label on an error.
CREATE OR REPLACE FUNCTION comp_test.visible(p_label text, p_profile uuid, p_table text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM comp_test.as_profile(p_profile, format('SELECT to_jsonb(count(*)) FROM public.%I', p_table));
  PERFORM comp_test.ok(p_label, r.out_state, r.out_message);
  RETURN (r.out_result #>> '{}')::integer;
END $$;

-- The helpers below reference the commission tables, which the migrations under test create AFTER this
-- file is loaded; SQL-function bodies are therefore validated at first use instead of at creation.
SET check_function_bodies = off;

-- Run an operation as a synthetic profile: assert success and return its json result.
CREATE OR REPLACE FUNCTION comp_test.op_ok(p_label text, p_profile uuid, p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM comp_test.as_profile(p_profile, p_sql);
  PERFORM comp_test.ok(p_label, r.out_state, r.out_message);
  RETURN r.out_result;
END $$;

-- Run an operation as a synthetic profile and assert the refusal (SQLSTATE and message pattern).
CREATE OR REPLACE FUNCTION comp_test.op_refused(p_label text, p_profile uuid, p_sql text, p_state text,
                                                p_like text DEFAULT '%') RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM comp_test.as_profile(p_profile, p_sql);
  PERFORM comp_test.refused(p_label, r.out_state, r.out_message, p_state, p_like);
END $$;

-- comp_save_grid_changes as a profile (success returns {grid_id, revision}).
CREATE OR REPLACE FUNCTION comp_test.save(p_label text, p_profile uuid, p_grid uuid, p_revision bigint, p_changes jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT comp_test.op_ok(p_label, p_profile,
    format('SELECT public.comp_save_grid_changes(%L, %s, %L::jsonb)', p_grid, p_revision, p_changes))
$$;

CREATE OR REPLACE FUNCTION comp_test.save_refused(p_label text, p_profile uuid, p_grid uuid, p_revision bigint,
                                                  p_changes jsonb, p_state text, p_like text DEFAULT '%')
RETURNS void LANGUAGE sql AS $$
  SELECT comp_test.op_refused(p_label, p_profile,
    format('SELECT public.comp_save_grid_changes(%L, %s, %L::jsonb)', p_grid, p_revision, p_changes), p_state, p_like)
$$;

-- Owner-level lookups by natural key (test-only; names are unique within a suite).
CREATE OR REPLACE FUNCTION comp_test.gid(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT g.id FROM public.comp_grids g WHERE g.name = p_name
$$;
CREATE OR REPLACE FUNCTION comp_test.rev(p_grid uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT g.revision FROM public.comp_grids g WHERE g.id = p_grid
$$;
CREATE OR REPLACE FUNCTION comp_test.pid(p_grid uuid, p_product text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT p.id FROM public.comp_products p WHERE p.grid_id = p_grid AND p.product_name = p_product
$$;
CREATE OR REPLACE FUNCTION comp_test.vid(p_grid uuid, p_product text, p_label text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT v.id FROM public.comp_product_variants v JOIN public.comp_products p ON p.id = v.product_id
   WHERE v.grid_id = p_grid AND p.product_name = p_product AND v.label = p_label
$$;
CREATE OR REPLACE FUNCTION comp_test.rate(p_variant uuid, p_level integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT r.rate_percent::text FROM public.comp_rates r WHERE r.variant_id = p_variant AND r.contract_level = p_level
$$;

-- A grid's content as sorted natural-key lines (P products, V variants, R rates, N references), so two
-- grids can be compared without their ids. Owner-level (RLS bypassed).
CREATE OR REPLACE FUNCTION comp_test.content(p_grid uuid, p_kinds text DEFAULT 'PVRN') RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(s.l ORDER BY s.l COLLATE "C"), '{}') FROM (
    SELECT 'P|' || concat_ws('|', p.category, p.carrier, p.product_name, p.is_active) AS l
      FROM public.comp_products p WHERE p.grid_id = p_grid AND position('P' IN p_kinds) > 0
    UNION ALL
    SELECT 'V|' || concat_ws('|', p.category, p.carrier, p.product_name, v.label, coalesce(v.min_age::text, '-'),
                              coalesce(v.max_age::text, '-'), coalesce(v.term_years::text, '-'))
      FROM public.comp_product_variants v JOIN public.comp_products p ON p.id = v.product_id
     WHERE v.grid_id = p_grid AND position('V' IN p_kinds) > 0
    UNION ALL
    SELECT 'R|' || concat_ws('|', p.category, p.carrier, p.product_name, v.label, r.contract_level, r.rate_percent::text)
      FROM public.comp_rates r JOIN public.comp_product_variants v ON v.id = r.variant_id
      JOIN public.comp_products p ON p.id = v.product_id
     WHERE r.grid_id = p_grid AND position('R' IN p_kinds) > 0
    UNION ALL
    SELECT 'N|' || concat_ws('|', p.category, p.carrier, p.product_name, v.label, coalesce(x.source, '-'), coalesce(x.notes, '-'))
      FROM public.comp_variant_references x JOIN public.comp_product_variants v ON v.id = x.variant_id
      JOIN public.comp_products p ON p.id = v.product_id
     WHERE x.grid_id = p_grid AND position('N' IN p_kinds) > 0) s
$$;

RESET check_function_bodies;

-- Owner-level assertions (RLS bypassed; proves the CONSTRAINTS and TRIGGERS alone). Deferred checks are
-- forced inside the probe so a deferred refusal is attributed to the statement that caused it.
CREATE OR REPLACE FUNCTION comp_test.owner_refused(p_label text, p_sql text, p_state text, p_like text DEFAULT '%')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    v_state := '00000';
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'probe rollback';
  EXCEPTION WHEN OTHERS THEN
    IF v_state IS NULL THEN v_state := SQLSTATE; v_msg := SQLERRM; END IF;
  END;
  IF v_state = '00000' THEN
    RAISE EXCEPTION '% FAILED: expected % but the statement succeeded', p_label, p_state;
  END IF;
  IF v_state IS DISTINCT FROM p_state OR v_msg NOT LIKE p_like THEN
    RAISE EXCEPTION '% FAILED: expected % "%", got % "%"', p_label, p_state, p_like, v_state, v_msg;
  END IF;
END $$;

-- Succeeds and KEEPS its effect (unlike owner_refused, whose probe is always rolled back).
CREATE OR REPLACE FUNCTION comp_test.owner_ok(p_label text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '% FAILED: expected success, got % "%"', p_label, SQLSTATE, SQLERRM;
  END;
END $$;
