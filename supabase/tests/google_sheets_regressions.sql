-- =====================================================================================================
-- Google Sheets — REGRESSION cases for the PR #442 review findings (reviewed head 8b675e5).
-- Runs unchanged against the reviewed migration AND the corrected one: the adapters call whichever
-- google_sheets_finish / google_sheets_review signature exists and every assertion is on DATABASE STATE
-- (never on a missing symbol). REGRESSION cases must fail on 8b675e5 and pass on the candidate; CONTROL
-- cases pass on both. Prints one line per case; raises at the end if any case failed.
-- Run via scripts/run_google_sheets_tests.sh (LOCAL ONLY) or scripts/google_sheets_regression_evidence.sh.
-- =====================================================================================================
SET client_min_messages = notice;

CREATE TEMP TABLE gs_reg (seq serial, name text, kind text, ok boolean, detail text);
CREATE FUNCTION pg_temp.rec(p_name text, p_kind text, p_ok boolean, p_detail text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO gs_reg (name, kind, ok, detail) VALUES (p_name, p_kind, COALESCE(p_ok, false), p_detail);
  RAISE NOTICE '% % %: %', CASE WHEN COALESCE(p_ok, false) THEN 'PASS' ELSE 'FAIL' END, p_kind, p_name, p_detail;
END $$;

-- ---------------------------------------------------------------- adapters (old 5-arg / new 6-arg finish; old 10-arg / new 13-arg review)
CREATE FUNCTION pg_temp.finish_any(src uuid, lease uuid, ver int, gen bigint, res jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE o text; b boolean;
BEGIN
  IF to_regprocedure('public.google_sheets_finish(uuid,uuid,integer,bigint,text,jsonb)') IS NOT NULL THEN
    EXECUTE 'SELECT public.google_sheets_finish($1,$2,$3,$4,$5,$6)' INTO o USING src, lease, ver, gen, 'schedule', res;
    RETURN o;
  END IF;
  EXECUTE 'SELECT public.google_sheets_finish($1,$2,$3,$4,$5)' INTO b USING src, lease, ver, 'schedule', res;
  RETURN b::text;
END $$;

-- handled = rows the review treats as already handled WITHOUT an agent choice (old: known; new: established).
CREATE FUNCTION pg_temp.review_any(u uuid, o uuid, src uuid, ver int, gen bigint, mode text, idh text, mapping jsonb, rows jsonb,
  import_matched boolean, import_unknown boolean, snapshot text, dry boolean,
  OUT handled int, OUT matched int, OUT unknown int, OUT snap text) LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  IF to_regprocedure('public.google_sheets_review(uuid,uuid,uuid,integer,bigint,text,text,jsonb,jsonb,boolean,boolean,text,boolean)') IS NOT NULL THEN
    EXECUTE 'SELECT * FROM public.google_sheets_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)' INTO r
      USING u, o, src, ver, gen, mode, idh, mapping, rows, import_matched, import_unknown, snapshot, dry;
    handled := r.established; matched := r.matched; unknown := r.unknown; snap := r.snapshot;
  ELSE
    EXECUTE 'SELECT * FROM public.google_sheets_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)' INTO r
      USING u, o, src, ver, mode, idh, mapping, rows, COALESCE(import_unknown, false), dry;
    handled := r.known; matched := 0; unknown := r.unknown; snap := NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------- fixtures (self-contained)
INSERT INTO public.organizations (id, name, status) VALUES ('a0000000-0000-0000-0000-0000000000f1', 'Regression Org', 'active');
INSERT INTO public.profiles (id, organization_id, role, status, is_super_admin) VALUES
  ('f1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f1', 'Agent', 'Active', false);
CREATE FUNCTION pg_temp.u() RETURNS uuid LANGUAGE sql AS $$ SELECT 'f1000000-0000-0000-0000-000000000001'::uuid $$;
CREATE FUNCTION pg_temp.o() RETURNS uuid LANGUAGE sql AS $$ SELECT 'a0000000-0000-0000-0000-0000000000f1'::uuid $$;
CREATE FUNCTION pg_temp.gen() RETURNS bigint LANGUAGE sql AS $$
  SELECT COALESCE((SELECT auth_generation FROM public.google_sheets_connections WHERE user_id = pg_temp.u()), 0) $$;
-- (re)connect with the SAME Google account: a new authorisation generation
CREATE FUNCTION pg_temp.reconnect() RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.google_sheets_store_connection(pg_temp.u(), pg_temp.o(), pg_temp.gen(), 'sub-reg', 'reg@example.test',
    ARRAY['openid','email','https://www.googleapis.com/auth/drive.file'], 'rt-reg');
  IF r.outcome <> 'connected' THEN RAISE EXCEPTION 'fixture connect: %', r.outcome; END IF;
END $$;
CREATE FUNCTION pg_temp.mk(sheet bigint, mode text, baseline jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE s record; a record;
BEGIN
  SELECT * INTO s FROM public.google_sheets_save_source(pg_temp.u(), pg_temp.o(), NULL, NULL, jsonb_build_object(
    'spreadsheet_id', 'SPREADSHEET_REGRESSION', 'sheet_id', sheet, 'display_name', 'R ' || sheet, 'identity_mode', mode,
    'id_header', CASE WHEN mode = 'source_id' THEN 'Lead ID' END, 'mapping', '{"v":1}'::jsonb));
  SELECT * INTO a FROM public.google_sheets_activate(pg_temp.u(), pg_temp.o(), s.source_id, s.config_version, pg_temp.gen(), baseline, jsonb_array_length(baseline));
  RETURN s.source_id;
END $$;
CREATE FUNCTION pg_temp.claim(src uuid, OUT lease uuid, OUT ver int, OUT gen bigint) LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  lease := gen_random_uuid();
  UPDATE public.google_sheets_sources SET next_sync_at = now() - interval '1 second', last_checked_at = NULL, lease_owner = NULL, lease_expires_at = NULL WHERE id = src;
  SELECT * INTO r FROM public.google_sheets_claim(lease, 1, src, pg_temp.u(), pg_temp.o());
  IF r.source_id IS NULL THEN RAISE EXCEPTION 'fixture claim failed'; END IF;
  ver := r.config_version; gen := r.auth_generation;
END $$;
-- every operational field a finish could write (minus the lease, which a stale run may clear), plus its history
CREATE FUNCTION pg_temp.snap(src uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT (to_jsonb(s) - 'lease_owner' - 'lease_expires_at')
         || jsonb_build_object('runs', (SELECT count(*) FROM public.google_sheets_sync_runs r WHERE r.source_id = src))
    FROM public.google_sheets_sources s WHERE s.id = src $$;
SELECT pg_temp.reconnect();

-- ================================================================ Finding 2 — stale finalization
DO $$
DECLARE src uuid; c record; before jsonb; res jsonb; o text; ok boolean := true; det text := ''; i int := 0;
BEGIN
  FOREACH res IN ARRAY ARRAY['{"health":"access_lost","error_code":"file_gone"}', '{"health":"needs_review","review_reason":"rows_changed"}',
                             '{"health":"error","error_code":"boom"}', '{"health":"ok","imported":3}']::jsonb[] LOOP
    i := i + 1;
    src := pg_temp.mk(100 + i, 'source_id', '[]');   -- one source per result kind: sub-cases stay independent
    c := pg_temp.claim(src);
    PERFORM pg_temp.reconnect();
    before := pg_temp.snap(src);
    o := pg_temp.finish_any(src, c.lease, c.ver, c.gen, res);
    IF pg_temp.snap(src) IS DISTINCT FROM before THEN
      ok := false; det := det || format('%s wrote (health now %s) ', res->>'health', (SELECT health FROM public.google_sheets_sources WHERE id = src));
    END IF;
  END LOOP;
  PERFORM pg_temp.rec('F2a reconnect then old finish (access_lost / needs_review / error / ok) writes nothing', 'REGRESSION', ok,
                      CASE WHEN ok THEN 'state unchanged for all four' ELSE det END);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.rec('F2a reconnect then old finish writes nothing', 'REGRESSION', false, 'error: ' || SQLERRM);
END $$;

DO $$
DECLARE src uuid; c record; before jsonb; o text;
BEGIN
  src := pg_temp.mk(2, 'source_id', '[]');
  c := pg_temp.claim(src);
  UPDATE public.google_sheets_sources SET lease_expires_at = clock_timestamp() - interval '1 second', last_success_at = '2026-01-01T00:00:00Z' WHERE id = src;
  before := pg_temp.snap(src);
  o := pg_temp.finish_any(src, c.lease, c.ver, c.gen, '{"health":"ok","imported":2}');
  PERFORM pg_temp.rec('F2b expired lease (not re-claimed) finish writes no success time, schedule or history', 'REGRESSION',
    pg_temp.snap(src) = before, format('finish returned %s; last_success_at %s', o, (SELECT last_success_at FROM public.google_sheets_sources WHERE id = src)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.rec('F2b expired lease finish writes nothing', 'REGRESSION', false, 'error: ' || SQLERRM);
END $$;

DO $$
DECLARE src uuid; c record; before jsonb; o text;
BEGIN
  src := pg_temp.mk(3, 'source_id', '[]');
  c := pg_temp.claim(src);
  PERFORM public.google_sheets_disconnect(pg_temp.u(), pg_temp.o());
  before := pg_temp.snap(src);
  o := pg_temp.finish_any(src, c.lease, c.ver, c.gen, '{"health":"access_lost","error_code":"x"}');
  PERFORM pg_temp.rec('F2c disconnect then old finish writes nothing', 'REGRESSION', pg_temp.snap(src) = before,
    format('finish returned %s; health %s', o, (SELECT health FROM public.google_sheets_sources WHERE id = src)));
  PERFORM pg_temp.reconnect();
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.rec('F2c disconnect then old finish writes nothing', 'REGRESSION', false, 'error: ' || SQLERRM);
  PERFORM pg_temp.reconnect();
END $$;

DO $$
DECLARE src uuid; c record; before jsonb; o text;
BEGIN
  src := pg_temp.mk(4, 'source_id', '[]');
  c := pg_temp.claim(src);
  INSERT INTO public.role_permissions (organization_id, role, permissions)
  VALUES (pg_temp.o(), 'Agent', '{"contacts":{"contacts.leads.import_google_sheets":false}}');
  before := pg_temp.snap(src);
  o := pg_temp.finish_any(src, c.lease, c.ver, c.gen, '{"health":"ok","imported":1}');
  PERFORM pg_temp.rec('F2d permission revoked mid-run then finish writes nothing', 'REGRESSION', pg_temp.snap(src) = before, 'finish returned ' || o);
  DELETE FROM public.role_permissions WHERE organization_id = pg_temp.o();
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.rec('F2d permission revoked then finish writes nothing', 'REGRESSION', false, 'error: ' || SQLERRM);
  DELETE FROM public.role_permissions WHERE organization_id = pg_temp.o();
END $$;

DO $$
DECLARE src uuid; c record; c2 record; before jsonb; o text;
BEGIN
  src := pg_temp.mk(5, 'source_id', '[]');
  c := pg_temp.claim(src);
  UPDATE public.google_sheets_sources SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = src;
  c2 := pg_temp.claim(src);
  before := pg_temp.snap(src) || jsonb_build_object('lease', c2.lease);
  o := pg_temp.finish_any(src, c.lease, c.ver, c.gen, '{"health":"error","error_code":"old"}');
  PERFORM pg_temp.rec('takeover — the old worker cannot touch the newer lease or state', 'CONTROL',
    pg_temp.snap(src) || jsonb_build_object('lease', (SELECT lease_owner FROM public.google_sheets_sources WHERE id = src)) = before,
    'finish returned ' || o);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.rec('takeover control', 'CONTROL', false, 'error: ' || SQLERRM);
END $$;

-- ================================================================ Amendment B — review bound to the connection generation
CREATE FUNCTION pg_temp.review_case(sheet bigint, disconnect boolean) RETURNS text LANGUAGE plpgsql AS $$
DECLARE src uuid; v int; g bigint; r record; before jsonb; ledger jsonb; err text := 'applied';
  rows jsonb := '[{"k":"pos:2","n":2,"f":"X"},{"k":"pos:3","n":3,"f":"A"}]';
BEGIN
  src := pg_temp.mk(sheet, 'row_position', '[{"k":"pos:2","n":2,"f":"A"}]');
  UPDATE public.google_sheets_sources SET health = 'needs_review', review_reason = 'rows_changed' WHERE id = src;
  SELECT config_version INTO v FROM public.google_sheets_sources WHERE id = src;
  g := pg_temp.gen();                       -- generation of the token used for the Google read
  SELECT * INTO r FROM pg_temp.review_any(pg_temp.u(), pg_temp.o(), src, v, g, 'row_position', NULL, NULL, rows, NULL, NULL, NULL, true);
  IF disconnect THEN PERFORM public.google_sheets_disconnect(pg_temp.u(), pg_temp.o()); ELSE PERFORM pg_temp.reconnect(); END IF;
  before := pg_temp.snap(src);
  SELECT jsonb_agg(to_jsonb(x) - 'updated_at' ORDER BY row_key) INTO ledger FROM private.google_sheets_source_rows x WHERE source_id = src;
  BEGIN
    PERFORM * FROM pg_temp.review_any(pg_temp.u(), pg_temp.o(), src, v, g, 'row_position', NULL, '{"v":1,"changed":true}', rows, true, true, r.snap, false);
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  IF disconnect THEN PERFORM pg_temp.reconnect(); END IF;
  IF pg_temp.snap(src) = before
     AND (SELECT jsonb_agg(to_jsonb(x) - 'updated_at' ORDER BY row_key) FROM private.google_sheets_source_rows x WHERE source_id = src) IS NOT DISTINCT FROM ledger THEN
    RETURN 'ok:' || err;
  END IF;
  RETURN format('changed: apply outcome %s; health %s; epoch %s', err,
                (SELECT health FROM public.google_sheets_sources WHERE id = src), (SELECT row_epoch FROM public.google_sheets_sources WHERE id = src));
END $$;

DO $$
DECLARE o text;
BEGIN
  o := pg_temp.review_case(10, false);
  PERFORM pg_temp.rec('B1 review read before a reconnect cannot apply afterwards (baseline, Needs review, mapping, schedule unchanged)', 'REGRESSION', o LIKE 'ok:%', o);
  o := pg_temp.review_case(11, true);
  PERFORM pg_temp.rec('B2 review read before a disconnect cannot apply afterwards', 'REGRESSION', o LIKE 'ok:%', o);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.rec('B1/B2 review generation', 'REGRESSION', false, 'error: ' || SQLERRM);
END $$;

-- ================================================================ Amendment A — the Review path must not hide ambiguous content matches
DO $$
DECLARE src uuid; v int; r record;
BEGIN
  -- row A was imported/excluded at row 2; a new row is inserted above it, so A now matches ONLY by content
  src := pg_temp.mk(20, 'row_position', '[{"k":"pos:2","n":2,"f":"A"}]');
  UPDATE public.google_sheets_sources SET health = 'needs_review', review_reason = 'rows_changed' WHERE id = src;
  SELECT config_version INTO v FROM public.google_sheets_sources WHERE id = src;
  SELECT * INTO r FROM pg_temp.review_any(pg_temp.u(), pg_temp.o(), src, v, pg_temp.gen(), 'row_position', NULL, NULL,
    '[{"k":"pos:2","n":2,"f":"X"},{"k":"pos:3","n":3,"f":"A"}]', NULL, NULL, NULL, true);
  PERFORM pg_temp.rec('A1 a content-only match is not labelled "already handled" without the agent''s decision', 'REGRESSION',
    r.handled = 0 AND r.matched = 1, format('handled %s, matched %s, unknown %s', r.handled, r.matched, r.unknown));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.rec('A1 content-only match', 'REGRESSION', false, 'error: ' || SQLERRM);
END $$;

DO $$
DECLARE src uuid; v int; r record;
  rows jsonb := '[{"k":"pos:2","n":2,"f":"X"},{"k":"pos:3","n":3,"f":"A"}]';
BEGIN
  src := pg_temp.mk(21, 'row_position', '[{"k":"pos:2","n":2,"f":"A"}]');
  UPDATE public.google_sheets_sources SET health = 'needs_review', review_reason = 'rows_changed' WHERE id = src;
  SELECT config_version INTO v FROM public.google_sheets_sources WHERE id = src;
  SELECT * INTO r FROM pg_temp.review_any(pg_temp.u(), pg_temp.o(), src, v, pg_temp.gen(), 'row_position', NULL, NULL, rows, NULL, NULL, NULL, true);
  -- the agent explicitly chooses to import the content-matched row (and the unmatched one)
  PERFORM * FROM pg_temp.review_any(pg_temp.u(), pg_temp.o(), src, v, pg_temp.gen(), 'row_position', NULL, NULL, rows, true, true, r.snap, false);
  PERFORM pg_temp.rec('A2 the agent''s explicit "import" for a content-matched row is honoured (it is not silently baselined)', 'REGRESSION',
    NOT EXISTS (SELECT 1 FROM private.google_sheets_source_rows WHERE source_id = src AND row_key = 'pos:3'),
    format('ledger after apply: %s', coalesce((SELECT string_agg(row_key || '=' || kind, ',') FROM private.google_sheets_source_rows WHERE source_id = src),
      '(empty: both rows stay import candidates)')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.rec('A2 explicit import of a content match', 'REGRESSION', false, 'error: ' || SQLERRM);
END $$;

-- ---------------------------------------------------------------- summary
DO $$
DECLARE n_fail int; n_all int;
BEGIN
  SELECT count(*) FILTER (WHERE NOT ok), count(*) INTO n_fail, n_all FROM gs_reg;
  IF n_fail > 0 THEN
    RAISE EXCEPTION 'REGRESSION SUMMARY: % of % cases FAILED', n_fail, n_all;
  END IF;
  RAISE NOTICE 'REGRESSION SUMMARY: all % cases passed', n_all;
END $$;
