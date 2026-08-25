-- =====================================================================================================
-- Twilio-authoritative claim CAS + C1 zero-write idempotency + R23/C2 ACLs — SQL tests (plan rev 5 §11)
-- =====================================================================================================
-- STATUS: disposable LOCAL stack only. Apply inbound_harness.sql → M1 → M2, then run with ON_ERROR_STOP=1.
-- claim_inbound_call is invoked exactly as production does: through the service_role, with the
-- wrapper-verified p_user_id (R1/R13). Whole file rolls back.

BEGIN;

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','Claim Org A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','Claim Org B');
INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2'),
  ('aaaaaaaa-0000-0000-0000-0000000000e1'),
  ('aaaaaaaa-0000-0000-0000-0000000000f1'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1');
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity, first_name, last_name) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a1','Ag','One'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a2','Ag','Two'),
  ('aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Inactive','agent_i1','In','Active'),
  ('aaaaaaaa-0000-0000-0000-0000000000f1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active',NULL,'No','Identity'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','Agent','Active','agent_b1','Bee','One');

CREATE OR REPLACE FUNCTION pg_temp.mk_ring(p_id uuid, p_sid text, p_routed uuid[]) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid,
                            contact_phone, caller_id_used, routed_agent_ids, contact_type)
  VALUES (p_id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'inbound', 'ringing', p_sid,
          '+19995551234', '+15550001111', p_routed, NULL)
$$;

CREATE OR REPLACE FUNCTION pg_temp.upd_count() RETURNS integer
LANGUAGE sql AS $$ SELECT n FROM public.harness_trigger_counts WHERE k = 'calls_update' $$;

-- ── K1 (T12/T16): first claim wins — one atomic write; child SID stored; parent SID untouched ───────
DO $$
DECLARE r jsonb; c public.calls%ROWTYPE; v_upd int;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.mk_ring('cccccccc-0000-0000-0000-000000000001','CA000000000000000000000000000000a1',
            ARRAY['aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-0000000000a2']::uuid[]);
  v_upd := pg_temp.upd_count();
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a1',
        'cccccccc-0000-0000-0000-000000000001',
        'CA000000000000000000000000000000c1', 'CA000000000000000000000000000000a1');
  RESET ROLE;
  IF (r->>'claimed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'K1 expected claimed, got %', r; END IF;
  SELECT * INTO c FROM public.calls WHERE id = 'cccccccc-0000-0000-0000-000000000001';
  IF c.agent_id <> 'aaaaaaaa-0000-0000-0000-0000000000a1' THEN RAISE EXCEPTION 'K1 wrong owner'; END IF;
  IF c.provider_session_id <> 'CA000000000000000000000000000000c1' THEN RAISE EXCEPTION 'K1 child SID not stored'; END IF;
  IF c.twilio_call_sid <> 'CA000000000000000000000000000000a1' THEN RAISE EXCEPTION 'K1 parent SID re-homed'; END IF;
  IF c.status <> 'connected' THEN RAISE EXCEPTION 'K1 ringing must advance to connected'; END IF;
  IF c.organization_id <> 'aaaaaaaa-0000-0000-0000-00000000000a' THEN RAISE EXCEPTION 'K1 org mutated'; END IF;
  IF c.provider_session_id IS NULL THEN RAISE EXCEPTION 'K1 provider_session_id NULL after success (R16)'; END IF;
  IF pg_temp.upd_count() <> v_upd + 1 THEN RAISE EXCEPTION 'K1 first write must fire exactly one update trigger'; END IF;
END $$;

-- ── K2 (C1): duplicate answered / completed / answered→completed ⇒ read-only, byte-identical row ────
DO $$
DECLARE r jsonb; snap jsonb; snap2 jsonb; v_upd int; i int;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT to_jsonb(c) INTO snap FROM public.calls c WHERE c.id = 'cccccccc-0000-0000-0000-000000000001';
  v_upd := pg_temp.upd_count();
  -- duplicate 'answered' delivery, duplicate 'completed' delivery, and the answered→completed pair all
  -- reach the RPC as identical (agent, child SID) claims — three consecutive redeliveries:
  FOR i IN 1..3 LOOP
    r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a1',
          'cccccccc-0000-0000-0000-000000000001',
          'CA000000000000000000000000000000c1', 'CA000000000000000000000000000000a1');
    IF (r->>'claimed')::boolean IS DISTINCT FROM true
       OR (r->>'idempotent')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'K2 redelivery % expected idempotent success, got %', i, r; END IF;
  END LOOP;
  SELECT to_jsonb(c) INTO snap2 FROM public.calls c WHERE c.id = 'cccccccc-0000-0000-0000-000000000001';
  RESET ROLE;
  IF snap <> snap2 THEN RAISE EXCEPTION 'K2 duplicate mutated the row (updated_at included): % vs %', snap, snap2; END IF;
  IF pg_temp.upd_count() <> v_upd THEN RAISE EXCEPTION 'K2 duplicate fired an update trigger'; END IF;
END $$;

-- ── K3 (T13): losing agent cannot overwrite the winner ──────────────────────────────────────────────
DO $$
DECLARE r jsonb; snap jsonb; snap2 jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT to_jsonb(c) INTO snap FROM public.calls c WHERE c.id = 'cccccccc-0000-0000-0000-000000000001';
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a2',
        'cccccccc-0000-0000-0000-000000000001',
        'CA000000000000000000000000000000c2', 'CA000000000000000000000000000000a1');
  SELECT to_jsonb(c) INTO snap2 FROM public.calls c WHERE c.id = 'cccccccc-0000-0000-0000-000000000001';
  RESET ROLE;
  IF (r->>'claimed')::boolean IS DISTINCT FROM false OR r->>'reason' <> 'already_claimed' THEN
    RAISE EXCEPTION 'K3 expected already_claimed, got %', r; END IF;
  IF snap <> snap2 THEN RAISE EXCEPTION 'K3 loser mutated the row'; END IF;
END $$;

-- ── K4 (R2): same agent, DIFFERENT child SID ⇒ sid_conflict; first leg preserved ────────────────────
DO $$
DECLARE r jsonb; snap jsonb; snap2 jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT to_jsonb(c) INTO snap FROM public.calls c WHERE c.id = 'cccccccc-0000-0000-0000-000000000001';
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a1',
        'cccccccc-0000-0000-0000-000000000001',
        'CA000000000000000000000000000000c9', 'CA000000000000000000000000000000a1');
  SELECT to_jsonb(c) INTO snap2 FROM public.calls c WHERE c.id = 'cccccccc-0000-0000-0000-000000000001';
  RESET ROLE;
  IF (r->>'claimed')::boolean IS DISTINCT FROM false OR r->>'reason' <> 'sid_conflict' THEN
    RAISE EXCEPTION 'K4 expected sid_conflict, got %', r; END IF;
  IF snap <> snap2 THEN RAISE EXCEPTION 'K4 sid-conflict retry mutated the row'; END IF;
END $$;

-- ── K5 (T14/T15/R1): cross-org, non-routed, inactive, identity-less claims all rejected ─────────────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.mk_ring('cccccccc-0000-0000-0000-000000000002','CA000000000000000000000000000000a2',
            ARRAY['aaaaaaaa-0000-0000-0000-0000000000a1',
                  'aaaaaaaa-0000-0000-0000-0000000000e1',
                  'aaaaaaaa-0000-0000-0000-0000000000f1',
                  'bbbbbbbb-0000-0000-0000-0000000000b1']::uuid[]);
  -- cross-org: b1's DB-authoritative org is B; the row is org A
  r := public.claim_inbound_call('bbbbbbbb-0000-0000-0000-0000000000b1',
        'cccccccc-0000-0000-0000-000000000002',
        'CA000000000000000000000000000000c3', 'CA000000000000000000000000000000a2');
  IF (r->>'claimed')::boolean OR r->>'reason' <> 'cross_org_or_not_found' THEN
    RAISE EXCEPTION 'K5 cross-org expected cross_org_or_not_found, got %', r; END IF;
  -- non-routed active agent: a2 is NOT in row 2's routed list and row 2 is unclaimed
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a2',
        'cccccccc-0000-0000-0000-000000000002',
        'CA000000000000000000000000000000c4', 'CA000000000000000000000000000000a2');
  IF (r->>'claimed')::boolean OR r->>'reason' <> 'not_routed' THEN
    RAISE EXCEPTION 'K5 non-routed expected not_routed, got %', r; END IF;
  -- inactive profile (routed, but Inactive)
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000e1',
        'cccccccc-0000-0000-0000-000000000002',
        'CA000000000000000000000000000000c5', 'CA000000000000000000000000000000a2');
  IF (r->>'claimed')::boolean OR r->>'reason' <> 'inactive_profile' THEN
    RAISE EXCEPTION 'K5 inactive expected inactive_profile, got %', r; END IF;
  -- Active but no twilio_client_identity
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000f1',
        'cccccccc-0000-0000-0000-000000000002',
        'CA000000000000000000000000000000c6', 'CA000000000000000000000000000000a2');
  RESET ROLE;
  IF (r->>'claimed')::boolean OR r->>'reason' <> 'inactive_profile' THEN
    RAISE EXCEPTION 'K5 identity-less expected inactive_profile-class rejection, got %', r; END IF;
END $$;

-- ── K6 (R3): NULL / empty routed_agent_ids ⇒ fail closed (no_routed_agents) ─────────────────────────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.mk_ring('cccccccc-0000-0000-0000-000000000003','CA000000000000000000000000000000a3', NULL);
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a1',
        'cccccccc-0000-0000-0000-000000000003',
        'CA000000000000000000000000000000c7', 'CA000000000000000000000000000000a3');
  IF (r->>'claimed')::boolean OR r->>'reason' <> 'no_routed_agents' THEN
    RAISE EXCEPTION 'K6 NULL routed expected no_routed_agents, got %', r; END IF;
  UPDATE public.calls SET routed_agent_ids = ARRAY[]::uuid[] WHERE id = 'cccccccc-0000-0000-0000-000000000003';
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a1',
        'cccccccc-0000-0000-0000-000000000003',
        'CA000000000000000000000000000000c7', 'CA000000000000000000000000000000a3');
  RESET ROLE;
  IF (r->>'claimed')::boolean OR r->>'reason' <> 'no_routed_agents' THEN
    RAISE EXCEPTION 'K6 empty routed expected no_routed_agents, got %', r; END IF;
END $$;

-- ── K7 (R16): blank/malformed SIDs and wrong parent SID rejected before the CAS ─────────────────────
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a1',
        'cccccccc-0000-0000-0000-000000000002', '', 'CA000000000000000000000000000000a2');
  IF (r->>'claimed')::boolean OR r->>'reason' <> 'invalid_sid' THEN RAISE EXCEPTION 'K7 blank child, got %', r; END IF;
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a1',
        'cccccccc-0000-0000-0000-000000000002', 'CA-short', 'CA000000000000000000000000000000a2');
  IF (r->>'claimed')::boolean OR r->>'reason' <> 'invalid_sid' THEN RAISE EXCEPTION 'K7 malformed child, got %', r; END IF;
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a1',
        'cccccccc-0000-0000-0000-000000000002', 'CA000000000000000000000000000000c8', 'not-a-sid');
  IF (r->>'claimed')::boolean OR r->>'reason' <> 'invalid_sid' THEN RAISE EXCEPTION 'K7 malformed parent, got %', r; END IF;
  -- well-formed but WRONG parent SID for the row
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a1',
        'cccccccc-0000-0000-0000-000000000002',
        'CA000000000000000000000000000000c8', 'CA00000000000000000000000000000ffff');
  IF (r->>'claimed')::boolean OR r->>'reason' <> 'invalid_sid' THEN RAISE EXCEPTION 'K7 overlong parent, got %', r; END IF;
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a1',
        'cccccccc-0000-0000-0000-000000000002',
        'CA000000000000000000000000000000c8', 'CA000000000000000000000000000000ff');
  RESET ROLE;
  IF (r->>'claimed')::boolean OR r->>'reason' <> 'parent_sid_mismatch' THEN
    RAISE EXCEPTION 'K7 wrong parent expected parent_sid_mismatch, got %', r; END IF;
END $$;

-- ── K8 (R19): late claim on an already-terminal row ⇒ ownership enrichment, terminal state untouched ─
DO $$
DECLARE r jsonb; c public.calls%ROWTYPE; snap jsonb; snap2 jsonb; v_end timestamptz;
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone,
                            caller_id_used, routed_agent_ids, contact_type, duration, ended_at)
  VALUES ('cccccccc-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-00000000000a','inbound','completed',
          'CA000000000000000000000000000000a4','+19995551234','+15550001111',
          ARRAY['aaaaaaaa-0000-0000-0000-0000000000a1']::uuid[], NULL, 42, now() - interval '1 minute');
  SELECT ended_at INTO v_end FROM public.calls WHERE id = 'cccccccc-0000-0000-0000-000000000004';
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a1',
        'cccccccc-0000-0000-0000-000000000004',
        'CA000000000000000000000000000000ca', 'CA000000000000000000000000000000a4');
  IF (r->>'claimed')::boolean IS DISTINCT FROM true
     OR (r->>'enriched_terminal')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'K8 expected terminal enrichment success, got %', r; END IF;
  SELECT * INTO c FROM public.calls WHERE id = 'cccccccc-0000-0000-0000-000000000004';
  IF c.agent_id <> 'aaaaaaaa-0000-0000-0000-0000000000a1'
     OR c.provider_session_id <> 'CA000000000000000000000000000000ca' THEN
    RAISE EXCEPTION 'K8 ownership not enriched'; END IF;
  IF c.status <> 'completed' OR c.duration <> 42 OR c.ended_at IS DISTINCT FROM v_end THEN
    RAISE EXCEPTION 'K8 terminal metadata mutated (status % duration % ended_at %)', c.status, c.duration, c.ended_at; END IF;
  -- duplicate of the enrichment takes the C1 read-only path
  SELECT to_jsonb(x) INTO snap FROM public.calls x WHERE x.id = 'cccccccc-0000-0000-0000-000000000004';
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a1',
        'cccccccc-0000-0000-0000-000000000004',
        'CA000000000000000000000000000000ca', 'CA000000000000000000000000000000a4');
  SELECT to_jsonb(x) INTO snap2 FROM public.calls x WHERE x.id = 'cccccccc-0000-0000-0000-000000000004';
  RESET ROLE;
  IF (r->>'idempotent')::boolean IS DISTINCT FROM true OR snap <> snap2 THEN
    RAISE EXCEPTION 'K8 enrichment duplicate must be zero-write, got % (row changed: %)', r, snap <> snap2; END IF;
END $$;

-- ── K9 (R23/C2): EXECUTE ACL matrix, exact signatures ───────────────────────────────────────────────
DO $$
DECLARE
  svc_only text[] := ARRAY[
    'public.resolve_inbound_contact(uuid, text)',
    'public.ingest_inbound_call(text, uuid, text, text, boolean)',
    'public.find_last_agent_for_inbound(uuid, uuid, text)',
    'public.claim_inbound_call(uuid, uuid, text, text)',
    'public.finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean)'];
  auth_ok text[] := ARRAY[
    'public.phone_last10(text)',
    'public.get_inbound_call_identity(uuid)',
    'public.resolve_inbound_caller_display_name(text)',
    'public.peek_inbound_call_identity(text, text)'];
  f text;
BEGIN
  FOREACH f IN ARRAY svc_only LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION 'K9 anon must not EXECUTE %', f; END IF;
    IF has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION 'K9 authenticated must not EXECUTE %', f; END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN RAISE EXCEPTION 'K9 service_role must EXECUTE %', f; END IF;
  END LOOP;
  FOREACH f IN ARRAY auth_ok LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION 'K9 anon must not EXECUTE % (legacy anon grant?)', f; END IF;
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION 'K9 authenticated must EXECUTE %', f; END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN RAISE EXCEPTION 'K9 service_role must EXECUTE %', f; END IF;
  END LOOP;
END $$;

-- ── K10 (C2): authenticated expression-index maintenance still works under the hardened helper ACL ──
DO $$
DECLARE v_id uuid; r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','aaaaaaaa-0000-0000-0000-0000000000a1',
                      'org_id','aaaaaaaa-0000-0000-0000-00000000000a')::text, true);
  SET LOCAL ROLE authenticated;
  -- INSERT + UPDATE on each expression-indexed table must evaluate phone_last10 under role authenticated
  INSERT INTO public.leads (organization_id, phone, first_name, last_name)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','(650) 555-4321','Idx','Lead') RETURNING id INTO v_id;
  UPDATE public.leads SET phone = '(650) 555-9876' WHERE id = v_id;
  INSERT INTO public.clients (organization_id, phone, first_name, last_name)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','650.555.1111','Idx','Client');
  UPDATE public.clients SET phone = '650.555.2222' WHERE first_name = 'Idx' AND last_name = 'Client';
  INSERT INTO public.recruits (organization_id, phone, first_name, last_name)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','(650) 555 3333','Idx','Recruit');
  UPDATE public.recruits SET phone = '(650) 555 4444' WHERE first_name = 'Idx' AND last_name = 'Recruit';
  INSERT INTO public.calls (organization_id, direction, status, contact_phone, agent_id)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','outbound','completed','(650) 555-7777',
          'aaaaaaaa-0000-0000-0000-0000000000a1');
  UPDATE public.calls SET contact_phone = '(650) 555-8888'
   WHERE contact_phone = '(650) 555-7777' AND direction = 'outbound';
  RESET ROLE;
  -- and the rows are index-visible to the canonical resolver
  SET LOCAL ROLE service_role;
  r := public.resolve_inbound_contact('aaaaaaaa-0000-0000-0000-00000000000a', '+16505559876');
  RESET ROLE;
  IF r->>'resolution' <> 'unique' OR (r->>'contact_id')::uuid IS DISTINCT FROM v_id THEN
    RAISE EXCEPTION 'K10 authenticated-written row not resolvable via expression index, got %', r; END IF;
END $$;

ROLLBACK;
