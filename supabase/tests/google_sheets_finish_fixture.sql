-- =====================================================================================================
-- Google Sheets — fixture for the two-session finish tests (run_google_sheets_tests.sh §4b/§4c and
-- google_sheets_regression_evidence.sh): one connected agent and one claimed source, recorded in public.fx.
-- Uses only functions whose signatures are identical on the reviewed head and the candidate.
-- =====================================================================================================
INSERT INTO public.organizations (id, name) VALUES ('a0000000-0000-0000-0000-0000000000fa', 'Org FX');
INSERT INTO public.profiles (id, organization_id, role) VALUES ('fa000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000fa', 'Agent');
CREATE TABLE public.fx (src uuid, lease uuid, ver int, gen bigint, uid uuid, oid uuid, cid uuid);
DO $$
DECLARE u uuid := 'fa000000-0000-0000-0000-000000000001'; o uuid := 'a0000000-0000-0000-0000-0000000000fa';
        g bigint; cid uuid; s record; a record; l uuid := gen_random_uuid(); c record;
BEGIN
  SELECT r.auth_generation, r.connection_id INTO g, cid FROM public.google_sheets_store_connection(u, o, 0, 'sub-fx', 'fx@example.test', '{}', 'rt-fx') r;
  SELECT * INTO s FROM public.google_sheets_save_source(u, o, NULL, NULL,
    jsonb_build_object('spreadsheet_id','SPREADSHEET_FINISHFX','sheet_id',1,'display_name','fx','mapping','{}'::jsonb));
  SELECT * INTO a FROM public.google_sheets_activate(u, o, s.source_id, s.config_version, g, '[]', 0);
  SELECT * INTO c FROM public.google_sheets_claim(l, 1, s.source_id, u, o);
  INSERT INTO public.fx VALUES (s.source_id, l, c.config_version, c.auth_generation, u, o, cid);
END $$;
