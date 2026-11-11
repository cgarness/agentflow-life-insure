-- Disposable LOCAL PostgreSQL fixture only. No production/customer rows are used.
-- Carrier columns, indexes, ACLs, policy expressions and helper behavior reflect the
-- read-only catalog inspection for this feature. Organizations/profiles are minimal stubs.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'This disposable fixture requires the local postgres owner';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agentflow_policy_commission_writer') THEN
    CREATE ROLE agentflow_policy_commission_writer NOLOGIN;
  END IF;
END;
$$;

CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE SCHEMA carrier_test;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO service_role, agentflow_policy_commission_writer;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub'
  )::uuid;
$$;

CREATE TABLE public.organizations (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, organization_id uuid REFERENCES public.organizations(id));
GRANT SELECT ON public.profiles TO authenticated, service_role;

CREATE FUNCTION public.get_org_id() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path TO public AS $$
DECLARE v_org uuid;
BEGIN
  v_org := NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'organization_id', '')::uuid;
  IF v_org IS NOT NULL THEN RETURN v_org; END IF;
  SELECT organization_id INTO v_org FROM public.profiles WHERE id = auth.uid();
  RETURN v_org;
END;
$$;
CREATE FUNCTION public.get_user_role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role', '');
$$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((current_setting('request.jwt.claims', true)::json->>'is_super_admin')::boolean, false);
$$;
CREATE FUNCTION public.update_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_org_id(), public.get_user_role(), public.is_super_admin(),
  public.update_updated_at() TO anon, authenticated, service_role;

CREATE TABLE public.carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  portal_url text,
  is_appointed boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  logo_url text,
  contact_phones jsonb NOT NULL DEFAULT '[]'::jsonb,
  contact_emails jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX carriers_org_lower_name_unique ON public.carriers (organization_id, lower(name));
CREATE INDEX carriers_organization_id_idx ON public.carriers (organization_id);
CREATE INDEX idx_carriers_org ON public.carriers (organization_id);
CREATE TRIGGER carriers_updated_at BEFORE UPDATE ON public.carriers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Preserve these broad historical grants. RLS does not protect TRUNCATE;
-- addressing that existing exposure is a separate hardening change.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.carriers TO anon, authenticated, service_role;
ALTER TABLE public.carriers ENABLE ROW LEVEL SECURITY;
CREATE POLICY carriers_select ON public.carriers FOR SELECT TO authenticated
  USING ((organization_id = get_org_id()) OR is_super_admin());
CREATE POLICY carriers_insert ON public.carriers FOR INSERT TO authenticated
  WITH CHECK ((organization_id IS NOT NULL) AND
    (is_super_admin() OR ((organization_id = get_org_id()) AND (get_user_role() = 'Admin'::text))));
CREATE POLICY carriers_update ON public.carriers FOR UPDATE TO authenticated
  USING (is_super_admin() OR ((organization_id = get_org_id()) AND (get_user_role() = 'Admin'::text)))
  WITH CHECK ((organization_id IS NOT NULL) AND
    (is_super_admin() OR ((organization_id = get_org_id()) AND (get_user_role() = 'Admin'::text))));
CREATE POLICY carriers_delete ON public.carriers FOR DELETE TO authenticated
  USING (is_super_admin() OR ((organization_id = get_org_id()) AND (get_user_role() = 'Admin'::text)));

INSERT INTO public.organizations VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001'), ('bbbbbbbb-0000-4000-8000-000000000001');
INSERT INTO public.profiles VALUES
  ('aaaaaaaa-2222-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-2222-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001');
INSERT INTO public.carriers
  (id, name, portal_url, is_appointed, created_at, updated_at, organization_id, logo_url, contact_phones, contact_emails)
VALUES
  ('aaaaaaaa-1111-4000-8000-000000000001', 'Fixture Carrier A', 'https://portal.carrier-a.example', true,
    '2020-01-01 00:00:00+00', '2020-02-01 00:00:00+00', 'aaaaaaaa-0000-4000-8000-000000000001',
    'https://carrier-a.example/logo.svg', '[{"label":"Agent support","number":"+12025550101"}]',
    '[{"label":"Underwriting","email":"underwriting@carrier-a.example"}]'),
  ('aaaaaaaa-1111-4000-8000-000000000002', 'Fixture Carrier Empty', NULL, false,
    '2020-01-01 00:00:00+00', '2020-02-01 00:00:00+00', 'aaaaaaaa-0000-4000-8000-000000000001', NULL, '[]', '[]'),
  ('bbbbbbbb-1111-4000-8000-000000000001', 'Fixture Carrier B', 'https://carrier-b.example', NULL,
    '2020-01-01 00:00:00+00', '2020-02-01 00:00:00+00', 'bbbbbbbb-0000-4000-8000-000000000001', NULL, '[]', '[]');

-- Snapshot every existing carrier field and relevant security object before applying the migration.
CREATE FUNCTION carrier_test.metadata() RETURNS jsonb LANGUAGE sql STABLE SET search_path TO pg_catalog AS $$
  SELECT jsonb_build_object(
    'table', (SELECT jsonb_build_object('owner', relowner, 'rls', relrowsecurity,
      'force_rls', relforcerowsecurity, 'acl', relacl::text) FROM pg_class WHERE oid = 'public.carriers'::regclass),
    'columns', (SELECT jsonb_agg(jsonb_build_object('name', a.attname, 'type', a.atttypid,
      'not_null', a.attnotnull, 'acl', a.attacl::text, 'default', pg_get_expr(d.adbin, d.adrelid),
      'comment', col_description(a.attrelid, a.attnum)) ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.carriers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attname <> 'resource_links'),
    'constraints', (SELECT jsonb_agg(jsonb_build_object('name', conname, 'definition', pg_get_constraintdef(oid))
      ORDER BY conname) FROM pg_constraint WHERE conrelid = 'public.carriers'::regclass),
    'indexes', (SELECT jsonb_agg(jsonb_build_object('name', indexname, 'definition', indexdef) ORDER BY indexname)
      FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'carriers'),
    'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname)
      FROM pg_policies p WHERE schemaname = 'public' AND tablename = 'carriers'),
    'triggers', (SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname) FROM pg_trigger
      WHERE tgrelid = 'public.carriers'::regclass AND NOT tgisinternal AND tgname <> 'carriers_resource_links_validate'),
    'helpers', (SELECT jsonb_agg(jsonb_build_object('definition', pg_get_functiondef(p.oid),
      'acl', p.proacl::text, 'owner', p.proowner) ORDER BY p.proname) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
        AND p.proname IN ('get_org_id', 'get_user_role', 'is_super_admin', 'update_updated_at')),
    'private_schema_acl', (SELECT nspacl::text FROM pg_namespace WHERE nspname = 'private')
  );
$$;
CREATE TABLE carrier_test.baseline AS
  SELECT carrier_test.metadata() AS metadata,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.carriers c) AS carrier_rows;

CREATE FUNCTION carrier_test.assert(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %', p_message; END IF;
END;
$$;
CREATE FUNCTION carrier_test.claims(p_org uuid, p_role text, p_super boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('sub', 'aaaaaaaa-2222-4000-8000-000000000001', 'role', 'authenticated',
    'is_super_admin', p_super, 'app_metadata', jsonb_build_object('organization_id', p_org, 'role', p_role));
$$;

-- Execute one statement as a real client database role; this helper is NOT SECURITY DEFINER.
-- An exception subtransaction restores the role and claims, just as a failed client write rolls back.
CREATE FUNCTION carrier_test.run_as(p_role text, p_claims jsonb, p_sql text)
RETURNS TABLE (state text, message text, result jsonb) LANGUAGE plpgsql AS $$
DECLARE v_result jsonb;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', coalesce(p_claims, '{}'::jsonb)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql INTO v_result;
    RESET ROLE;
    RETURN QUERY SELECT '00000'::text, NULL::text, v_result;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT SQLSTATE::text, SQLERRM::text, NULL::jsonb;
  END;
END;
$$;

-- Keep test assertions concise without accidentally treating a zero-row UPDATE as authorization.
CREATE FUNCTION carrier_test.expect(p_name text, p_role text, p_claims jsonb, p_sql text,
  p_state text, p_expected jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM carrier_test.run_as(p_role, p_claims, p_sql);
  PERFORM carrier_test.assert(v.state = p_state,
    p_name || ': expected SQLSTATE ' || p_state || ', got ' || v.state || ': ' || coalesce(v.message, ''));
  IF p_expected IS NOT NULL THEN
    PERFORM carrier_test.assert(v.result = p_expected, p_name || ': unexpected result ' || coalesce(v.result::text, 'NULL'));
  END IF;
END;
$$;
