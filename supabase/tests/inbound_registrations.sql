-- =====================================================================================================
-- Inbound Calling v2 — presence registrations (M4) — SQL tests. LOCAL disposable stack only.
-- Apply: inbound_harness → M1–M3 → inbound_v2_harness → M4–M7, then run with ON_ERROR_STOP=1.
-- Whole file rolls back. Auth simulated via request.jwt.claims + SET LOCAL ROLE authenticated.
-- =====================================================================================================
BEGIN;

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','Presence Org A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','Presence Org B') ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1'), ('aaaaaaaa-0000-0000-0000-0000000000a2'), ('bbbbbbbb-0000-0000-0000-0000000000b1');
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a1'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a2'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','Agent','Active','agent_b1');

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
END $$;

-- R1: a heartbeat creates the caller's own (agent, registration) row; identity is auth.uid(), never a parameter
DO $$
DECLARE r jsonb; n int;
BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  r := public.heartbeat_phone_registration('11111111-1111-1111-1111-111111111111', 1, true, 'registered', NULL);
  RESET ROLE;
  IF (r->>'applied')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'R1 expected applied, got %', r; END IF;
  SELECT count(*) INTO n FROM public.agent_phone_registrations
   WHERE agent_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' AND registration_id = '11111111-1111-1111-1111-111111111111'
     AND registered AND organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  IF n <> 1 THEN RAISE EXCEPTION 'R1 row missing'; END IF;
  IF NOT public.is_phone_connected('aaaaaaaa-0000-0000-0000-0000000000a1') THEN RAISE EXCEPTION 'R1 expected connected'; END IF;
END $$;

-- R2: a second tab (different registration id) is its own row; closing it cannot hide the first (gap 4)
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  r := public.heartbeat_phone_registration('22222222-2222-2222-2222-222222222222', 1, true, 'registered', NULL);
  r := public.heartbeat_phone_registration('22222222-2222-2222-2222-222222222222', 2, false, 'unregistered', 'pagehide');
  RESET ROLE;
  IF NOT public.is_phone_connected('aaaaaaaa-0000-0000-0000-0000000000a1') THEN
    RAISE EXCEPTION 'R2 closing tab 2 must not hide tab 1';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_phone_registrations WHERE registration_id = '22222222-2222-2222-2222-222222222222' AND registered) THEN
    RAISE EXCEPTION 'R2 tab 2 should be unregistered';
  END IF;
END $$;

-- R3: a stale / reordered write (seq not greater) is ignored — a delayed unregister cannot undo a newer heartbeat
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  r := public.heartbeat_phone_registration('11111111-1111-1111-1111-111111111111', 5, true, 'registered', NULL);
  r := public.heartbeat_phone_registration('11111111-1111-1111-1111-111111111111', 3, false, 'unregistered', 'late');
  RESET ROLE;
  IF (r->>'applied')::boolean IS DISTINCT FROM false OR r->>'reason' <> 'stale_seq' THEN
    RAISE EXCEPTION 'R3 expected stale_seq, got %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agent_phone_registrations
                  WHERE registration_id = '11111111-1111-1111-1111-111111111111' AND registered AND seq = 5) THEN
    RAISE EXCEPTION 'R3 stale unregister overwrote newer state'; END IF;
  -- equal seq is also stale
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  r := public.heartbeat_phone_registration('11111111-1111-1111-1111-111111111111', 5, false, 'unregistered', NULL);
  RESET ROLE;
  IF (r->>'applied')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'R3 equal seq must be ignored'; END IF;
END $$;

-- R4: another user cannot touch this agent's registrations (rows are keyed by auth.uid()); org-scoped select
DO $$
DECLARE r jsonb; n int;
BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a2');
  SET LOCAL ROLE authenticated;
  r := public.heartbeat_phone_registration('11111111-1111-1111-1111-111111111111', 99, false, 'unregistered', NULL);
  -- same registration id under a different agent ⇒ a DIFFERENT row (agent_id part of the key)
  SELECT count(*) INTO n FROM public.agent_phone_registrations WHERE registration_id = '11111111-1111-1111-1111-111111111111';
  RESET ROLE;
  IF n <> 2 THEN RAISE EXCEPTION 'R4 expected 2 rows (one per agent), got %', n; END IF;
  IF NOT public.is_phone_connected('aaaaaaaa-0000-0000-0000-0000000000a1') THEN RAISE EXCEPTION 'R4 a1 must still be connected'; END IF;
  -- cross-org select is invisible
  PERFORM pg_temp.as_user('bbbbbbbb-0000-0000-0000-0000000000b1');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.agent_phone_registrations;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'R4 org B must not see org A registrations'; END IF;
  -- direct client write is refused (no INSERT policy)
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.agent_phone_registrations (agent_id, registration_id, organization_id)
    VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1','33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-00000000000a');
    RAISE EXCEPTION 'R4 direct insert must be refused';
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN NULL;
  END;
  RESET ROLE;
END $$;

-- R5: freshness — a registration last seen > 3 minutes ago is not connected; a fresh heartbeat restores it
DO $$
DECLARE r jsonb;
BEGIN
  UPDATE public.agent_phone_registrations SET last_seen_at = now() - interval '4 minutes'
   WHERE agent_id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  IF public.is_phone_connected('aaaaaaaa-0000-0000-0000-0000000000a1') THEN RAISE EXCEPTION 'R5 stale must not be connected'; END IF;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  r := public.heartbeat_phone_registration('11111111-1111-1111-1111-111111111111', 6, true, 'registered', NULL);
  RESET ROLE;
  IF NOT public.is_phone_connected('aaaaaaaa-0000-0000-0000-0000000000a1') THEN RAISE EXCEPTION 'R5 fresh heartbeat must reconnect'; END IF;
END $$;

-- R6: unauthenticated / invalid input fail closed
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.heartbeat_phone_registration('11111111-1111-1111-1111-111111111111', 7, true, 'registered', NULL);
    RAISE EXCEPTION 'R6 unauthenticated must fail';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  BEGIN
    PERFORM public.heartbeat_phone_registration('11111111-1111-1111-1111-111111111111', 8, true, 'bogus', NULL);
    RAISE EXCEPTION 'R6 invalid state must fail';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;

ROLLBACK;
