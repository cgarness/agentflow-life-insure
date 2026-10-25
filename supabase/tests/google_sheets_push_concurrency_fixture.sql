-- =====================================================================================================
-- Google Sheets PUSH — fixture for the two-session tests in run_google_sheets_tests.sh (§4e–§4h). Synthetic only.
-- One connected agent, one enabled tab, push mode 'on', and two channels on the same target:
--   Y registered first (active), then X registered as a renewal (X active, Y 'stopping'). One catch-up is queued.
-- Values are recorded in public.pcx for the sessions.
-- =====================================================================================================
INSERT INTO public.organizations (id, name) VALUES ('a0000000-0000-0000-0000-0000000000c7', 'Org PC');
INSERT INTO public.profiles (id, organization_id, role) VALUES ('c7000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c7', 'Agent');
CREATE TABLE public.pcx (k text PRIMARY KEY, v text);
DO $$
DECLARE u uuid := 'c7000000-0000-0000-0000-000000000001'; o uuid := 'a0000000-0000-0000-0000-0000000000c7';
        g bigint; c uuid; s record; a record; b record; r jsonb;
        chx text := 'gs1' || rpad('X', 40, 'X'); chy text := 'gs1' || rpad('Y', 40, 'Y');
BEGIN
  SELECT x.auth_generation, x.connection_id INTO g, c FROM public.google_sheets_store_connection(u, o, 0, 'sub-pc', 'pc@example.test', '{}', 'rt-pc') x;
  SELECT * INTO s FROM public.google_sheets_save_source(u, o, NULL, NULL, jsonb_build_object('spreadsheet_id', 'SPREADSHEET_PUSH_CC',
    'sheet_id', 1, 'display_name', 'pc', 'mapping', '{}'::jsonb));
  SELECT * INTO a FROM public.google_sheets_activate(u, o, s.source_id, s.config_version, g, '[]', 0);
  UPDATE private.google_sheets_push_config SET mode = 'on';
  SELECT * INTO b FROM public.google_sheets_watch_begin(c, g, 'SPREADSHEET_PUSH_CC', chy, encode(sha256('tok-y'::bytea), 'hex'), 'abcd1234', 'activate');
  r := public.google_sheets_watch_result(b.channel_row_id, 'activated', 'RES-Y', now() + interval '1 hour', NULL); -- inside the renew window
  INSERT INTO public.pcx VALUES ('rowy', b.channel_row_id::text), ('target', b.target_id::text);
  SELECT * INTO b FROM public.google_sheets_watch_begin(c, g, 'SPREADSHEET_PUSH_CC', chx, encode(sha256('tok-x'::bytea), 'hex'), 'abcd1234', 'renew');
  r := public.google_sheets_watch_result(b.channel_row_id, 'activated', 'RES-X', now() + interval '23 hours', NULL);
  IF (SELECT state FROM private.google_sheets_watch_channels WHERE channel_id = chy) <> 'stopping' THEN RAISE EXCEPTION 'fixture: Y not stopping'; END IF;
  INSERT INTO public.pcx VALUES ('src', s.source_id::text), ('uid', u::text), ('oid', o::text), ('chx', chx), ('chy', chy),
    ('dx', encode(sha256('tok-x'::bytea), 'hex')), ('dy', encode(sha256('tok-y'::bytea), 'hex'));
END $$;
