-- =====================================================================================================
-- Standard lead fields (M2) suite — LOCAL ONLY; run by scripts/run_google_sheets_tests.sh on the Sheets harness +
-- foundation + push + M1 + the custom-field logical-name guard (20260919052941 + 20260922222659) + M2, with the
-- PRODUCTION get_user_role / is_super_admin loaded from the baseline schema. Every block raises on failure.
-- Agencies A and B pre-date M2 (inserted with the seed trigger disabled, as existing production agencies are).
-- =====================================================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

-- Runs `q` as the authenticated role with a simulated Supabase JWT; returns the result, or {error, sqlstate}.
CREATE FUNCTION pg_temp.call_as(u uuid, org uuid, jwt_role text, sa boolean, q text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'is_super_admin', sa,
    'app_metadata', json_build_object('organization_id', org, 'role', jwt_role))::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE q INTO r;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE);   -- the role switch rolls back with the subtransaction
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN r;
END $$;

-- ---------------------------------------------------------------- fixtures (existing agencies: seed trigger disabled)
ALTER TABLE public.organizations DISABLE TRIGGER on_organization_created_seed_standard_lead_fields;
INSERT INTO public.organizations (id, name, status) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'Org A', 'active'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'active'),
  ('c0000000-0000-0000-0000-00000000000c', 'Org Suspended', 'suspended');
ALTER TABLE public.organizations ENABLE TRIGGER on_organization_created_seed_standard_lead_fields;
INSERT INTO public.profiles (id, organization_id, role, status, is_super_admin) VALUES
  ('11111111-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Agent', 'Active', false),        -- a1
  ('11111111-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'Agent', 'Active', false),        -- a2
  ('11111111-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'Team Leader', 'Active', false),  -- tl
  ('11111111-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'Admin', 'Active', false),        -- admin
  ('11111111-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-00000000000a', 'Admin', 'Deleted', false),       -- inactive admin
  ('11111111-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000000a', 'Admin', 'Active', true),         -- super admin (home A)
  ('22222222-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'Admin', 'Active', false),        -- adminB
  ('33333333-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-00000000000c', 'Admin', 'Active', false);        -- suspended-agency admin
CREATE TABLE pg_temp.ids (k text PRIMARY KEY, v uuid);
INSERT INTO pg_temp.ids VALUES
  ('orgA','a0000000-0000-0000-0000-00000000000a'), ('orgB','b0000000-0000-0000-0000-00000000000b'), ('orgS','c0000000-0000-0000-0000-00000000000c'),
  ('a1','11111111-0000-0000-0000-000000000001'), ('a2','11111111-0000-0000-0000-000000000002'), ('tl','11111111-0000-0000-0000-000000000003'),
  ('admin','11111111-0000-0000-0000-000000000004'), ('inactive','11111111-0000-0000-0000-000000000005'),
  ('sa','11111111-0000-0000-0000-000000000006'), ('adminB','22222222-0000-0000-0000-000000000004'),
  ('adminS','33333333-0000-0000-0000-000000000004'),
  ('cityA1','f0000000-0000-0000-0000-000000000001'), ('cityA2','f0000000-0000-0000-0000-000000000002'),
  ('hobbyAdmin','f0000000-0000-0000-0000-000000000003'), ('oldA1','f0000000-0000-0000-0000-000000000004'),
  ('zipB','f0000000-0000-0000-0000-000000000005');
CREATE FUNCTION pg_temp.id(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM pg_temp.ids WHERE ids.k = $1 $$;

-- Legacy same-name personal duplicates pre-date the guard (production has 25 such rows): insert them with it off.
ALTER TABLE public.custom_fields DISABLE TRIGGER trg_custom_fields_logical_name_guard;
INSERT INTO public.custom_fields (id, organization_id, name, type, applies_to, active, created_by) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'City', 'Text', '["Leads"]', true, '11111111-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'city', 'Text', '["Leads"]', true, '11111111-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'Favorite Hobby', 'Text', '["Leads"]', true, '11111111-0000-0000-0000-000000000004'),
  ('f0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'Old Field', 'Text', '["Leads"]', false, '11111111-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Zip Code', 'Text', '["Leads"]', true, NULL);
ALTER TABLE public.custom_fields ENABLE TRIGGER trg_custom_fields_logical_name_guard;
INSERT INTO public.leads (first_name, last_name, phone, organization_id, user_id, custom_fields) VALUES
  ('Ann', 'Lee', '5550001111', 'a0000000-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', '{"City":"Austin","ZIP Code":"02134"}'),
  ('Bo', 'Ray', '5550002222', 'a0000000-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000002', '{"city":"Waco"}'),
  ('Cy', 'Diaz', '5550003333', 'b0000000-0000-0000-0000-00000000000b', NULL, '{"Zip Code":"73301"}');
CREATE TEMP TABLE before_leads AS SELECT md5(string_agg(id::text || COALESCE(custom_fields::text, ''), ',' ORDER BY id)) AS h FROM public.leads;

CREATE FUNCTION pg_temp.std(o uuid) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(name || ':' || CASE WHEN created_by IS NULL THEN 'agency' ELSE 'personal' END || ':' || type,
                             ',' ORDER BY lower(name), created_by NULLS FIRST), '')
    FROM public.custom_fields WHERE organization_id = o AND active
     AND private.custom_field_norm(name) IN ('address', 'city', 'zip code')
$$;

-- ---------------------------------------------------------------- S1 catalog
DO $$
BEGIN
  PERFORM pg_temp.ok((SELECT string_agg(field_key || '=' || name || '/' || type || '/' || applies_to::text, ',' ORDER BY field_key)
                        FROM private.standard_lead_field_catalog())
    = 'address=Address/Text/["Leads"],city=City/Text/["Leads"],zip_code=ZIP Code/Text/["Leads"]', 'catalog');
  RAISE NOTICE 'PASS S1 catalog: Address, City, ZIP Code — Text, Leads';
END $$;

-- ---------------------------------------------------------------- S2 existing agencies are untouched by the migration
DO $$
BEGIN
  PERFORM pg_temp.ok(pg_temp.std(pg_temp.id('orgA')) = 'City:personal:Text,city:personal:Text', 'agency A unchanged: ' || pg_temp.std(pg_temp.id('orgA')));
  PERFORM pg_temp.ok(pg_temp.std(pg_temp.id('orgB')) = 'Zip Code:agency:Text', 'agency B unchanged');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM private.standard_lead_field_provisioning), 'no status rows for existing agencies');
  RAISE NOTICE 'PASS S2 no backfill: existing agencies keep exactly their fields; no status rows';
END $$;

-- ---------------------------------------------------------------- S3 a NEW agency is seeded (agency-wide), status complete
INSERT INTO public.organizations (id, name) VALUES ('d0000000-0000-0000-0000-00000000000d', 'New Agency D');
DO $$
DECLARE s record;
BEGIN
  PERFORM pg_temp.ok(pg_temp.std('d0000000-0000-0000-0000-00000000000d') = 'Address:agency:Text,City:agency:Text,ZIP Code:agency:Text',
    'new agency seeded: ' || pg_temp.std('d0000000-0000-0000-0000-00000000000d'));
  PERFORM pg_temp.ok((SELECT bool_and(applies_to = '["Leads"]' AND NOT required) FROM public.custom_fields
                       WHERE organization_id = 'd0000000-0000-0000-0000-00000000000d'), 'Leads, not required');
  SELECT * INTO s FROM private.standard_lead_field_provisioning WHERE organization_id = 'd0000000-0000-0000-0000-00000000000d';
  PERFORM pg_temp.ok(s.status = 'complete' AND s.attempts = 1 AND s.last_source = 'org_created' AND s.last_error IS NULL
    AND (SELECT string_agg(e->>'state', ',') FROM jsonb_array_elements(s.report) e) = 'created,created,created', 'status row: ' || row_to_json(s)::text);
  RAISE NOTICE 'PASS S3 new agency: three agency-wide Text fields, status complete (org_created, attempt 1)';
END $$;

-- ---------------------------------------------------------------- S4 a failed seed never blocks the agency; it is detectable
CREATE FUNCTION pg_temp.fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id = 'e0000000-0000-0000-0000-00000000000e' AND NEW.name = 'City' THEN RAISE EXCEPTION 'injected' USING ERRCODE = 'XX001'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_fault BEFORE INSERT ON public.custom_fields FOR EACH ROW EXECUTE FUNCTION pg_temp.fault();
INSERT INTO public.organizations (id, name) VALUES ('e0000000-0000-0000-0000-00000000000e', 'New Agency E');
DROP TRIGGER zz_fault ON public.custom_fields;
DO $$
DECLARE s record;
BEGIN
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.organizations WHERE id = 'e0000000-0000-0000-0000-00000000000e'), 'agency created anyway');
  PERFORM pg_temp.ok(pg_temp.std('e0000000-0000-0000-0000-00000000000e') = '', 'no partial seed (Address rolled back with the failure)');
  SELECT * INTO s FROM private.standard_lead_field_provisioning WHERE organization_id = 'e0000000-0000-0000-0000-00000000000e';
  PERFORM pg_temp.ok(s.status = 'failed' AND s.last_error = 'XX001' AND s.attempts = 1 AND s.last_source = 'org_created', 'failure recorded: ' || row_to_json(s)::text);
  RAISE NOTICE 'PASS S4 failed seed: agency created, nothing partial, status failed with SQLSTATE (detectable)';
END $$;

-- ---------------------------------------------------------------- S5 authorized, idempotent retry (ops and in-app)
DO $$
DECLARE r jsonb; s record;
BEGIN
  r := private.provision_standard_lead_fields('e0000000-0000-0000-0000-00000000000e', 'ops', NULL, true);
  PERFORM pg_temp.ok(r->>'status' = 'incomplete' AND pg_temp.std('e0000000-0000-0000-0000-00000000000e') = '', 'dry run writes nothing');
  r := private.provision_standard_lead_fields('e0000000-0000-0000-0000-00000000000e', 'ops', NULL, false);
  PERFORM pg_temp.ok(r->>'status' = 'complete', 'ops retry completes: ' || r::text);
  r := private.provision_standard_lead_fields('e0000000-0000-0000-0000-00000000000e', 'ops', NULL, false);
  SELECT * INTO s FROM private.standard_lead_field_provisioning WHERE organization_id = 'e0000000-0000-0000-0000-00000000000e';
  PERFORM pg_temp.ok(s.status = 'complete' AND s.attempts = 3 AND s.last_error IS NULL
    AND (SELECT string_agg(e->>'state', ',') FROM jsonb_array_elements(r->'fields') e) = 'exists_agency,exists_agency,exists_agency', 'idempotent');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.custom_fields WHERE organization_id = 'e0000000-0000-0000-0000-00000000000e') = 3, 'exactly three rows');
  RAISE NOTICE 'PASS S5 retry: dry run inert; retry completes; a second retry creates nothing (attempts counted, error cleared)';
END $$;

-- ---------------------------------------------------------------- S6 in-app provisioning authority (JWT and profile must agree)
DO $$
DECLARE r jsonb; q text := 'SELECT public.provision_standard_lead_fields(true)';
BEGIN
  r := pg_temp.call_as(pg_temp.id('admin'), pg_temp.id('orgA'), 'Admin', false, q);
  PERFORM pg_temp.ok(r->>'status' = 'incomplete' AND r->'last_attempt' = 'null'::jsonb
    AND (SELECT string_agg(e->>'name' || '=' || (e->>'state'), ',') FROM jsonb_array_elements(r->'fields') e)
        = 'Address=would_create,City=exists_personal,ZIP Code=would_create', 'admin dry run: ' || r::text);
  r := pg_temp.call_as(pg_temp.id('sa'), pg_temp.id('orgA'), 'Admin', true, q);
  PERFORM pg_temp.ok(r->>'status' = 'incomplete', 'super admin (own agency) allowed');
  FOREACH q IN ARRAY ARRAY[
    format('%s|%s|Agent|false', pg_temp.id('a1'), pg_temp.id('orgA')),
    format('%s|%s|Team Leader|false', pg_temp.id('tl'), pg_temp.id('orgA')),
    format('%s|%s|Admin|false', pg_temp.id('a1'), pg_temp.id('orgA')),          -- forged JWT role; profile says Agent
    format('%s|%s|Agent|false', pg_temp.id('admin'), pg_temp.id('orgA')),       -- profile Admin, JWT says Agent
    format('%s|%s|Agent|true', pg_temp.id('a1'), pg_temp.id('orgA')),           -- forged is_super_admin
    format('%s|%s|Admin|false', pg_temp.id('inactive'), pg_temp.id('orgA')),
    format('%s|%s|Admin|false', pg_temp.id('adminS'), pg_temp.id('orgS')),
    format('%s|%s|Admin|false', pg_temp.id('admin'), pg_temp.id('orgB'))]       -- JWT org ≠ profile org
  LOOP
    r := pg_temp.call_as(split_part(q, '|', 1)::uuid, split_part(q, '|', 2)::uuid, split_part(q, '|', 3), split_part(q, '|', 4)::boolean,
                         'SELECT public.provision_standard_lead_fields(false)');
    PERFORM pg_temp.ok(r->>'sqlstate' = '42501', 'refused: ' || q || ' → ' || r::text);
  END LOOP;
  PERFORM pg_temp.ok(pg_temp.std(pg_temp.id('orgA')) = 'City:personal:Text,city:personal:Text', 'refusals wrote nothing');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.provision_standard_lead_fields(boolean)', 'EXECUTE'), 'anon has no EXECUTE');
  RAISE NOTICE 'PASS S6 provisioning authority: Admin / Super Admin of their own agency only; forged JWT claims, mismatched org, inactive and suspended refused';
END $$;

DO $$
DECLARE r jsonb; s record;
BEGIN
  r := pg_temp.call_as(pg_temp.id('admin'), pg_temp.id('orgA'), 'Admin', false, 'SELECT public.provision_standard_lead_fields(false)');
  PERFORM pg_temp.ok(r->>'status' = 'incomplete'
    AND (SELECT string_agg(e->>'name' || '=' || (e->>'state'), ',') FROM jsonb_array_elements(r->'fields') e)
        = 'Address=created,City=exists_personal,ZIP Code=created', 'admin apply: ' || r::text);
  PERFORM pg_temp.ok(pg_temp.std(pg_temp.id('orgA')) = 'Address:agency:Text,City:personal:Text,city:personal:Text,ZIP Code:agency:Text',
    'personal City untouched; Address and ZIP Code created agency-wide: ' || pg_temp.std(pg_temp.id('orgA')));
  SELECT * INTO s FROM private.standard_lead_field_provisioning WHERE organization_id = pg_temp.id('orgA');
  PERFORM pg_temp.ok(s.status = 'incomplete' AND s.last_source = 'admin' AND s.last_actor = pg_temp.id('admin'), 'status incomplete, actor recorded');
  r := pg_temp.call_as(pg_temp.id('admin'), pg_temp.id('orgA'), 'Admin', false, 'SELECT public.provision_standard_lead_fields(false)');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.custom_fields WHERE organization_id = pg_temp.id('orgA')) = 6
    AND (r->'last_attempt'->>'attempts')::int = 2, 'retry is idempotent');
  RAISE NOTICE 'PASS S6b in-app retry: creates only the missing agency-wide fields, never over a personal one; idempotent';
END $$;

-- ---------------------------------------------------------------- S7 conversion authority = today's RLS UPDATE authority
DO $$
DECLARE r jsonb; f text := format('SELECT public.custom_field_make_agency_wide(%L::uuid, NULL, true)', pg_temp.id('cityA1'));
BEGIN
  r := pg_temp.call_as(pg_temp.id('a1'), pg_temp.id('orgA'), 'Agent', false, f);
  PERFORM pg_temp.ok(r->>'sqlstate' = '42501', 'an Agent cannot convert, even their own field');
  r := pg_temp.call_as(pg_temp.id('tl'), pg_temp.id('orgA'), 'Team Leader', false, f);
  PERFORM pg_temp.ok(r->>'sqlstate' = '42501', 'a Team Leader cannot convert');
  r := pg_temp.call_as(pg_temp.id('admin'), pg_temp.id('orgA'), 'Admin', false, f);
  PERFORM pg_temp.ok(r->>'error' = 'not_permitted', 'an Admin cannot convert ANOTHER user''s personal field: ' || r::text);
  r := pg_temp.call_as(pg_temp.id('adminB'), pg_temp.id('orgB'), 'Admin', false, f);
  PERFORM pg_temp.ok(r->>'error' = 'not_found', 'another agency''s field does not exist for Admin B: ' || r::text);
  r := pg_temp.call_as(pg_temp.id('sa'), pg_temp.id('orgA'), 'Admin', true,
                       format('SELECT public.custom_field_make_agency_wide(%L::uuid, NULL, true)', pg_temp.id('oldA1')));
  PERFORM pg_temp.ok(r->>'error' = 'inactive', 'inactive field refused: ' || r::text);
  r := pg_temp.call_as(pg_temp.id('adminB'), pg_temp.id('orgB'), 'Admin', false,
                       format('SELECT public.custom_field_make_agency_wide(%L::uuid, NULL, true)', pg_temp.id('zipB')));
  PERFORM pg_temp.ok(r->>'error' = 'not_personal', 'agency field refused: ' || r::text);
  r := pg_temp.call_as(pg_temp.id('admin'), pg_temp.id('orgA'), 'Admin', false,
                       format('SELECT public.custom_field_make_agency_wide(%L::uuid, NULL, true)', pg_temp.id('hobbyAdmin')));
  PERFORM pg_temp.ok((r->>'applied')::boolean = false AND r->'owner'->>'id' = pg_temp.id('admin')::text, 'an Admin may convert their OWN field (dry run)');
  RAISE NOTICE 'PASS S7 conversion authority: Agent/TL refused; Admin only for own fields; other agency not_found; inactive/agency refused';
END $$;

-- ---------------------------------------------------------------- S8 Super Admin converts an Agent's City: snapshot, audit, data untouched
DO $$
DECLARE d jsonb; r jsonb; a record; q text;
BEGIN
  q := format('SELECT public.custom_field_make_agency_wide(%L::uuid, NULL, true)', pg_temp.id('cityA1'));
  d := pg_temp.call_as(pg_temp.id('sa'), pg_temp.id('orgA'), 'Admin', true, q);
  PERFORM pg_temp.ok(d->'field'->>'name' = 'City' AND d->'owner'->>'id' = pg_temp.id('a1')::text AND (d->>'other_personal_rows')::int = 1
    AND (d->>'leads_with_key')::int = 1 AND d->>'snapshot' ~ '^[0-9a-f]{64}$', 'dry run impact: ' || d::text);
  r := pg_temp.call_as(pg_temp.id('sa'), pg_temp.id('orgA'), 'Admin', true,
         format('SELECT public.custom_field_make_agency_wide(%L::uuid, %L, false)', pg_temp.id('cityA1'), repeat('0', 64)));
  PERFORM pg_temp.ok(r->>'error' = 'field_changed', 'stale snapshot refused: ' || r::text);
  UPDATE public.custom_fields SET required = true WHERE id = pg_temp.id('cityA1');   -- not part of the snapshot: still applies?
  UPDATE public.custom_fields SET type = 'Number' WHERE id = pg_temp.id('cityA1');   -- edited between dry run and apply
  r := pg_temp.call_as(pg_temp.id('sa'), pg_temp.id('orgA'), 'Admin', true,
         format('SELECT public.custom_field_make_agency_wide(%L::uuid, %L, false)', pg_temp.id('cityA1'), d->>'snapshot'));
  PERFORM pg_temp.ok(r->>'error' = 'field_changed', 'a field edited after the dry run is refused: ' || r::text);
  UPDATE public.custom_fields SET type = 'Text', required = false WHERE id = pg_temp.id('cityA1');
  d := pg_temp.call_as(pg_temp.id('sa'), pg_temp.id('orgA'), 'Admin', true, q);
  r := pg_temp.call_as(pg_temp.id('sa'), pg_temp.id('orgA'), 'Admin', true,
         format('SELECT public.custom_field_make_agency_wide(%L::uuid, %L, false)', pg_temp.id('cityA1'), d->>'snapshot'));
  PERFORM pg_temp.ok((r->>'applied')::boolean, 'applied with the fresh snapshot: ' || r::text);
  PERFORM pg_temp.ok((SELECT created_by IS NULL AND name = 'City' AND type = 'Text' AND active FROM public.custom_fields WHERE id = pg_temp.id('cityA1')),
    'only created_by changed');
  SELECT * INTO a FROM private.custom_field_scope_changes WHERE field_id = pg_temp.id('cityA1');
  PERFORM pg_temp.ok(a.previous_owner = pg_temp.id('a1') AND a.actor = pg_temp.id('sa') AND a.source = 'admin' AND a.field_name = 'City'
    AND a.snapshot = d->>'snapshot' AND a.organization_id = pg_temp.id('orgA'), 'audit row: ' || row_to_json(a)::text);
  PERFORM pg_temp.ok((SELECT h FROM before_leads) = (SELECT md5(string_agg(id::text || COALESCE(custom_fields::text, ''), ',' ORDER BY id)) FROM public.leads),
    'lead data byte-identical');
  PERFORM pg_temp.ok((SELECT status FROM private.standard_lead_field_provisioning WHERE organization_id = pg_temp.id('orgA')) = 'complete',
    'agency A status refreshed to complete');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.google_sheets_context(pg_temp.id('a2'), pg_temp.id('orgA'))->'custom_fields') f
                              WHERE f->>'name' = 'City' AND f->>'scope' = 'agency'), 'another agent now sees City in the mapping catalog');
  r := pg_temp.call_as(pg_temp.id('sa'), pg_temp.id('orgA'), 'Admin', true,
         format('SELECT public.custom_field_make_agency_wide(%L::uuid, NULL, true)', pg_temp.id('cityA2')));
  PERFORM pg_temp.ok(r->>'error' = 'agency_field_exists', 'a legacy duplicate cannot become a second agency field: ' || r::text);
  RAISE NOTICE 'PASS S8 conversion: impact preview, snapshot required, created_by only, audited, leads byte-identical, status complete, catalog visible to every agent';
END $$;

-- ---------------------------------------------------------------- S9 ops conversion path (AgentFlow-operated, approval reference)
DO $$
DECLARE d jsonb; r jsonb; n int;
BEGIN
  d := private.custom_field_convert_to_agency(pg_temp.id('hobbyAdmin'), pg_temp.id('orgA'), 'ops', NULL, NULL, NULL, true);
  r := private.custom_field_convert_to_agency(pg_temp.id('hobbyAdmin'), pg_temp.id('orgA'), 'ops', NULL, d->>'snapshot', 'APPROVAL-TEST-1', false);
  PERFORM pg_temp.ok((r->>'applied')::boolean, 'ops apply');
  SELECT count(*) INTO n FROM private.custom_field_scope_changes WHERE source = 'ops' AND approval_ref = 'APPROVAL-TEST-1' AND actor IS NULL;
  PERFORM pg_temp.ok(n = 1, 'ops audit row with the approval reference');
  BEGIN
    INSERT INTO private.custom_field_scope_changes (organization_id, field_id, field_name, previous_owner, source, snapshot)
    VALUES (pg_temp.id('orgA'), gen_random_uuid(), 'x', gen_random_uuid(), 'ops', repeat('a', 64));
    RAISE EXCEPTION 'FAIL: an ops audit row without an approval reference was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS S9 ops conversion: same core, audited with its approval reference (required)';
END $$;

-- ---------------------------------------------------------------- S10 privileges
DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'private' AND p.proname IN ('standard_lead_field_catalog', 'standard_lead_field_state',
               'provision_standard_lead_fields', 'standard_lead_fields_on_org_created', 'standard_lead_fields_authority',
               'custom_field_scope_snapshot', 'custom_field_convert_to_agency') LOOP
    PERFORM pg_temp.ok(NOT has_function_privilege('anon', fn, 'EXECUTE') AND NOT has_function_privilege('authenticated', fn, 'EXECUTE')
      AND NOT has_function_privilege('service_role', fn, 'EXECUTE'), 'private function exposed: ' || fn::text);
    PERFORM pg_temp.ok((SELECT prosecdef OR proname = 'standard_lead_field_catalog' FROM pg_proc WHERE oid = fn), 'definer: ' || fn::text);
  END LOOP;
  FOR fn IN SELECT unnest(ARRAY['public.provision_standard_lead_fields(boolean)', 'public.custom_field_make_agency_wide(uuid, text, boolean)']::regprocedure[]) LOOP
    PERFORM pg_temp.ok(has_function_privilege('authenticated', fn, 'EXECUTE') AND NOT has_function_privilege('anon', fn, 'EXECUTE')
      AND NOT has_function_privilege('service_role', fn, 'EXECUTE'), 'public RPC ACL: ' || fn::text);
  END LOOP;
  PERFORM pg_temp.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('private.standard_lead_field_provisioning'::regclass,
                                                                                   'private.custom_field_scope_changes'::regclass)), 'RLS on');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'private.custom_field_scope_changes', 'SELECT')
    AND NOT has_table_privilege('service_role', 'private.standard_lead_field_provisioning', 'SELECT'), 'tables not granted');
  RAISE NOTICE 'PASS S10 privileges: private functions owner-only (definer); RPCs authenticated-only; tables RLS on, no grants';
END $$;

-- ---------------------------------------------------------------- S11 a wiped agency recovers through the same retry
DO $$
DECLARE r jsonb;
BEGIN
  DELETE FROM public.custom_fields WHERE organization_id = 'd0000000-0000-0000-0000-00000000000d';  -- as wipe_org_operational_data does
  r := private.provision_standard_lead_fields('d0000000-0000-0000-0000-00000000000d', 'ops', NULL, false);
  PERFORM pg_temp.ok(r->>'status' = 'complete' AND pg_temp.std('d0000000-0000-0000-0000-00000000000d')
    = 'Address:agency:Text,City:agency:Text,ZIP Code:agency:Text', 're-provisioned after a wipe');
  RAISE NOTICE 'PASS S11 wipe recovery: the retry re-creates the standard fields';
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL STANDARD LEAD FIELDS SQL TESTS PASSED'; END $$;
