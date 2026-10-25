-- =====================================================================================================
-- Google Sheets import — SQL behaviour suite (runs on the synthetic harness + migration).
-- Every block raises on failure. Run via scripts/run_google_sheets_tests.sh (LOCAL ONLY).
-- =====================================================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

-- ---------------------------------------------------------------- fixtures
INSERT INTO public.organizations (id, name, status) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'Org A', 'active'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'active'),
  ('c0000000-0000-0000-0000-00000000000c', 'Org Suspended', 'suspended');
INSERT INTO public.profiles (id, organization_id, role, status, is_super_admin) VALUES
  ('11111111-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Agent', 'Active', false),        -- a1
  ('11111111-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'Agent', 'Active', false),        -- a2
  ('11111111-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'Team Leader', 'Active', false),  -- tl
  ('11111111-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'Admin', 'Active', false),        -- admin
  ('11111111-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-00000000000a', 'Agent', 'Deleted', false),       -- deleted
  ('22222222-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'Agent', 'Active', false),        -- b1
  ('33333333-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'Agent', 'Active', false);        -- suspended org
INSERT INTO public.pipeline_stages (name, is_default, sort_order, organization_id) VALUES
  ('Fresh', false, 0, 'a0000000-0000-0000-0000-00000000000a'),
  ('Uncontacted', true, 1, 'a0000000-0000-0000-0000-00000000000a');
INSERT INTO public.dnc_list (phone_number, organization_id) VALUES ('5550001111', 'a0000000-0000-0000-0000-00000000000a');

CREATE TABLE pg_temp.ids (k text PRIMARY KEY, v text);
INSERT INTO pg_temp.ids VALUES
  ('orgA','a0000000-0000-0000-0000-00000000000a'), ('orgB','b0000000-0000-0000-0000-00000000000b'),
  ('a1','11111111-0000-0000-0000-000000000001'), ('a2','11111111-0000-0000-0000-000000000002'),
  ('tl','11111111-0000-0000-0000-000000000003'), ('admin','11111111-0000-0000-0000-000000000004'),
  ('deleted','11111111-0000-0000-0000-000000000005'), ('b1','22222222-0000-0000-0000-000000000001'),
  ('susp','33333333-0000-0000-0000-000000000001'), ('orgS','c0000000-0000-0000-0000-00000000000c');
CREATE FUNCTION pg_temp.id(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v::uuid FROM pg_temp.ids WHERE ids.k = $1 $$;

-- Connect helper: creates state-free connection for a user (generation-checked).
CREATE FUNCTION pg_temp.connect(u uuid, o uuid, sub text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE g bigint; r record;
BEGIN
  SELECT COALESCE((SELECT auth_generation FROM public.google_sheets_connections WHERE user_id = u AND organization_id = o), 0) INTO g;
  SELECT * INTO r FROM public.google_sheets_store_connection(u, o, g, sub, sub || '@example.test',
                                                              ARRAY['openid','email','https://www.googleapis.com/auth/drive.file'], 'rt-' || sub);
  PERFORM pg_temp.ok(r.outcome = 'connected', 'connect outcome ' || r.outcome);
  RETURN r.auth_generation;
END $$;

-- Source helper: creates + activates; returns source id.
CREATE FUNCTION pg_temp.mk_source(u uuid, o uuid, sheet bigint, mode text, include_existing boolean, baseline jsonb)
 RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE s record; a record; g bigint;
BEGIN
  SELECT * INTO s FROM public.google_sheets_save_source(u, o, NULL, NULL, jsonb_build_object(
    'spreadsheet_id', 'SPREADSHEET_ABCDEFGHIJ', 'sheet_id', sheet, 'display_name', 'Tab ' || sheet,
    'identity_mode', mode, 'id_header', CASE WHEN mode = 'source_id' THEN 'Lead ID' END,
    'mapping', '{"v":1}'::jsonb, 'include_existing', include_existing));
  SELECT auth_generation INTO g FROM public.google_sheets_connections WHERE user_id = u AND organization_id = o;
  SELECT * INTO a FROM public.google_sheets_activate(u, o, s.source_id, s.config_version, g, baseline, jsonb_array_length(baseline));
  PERFORM pg_temp.ok(a.outcome = 'activated', 'activate ' || a.outcome);
  RETURN s.source_id;
END $$;

-- Claim one specific due source for the worker path; returns lease + version + generation.
CREATE FUNCTION pg_temp.claim(src uuid, OUT lease uuid, OUT ver int, OUT gen bigint) LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  lease := gen_random_uuid();
  UPDATE public.google_sheets_sources SET next_sync_at = now() - interval '1 second', last_checked_at = NULL WHERE id = src;
  SELECT * INTO r FROM public.google_sheets_claim(lease, 1, src,
    (SELECT user_id FROM public.google_sheets_sources WHERE id = src),
    (SELECT organization_id FROM public.google_sheets_sources WHERE id = src));
  PERFORM pg_temp.ok(r.source_id IS NOT NULL, 'claim ' || src);
  ver := r.config_version; gen := r.auth_generation;
END $$;

CREATE FUNCTION pg_temp.lead(fn text, ln text, ph text, em text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('first_name', fn, 'last_name', ln, 'phone', ph, 'email', em, 'state', 'california', 'age', '42')
$$;

-- ================================================================ T1 ACL / RLS
DO $$
DECLARE fn regprocedure; n int := 0;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
             WHERE ns.nspname IN ('public','private') AND p.proname LIKE 'google\_sheets\_%' LOOP
    PERFORM pg_temp.ok(NOT has_function_privilege('anon', fn, 'EXECUTE'), 'anon EXECUTE ' || fn);
    PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', fn, 'EXECUTE'), 'authenticated EXECUTE ' || fn);
    PERFORM pg_temp.ok(NOT has_function_privilege('public', fn, 'EXECUTE'), 'PUBLIC EXECUTE ' || fn);
    IF (SELECT ns2.nspname FROM pg_proc p2 JOIN pg_namespace ns2 ON ns2.oid = p2.pronamespace WHERE p2.oid = fn) = 'public' THEN
      PERFORM pg_temp.ok(has_function_privilege('service_role', fn, 'EXECUTE'), 'service_role EXECUTE ' || fn);
    ELSE
      PERFORM pg_temp.ok(NOT has_function_privilege('service_role', fn, 'EXECUTE'), 'service_role private EXECUTE ' || fn);
    END IF;
    PERFORM pg_temp.ok((SELECT p.prosecdef AND p.proconfig IS NOT NULL FROM pg_proc p WHERE p.oid = fn)
                       OR (SELECT p.prolang = (SELECT oid FROM pg_language WHERE lanname='sql') AND p.proconfig IS NOT NULL
                             FROM pg_proc p WHERE p.oid = fn), 'definer+search_path ' || fn);
    n := n + 1;
  END LOOP;
  -- foundation 31 + 21, push sync (20261025120000) 13 + 10 — the runner applies both (production order).
  PERFORM pg_temp.ok(n = 75, 'function count ' || n || ' (44 private + 31 public)');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public._contacts_permission_default(text,text)', 'EXECUTE'), 'default helper ACL');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'private.google_sheets_receipts', 'SELECT'), 'receipts hidden');
  PERFORM pg_temp.ok(NOT has_table_privilege('service_role', 'private.google_sheets_receipts', 'SELECT'), 'receipts hidden from service_role direct');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'private.google_sheets_oauth_states', 'SELECT'), 'states hidden');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.google_sheets_sources', 'INSERT'), 'no client insert');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.google_sheets_sources', 'UPDATE'), 'no client update');
  PERFORM pg_temp.ok(NOT has_table_privilege('anon', 'public.google_sheets_connections', 'SELECT'), 'anon no select');
  RAISE NOTICE 'PASS T1 ACL (% functions)', n;
END $$;

-- ================================================================ T2 permission defaults + eligibility
DO $$
BEGIN
  PERFORM pg_temp.ok(public._contacts_permission_default('Agent','contacts.leads.import_google_sheets'), 'agent default ON');
  PERFORM pg_temp.ok(public._contacts_permission_default('Team Leader','contacts.leads.import_google_sheets'), 'tl default ON');
  PERFORM pg_temp.ok(NOT public._contacts_permission_default('Agent','contacts.leads.import'), 'csv import agent default unchanged');
  PERFORM pg_temp.ok(public._contacts_permission_default('Team Leader','contacts.leads.import'), 'csv import tl default unchanged');
  PERFORM pg_temp.ok(NOT public._contacts_permission_default('Agent','contacts.leads.assign'), 'assign unchanged');
  PERFORM pg_temp.ok(NOT public._contacts_permission_default('Super Admin','contacts.leads.import_google_sheets'), 'unknown role false');
  PERFORM pg_temp.ok(public.google_sheets_owner_eligible(pg_temp.id('a1'), pg_temp.id('orgA')), 'a1 eligible');
  PERFORM pg_temp.ok(public.google_sheets_owner_eligible(pg_temp.id('tl'), pg_temp.id('orgA')), 'tl eligible');
  PERFORM pg_temp.ok(public.google_sheets_owner_eligible(pg_temp.id('admin'), pg_temp.id('orgA')), 'admin eligible');
  PERFORM pg_temp.ok(NOT public.google_sheets_owner_eligible(pg_temp.id('deleted'), pg_temp.id('orgA')), 'deleted profile');
  PERFORM pg_temp.ok(NOT public.google_sheets_owner_eligible(pg_temp.id('a1'), pg_temp.id('orgB')), 'cross-org');
  PERFORM pg_temp.ok(NOT public.google_sheets_owner_eligible(pg_temp.id('susp'), pg_temp.id('orgS')), 'suspended org');
  -- explicit denial wins; non-boolean falls back to default (mirrors has_contacts_permission)
  INSERT INTO public.role_permissions (organization_id, role, permissions)
  VALUES (pg_temp.id('orgA'), 'Agent', '{"contacts":{"contacts.leads.import_google_sheets":false}}');
  PERFORM pg_temp.ok(NOT public.google_sheets_owner_eligible(pg_temp.id('a1'), pg_temp.id('orgA')), 'explicit deny');
  PERFORM pg_temp.ok(public.google_sheets_owner_eligible(pg_temp.id('admin'), pg_temp.id('orgA')), 'admin ignores deny');
  UPDATE public.role_permissions SET permissions = '{"contacts":{"contacts.leads.import_google_sheets":"yes"}}';
  PERFORM pg_temp.ok(public.google_sheets_owner_eligible(pg_temp.id('a1'), pg_temp.id('orgA')), 'non-boolean → default');
  DELETE FROM public.role_permissions;
  RAISE NOTICE 'PASS T2 permissions';
END $$;

-- ================================================================ T3 OAuth state
DO $$
DECLARE g bigint; r record; n int;
BEGIN
  g := public.google_sheets_create_oauth_state(pg_temp.id('a1'), pg_temp.id('orgA'), repeat('a', 64), repeat('v', 40), 'https://www.fflagent.com');
  PERFORM pg_temp.ok(g = 0, 'gen 0 before connect');
  SELECT count(*) INTO n FROM public.google_sheets_consume_oauth_state(repeat('a', 64));
  PERFORM pg_temp.ok(n = 1, 'first consume');
  SELECT count(*) INTO n FROM public.google_sheets_consume_oauth_state(repeat('a', 64));
  PERFORM pg_temp.ok(n = 0, 'second consume refused');
  PERFORM public.google_sheets_create_oauth_state(pg_temp.id('a1'), pg_temp.id('orgA'), repeat('b', 64), repeat('v', 40), 'https://www.fflagent.com');
  UPDATE private.google_sheets_oauth_states SET expires_at = now() - interval '1 second' WHERE state_hash = repeat('b', 64);
  SELECT count(*) INTO n FROM public.google_sheets_consume_oauth_state(repeat('b', 64));
  PERFORM pg_temp.ok(n = 0, 'expired refused');
  BEGIN
    PERFORM public.google_sheets_create_oauth_state(pg_temp.id('a1'), pg_temp.id('orgA'), repeat('c', 64), repeat('v', 40), 'javascript:alert(1)');
    RAISE EXCEPTION 'FAIL: bad origin accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.google_sheets_create_oauth_state(pg_temp.id('b1'), pg_temp.id('orgA'), repeat('d', 64), repeat('v', 40), 'https://www.fflagent.com');
    RAISE EXCEPTION 'FAIL: cross-org state';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS T3 oauth state';
END $$;

-- ================================================================ T4 connection lifecycle + Vault consistency
DO $$
DECLARE r record; g bigint; v text; cid uuid;
BEGIN
  SELECT * INTO r FROM public.google_sheets_store_connection(pg_temp.id('a1'), pg_temp.id('orgA'), 5, 'sub-a1', 'a1@x', '{}', 'rt1');
  PERFORM pg_temp.ok(r.outcome = 'superseded', 'wrong generation superseded');
  SELECT * INTO r FROM public.google_sheets_store_connection(pg_temp.id('a1'), pg_temp.id('orgA'), 0, 'sub-a1', 'a1@x', '{}', NULL);
  PERFORM pg_temp.ok(r.outcome = 'no_refresh_token', 'first connect needs refresh token');
  g := pg_temp.connect(pg_temp.id('a1'), pg_temp.id('orgA'), 'sub-a1');
  SELECT id INTO cid FROM public.google_sheets_connections WHERE user_id = pg_temp.id('a1');
  SELECT refresh_token INTO v FROM public.google_sheets_get_refresh_token(cid);
  PERFORM pg_temp.ok(v = 'rt-sub-a1', 'vault secret readable via wrapper');
  -- retained only for the same identity
  SELECT * INTO r FROM public.google_sheets_store_connection(pg_temp.id('a1'), pg_temp.id('orgA'), g, 'sub-a1', 'a1@x', '{}', '');
  PERFORM pg_temp.ok(r.outcome = 'connected', 'same sub retains token');
  SELECT refresh_token INTO v FROM public.google_sheets_get_refresh_token(cid);
  PERFORM pg_temp.ok(v = 'rt-sub-a1', 'absent token never overwrites');
  g := r.auth_generation;
  SELECT * INTO r FROM public.google_sheets_store_connection(pg_temp.id('a1'), pg_temp.id('orgA'), g, 'sub-OTHER', 'o@x', '{}', NULL);
  PERFORM pg_temp.ok(r.outcome = 'no_refresh_token', 'different sub cannot retain token');
  -- stale invalid_grant cannot disable a newer generation
  PERFORM pg_temp.ok(NOT public.google_sheets_mark_reconnect(cid, g - 1, 'invalid_grant'), 'stale reconnect refused');
  PERFORM pg_temp.ok((SELECT status FROM public.google_sheets_connections WHERE id = cid) = 'connected', 'still connected');
  -- late callback after disconnect
  PERFORM public.google_sheets_disconnect(pg_temp.id('a1'), pg_temp.id('orgA'));
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'google_sheets_refresh_' || cid), 'vault secret deleted');
  SELECT * INTO r FROM public.google_sheets_store_connection(pg_temp.id('a1'), pg_temp.id('orgA'), g, 'sub-a1', 'a1@x', '{}', 'rt-late');
  PERFORM pg_temp.ok(r.outcome = 'superseded', 'late callback after disconnect refused');
  PERFORM pg_temp.ok((SELECT status FROM public.google_sheets_connections WHERE id = cid) = 'disconnected', 'stays disconnected');
  g := pg_temp.connect(pg_temp.id('a1'), pg_temp.id('orgA'), 'sub-a1');
  PERFORM pg_temp.connect(pg_temp.id('a2'), pg_temp.id('orgA'), 'sub-a2');
  PERFORM pg_temp.connect(pg_temp.id('tl'), pg_temp.id('orgA'), 'sub-tl');
  PERFORM pg_temp.connect(pg_temp.id('b1'), pg_temp.id('orgB'), 'sub-a1');  -- same Google account, other org: allowed
  RAISE NOTICE 'PASS T4 connection';
END $$;

-- ================================================================ T5 drafts, duplicates, preview make no leads
DO $$
DECLARE s record; n_leads int; n_disp int;
BEGIN
  SELECT count(*) INTO n_leads FROM public.leads; SELECT count(*) INTO n_disp FROM private.test_workflow_dispatches;
  SELECT * INTO s FROM public.google_sheets_save_source(pg_temp.id('a1'), pg_temp.id('orgA'), NULL, NULL,
    '{"spreadsheet_id":"SPREADSHEET_DRAFT01","sheet_id":0,"display_name":"Draft","mapping":{}}');
  BEGIN
    PERFORM public.google_sheets_save_source(pg_temp.id('a1'), pg_temp.id('orgA'), NULL, NULL,
      '{"spreadsheet_id":"SPREADSHEET_DRAFT01","sheet_id":0,"display_name":"Again","mapping":{}}');
    RAISE EXCEPTION 'FAIL: duplicate tab accepted';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.ok(SQLERRM = 'duplicate_source', 'duplicate_source: ' || SQLERRM);
  END;
  -- same tab for ANOTHER agent is a separate source
  PERFORM public.google_sheets_save_source(pg_temp.id('a2'), pg_temp.id('orgA'), NULL, NULL,
    '{"spreadsheet_id":"SPREADSHEET_DRAFT01","sheet_id":0,"display_name":"Mine","mapping":{}}');
  BEGIN
    PERFORM public.google_sheets_save_source(pg_temp.id('a1'), pg_temp.id('orgA'), s.source_id, s.config_version + 7,
      '{"display_name":"x","mapping":{}}');
    RAISE EXCEPTION 'FAIL: version conflict not detected';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM = 'version_conflict', SQLERRM); END;
  PERFORM public.google_sheets_preview_duplicates(pg_temp.id('a1'), pg_temp.id('orgA'), '[{"phone":"555","email":""}]');
  PERFORM public.google_sheets_context(pg_temp.id('a1'), pg_temp.id('orgA'));
  PERFORM pg_temp.ok((SELECT count(*) FROM public.leads) = n_leads, 'no leads from draft/preview');
  PERFORM pg_temp.ok((SELECT count(*) FROM private.test_workflow_dispatches) = n_disp, 'no workflows from draft/preview');
  -- cross-agent edit refused
  BEGIN
    PERFORM public.google_sheets_save_source(pg_temp.id('a2'), pg_temp.id('orgA'), s.source_id, s.config_version, '{"mapping":{}}');
    RAISE EXCEPTION 'FAIL: cross-agent edit';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  RAISE NOTICE 'PASS T5 drafts';
END $$;

-- ================================================================ T6 activation baseline (new rows only) + ingest + idempotency
DO $$
DECLARE src uuid; c record; res jsonb; n_disp int; lid uuid; a record;
BEGIN
  src := pg_temp.mk_source(pg_temp.id('a1'), pg_temp.id('orgA'), 101, 'row_position', false,
    '[{"k":"pos:2","n":2,"f":"fp-old-2"},{"k":"pos:3","n":3,"f":"fp-old-3"}]');
  PERFORM pg_temp.ok((SELECT count(*) FROM private.google_sheets_source_rows WHERE source_id = src AND kind = 'baseline') = 2, 'baseline stored');
  PERFORM pg_temp.ok((SELECT count(*) FROM private.google_sheets_receipts WHERE source_id = src) = 0, 'baseline is not a receipt');
  -- repeated activation is idempotent (no second baseline)
  SELECT * INTO a FROM public.google_sheets_activate(pg_temp.id('a1'), pg_temp.id('orgA'), src, 1, 0, '[]', 0);
  PERFORM pg_temp.ok(a.outcome = 'already_active', 'repeat activation');
  SELECT count(*) INTO n_disp FROM private.test_workflow_dispatches;
  c := pg_temp.claim(src);
  -- a baseline row submitted as a candidate is refused ('already')
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen,
    jsonb_build_array(jsonb_build_object('k','pos:2','n',2,'f','fp-old-2','lead', pg_temp.lead('Old','Row','5551110002','')),
                      jsonb_build_object('k','pos:4','n',4,'f','fp-4','lead', pg_temp.lead('New','Person','(555) 222-0004','NEW@Example.test '))),
    '[]');
  PERFORM pg_temp.ok((res->>'imported')::int = 1, 'one imported: ' || res::text);
  PERFORM pg_temp.ok(res->'rows'->0->>'o' = 'already', 'baseline excluded');
  SELECT id INTO lid FROM public.leads WHERE first_name = 'New' AND last_name = 'Person';
  PERFORM pg_temp.ok((SELECT assigned_agent_id = pg_temp.id('a1') AND user_id = pg_temp.id('a1') AND imported_by_user_id = pg_temp.id('a1')
                        AND organization_id = pg_temp.id('orgA') AND status = 'Uncontacted' AND lead_source = 'Google Sheets'
                        AND state = 'CA' AND age = 42 AND lead_score = 5 AND phone = '(555) 222-0004'
                        FROM public.leads WHERE id = lid), 'ownership/attribution/defaults');
  PERFORM pg_temp.ok((SELECT count(*) FROM private.test_workflow_dispatches) = n_disp + 1, 'exactly one lead_created dispatch');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.notifications), 'no self-import notification');
  -- repeated ingest of the same row: no new lead, no new dispatch
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen,
    jsonb_build_array(jsonb_build_object('k','pos:4','n',4,'f','fp-4','lead', pg_temp.lead('New','Person','5552220004',''))), '[]');
  PERFORM pg_temp.ok((res->>'imported')::int = 0 AND res->'rows'->0->>'o' = 'already', 'repeat ingest idempotent');
  PERFORM pg_temp.ok((SELECT count(*) FROM private.test_workflow_dispatches) = n_disp + 1, 'no second dispatch');
  PERFORM pg_temp.ok(public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"imported":1,"health":"ok"}') = 'completed', 'finish');
  PERFORM pg_temp.ok((SELECT lease_owner IS NULL AND next_sync_at > now() + interval '4 minutes' FROM public.google_sheets_sources WHERE id = src), 'lease released, 5-min cadence');
  -- receipt survives lead deletion; replay still refused
  DELETE FROM public.leads WHERE id = lid;
  c := pg_temp.claim(src);
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen,
    jsonb_build_array(jsonb_build_object('k','pos:4','n',4,'f','fp-4','lead', pg_temp.lead('New','Person','5552220004',''))), '[]');
  PERFORM pg_temp.ok(res->'rows'->0->>'o' = 'already', 'receipt survives lead deletion');
  PERFORM public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"ok"}');
  RAISE NOTICE 'PASS T6 activation/ingest';
END $$;

-- ================================================================ T7 invalid / pending rows + correction
DO $$
DECLARE src uuid; c record; res jsonb;
BEGIN
  src := pg_temp.mk_source(pg_temp.id('a1'), pg_temp.id('orgA'), 102, 'source_id', false, '[]');
  c := pg_temp.claim(src);
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]',
    '[{"k":"id:L1","n":2,"f":"fp-a","reason":"missing_phone"},{"k":"noid:3","n":3,"f":"fp-b","reason":"missing_id"}]');
  PERFORM pg_temp.ok((res->>'new_pending')::int = 2, 'two new pending');
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]',
    '[{"k":"id:L1","n":2,"f":"fp-a","reason":"missing_phone"},{"k":"noid:3","n":3,"f":"fp-b","reason":"missing_id"}]');
  PERFORM pg_temp.ok((res->>'new_pending')::int = 0, 'unchanged pending not recounted');
  -- corrected row (same ID) imports even though a pending record exists; no receipt blocked it
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen,
    jsonb_build_array(jsonb_build_object('k','id:L1','n',2,'f','fp-a2','lead', pg_temp.lead('Fixed','Row','5553330001',''))),
    '[{"k":"noid:3","clear":true}]');
  PERFORM pg_temp.ok((res->>'imported')::int = 1, 'corrected row imported');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = src), 'pending cleared');
  -- server-side core contract defence
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen,
    jsonb_build_array(jsonb_build_object('k','id:L2','n',4,'f','x','lead', pg_temp.lead('NoLast','','5553330002',''))), '[]');
  PERFORM pg_temp.ok(res->'rows'->0->>'o' = 'error' AND NOT EXISTS (SELECT 1 FROM private.google_sheets_receipts WHERE receipt_key = 'id:L2'),
                     'invalid row: no lead, no receipt');
  -- conflicting duplicate IDs are pending 'dup:' rows; a blank-ID baseline row that gains an ID stays excluded
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]',
    '[{"k":"dup:5","n":5,"f":"d1","reason":"duplicate_id"},{"k":"dup:6","n":6,"f":"d2","reason":"duplicate_id"}]');
  PERFORM pg_temp.ok((res->>'new_pending')::int = 2, 'dup pending');
  INSERT INTO private.google_sheets_source_rows (source_id, row_key, row_number, fingerprint, kind) VALUES (src, 'blank:9', 9, 'bf', 'baseline');
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]', '[{"k":"id:LATE","n":9,"f":"bf","baseline":true,"consume":"blank:9"}]');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = src AND row_key = 'id:LATE' AND kind = 'baseline')
                     AND NOT EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = src AND row_key = 'blank:9'),
                     'blank baseline carried to its new ID');
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen,
    jsonb_build_array(jsonb_build_object('k','id:LATE','n',9,'f','bf','lead', pg_temp.lead('Late','Id','5553330009',''))), '[]');
  PERFORM pg_temp.ok(res->'rows'->0->>'o' = 'already' AND (res->>'imported')::int = 0, 'baselined ID never imported');
  BEGIN
    PERFORM public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]', '[{"k":"id:FORGED","n":1,"f":"x","baseline":true,"consume":"blank:77"}]');
    RAISE EXCEPTION 'FAIL forged baseline';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- a carry must match the consumed baseline's core fingerprint
  INSERT INTO private.google_sheets_source_rows (source_id, row_key, row_number, fingerprint, kind) VALUES (src, 'blank:10', 10, 'bf10', 'baseline');
  BEGIN
    PERFORM public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]', '[{"k":"id:OTHER","n":10,"f":"not-bf10","baseline":true,"consume":"blank:10"}]');
    RAISE EXCEPTION 'FAIL carry with a different fingerprint';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- pending records can no longer use the baseline key namespace; clear never removes a baseline
  BEGIN
    PERFORM public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]', '[{"k":"blank:10","n":10,"f":"x","reason":"missing_id"}]');
    RAISE EXCEPTION 'FAIL blank: pending key accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]', '[{"k":"blank:10","clear":true}]');
    RAISE EXCEPTION 'FAIL blank: clear accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]', '[{"k":"id:LATE","clear":true}]');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = src AND row_key = 'id:LATE' AND kind = 'baseline')
                     AND EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = src AND row_key = 'blank:10'),
                     'clear never removes a baseline');
  -- an explicit approval is consumed when its receipt is written; a clear op can drop a stale approval
  INSERT INTO private.google_sheets_source_rows (source_id, row_key, row_number, fingerprint, kind) VALUES
    (src, 'approved:AP1', 11, 'ap1', 'approved'), (src, 'approved:AP2', 12, 'ap2', 'approved');
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen,
    jsonb_build_array(jsonb_build_object('k','id:AP1','n',11,'f','ap1','lead', pg_temp.lead('Appr','Oved','5553330011',''))),
    '[{"k":"approved:AP2","clear":true}]');
  PERFORM pg_temp.ok((res->>'imported')::int = 1
                     AND NOT EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = src AND row_key LIKE 'approved:%'),
                     'approval consumed on import; stale approval cleared');
  PERFORM public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"ok"}');
  RAISE NOTICE 'PASS T7 pending/correction';
END $$;

-- ================================================================ T8 duplicate policy matrix (4 rules × 2 scopes × 3 actions = 24)
DO $$
DECLARE
  rules text[] := ARRAY['phone_only','email_only','phone_and_email','phone_or_email'];
  scopes text[] := ARRAY['all_agents','assigned_only'];
  actions text[] := ARRAY['skip','flag','import'];
  ru text; sc text; ac text; owner text; cand text; src uuid; c record; res jsonb; sheet bigint := 1000;
  expect_match boolean; o text; combos int := 0; checks int := 0; nd int; cf jsonb;
BEGIN
  FOREACH ru IN ARRAY rules LOOP FOREACH sc IN ARRAY scopes LOOP FOREACH ac IN ARRAY actions LOOP
    combos := combos + 1;
    INSERT INTO public.contact_management_settings (organization_id, duplicate_detection_rule, duplicate_detection_scope, csv_action)
    VALUES (pg_temp.id('orgA'), ru, sc, ac)
    ON CONFLICT (organization_id) DO UPDATE SET duplicate_detection_rule = ru, duplicate_detection_scope = sc, csv_action = ac;
    FOREACH owner IN ARRAY ARRAY['a1','a2'] LOOP   -- existing lead belongs to a2
      FOREACH cand IN ARRAY ARRAY['phone','email','both','none'] LOOP
        DELETE FROM public.leads WHERE organization_id = pg_temp.id('orgA');
        INSERT INTO public.leads (first_name, last_name, phone, email, organization_id, assigned_agent_id)
        VALUES ('Existing','Lead','+1 (555) 700-0001','Match@Example.test', pg_temp.id('orgA'), pg_temp.id('a2'));
        sheet := sheet + 1;
        src := pg_temp.mk_source(pg_temp.id(owner), pg_temp.id('orgA'), sheet, 'row_position', false, '[]');
        c := pg_temp.claim(src);
        SELECT count(*) INTO nd FROM private.test_workflow_dispatches;
        res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen, jsonb_build_array(jsonb_build_object(
          'k','pos:2','n',2,'f','fp','lead', pg_temp.lead('Cand','Idate',
             CASE WHEN cand IN ('phone','both') THEN '15557000001' ELSE '5559990000' END,
             CASE WHEN cand IN ('email','both') THEN ' match@example.TEST' ELSE 'other@example.test' END))), '[]');
        o := res->'rows'->0->>'o';
        -- independent truth table of import-contacts semantics
        expect_match := (sc = 'all_agents' OR owner = 'a2') AND CASE ru
          WHEN 'phone_only' THEN cand IN ('phone','both')
          WHEN 'email_only' THEN cand IN ('email','both')
          WHEN 'phone_and_email' THEN cand = 'both'
          ELSE cand IN ('phone','email','both') END;
        IF NOT expect_match THEN
          PERFORM pg_temp.ok(o = 'imported', format('%s/%s/%s owner=%s cand=%s → %s', ru, sc, ac, owner, cand, o));
        ELSIF ac = 'skip' THEN
          PERFORM pg_temp.ok(o = 'skipped', format('%s/%s/%s owner=%s cand=%s → %s', ru, sc, ac, owner, cand, o));
          PERFORM pg_temp.ok((SELECT count(*) FROM private.test_workflow_dispatches) = nd, 'skip fires no workflow');
          PERFORM pg_temp.ok((SELECT outcome FROM private.google_sheets_receipts WHERE source_id = src) = 'skipped_duplicate', 'skip receipt');
        ELSIF ac = 'flag' THEN
          PERFORM pg_temp.ok(o = 'flagged', format('%s/%s/%s owner=%s cand=%s → %s', ru, sc, ac, owner, cand, o));
          SELECT custom_fields INTO cf FROM public.leads WHERE first_name = 'Cand';
          PERFORM pg_temp.ok((cf->'__agentflow'->>'duplicateImport')::boolean AND cf->'tags' @> '["Duplicate"]', 'flag marker');
        ELSE
          PERFORM pg_temp.ok(o = 'imported', format('%s/%s/%s owner=%s cand=%s → %s', ru, sc, ac, owner, cand, o));
          PERFORM pg_temp.ok((SELECT custom_fields FROM public.leads WHERE first_name = 'Cand') IS NULL, 'import: no marker');
        END IF;
        -- the existing lead is never modified or reassigned
        PERFORM pg_temp.ok((SELECT assigned_agent_id = pg_temp.id('a2') AND custom_fields IS NULL
                              FROM public.leads WHERE first_name = 'Existing'), 'existing lead untouched');
        PERFORM public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"ok"}');
        checks := checks + 1;
      END LOOP;
    END LOOP;
  END LOOP; END LOOP; END LOOP;
  PERFORM pg_temp.ok(combos = 24, 'combos ' || combos);
  -- within-batch duplicates (phone_or_email / all_agents / flag)
  UPDATE public.contact_management_settings SET duplicate_detection_rule = 'phone_or_email', duplicate_detection_scope = 'all_agents', csv_action = 'flag';
  DELETE FROM public.leads WHERE organization_id = pg_temp.id('orgA');
  src := pg_temp.mk_source(pg_temp.id('a1'), pg_temp.id('orgA'), 5000, 'row_position', false, '[]');
  c := pg_temp.claim(src);
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen, jsonb_build_array(
    jsonb_build_object('k','pos:2','n',2,'f','fp','lead', pg_temp.lead('Twin','One','5558880000','')),
    jsonb_build_object('k','pos:3','n',3,'f','fp','lead', pg_temp.lead('Twin','Two','555-888-0000',''))), '[]');
  PERFORM pg_temp.ok(res->'rows'->0->>'o' = 'imported' AND res->'rows'->1->>'o' = 'flagged', 'within-batch duplicate flagged: ' || res::text);
  PERFORM public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"ok"}');
  RAISE NOTICE 'PASS T8 duplicate matrix: 24 combinations, % checks', checks;
END $$;

-- ================================================================ T9 stale work: lease / pause / remap / disconnect / permission
DO $$
DECLARE src uuid; c record; c2 record; res jsonb; s record;
BEGIN
  DELETE FROM public.contact_management_settings;
  src := pg_temp.mk_source(pg_temp.id('tl'), pg_temp.id('orgA'), 7000, 'source_id', false, '[]');
  c := pg_temp.claim(src);
  BEGIN PERFORM public.google_sheets_ingest(src, gen_random_uuid(), c.ver, c.gen, '[]', '[]'); RAISE EXCEPTION 'FAIL wrong lease';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM LIKE 'stale%', SQLERRM); END;
  -- remap during run → version stale; finish does not overwrite but releases the lease
  SELECT * INTO s FROM public.google_sheets_save_source(pg_temp.id('tl'), pg_temp.id('orgA'), src, c.ver,
    '{"display_name":"Renamed","identity_mode":"source_id","id_header":"Lead ID","mapping":{"v":1,"x":1}}');
  BEGIN PERFORM public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]', '[]'); RAISE EXCEPTION 'FAIL remap';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM LIKE 'stale%', SQLERRM); END;
  PERFORM pg_temp.ok(public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"error","error_code":"old"}') = 'released', 'stale finish refused');
  PERFORM pg_temp.ok((SELECT health = 'ok' AND lease_owner IS NULL FROM public.google_sheets_sources WHERE id = src), 'status kept, lease released');
  -- identity change on an active source requires review
  BEGIN PERFORM public.google_sheets_save_source(pg_temp.id('tl'), pg_temp.id('orgA'), src, s.config_version,
          '{"identity_mode":"row_position","mapping":{}}'); RAISE EXCEPTION 'FAIL identity change';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM = 'identity_change_requires_review', SQLERRM); END;
  -- pause during run
  c := pg_temp.claim(src);
  PERFORM public.google_sheets_set_state(pg_temp.id('tl'), pg_temp.id('orgA'), src, 'pause');
  BEGIN PERFORM public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]', '[]'); RAISE EXCEPTION 'FAIL pause';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM LIKE 'stale%', SQLERRM); END;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.google_sheets_claim(gen_random_uuid(), 10) x WHERE x.source_id = src), 'paused not claimable');
  PERFORM public.google_sheets_set_state(pg_temp.id('tl'), pg_temp.id('orgA'), src, 'resume');
  -- expired lease, then a newer claim; the old worker cannot finish
  c := pg_temp.claim(src);
  UPDATE public.google_sheets_sources SET lease_expires_at = now() - interval '1 second' WHERE id = src;
  BEGIN PERFORM public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]', '[]'); RAISE EXCEPTION 'FAIL expired';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM LIKE 'stale%', SQLERRM); END;
  c2 := pg_temp.claim(src);
  PERFORM pg_temp.ok(public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"error"}') = 'not_owner', 'old lease finish refused');
  PERFORM pg_temp.ok((SELECT lease_owner = c2.lease FROM public.google_sheets_sources WHERE id = src), 'new lease intact');
  -- permission revoked mid-run
  INSERT INTO public.role_permissions (organization_id, role, permissions)
  VALUES (pg_temp.id('orgA'), 'Team Leader', '{"contacts":{"contacts.leads.import_google_sheets":false}}');
  BEGIN PERFORM public.google_sheets_ingest(src, c2.lease, c2.ver, c2.gen, '[]', '[]'); RAISE EXCEPTION 'FAIL perm';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM LIKE 'stale%', SQLERRM); END;
  PERFORM public.google_sheets_finish(src, c2.lease, c2.ver, c2.gen, 'schedule', '{"health":"ok"}');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.google_sheets_claim(gen_random_uuid(), 10) x WHERE x.source_id = src), 'ineligible owner not claimed');
  DELETE FROM public.role_permissions;
  -- disconnect during run → generation stale; reconnect keeps paused/draft/needs_review states
  c := pg_temp.claim(src);
  PERFORM public.google_sheets_disconnect(pg_temp.id('tl'), pg_temp.id('orgA'));
  BEGIN PERFORM public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]', '[]'); RAISE EXCEPTION 'FAIL disconnect';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM LIKE 'stale%', SQLERRM); END;
  PERFORM public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"ok"}');
  UPDATE public.google_sheets_sources SET health = 'needs_review' WHERE id = src;
  PERFORM pg_temp.connect(pg_temp.id('tl'), pg_temp.id('orgA'), 'sub-tl');
  PERFORM pg_temp.ok((SELECT health = 'needs_review' AND state = 'enabled' FROM public.google_sheets_sources WHERE id = src), 'reconnect keeps needs_review');
  PERFORM pg_temp.ok((SELECT state FROM public.google_sheets_sources WHERE spreadsheet_id = 'SPREADSHEET_DRAFT01' AND user_id = pg_temp.id('a1')) = 'draft', 'reconnect keeps draft');
  -- account mismatch while sources exist
  PERFORM pg_temp.ok((SELECT outcome FROM public.google_sheets_store_connection(pg_temp.id('tl'), pg_temp.id('orgA'),
           (SELECT auth_generation FROM public.google_sheets_connections WHERE user_id = pg_temp.id('tl')),
           'sub-someone-else', 'x@x', '{}', 'rt')) = 'account_mismatch', 'account mismatch');
  RAISE NOTICE 'PASS T9 stale work/lifecycle';
END $$;

-- ================================================================ T10 remove/re-add without replay (ID mode)
DO $$
DECLARE src uuid; c record; res jsonb; n_leads int;
BEGIN
  src := pg_temp.mk_source(pg_temp.id('a2'), pg_temp.id('orgA'), 8000, 'source_id', true, '[]');
  PERFORM pg_temp.ok((SELECT phase FROM public.google_sheets_sources WHERE id = src) = 'initial', 'include existing → initial phase');
  c := pg_temp.claim(src);
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen, jsonb_build_array(
    jsonb_build_object('k','id:X-1','n',2,'f','f1','lead', pg_temp.lead('Re','Add','5554440001',''))), '[]');
  PERFORM pg_temp.ok((res->>'imported')::int = 1, 'first import');
  PERFORM public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"ok","phase_complete":true}');
  SELECT count(*) INTO n_leads FROM public.leads;
  PERFORM public.google_sheets_set_state(pg_temp.id('a2'), pg_temp.id('orgA'), src, 'remove');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM private.google_sheets_receipts WHERE receipt_key = 'id:X-1'), 'receipt survives removal');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.leads) = n_leads, 'leads preserved on removal');
  src := pg_temp.mk_source(pg_temp.id('a2'), pg_temp.id('orgA'), 8000, 'source_id', true, '[]');
  c := pg_temp.claim(src);
  PERFORM pg_temp.ok((public.google_sheets_load_state(src, c.lease)->'receipt_ids') @> '["id:X-1"]', 'load_state exposes receipt ids');
  PERFORM pg_temp.ok(public.google_sheets_prior_receipt_count(pg_temp.id('a2'), pg_temp.id('orgA'), 'SPREADSHEET_ABCDEFGHIJ', 8000,
                     '[]', '["id:X-1","id:X-2"]') = 1, 'prior count by receipt key');
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen, jsonb_build_array(
    jsonb_build_object('k','id:X-1','n',2,'f','f1','lead', pg_temp.lead('Re','Add','5554440001',''))), '[]');
  PERFORM pg_temp.ok(res->'rows'->0->>'o' = 'already' AND (SELECT count(*) FROM public.leads) = n_leads, 're-add does not replay');
  PERFORM public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"ok","backlog":true}');
  PERFORM pg_temp.ok((SELECT next_sync_at <= now() FROM public.google_sheets_sources WHERE id = src), 'backlog → due immediately');
  RAISE NOTICE 'PASS T10 remove/re-add';
END $$;

-- ================================================================ T11 no-ID re-add with include_existing baselines prior receipts
DO $$
DECLARE src uuid; c record; res jsonb;
BEGIN
  src := pg_temp.mk_source(pg_temp.id('a1'), pg_temp.id('orgA'), 9000, 'row_position', false, '[]');
  c := pg_temp.claim(src);
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen, jsonb_build_array(
    jsonb_build_object('k','pos:2','n',2,'f','fp-prior','lead', pg_temp.lead('Prior','Import','5556660001',''))), '[]');
  PERFORM public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"ok"}');
  PERFORM public.google_sheets_set_state(pg_temp.id('a1'), pg_temp.id('orgA'), src, 'remove');
  PERFORM pg_temp.ok(public.google_sheets_prior_receipt_count(pg_temp.id('a1'), pg_temp.id('orgA'), 'SPREADSHEET_ABCDEFGHIJ', 9000,
                     '["fp-prior","fp-new"]') = 1, 'preview prior count');
  src := pg_temp.mk_source(pg_temp.id('a1'), pg_temp.id('orgA'), 9000, 'row_position', true,
    '[{"k":"pos:2","n":2,"f":"fp-prior"},{"k":"pos:3","n":3,"f":"fp-new"}]');
  PERFORM pg_temp.ok((SELECT array_agg(row_key) FROM private.google_sheets_source_rows WHERE source_id = src) = ARRAY['pos:2'],
                     'only the previously imported row is baselined');
  RAISE NOTICE 'PASS T11 no-ID re-add';
END $$;

-- ================================================================ T12 review (structural recovery; explicit choices; snapshot)
DO $$
DECLARE src uuid; r record; r2 record; v int; g bigint;
  rows4 jsonb := '[{"k":"pos:2","n":2,"f":"X"},{"k":"pos:3","n":3,"f":"A"},{"k":"pos:4","n":4,"f":"B"},{"k":"pos:5","n":5,"f":"C"}]';
BEGIN
  src := pg_temp.mk_source(pg_temp.id('a1'), pg_temp.id('orgA'), 9100, 'row_position', false,
    '[{"k":"pos:2","n":2,"f":"A"},{"k":"pos:3","n":3,"f":"B"},{"k":"pos:4","n":4,"f":"C"}]');
  UPDATE public.google_sheets_sources SET health = 'needs_review', review_reason = 'rows_changed' WHERE id = src;
  SELECT config_version INTO v FROM public.google_sheets_sources WHERE id = src;
  SELECT auth_generation INTO g FROM public.google_sheets_connections WHERE user_id = pg_temp.id('a1');
  -- a row inserted at the top shifts everything: X is unmatched; A/B/C match only BY CONTENT (ambiguous, not "handled")
  SELECT * INTO r FROM public.google_sheets_review(pg_temp.id('a1'), pg_temp.id('orgA'), src, v, g, 'row_position', NULL, NULL,
    rows4, NULL, NULL, NULL, true);
  PERFORM pg_temp.ok(r.established = 0 AND r.matched = 3 AND r.unknown = 1 AND r.config_version = v AND length(r.snapshot) = 64, 'dry run counts');
  PERFORM pg_temp.ok((SELECT health FROM public.google_sheets_sources WHERE id = src) = 'needs_review', 'dry run writes nothing');
  -- duplicate fingerprints: a second "A" is unmatched (multiset)
  SELECT * INTO r2 FROM public.google_sheets_review(pg_temp.id('a1'), pg_temp.id('orgA'), src, v, g, 'row_position', NULL, NULL,
    '[{"k":"pos:2","n":2,"f":"A"},{"k":"pos:3","n":3,"f":"A"}]', NULL, NULL, NULL, true);
  PERFORM pg_temp.ok(r2.matched = 1 AND r2.unknown = 1, 'multiset matching');
  -- an explicit choice is required for every non-empty ambiguous class
  BEGIN
    PERFORM public.google_sheets_review(pg_temp.id('a1'), pg_temp.id('orgA'), src, v, g, 'row_position', NULL, NULL, rows4, NULL, true, r.snapshot, false);
    RAISE EXCEPTION 'FAIL review without a choice for content-matched rows';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- the decision applies only to the reviewed snapshot
  BEGIN
    PERFORM public.google_sheets_review(pg_temp.id('a1'), pg_temp.id('orgA'), src, v, g, 'row_position', NULL, NULL,
      '[{"k":"pos:2","n":2,"f":"X"},{"k":"pos:3","n":3,"f":"A"},{"k":"pos:4","n":4,"f":"B"},{"k":"pos:5","n":5,"f":"C"},{"k":"pos:6","n":6,"f":"Y"}]',
      false, true, r.snapshot, false);
    RAISE EXCEPTION 'FAIL review applied to different rows';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM = 'review_changed', SQLERRM); END;
  PERFORM pg_temp.ok((SELECT health = 'needs_review' AND config_version = v FROM public.google_sheets_sources WHERE id = src), 'refused review changed nothing');
  SELECT * INTO r2 FROM public.google_sheets_review(pg_temp.id('a1'), pg_temp.id('orgA'), src, v, g, 'row_position', NULL, NULL,
    rows4, false, true, r.snapshot, false);
  PERFORM pg_temp.ok((SELECT health = 'ok' AND row_epoch = 2 AND phase = 'initial' FROM public.google_sheets_sources WHERE id = src), 'review applied');
  PERFORM pg_temp.ok((SELECT count(*) FROM private.google_sheets_source_rows WHERE source_id = src AND kind = 'baseline') = 3
                     AND NOT EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = src AND row_key = 'pos:2'),
                     'content-matched kept out by explicit choice, unmatched left as candidate');
  BEGIN
    PERFORM public.google_sheets_review(pg_temp.id('a1'), pg_temp.id('orgA'), src, v, g, 'row_position', NULL, NULL, '[]', false, false, r.snapshot, false);
    RAISE EXCEPTION 'FAIL stale review';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM = 'version_conflict', SQLERRM); END;
  RAISE NOTICE 'PASS T12 review';
END $$;

-- ================================================================ T12b ID-mode review: established vs content-matched; approvals
DO $$
DECLARE src uuid; c record; r record; v int; g bigint; res jsonb; rows3 jsonb;
BEGIN
  src := pg_temp.mk_source(pg_temp.id('a2'), pg_temp.id('orgA'), 9200, 'source_id', false,
    '[{"k":"id:E1","n":2,"f":"FE"},{"k":"blank:3","n":3,"f":"FB"}]');
  c := pg_temp.claim(src);
  res := public.google_sheets_ingest(src, c.lease, c.ver, c.gen, jsonb_build_array(
    jsonb_build_object('k','id:R1','n',4,'f','FR','lead', pg_temp.lead('Rec','Eipt','5557770001',''))), '[]');
  PERFORM public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"ok"}');
  UPDATE public.google_sheets_sources SET health = 'needs_review', review_reason = 'identity_ambiguous' WHERE id = src;
  SELECT config_version INTO v FROM public.google_sheets_sources WHERE id = src;
  SELECT auth_generation INTO g FROM public.google_sheets_connections WHERE user_id = pg_temp.id('a2');
  -- E1 established by baseline, R1 by receipt, N1 matches the blank baseline's content only, Z1 is unmatched
  rows3 := '[{"k":"id:E1","n":2,"f":"FE","id":"E1"},{"k":"id:N1","n":3,"f":"FB","id":"N1"},{"k":"id:R1","n":4,"f":"FR","id":"R1"},{"k":"id:Z1","n":5,"f":"FZ","id":"Z1"}]';
  SELECT * INTO r FROM public.google_sheets_review(pg_temp.id('a2'), pg_temp.id('orgA'), src, v, g, 'source_id', 'Lead ID', NULL,
    rows3, NULL, NULL, NULL, true);
  PERFORM pg_temp.ok(r.established = 2 AND r.matched = 1 AND r.unknown = 1, 'established by ID vs content-matched: ' || r::text);
  SELECT * INTO r FROM public.google_sheets_review(pg_temp.id('a2'), pg_temp.id('orgA'), src, v, g, 'source_id', 'Lead ID', NULL,
    rows3, true, true, r.snapshot, false);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = src AND row_key = 'approved:N1' AND kind = 'approved')
                     AND EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = src AND row_key = 'approved:Z1' AND kind = 'approved')
                     AND NOT EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = src AND row_key IN ('id:N1','id:Z1')),
                     'ID rows chosen for import are recorded as explicit approvals');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = src AND row_key = 'id:E1' AND kind = 'baseline')
                     AND EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = src AND row_key = 'id:R1' AND kind = 'baseline'),
                     'established rows stay out');
  RAISE NOTICE 'PASS T12b ID-mode review';
END $$;

-- Every operational field google_sheets_finish could write, minus the lease (released runs clear their own lease).
CREATE FUNCTION pg_temp.src_snap(src uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT (to_jsonb(s) - 'lease_owner' - 'lease_expires_at')
         || jsonb_build_object('runs', (SELECT count(*) FROM public.google_sheets_sync_runs r WHERE r.source_id = src))
    FROM public.google_sheets_sources s WHERE s.id = src
$$;

-- ================================================================ T15 finish: lease (real clock), version, state, generation, eligibility
DO $$
DECLARE src uuid; c record; c2 record; snap jsonb; res jsonb; o text;
BEGIN
  src := pg_temp.mk_source(pg_temp.id('a1'), pg_temp.id('orgA'), 9300, 'source_id', false, '[]');
  -- (a) reconnect (same Google account → new generation) between claim and finish: every result kind is released
  FOREACH res IN ARRAY ARRAY['{"health":"access_lost","error_code":"file_gone"}', '{"health":"needs_review","review_reason":"rows_changed"}',
                             '{"health":"error","error_code":"boom"}', '{"health":"ok","imported":3}']::jsonb[] LOOP
    c := pg_temp.claim(src);
    PERFORM pg_temp.connect(pg_temp.id('a1'), pg_temp.id('orgA'), 'sub-a1');
    snap := pg_temp.src_snap(src);
    o := public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', res);
    PERFORM pg_temp.ok(o = 'released', 'reconnect → released (' || (res->>'health') || '): ' || o);
    PERFORM pg_temp.ok(pg_temp.src_snap(src) = snap, 'reconnect: nothing written for ' || (res->>'health'));
    PERFORM pg_temp.ok((SELECT lease_owner IS NULL FROM public.google_sheets_sources WHERE id = src), 'own lease released');
  END LOOP;
  -- (b) disconnect during the run
  c := pg_temp.claim(src);
  PERFORM public.google_sheets_disconnect(pg_temp.id('a1'), pg_temp.id('orgA'));
  snap := pg_temp.src_snap(src);
  PERFORM pg_temp.ok(public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"access_lost"}') = 'released', 'disconnect → released');
  PERFORM pg_temp.ok(pg_temp.src_snap(src) = snap, 'disconnect: nothing written');
  PERFORM pg_temp.connect(pg_temp.id('a1'), pg_temp.id('orgA'), 'sub-a1');
  -- (c) expired lease, never re-claimed
  c := pg_temp.claim(src);
  UPDATE public.google_sheets_sources SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = src;
  snap := pg_temp.src_snap(src);
  PERFORM pg_temp.ok(public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"ok"}') = 'released', 'expired → released');
  PERFORM pg_temp.ok(pg_temp.src_snap(src) = snap, 'expired: no success time, schedule or history written');
  -- (d) takeover: a newer worker holds the lease → not_owner, nothing (not even the lease) touched
  c := pg_temp.claim(src);
  UPDATE public.google_sheets_sources SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = src;
  c2 := pg_temp.claim(src);
  snap := pg_temp.src_snap(src) || jsonb_build_object('lease', (SELECT lease_owner FROM public.google_sheets_sources WHERE id = src));
  PERFORM pg_temp.ok(public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"error"}') = 'not_owner', 'takeover → not_owner');
  PERFORM pg_temp.ok(pg_temp.src_snap(src) || jsonb_build_object('lease', (SELECT lease_owner FROM public.google_sheets_sources WHERE id = src)) = snap
                     AND (SELECT lease_owner = c2.lease FROM public.google_sheets_sources WHERE id = src), 'newer lease and state intact');
  PERFORM pg_temp.ok(public.google_sheets_finish(src, c2.lease, c2.ver, c2.gen, 'schedule', '{"health":"ok","imported":1}') = 'completed', 'newer worker completes');
  PERFORM pg_temp.ok((SELECT last_success_at IS NOT NULL AND (last_result->>'imported')::int = 1 FROM public.google_sheets_sources WHERE id = src), 'completed writes status');
  -- (e) permission revoked mid-run
  c := pg_temp.claim(src);
  INSERT INTO public.role_permissions (organization_id, role, permissions)
  VALUES (pg_temp.id('orgA'), 'Agent', '{"contacts":{"contacts.leads.import_google_sheets":false}}');
  snap := pg_temp.src_snap(src);
  PERFORM pg_temp.ok(public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"ok"}') = 'released', 'permission revoked → released');
  PERFORM pg_temp.ok(pg_temp.src_snap(src) = snap, 'permission revoked: nothing written');
  DELETE FROM public.role_permissions;
  -- (f) edited (version) and (g) paused during the run
  c := pg_temp.claim(src);
  PERFORM public.google_sheets_save_source(pg_temp.id('a1'), pg_temp.id('orgA'), src, c.ver,
    '{"display_name":"Edited","identity_mode":"source_id","id_header":"Lead ID","mapping":{"v":1}}');
  snap := pg_temp.src_snap(src);
  PERFORM pg_temp.ok(public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"error"}') = 'released', 'edited → released');
  PERFORM pg_temp.ok(pg_temp.src_snap(src) = snap, 'edited: nothing written');
  c := pg_temp.claim(src);
  PERFORM public.google_sheets_set_state(pg_temp.id('a1'), pg_temp.id('orgA'), src, 'pause');
  snap := pg_temp.src_snap(src);
  PERFORM pg_temp.ok(public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"ok"}') = 'not_owner', 'paused (lease cleared) → not_owner');
  PERFORM pg_temp.ok(pg_temp.src_snap(src) = snap, 'paused: nothing written');
  PERFORM public.google_sheets_set_state(pg_temp.id('a1'), pg_temp.id('orgA'), src, 'resume');
  -- (h) removed
  c := pg_temp.claim(src);
  PERFORM public.google_sheets_set_state(pg_temp.id('a1'), pg_temp.id('orgA'), src, 'remove');
  PERFORM pg_temp.ok(public.google_sheets_finish(src, c.lease, c.ver, c.gen, 'schedule', '{"health":"ok"}') = 'not_found', 'removed → not_found');
  -- ingest refuses an expired lease even while it holds the row lock (real clock)
  src := pg_temp.mk_source(pg_temp.id('a1'), pg_temp.id('orgA'), 9301, 'source_id', false, '[]');
  c := pg_temp.claim(src);
  UPDATE public.google_sheets_sources SET lease_expires_at = clock_timestamp() + interval '50 milliseconds' WHERE id = src;
  PERFORM pg_sleep(0.1);
  BEGIN PERFORM public.google_sheets_ingest(src, c.lease, c.ver, c.gen, '[]', '[]'); RAISE EXCEPTION 'FAIL expired ingest';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM = 'stale: lease lost', SQLERRM); END;
  RAISE NOTICE 'PASS T15 finish outcomes';
END $$;

-- ================================================================ T16 review / resolve bound to the connection generation
DO $$
DECLARE src uuid; ids uuid; r record; v int; g bigint; snap jsonb; ledger_before jsonb; rv jsonb;
  rows4 jsonb := '[{"k":"pos:2","n":2,"f":"X"},{"k":"pos:3","n":3,"f":"A"}]';
BEGIN
  src := pg_temp.mk_source(pg_temp.id('a1'), pg_temp.id('orgA'), 9400, 'row_position', false, '[{"k":"pos:2","n":2,"f":"A"}]');
  UPDATE public.google_sheets_sources SET health = 'needs_review', review_reason = 'rows_changed' WHERE id = src;
  SELECT config_version INTO v FROM public.google_sheets_sources WHERE id = src;
  SELECT auth_generation INTO g FROM public.google_sheets_connections WHERE user_id = pg_temp.id('a1');
  SELECT * INTO r FROM public.google_sheets_review(pg_temp.id('a1'), pg_temp.id('orgA'), src, v, g, 'row_position', NULL, NULL, rows4, NULL, NULL, NULL, true);
  -- the Google read used generation g; a reconnect with the SAME account happens before the old apply
  PERFORM pg_temp.connect(pg_temp.id('a1'), pg_temp.id('orgA'), 'sub-a1');
  snap := pg_temp.src_snap(src);
  SELECT jsonb_agg(to_jsonb(x) ORDER BY row_key) INTO ledger_before FROM private.google_sheets_source_rows x WHERE source_id = src;
  BEGIN
    PERFORM public.google_sheets_review(pg_temp.id('a1'), pg_temp.id('orgA'), src, v, g, 'row_position', NULL, '{"v":1,"changed":true}', rows4, true, true, r.snapshot, false);
    RAISE EXCEPTION 'FAIL old review applied after reconnect';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM = 'connection_changed', SQLERRM); END;
  -- the new generation cannot reuse the old snapshot either
  BEGIN
    PERFORM public.google_sheets_review(pg_temp.id('a1'), pg_temp.id('orgA'), src, v, g + 1, 'row_position', NULL, NULL, rows4, true, true, r.snapshot, false);
    RAISE EXCEPTION 'FAIL old snapshot accepted under a new generation';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM = 'review_changed', SQLERRM); END;
  PERFORM public.google_sheets_disconnect(pg_temp.id('a1'), pg_temp.id('orgA'));
  BEGIN
    PERFORM public.google_sheets_review(pg_temp.id('a1'), pg_temp.id('orgA'), src, v, g + 1, 'row_position', NULL, NULL, rows4, true, true, r.snapshot, false);
    RAISE EXCEPTION 'FAIL review applied after disconnect';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM = 'not_connected', SQLERRM); END;
  PERFORM pg_temp.ok(pg_temp.src_snap(src) = snap
                     AND (SELECT jsonb_agg(to_jsonb(x) ORDER BY row_key) FROM private.google_sheets_source_rows x WHERE source_id = src) = ledger_before,
                     'stale reviews rebuilt no baseline, kept Needs review, mapping and schedule');
  PERFORM pg_temp.connect(pg_temp.id('a1'), pg_temp.id('orgA'), 'sub-a1');
  -- resolve_identity is bound the same way
  ids := pg_temp.mk_source(pg_temp.id('a1'), pg_temp.id('orgA'), 9401, 'source_id', false, '[{"k":"blank:2","n":2,"f":"FA"}]');
  UPDATE public.google_sheets_sources SET health = 'needs_review', review_reason = 'identity_ambiguous' WHERE id = ids;
  SELECT config_version INTO v FROM public.google_sheets_sources WHERE id = ids;
  SELECT auth_generation INTO g FROM public.google_sheets_connections WHERE user_id = pg_temp.id('a1');
  rv := '{"decide":[{"k":"id:N1","n":3,"f":"FA","s":"s","hint":"content"}],"retire":["blank:2"],"kept":[]}';
  SELECT * INTO r FROM public.google_sheets_resolve_identity(pg_temp.id('a1'), pg_temp.id('orgA'), ids, v, g, rv, NULL, NULL, true);
  PERFORM pg_temp.connect(pg_temp.id('a1'), pg_temp.id('orgA'), 'sub-a1');
  snap := pg_temp.src_snap(ids);
  BEGIN
    PERFORM public.google_sheets_resolve_identity(pg_temp.id('a1'), pg_temp.id('orgA'), ids, v, g, rv, r.snapshot, '{"id:N1":"import"}', false);
    RAISE EXCEPTION 'FAIL old identity review applied after reconnect';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM = 'connection_changed', SQLERRM); END;
  PERFORM pg_temp.ok(pg_temp.src_snap(ids) = snap AND EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = ids AND row_key = 'blank:2')
                     AND NOT EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = ids AND row_key LIKE 'approved:%'),
                     'stale identity review wrote nothing');
  RAISE NOTICE 'PASS T16 review generation';
END $$;

-- ================================================================ T17 identity review (resolve_identity) validation + apply
DO $$
DECLARE src uuid; r record; v int; g bigint; rv jsonb; bad text;
BEGIN
  src := pg_temp.mk_source(pg_temp.id('a2'), pg_temp.id('orgA'), 9500, 'source_id', false,
    '[{"k":"blank:2","n":2,"f":"FA"},{"k":"blank:3","n":3,"f":"FB"},{"k":"id:E1","n":4,"f":"FE"},{"k":"blank:7","n":7,"f":"FK"}]');
  SELECT config_version INTO v FROM public.google_sheets_sources WHERE id = src;
  SELECT auth_generation INTO g FROM public.google_sheets_connections WHERE user_id = pg_temp.id('a2');
  rv := '{"decide":[{"k":"id:N1","n":5,"f":"FA","s":"s1","hint":"content"},{"k":"noid:6","n":6,"f":"FB","s":"s2","hint":"content"},{"k":"id:Z1","n":8,"f":"FZ","s":"s3","hint":null}],"retire":["blank:2","blank:3"],"kept":["blank:7"]}';
  BEGIN PERFORM public.google_sheets_resolve_identity(pg_temp.id('a2'), pg_temp.id('orgA'), src, v, g, rv, NULL, NULL, true);
        RAISE EXCEPTION 'FAIL identity review on a healthy source';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM = 'invalid_state', SQLERRM); END;
  UPDATE public.google_sheets_sources SET health = 'needs_review', review_reason = 'identity_ambiguous' WHERE id = src;
  SELECT * INTO r FROM public.google_sheets_resolve_identity(pg_temp.id('a2'), pg_temp.id('orgA'), src, v, g, rv, NULL, NULL, true);
  PERFORM pg_temp.ok(length(r.snapshot) = 64 AND (SELECT health FROM public.google_sheets_sources WHERE id = src) = 'needs_review', 'dry run writes nothing');
  -- malformed classifications are refused
  FOREACH bad IN ARRAY ARRAY[
    '{"decide":[{"k":"id:E1","n":4,"f":"FE","s":"x","hint":null}],"retire":["blank:2","blank:3"],"kept":["blank:7"]}',   -- established ID offered
    '{"decide":[{"k":"bogus","n":4,"f":"F","s":"x","hint":null}],"retire":["blank:2","blank:3"],"kept":["blank:7"]}',      -- bad key
    '{"decide":[{"k":"noid:9","n":4,"f":"F","s":"x","hint":null}],"retire":["blank:2","blank:3"],"kept":["blank:7"]}',     -- noid key / row mismatch
    '{"decide":[],"retire":["blank:2"],"kept":["blank:7"]}',                                                                -- a baseline unaccounted for
    '{"decide":[],"retire":["blank:2","blank:3"],"kept":["blank:3","blank:7"]}',                                           -- kept and retired
    '{"decide":[{"k":"id:N1","n":5,"f":"FA"},{"k":"id:N1","n":6,"f":"FA"}],"retire":["blank:2","blank:3"],"kept":["blank:7"]}'] LOOP
    BEGIN PERFORM public.google_sheets_resolve_identity(pg_temp.id('a2'), pg_temp.id('orgA'), src, v, g, bad::jsonb, NULL, NULL, true);
          RAISE EXCEPTION 'FAIL accepted %', bad;
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  -- decisions must be explicit and complete, and only for the reviewed snapshot
  FOREACH bad IN ARRAY ARRAY['{"id:N1":"import","noid:6":"exclude"}', '{"id:N1":"import","noid:6":"exclude","id:Z1":"maybe"}',
                             '{"id:N1":"import","noid:6":"exclude","id:Z1":"import","id:EXTRA":"import"}'] LOOP
    BEGIN PERFORM public.google_sheets_resolve_identity(pg_temp.id('a2'), pg_temp.id('orgA'), src, v, g, rv, r.snapshot, bad::jsonb, false);
          RAISE EXCEPTION 'FAIL decisions accepted %', bad;
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  BEGIN PERFORM public.google_sheets_resolve_identity(pg_temp.id('a2'), pg_temp.id('orgA'), src, v, g,
          jsonb_set(rv, '{decide,2,f}', '"FZ2"'), r.snapshot, '{"id:N1":"exclude","noid:6":"exclude","id:Z1":"import"}', false);
        RAISE EXCEPTION 'FAIL changed classification accepted';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM = 'review_changed', SQLERRM); END;
  PERFORM pg_temp.ok((SELECT health = 'needs_review' AND config_version = v FROM public.google_sheets_sources WHERE id = src)
                     AND (SELECT count(*) FROM private.google_sheets_source_rows WHERE source_id = src) = 4, 'refusals changed nothing');
  SELECT * INTO r FROM public.google_sheets_resolve_identity(pg_temp.id('a2'), pg_temp.id('orgA'), src, v, g, rv, r.snapshot,
    '{"id:N1":"exclude","noid:6":"exclude","id:Z1":"import"}', false);
  PERFORM pg_temp.ok(r.decided = 3 AND r.config_version = v + 1, 'applied: ' || r::text);
  PERFORM pg_temp.ok((SELECT array_agg(row_key || '=' || kind || '/' || fingerprint ORDER BY row_key) FROM private.google_sheets_source_rows WHERE source_id = src)
                     = ARRAY['approved:Z1=approved/FZ','blank:6=baseline/FB','blank:7=baseline/FK','id:E1=baseline/FE','id:N1=baseline/FA'],
                     'exclude → baselines (re-anchored blank), import → approval, unresolved retired, kept untouched');
  PERFORM pg_temp.ok((SELECT health = 'ok' AND review_reason IS NULL AND next_sync_at <= now() FROM public.google_sheets_sources WHERE id = src), 'review cleared, due now');
  BEGIN PERFORM public.google_sheets_resolve_identity(pg_temp.id('a2'), pg_temp.id('orgA'), src, v, g, rv, r.snapshot,
          '{"id:N1":"exclude","noid:6":"exclude","id:Z1":"import"}', false);
        RAISE EXCEPTION 'FAIL replayed identity review';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok(SQLERRM IN ('invalid_state','version_conflict'), SQLERRM); END;
  RAISE NOTICE 'PASS T17 identity review';
END $$;

-- ================================================================ T18 Picker re-check (connection_current)
DO $$
DECLARE cid uuid; g bigint;
BEGIN
  SELECT id, auth_generation INTO cid, g FROM public.google_sheets_connections WHERE user_id = pg_temp.id('a1');
  PERFORM pg_temp.ok(public.google_sheets_connection_current(pg_temp.id('a1'), pg_temp.id('orgA'), cid, g) = 'current', 'current');
  PERFORM pg_temp.ok(public.google_sheets_connection_current(pg_temp.id('a2'), pg_temp.id('orgA'), cid, g) = 'not_connected', 'another owner');
  PERFORM pg_temp.connect(pg_temp.id('a1'), pg_temp.id('orgA'), 'sub-a1');
  PERFORM pg_temp.ok(public.google_sheets_connection_current(pg_temp.id('a1'), pg_temp.id('orgA'), cid, g) = 'changed', 'reconnect → changed');
  g := g + 1;
  INSERT INTO public.role_permissions (organization_id, role, permissions)
  VALUES (pg_temp.id('orgA'), 'Agent', '{"contacts":{"contacts.leads.import_google_sheets":false}}');
  PERFORM pg_temp.ok(public.google_sheets_connection_current(pg_temp.id('a1'), pg_temp.id('orgA'), cid, g) = 'not_permitted', 'permission removed');
  DELETE FROM public.role_permissions;
  PERFORM public.google_sheets_disconnect(pg_temp.id('a1'), pg_temp.id('orgA'));
  PERFORM pg_temp.ok(public.google_sheets_connection_current(pg_temp.id('a1'), pg_temp.id('orgA'), cid, g + 1) = 'not_connected', 'disconnect');
  PERFORM pg_temp.connect(pg_temp.id('a1'), pg_temp.id('orgA'), 'sub-a1');
  RAISE NOTICE 'PASS T18 picker re-check';
END $$;

-- ================================================================ T13 RLS isolation as authenticated
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('a1'),
    'app_metadata', json_build_object('organization_id', pg_temp.id('orgA')))::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.google_sheets_sources WHERE user_id <> '11111111-0000-0000-0000-000000000001';
  PERFORM pg_temp.ok(n = 0, 'cannot read other agents sources');
  SELECT count(*) INTO n FROM public.google_sheets_sources;
  PERFORM pg_temp.ok(n > 0, 'reads own sources');
  SELECT count(*) INTO n FROM public.google_sheets_connections;
  PERFORM pg_temp.ok(n = 1, 'reads only own connection');
  BEGIN
    UPDATE public.google_sheets_sources SET state = 'enabled';
    RAISE EXCEPTION 'FAIL client update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.google_sheets_claim(gen_random_uuid(), 1);
    RAISE EXCEPTION 'FAIL authenticated executed claim';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM count(*) FROM private.google_sheets_receipts;
    RAISE EXCEPTION 'FAIL receipts readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE NOTICE 'PASS T13 RLS isolation';
END $$;

-- ================================================================ T14 protected records untouched
DO $$
BEGIN
  PERFORM pg_temp.ok((SELECT count(*) FROM public.dnc_list) = 1 AND (SELECT phone_number FROM public.dnc_list) = '5550001111', 'DNC untouched');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.notifications n
                                  WHERE (n.metadata->>'lead_id')::uuid IN (SELECT lead_id FROM private.google_sheets_receipts)
                                     OR n.metadata ? 'count'), 'no notifications for self-imports');
  PERFORM pg_temp.ok((SELECT count(*) FROM private.test_workflow_dispatches d
                        WHERE d.contact_id IN (SELECT lead_id FROM private.google_sheets_receipts)) =
                     (SELECT count(*) FROM private.google_sheets_receipts WHERE outcome IN ('imported','imported_flagged')),
                     'one workflow dispatch per imported receipt');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM private.google_sheets_receipts WHERE outcome = 'skipped_duplicate' AND lead_id IS NOT NULL),
                     'skipped rows have no lead');
  RAISE NOTICE 'PASS T14 protected records';
END $$;

SELECT 'ALL GOOGLE SHEETS SQL TESTS PASSED' AS result;
