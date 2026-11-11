-- Run only through scripts/run_carrier_resource_links_tests.sh on disposable LOCAL PostgreSQL.
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  PERFORM carrier_test.assert(carrier_test.metadata() = (SELECT metadata FROM carrier_test.baseline),
    'migration changed existing carrier/security metadata');
  PERFORM carrier_test.assert(
    (SELECT jsonb_agg(to_jsonb(c) - 'resource_links' ORDER BY c.id) FROM public.carriers c) =
    (SELECT carrier_rows FROM carrier_test.baseline), 'migration changed existing carrier values');
  PERFORM carrier_test.assert((SELECT bool_and(resource_links = '[]'::jsonb) FROM public.carriers),
    'existing rows must receive an empty resource array');
  PERFORM carrier_test.assert((SELECT a.attnotnull AND a.atttypid = 'jsonb'::regtype
      AND pg_get_expr(d.adbin, d.adrelid) = '''[]''::jsonb'
    FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.carriers'::regclass AND a.attname = 'resource_links'),
    'resource column must be non-null JSONB with an empty-array default');
  PERFORM carrier_test.assert((SELECT NOT prosecdef AND proconfig = ARRAY['search_path=pg_catalog']
    FROM pg_proc WHERE oid = 'private.validate_carrier_resource_links()'::regprocedure),
    'validator must be SECURITY INVOKER with a fixed pg_catalog search path');
  PERFORM carrier_test.assert(NOT has_schema_privilege('authenticated', 'private', 'USAGE'),
    'feature must not grant clients private-schema usage');
  PERFORM carrier_test.assert(NOT has_function_privilege('authenticated', 'private.validate_carrier_resource_links()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'private.validate_carrier_resource_links()', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'private.validate_carrier_resource_links()', 'EXECUTE'),
    'validator must not be directly executable by client roles');
  PERFORM carrier_test.assert((SELECT t.tgenabled = 'O' AND t.tgtype = 23
    AND t.tgattr::text = a.attnum::text FROM pg_trigger t JOIN pg_attribute a
      ON a.attrelid = t.tgrelid AND a.attname = 'resource_links'
    WHERE t.tgrelid = 'public.carriers'::regclass AND t.tgname = 'carriers_resource_links_validate'),
    'validator must run before row INSERT or UPDATE OF resource_links');
  RAISE NOTICE 'PASS: additive migration, unchanged existing values/security metadata, private invoker trigger';
END;
$$;

DO $$
DECLARE
  org_a uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  org_b uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
  carrier_a text := 'aaaaaaaa-1111-4000-8000-000000000001';
  carrier_b text := 'bbbbbbbb-1111-4000-8000-000000000001';
  links jsonb := '[{"id":"cccccccc-0000-4000-8000-000000000001","label":"Agent portal","url":"https://carrier-a.example/agents","group":"quick_links"},{"id":"cccccccc-0000-4000-8000-000000000002","label":"Underwriting guide","url":"https://carrier-a.example/guide.pdf","group":"guides_training"}]';
  role_name text;
  before_row jsonb;
  after_row jsonb;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['Agent', 'Team Leader'] LOOP
    PERFORM carrier_test.expect(role_name || ' same-org read', 'authenticated', carrier_test.claims(org_a, role_name),
      'SELECT to_jsonb(count(*)) FROM public.carriers', '00000', '2');
    PERFORM carrier_test.expect(role_name || ' cross-org read', 'authenticated', carrier_test.claims(org_a, role_name),
      format('SELECT to_jsonb(count(*)) FROM public.carriers WHERE id = %L', carrier_b), '00000', '0');
    PERFORM carrier_test.expect(role_name || ' cannot update', 'authenticated', carrier_test.claims(org_a, role_name),
      format('WITH changed AS (UPDATE public.carriers SET resource_links = %L::jsonb WHERE id = %L RETURNING id) SELECT to_jsonb(count(*)) FROM changed', links, carrier_a), '00000', '0');
    PERFORM carrier_test.expect(role_name || ' cannot insert', 'authenticated', carrier_test.claims(org_a, role_name),
      format('INSERT INTO public.carriers(name, organization_id) VALUES (''Forbidden'', %L) RETURNING to_jsonb(id)', org_a), '42501');
    PERFORM carrier_test.expect(role_name || ' cannot delete', 'authenticated', carrier_test.claims(org_a, role_name),
      format('WITH changed AS (DELETE FROM public.carriers WHERE id = %L RETURNING id) SELECT to_jsonb(count(*)) FROM changed', carrier_a), '00000', '0');
  END LOOP;

  PERFORM carrier_test.expect('anonymous read', 'anon', '{}',
    'SELECT to_jsonb(count(*)) FROM public.carriers', '00000', '0');
  PERFORM carrier_test.expect('anonymous insert', 'anon', '{}',
    format('INSERT INTO public.carriers(name, organization_id) VALUES (''Anonymous'', %L) RETURNING to_jsonb(id)', org_a), '42501');
  PERFORM carrier_test.expect('anonymous update', 'anon', '{}',
    format('WITH changed AS (UPDATE public.carriers SET resource_links = ''[]'' WHERE id = %L RETURNING id) SELECT to_jsonb(count(*)) FROM changed', carrier_a), '00000', '0');
  PERFORM carrier_test.expect('authenticated without organization', 'authenticated', '{}',
    'SELECT to_jsonb(count(*)) FROM public.carriers', '00000', '0');
  PERFORM carrier_test.expect('cannot directly invoke private validator', 'authenticated', carrier_test.claims(org_a, 'Admin'),
    'SELECT to_jsonb(private.validate_carrier_resource_links())', '42501');

  SELECT to_jsonb(c) - 'resource_links' - 'updated_at' INTO before_row FROM public.carriers c WHERE id = carrier_a::uuid;
  PERFORM carrier_test.expect('Admin resource save despite no private USAGE/EXECUTE', 'authenticated', carrier_test.claims(org_a, 'Admin'),
    format('UPDATE public.carriers SET resource_links = %L::jsonb WHERE id = %L RETURNING resource_links', links, carrier_a), '00000', links);
  SELECT to_jsonb(c) - 'resource_links' - 'updated_at' INTO after_row FROM public.carriers c WHERE id = carrier_a::uuid;
  PERFORM carrier_test.assert(before_row = after_row, 'resource save changed a pre-existing business field');
  PERFORM carrier_test.assert((SELECT updated_at > '2020-02-01 00:00:00+00' FROM public.carriers WHERE id = carrier_a::uuid),
    'existing updated_at trigger must still run');
  PERFORM carrier_test.expect('Admin cross-org read', 'authenticated', carrier_test.claims(org_a, 'Admin'),
    format('SELECT to_jsonb(count(*)) FROM public.carriers WHERE id = %L', carrier_b), '00000', '0');
  PERFORM carrier_test.expect('Admin cross-org update', 'authenticated', carrier_test.claims(org_a, 'Admin'),
    format('WITH changed AS (UPDATE public.carriers SET resource_links = %L::jsonb WHERE id = %L RETURNING id) SELECT to_jsonb(count(*)) FROM changed', links, carrier_b), '00000', '0');
  PERFORM carrier_test.expect('Admin cross-org insert', 'authenticated', carrier_test.claims(org_a, 'Admin'),
    format('INSERT INTO public.carriers(name, organization_id) VALUES (''Forbidden cross-org'', %L) RETURNING to_jsonb(id)', org_b), '42501');
  PERFORM carrier_test.expect('Admin cannot reassign organization', 'authenticated', carrier_test.claims(org_a, 'Admin'),
    format('UPDATE public.carriers SET organization_id = %L WHERE id = %L RETURNING to_jsonb(id)', org_b, carrier_a), '42501');
  PERFORM carrier_test.expect('Admin profile fallback still works', 'authenticated', carrier_test.claims(NULL, 'Admin'),
    format('UPDATE public.carriers SET resource_links = %L::jsonb WHERE id = %L RETURNING resource_links', links, carrier_a), '00000', links);
  PERFORM carrier_test.expect('other organization Admin can edit own carrier', 'authenticated', carrier_test.claims(org_b, 'Admin'),
    format('UPDATE public.carriers SET resource_links = %L::jsonb WHERE id = %L RETURNING resource_links', links, carrier_b), '00000', links);

  -- Honest regression coverage: the existing Super Admin bypass is intentionally preserved.
  PERFORM carrier_test.expect('Super Admin existing cross-org read bypass', 'authenticated', carrier_test.claims(org_a, 'Admin', true),
    'SELECT to_jsonb(count(*)) FROM public.carriers', '00000', '3');
  PERFORM carrier_test.expect('Super Admin existing cross-org update bypass', 'authenticated', carrier_test.claims(org_a, 'Admin', true),
    format('UPDATE public.carriers SET resource_links = %L::jsonb WHERE id = %L RETURNING resource_links', links, carrier_b), '00000', links);
  PERFORM carrier_test.expect('Super Admin existing cross-org insert bypass', 'authenticated', carrier_test.claims(org_a, 'Admin', true),
    format('INSERT INTO public.carriers(id, name, organization_id) VALUES (''bbbbbbbb-1111-4000-8000-000000000099'', ''Super Admin fixture'', %L) RETURNING resource_links', org_b), '00000', '[]');
  DELETE FROM public.carriers WHERE id = 'bbbbbbbb-1111-4000-8000-000000000099';

  PERFORM carrier_test.expect('service role bypass still validates valid writes', 'service_role', '{}',
    format('UPDATE public.carriers SET resource_links = %L::jsonb WHERE id = %L RETURNING resource_links', links, carrier_b), '00000', links);
  PERFORM carrier_test.expect('service role cannot bypass resource validation', 'service_role', '{}',
    format('UPDATE public.carriers SET resource_links = ''{}'' WHERE id = %L RETURNING resource_links', carrier_b), '23514');

  PERFORM carrier_test.expect('old client INSERT gets empty default', 'authenticated', carrier_test.claims(org_a, 'Admin'),
    format('INSERT INTO public.carriers(id, name, organization_id) VALUES (''aaaaaaaa-1111-4000-8000-000000000099'', ''Old client fixture'', %L) RETURNING resource_links', org_a), '00000', '[]');
  PERFORM carrier_test.expect('old client UPDATE preserves resources', 'authenticated', carrier_test.claims(org_a, 'Admin'),
    format('UPDATE public.carriers SET portal_url = ''https://updated.carrier-a.example'' WHERE id = %L RETURNING resource_links', carrier_a), '00000', links);
  PERFORM carrier_test.expect('existing Admin delete unchanged', 'authenticated', carrier_test.claims(org_a, 'Admin'),
    'WITH changed AS (DELETE FROM public.carriers WHERE id = ''aaaaaaaa-1111-4000-8000-000000000099'' RETURNING id) SELECT to_jsonb(count(*)) FROM changed', '00000', '1');
  PERFORM carrier_test.expect('existing case-insensitive name uniqueness', 'authenticated', carrier_test.claims(org_a, 'Admin'),
    format('INSERT INTO public.carriers(name, organization_id) VALUES (''FIXTURE CARRIER A'', %L) RETURNING to_jsonb(id)', org_a), '23505');
  RAISE NOTICE 'PASS: real-role reads/writes, regular tenant isolation, existing Super Admin bypass, old clients, preserved business fields';
END;
$$;

DO $$
DECLARE
  claims jsonb := carrier_test.claims('aaaaaaaa-0000-4000-8000-000000000001', 'Admin');
  base_link jsonb := '{"id":"cccccccc-0000-4000-8000-000000000001","label":"Agent portal","url":"https://carrier.example","group":"quick_links"}';
  links jsonb;
  url text;
BEGIN
  FOREACH url IN ARRAY ARRAY[
    'https://carrier.example', 'http://carrier.example/guide.pdf?type=life#rates',
    'HTTPS://Agent.Carrier.Example:443/path', 'https://carrier.example:0',
    'https://carrier.example:65535', 'https://carrier.example./', 'https://xn--bcher-kva.example',
    'https://127.0.0.1:8443/path', 'https://[2001:db8::1]/guide', 'https://[::ffff:192.0.2.1]:443/path',
    'https://carrier.example/path%20with%20spaces', 'https://carrier.example/path@contact'
  ] LOOP
    links := jsonb_build_array(jsonb_set(base_link, '{url}', to_jsonb(url)));
    PERFORM carrier_test.expect('valid URL ' || url, 'authenticated', claims,
      format('UPDATE public.carriers SET resource_links = %L::jsonb WHERE id = ''aaaaaaaa-1111-4000-8000-000000000001'' RETURNING resource_links', links), '00000', links);
  END LOOP;
  links := jsonb_build_array(jsonb_set(base_link, '{label}', to_jsonb(repeat(U&'\+01f680', 120))));
  PERFORM carrier_test.expect('120 Unicode codepoint label', 'authenticated', claims,
    format('UPDATE public.carriers SET resource_links = %L::jsonb WHERE id = ''aaaaaaaa-1111-4000-8000-000000000001'' RETURNING resource_links', links), '00000', links);
  url := 'https://carrier.example/' || repeat('a', 2048 - char_length('https://carrier.example/'));
  links := jsonb_build_array(jsonb_set(base_link, '{url}', to_jsonb(url)));
  PERFORM carrier_test.expect('2048-character URL', 'authenticated', claims,
    format('UPDATE public.carriers SET resource_links = %L::jsonb WHERE id = ''aaaaaaaa-1111-4000-8000-000000000001'' RETURNING resource_links', links), '00000', links);
  SELECT jsonb_agg(base_link || jsonb_build_object('id', 'cccccccc-0000-4000-8000-' || lpad(i::text, 12, '0'),
    'label', 'Resource ' || i) ORDER BY i DESC) INTO links FROM generate_series(1, 50) i;
  PERFORM carrier_test.expect('50 resources retain explicit order', 'authenticated', claims,
    format('UPDATE public.carriers SET resource_links = %L::jsonb WHERE id = ''aaaaaaaa-1111-4000-8000-000000000001'' RETURNING resource_links', links), '00000', links);
  PERFORM carrier_test.expect('empty collection is valid', 'authenticated', claims,
    'UPDATE public.carriers SET resource_links = ''[]'' WHERE id = ''aaaaaaaa-1111-4000-8000-000000000001'' RETURNING resource_links', '00000', '[]');
  RAISE NOTICE 'PASS: valid HTTP(S) variants, Unicode lengths, 50-resource boundary, order, empty collection';
END;
$$;

CREATE TEMP TABLE invalid_resources (name text NOT NULL, payload jsonb);
INSERT INTO invalid_resources VALUES
  ('SQL null', NULL), ('JSON null', 'null'), ('object', '{}'), ('scalar', '42'),
  ('nonobject entry', '[null]'), ('missing fields', '[{}]'),
  ('extra field', '[{"id":"cccccccc-0000-4000-8000-000000000001","label":"Portal","url":"https://carrier.example","group":"quick_links","extra":true}]');
DO $$
DECLARE
  base_link jsonb := '{"id":"cccccccc-0000-4000-8000-000000000001","label":"Portal","url":"https://carrier.example","group":"quick_links"}';
  key text;
  url text;
  bad_label text;
  many jsonb;
BEGIN
  FOREACH key IN ARRAY ARRAY['id', 'label', 'url', 'group'] LOOP
    INSERT INTO invalid_resources VALUES
      ('missing ' || key, jsonb_build_array(base_link - key)),
      ('null ' || key, jsonb_build_array(jsonb_set(base_link, ARRAY[key], 'null'))),
      ('numeric ' || key, jsonb_build_array(jsonb_set(base_link, ARRAY[key], '1')));
  END LOOP;
  INSERT INTO invalid_resources VALUES
    ('invalid UUID', jsonb_build_array(jsonb_set(base_link, '{id}', '"not-a-uuid"'))),
    ('duplicate UUID', jsonb_build_array(base_link, base_link)),
    ('duplicate case-folded UUID', jsonb_build_array(base_link, jsonb_set(base_link, '{id}', to_jsonb(upper(base_link->>'id'))))),
    ('unknown group', jsonb_build_array(jsonb_set(base_link, '{group}', '"other"')));
  FOREACH bad_label IN ARRAY ARRAY['', ' ', ' leading', 'trailing ', E'\ttrimmed', U&'\00a0trimmed',
    U&'trimmed\feff', repeat('a', 121), repeat(U&'\+01f680', 121)] LOOP
    INSERT INTO invalid_resources VALUES ('invalid label', jsonb_build_array(jsonb_set(base_link, '{label}', to_jsonb(bad_label))));
  END LOOP;
  FOREACH url IN ARRAY ARRAY[
    '', 'javascript:alert(1)', 'data:text/html,test', 'mailto:agent@carrier.example', 'ftp://carrier.example',
    '//carrier.example', 'https:carrier.example', 'https://', 'https:///carrier.example',
    'https://?query', 'https://#fragment', 'https://user@carrier.example', 'https://user:secret@carrier.example',
    'https://user%40carrier.example', E'https://carrier.example\\bad', 'https://carrier.example/has space',
    E'https://carrier.example/line\nbreak', E'https://carrier.example/tab\there',
    'https://carrier.example/' || chr(127), 'https://carrier.example/' || chr(133),
    U&'https://carrier.example/\00a0', U&'https://carrier.example/\200b' || chr(31),
    U&'https://carrier.example/\feff', ' https://carrier.example', 'https://carrier.example ',
    'https://bad_host.example', 'https://-bad.example', 'https://bad-.example', 'https://a..example',
    'https://%65xample.com', 'https://bücher.example', 'https://' || repeat('a', 64) || '.example',
    'https://' || repeat('a.', 126) || 'ab', 'https://carrier.example:',
    'https://carrier.example:abc', 'https://carrier.example:65536', 'https://carrier.example:000080',
    'https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://0177.0.0.1',
    'https://999.1.1.1', 'https://1.2.3.4.', 'https://a.123', 'https://a.0x12',
    'https://[no-ipv6]', 'https://[127.0.0.1]', 'https://[2001:::1]', 'https://[::1]:65536',
    'https://[::ffff:192.0.2.01]/',
    'https://carrier.example/' || repeat('a', 2049)
  ] LOOP
    INSERT INTO invalid_resources VALUES ('invalid URL ' || left(url, 80), jsonb_build_array(jsonb_set(base_link, '{url}', to_jsonb(url))));
  END LOOP;
  SELECT jsonb_agg(base_link || jsonb_build_object('id', 'cccccccc-0000-4000-8000-' || lpad(i::text, 12, '0')))
    INTO many FROM generate_series(1, 51) i;
  INSERT INTO invalid_resources VALUES ('51 resources', many);
END;
$$;

DO $$
DECLARE
  claims jsonb := carrier_test.claims('aaaaaaaa-0000-4000-8000-000000000001', 'Admin');
  invalid record;
  before_row jsonb;
BEGIN
  SELECT to_jsonb(c) INTO before_row FROM public.carriers c WHERE id = 'aaaaaaaa-1111-4000-8000-000000000001';
  FOR invalid IN SELECT * FROM invalid_resources LOOP
    PERFORM carrier_test.expect(invalid.name || ' INSERT', 'authenticated', claims,
      format('INSERT INTO public.carriers(name, organization_id, resource_links) VALUES (''Invalid fixture'', ''aaaaaaaa-0000-4000-8000-000000000001'', %L::jsonb) RETURNING resource_links', invalid.payload), '23514');
    PERFORM carrier_test.expect(invalid.name || ' UPDATE', 'authenticated', claims,
      format('UPDATE public.carriers SET resource_links = %L::jsonb WHERE id = ''aaaaaaaa-1111-4000-8000-000000000001'' RETURNING resource_links', invalid.payload), '23514');
  END LOOP;
  PERFORM carrier_test.assert(before_row = (SELECT to_jsonb(c) FROM public.carriers c WHERE id = 'aaaaaaaa-1111-4000-8000-000000000001'),
    'rejected updates must preserve the full row, including updated_at');
  RAISE NOTICE 'PASS: % malformed payloads rejected on both INSERT and UPDATE under the real Admin role', (SELECT count(*) FROM invalid_resources);
END;
$$;

-- Negative control proves the trigger, rather than unrelated RLS or a fixture error, rejects malformed resources.
ALTER TABLE public.carriers DISABLE TRIGGER carriers_resource_links_validate;
SELECT carrier_test.expect('negative control without trigger accepts malformed JSON', 'authenticated',
  carrier_test.claims('aaaaaaaa-0000-4000-8000-000000000001', 'Admin'),
  'UPDATE public.carriers SET resource_links = ''{"invalid":true}'' WHERE id = ''aaaaaaaa-1111-4000-8000-000000000001'' RETURNING resource_links',
  '00000', '{"invalid":true}');
ALTER TABLE public.carriers ENABLE TRIGGER carriers_resource_links_validate;
SELECT carrier_test.expect('restored trigger rejects malformed JSON', 'authenticated',
  carrier_test.claims('aaaaaaaa-0000-4000-8000-000000000001', 'Admin'),
  'UPDATE public.carriers SET resource_links = ''{"invalid":true}'' WHERE id = ''aaaaaaaa-1111-4000-8000-000000000001'' RETURNING resource_links',
  '23514');
ROLLBACK;
\echo 'PASS: carrier resource links native suite (all scenario writes rolled back)'
