-- =====================================================================================================
-- Inbound Calling v2 — planner, atomic owner-mobile commitment, D13, acceptance/bridge evidence, busy
-- ceilings, finalize non-retraction (M6) — SQL tests. LOCAL disposable stack only. Whole file rolls back.
-- Every RPC is invoked as production does: through service_role.
-- =====================================================================================================
BEGIN;

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','Route Org A'), ('bbbbbbbb-0000-0000-0000-00000000000b','Route Org B') ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1'), ('aaaaaaaa-0000-0000-0000-0000000000a2'), ('aaaaaaaa-0000-0000-0000-0000000000a3'),
  ('aaaaaaaa-0000-0000-0000-0000000000a4'), ('aaaaaaaa-0000-0000-0000-0000000000ad'), ('bbbbbbbb-0000-0000-0000-0000000000b1');
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity, availability_status) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a1','Available'),  -- owner A
  ('aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a2','Available'),  -- group member
  ('aaaaaaaa-0000-0000-0000-0000000000a3','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a3','Available'),  -- group member
  ('aaaaaaaa-0000-0000-0000-0000000000a4','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a4','Available'),  -- number owner B
  ('aaaaaaaa-0000-0000-0000-0000000000ad','aaaaaaaa-0000-0000-0000-00000000000a','Admin','Active','agent_ad','Available'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','Agent','Active','agent_b1','Available');
INSERT INTO public.phone_numbers (id, organization_id, phone_number, assigned_to) VALUES
  ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','+15550001111','aaaaaaaa-0000-0000-0000-0000000000a4');
INSERT INTO public.inbound_routing_settings (organization_id, routing_engine, inbound_group_agent_ids)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'legacy', ARRAY['aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-0000000000a3']::uuid[]);
INSERT INTO public.agent_inbound_settings (agent_id, organization_id, mobile_forward_number) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','+15559990001');

CREATE OR REPLACE FUNCTION pg_temp.mk_call(p_id uuid, p_sid text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, contact_type)
  VALUES (p_id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'inbound', 'ringing', p_sid, '+19995551234', '+15550001111', NULL)
$$;
CREATE OR REPLACE FUNCTION pg_temp.connect(p uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.agent_phone_registrations (agent_id, registration_id, organization_id, seq, registered, registered_at, last_seen_at, last_state)
  VALUES (p, gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-00000000000a', 1, true, now(), now(), 'registered')
$$;
CREATE OR REPLACE FUNCTION pg_temp.disconnect(p uuid) RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.agent_phone_registrations WHERE agent_id = p
$$;
CREATE OR REPLACE FUNCTION pg_temp.plan(p_call uuid, p_owner uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.plan_inbound_route(p_call, 'aaaaaaaa-0000-0000-0000-00000000000a', p_owner, 'contact',
           ARRAY['aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-0000000000a3']::uuid[], 20)
$$;
CREATE OR REPLACE FUNCTION pg_temp.missed(p_call uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('is_missed', c.is_missed, 'reason', c.missed_reason, 'for', c.missed_for_agent_id,
                            'recipients', to_jsonb(c.missed_recipient_ids), 'agent_id', c.agent_id, 'outcome', c.outcome,
                            'answered_by', c.answered_by_agent_id, 'status', c.status)
    FROM public.calls c WHERE c.id = p_call
$$;

-- A1: owner Available + connected + not busy ⇒ owner_browser, owner reserved, ring timeout recorded, no missed mark
DO $$
DECLARE r jsonb; m jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.connect('aaaaaaaa-0000-0000-0000-0000000000a1');
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000001','CA000000000000000000000000000000a1');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000a1');
  RESET ROLE;
  IF (r->>'created')::boolean IS DISTINCT FROM true OR r->>'stage' <> 'owner_browser' THEN RAISE EXCEPTION 'A1 %', r; END IF;
  IF (r->'attempt'->>'browser_ring_timeout_sent')::int <> 20 THEN RAISE EXCEPTION 'A1 ring timeout not recorded'; END IF;
  IF NOT (r->'attempt'->'reserved_agent_ids') ? 'aaaaaaaa-0000-0000-0000-0000000000a1' THEN RAISE EXCEPTION 'A1 owner not reserved'; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000001');
  IF (m->>'is_missed')::boolean THEN RAISE EXCEPTION 'A1 must not be missed yet'; END IF;
END $$;

-- A2: duplicate initial webhook ⇒ created=false, attempt byte-identical, zero writes
DO $$
DECLARE r jsonb; s1 jsonb; s2 jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT to_jsonb(a) INTO s1 FROM public.inbound_route_attempts a WHERE call_id = 'cccccccc-0000-0000-0000-000000000001';
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000a1');
  SELECT to_jsonb(a) INTO s2 FROM public.inbound_route_attempts a WHERE call_id = 'cccccccc-0000-0000-0000-000000000001';
  RESET ROLE;
  IF (r->>'created')::boolean IS DISTINCT FROM false OR r->>'stage' <> 'owner_browser' THEN RAISE EXCEPTION 'A2 %', r; END IF;
  IF s1 <> s2 THEN RAISE EXCEPTION 'A2 duplicate mutated the attempt'; END IF;
END $$;

-- A3: a second call for the SAME owner while the first is ringing ⇒ busy (reservation) ⇒ owner_voicemail + D7 missed 'busy'
DO $$
DECLARE r jsonb; m jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000002','CA000000000000000000000000000000a2');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-0000000000a1');
  RESET ROLE;
  IF r->>'stage' <> 'owner_voicemail' OR r->'attempt'->>'eligibility_reason' <> 'owner_busy' THEN RAISE EXCEPTION 'A3 %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000002');
  IF (m->>'is_missed')::boolean IS DISTINCT FROM true OR m->>'reason' <> 'busy' OR m->>'for' <> 'aaaaaaaa-0000-0000-0000-0000000000a1' THEN
    RAISE EXCEPTION 'A3 missed mark wrong %', m; END IF;
  IF NOT (m->'recipients') ? 'aaaaaaaa-0000-0000-0000-0000000000a1' THEN RAISE EXCEPTION 'A3 recipients missing owner'; END IF;
END $$;

-- A4: browser timeout ⇒ advance_to_owner_mobile: attempt → owner_mobile AND D13 mark in ONE transaction (safeguard 1)
DO $$
DECLARE r jsonb; m jsonb; a public.inbound_route_attempts%ROWTYPE;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000001';
  r := public.advance_to_owner_mobile(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001');
  RESET ROLE;
  IF (r->>'forward')::boolean IS DISTINCT FROM true OR r->>'mobile' <> '+15559990001' THEN RAISE EXCEPTION 'A4 %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000001';
  IF a.stage <> 'owner_mobile' OR a.mobile_number_dialed <> '+15559990001' OR a.missed_marked_at IS NULL THEN RAISE EXCEPTION 'A4 attempt not committed'; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000001');
  IF (m->>'is_missed')::boolean IS DISTINCT FROM true OR m->>'reason' <> 'forwarded_to_mobile'
     OR m->>'for' <> 'aaaaaaaa-0000-0000-0000-0000000000a1' OR NOT (m->'recipients') ? 'aaaaaaaa-0000-0000-0000-0000000000a1' THEN
    RAISE EXCEPTION 'A4 D13 mark wrong %', m; END IF;
  -- duplicate Dial-action delivery ⇒ stage_mismatch with the persisted stage (handler re-emits the same TwiML)
  SET LOCAL ROLE service_role;
  r := public.advance_to_owner_mobile(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001');
  RESET ROLE;
  IF (r->>'updated')::boolean IS DISTINCT FROM false OR r->>'stage' <> 'owner_mobile' OR r->>'mobile' <> '+15559990001' THEN
    RAISE EXCEPTION 'A4 duplicate advance must report the persisted stage, got %', r; END IF;
END $$;

-- A5: Press 1 accepted; DialBridged=true ⇒ attribution WITHOUT clearing D13; leg end releases busy
DO $$
DECLARE r jsonb; m jsonb; a public.inbound_route_attempts%ROWTYPE;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000001';
  r := public.record_inbound_mobile_accept(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA000000000000000000000000000000c1', '1');
  IF (r->>'accept')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A5 accept %', r; END IF;
  -- accepted, leg open ⇒ owner busy
  IF NOT public.is_agent_busy('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a1', NULL) THEN
    RAISE EXCEPTION 'A5 accepted mobile conversation must count as busy'; END IF;
  r := public.record_inbound_mobile_bridge(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-0000000000a1', true, 'completed', 'CA000000000000000000000000000000c1', 42);
  RESET ROLE;
  IF (r->>'bridged')::boolean IS DISTINCT FROM true OR r->>'evidence' <> 'dial_bridged' THEN RAISE EXCEPTION 'A5 bridge %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000001');
  IF (m->>'is_missed')::boolean IS DISTINCT FROM true OR m->>'reason' <> 'forwarded_to_mobile' THEN RAISE EXCEPTION 'A5 D13 was cleared %', m; END IF;
  IF m->>'answered_by' <> 'aaaaaaaa-0000-0000-0000-0000000000a1' OR m->>'outcome' <> 'forwarded_answered' OR m->>'agent_id' IS NOT NULL THEN
    RAISE EXCEPTION 'A5 attribution wrong %', m; END IF;
  -- a late external-answer finalize after the bridge already attributed the call is a read-only no-op and
  -- must NOT retract is_missed (M6 replacement of the pre-D13 writer)
  SET LOCAL ROLE service_role;
  r := public.finalize_inbound_call_terminal('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'completed', false, true);
  IF (r->>'updated')::boolean IS DISTINCT FROM false OR r->>'reason' <> 'external_answer_already_recorded' THEN RAISE EXCEPTION 'A5 late external finalize %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000001');
  IF (m->>'is_missed')::boolean IS DISTINCT FROM true OR m->>'status' <> 'connected' THEN RAISE EXCEPTION 'A5 finalize retracted is_missed / changed status %', m; END IF;
  -- the parent's terminal callback (twilio-voice-status `completed`, or the stage handler's `done` finalize) ends the
  -- parent row; the child leg end releases the mobile occupancy — mirrors the real handler sequence
  r := public.finalize_inbound_call_terminal('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'completed', false, false);
  IF (r->>'updated')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A5 parent terminal finalize %', r; END IF;
  r := public.record_inbound_mobile_leg_end(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'CA000000000000000000000000000000c1', 'completed', 60);
  RESET ROLE;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000001';
  IF a.mobile_leg_ended_at IS NULL THEN RAISE EXCEPTION 'A5 leg end not recorded'; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000001');
  IF (m->>'is_missed')::boolean IS DISTINCT FROM true OR m->>'status' <> 'completed' OR m->>'outcome' <> 'forwarded_answered' THEN
    RAISE EXCEPTION 'A5 terminal state wrong %', m; END IF;
  IF public.is_agent_busy('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a1', NULL) THEN
    RAISE EXCEPTION 'A5 leg end must release busy'; END IF;
  -- with the parent ended but the child leg still open, the accepted-mobile ceiling is what keeps the owner busy
  -- (checked on the attempt, not on the ended parent row) — proven in A5b below on a fresh call
END $$;

-- A5b: parent ended before the child leg callback ⇒ owner stays busy on the accepted-mobile ceiling until the
--      leg end arrives; the external-answer finalize (parent status callback with proof) records the proof
--      WITHOUT retracting is_missed
DO $$
DECLARE r jsonb; m jsonb; a public.inbound_route_attempts%ROWTYPE;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.disconnect('aaaaaaaa-0000-0000-0000-0000000000a1');
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000051','CA00000000000000000000000000000a51');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000051','aaaaaaaa-0000-0000-0000-0000000000a1');
  IF r->>'stage' <> 'owner_mobile' THEN RAISE EXCEPTION 'A5b setup %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000051';
  r := public.record_inbound_mobile_accept(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000051',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA00000000000000000000000000000c51', '1');
  IF (r->>'accept')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A5b accept %', r; END IF;
  -- external-answer finalize (proof arrives before any bridge evidence) records outcome, ends the parent, keeps D13
  r := public.finalize_inbound_call_terminal('cccccccc-0000-0000-0000-000000000051', 'aaaaaaaa-0000-0000-0000-00000000000a', 'completed', false, true);
  IF (r->>'updated')::boolean IS DISTINCT FROM true OR (r->>'external_answer_recorded')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A5b external finalize %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000051');
  IF (m->>'is_missed')::boolean IS DISTINCT FROM true OR m->>'reason' <> 'forwarded_to_mobile' OR m->>'outcome' <> 'forwarded_answered' OR m->>'status' <> 'completed' THEN
    RAISE EXCEPTION 'A5b external finalize retracted D13 or wrong state %', m; END IF;
  -- parent ended, child leg not yet reported ⇒ still busy (accepted-mobile ceiling on the attempt)
  IF NOT public.is_agent_busy('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a1', NULL) THEN
    RAISE EXCEPTION 'A5b open mobile leg must keep the owner busy'; END IF;
  r := public.record_inbound_mobile_leg_end(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'CA00000000000000000000000000000c51', 'completed', 30);
  RESET ROLE;
  IF public.is_agent_busy('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a1', NULL) THEN
    RAISE EXCEPTION 'A5b leg end must release busy'; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id = 'cccccccc-0000-0000-0000-000000000051';
END $$;

-- A6: immediate OFFLINE forwarding (no registration) ⇒ attempt born in owner_mobile with D13 committed in the same call
DO $$
DECLARE r jsonb; m jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.disconnect('aaaaaaaa-0000-0000-0000-0000000000a1');
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000003','CA000000000000000000000000000000a3');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-0000000000a1');
  RESET ROLE;
  IF r->>'stage' <> 'owner_mobile' OR r->>'mobile' <> '+15559990001' OR r->'attempt'->>'missed_marked_at' IS NULL THEN RAISE EXCEPTION 'A6 %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000003');
  IF (m->>'is_missed')::boolean IS DISTINCT FROM true OR m->>'reason' <> 'forwarded_to_mobile' THEN RAISE EXCEPTION 'A6 D13 not committed %', m; END IF;
END $$;

-- A7: 'Offline' availability is NOT DND — it follows D3 (mobile), while On Break / DND go straight to voicemail (D11)
DO $$
DECLARE r jsonb; m jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id = 'cccccccc-0000-0000-0000-000000000003';
  UPDATE public.profiles SET availability_status = 'Offline' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  PERFORM pg_temp.connect('aaaaaaaa-0000-0000-0000-0000000000a1');   -- even with a fresh registration, Offline ⇒ not connected
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000004','CA000000000000000000000000000000a4');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-0000000000a1');
  IF r->>'stage' <> 'owner_mobile' THEN RAISE EXCEPTION 'A7 Offline must forward to mobile, got %', r; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id = 'cccccccc-0000-0000-0000-000000000004';
  UPDATE public.profiles SET availability_status = 'On Break' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000005','CA000000000000000000000000000000a5');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-0000000000a1');
  RESET ROLE;
  IF r->>'stage' <> 'owner_voicemail' OR r->'attempt'->>'eligibility_reason' <> 'owner_dnd' THEN RAISE EXCEPTION 'A7 On Break must go to voicemail %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000005');
  IF m->>'reason' <> 'dnd' THEN RAISE EXCEPTION 'A7 missed reason %', m; END IF;
  UPDATE public.profiles SET availability_status = 'Available' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id = 'cccccccc-0000-0000-0000-000000000005';
END $$;

-- A8: an intervening browser claim (agent_id set) refuses the mobile commitment; attempt stays owner_browser; no D13 mark
DO $$
DECLARE r jsonb; m jsonb; a public.inbound_route_attempts%ROWTYPE;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000006','CA000000000000000000000000000000a6');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-0000000000a1');
  IF r->>'stage' <> 'owner_browser' THEN RAISE EXCEPTION 'A8 setup %', r; END IF;
  UPDATE public.calls SET agent_id = 'aaaaaaaa-0000-0000-0000-0000000000a1', status = 'connected' WHERE id = 'cccccccc-0000-0000-0000-000000000006';
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000006';
  r := public.advance_to_owner_mobile(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000006');
  RESET ROLE;
  IF (r->>'forward')::boolean IS DISTINCT FROM false OR r->>'reason' <> 'call_not_forwardable' THEN RAISE EXCEPTION 'A8 %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000006';
  IF a.stage <> 'owner_browser' OR a.missed_marked_at IS NOT NULL THEN RAISE EXCEPTION 'A8 partial commit: stage=% marked=%', a.stage, a.missed_marked_at; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000006');
  IF (m->>'is_missed')::boolean THEN RAISE EXCEPTION 'A8 claimed call must not be missed'; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id = 'cccccccc-0000-0000-0000-000000000006';
  UPDATE public.calls SET ended_at = now(), status = 'completed' WHERE id = 'cccccccc-0000-0000-0000-000000000006';
END $$;

-- A9: DND set DURING the browser ring ⇒ advance refuses forwarding and routes to voicemail (D11 re-check)
DO $$
DECLARE r jsonb; m jsonb; a public.inbound_route_attempts%ROWTYPE;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000007','CA000000000000000000000000000000a7');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-0000000000a1');
  IF r->>'stage' <> 'owner_browser' THEN RAISE EXCEPTION 'A9 setup %', r; END IF;
  UPDATE public.profiles SET availability_status = 'Do Not Disturb' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000007';
  r := public.advance_to_owner_mobile(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000007');
  RESET ROLE;
  IF (r->>'forward')::boolean IS DISTINCT FROM false OR r->>'reason' <> 'dnd' OR r->>'stage' <> 'owner_voicemail' THEN RAISE EXCEPTION 'A9 %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000007');
  IF m->>'reason' <> 'dnd' OR (m->>'is_missed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A9 missed %', m; END IF;
  UPDATE public.profiles SET availability_status = 'Available' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id = 'cccccccc-0000-0000-0000-000000000007';
END $$;

-- A10: acceptance variants — no digit, wrong digit, Press 1 after the caller hung up (never a connected conversation)
DO $$
DECLARE r jsonb; m jsonb; a public.inbound_route_attempts%ROWTYPE;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.disconnect('aaaaaaaa-0000-0000-0000-0000000000a1');
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000008','CA000000000000000000000000000000a8');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-0000000000a1');
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000008';
  r := public.record_inbound_mobile_accept(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000008',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA000000000000000000000000000000c8', '');
  IF r->>'result' <> 'no_digit' THEN RAISE EXCEPTION 'A10 no_digit %', r; END IF;
  -- bridge evidence for a non-accepted leg is not_bridged even if DialBridged arrived true
  r := public.record_inbound_mobile_bridge(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000008',
        'aaaaaaaa-0000-0000-0000-0000000000a1', true, 'completed', 'CA000000000000000000000000000000c8', 9);
  IF r->>'evidence' <> 'not_bridged' THEN RAISE EXCEPTION 'A10 non-accepted must be not_bridged %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000008');
  IF m->>'answered_by' IS NOT NULL OR coalesce(m->>'outcome','') = 'forwarded_answered' THEN RAISE EXCEPTION 'A10 attribution leaked %', m; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id = 'cccccccc-0000-0000-0000-000000000008';

  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000009','CA000000000000000000000000000000a9');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-0000000000a1');
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000009';
  UPDATE public.calls SET ended_at = now(), status = 'completed' WHERE id = 'cccccccc-0000-0000-0000-000000000009';   -- caller hung up
  r := public.record_inbound_mobile_accept(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000009',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA000000000000000000000000000000c9', '1');
  IF r->>'result' <> 'accepted_after_hangup' OR (r->>'accept')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'A10 after-hangup %', r; END IF;
  r := public.record_inbound_mobile_bridge(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000009',
        'aaaaaaaa-0000-0000-0000-0000000000a1', NULL, 'completed', 'CA000000000000000000000000000000c9', 1);
  RESET ROLE;
  IF r->>'evidence' <> 'not_bridged' THEN RAISE EXCEPTION 'A10 after-hangup must never attribute %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000009');
  IF (m->>'is_missed')::boolean IS DISTINCT FROM true OR m->>'answered_by' IS NOT NULL THEN RAISE EXCEPTION 'A10 %', m; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id = 'cccccccc-0000-0000-0000-000000000009';
END $$;

-- A11: DialBridged ABSENT for an accepted leg ⇒ unconfirmed: no attribution, no outcome, D13 intact (safeguard 5)
DO $$
DECLARE r jsonb; m jsonb; a public.inbound_route_attempts%ROWTYPE;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000010','CA00000000000000000000000000000a10');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000010','aaaaaaaa-0000-0000-0000-0000000000a1');
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000010';
  r := public.record_inbound_mobile_accept(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000010',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA00000000000000000000000000000c10', '1');
  r := public.record_inbound_mobile_bridge(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000010',
        'aaaaaaaa-0000-0000-0000-0000000000a1', NULL, 'completed', 'CA00000000000000000000000000000c10', 1);
  IF r->>'evidence' <> 'unconfirmed' OR (r->>'attributed')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'A11 %', r; END IF;
  -- idempotent redelivery keeps the first evidence
  r := public.record_inbound_mobile_bridge(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000010',
        'aaaaaaaa-0000-0000-0000-0000000000a1', true, 'completed', 'CA00000000000000000000000000000c10', 1);
  RESET ROLE;
  IF r->>'evidence' <> 'unconfirmed' OR (r->>'idempotent')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A11 redelivery changed evidence %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000010');
  IF m->>'answered_by' IS NOT NULL OR (m->>'is_missed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A11 %', m; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id = 'cccccccc-0000-0000-0000-000000000010';
END $$;

-- A12: group mode — none eligible ⇒ group_voicemail + missed group_empty with the configured group as recipients;
--      eligible members ⇒ one simultaneous reservation; busy member excluded; second call sees reservation
DO $$
DECLARE r jsonb; m jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000011','CA00000000000000000000000000000a11');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000011', NULL);
  IF r->>'stage' <> 'group_voicemail' THEN RAISE EXCEPTION 'A12 no connected member ⇒ voicemail, got %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000011');
  IF m->>'reason' <> 'group_empty' OR NOT ((m->'recipients') ? 'aaaaaaaa-0000-0000-0000-0000000000a2' AND (m->'recipients') ? 'aaaaaaaa-0000-0000-0000-0000000000a3') THEN
    RAISE EXCEPTION 'A12 group recipients %', m; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id = 'cccccccc-0000-0000-0000-000000000011';

  PERFORM pg_temp.connect('aaaaaaaa-0000-0000-0000-0000000000a2');
  PERFORM pg_temp.connect('aaaaaaaa-0000-0000-0000-0000000000a3');
  UPDATE public.profiles SET availability_status = 'On Break' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a3';
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000012','CA00000000000000000000000000000a12');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000012', NULL);
  IF r->>'stage' <> 'group_browser' OR jsonb_array_length(r->'targets') <> 1 OR NOT (r->'targets') ? 'aaaaaaaa-0000-0000-0000-0000000000a2' THEN
    RAISE EXCEPTION 'A12 eligible wave wrong %', r; END IF;
  -- while a2 is reserved by the ringing wave, a call owned by a2 goes to voicemail (busy)
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000013','CA00000000000000000000000000000a13');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000013','aaaaaaaa-0000-0000-0000-0000000000a2');
  RESET ROLE;
  IF r->>'stage' <> 'owner_voicemail' OR r->'attempt'->>'eligibility_reason' <> 'owner_busy' THEN RAISE EXCEPTION 'A12 reservation not honored %', r; END IF;
  UPDATE public.profiles SET availability_status = 'Available' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a3';
END $$;

-- A13: stage ceilings — a ringing reservation older than 5 minutes no longer blocks; generic CAS + telemetry bound
DO $$
DECLARE r jsonb; a public.inbound_route_attempts%ROWTYPE; i int;
BEGIN
  SET LOCAL ROLE service_role;
  UPDATE public.inbound_route_attempts SET stage_started_at = now() - interval '6 minutes' WHERE call_id = 'cccccccc-0000-0000-0000-000000000012';
  IF public.is_agent_busy('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a2', NULL) THEN
    RAISE EXCEPTION 'A13 stale ringing reservation must expire'; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000012';
  r := public.advance_inbound_route_stage(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'group_browser', 'group_voicemail',
        jsonb_build_object('voicemail_kind', 'group', 'outcome', jsonb_build_object('dial_call_status', 'no-answer')));
  IF (r->>'updated')::boolean IS DISTINCT FROM true OR r->>'stage' <> 'group_voicemail' THEN RAISE EXCEPTION 'A13 CAS %', r; END IF;
  r := public.advance_inbound_route_stage(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'group_browser', 'group_voicemail', '{}'::jsonb);
  IF (r->>'updated')::boolean IS DISTINCT FROM false OR r->>'reason' <> 'stage_mismatch' THEN RAISE EXCEPTION 'A13 replay must be read-only %', r; END IF;
  FOR i IN 1..25 LOOP
    PERFORM public.append_inbound_provider_outcome(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', jsonb_build_object('event', 'tick', 'i', i));
  END LOOP;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
  RESET ROLE;
  IF jsonb_array_length(a.provider_outcomes) > 20 THEN RAISE EXCEPTION 'A13 telemetry not bounded (%)', jsonb_array_length(a.provider_outcomes); END IF;
  BEGIN
    SET LOCAL ROLE service_role;
    PERFORM public.advance_inbound_route_stage(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'group_voicemail', 'owner_mobile', '{}'::jsonb);
    RESET ROLE;
    RAISE EXCEPTION 'A13 owner_mobile must not be reachable through the generic CAS';
  EXCEPTION WHEN SQLSTATE '22023' THEN RESET ROLE; END;
END $$;

-- A14: ACLs — authenticated cannot call the planner or read attempts
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.plan_inbound_route('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', NULL, NULL, '{}'::uuid[], 20);
    RAISE EXCEPTION 'A14 authenticated must not execute plan_inbound_route';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    SELECT count(*) INTO n FROM public.inbound_route_attempts;
    RAISE EXCEPTION 'A14 authenticated must not read attempts';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
END $$;

ROLLBACK;
