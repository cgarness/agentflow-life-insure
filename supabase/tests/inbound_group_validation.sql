-- =====================================================================================================
-- Inbound Calling v2 — explicit inbound group validation + engine flag (M5) — SQL tests. LOCAL only.
-- =====================================================================================================
BEGIN;

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','Group Org A'), ('bbbbbbbb-0000-0000-0000-00000000000b','Group Org B') ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id)
SELECT ('aaaaaaaa-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid FROM generate_series(1, 12) i;
INSERT INTO auth.users (id) VALUES ('aaaaaaaa-0000-0000-0000-0000000000ad'), ('bbbbbbbb-0000-0000-0000-0000000000b1');
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity)
SELECT ('aaaaaaaa-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'aaaaaaaa-0000-0000-0000-00000000000a', 'Agent', 'Active', 'agent_' || i
  FROM generate_series(1, 12) i;
UPDATE public.profiles SET status = 'Inactive' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000011';
UPDATE public.profiles SET twilio_client_identity = NULL WHERE id = 'aaaaaaaa-0000-0000-0000-000000000012';
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000ad','aaaaaaaa-0000-0000-0000-00000000000a','Admin','Active','agent_ad'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','Agent','Active','agent_b1');
INSERT INTO public.inbound_routing_settings (organization_id) VALUES ('aaaaaaaa-0000-0000-0000-00000000000a');

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true); END $$;

-- G1: direct write dedups and stores a valid group; duplicates collapse
DO $$
DECLARE g uuid[];
BEGIN
  UPDATE public.inbound_routing_settings
     SET inbound_group_agent_ids = ARRAY['aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002']::uuid[]
   WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  SELECT inbound_group_agent_ids INTO g FROM public.inbound_routing_settings WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  IF cardinality(g) <> 2 THEN RAISE EXCEPTION 'G1 expected 2 distinct ids, got %', g; END IF;
END $$;

-- G2: >10 distinct, foreign-org, inactive, identity-less and null members are refused; v2 needs a group
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    UPDATE public.inbound_routing_settings SET inbound_group_agent_ids =
      (SELECT array_agg(('aaaaaaaa-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid) FROM generate_series(1, 11) i)
     WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'G2 eleven members must be refused';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    UPDATE public.inbound_routing_settings SET inbound_group_agent_ids = ARRAY['bbbbbbbb-0000-0000-0000-0000000000b1']::uuid[]
     WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'G2 foreign-org member must be refused';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    UPDATE public.inbound_routing_settings SET inbound_group_agent_ids = ARRAY['aaaaaaaa-0000-0000-0000-000000000011']::uuid[]
     WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'G2 inactive member must be refused';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    UPDATE public.inbound_routing_settings SET inbound_group_agent_ids = ARRAY['aaaaaaaa-0000-0000-0000-000000000012']::uuid[]
     WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'G2 identity-less member must be refused';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    UPDATE public.inbound_routing_settings SET inbound_group_agent_ids = ARRAY[NULL::uuid]
     WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'G2 null member must be refused';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  -- v2 without a group: CHECK + trigger both refuse
  BEGIN
    UPDATE public.inbound_routing_settings SET inbound_group_agent_ids = '{}', routing_engine = 'v2'
     WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'G2 v2 without group must be refused';
  EXCEPTION WHEN SQLSTATE '22023' OR check_violation THEN NULL; END;
  SELECT routing_engine = 'legacy' INTO ok FROM public.inbound_routing_settings WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  IF NOT ok THEN RAISE EXCEPTION 'G2 engine must remain legacy'; END IF;
END $$;

-- G3: set_inbound_group authorization comes from profiles (Agent refused, Admin allowed) and validates
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
  SET LOCAL ROLE authenticated;
  BEGIN
    r := public.set_inbound_group(ARRAY['aaaaaaaa-0000-0000-0000-000000000001']::uuid[]);
    RAISE EXCEPTION 'G3 Agent must be refused';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  RESET ROLE;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000ad');
  SET LOCAL ROLE authenticated;
  r := public.set_inbound_group(ARRAY['aaaaaaaa-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000004']::uuid[]);
  RESET ROLE;
  IF (r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'G3 admin set failed %', r; END IF;
  IF (SELECT cardinality(inbound_group_agent_ids) FROM public.inbound_routing_settings WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a') <> 2 THEN
    RAISE EXCEPTION 'G3 group not stored'; END IF;
END $$;

-- G4: set_inbound_routing_engine('v2') refuses without a fresh registration; succeeds after one; legacy flip is free
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000ad');
  SET LOCAL ROLE authenticated;
  BEGIN
    r := public.set_inbound_routing_engine('v2');
    RAISE EXCEPTION 'G4 v2 without a fresh registration must be refused';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  RESET ROLE;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
  SET LOCAL ROLE authenticated;
  PERFORM public.heartbeat_phone_registration('44444444-4444-4444-4444-444444444444', 1, true, 'registered', NULL);
  RESET ROLE;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000ad');
  SET LOCAL ROLE authenticated;
  r := public.set_inbound_routing_engine('v2');
  RESET ROLE;
  IF r->>'routing_engine' <> 'v2' OR (r->>'group_valid')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'G4 activation failed %', r; END IF;
  IF (SELECT routing_engine FROM public.inbound_routing_settings WHERE organization_id = 'aaaaaaaa-0000-0000-0000-00000000000a') <> 'v2' THEN
    RAISE EXCEPTION 'G4 engine not persisted'; END IF;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000ad');
  SET LOCAL ROLE authenticated;
  r := public.set_inbound_routing_engine('legacy');
  RESET ROLE;
  IF r->>'routing_engine' <> 'legacy' THEN RAISE EXCEPTION 'G4 legacy flip failed'; END IF;
END $$;

-- G5: P14 availability CHECK
DO $$
BEGIN
  BEGIN
    UPDATE public.profiles SET availability_status = 'Busy' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'G5 invalid availability must be refused';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.profiles SET availability_status = 'Do Not Disturb' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
END $$;

ROLLBACK;
