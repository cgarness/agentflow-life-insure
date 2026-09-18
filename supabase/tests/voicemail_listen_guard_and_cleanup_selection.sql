-- =====================================================================================================
-- Corrective pass 13 — M8 (actionable cleanup selection) + M9 (server-authoritative first listen).
-- SQL tests. LOCAL disposable stack only. The whole file rolls back.
-- =====================================================================================================
-- Every listened_at case below runs under `SET LOCAL ROLE authenticated` with real JWT claims, so RLS,
-- the column grant and the M9 trigger are all genuinely exercised — grants are never merely inspected.
-- Each defect is proven FAIL-FIRST in the same file: M9 by disabling its trigger to show the forged
-- timestamp landing and prematurely expiring fresh media, M8 by calling M7's untouched
-- `voicemails_cleanup_batch` beside the new actionable selection on identical data.
BEGIN;

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','CP13 Org A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','CP13 Org B') ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1'),   -- recipient agent (org A)
  ('aaaaaaaa-0000-0000-0000-0000000000a2'),   -- configured inbound-group member (org A)
  ('aaaaaaaa-0000-0000-0000-0000000000a3'),   -- unrelated agent, SAME organization
  ('aaaaaaaa-0000-0000-0000-0000000000ad'),   -- org A Admin
  ('bbbbbbbb-0000-0000-0000-0000000000b1')    -- org B Admin (cross-organization)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity, availability_status) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','cp13_a1','Available'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','cp13_a2','Available'),
  ('aaaaaaaa-0000-0000-0000-0000000000a3','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','cp13_a3','Available'),
  ('aaaaaaaa-0000-0000-0000-0000000000ad','aaaaaaaa-0000-0000-0000-00000000000a','Admin','Active','cp13_ad','Available'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','Admin','Active','cp13_b1','Available')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.inbound_routing_settings (organization_id, inbound_group_agent_ids)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', ARRAY['aaaaaaaa-0000-0000-0000-0000000000a2']::uuid[])
ON CONFLICT (organization_id) DO UPDATE SET inbound_group_agent_ids = EXCLUDED.inbound_group_agent_ids;
INSERT INTO public.inbound_routing_settings (organization_id) VALUES ('bbbbbbbb-0000-0000-0000-00000000000b')
ON CONFLICT (organization_id) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid, p_role text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated', 'app_metadata', json_build_object('role', p_role))::text, true);
END $$;

-- One call + one voicemail. `p_owner` NULL/garbage models a row whose provider account was never
-- established; a valid AC… SID models an actionable row.
CREATE OR REPLACE FUNCTION pg_temp.mk_vm(p_n integer, p_org uuid, p_owner text,
                                         p_kind text DEFAULT 'agent', p_agent uuid DEFAULT 'aaaaaaaa-0000-0000-0000-0000000000a1',
                                         p_age interval DEFAULT interval '0', p_listened timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_call uuid; v_vm uuid;
BEGIN
  v_call := ('cccccccc-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
  v_vm   := ('eeeeeeee-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
  INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, routing_engine)
  VALUES (v_call, p_org, 'inbound', 'completed', 'CA' || lpad(p_n::text, 32, '0'), '+19995551234', '+15550001111', 'v2')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.voicemails (id, organization_id, call_id, recipient_kind, recipient_agent_id, recipient_group_ids,
                                 recording_sid, provider_account_sid, storage_path, status,
                                 source_cleanup_state, source_cleanup_attempts, created_at, listened_at)
  VALUES (v_vm, p_org, v_call, p_kind,
          CASE WHEN p_kind = 'agent' THEN p_agent ELSE NULL END,
          CASE WHEN p_kind = 'group' THEN ARRAY['aaaaaaaa-0000-0000-0000-0000000000a2']::uuid[] ELSE '{}'::uuid[] END,
          'RE' || lpad(p_n::text, 32, '0'), p_owner,
          p_org::text || '/' || p_n::text || '.mp3', 'stored', 'pending', 0, now() - p_age, p_listened);
  RETURN v_vm;
END $$;

-- =====================================================================================================
-- PART 1 — M9: the first-listen timestamp is server-authoritative.
-- =====================================================================================================

-- L0 FAIL-FIRST. With M9's trigger disabled (i.e. the schema as deployed today), an AUTHORIZED recipient
--    backdates listened_at to 2000-01-01, the value sticks, and voicemails_expired_batch immediately
--    offers fresh media for irreversible deletion. This is the defect, executed rather than asserted.
DO $$
DECLARE v_vm uuid; v_rows int; v_stored timestamptz; v_expired int;
BEGIN
  SET LOCAL ROLE service_role;
  v_vm := pg_temp.mk_vm(900, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('a',32));
  RESET ROLE;

  ALTER TABLE public.voicemails DISABLE TRIGGER voicemails_first_listen_guard;

  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  UPDATE public.voicemails SET listened_at = timestamptz '2000-01-01 00:00:00Z' WHERE id = v_vm AND listened_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'L0 fail-first: the authorized update should have matched 1 row, got %', v_rows; END IF;

  SELECT listened_at INTO v_stored FROM public.voicemails WHERE id = v_vm;
  IF v_stored <> timestamptz '2000-01-01 00:00:00Z' THEN
    RAISE EXCEPTION 'L0 fail-first: expected the forged timestamp to stick without the guard, got %', v_stored; END IF;

  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_expired FROM public.voicemails_expired_batch(
    'aaaaaaaa-0000-0000-0000-00000000000a', now() - interval '30 days', now() - interval '90 days', 200) e
   WHERE e.id = v_vm;
  RESET ROLE;
  IF v_expired <> 1 THEN
    RAISE EXCEPTION 'L0 fail-first: fresh media should have been expirable via the forged clock, got %', v_expired; END IF;

  ALTER TABLE public.voicemails ENABLE TRIGGER voicemails_first_listen_guard;
  DELETE FROM public.voicemails WHERE id = v_vm;
  RAISE NOTICE 'L0 FAIL-FIRST reproduced: forged listened_at stuck and expired fresh media (guard disabled)';
END $$;

-- L1 A legitimate first listen is stamped by the SERVER, not by the caller.
DO $$
DECLARE v_vm uuid; v_rows int; v_stored timestamptz;
BEGIN
  SET LOCAL ROLE service_role;
  v_vm := pg_temp.mk_vm(901, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('a',32));
  RESET ROLE;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  -- exactly what src/lib/voicemails.ts sends
  UPDATE public.voicemails SET listened_at = timestamptz '2011-11-11 11:11:11Z' WHERE id = v_vm AND listened_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'L1 expected 1 row updated, got %', v_rows; END IF;
  SELECT listened_at INTO v_stored FROM public.voicemails WHERE id = v_vm;
  IF v_stored IS NULL THEN RAISE EXCEPTION 'L1 first listen was not stamped'; END IF;
  IF v_stored = timestamptz '2011-11-11 11:11:11Z' THEN RAISE EXCEPTION 'L1 client value was accepted'; END IF;
  IF v_stored <> now() THEN RAISE EXCEPTION 'L1 expected the server clock (now()=%), got %', now(), v_stored; END IF;
END $$;

-- L2 Backdating, future-dating, clearing and resetting are all refused on an ESTABLISHED value, and the
--    statement stays idempotent (it reports success; the stored value simply does not move).
DO $$
DECLARE v_vm uuid; v_first timestamptz; v_after timestamptz; v_rows int;
BEGIN
  SET LOCAL ROLE service_role;
  v_vm := pg_temp.mk_vm(902, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('a',32));
  RESET ROLE;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  UPDATE public.voicemails SET listened_at = now() WHERE id = v_vm AND listened_at IS NULL;
  RESET ROLE;
  SELECT listened_at INTO v_first FROM public.voicemails WHERE id = v_vm;
  IF v_first IS NULL THEN RAISE EXCEPTION 'L2 setup: first listen not stamped'; END IF;

  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  UPDATE public.voicemails SET listened_at = timestamptz '2000-01-01 00:00:00Z' WHERE id = v_vm;  -- backdate
  UPDATE public.voicemails SET listened_at = timestamptz '2099-01-01 00:00:00Z' WHERE id = v_vm;  -- future-date
  UPDATE public.voicemails SET listened_at = NULL                                WHERE id = v_vm;  -- clear
  UPDATE public.voicemails SET listened_at = now()                                WHERE id = v_vm;  -- reset
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'L2 the statement should still report success, got % rows', v_rows; END IF;
  SELECT listened_at INTO v_after FROM public.voicemails WHERE id = v_vm;
  IF v_after IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'L2 established first-listen moved: % -> %', v_first, v_after; END IF;
END $$;

-- L3 The guard changes ONLY listened_at — no status, ownership, media path, cleanup or notification state.
DO $$
DECLARE v_vm uuid; v_before text; v_after text;
BEGIN
  SET LOCAL ROLE service_role;
  v_vm := pg_temp.mk_vm(903, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('a',32));
  RESET ROLE;
  SELECT status || '|' || coalesce(provider_account_sid,'-') || '|' || coalesce(storage_path,'-') || '|' ||
         source_cleanup_state || '|' || source_cleanup_attempts || '|' || coalesce(source_cleanup_next_at::text,'-') || '|' ||
         coalesce(notified_at::text,'-') || '|' || notify_attempts
    INTO v_before FROM public.voicemails WHERE id = v_vm;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  UPDATE public.voicemails SET listened_at = now() WHERE id = v_vm AND listened_at IS NULL;
  RESET ROLE;
  SELECT status || '|' || coalesce(provider_account_sid,'-') || '|' || coalesce(storage_path,'-') || '|' ||
         source_cleanup_state || '|' || source_cleanup_attempts || '|' || coalesce(source_cleanup_next_at::text,'-') || '|' ||
         coalesce(notified_at::text,'-') || '|' || notify_attempts
    INTO v_after FROM public.voicemails WHERE id = v_vm;
  IF v_before IS DISTINCT FROM v_after THEN RAISE EXCEPTION 'L3 side effect: % -> %', v_before, v_after; END IF;
END $$;

-- L4 Row-access boundaries are unchanged: the recipient, a configured group member and the org Admin may
--    stamp; an unrelated agent in the SAME organization and an Admin from ANOTHER organization may not.
DO $$
DECLARE v_agent uuid; v_group uuid; v_admin uuid; v_deny1 uuid; v_deny2 uuid; v_rows int;
BEGIN
  SET LOCAL ROLE service_role;
  v_agent := pg_temp.mk_vm(910, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('a',32));
  v_group := pg_temp.mk_vm(911, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('a',32), 'group');
  v_admin := pg_temp.mk_vm(912, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('a',32));
  v_deny1 := pg_temp.mk_vm(913, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('a',32));
  v_deny2 := pg_temp.mk_vm(914, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('a',32));
  RESET ROLE;

  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');                 -- recipient
  SET LOCAL ROLE authenticated;
  UPDATE public.voicemails SET listened_at = now() WHERE id = v_agent AND listened_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT; RESET ROLE;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'L4 recipient should be allowed, got %', v_rows; END IF;

  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a2');                 -- configured group member
  SET LOCAL ROLE authenticated;
  UPDATE public.voicemails SET listened_at = now() WHERE id = v_group AND listened_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT; RESET ROLE;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'L4 group member should be allowed, got %', v_rows; END IF;

  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000ad','Admin');         -- org Admin
  SET LOCAL ROLE authenticated;
  UPDATE public.voicemails SET listened_at = now() WHERE id = v_admin AND listened_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT; RESET ROLE;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'L4 org Admin should be allowed, got %', v_rows; END IF;

  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a3');                 -- unrelated, SAME org
  SET LOCAL ROLE authenticated;
  UPDATE public.voicemails SET listened_at = now() WHERE id = v_deny1 AND listened_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT; RESET ROLE;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'L4 unrelated same-org agent must be denied, got %', v_rows; END IF;
  IF (SELECT listened_at FROM public.voicemails WHERE id = v_deny1) IS NOT NULL THEN
    RAISE EXCEPTION 'L4 unrelated same-org agent wrote a timestamp'; END IF;

  PERFORM pg_temp.as_user('bbbbbbbb-0000-0000-0000-0000000000b1','Admin');         -- other organization
  SET LOCAL ROLE authenticated;
  UPDATE public.voicemails SET listened_at = now() WHERE id = v_deny2 AND listened_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT; RESET ROLE;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'L4 cross-organization Admin must be denied, got %', v_rows; END IF;
  IF (SELECT listened_at FROM public.voicemails WHERE id = v_deny2) IS NOT NULL THEN
    RAISE EXCEPTION 'L4 cross-organization Admin wrote a timestamp'; END IF;
END $$;

-- L5 THE POINT OF THE WHOLE EXERCISE, against the REAL expiration predicate: a caller who tries to
--    backdate cannot bring forward the irreversible deletion of fresh media, while genuinely old heard
--    media and the unheard 90-day cap still expire exactly as approved.
DO $$
DECLARE v_fresh uuid; v_old uuid; v_unheard uuid; v_hit int;
BEGIN
  SET LOCAL ROLE service_role;
  v_fresh   := pg_temp.mk_vm(920, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('a',32));
  -- A listen recorded BEFORE M9 existed: the guard is BEFORE UPDATE only, so an INSERT-time value is
  -- historical data, and the heard branch must still honour it.
  v_old     := pg_temp.mk_vm(921, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('a',32), 'agent',
                             'aaaaaaaa-0000-0000-0000-0000000000a1', interval '200 days', now() - interval '200 days');
  v_unheard := pg_temp.mk_vm(922, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('a',32), 'agent',
                             'aaaaaaaa-0000-0000-0000-0000000000a1', interval '200 days');
  RESET ROLE;

  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  UPDATE public.voicemails SET listened_at = timestamptz '2000-01-01 00:00:00Z' WHERE id = v_fresh AND listened_at IS NULL;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_hit FROM public.voicemails_expired_batch(
    'aaaaaaaa-0000-0000-0000-00000000000a', now() - interval '30 days', now() - interval '90 days', 200) e
   WHERE e.id = v_fresh;
  IF v_hit <> 0 THEN RAISE EXCEPTION 'L5 a forged clock still expired fresh media (%)', v_hit; END IF;

  -- The unheard row (never listened, 200 days old) still expires under the untouched 90-day cap.
  SELECT count(*) INTO v_hit FROM public.voicemails_expired_batch(
    'aaaaaaaa-0000-0000-0000-00000000000a', now() - interval '30 days', now() - interval '90 days', 200) e
   WHERE e.id = v_unheard;
  IF v_hit <> 1 THEN RAISE EXCEPTION 'L5 the unheard 90-day cap stopped working (%)', v_hit; END IF;

  -- And a first listen genuinely older than retention DOES still expire: the heard branch is untouched.
  SELECT count(*) INTO v_hit FROM public.voicemails_expired_batch(
    'aaaaaaaa-0000-0000-0000-00000000000a', now() - interval '30 days', now() - interval '90 days', 200) e
   WHERE e.id = v_old;
  RESET ROLE;
  IF v_hit <> 1 THEN RAISE EXCEPTION 'L5 the heard retention branch stopped working (%)', v_hit; END IF;
END $$;

-- L6 The guard is BEFORE UPDATE only, which is safe precisely because `authenticated` cannot INSERT a
--    row (or DELETE one) to smuggle in a chosen timestamp: M7 reset the grants to SELECT + UPDATE
--    (listened_at). Proven by attempting both as the role, not by reading pg_catalog.
DO $$
DECLARE v_ins boolean := false; v_del boolean := false;
BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000ad','Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.voicemails (organization_id, call_id, recipient_kind, recipient_agent_id,
                                   recording_sid, status, listened_at)
    VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000901', 'agent',
            'aaaaaaaa-0000-0000-0000-0000000000a1', 'RE' || repeat('f',32), 'stored',
            timestamptz '2000-01-01 00:00:00Z');
  EXCEPTION WHEN insufficient_privilege THEN v_ins := true;
  END;
  BEGIN
    DELETE FROM public.voicemails WHERE id = 'eeeeeeee-0000-0000-0000-000000000901';
  EXCEPTION WHEN insufficient_privilege THEN v_del := true;
  END;
  RESET ROLE;
  IF NOT v_ins THEN RAISE EXCEPTION 'L6 authenticated could INSERT a voicemail with a chosen listened_at'; END IF;
  IF NOT v_del THEN RAISE EXCEPTION 'L6 authenticated could DELETE a voicemail'; END IF;
END $$;

-- L7 THE ONE EXEMPTION, pinned deliberately rather than left as an accident: service_role may still set
--    the column outright (deliberate maintenance, backfills, migrations), while the SAME statement from
--    `authenticated` is refused. Both halves are executed as their real roles.
DO $$
DECLARE v_vm uuid; v_svc timestamptz; v_cli timestamptz;
BEGIN
  SET LOCAL ROLE service_role;
  v_vm := pg_temp.mk_vm(930, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('a',32));
  UPDATE public.voicemails SET listened_at = timestamptz '2001-02-03 04:05:06Z' WHERE id = v_vm;
  RESET ROLE;
  SELECT listened_at INTO v_svc FROM public.voicemails WHERE id = v_vm;
  IF v_svc <> timestamptz '2001-02-03 04:05:06Z' THEN
    RAISE EXCEPTION 'L7 service_role maintenance write was blocked (got %)', v_svc; END IF;

  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  UPDATE public.voicemails SET listened_at = timestamptz '1999-12-31 23:59:59Z' WHERE id = v_vm;
  RESET ROLE;
  SELECT listened_at INTO v_cli FROM public.voicemails WHERE id = v_vm;
  IF v_cli <> v_svc THEN RAISE EXCEPTION 'L7 a client moved an established timestamp: % -> %', v_svc, v_cli; END IF;
END $$;

-- L8 The exemption is only safe while NO shipped writer sets the column. Asserted against the live
--    catalog, so a future function that starts writing `listened_at` fails this test loudly.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('upsert_voicemail_from_recording','mark_voicemails_purged',
                       'mark_voicemail_source_deleted','record_voicemail_cleanup_failure',
                       'voicemails_expired_batch','voicemails_cleanup_batch',
                       'voicemails_cleanup_actionable_batch','voicemails_cleanup_blocked_summary')
     AND p.prosrc ~* 'listened_at[[:space:]]*(=|:=)';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'L8 a service_role function now writes listened_at, which the M9 exemption does not cover: %', v_bad;
  END IF;
END $$;

-- =====================================================================================================
-- PART 2 — M8: actionable selection cannot be starved by unresolved-owner rows.
-- =====================================================================================================

-- Part 1's fixtures have served their purpose and some of them are deliberately old, so they would sort
-- ahead of Part 2's rows in the `ORDER BY created_at ASC` queue. Part 2 asserts EXACT queue contents,
-- so it starts from an empty voicemails table rather than from whatever Part 1 happened to leave.
DO $$ BEGIN SET LOCAL ROLE service_role; DELETE FROM public.voicemails; RESET ROLE; END $$;

-- C0 FAIL-FIRST + the correction, on identical data: 100 older unowned rows and one newer actionable row.
--    M7's untouched `voicemails_cleanup_batch` returns only the blocked prefix (the starvation);
--    `voicemails_cleanup_actionable_batch` returns the actionable row.
DO $$
DECLARE i int; v_target uuid; v_old_hit int; v_new_hit int; v_old_blocked int;
BEGIN
  SET LOCAL ROLE service_role;
  FOR i IN 1..100 LOOP
    PERFORM pg_temp.mk_vm(1000 + i, 'aaaaaaaa-0000-0000-0000-00000000000a', NULL, 'agent',
                          'aaaaaaaa-0000-0000-0000-0000000000a1', interval '10 days');
  END LOOP;
  v_target := pg_temp.mk_vm(1200, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('c',32), 'agent',
                            'aaaaaaaa-0000-0000-0000-0000000000a1', interval '1 day');

  SELECT count(*) INTO v_old_hit     FROM public.voicemails_cleanup_batch(100) b WHERE b.id = v_target;
  SELECT count(*) INTO v_old_blocked FROM public.voicemails_cleanup_batch(100) b WHERE b.provider_account_sid IS NULL;
  SELECT count(*) INTO v_new_hit     FROM public.voicemails_cleanup_actionable_batch(100) b WHERE b.id = v_target;
  RESET ROLE;

  IF v_old_hit <> 0 OR v_old_blocked <> 100 THEN
    RAISE EXCEPTION 'C0 fail-first: M7 batch should be 100 blocked rows and never the actionable one (hit=% blocked=%)',
      v_old_hit, v_old_blocked; END IF;
  IF v_new_hit <> 1 THEN
    RAISE EXCEPTION 'C0 the actionable selection must reach the valid row, got %', v_new_hit; END IF;
  RAISE NOTICE 'C0 FAIL-FIRST reproduced (M7 batch starves) and corrected (actionable batch reaches the row)';
END $$;

-- C1 The actionable selection NEVER returns an unestablished owner, whatever its shape.
DO $$
DECLARE v_bad int;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.mk_vm(1301, 'aaaaaaaa-0000-0000-0000-00000000000a', '');                       -- empty
  PERFORM pg_temp.mk_vm(1302, 'aaaaaaaa-0000-0000-0000-00000000000a', '   ');                    -- whitespace
  PERFORM pg_temp.mk_vm(1303, 'aaaaaaaa-0000-0000-0000-00000000000a', 'ACshort');                -- too short
  PERFORM pg_temp.mk_vm(1304, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('z',32));   -- non-hex
  PERFORM pg_temp.mk_vm(1305, 'aaaaaaaa-0000-0000-0000-00000000000a', 'SK' || repeat('a',32));   -- wrong prefix
  SELECT count(*) INTO v_bad FROM public.voicemails_cleanup_actionable_batch(500) b
   WHERE b.id IN ('eeeeeeee-0000-0000-0000-000000001301','eeeeeeee-0000-0000-0000-000000001302',
                  'eeeeeeee-0000-0000-0000-000000001303','eeeeeeee-0000-0000-0000-000000001304',
                  'eeeeeeee-0000-0000-0000-000000001305');
  RESET ROLE;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'C1 malformed owners leaked into the actionable selection: %', v_bad; END IF;
END $$;

-- C2 Blocked rows are REPORTED, not silently dropped, and their obligations are untouched.
DO $$
DECLARE r record; v_state text;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT * INTO r FROM public.voicemails_cleanup_blocked_summary(5000);
  RESET ROLE;
  -- 100 from C0 + 5 malformed from C1, all in org A, all due now.
  IF r.blocked_due <> 105 OR r.blocked_total <> 105 THEN
    RAISE EXCEPTION 'C2 expected 105 blocked rows, got due=% total=%', r.blocked_due, r.blocked_total; END IF;
  IF r.blocked_orgs <> 1 THEN RAISE EXCEPTION 'C2 expected 1 blocked organization, got %', r.blocked_orgs; END IF;
  IF r.scan_capped THEN RAISE EXCEPTION 'C2 the scan should not be capped at 105 rows'; END IF;
  IF r.oldest_blocked_at IS NULL THEN RAISE EXCEPTION 'C2 oldest_blocked_at must be reported'; END IF;

  SELECT source_cleanup_state || '|' || source_cleanup_attempts || '|' || coalesce(source_cleanup_next_at::text,'-')
         || '|' || coalesce(source_cleanup_error,'-')
    INTO v_state FROM public.voicemails WHERE id = 'eeeeeeee-0000-0000-0000-000000001001';
  IF v_state <> 'pending|0|-|-' THEN
    RAISE EXCEPTION 'C2 a blocked row was modified: %', v_state; END IF;
END $$;

-- C3 Cross-organization: org A is entirely blocked, org B has actionable work. B is reached anyway, and
--    the summary attributes the blockage to the organizations that actually own it.
DO $$
DECLARE v_b uuid; v_hit int; r record;
BEGIN
  SET LOCAL ROLE service_role;
  v_b := pg_temp.mk_vm(1400, 'bbbbbbbb-0000-0000-0000-00000000000b', 'AC' || repeat('b',32), 'group');
  PERFORM pg_temp.mk_vm(1401, 'bbbbbbbb-0000-0000-0000-00000000000b', NULL, 'group');
  SELECT count(*) INTO v_hit FROM public.voicemails_cleanup_actionable_batch(100) b WHERE b.id = v_b;
  SELECT * INTO r FROM public.voicemails_cleanup_blocked_summary(5000);
  RESET ROLE;
  IF v_hit <> 1 THEN RAISE EXCEPTION 'C3 org B actionable work was starved by org A, got %', v_hit; END IF;
  IF r.blocked_orgs <> 2 THEN RAISE EXCEPTION 'C3 expected 2 blocked organizations, got %', r.blocked_orgs; END IF;
  IF r.blocked_total <> 106 THEN RAISE EXCEPTION 'C3 expected 106 blocked rows, got %', r.blocked_total; END IF;
END $$;

-- C4 Owner recovery: once a signed callback persists a valid owner, the row is actionable again with no
--    other intervention, and the blocked count falls by exactly one.
DO $$
DECLARE v_before int; v_after int; v_hit int;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT blocked_total INTO v_before FROM public.voicemails_cleanup_blocked_summary(5000);
  UPDATE public.voicemails SET provider_account_sid = 'AC' || repeat('d',32)
   WHERE id = 'eeeeeeee-0000-0000-0000-000000001001';
  SELECT count(*) INTO v_hit FROM public.voicemails_cleanup_actionable_batch(500) b
   WHERE b.id = 'eeeeeeee-0000-0000-0000-000000001001';
  SELECT blocked_total INTO v_after FROM public.voicemails_cleanup_blocked_summary(5000);
  RESET ROLE;
  IF v_hit <> 1 THEN RAISE EXCEPTION 'C4 a recovered row did not become actionable'; END IF;
  IF v_after <> v_before - 1 THEN RAISE EXCEPTION 'C4 blocked count % -> % (expected -1)', v_before, v_after; END IF;
END $$;

-- C5 The untouched M7 contract still holds for the actionable selection: the 50-attempt ceiling, the
--    backoff window, purged-but-uncleaned rows, and the 500 clamp.
DO $$
DECLARE v_hit int;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.mk_vm(1501, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('e',32));
  UPDATE public.voicemails SET source_cleanup_attempts = 50 WHERE id = 'eeeeeeee-0000-0000-0000-000000001501';
  SELECT count(*) INTO v_hit FROM public.voicemails_cleanup_actionable_batch(500) b WHERE b.id = 'eeeeeeee-0000-0000-0000-000000001501';
  IF v_hit <> 0 THEN RAISE EXCEPTION 'C5 the 50-attempt ceiling was ignored'; END IF;

  PERFORM pg_temp.mk_vm(1502, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('e',32));
  UPDATE public.voicemails SET source_cleanup_next_at = now() + interval '1 hour' WHERE id = 'eeeeeeee-0000-0000-0000-000000001502';
  SELECT count(*) INTO v_hit FROM public.voicemails_cleanup_actionable_batch(500) b WHERE b.id = 'eeeeeeee-0000-0000-0000-000000001502';
  IF v_hit <> 0 THEN RAISE EXCEPTION 'C5 a backed-off row was offered early'; END IF;

  PERFORM pg_temp.mk_vm(1503, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('e',32));
  UPDATE public.voicemails SET status = 'purged', storage_path = NULL WHERE id = 'eeeeeeee-0000-0000-0000-000000001503';
  SELECT count(*) INTO v_hit FROM public.voicemails_cleanup_actionable_batch(500) b WHERE b.id = 'eeeeeeee-0000-0000-0000-000000001503';
  IF v_hit <> 1 THEN RAISE EXCEPTION 'C5 a purged row still owing its source deletion was dropped'; END IF;

  PERFORM pg_temp.mk_vm(1504, 'aaaaaaaa-0000-0000-0000-00000000000a', 'AC' || repeat('e',32));
  UPDATE public.voicemails SET source_cleanup_state = 'deleted' WHERE id = 'eeeeeeee-0000-0000-0000-000000001504';
  SELECT count(*) INTO v_hit FROM public.voicemails_cleanup_actionable_batch(500) b WHERE b.id = 'eeeeeeee-0000-0000-0000-000000001504';
  IF v_hit <> 0 THEN RAISE EXCEPTION 'C5 an already-deleted source was re-offered'; END IF;

  SELECT count(*) INTO v_hit FROM public.voicemails_cleanup_actionable_batch(100000);
  RESET ROLE;
  IF v_hit > 500 THEN RAISE EXCEPTION 'C5 the 500 clamp was ignored, got %', v_hit; END IF;
END $$;

-- C6 The blocked summary's scan cap is reported honestly rather than under-counting silently.
DO $$
DECLARE r record;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT * INTO r FROM public.voicemails_cleanup_blocked_summary(10);
  RESET ROLE;
  IF NOT r.scan_capped THEN RAISE EXCEPTION 'C6 a capped scan must say so'; END IF;
  IF r.blocked_total <> 10 THEN RAISE EXCEPTION 'C6 a capped scan should report its cap, got %', r.blocked_total; END IF;
END $$;

-- C7 Privilege shape: service_role only. `authenticated` must not be able to call either helper.
DO $$
DECLARE v_denied boolean := false;
BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000ad','Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.voicemails_cleanup_actionable_batch(10);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  RESET ROLE;
  IF NOT v_denied THEN RAISE EXCEPTION 'C7 authenticated could call voicemails_cleanup_actionable_batch'; END IF;

  v_denied := false;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000ad','Admin');
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.voicemails_cleanup_blocked_summary(10);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  RESET ROLE;
  IF NOT v_denied THEN RAISE EXCEPTION 'C7 authenticated could call voicemails_cleanup_blocked_summary'; END IF;
END $$;

ROLLBACK;
