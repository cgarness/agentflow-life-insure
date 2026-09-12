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

-- R7 (corrective pass 10): ORGANIZATION ISOLATION of public.is_phone_connected.
--     The predicate is SECURITY INVOKER, so an authenticated caller sees exactly what the table's
--     org-scoped RLS policies allow — the connection status of an agent in ANOTHER organization is
--     invisible through the FUNCTION, not only through the table. Every function assertion below is made
--     while `SET LOCAL ROLE authenticated` is still active (R4 asserts the table read but resets the role
--     before calling the function, which is why the leak survived it).
DO $$
DECLARE n int; v_self boolean; v_peer boolean; v_foreign boolean; v_anon boolean;
  a1 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';   -- org A, connected
  a2 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a2';   -- org A, same-org peer
  b1 constant uuid := 'bbbbbbbb-0000-0000-0000-0000000000b1';   -- org B
BEGIN
  -- a clean slate for a1 (R1–R5 left their own registrations behind)
  DELETE FROM public.agent_phone_registrations WHERE agent_id IN (a1, a2, b1);
  -- a1 registers a live device (through the RPC, as production does)
  PERFORM pg_temp.as_user(a1);
  SET LOCAL ROLE authenticated;
  PERFORM public.heartbeat_phone_registration('77777777-7777-7777-7777-777777777777', 1, true, 'registered', NULL);
  RESET ROLE;
  IF NOT public.is_phone_connected(a1) THEN RAISE EXCEPTION 'R7 setup: a1 must be connected to the owner'; END IF;

  -- (1) the FOREIGN organization's authenticated caller sees nothing — table AND function, role still set
  PERFORM pg_temp.as_user(b1);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.agent_phone_registrations;
  v_foreign := public.is_phone_connected(a1);          -- asserted UNDER the foreign authenticated role
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'R7 org B must not read org A registration rows, got %', n; END IF;
  IF v_foreign THEN RAISE EXCEPTION 'R7 org B must not learn org A connection status through the function'; END IF;

  -- (2) SELF and SAME-ORGANIZATION connectivity still work for authenticated callers
  PERFORM pg_temp.as_user(a1);
  SET LOCAL ROLE authenticated;
  v_self := public.is_phone_connected(a1);
  RESET ROLE;
  IF NOT v_self THEN RAISE EXCEPTION 'R7 an agent must see their own connection status'; END IF;
  PERFORM pg_temp.as_user(a2);
  SET LOCAL ROLE authenticated;
  v_peer := public.is_phone_connected(a1);
  RESET ROLE;
  IF NOT v_peer THEN RAISE EXCEPTION 'R7 a same-organization agent must see a peer''s connection status'; END IF;

  -- (3) an ANONYMOUS caller is denied outright (EXECUTE revoked), before RLS is even consulted
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    v_anon := public.is_phone_connected(a1);
    RESET ROLE;
    RAISE EXCEPTION 'R7 anon must not be able to execute the predicate';
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN RESET ROLE;
  END;

  -- (4) SERVICE ROLE routing still recognises the connected agent across the organization
  SET LOCAL ROLE service_role;
  IF NOT public.is_phone_connected(a1) THEN RAISE EXCEPTION 'R7 service_role routing must see the registration'; END IF;
  RESET ROLE;

  -- (5) freshness and multiple registrations are unchanged under the new security mode
  PERFORM pg_temp.as_user(a1);
  SET LOCAL ROLE authenticated;
  PERFORM public.heartbeat_phone_registration('88888888-8888-8888-8888-888888888888', 1, true, 'registered', NULL);
  RESET ROLE;
  SELECT count(*) INTO n FROM public.agent_phone_registrations WHERE agent_id = a1 AND registered;
  IF n <> 2 THEN RAISE EXCEPTION 'R7 two live registrations expected, got %', n; END IF;
  UPDATE public.agent_phone_registrations SET last_seen_at = now() - interval '4 minutes' WHERE agent_id = a1;
  IF public.is_phone_connected(a1) THEN RAISE EXCEPTION 'R7 all registrations stale ⇒ not connected'; END IF;
  UPDATE public.agent_phone_registrations SET last_seen_at = now()
   WHERE agent_id = a1 AND registration_id = '88888888-8888-8888-8888-888888888888';
  IF NOT public.is_phone_connected(a1) THEN RAISE EXCEPTION 'R7 one fresh registration ⇒ connected'; END IF;
END $$;

-- R8 (corrective pass 10): the M6 planners still recognise eligible connected agents through the
--     INVOKER predicate — they are SECURITY DEFINER functions owned by the migration owner, so the
--     organization's registrations remain visible inside them.
DO $$
DECLARE r jsonb;
  org constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  a1 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  a2 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a2';
  c1 constant uuid := 'cccccccc-0000-0000-0000-00000000e001';
  c2 constant uuid := 'cccccccc-0000-0000-0000-00000000e002';
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.inbound_routing_settings (organization_id, routing_engine, inbound_group_agent_ids)
  VALUES (org, 'v2', ARRAY[a1, a2]) ON CONFLICT (organization_id) DO UPDATE SET routing_engine = 'v2', inbound_group_agent_ids = ARRAY[a1, a2];
  UPDATE public.profiles SET availability_status = 'Available' WHERE id IN (a1, a2);
  DELETE FROM public.agent_phone_registrations;
  RESET ROLE;
  -- both agents hold a live browser registration, written through the RPC as their own authenticated user
  PERFORM pg_temp.as_user(a1); SET LOCAL ROLE authenticated;
  PERFORM public.heartbeat_phone_registration('99999999-9999-9999-9999-999999999991', 1, true, 'registered', NULL);
  RESET ROLE;
  PERFORM pg_temp.as_user(a2); SET LOCAL ROLE authenticated;
  PERFORM public.heartbeat_phone_registration('99999999-9999-9999-9999-999999999992', 1, true, 'registered', NULL);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SET LOCAL ROLE service_role;
  -- OWNER planner: the owner is connected ⇒ the browser rings
  INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, routing_engine)
  VALUES (c1, org, 'inbound', 'ringing', 'CA00000000000000000000000000000r01', '+19995551234', '+15550001111', 'v2');
  r := public.plan_inbound_route(c1, org, a1, 'contact', '{}'::uuid[], 20);
  IF r->>'stage' IS DISTINCT FROM 'owner_browser' THEN RAISE EXCEPTION 'R8 the owner planner must ring the connected owner, got %', r; END IF;
  -- release a1's reservation, so the group wave below is not filtered by the busy predicate
  PERFORM public.abandon_inbound_routing(c1, org, 'test_cleanup');
  -- GROUP planner: both members are connected ⇒ both are eligible
  INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, routing_engine)
  VALUES (c2, org, 'inbound', 'ringing', 'CA00000000000000000000000000000r02', '+19995554321', '+15550001111', 'v2');
  r := public.plan_inbound_route(c2, org, NULL, NULL, ARRAY[a1, a2], 20);
  IF r->>'stage' IS DISTINCT FROM 'group_browser' THEN RAISE EXCEPTION 'R8 the group planner must ring connected members, got %', r; END IF;
  IF jsonb_array_length(r->'targets') <> 2 THEN RAISE EXCEPTION 'R8 both connected members must be eligible, got %', r->'targets'; END IF;
  RESET ROLE;
END $$;

-- R9 (corrective pass 10): the shipped security attributes and ACLs are what the §7.7 scope approves.
DO $$
DECLARE v_secdef boolean; v_acl text; n int;
BEGIN
  SELECT p.prosecdef INTO v_secdef FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
   WHERE n2.nspname = 'public' AND p.proname = 'is_phone_connected';
  IF v_secdef THEN RAISE EXCEPTION 'R9 is_phone_connected must be SECURITY INVOKER'; END IF;
  SELECT coalesce(array_to_string(p.proacl, ','), '') INTO v_acl FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
   WHERE n2.nspname = 'public' AND p.proname = 'is_phone_connected';
  IF v_acl LIKE '%anon=%' THEN RAISE EXCEPTION 'R9 anon must hold no EXECUTE, acl=%', v_acl; END IF;
  IF v_acl NOT LIKE '%authenticated=X%' OR v_acl NOT LIKE '%service_role=X%' THEN
    RAISE EXCEPTION 'R9 authenticated and service_role must hold EXECUTE, acl=%', v_acl; END IF;
  -- the heartbeat writer stays SECURITY DEFINER (it must write the caller's own row under RLS)
  SELECT p.prosecdef INTO v_secdef FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
   WHERE n2.nspname = 'public' AND p.proname = 'heartbeat_phone_registration';
  IF NOT v_secdef THEN RAISE EXCEPTION 'R9 heartbeat_phone_registration must stay SECURITY DEFINER'; END IF;
  -- the table keeps RLS on, exactly its two org-scoped SELECT policies, and no write policy
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace
   WHERE n2.nspname='public' AND c.relname='agent_phone_registrations' AND c.relrowsecurity;
  IF n <> 1 THEN RAISE EXCEPTION 'R9 RLS must stay enabled on agent_phone_registrations'; END IF;
  SELECT count(*) INTO n FROM pg_policy WHERE polrelid = 'public.agent_phone_registrations'::regclass;
  IF n <> 2 THEN RAISE EXCEPTION 'R9 exactly two policies expected, got %', n; END IF;
  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid = 'public.agent_phone_registrations'::regclass AND polcmd <> 'r';
  IF n <> 0 THEN RAISE EXCEPTION 'R9 no write policy may exist, got %', n; END IF;
  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid = 'public.agent_phone_registrations'::regclass
     AND pg_get_expr(polqual, polrelid) LIKE '%get_org_id()%';
  IF n <> 2 THEN RAISE EXCEPTION 'R9 both policies must be organization-scoped, got %', n; END IF;
END $$;

ROLLBACK;
