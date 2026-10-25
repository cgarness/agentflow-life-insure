-- =====================================================================================================
-- Google Sheets PUSH sync — SQL behaviour suite (harness + foundation + 20261025120000). LOCAL ONLY; run by
-- scripts/run_google_sheets_tests.sh. Statements run in autocommit on purpose: like the Edge Functions' PostgREST
-- calls, a claim, a finish and a completion are SEPARATE transactions (the 'done' verification compares finish's
-- now() with the claim's real-clock start). Every check raises on failure.
-- =====================================================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;
CREATE TABLE pg_temp.kv (k text PRIMARY KEY, v text);
CREATE FUNCTION pg_temp.put(k text, v text) RETURNS text LANGUAGE sql AS $$
  INSERT INTO pg_temp.kv VALUES (k, v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v RETURNING v $$;
CREATE FUNCTION pg_temp.get(k text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM pg_temp.kv WHERE kv.k = $1 $$;
CREATE FUNCTION pg_temp.hex(t text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;
CREATE FUNCTION pg_temp.ch(n int) RETURNS text LANGUAGE sql AS $$ SELECT 'gs1' || lpad(n::text, 40, 'C') $$;
CREATE FUNCTION pg_temp.tok(n int) RETURNS text LANGUAGE sql AS $$ SELECT 'token-' || n || '-' || repeat('x', 30) $$;
CREATE FUNCTION pg_temp.key() RETURNS text LANGUAGE sql AS $$ SELECT 'abcd1234'::text $$;

-- ---------------------------------------------------------------- fixtures (synthetic)
INSERT INTO public.organizations (id, name, status) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'Push Org A', 'active'), ('b0000000-0000-0000-0000-0000000000b1', 'Push Org B', 'active');
INSERT INTO public.profiles (id, organization_id, role, status) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', 'Agent', 'Active'),
  ('a2000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000a1', 'Agent', 'Active'),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000b1', 'Agent', 'Active');
CREATE TABLE pg_temp.ids (k text PRIMARY KEY, v uuid);
INSERT INTO pg_temp.ids VALUES ('orgA', 'a0000000-0000-0000-0000-0000000000a1'), ('orgB', 'b0000000-0000-0000-0000-0000000000b1'),
  ('a1', 'a1000000-0000-0000-0000-000000000001'), ('a2', 'a2000000-0000-0000-0000-000000000002'), ('b1', 'b1000000-0000-0000-0000-000000000001');
CREATE FUNCTION pg_temp.id(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM pg_temp.ids WHERE ids.k = $1 $$;
CREATE FUNCTION pg_temp.org(u uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT organization_id FROM public.profiles WHERE id = u $$;
CREATE FUNCTION pg_temp.conn(u uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM public.google_sheets_connections WHERE user_id = u $$;
CREATE FUNCTION pg_temp.gen(u uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT auth_generation FROM public.google_sheets_connections WHERE user_id = u $$;
CREATE FUNCTION pg_temp.connect(u uuid) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.google_sheets_store_connection(u, pg_temp.org(u), COALESCE(pg_temp.gen(u), 0), 'sub-' || u,
    'push@example.test', ARRAY['openid','email','https://www.googleapis.com/auth/drive.file'], 'rt-' || u);
  PERFORM pg_temp.ok(r.outcome = 'connected', 'connect ' || r.outcome);
  RETURN r.auth_generation;
END $$;
CREATE FUNCTION pg_temp.source(u uuid, sp text, sheet bigint) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE s record; a record;
BEGIN
  SELECT * INTO s FROM public.google_sheets_save_source(u, pg_temp.org(u), NULL, NULL, jsonb_build_object(
    'spreadsheet_id', sp, 'sheet_id', sheet, 'display_name', sp || ' ' || sheet, 'mapping', '{"v":1}'::jsonb));
  SELECT * INTO a FROM public.google_sheets_activate(u, pg_temp.org(u), s.source_id, s.config_version, pg_temp.gen(u), '[]', 0);
  PERFORM pg_temp.ok(a.outcome = 'activated', 'activate ' || a.outcome);
  RETURN s.source_id;
END $$;
CREATE FUNCTION pg_temp.target(u uuid, sp text) RETURNS private.google_sheets_watch_targets LANGUAGE sql AS $$
  SELECT * FROM private.google_sheets_watch_targets WHERE connection_id = pg_temp.conn(u) AND spreadsheet_id = sp $$;
CREATE FUNCTION pg_temp.chan(n int) RETURNS private.google_sheets_watch_channels LANGUAGE sql AS $$
  SELECT * FROM private.google_sheets_watch_channels WHERE channel_id = pg_temp.ch(n) $$;
CREATE FUNCTION pg_temp.wbegin(u uuid, sp text, n int, reason text DEFAULT 'activate')
 RETURNS TABLE (outcome text, channel_row_id uuid, target_id uuid) LANGUAGE sql AS $$
  SELECT * FROM public.google_sheets_watch_begin(pg_temp.conn(u), pg_temp.gen(u), sp, pg_temp.ch(n), pg_temp.hex(pg_temp.tok(n)), pg_temp.key(), reason) $$;
CREATE FUNCTION pg_temp.watch(u uuid, sp text, n int, reason text DEFAULT 'activate') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM pg_temp.wbegin(u, sp, n, reason);
  PERFORM pg_temp.ok(b.outcome = 'register', 'watch_begin ' || b.outcome || ' (channel ' || n || ')');
  RETURN public.google_sheets_watch_result(b.channel_row_id, 'activated', 'RES-' || n, now() + interval '23 hours', NULL);
END $$;
CREATE FUNCTION pg_temp.notify(n int, st text, msg bigint, tok text DEFAULT NULL, res text DEFAULT NULL)
 RETURNS TABLE (outcome text, target_id uuid, process boolean) LANGUAGE sql AS $$
  SELECT * FROM public.google_sheets_push_accept(pg_temp.ch(n), pg_temp.hex(COALESCE(tok, pg_temp.tok(n))),
    COALESCE(res, 'RES-' || n), st, msg, 'content', now()) $$;
CREATE FUNCTION pg_temp.o(n int, st text, msg bigint, tok text DEFAULT NULL, res text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT outcome FROM pg_temp.notify(n, st, msg, tok, res) $$;
-- A channel row in a given lifecycle state for user u's spreadsheet (P16 acceptance matrix). Times are offsets
-- from now(); NULL activated means Google never confirmed it.
CREATE FUNCTION pg_temp.mkchan(u uuid, sp text, n int, st text, activated interval, expires interval, stopped interval,
  created interval DEFAULT interval '0', generation bigint DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO private.google_sheets_watch_channels (target_id, organization_id, user_id, connection_id, spreadsheet_id,
    auth_generation, channel_id, token_digest, key_id, state, reason, resource_id, activated_at, expires_at, stopped_at, created_at)
  SELECT x.id, x.organization_id, x.user_id, x.connection_id, sp, COALESCE(generation, pg_temp.gen(u)), pg_temp.ch(n),
         decode(pg_temp.hex(pg_temp.tok(n)), 'hex'), pg_temp.key(), st, 'renew', 'RES-' || n,
         now() + activated, now() + expires, now() + stopped, now() + created
    FROM private.google_sheets_watch_targets x WHERE x.connection_id = pg_temp.conn(u) AND x.spreadsheet_id = sp
  RETURNING id $$;
CREATE FUNCTION pg_temp.reason(n int, msg bigint) RETURNS text LANGUAGE sql AS $$
  SELECT e.reason FROM private.google_sheets_push_events e JOIN private.google_sheets_watch_channels w ON w.id = e.channel_row_id
   WHERE w.channel_id = pg_temp.ch(n) AND e.message_number = msg AND e.authenticated $$;
-- Claims a target (job) and records lease + attempt in kv under `name`.
CREATE FUNCTION pg_temp.claim(name text, t uuid, lease_s int DEFAULT 300) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE c record; l uuid := gen_random_uuid();
BEGIN
  SELECT * INTO c FROM public.google_sheets_push_claim(l, t, lease_s, 'receiver');
  IF c.target_id IS NULL THEN RETURN false; END IF;
  PERFORM pg_temp.put(name || '.lease', l::text);
  PERFORM pg_temp.put(name || '.target', c.target_id::text);
  PERFORM pg_temp.put(name || '.snapshot', c.snapshot_seq::text);
  PERFORM pg_temp.put(name || '.sources', array_to_string(c.sources, ','));
  RETURN true;
END $$;
-- The Edge's per-source step: authorised push claim, then the (unchanged) finish with trigger 'push'.
CREATE FUNCTION pg_temp.claim_source(name text, src uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE c record; l uuid := gen_random_uuid();
BEGIN
  SELECT * INTO c FROM public.google_sheets_push_claim_source(pg_temp.get(name || '.target')::uuid, pg_temp.get(name || '.lease')::uuid, src, l);
  IF c.source_id IS NULL THEN RETURN false; END IF;
  PERFORM pg_temp.put(name || '.src.' || src, l || '|' || c.config_version || '|' || c.auth_generation);
  RETURN true;
END $$;
CREATE FUNCTION pg_temp.finish(name text, src uuid, result jsonb DEFAULT '{"health":"ok"}') RETURNS text LANGUAGE sql AS $$
  SELECT public.google_sheets_finish(src, split_part(pg_temp.get(name || '.src.' || src), '|', 1)::uuid,
    split_part(pg_temp.get(name || '.src.' || src), '|', 2)::int, split_part(pg_temp.get(name || '.src.' || src), '|', 3)::bigint, 'push', result) $$;
CREATE FUNCTION pg_temp.complete(name text, edge text DEFAULT 'done', reason text DEFAULT '') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.google_sheets_push_complete(pg_temp.get(name || '.target')::uuid, pg_temp.get(name || '.lease')::uuid,
    jsonb_build_object('outcome', edge, 'reason', reason, 'imported', 0, 'google_requests', 4, 'first_commit_at', clock_timestamp())) $$;
CREATE FUNCTION pg_temp.mode(m text, cap int DEFAULT 4) RETURNS void LANGUAGE sql AS $$
  UPDATE private.google_sheets_push_config SET mode = m, max_concurrent_jobs = cap $$;
-- Simulates lease expiry: job leases and any source lease a deliberately unfinished run left behind.
CREATE FUNCTION pg_temp.clear_leases() RETURNS void LANGUAGE sql AS $$
  UPDATE private.google_sheets_watch_targets SET lease_owner = NULL, lease_expires_at = NULL, lease_snapshot = NULL, lease_attempt = NULL,
    next_attempt_at = CASE WHEN requested_seq > processed_seq THEN now() END, attempts = 0, stale_streak = 0;
  UPDATE public.google_sheets_sources SET lease_owner = NULL, lease_expires_at = NULL WHERE lease_owner IS NOT NULL $$;

SELECT pg_temp.connect(pg_temp.id('a1')), pg_temp.connect(pg_temp.id('a2')), pg_temp.connect(pg_temp.id('b1'));
SELECT pg_temp.put('sA1', pg_temp.source(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A', 1)::text),
       pg_temp.put('sA2', pg_temp.source(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A', 2)::text),   -- second tab, same spreadsheet
       pg_temp.put('sA3', pg_temp.source(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A2', 1)::text),  -- second spreadsheet, same connection
       pg_temp.put('sX1', pg_temp.source(pg_temp.id('a2'), 'SPREADSHEET_PUSH_A', 1)::text),   -- same spreadsheet, another agent
       pg_temp.put('sB1', pg_temp.source(pg_temp.id('b1'), 'SPREADSHEET_PUSH_B', 1)::text);   -- another agency

-- ================================================================ P1 ACL, RLS, inventory, defaults
DO $$
DECLARE fn regprocedure; n int := 0; t text;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
             WHERE ns.nspname IN ('public','private') AND p.proname LIKE 'google\_sheets\_%' LOOP
    PERFORM pg_temp.ok(NOT has_function_privilege('anon', fn, 'EXECUTE'), 'anon EXECUTE ' || fn);
    PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', fn, 'EXECUTE'), 'authenticated EXECUTE ' || fn);
    PERFORM pg_temp.ok(NOT has_function_privilege('public', fn, 'EXECUTE'), 'PUBLIC EXECUTE ' || fn);
    PERFORM pg_temp.ok(has_function_privilege('service_role', fn, 'EXECUTE') =
      ((SELECT ns2.nspname FROM pg_proc p2 JOIN pg_namespace ns2 ON ns2.oid = p2.pronamespace WHERE p2.oid = fn) = 'public'),
      'service_role EXECUTE only on public wrappers: ' || fn);
    PERFORM pg_temp.ok((SELECT p.proconfig IS NOT NULL AND (p.prosecdef OR p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql'))
                          FROM pg_proc p WHERE p.oid = fn), 'definer + pinned search_path ' || fn);
    n := n + 1;
  END LOOP;
  PERFORM pg_temp.ok(n = 75, 'function count ' || n || ' (44 private + 31 public)');
  FOREACH t IN ARRAY ARRAY['google_sheets_push_config','google_sheets_push_pilot_sources','google_sheets_watch_targets',
                           'google_sheets_watch_channels','google_sheets_push_events','google_sheets_push_attempts'] LOOP
    PERFORM pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = ('private.' || t)::regclass), 'RLS enabled ' || t);
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'private' AND tablename = t), 'no policy ' || t);
    PERFORM pg_temp.ok(NOT has_table_privilege('service_role', 'private.' || t, 'SELECT'), 'service_role cannot read ' || t);
    PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'private.' || t, 'SELECT'), 'authenticated cannot read ' || t);
    PERFORM pg_temp.ok(NOT has_table_privilege('anon', 'private.' || t, 'SELECT'), 'anon cannot read ' || t);
  END LOOP;
  PERFORM pg_temp.ok((SELECT mode = 'off' AND max_concurrent_jobs = 4 AND renew_before_s = 10800 AND renew_overlap_s = 900
                             AND late_grace_s = 3600 FROM private.google_sheets_push_config),
                     'seeded mode off, cap 4, renew window 3 h, overlap 900 s, late-delivery grace 3600 s');
  PERFORM pg_temp.ok((SELECT indisunique FROM pg_index WHERE indexrelid = 'private.google_sheets_push_events_dedupe_idx'::regclass),
                     'one authenticated event per (channel, message number) is a UNIQUE index');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'private.google_sheets_watch_channels'::regclass
                                  AND a.attname IN ('token','channel_token') AND NOT a.attisdropped), 'no token column (digest only)');
  RAISE NOTICE 'PASS P1 ACL/RLS (% functions)', n;
END $$;

-- ================================================================ P2 server-side scope: off refuses, pilot admits only the allowlist
DO $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM pg_temp.wbegin(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A', 1);
  PERFORM pg_temp.ok(b.outcome = 'disabled', 'mode off: registration refused (' || b.outcome || ')');
  PERFORM pg_temp.ok(public.google_sheets_push_kick(pg_temp.id('a1'), pg_temp.id('orgA'), pg_temp.get('sA1')::uuid, 'activate') IS NULL, 'mode off: kick refused');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.google_sheets_push_claim(gen_random_uuid(), NULL, 60, 'receiver')), 'mode off: claim refused');
  PERFORM pg_temp.ok(public.google_sheets_push_status(pg_temp.id('a1'), pg_temp.id('orgA')) = '{"mode":"off","sources":{}}'::jsonb, 'mode off: no status');
  PERFORM pg_temp.ok(NOT private.google_sheets_push_maintenance_due(), 'mode off and nothing to stop: cron guard false');

  PERFORM pg_temp.mode('pilot');
  INSERT INTO private.google_sheets_push_pilot_sources VALUES (pg_temp.get('sA1')::uuid, pg_temp.id('orgA'));
  SELECT * INTO b FROM pg_temp.wbegin(pg_temp.id('b1'), 'SPREADSHEET_PUSH_B', 90);
  PERFORM pg_temp.ok(b.outcome = 'no_sources', 'pilot: a non-allowlisted spreadsheet is refused (' || b.outcome || ')');
  PERFORM pg_temp.ok(public.google_sheets_push_kick(pg_temp.id('b1'), pg_temp.id('orgB'), pg_temp.get('sB1')::uuid, 'activate') IS NULL, 'pilot: kick refused');
  PERFORM pg_temp.ok(private.google_sheets_push_source_allowed(pg_temp.get('sA1')::uuid)
                     AND NOT private.google_sheets_push_source_allowed(pg_temp.get('sA2')::uuid), 'pilot allowlist exact');
  PERFORM pg_temp.ok(private.google_sheets_push_maintenance_due(), 'pilot: the allowlisted spreadsheet needs a channel → guard true');
  PERFORM pg_temp.ok(public.google_sheets_push_status(pg_temp.id('a1'), pg_temp.id('orgA'))->'sources' ?& ARRAY[pg_temp.get('sA1')]
                     AND NOT (public.google_sheets_push_status(pg_temp.id('a1'), pg_temp.id('orgA'))->'sources' ? pg_temp.get('sA2')),
                     'pilot status lists only the allowlisted source');
  RAISE NOTICE 'PASS P2 server-side scope (off / pilot allowlist)';
END $$;

-- ================================================================ P3 registration; a sync before the watch response
DO $$
DECLARE b record; r jsonb; t private.google_sheets_watch_targets;
BEGIN
  SELECT * INTO b FROM pg_temp.wbegin(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A', 1);
  PERFORM pg_temp.ok(b.outcome = 'register', 'register ' || b.outcome);
  PERFORM pg_temp.ok((SELECT outcome FROM pg_temp.wbegin(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A', 2)) = 'in_progress', 'one registration in flight per target');
  PERFORM pg_temp.ok((pg_temp.chan(1)).state = 'registering' AND (pg_temp.chan(1)).token_digest = decode(pg_temp.hex(pg_temp.tok(1)), 'hex'),
                     'registering channel holds the token digest');
  -- Google's sync arrives BEFORE the watch response: accepted, resource id remembered, no job.
  PERFORM pg_temp.ok(pg_temp.o(1, 'sync', 1) = 'sync', 'sync before the watch response');
  PERFORM pg_temp.ok((pg_temp.chan(1)).observed_resource_id = 'RES-1' AND (pg_temp.chan(1)).sync_received_at IS NOT NULL, 'observed resource id');
  PERFORM pg_temp.ok(pg_temp.o(1, 'update', 2, NULL, 'RES-OTHER') = 'rejected_resource', 'another resource id is rejected');
  -- The watch response must name the same resource; a mismatch is stopped, never activated.
  r := public.google_sheets_watch_result(b.channel_row_id, 'activated', 'RES-MISMATCH', now() + interval '1 day', NULL);
  PERFORM pg_temp.ok(r->>'status' = 'resource_mismatch' AND jsonb_array_length(r->'stop') = 1 AND (pg_temp.chan(1)).state = 'stopping',
                     'resource mismatch → stopping ' || r::text);
  r := public.google_sheets_watch_result(b.channel_row_id, 'stopped', NULL, NULL, NULL);
  r := pg_temp.watch(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A', 2);
  PERFORM pg_temp.ok(r->>'status' = 'activated' AND (r->>'kicked')::boolean, 'fresh activation queues one catch-up ' || r::text);
  t := pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A');
  PERFORM pg_temp.ok(t.requested_seq = 1 AND t.processed_seq = 0 AND t.state = 'live', 'catch-up job queued');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM private.google_sheets_push_events WHERE target_id = t.id AND outcome = 'catch_up' AND job_seq = 1),
                     'catch-up event recorded');
  PERFORM pg_temp.ok((SELECT outcome FROM pg_temp.wbegin(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A', 3)) = 'exists', 'a live channel → exists');
  PERFORM pg_temp.ok((pg_temp.chan(2)).expires_at > now() + interval '22 hours' AND (pg_temp.chan(2)).resource_id = 'RES-2', 'Google expiration stored');
  RAISE NOTICE 'PASS P3 registration, sync-before-response, resource check';
END $$;

-- ================================================================ P4 receiver validation matrix (one transaction per notification)
SELECT pg_temp.ok(pg_temp.o(2, 'update', 10) = 'queued', 'valid update → queued');
SELECT pg_temp.ok((pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).requested_seq = 2, 'requested_seq += 1');
SELECT pg_temp.ok(pg_temp.o(2, 'update', 10) = 'duplicate', 'redelivered message → duplicate');
SELECT pg_temp.ok((pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).requested_seq = 2, 'duplicate does not bump');
SELECT pg_temp.ok(pg_temp.o(2, 'update', 11, 'forged-token-' || repeat('y', 30)) = 'rejected_token', 'wrong token → rejected');
SELECT pg_temp.ok(pg_temp.o(2, 'update', 11) = 'queued', 'a forged message cannot suppress the genuine message with its number');
SELECT pg_temp.ok(pg_temp.o(2, 'update', 12, NULL, 'RES-1') = 'rejected_resource', 'resource id mismatch → rejected');
SELECT pg_temp.ok(pg_temp.o(2, 'update', 5) = 'queued', 'out-of-order (lower) message number still queued');
SELECT pg_temp.ok(pg_temp.o(2, 'sync', 1) = 'sync', 'sync → no job');
SELECT pg_temp.ok(pg_temp.o(2, 'trash', 13) = 'queued' AND pg_temp.o(2, 'some_new_state', 14) = 'queued', 'trash / unknown states → queued (read is idempotent)');
SELECT pg_temp.ok(pg_temp.o(999, 'update', 1) = 'unknown_channel', 'unknown channel');
SELECT pg_temp.ok((SELECT outcome FROM public.google_sheets_push_accept('not-a-channel', pg_temp.hex('x'), 'R', 'update', 1, '', now())) = 'invalid', 'bad channel id → invalid');
SELECT pg_temp.ok((SELECT outcome FROM public.google_sheets_push_accept(pg_temp.ch(2), 'zz', 'R', 'update', 1, '', now())) = 'invalid', 'bad digest → invalid');
SELECT pg_temp.ok((SELECT outcome FROM public.google_sheets_push_accept(pg_temp.ch(2), pg_temp.hex(pg_temp.tok(2)), 'R E S', 'update', 1, '', now())) = 'invalid', 'bad resource → invalid');
SELECT pg_temp.ok((SELECT outcome FROM public.google_sheets_push_accept(pg_temp.ch(2), pg_temp.hex(pg_temp.tok(2)), 'RES-2', 'update', -1, '', now())) = 'invalid', 'negative number → invalid');
DO $$
DECLARE t private.google_sheets_watch_targets := pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A');
BEGIN
  PERFORM pg_temp.ok(t.requested_seq = 6, 'six authenticated, non-duplicate jobs queued (1 catch-up + 5 notifications): ' || t.requested_seq);
  PERFORM pg_temp.ok((SELECT count(*) FROM private.google_sheets_push_events WHERE target_id = t.id AND NOT authenticated) = 2,
                     'rejections sampled per channel per minute: channel 1 resource, channel 2 token (its resource rejection in the same minute not recorded)');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM private.google_sheets_push_events WHERE target_id = t.id AND outcome = 'duplicate'),
                     'a redelivery writes no row');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM private.google_sheets_push_events WHERE organization_id <> pg_temp.id('orgA') AND target_id = t.id),
                     'events carry the channel owner''s organization');
  RAISE NOTICE 'PASS P4 receiver validation matrix';
END $$;

-- ================================================================ P5 cross-agency isolation (org B channel, org A token, swapped ids)
SELECT pg_temp.mode('on');
SELECT pg_temp.watch(pg_temp.id('b1'), 'SPREADSHEET_PUSH_B', 20);
SELECT pg_temp.ok(pg_temp.o(20, 'update', 1, pg_temp.tok(2)) = 'rejected_token', 'org A token on org B channel → rejected');
SELECT pg_temp.ok(pg_temp.o(20, 'update', 2, NULL, 'RES-2') = 'rejected_resource', 'org A resource on org B channel → rejected');
SELECT pg_temp.ok(pg_temp.o(20, 'update', 3) = 'queued', 'org B genuine notification');
DO $$
DECLARE tb private.google_sheets_watch_targets := pg_temp.target(pg_temp.id('b1'), 'SPREADSHEET_PUSH_B');
        ta private.google_sheets_watch_targets := pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A');
BEGIN
  PERFORM pg_temp.ok(tb.organization_id = pg_temp.id('orgB') AND tb.user_id = pg_temp.id('b1'), 'org B target owned by org B');
  PERFORM pg_temp.ok(ta.requested_seq = 6, 'org A target untouched by org B traffic');
  PERFORM pg_temp.ok(NOT (public.google_sheets_push_status(pg_temp.id('a1'), pg_temp.id('orgA'))->'sources' ? pg_temp.get('sB1')),
                     'status never lists another agency''s source');
  PERFORM pg_temp.ok(public.google_sheets_push_status(pg_temp.id('b1'), pg_temp.id('orgA'))->'sources' = '{}'::jsonb,
                     'status for a user under the wrong org is empty');
  RAISE NOTICE 'PASS P5 cross-agency isolation';
END $$;

-- ================================================================ P6 claim → per-source push claim → finish(push) → SQL-verified done
SELECT pg_temp.clear_leases();
SELECT pg_temp.ok(pg_temp.claim('j1', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).id), 'claim target A');
SELECT pg_temp.ok(pg_temp.get('j1.snapshot') = '6'
                  AND string_to_array(pg_temp.get('j1.sources'), ',')::uuid[] @> ARRAY[pg_temp.get('sA1')::uuid, pg_temp.get('sA2')::uuid]
                  AND cardinality(string_to_array(pg_temp.get('j1.sources'), ',')) = 2,
                  'snapshot 6; exactly both enabled tabs of this spreadsheet: ' || pg_temp.get('j1.sources'));
SELECT pg_temp.ok(NOT pg_temp.claim('jx', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).id), 'a leased target cannot be claimed twice');
-- (requirement 2) Edge says done but no tab finished in this attempt → the database refuses 'done'
SELECT pg_temp.ok(pg_temp.complete('j1', 'done')->>'outcome' = 'retry', 'done refused while tabs are unfinished');
SELECT pg_temp.ok((pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).processed_seq = 0
                  AND (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).last_error_code = 'unfinished_source', 'processed_seq unchanged');
SELECT pg_temp.clear_leases();
SELECT pg_temp.ok(pg_temp.claim('j2', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).id), 'claim again');
SELECT pg_temp.ok(pg_temp.claim_source('j2', pg_temp.get('sA1')::uuid) AND pg_temp.claim_source('j2', pg_temp.get('sA2')::uuid), 'push-claim both tabs');
-- a notification arriving DURING processing
SELECT pg_temp.ok((SELECT outcome = 'queued' AND NOT process FROM pg_temp.notify(2, 'update', 30)), 'mid-run notification queued, not processed');
SELECT pg_temp.ok(pg_temp.finish('j2', pg_temp.get('sA1')::uuid) = 'completed', 'finish tab 1 (push)');
-- one tab finished, the other not → still not done
SELECT pg_temp.ok(pg_temp.complete('j2', 'done')->>'outcome' = 'retry', 'one unfinished tab keeps the job queued');
SELECT pg_temp.clear_leases();
SELECT pg_temp.ok(pg_temp.claim('j3', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).id) AND pg_temp.get('j3.snapshot') = '7', 'claim snapshot 7');
SELECT pg_temp.ok(pg_temp.claim_source('j3', pg_temp.get('sA1')::uuid) AND pg_temp.claim_source('j3', pg_temp.get('sA2')::uuid), 'push-claim both tabs');
SELECT pg_temp.ok(pg_temp.o(2, 'update', 31) = 'queued', 'another mid-run notification (seq 8)');
SELECT pg_temp.ok(pg_temp.finish('j3', pg_temp.get('sA1')::uuid) = 'completed' AND pg_temp.finish('j3', pg_temp.get('sA2')::uuid) = 'completed', 'finish both');
SELECT pg_temp.put('j3.done', pg_temp.complete('j3', 'done')::text);
DO $$
DECLARE r jsonb := pg_temp.get('j3.done')::jsonb; t private.google_sheets_watch_targets := pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A');
BEGIN
  PERFORM pg_temp.ok(r->>'outcome' = 'done' AND (r->>'dirty')::boolean, 'done, and dirty because of the mid-run notification ' || r::text);
  PERFORM pg_temp.ok(t.processed_seq = 7 AND t.requested_seq = 8 AND t.next_attempt_at <= clock_timestamp(), 'processed to the snapshot only; follow-up due now');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.google_sheets_sync_runs WHERE trigger = 'push') = 3, 'push runs recorded with trigger push');
  PERFORM pg_temp.ok((SELECT outcome = 'done' AND finished_at IS NOT NULL AND google_requests = 4 AND first_commit_at IS NOT NULL
                        FROM private.google_sheets_push_attempts WHERE target_id = t.id ORDER BY started_at DESC LIMIT 1), 'attempt telemetry');
  RAISE NOTICE 'PASS P6 claim / push claim / finish / SQL-verified done / mid-run notification';
END $$;
SELECT pg_temp.ok(pg_temp.claim('j4', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).id) AND pg_temp.get('j4.snapshot') = '8', 'follow-up claim');
SELECT pg_temp.ok(pg_temp.claim_source('j4', pg_temp.get('sA1')::uuid) AND pg_temp.claim_source('j4', pg_temp.get('sA2')::uuid), 'push-claim');
-- backlog on one tab → not done
SELECT pg_temp.ok(pg_temp.finish('j4', pg_temp.get('sA1')::uuid, '{"health":"ok","backlog":true}') = 'completed' AND pg_temp.finish('j4', pg_temp.get('sA2')::uuid) = 'completed', 'finish (tab 1 backlog)');
SELECT pg_temp.ok((SELECT (last_result->>'backlog')::boolean FROM public.google_sheets_sources WHERE id = pg_temp.get('sA1')::uuid), 'finish records backlog');
SELECT pg_temp.ok(pg_temp.complete('j4', 'done')->>'outcome' = 'backlog', 'backlog keeps the job due');
SELECT pg_temp.ok((pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).processed_seq = 7, 'still unprocessed');
SELECT pg_temp.ok(pg_temp.claim('j5', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).id), 'backlog continuation claim');
SELECT pg_temp.ok(pg_temp.claim_source('j5', pg_temp.get('sA1')::uuid) AND pg_temp.claim_source('j5', pg_temp.get('sA2')::uuid), 'push-claim');
-- health error on a tab → not done (unresolved retry)
SELECT pg_temp.ok(pg_temp.finish('j5', pg_temp.get('sA1')::uuid, '{"health":"error","error_code":"run_failed"}') = 'completed' AND pg_temp.finish('j5', pg_temp.get('sA2')::uuid) = 'completed', 'finish (tab 1 error)');
SELECT pg_temp.ok(pg_temp.complete('j5', 'done')->>'outcome' = 'retry', 'a failed tab keeps the job queued');
SELECT pg_temp.ok((SELECT attempts = 1 AND next_attempt_at > clock_timestamp() + interval '20 seconds' FROM pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')), 'transient backoff ≥ 24 s');
SELECT pg_temp.clear_leases();
SELECT pg_temp.ok(pg_temp.claim('j6', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).id), 'retry claim');
SELECT pg_temp.ok(pg_temp.claim_source('j6', pg_temp.get('sA1')::uuid) AND pg_temp.claim_source('j6', pg_temp.get('sA2')::uuid), 'push-claim (health error is still eligible)');
SELECT pg_temp.ok(pg_temp.finish('j6', pg_temp.get('sA1')::uuid) = 'completed' AND pg_temp.finish('j6', pg_temp.get('sA2')::uuid) = 'completed', 'finish ok');
-- the Edge outcome can only make the result STRICTER
SELECT pg_temp.ok(pg_temp.complete('j6', 'retry', 'busy')->>'outcome' = 'retry', 'edge retry is never upgraded to done');
SELECT pg_temp.ok((SELECT attempts = 0 AND next_attempt_at < clock_timestamp() + interval '15 seconds' FROM pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')),
                  'busy: short retry, attempts unchanged (clear_leases reset them to 0)');
SELECT pg_temp.ok(pg_temp.complete('j6', 'done')->>'status' = 'not_owner', 'a released lease cannot complete again');

-- ================================================================ P7 authorised push claim of a source
SELECT pg_temp.clear_leases();
SELECT pg_temp.ok(pg_temp.claim('k1', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).id), 'claim A');
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    PERFORM * FROM public.google_sheets_push_claim_source(pg_temp.get('k1.target')::uuid, gen_random_uuid(), pg_temp.get('sA1')::uuid, gen_random_uuid());
    ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'stale: job lease lost%';
  END;
  PERFORM pg_temp.ok(ok, 'a wrong job lease is refused');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.google_sheets_push_claim_source(pg_temp.get('k1.target')::uuid, pg_temp.get('k1.lease')::uuid,
                       pg_temp.get('sB1')::uuid, gen_random_uuid())), 'another agency''s source is never claimable through this target');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.google_sheets_push_claim_source(pg_temp.get('k1.target')::uuid, pg_temp.get('k1.lease')::uuid,
                       pg_temp.get('sX1')::uuid, gen_random_uuid())), 'another agent''s source on the same spreadsheet is not claimable');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.google_sheets_push_claim_source(pg_temp.get('k1.target')::uuid, pg_temp.get('k1.lease')::uuid,
                       pg_temp.get('sA3')::uuid, gen_random_uuid())), 'the same agent''s other spreadsheet is not claimable');
  RAISE NOTICE 'PASS P7a push claim is bound to the job lease and the target';
END $$;
-- a Sync now holding the source lease blocks the push claim (and vice versa); no 30-second cooldown for push
SELECT pg_temp.ok((SELECT source_id IS NOT NULL FROM public.google_sheets_claim(gen_random_uuid(), 1, pg_temp.get('sA1')::uuid, pg_temp.id('a1'), pg_temp.id('orgA'))
                     WHERE true UNION ALL SELECT false LIMIT 1) OR true, 'manual claim attempted');
UPDATE public.google_sheets_sources SET last_checked_at = NULL WHERE id = pg_temp.get('sA2')::uuid;
SELECT pg_temp.put('manual.lease', gen_random_uuid()::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.google_sheets_claim(pg_temp.get('manual.lease')::uuid, 1, pg_temp.get('sA2')::uuid, pg_temp.id('a1'), pg_temp.id('orgA'))) = 1, 'Sync now holds tab 2');
SELECT pg_temp.ok(NOT pg_temp.claim_source('k1', pg_temp.get('sA2')::uuid), 'push cannot claim a tab Sync now holds');
UPDATE public.google_sheets_sources SET lease_owner = NULL, lease_expires_at = NULL, last_checked_at = clock_timestamp() WHERE id = pg_temp.get('sA2')::uuid;
SELECT pg_temp.ok(pg_temp.claim_source('k1', pg_temp.get('sA2')::uuid), 'push claim right after a check: no manual cooldown');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.google_sheets_claim(gen_random_uuid(), 1, pg_temp.get('sA2')::uuid, pg_temp.id('a1'), pg_temp.id('orgA'))),
                  'Sync now cannot claim a tab push holds');
SELECT public.google_sheets_set_state(pg_temp.id('a1'), pg_temp.id('orgA'), pg_temp.get('sA3')::uuid, 'pause');
DO $$
BEGIN
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.google_sheets_sources WHERE id = pg_temp.get('sA3')::uuid AND state = 'enabled'), 'sA3 paused');
  RAISE NOTICE 'PASS P7b Sync now and push share the source lease; push skips the manual cooldown only';
END $$;
SELECT pg_temp.complete('k1', 'retry', 'busy');

-- ================================================================ P8 lease recovery (worker crash), concurrency cap, per-connection serialisation
SELECT pg_temp.clear_leases();
SELECT pg_temp.ok(pg_temp.claim('c1', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).id, 1), 'claim with a 1 s lease (the worker then dies)');
SELECT pg_sleep(1.2);
SELECT pg_temp.ok(pg_temp.claim('c2', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).id), 'expired lease → reclaimed by the next worker');
SELECT pg_temp.ok(pg_temp.complete('c1', 'done')->>'status' = 'not_owner', 'the crashed worker cannot complete');
SELECT pg_temp.ok((pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).processed_seq = 7, 'nothing marked processed by the crash');
SELECT pg_temp.complete('c2', 'retry', 'busy');
SELECT pg_temp.clear_leases();
SELECT pg_temp.ok(pg_temp.o(20, 'update', 9) = 'queued', 'org B work queued');
SELECT pg_temp.mode('on', 1);
SELECT pg_temp.ok(pg_temp.claim('cap1', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).id), 'first job');
SELECT pg_temp.ok(NOT pg_temp.claim('cap2', NULL), 'cap 1: a second concurrent job is refused');
SELECT pg_temp.mode('on', 4);
SELECT pg_temp.ok(pg_temp.claim('cap3', NULL) AND pg_temp.get('cap3.target') = ((pg_temp.target(pg_temp.id('b1'), 'SPREADSHEET_PUSH_B')).id)::text,
                  'cap 4: the next due job (org B) is claimed');
SELECT public.google_sheets_set_state(pg_temp.id('a1'), pg_temp.id('orgA'), pg_temp.get('sA3')::uuid, 'resume');
SELECT pg_temp.ok(public.google_sheets_push_kick(pg_temp.id('a1'), pg_temp.id('orgA'), pg_temp.get('sA3')::uuid, 'resume') IS NOT NULL, 'kick a1''s second spreadsheet');
SELECT pg_temp.ok(NOT pg_temp.claim('ser', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A2')).id), 'same Google user: serialised while another job of the connection runs');
SELECT pg_temp.complete('cap1', 'retry', 'busy'), pg_temp.complete('cap3', 'retry', 'busy');
SELECT pg_temp.clear_leases();
SELECT pg_temp.ok(pg_temp.claim('ser2', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A2')).id), 'claimable once the connection is free');
SELECT pg_temp.complete('ser2', 'retry', 'busy');
DO $$ BEGIN RAISE NOTICE 'PASS P8 crash recovery, concurrency cap, per-connection serialisation'; END $$;

-- ================================================================ P9 kick (event-driven catch-up) rules
DO $$
DECLARE ok boolean; seq bigint := (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).requested_seq;
BEGIN
  PERFORM pg_temp.ok(public.google_sheets_push_kick(pg_temp.id('a1'), pg_temp.id('orgA'), pg_temp.get('sA1')::uuid, 'save') IS NOT NULL, 'kick');
  PERFORM pg_temp.ok((pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).requested_seq = seq + 1, 'kick bumps the target once');
  PERFORM pg_temp.ok(public.google_sheets_push_kick(pg_temp.id('a2'), pg_temp.id('orgA'), pg_temp.get('sA1')::uuid, 'save') IS NULL, 'not the owner → nothing');
  BEGIN
    PERFORM public.google_sheets_push_kick(pg_temp.id('a1'), pg_temp.id('orgA'), pg_temp.get('sA1')::uuid, 'every_minute');
    ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '22023';
  END;
  PERFORM pg_temp.ok(ok, 'only listed owner actions can kick');
  UPDATE public.profiles SET status = 'Deleted' WHERE id = pg_temp.id('a2');
  BEGIN
    PERFORM public.google_sheets_push_kick(pg_temp.id('a2'), pg_temp.id('orgA'), pg_temp.get('sX1')::uuid, 'save');
    ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'not_permitted%';
  END;
  PERFORM pg_temp.ok(ok, 'an ineligible owner cannot kick');
  UPDATE public.profiles SET status = 'Active' WHERE id = pg_temp.id('a2');
  RAISE NOTICE 'PASS P9 kick rules';
END $$;

-- ================================================================ P10 renewal overlap, reconnect generation, stop
UPDATE private.google_sheets_watch_channels SET expires_at = now() + interval '1 hour' WHERE channel_id = pg_temp.ch(2);  -- inside the renew window
SELECT pg_temp.put('renew', pg_temp.watch(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A', 3, 'renew')::text);
DO $$
DECLARE r jsonb := pg_temp.get('renew')::jsonb;
BEGIN
  PERFORM pg_temp.ok(r->>'status' = 'activated' AND NOT (r->>'kicked')::boolean, 'renewal: no catch-up (overlap, no gap) ' || r::text);
  PERFORM pg_temp.ok(jsonb_array_length(r->'stop') = 0, 'renewal keeps the superseded channel for the overlap (no immediate stop)');
  PERFORM pg_temp.ok((pg_temp.chan(2)).state = 'stopping' AND (pg_temp.chan(2)).last_error_code = 'superseded'
                     AND (pg_temp.chan(3)).state = 'active', 'old stopping (superseded), new active');
  RAISE NOTICE 'PASS P10a renewal overlap';
END $$;
SELECT pg_temp.ok(pg_temp.o(2, 'update', 40) = 'queued' AND pg_temp.o(3, 'update', 2) = 'queued', 'both overlapping channels accepted (coalesced by seq)');
SELECT public.google_sheets_watch_result((pg_temp.chan(2)).id, 'stopped', NULL, NULL, NULL);
SELECT pg_temp.ok(pg_temp.o(2, 'update', 41) = 'queued' AND pg_temp.reason(2, 41) = 'late_delivery',
                  'a confirmed channel stopped moments ago: a late delivery within the grace is queued');
UPDATE private.google_sheets_watch_channels SET expires_at = now() - interval '2 hours' WHERE channel_id = pg_temp.ch(20);
SELECT pg_temp.ok(pg_temp.o(20, 'update', 50) = 'ignored_inactive', 'a channel expired beyond the grace is acknowledged, no job');
-- reconnect: the generation moves; the old channel's notifications are ignored; maintenance re-registers with a catch-up
SELECT pg_temp.connect(pg_temp.id('a1'));
SELECT pg_temp.ok(pg_temp.o(3, 'update', 3) = 'ignored_stale', 'old-generation channel → ignored_stale');
SELECT pg_temp.put('m1', public.google_sheets_push_maintenance_claim(gen_random_uuid(), 50, pg_temp.key())::text);
DO $$
DECLARE m jsonb := pg_temp.get('m1')::jsonb;
BEGIN
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(m->'items') i
                              WHERE i->>'kind' = 'register' AND i->>'spreadsheet_id' = 'SPREADSHEET_PUSH_A' AND i->>'reason' = 'reconnect'
                                AND (i->>'generation')::bigint = pg_temp.gen(pg_temp.id('a1'))), 'maintenance: reconnect registration ' || m::text);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(m->'items') i
                                  WHERE i->>'kind' = 'stop' AND i->>'channel_id' = pg_temp.ch(20)), 'an expired channel needs no stop call');
  PERFORM pg_temp.ok((pg_temp.chan(20)).state = 'stopped' AND (pg_temp.chan(20)).last_error_code = 'expired', 'expired active → stopped');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                       public.google_sheets_push_maintenance_claim(gen_random_uuid(), 50, pg_temp.key())->'items') i
                       WHERE i->>'kind' = 'register' AND i->>'spreadsheet_id' = 'SPREADSHEET_PUSH_A'),
                     'a second maintenance pass does not re-issue the same registration (maintenance lease)');
  RAISE NOTICE 'PASS P10b reconnect generation + maintenance registration';
END $$;
UPDATE private.google_sheets_watch_targets SET maint_lease_owner = NULL, maint_lease_expires_at = NULL;
SELECT pg_temp.put('rec', pg_temp.watch(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A', 4, 'reconnect')::text);
SELECT pg_temp.ok((pg_temp.get('rec')::jsonb->>'kicked')::boolean AND (pg_temp.chan(3)).state = 'stopping',
                  'reconnect registration is fresh (catch-up) and stops the old-generation channel');
SELECT pg_temp.ok(pg_temp.o(4, 'update', 2) = 'queued', 'new channel works');

-- ================================================================ P11 pause / remove / disconnect release; maintenance hygiene; cron guard
SELECT public.google_sheets_set_state(pg_temp.id('a1'), pg_temp.id('orgA'), pg_temp.get('sA2')::uuid, 'pause');
SELECT pg_temp.ok(jsonb_array_length(public.google_sheets_watch_release(pg_temp.id('a1'), pg_temp.id('orgA'), 'SPREADSHEET_PUSH_A', false)->'stop') = 0,
                  'another tab is still enabled: nothing released (the old stopping channel is maintenance''s)');
SELECT pg_temp.ok((pg_temp.chan(4)).state = 'active', 'tab 1 still enabled → monitoring kept');
SELECT public.google_sheets_set_state(pg_temp.id('a1'), pg_temp.id('orgA'), pg_temp.get('sA1')::uuid, 'pause');
SELECT pg_temp.ok(jsonb_array_length(public.google_sheets_watch_release(pg_temp.id('a1'), pg_temp.id('orgA'), 'SPREADSHEET_PUSH_A', false)->'stop') = 2,
                  'last tab paused → live channel stopping too');
SELECT pg_temp.ok((pg_temp.chan(4)).state = 'stopping' AND (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).state = 'stopped', 'target stopped');
SELECT pg_temp.ok(pg_temp.o(4, 'update', 3) = 'ignored_inactive', 'notification after Pause: acknowledged, no job');
SELECT pg_temp.clear_leases();
SELECT pg_temp.ok(pg_temp.claim('p1', (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).id) AND pg_temp.get('p1.sources') = '', 'queued work after Pause: claimable, no eligible tab');
SELECT pg_temp.ok(pg_temp.complete('p1', 'done')->>'outcome' = 'done', 'nothing to run → done (paused tabs re-read on Resume)');
SELECT public.google_sheets_set_state(pg_temp.id('a1'), pg_temp.id('orgA'), pg_temp.get('sA1')::uuid, 'resume');
SELECT pg_temp.ok(public.google_sheets_push_kick(pg_temp.id('a1'), pg_temp.id('orgA'), pg_temp.get('sA1')::uuid, 'resume') IS NOT NULL
                  AND (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).state = 'live', 'Resume: target live again + catch-up');
SELECT pg_temp.ok((SELECT outcome FROM pg_temp.wbegin(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A', 5, 'resume')) = 'register', 'Resume: a new channel can register');
-- removal of the only source of org B's spreadsheet
SELECT pg_temp.put('bspread', 'SPREADSHEET_PUSH_B');
SELECT public.google_sheets_set_state(pg_temp.id('b1'), pg_temp.id('orgB'), pg_temp.get('sB1')::uuid, 'remove');
SELECT pg_temp.put('rel', public.google_sheets_watch_release(pg_temp.id('b1'), pg_temp.id('orgB'), 'SPREADSHEET_PUSH_B', false)::text);
SELECT pg_temp.ok((pg_temp.target(pg_temp.id('b1'), 'SPREADSHEET_PUSH_B')).state = 'stopped', 'removed source → target stopped');
SELECT pg_temp.ok((SELECT count(*) FROM private.google_sheets_receipts WHERE source_id = pg_temp.get('sB1')::uuid) = 0, 'receipts untouched by removal');
-- disconnect (force): registering without a resource id is abandoned; others stopping
SELECT pg_temp.put('disc', public.google_sheets_watch_release(pg_temp.id('a1'), pg_temp.id('orgA'), NULL, true)::text);
DO $$
DECLARE r jsonb := pg_temp.get('disc')::jsonb;
BEGIN
  PERFORM pg_temp.ok((pg_temp.chan(5)).state = 'abandoned', 'registering channel without a resource id → abandoned');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w
                                  WHERE w.connection_id = pg_temp.conn(pg_temp.id('a1')) AND w.state IN ('active','registering')), 'no live channel after disconnect release');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM private.google_sheets_watch_targets x
                                  WHERE x.connection_id = pg_temp.conn(pg_temp.id('a1')) AND x.state = 'live'), 'every target of the connection stopped');
  RAISE NOTICE 'PASS P11a pause / remove / disconnect release';
END $$;
SELECT public.google_sheets_disconnect(pg_temp.id('a1'), pg_temp.id('orgA'));
SELECT pg_temp.ok(pg_temp.o(4, 'update', 4) IN ('ignored_inactive','ignored_stale'), 'notification after Disconnect: acknowledged, no job');
SELECT pg_temp.ok(public.google_sheets_push_kick(pg_temp.id('a1'), pg_temp.id('orgA'), pg_temp.get('sA1')::uuid, 'save') IS NULL, 'disconnected: no kick');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.google_sheets_push_claim(gen_random_uuid(), (pg_temp.target(pg_temp.id('a1'), 'SPREADSHEET_PUSH_A')).id, 60, 'receiver')),
                  'disconnected: queued work is not claimable');
DO $$
DECLARE m jsonb;
BEGIN
  UPDATE private.google_sheets_watch_channels SET state = 'active' WHERE channel_id = pg_temp.ch(4);  -- simulate a channel left live
  m := public.google_sheets_push_maintenance_claim(gen_random_uuid(), 50, pg_temp.key());
  PERFORM pg_temp.ok((pg_temp.chan(4)).state = 'abandoned' AND (pg_temp.chan(4)).last_error_code = 'no_credentials',
                     'maintenance abandons channels whose connection cannot authenticate');
  UPDATE private.google_sheets_watch_channels SET created_at = now() - interval '10 minutes'
   WHERE channel_id = pg_temp.ch(5);
  UPDATE private.google_sheets_push_events SET queued_at = now() - interval '15 days' WHERE channel_row_id = (pg_temp.chan(2)).id;
  m := public.google_sheets_push_maintenance_claim(gen_random_uuid(), 50, pg_temp.key());
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM private.google_sheets_push_events WHERE channel_row_id = (pg_temp.chan(2)).id), 'retention: events > 14 days removed');
  RAISE NOTICE 'PASS P11b maintenance hygiene + retention';
END $$;

-- ================================================================ P12 completion when blocked / deferred; cron guard truth table
SELECT pg_temp.connect(pg_temp.id('a2'));
SELECT pg_temp.watch(pg_temp.id('a2'), 'SPREADSHEET_PUSH_A', 60);
SELECT pg_temp.clear_leases();
SELECT pg_temp.ok(pg_temp.claim('b1', (pg_temp.target(pg_temp.id('a2'), 'SPREADSHEET_PUSH_A')).id), 'a2 catch-up claimed');
SELECT public.google_sheets_mark_reconnect(pg_temp.conn(pg_temp.id('a2')), pg_temp.gen(pg_temp.id('a2')), 'invalid_grant');
SELECT pg_temp.ok(pg_temp.complete('b1', 'blocked', 'reconnect')->>'outcome' = 'blocked', 'reconnect required → blocked');
SELECT pg_temp.ok((pg_temp.target(pg_temp.id('a2'), 'SPREADSHEET_PUSH_A')).processed_seq = 0, 'blocked keeps the work queued');
SELECT pg_temp.ok(NOT pg_temp.claim('b2', (pg_temp.target(pg_temp.id('a2'), 'SPREADSHEET_PUSH_A')).id), 'not claimable until reconnected');
SELECT pg_temp.connect(pg_temp.id('a2'));
SELECT pg_temp.ok(pg_temp.claim('b3', (pg_temp.target(pg_temp.id('a2'), 'SPREADSHEET_PUSH_A')).id), 'reconnected → the queued work resumes (no lost work)');
SELECT pg_temp.mode('off');
SELECT pg_temp.ok(pg_temp.complete('b3', 'done')->>'outcome' = 'deferred', 'kill switch mid-run → deferred, not done');
SELECT pg_temp.ok((pg_temp.target(pg_temp.id('a2'), 'SPREADSHEET_PUSH_A')).processed_seq = 0, 'deferred keeps the work queued');
SELECT pg_temp.ok(NOT private.google_sheets_push_maintenance_due() OR EXISTS (SELECT 1 FROM private.google_sheets_watch_channels
                    WHERE state = 'stopping' AND resource_id IS NOT NULL), 'mode off: the guard only fires for stops');
SELECT pg_temp.mode('on');
SELECT pg_temp.ok(private.google_sheets_push_maintenance_due(), 'mode on with queued work → guard true');
UPDATE private.google_sheets_watch_targets SET processed_seq = requested_seq, next_attempt_at = NULL;
UPDATE private.google_sheets_watch_channels SET state = 'stopped' WHERE state IN ('stopping','registering');
UPDATE private.google_sheets_watch_channels SET state = 'stopped' WHERE state = 'active' AND connection_id <> pg_temp.conn(pg_temp.id('a2'));
UPDATE public.google_sheets_sources SET state = 'paused' WHERE user_id <> pg_temp.id('a2');
UPDATE private.google_sheets_watch_channels SET auth_generation = pg_temp.gen(pg_temp.id('a2')) WHERE connection_id = pg_temp.conn(pg_temp.id('a2')) AND state = 'active';
SELECT pg_temp.ok(NOT private.google_sheets_push_maintenance_due(), 'nothing queued, every live spreadsheet watched → guard false (no polling)');
-- retention keeps pace: a row past its window alone makes the guard fire; one pass deletes it (housekeeping only)
INSERT INTO private.google_sheets_push_events (organization_id, user_id, target_id, authenticated, outcome, received_at, queued_at)
SELECT x.organization_id, x.user_id, x.id, true, 'catch_up', now() - interval '15 days', now() - interval '15 days'
  FROM private.google_sheets_watch_targets x WHERE x.connection_id = pg_temp.conn(pg_temp.id('a2')) LIMIT 1;
SELECT pg_temp.ok(private.google_sheets_push_maintenance_due(), 'an event past its 14-day retention → guard true');
SELECT public.google_sheets_push_maintenance_claim(gen_random_uuid(), 50, pg_temp.key());
SELECT pg_temp.ok(NOT private.google_sheets_push_maintenance_due(), 'one maintenance pass deletes it → guard false again');
INSERT INTO private.google_sheets_push_attempts (id, organization_id, user_id, target_id, worker, from_seq, snapshot_seq, started_at)
SELECT gen_random_uuid(), x.organization_id, x.user_id, x.id, 'maintenance', 0, 0, now() - interval '31 days'
  FROM private.google_sheets_watch_targets x WHERE x.connection_id = pg_temp.conn(pg_temp.id('a2')) LIMIT 1;
SELECT pg_temp.ok(private.google_sheets_push_maintenance_due(), 'an attempt past its 30-day retention → guard true');
SELECT public.google_sheets_push_maintenance_claim(gen_random_uuid(), 50, pg_temp.key());
SELECT pg_temp.ok(NOT private.google_sheets_push_maintenance_due()
                  AND NOT EXISTS (SELECT 1 FROM private.google_sheets_push_attempts WHERE started_at < now() - interval '30 days'),
                  'deleted → guard false again');
UPDATE private.google_sheets_watch_channels SET expires_at = now() + interval '1 hour' WHERE connection_id = pg_temp.conn(pg_temp.id('a2')) AND state = 'active';
SELECT pg_temp.ok(private.google_sheets_push_maintenance_due(), 'a channel inside the renew window → guard true (renewal only)');
DO $$ BEGIN RAISE NOTICE 'PASS P12 blocked / deferred / cron guard'; END $$;

-- ================================================================ P13 the guarded foundation changes
DO $$
DECLARE ok boolean; l uuid := gen_random_uuid(); c record;
BEGIN
  PERFORM pg_temp.ok(md5(pg_get_functiondef('private.google_sheets_finish(uuid,uuid,integer,bigint,text,jsonb)'::regprocedure))
                     <> 'f1cf66bea7de1d469e2ff03c57f1a414', 'finish was replaced');
  PERFORM pg_temp.ok(position($q$p_trigger NOT IN ('schedule','manual','activation','push')$q$ IN
                     pg_get_functiondef('private.google_sheets_finish(uuid,uuid,integer,bigint,text,jsonb)'::regprocedure)) > 0, 'push trigger accepted');
  BEGIN
    INSERT INTO public.google_sheets_sync_runs (organization_id, user_id, source_id, trigger)
    VALUES (pg_temp.id('orgA'), pg_temp.id('a2'), pg_temp.get('sX1')::uuid, 'bogus');
    ok := false;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  PERFORM pg_temp.ok(ok, 'sync_runs CHECK still rejects unknown triggers');
  BEGIN
    PERFORM public.google_sheets_finish(pg_temp.get('sX1')::uuid, l, 1, 1, 'bogus', '{}');
    ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '22023';
  END;
  PERFORM pg_temp.ok(ok, 'finish still rejects unknown triggers');
  RAISE NOTICE 'PASS P13 guarded foundation changes';
END $$;

-- ================================================================ P14 imports through the push path: ownership, receipts, no duplicates
UPDATE public.google_sheets_sources SET state = 'enabled' WHERE id = pg_temp.get('sX1')::uuid;
SELECT pg_temp.clear_leases();
SELECT pg_temp.ok(public.google_sheets_push_kick(pg_temp.id('a2'), pg_temp.id('orgA'), pg_temp.get('sX1')::uuid, 'save') IS NOT NULL, 'kick a2');
SELECT pg_temp.ok(pg_temp.claim('i1', (pg_temp.target(pg_temp.id('a2'), 'SPREADSHEET_PUSH_A')).id) AND pg_temp.claim_source('i1', pg_temp.get('sX1')::uuid), 'claim a2');
SELECT pg_temp.put('ing', public.google_sheets_ingest(pg_temp.get('sX1')::uuid, split_part(pg_temp.get('i1.src.' || pg_temp.get('sX1')), '|', 1)::uuid,
  split_part(pg_temp.get('i1.src.' || pg_temp.get('sX1')), '|', 2)::int, split_part(pg_temp.get('i1.src.' || pg_temp.get('sX1')), '|', 3)::bigint,
  '[{"k":"pos:2","n":2,"f":"fp-push-2","lead":{"first_name":"Push","last_name":"Lead","phone":"7025550111"}}]', '[]')::text);
SELECT pg_temp.ok(pg_temp.finish('i1', pg_temp.get('sX1')::uuid, '{"health":"ok","imported":1}') = 'completed', 'finish');
SELECT pg_temp.ok(pg_temp.complete('i1', 'done')->>'outcome' = 'done', 'done');
SELECT pg_temp.clear_leases();
SELECT pg_temp.ok(public.google_sheets_push_kick(pg_temp.id('a2'), pg_temp.id('orgA'), pg_temp.get('sX1')::uuid, 'save') IS NOT NULL, 'second kick (duplicate change)');
SELECT pg_temp.ok(pg_temp.claim('i2', (pg_temp.target(pg_temp.id('a2'), 'SPREADSHEET_PUSH_A')).id) AND pg_temp.claim_source('i2', pg_temp.get('sX1')::uuid), 'claim a2 again');
SELECT pg_temp.put('ing2', public.google_sheets_ingest(pg_temp.get('sX1')::uuid, split_part(pg_temp.get('i2.src.' || pg_temp.get('sX1')), '|', 1)::uuid,
  split_part(pg_temp.get('i2.src.' || pg_temp.get('sX1')), '|', 2)::int, split_part(pg_temp.get('i2.src.' || pg_temp.get('sX1')), '|', 3)::bigint,
  '[{"k":"pos:2","n":2,"f":"fp-push-2","lead":{"first_name":"Push","last_name":"Lead","phone":"7025550111"}}]', '[]')::text);
DO $$
DECLARE l record;
BEGIN
  PERFORM pg_temp.ok((pg_temp.get('ing')::jsonb->>'imported')::int = 1, 'push run imported the row');
  PERFORM pg_temp.ok(pg_temp.get('ing2')::jsonb->'rows'->0->>'o' = 'already', 'a repeated notification never re-imports (receipt)');
  SELECT * INTO l FROM public.leads WHERE phone = '7025550111';
  PERFORM pg_temp.ok((SELECT count(*) FROM public.leads WHERE phone = '7025550111') = 1, 'exactly one lead');
  PERFORM pg_temp.ok(l.organization_id = pg_temp.id('orgA') AND l.assigned_agent_id = pg_temp.id('a2') AND l.user_id = pg_temp.id('a2')
                     AND l.imported_by_user_id = pg_temp.id('a2'), 'lead owned by the connection owner, in the owner''s agency');
  RAISE NOTICE 'PASS P14 push imports: ownership + receipts (zero duplicates)';
END $$;

-- ================================================================ P15 bounded replays: duplicates, rejection floods, uniqueness
INSERT INTO public.profiles (id, organization_id, role, status)
VALUES ('a3000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-0000000000a1', 'Agent', 'Active');
INSERT INTO pg_temp.ids VALUES ('a3', 'a3000000-0000-0000-0000-000000000003');
SELECT pg_temp.mode('on');
SELECT pg_temp.connect(pg_temp.id('a3'));
SELECT pg_temp.put('sR1', pg_temp.source(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 1)::text);
SELECT pg_temp.ok((pg_temp.watch(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 70)->>'kicked')::boolean, 'fresh channel 70 queues a catch-up');
DO $$
DECLARE t private.google_sheets_watch_targets; ch private.google_sheets_watch_channels; e0 bigint; i int; ok boolean;
BEGIN
  PERFORM pg_temp.ok(pg_temp.o(70, 'update', 10) = 'queued', 'first delivery queued');
  t := pg_temp.target(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R'); ch := pg_temp.chan(70);
  e0 := (SELECT count(*) FROM private.google_sheets_push_events WHERE channel_row_id = ch.id);
  FOR i IN 1..50 LOOP PERFORM pg_temp.ok(pg_temp.o(70, 'update', 10) = 'duplicate', 'redelivery ' || i); END LOOP;
  PERFORM pg_temp.ok((SELECT count(*) FROM private.google_sheets_push_events WHERE channel_row_id = ch.id) = e0, '50 redeliveries write no row');
  PERFORM pg_temp.ok((pg_temp.target(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R')).requested_seq = t.requested_seq
                     AND (pg_temp.target(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R')).updated_at = t.updated_at,
                     '50 redeliveries queue no job and never touch the target row');
  BEGIN
    INSERT INTO private.google_sheets_push_events (organization_id, user_id, target_id, channel_row_id, message_number,
      authenticated, outcome, received_at)
    VALUES (ch.organization_id, ch.user_id, ch.target_id, ch.id, 10, true, 'queued', now());
    ok := false;
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  PERFORM pg_temp.ok(ok, 'the schema refuses a second authenticated row for (channel, message number)');
  -- 100 rejected requests in one minute: one sampled row, no job, nothing suppressed
  FOR i IN 1..50 LOOP
    PERFORM pg_temp.ok(pg_temp.o(70, 'update', 100 + i, 'forged-' || i || repeat('z', 30)) = 'rejected_token', 'wrong token ' || i);
  END LOOP;
  FOR i IN 1..50 LOOP
    PERFORM pg_temp.ok(pg_temp.o(70, 'update', 200 + i, NULL, 'RES-OTHER') = 'rejected_resource', 'resource mismatch ' || i);
  END LOOP;
  PERFORM pg_temp.ok((SELECT count(*) FROM private.google_sheets_push_events WHERE channel_row_id = ch.id AND NOT authenticated) = 1
                     AND (SELECT outcome FROM private.google_sheets_push_events WHERE channel_row_id = ch.id AND NOT authenticated) = 'rejected_token',
                     '100 rejections in one minute → one sampled row (the first)');
  PERFORM pg_temp.ok((pg_temp.target(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R')).requested_seq = t.requested_seq, 'rejections queue no job');
  UPDATE private.google_sheets_watch_channels SET last_rejected_at = now() - interval '61 seconds' WHERE id = ch.id;
  PERFORM pg_temp.ok(pg_temp.o(70, 'update', 300, NULL, 'RES-OTHER') = 'rejected_resource'
                     AND pg_temp.o(70, 'update', 301, NULL, 'RES-OTHER') = 'rejected_resource', 'next minute');
  PERFORM pg_temp.ok((SELECT count(*) FROM private.google_sheets_push_events WHERE channel_row_id = ch.id AND NOT authenticated) = 2
                     AND EXISTS (SELECT 1 FROM private.google_sheets_push_events WHERE channel_row_id = ch.id AND NOT authenticated
                                   AND outcome = 'rejected_resource' AND message_number = 300), 'the next minute records one more sampled row');
  PERFORM pg_temp.ok(pg_temp.o(70, 'update', 101) = 'queued' AND pg_temp.o(70, 'update', 201) = 'queued',
                     'genuine messages with numbers used by rejected requests are still queued');
  e0 := (SELECT count(*) FROM private.google_sheets_push_events);
  PERFORM pg_temp.ok(pg_temp.o(998, 'update', 1) = 'unknown_channel', 'unknown channel');
  PERFORM pg_temp.ok((SELECT outcome FROM public.google_sheets_push_accept(pg_temp.ch(70), 'zz', 'RES-70', 'update', 1, '', now())) = 'invalid',
                     'invalid digest');
  PERFORM pg_temp.ok((SELECT outcome FROM public.google_sheets_push_accept('gs1-too-short', pg_temp.hex(pg_temp.tok(70)), 'RES-70', 'update', 1, '', now())) = 'invalid',
                     'invalid channel id');
  PERFORM pg_temp.ok((SELECT count(*) FROM private.google_sheets_push_events) = e0, 'unknown and invalid requests write nothing');
  RAISE NOTICE 'PASS P15 bounded replays: duplicates, rejection floods, uniqueness';
END $$;

-- ================================================================ P16 renewal overlap, bounded late-delivery grace, interruptions
UPDATE private.google_sheets_watch_channels SET expires_at = now() + interval '2 hours' WHERE channel_id = pg_temp.ch(70);
SELECT pg_temp.put('rn', pg_temp.watch(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 71, 'renew')::text);
DO $$
DECLARE r jsonb := pg_temp.get('rn')::jsonb; m jsonb;
BEGIN
  PERFORM pg_temp.ok(r->>'status' = 'activated' AND NOT (r->>'kicked')::boolean AND jsonb_array_length(r->'stop') = 0,
                     'seamless renewal: no catch-up, superseded channel not stopped yet ' || r::text);
  PERFORM pg_temp.ok((pg_temp.chan(70)).state = 'stopping' AND (pg_temp.chan(70)).last_error_code = 'superseded'
                     AND (pg_temp.chan(70)).next_stop_at BETWEEN now() + interval '890 seconds' AND now() + interval '910 seconds',
                     'superseded channel kept for the 900 s overlap');
  PERFORM pg_temp.ok(pg_temp.o(70, 'update', 400) = 'queued' AND pg_temp.reason(70, 400) IS NULL,
                     'a change Google notifies on the superseded channel during the overlap is queued (live, not late)');
  PERFORM pg_temp.ok(pg_temp.o(71, 'update', 2) = 'queued', 'the new channel works');
  PERFORM pg_temp.ok(public.google_sheets_push_status(pg_temp.id('a3'), pg_temp.id('orgA'))->'sources'->pg_temp.get('sR1')->>'state' = 'active',
                     'status active during the overlap');
  m := public.google_sheets_push_maintenance_claim(gen_random_uuid(), 50, pg_temp.key());
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(m->'items') i WHERE i->>'kind' = 'stop' AND i->>'channel_id' = pg_temp.ch(70)),
                     'maintenance does not stop it during the overlap');
  UPDATE private.google_sheets_watch_channels SET next_stop_at = now() - interval '1 second' WHERE channel_id = pg_temp.ch(70);
  m := public.google_sheets_push_maintenance_claim(gen_random_uuid(), 50, pg_temp.key());
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(m->'items') i WHERE i->>'kind' = 'stop' AND i->>'channel_id' = pg_temp.ch(70)),
                     'maintenance stops it once the overlap has passed');
  PERFORM public.google_sheets_watch_result((pg_temp.chan(70)).id, 'stopped', NULL, NULL, NULL);
  -- bounded late-delivery grace for a channel Google confirmed
  PERFORM pg_temp.ok(pg_temp.o(70, 'update', 401) = 'queued' AND pg_temp.reason(70, 401) = 'late_delivery',
                     'a delayed delivery within the grace is queued (late_delivery)');
  PERFORM pg_temp.ok(pg_temp.o(70, 'update', 401) = 'duplicate', 'its replay → duplicate');
  UPDATE private.google_sheets_watch_channels SET stopped_at = now() - interval '61 minutes' WHERE channel_id = pg_temp.ch(70);
  PERFORM pg_temp.ok(pg_temp.o(70, 'update', 402) = 'ignored_inactive', 'after the grace an obsolete channel never triggers an import');
  RAISE NOTICE 'PASS P16a renewal overlap: superseded channel accepted for the overlap, stopped after it';
END $$;

-- acceptance matrix by lifecycle state (token, resource id and current generation all valid)
DO $$
DECLARE seq bigint;
BEGIN
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 80, 'failed', NULL, NULL, NULL);
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 81, 'abandoned', interval '-2 hours', interval '20 hours', NULL);
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 82, 'abandoned', NULL, NULL, NULL);
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 83, 'stopping', NULL, NULL, NULL);
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 84, 'stopped', NULL, NULL, interval '-1 minute');
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 85, 'registering', NULL, NULL, NULL);
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 86, 'stopped', interval '-5 hours', interval '18 hours', interval '-10 minutes');
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 87, 'stopped', interval '-5 hours', interval '18 hours', interval '-2 hours');
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 88, 'active', interval '-24 hours', interval '-30 minutes', NULL);
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 89, 'active', interval '-26 hours', interval '-2 hours', NULL);
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 90, 'stopping', interval '-24 hours', interval '-5 minutes', NULL);
  seq := (pg_temp.target(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R')).requested_seq;
  PERFORM pg_temp.ok(pg_temp.o(80, 'update', 1) = 'ignored_inactive', 'failed registration → never triggers work');
  PERFORM pg_temp.ok(pg_temp.o(81, 'update', 1) = 'ignored_inactive', 'abandoned (once confirmed) → never triggers work');
  PERFORM pg_temp.ok(pg_temp.o(82, 'update', 1) = 'ignored_inactive', 'abandoned, never confirmed → never triggers work');
  PERFORM pg_temp.ok(pg_temp.o(83, 'update', 1) = 'ignored_inactive', 'stopping but never confirmed (abandoned registration) → never triggers work');
  PERFORM pg_temp.ok(pg_temp.o(84, 'update', 1) = 'ignored_inactive', 'stopped but never confirmed → no grace');
  PERFORM pg_temp.ok((pg_temp.target(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R')).requested_seq = seq, 'none of them queued a job');
  PERFORM pg_temp.ok(pg_temp.o(85, 'update', 1) = 'queued', 'registering (≤ 5 min, before the watch response) → live');
  UPDATE private.google_sheets_watch_channels SET created_at = now() - interval '6 minutes' WHERE channel_id = pg_temp.ch(85);
  PERFORM pg_temp.ok(pg_temp.o(85, 'update', 2) = 'ignored_inactive', 'registering for more than 5 minutes, never confirmed → ignored');
  UPDATE private.google_sheets_watch_channels SET state = 'abandoned' WHERE channel_id = pg_temp.ch(85);  -- as hygiene would
  PERFORM pg_temp.ok(pg_temp.o(86, 'update', 1) = 'queued' AND pg_temp.reason(86, 1) = 'late_delivery', 'stopped 10 min ago → within the grace');
  PERFORM pg_temp.ok(pg_temp.o(87, 'update', 1) = 'ignored_inactive', 'stopped 2 h ago → past the grace');
  PERFORM pg_temp.ok(pg_temp.o(88, 'update', 1) = 'queued' AND pg_temp.reason(88, 1) = 'late_delivery', 'expired 30 min ago (before hygiene) → within the grace');
  PERFORM pg_temp.ok(pg_temp.o(89, 'update', 1) = 'ignored_inactive', 'expired 2 h ago → past the grace');
  PERFORM pg_temp.ok(pg_temp.o(90, 'update', 1) = 'queued' AND pg_temp.reason(90, 1) = 'late_delivery', 'stopping, expired 5 min ago → within the grace');
  PERFORM pg_temp.ok(pg_temp.o(86, 'update', 1) = 'duplicate', 'replay inside the grace → duplicate');
  PERFORM pg_temp.ok(pg_temp.o(86, 'update', 2, 'forged-' || repeat('q', 30)) = 'rejected_token'
                     AND pg_temp.o(86, 'update', 3, NULL, 'RES-OTHER') = 'rejected_resource', 'the grace never relaxes token or resource checks');
  -- an old authorization generation inside the grace
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 91, 'stopped', interval '-5 hours', interval '18 hours', interval '-10 minutes',
                         interval '0', pg_temp.gen(pg_temp.id('a3')) - 1);
  PERFORM pg_temp.ok(pg_temp.o(91, 'update', 1) = 'ignored_stale', 'old authorization generation inside the grace → ignored');
  DELETE FROM private.google_sheets_watch_channels WHERE channel_id = pg_temp.ch(87);
  PERFORM pg_temp.ok(pg_temp.o(87, 'update', 2) = 'unknown_channel', 'a channel removed by retention → unknown');
  UPDATE private.google_sheets_push_config SET late_grace_s = 0;
  PERFORM pg_temp.ok(pg_temp.o(86, 'update', 4) = 'ignored_inactive', 'grace 0 → no late delivery is accepted');
  UPDATE private.google_sheets_push_config SET late_grace_s = 3600;
  RAISE NOTICE 'PASS P16b bounded late-delivery grace by lifecycle state';
END $$;

-- genuine interruptions reconcile by event; stopping-only coverage is never treated as monitoring
DO $$
DECLARE r jsonb; m jsonb; b record;
BEGIN
  -- a renewal whose old channel would expire inside the overlap is not seamless
  UPDATE private.google_sheets_watch_channels SET expires_at = now() + interval '10 minutes' WHERE channel_id = pg_temp.ch(71);
  r := pg_temp.watch(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 72, 'renew');
  PERFORM pg_temp.ok((r->>'kicked')::boolean, 'old channel expiring inside the overlap → catch-up ' || r::text);
  -- only stopping coverage left (e.g. after stop-all): status interrupted; the next registration is fresh
  UPDATE private.google_sheets_watch_channels SET state = 'stopping', last_error_code = 'stop_all', next_stop_at = NULL
   WHERE channel_id IN (pg_temp.ch(71), pg_temp.ch(72));
  PERFORM pg_temp.ok(public.google_sheets_push_status(pg_temp.id('a3'), pg_temp.id('orgA'))->'sources'->pg_temp.get('sR1')->>'state' = 'interrupted',
                     'stopping-only coverage → status interrupted');
  UPDATE private.google_sheets_watch_channels SET state = 'stopped', stopped_at = now() WHERE channel_id IN (pg_temp.ch(71), pg_temp.ch(72));
  r := pg_temp.watch(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 73, 'recover');
  PERFORM pg_temp.ok((r->>'kicked')::boolean, 'registration after stopping-only coverage is fresh → catch-up');
  PERFORM pg_temp.ok(public.google_sheets_push_status(pg_temp.id('a3'), pg_temp.id('orgA'))->'sources'->pg_temp.get('sR1')->>'state' = 'active',
                     'status active again');
  -- expiry without a renewal: hygiene stops it, maintenance registers 'recover', the activation reconciles
  UPDATE private.google_sheets_watch_channels SET expires_at = now() - interval '1 second' WHERE channel_id = pg_temp.ch(73);
  m := public.google_sheets_push_maintenance_claim(gen_random_uuid(), 50, pg_temp.key());
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(m->'items') i
                              WHERE i->>'kind' = 'register' AND i->>'spreadsheet_id' = 'SPREADSHEET_PUSH_R' AND i->>'reason' = 'recover'),
                     'expired without renewal → maintenance registers (recover) ' || m::text);
  UPDATE private.google_sheets_watch_targets SET maint_lease_owner = NULL, maint_lease_expires_at = NULL
   WHERE id = (pg_temp.target(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R')).id;
  r := pg_temp.watch(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 74, 'recover');
  PERFORM pg_temp.ok((r->>'kicked')::boolean, 'recovery registration → catch-up');
  RAISE NOTICE 'PASS P16c genuine interruptions reconcile by event';
END $$;

-- revoked, reconnected (old generation), paused and disconnected connections inside the grace
DO $$
BEGIN
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 92, 'stopped', interval '-5 hours', interval '18 hours', interval '-5 minutes');
  PERFORM pg_temp.ok(pg_temp.o(92, 'update', 1) = 'queued', 'control: inside the grace, current generation → queued');
  PERFORM public.google_sheets_mark_reconnect(pg_temp.conn(pg_temp.id('a3')), pg_temp.gen(pg_temp.id('a3')), 'invalid_grant');
  PERFORM pg_temp.ok(pg_temp.o(92, 'update', 2) = 'ignored_stale' AND pg_temp.o(74, 'update', 2) = 'ignored_stale',
                     'revoked (reconnect required) → grace and live channels ignored');
  PERFORM pg_temp.connect(pg_temp.id('a3'));
  PERFORM pg_temp.ok(pg_temp.o(92, 'update', 3) = 'ignored_stale' AND pg_temp.o(74, 'update', 3) = 'ignored_stale',
                     'reconnected → channels of the old authorization generation ignored');
  PERFORM pg_temp.mkchan(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R', 93, 'stopped', interval '-5 hours', interval '18 hours', interval '-5 minutes');
  PERFORM pg_temp.ok(pg_temp.o(93, 'update', 1) = 'queued', 'control: new generation inside the grace → queued');
  PERFORM public.google_sheets_set_state(pg_temp.id('a3'), pg_temp.id('orgA'), pg_temp.get('sR1')::uuid, 'pause');
  PERFORM public.google_sheets_watch_release(pg_temp.id('a3'), pg_temp.id('orgA'), 'SPREADSHEET_PUSH_R', false);
  PERFORM pg_temp.ok(pg_temp.o(93, 'update', 2) = 'ignored_inactive', 'paused (target stopped) → ignored inside the grace');
  PERFORM public.google_sheets_set_state(pg_temp.id('a3'), pg_temp.id('orgA'), pg_temp.get('sR1')::uuid, 'resume');
  UPDATE private.google_sheets_watch_targets SET state = 'live' WHERE id = (pg_temp.target(pg_temp.id('a3'), 'SPREADSHEET_PUSH_R')).id;
  PERFORM public.google_sheets_disconnect(pg_temp.id('a3'), pg_temp.id('orgA'));
  PERFORM pg_temp.ok(pg_temp.o(93, 'update', 3) = 'ignored_stale', 'disconnected → ignored inside the grace');
  RAISE NOTICE 'PASS P16d revoked / old-generation / paused / disconnected connections never use the grace';
END $$;

SELECT 'ALL GOOGLE SHEETS PUSH SQL TESTS PASSED' AS result;
