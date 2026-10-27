-- =====================================================================================================
-- Google Sheets mapping v2 — M1 typed catalog suite (LOCAL ONLY; run by scripts/run_google_sheets_tests.sh on the
-- harness + foundation + push + M1, with the PRODUCTION public.normalize_us_state loaded from the baseline schema).
-- Usage: psql -v ON_ERROR_STOP=1 -v state_parity="$(cat supabase/functions/_shared/googleSheets/fixtures/state-parity.json)"
-- Every block raises on failure.
-- =====================================================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

-- ---------------------------------------------------------------- fixtures: two agencies, every role, every field scope
INSERT INTO public.organizations (id, name, status) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'Org A', 'active'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'active'),
  ('c0000000-0000-0000-0000-00000000000c', 'Org Suspended', 'suspended');
INSERT INTO public.profiles (id, organization_id, role, status, is_super_admin) VALUES
  ('11111111-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Agent', 'Active', false),        -- a1 (Sheets owner)
  ('11111111-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'Agent', 'Active', false),        -- a2
  ('11111111-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'Team Leader', 'Active', false),  -- tl
  ('11111111-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'Admin', 'Active', false),        -- admin
  ('11111111-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-00000000000a', 'Agent', 'Deleted', false),       -- inactive
  ('11111111-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000000a', 'Admin', 'Active', true),         -- super admin (home A)
  ('22222222-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'Agent', 'Active', false),        -- b1
  ('22222222-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'Admin', 'Active', false),        -- adminB
  ('33333333-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'Agent', 'Active', false);        -- suspended org

CREATE TABLE pg_temp.ids (k text PRIMARY KEY, v uuid);
INSERT INTO pg_temp.ids VALUES
  ('orgA','a0000000-0000-0000-0000-00000000000a'), ('orgB','b0000000-0000-0000-0000-00000000000b'), ('orgS','c0000000-0000-0000-0000-00000000000c'),
  ('a1','11111111-0000-0000-0000-000000000001'), ('a2','11111111-0000-0000-0000-000000000002'), ('tl','11111111-0000-0000-0000-000000000003'),
  ('admin','11111111-0000-0000-0000-000000000004'), ('inactive','11111111-0000-0000-0000-000000000005'),
  ('sa','11111111-0000-0000-0000-000000000006'), ('b1','22222222-0000-0000-0000-000000000001'),
  ('adminB','22222222-0000-0000-0000-000000000004'), ('susp','33333333-0000-0000-0000-000000000001');
CREATE FUNCTION pg_temp.id(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM pg_temp.ids WHERE ids.k = $1 $$;

INSERT INTO public.custom_fields (id, organization_id, name, type, applies_to, required, active, dropdown_options, created_by) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Coverage', 'Number', '["Leads"]', true, true, '[]', NULL),
  ('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'City', 'Text', '["Leads"]', false, true, '[]', '11111111-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'Gender', 'Dropdown', '["Leads","Clients"]', false, true, '["F","M"]', '11111111-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'Address', 'Text', '["Leads"]', false, true, '[]', '11111111-0000-0000-0000-000000000004'),
  ('f0000000-0000-0000-0000-000000000005', NULL, 'Zip Code', 'Text', '["Leads"]', false, true, '[]', NULL),                                   -- system template
  ('f0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000000a', 'Retired', 'Text', '["Leads"]', false, false, '[]', NULL),  -- inactive
  ('f0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', 'Policy Notes', 'Text', '["Clients"]', false, true, '[]', NULL),  -- not Leads
  ('f0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-00000000000a', 'Received', 'Date', '["Leads"]', false, true, '[]', '11111111-0000-0000-0000-000000000003'),
  ('f0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Secret B', 'Text', '["Leads"]', false, true, '[]', NULL),
  ('f0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b', 'B Personal', 'Text', '["Leads"]', false, true, '[]', '22222222-0000-0000-0000-000000000001');

-- The names (sorted) a user's catalog holds.
CREATE FUNCTION pg_temp.names(u uuid, o uuid) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(f->>'name', ',' ORDER BY f->>'name') FROM jsonb_array_elements(public.google_sheets_context(u, o)->'custom_fields') f
$$;
CREATE FUNCTION pg_temp.field(u uuid, o uuid, n text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT f FROM jsonb_array_elements(public.google_sheets_context(u, o)->'custom_fields') f WHERE f->>'name' = n
$$;

-- ---------------------------------------------------------------- V1 catalog version + typed keys
DO $$
DECLARE c jsonb := public.google_sheets_context(pg_temp.id('a1'), pg_temp.id('orgA')); f jsonb;
BEGIN
  PERFORM pg_temp.ok((c->>'catalog_version')::int = 2, 'catalog_version 2');
  f := pg_temp.field(pg_temp.id('a1'), pg_temp.id('orgA'), 'Coverage');
  PERFORM pg_temp.ok(f->>'type' = 'Number' AND (f->>'required')::boolean AND f->>'scope' = 'agency' AND NOT (f->>'own')::boolean
    AND f->'dropdown_options' = '[]'::jsonb AND f->>'created_by' IS NULL, 'agency Number field: ' || f::text);
  f := pg_temp.field(pg_temp.id('a1'), pg_temp.id('orgA'), 'City');
  PERFORM pg_temp.ok(f->>'type' = 'Text' AND f->>'scope' = 'personal' AND (f->>'own')::boolean, 'own personal field: ' || f::text);
  f := pg_temp.field(pg_temp.id('admin'), pg_temp.id('orgA'), 'Gender');
  PERFORM pg_temp.ok(f->>'type' = 'Dropdown' AND f->'dropdown_options' = '["F","M"]'::jsonb AND NOT (f->>'own')::boolean,
    'another user''s Dropdown, seen by the Admin: ' || f::text);
  PERFORM pg_temp.ok(c ? 'duplicate_rule' AND c ? 'lead_sources' AND c ? 'has_lead_created_workflows' AND c ? 'default_status',
    'every foundation key is still present');
  RAISE NOTICE 'PASS V1 typed catalog: catalog_version 2; type, required, options, scope and own per field';
END $$;

-- ---------------------------------------------------------------- V2 visibility matrix: unchanged foundation predicate
DO $$
BEGIN
  PERFORM pg_temp.ok(pg_temp.names(pg_temp.id('a1'), pg_temp.id('orgA')) = 'City,Coverage', 'agent a1: agency + own personal only');
  PERFORM pg_temp.ok(pg_temp.names(pg_temp.id('a2'), pg_temp.id('orgA')) = 'Coverage,Gender', 'agent a2: agency + own personal only');
  PERFORM pg_temp.ok(pg_temp.names(pg_temp.id('tl'), pg_temp.id('orgA')) = 'Coverage,Received', 'team leader: no Admin bypass');
  PERFORM pg_temp.ok(pg_temp.names(pg_temp.id('admin'), pg_temp.id('orgA')) = 'Address,City,Coverage,Gender,Received',
    'admin: every active Leads field of the agency (others'' personal included)');
  PERFORM pg_temp.ok(pg_temp.names(pg_temp.id('sa'), pg_temp.id('orgA')) = 'Address,City,Coverage,Gender,Received', 'super admin: own agency');
  PERFORM pg_temp.ok(pg_temp.names(pg_temp.id('b1'), pg_temp.id('orgB')) = 'B Personal,Secret B', 'agency B: only B fields');
  PERFORM pg_temp.ok(pg_temp.names(pg_temp.id('adminB'), pg_temp.id('orgB')) = 'B Personal,Secret B', 'admin B never sees agency A');
  RAISE NOTICE 'PASS V2 visibility: agents/TL agency+own; Admin/SA all of their own agency; system templates, inactive, non-Leads and other agencies never';
END $$;

-- ---------------------------------------------------------------- V3 eligibility and cross-agency refusal
DO $$
DECLARE n int := 0;
BEGIN
  BEGIN PERFORM public.google_sheets_context(pg_temp.id('inactive'), pg_temp.id('orgA')); EXCEPTION WHEN insufficient_privilege THEN n := n + 1; END;
  BEGIN PERFORM public.google_sheets_context(pg_temp.id('susp'), pg_temp.id('orgS')); EXCEPTION WHEN insufficient_privilege THEN n := n + 1; END;
  BEGIN PERFORM public.google_sheets_context(pg_temp.id('a1'), pg_temp.id('orgB')); EXCEPTION WHEN insufficient_privilege THEN n := n + 1; END;
  BEGIN PERFORM public.google_sheets_context(pg_temp.id('sa'), pg_temp.id('orgB')); EXCEPTION WHEN insufficient_privilege THEN n := n + 1; END;
  PERFORM pg_temp.ok(n = 4, 'inactive user, suspended agency and cross-agency reads are refused: ' || n);
  RAISE NOTICE 'PASS V3 eligibility: inactive, suspended and cross-agency (Super Admin included) refused';
END $$;

-- ---------------------------------------------------------------- V4 ACL and inventory unchanged
DO $$
DECLARE priv regprocedure := 'private.google_sheets_context(uuid, uuid)'; pub regprocedure := 'public.google_sheets_context(uuid, uuid)';
BEGIN
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', priv, 'EXECUTE') AND NOT has_function_privilege('authenticated', priv, 'EXECUTE')
    AND NOT has_function_privilege('service_role', priv, 'EXECUTE'), 'private context reachable only by its owner');
  PERFORM pg_temp.ok(has_function_privilege('service_role', pub, 'EXECUTE') AND NOT has_function_privilege('anon', pub, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', pub, 'EXECUTE'), 'public wrapper: service_role only');
  PERFORM pg_temp.ok((SELECT prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']
                        FROM pg_proc WHERE oid = priv), 'SECURITY DEFINER, STABLE, pinned search_path');
  PERFORM pg_temp.ok((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                       WHERE p.proname LIKE 'google\_sheets\_%' AND n.nspname = 'private') = 44
    AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname LIKE 'google\_sheets\_%' AND n.nspname = 'public') = 31, 'inventory 44 + 31 = 75');
  RAISE NOTICE 'PASS V4 ACL: private owner-only, wrapper service_role-only, definer/stable/search_path, inventory 75';
END $$;

-- ---------------------------------------------------------------- V5 normalize_us_state parity with the Deno preview port
-- (psql does not interpolate variables inside dollar quotes: the fixture is materialised first.)
CREATE TEMP TABLE parity AS SELECT :'state_parity'::jsonb AS j;
DO $$
DECLARE c jsonb; bad text;
BEGIN
  SELECT string_agg(format('%L→%L (expected %L)', e->>0, public.normalize_us_state(e->>0), e->>1), '; ') INTO bad
    FROM jsonb_array_elements((SELECT j FROM parity)) e
   WHERE public.normalize_us_state(e->>0) IS DISTINCT FROM e->>1;
  PERFORM pg_temp.ok(bad IS NULL, 'state parity: ' || COALESCE(bad, ''));
  PERFORM pg_temp.ok(jsonb_array_length((SELECT j FROM parity)) > 200, 'fixture loaded');
  RAISE NOTICE 'PASS V5 state parity: production normalize_us_state equals the shared fixture (% cases)', jsonb_array_length((SELECT j FROM parity));
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL GOOGLE SHEETS MAPPING V2 SQL TESTS PASSED'; END $$;
