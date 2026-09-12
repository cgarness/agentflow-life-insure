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

-- A15 (corrective pass, defect 3): a group wave where B answers releases A immediately — an assigned call
--     to A rings A's browser while the conversation with B is still in progress; B stays busy.
--     Concurrent cases: while the wave is UNANSWERED both stay reserved (simultaneous-call protection);
--     after the claim, a second group call rings only the non-answering member.
DO $$
DECLARE r jsonb; a public.inbound_route_attempts%ROWTYPE;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.connect('aaaaaaaa-0000-0000-0000-0000000000a2');
  PERFORM pg_temp.connect('aaaaaaaa-0000-0000-0000-0000000000a3');
  UPDATE public.profiles SET availability_status = 'Available' WHERE id IN ('aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-0000000000a3');
  UPDATE public.inbound_route_attempts SET terminal = true WHERE NOT terminal;   -- clean slate for this scenario
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000020','CA00000000000000000000000000000a20');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000020', NULL);
  IF r->>'stage' <> 'group_browser' OR jsonb_array_length(r->'targets') <> 2 THEN RAISE EXCEPTION 'A15 setup %', r; END IF;
  -- unanswered wave: BOTH reserved members are busy (a concurrent assigned call to either goes to voicemail)
  IF NOT public.is_agent_busy('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a2', NULL)
     OR NOT public.is_agent_busy('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a3', NULL) THEN
    RAISE EXCEPTION 'A15 unanswered wave must reserve both members'; END IF;
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000021','CA00000000000000000000000000000a21');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000021','aaaaaaaa-0000-0000-0000-0000000000a3');
  IF r->>'stage' <> 'owner_voicemail' OR r->'attempt'->>'eligibility_reason' <> 'owner_busy' THEN RAISE EXCEPTION 'A15 concurrent call during the wave must see the reservation %', r; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id = 'cccccccc-0000-0000-0000-000000000021';

  -- the AUTHORITATIVE browser claim (R14 routed persistence, then claim_inbound_call): a2 answers
  PERFORM public.append_call_routed_agents('cccccccc-0000-0000-0000-000000000020', 'aaaaaaaa-0000-0000-0000-00000000000a',
            ARRAY['aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-0000000000a3']::uuid[]);
  r := public.claim_inbound_call('aaaaaaaa-0000-0000-0000-0000000000a2', 'cccccccc-0000-0000-0000-000000000020',
         'CA00000000000000000000000000000c20', 'CA00000000000000000000000000000a20');
  IF (r->>'claimed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A15 claim failed %', r; END IF;
  -- the parent <Dial action> has NOT returned (the attempt is still group_browser): a3 is released NOW, a2 stays busy
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000020';
  IF a.stage <> 'group_browser' OR a.terminal THEN RAISE EXCEPTION 'A15 attempt should still be in the wave stage'; END IF;
  IF public.is_agent_busy('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a3', NULL) THEN
    RAISE EXCEPTION 'A15 losing member must be released once another member answered'; END IF;
  IF NOT public.is_agent_busy('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000a2', NULL) THEN
    RAISE EXCEPTION 'A15 the answering member must stay busy'; END IF;
  -- an assigned call to a3 immediately afterwards rings a3's browser
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000022','CA00000000000000000000000000000a22');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000022','aaaaaaaa-0000-0000-0000-0000000000a3');
  IF r->>'stage' <> 'owner_browser' THEN RAISE EXCEPTION 'A15 assigned call to the released member must ring, got %', r; END IF;
  -- an assigned call to a2 goes to voicemail (busy)
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000023','CA00000000000000000000000000000a23');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000023','aaaaaaaa-0000-0000-0000-0000000000a2');
  IF r->>'stage' <> 'owner_voicemail' OR r->'attempt'->>'eligibility_reason' <> 'owner_busy' THEN RAISE EXCEPTION 'A15 answering member must be busy %', r; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id IN ('cccccccc-0000-0000-0000-000000000022','cccccccc-0000-0000-0000-000000000023');
  -- a second GROUP call while a2 talks rings ONLY a3
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000024','CA00000000000000000000000000000a24');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000024', NULL);
  RESET ROLE;
  IF r->>'stage' <> 'group_browser' OR jsonb_array_length(r->'targets') <> 1 OR NOT (r->'targets') ? 'aaaaaaaa-0000-0000-0000-0000000000a3' THEN
    RAISE EXCEPTION 'A15 second group wave must ring only the free member %', r; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id IN ('cccccccc-0000-0000-0000-000000000020','cccccccc-0000-0000-0000-000000000024');
  UPDATE public.calls SET ended_at = now(), status = 'completed' WHERE id = 'cccccccc-0000-0000-0000-000000000020';
END $$;

-- A16 (defect 5): parent / child / destination / attempt / organization mismatches mutate nothing and attribute nothing
DO $$
DECLARE r jsonb; a public.inbound_route_attempts%ROWTYPE; m jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.disconnect('aaaaaaaa-0000-0000-0000-0000000000a1');
  UPDATE public.profiles SET availability_status = 'Available' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000030','CA00000000000000000000000000000a30');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000030','aaaaaaaa-0000-0000-0000-0000000000a1');
  IF r->>'stage' <> 'owner_mobile' THEN RAISE EXCEPTION 'A16 setup %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000030';
  -- whisper Gather with a foreign ParentCallSid ⇒ refused, nothing recorded
  r := public.record_inbound_mobile_accept(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000030',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA00000000000000000000000000000c30', '1', 'CA00000000000000000000000000000BAD', '+15559990001');
  IF r->>'reason' <> 'parent_sid_mismatch' THEN RAISE EXCEPTION 'A16 parent mismatch %', r; END IF;
  -- whisper Gather delivered to a different destination ⇒ refused
  r := public.record_inbound_mobile_accept(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000030',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA00000000000000000000000000000c30', '1', 'CA00000000000000000000000000000a30', '+15550009999');
  IF r->>'reason' <> 'destination_mismatch' THEN RAISE EXCEPTION 'A16 destination mismatch %', r; END IF;
  -- a 10-digit NON-NANP E.164 destination never collides with the +1 snapshot (the '+' means "as dialed")
  r := public.record_inbound_mobile_accept(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000030',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA00000000000000000000000000000c30', '1', 'CA00000000000000000000000000000a30', '+5559990001');
  IF r->>'reason' <> 'destination_mismatch' THEN RAISE EXCEPTION 'A16 E.164 collision %', r; END IF;
  -- wrong attempt / wrong organization ⇒ not found
  r := public.record_inbound_mobile_accept('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000030',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA00000000000000000000000000000c30', '1', 'CA00000000000000000000000000000a30', '+15559990001');
  IF r->>'reason' <> 'attempt_not_found' THEN RAISE EXCEPTION 'A16 attempt mismatch %', r; END IF;
  r := public.record_inbound_mobile_accept(a.id, 'bbbbbbbb-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-000000000030',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA00000000000000000000000000000c30', '1', 'CA00000000000000000000000000000a30', '+15559990001');
  IF r->>'reason' <> 'attempt_not_found' THEN RAISE EXCEPTION 'A16 org mismatch %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
  IF a.mobile_accepted_at IS NOT NULL OR a.mobile_child_call_sid IS NOT NULL THEN RAISE EXCEPTION 'A16 refused requests must record nothing'; END IF;
  -- the genuine request (formatted destination) is accepted and binds the child SID
  r := public.record_inbound_mobile_accept(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000030',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA00000000000000000000000000000c30', '1', 'CA00000000000000000000000000000a30', '(555) 999-0001');
  IF (r->>'accept')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A16 genuine accept %', r; END IF;
  -- Dial action with a foreign parent CallSid ⇒ unconfirmed, no attribution, evidence NOT recorded
  r := public.record_inbound_mobile_bridge(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000030',
        'aaaaaaaa-0000-0000-0000-0000000000a1', true, 'completed', 'CA00000000000000000000000000000c30', 30, 'CA00000000000000000000000000000BAD');
  IF r->>'reason' <> 'parent_sid_mismatch' OR (r->>'bridged')::boolean THEN RAISE EXCEPTION 'A16 bridge parent mismatch %', r; END IF;
  -- Dial action whose DialCallSid is not the accepted child ⇒ unconfirmed, no attribution, evidence NOT recorded
  r := public.record_inbound_mobile_bridge(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000030',
        'aaaaaaaa-0000-0000-0000-0000000000a1', true, 'completed', 'CA00000000000000000000000000000c99', 30, 'CA00000000000000000000000000000a30');
  IF r->>'reason' <> 'child_sid_mismatch' OR (r->>'bridged')::boolean THEN RAISE EXCEPTION 'A16 bridge child mismatch %', r; END IF;
  -- Dial action WITHOUT a DialCallSid once a child is bound ⇒ not a match either (absent ≠ accepted child)
  r := public.record_inbound_mobile_bridge(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000030',
        'aaaaaaaa-0000-0000-0000-0000000000a1', true, 'completed', NULL, 30, 'CA00000000000000000000000000000a30');
  IF r->>'reason' <> 'child_sid_mismatch' OR (r->>'bridged')::boolean THEN RAISE EXCEPTION 'A16 bridge absent child sid %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000030');
  IF a.mobile_bridge_evidence IS NOT NULL OR m->>'answered_by' IS NOT NULL OR coalesce(m->>'outcome','') = 'forwarded_answered' THEN
    RAISE EXCEPTION 'A16 mismatched Dial action must not attribute (evidence=% row=%)', a.mobile_bridge_evidence, m; END IF;
  -- child leg end with a foreign ParentCallSid ⇒ refused
  r := public.record_inbound_mobile_leg_end(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'CA00000000000000000000000000000c30', 'completed', 20, 'CA00000000000000000000000000000BAD');
  IF (r->>'updated')::boolean OR r->>'reason' <> 'parent_sid_mismatch' THEN RAISE EXCEPTION 'A16 leg end parent mismatch %', r; END IF;
  -- the genuine Dial action attributes; the genuine leg end lands
  r := public.record_inbound_mobile_bridge(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000030',
        'aaaaaaaa-0000-0000-0000-0000000000a1', true, 'completed', 'CA00000000000000000000000000000c30', 30, 'CA00000000000000000000000000000a30');
  IF (r->>'bridged')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A16 genuine bridge %', r; END IF;
  r := public.record_inbound_mobile_leg_end(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'CA00000000000000000000000000000c30', 'completed', 20, 'CA00000000000000000000000000000a30');
  RESET ROLE;
  IF (r->>'updated')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A16 genuine leg end %', r; END IF;
  -- normalization itself (private helper; callable here as the suite's owner, never by service_role)
  IF private.phone_digits_e164ish('+4412345678') = private.phone_digits_e164ish('+14412345678') THEN RAISE EXCEPTION 'A16 normalization collides'; END IF;
  IF private.phone_digits_e164ish('(555) 999-0001') <> private.phone_digits_e164ish('+15559990001') THEN RAISE EXCEPTION 'A16 national format must match'; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000030');
  IF m->>'answered_by' <> 'aaaaaaaa-0000-0000-0000-0000000000a1' OR (m->>'is_missed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A16 attribution/D13 %', m; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE id = a.id;
  UPDATE public.calls SET ended_at = now(), status = 'completed' WHERE id = 'cccccccc-0000-0000-0000-000000000030';
END $$;

-- A17 (defect 5): a repeated Gather request after the caller hung up never authorizes bridging; the original
--     acceptance fact is preserved separately.
DO $$
DECLARE r jsonb; a public.inbound_route_attempts%ROWTYPE;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000031','CA00000000000000000000000000000a31');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000031','aaaaaaaa-0000-0000-0000-0000000000a1');
  IF r->>'stage' <> 'owner_mobile' THEN RAISE EXCEPTION 'A17 setup %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000031';
  r := public.record_inbound_mobile_accept(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000031',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA00000000000000000000000000000c31', '1', 'CA00000000000000000000000000000a31', '+15559990001');
  IF (r->>'accept')::boolean IS DISTINCT FROM true OR (r->>'caller_present')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A17 first accept %', r; END IF;
  -- a repeated Gather while the caller is still there may bridge (idempotent)
  r := public.record_inbound_mobile_accept(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000031',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA00000000000000000000000000000c31', '1', 'CA00000000000000000000000000000a31', '+15559990001');
  IF (r->>'accept')::boolean IS DISTINCT FROM true OR (r->>'idempotent')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A17 replay while present %', r; END IF;
  -- the caller hangs up (parent terminal), then the Gather request is redelivered
  UPDATE public.calls SET ended_at = now(), status = 'completed' WHERE id = 'cccccccc-0000-0000-0000-000000000031';
  r := public.record_inbound_mobile_accept(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000031',
        'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA00000000000000000000000000000c31', '1', 'CA00000000000000000000000000000a31', '+15559990001');
  RESET ROLE;
  IF (r->>'accept')::boolean IS DISTINCT FROM false OR (r->>'caller_present')::boolean IS DISTINCT FROM false OR r->>'result' <> 'accepted' THEN
    RAISE EXCEPTION 'A17 replay after hangup must refuse bridging but keep the acceptance fact %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
  IF a.mobile_accept_result <> 'accepted' OR a.mobile_accepted_at IS NULL THEN RAISE EXCEPTION 'A17 original acceptance fact altered'; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE id = a.id;
END $$;

-- A18 (defect 3, adversarial review): the owner-mobile reservation before a GENUINE acceptance follows the parent —
--     an ended parent releases the owner; a late Gather after the caller hung up (accepted_after_hangup) never
--     re-reserves for the 4-hour ceiling; a wrong digit keeps the whisper (and the reservation) open only while the
--     parent and the leg are live. (A genuine acceptance keeps the approved A5b ceiling until the leg end arrives.)
DO $$
DECLARE r jsonb; a public.inbound_route_attempts%ROWTYPE;
  org constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a'; a1 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.disconnect(a1);
  UPDATE public.profiles SET availability_status = 'Available' WHERE id = a1;

  -- (1) the caller hangs up during the whisper; the Gather POST lands afterwards
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000032','CA00000000000000000000000000000a32');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000032', a1);
  IF r->>'stage' <> 'owner_mobile' THEN RAISE EXCEPTION 'A18 setup %', r; END IF;
  IF NOT public.is_agent_busy(org, a1, NULL) THEN RAISE EXCEPTION 'A18 the ringing mobile leg must reserve the owner'; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000032';
  UPDATE public.calls SET ended_at = now(), status = 'completed' WHERE id = 'cccccccc-0000-0000-0000-000000000032';
  IF public.is_agent_busy(org, a1, NULL) THEN RAISE EXCEPTION 'A18 an ended parent must release the owner'; END IF;
  r := public.record_inbound_mobile_accept(a.id, org, 'cccccccc-0000-0000-0000-000000000032', a1,
        'CA00000000000000000000000000000c32', '1', 'CA00000000000000000000000000000a32', '+15559990001');
  IF r->>'result' <> 'accepted_after_hangup' THEN RAISE EXCEPTION 'A18 late accept %', r; END IF;
  IF public.is_agent_busy(org, a1, NULL) THEN RAISE EXCEPTION 'A18 a late acceptance after the hangup must not re-reserve the owner'; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE id = a.id;

  -- (2) a wrong digit keeps the whisper open: reserved while the parent and the leg are live, released when the leg ends
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000033','CA00000000000000000000000000000a33');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000033', a1);
  IF r->>'stage' <> 'owner_mobile' THEN RAISE EXCEPTION 'A18 setup 2 %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000033';
  r := public.record_inbound_mobile_accept(a.id, org, 'cccccccc-0000-0000-0000-000000000033', a1,
        'CA00000000000000000000000000000c33', '2', 'CA00000000000000000000000000000a33', '+15559990001');
  IF r->>'result' <> 'wrong_digit' THEN RAISE EXCEPTION 'A18 wrong digit %', r; END IF;
  IF NOT public.is_agent_busy(org, a1, NULL) THEN RAISE EXCEPTION 'A18 a wrong digit keeps the whisper open — the owner stays reserved'; END IF;
  r := public.record_inbound_mobile_leg_end(a.id, org, 'CA00000000000000000000000000000c33', 'completed', 12, 'CA00000000000000000000000000000a33');
  IF (r->>'updated')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A18 leg end %', r; END IF;
  IF public.is_agent_busy(org, a1, NULL) THEN RAISE EXCEPTION 'A18 an ended mobile leg must release the owner'; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE id = a.id;
  UPDATE public.calls SET ended_at = now(), status = 'completed' WHERE id = 'cccccccc-0000-0000-0000-000000000033';

  RESET ROLE;
END $$;

-- A19 (corrective pass 3, finding 4): routing transitions that outlive the webhook deadline are refused on a call the
--     handler already answered on the failure path (finalized 'no-answer'): plan_inbound_route creates nothing
--     (call_terminal); a stage advance that rings, dials or records is refused on an ended parent (call_terminal) while
--     closing the attempt ('done') stays allowed; the owner-mobile commit (and its voicemail fallback) is refused too.
DO $$
DECLARE r jsonb; a public.inbound_route_attempts%ROWTYPE;
  org constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  a1 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  a2 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a2';
  a3 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a3';
BEGIN
  SET LOCAL ROLE service_role;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE NOT terminal;   -- clean slate
  UPDATE public.profiles SET availability_status = 'Available' WHERE id IN (a1, a2, a3);

  -- (1) the planning RPC lands AFTER the failure path finalized the call: nothing is created, nobody is reserved
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000034','CA00000000000000000000000000000a34');
  r := public.finalize_inbound_call_terminal('cccccccc-0000-0000-0000-000000000034', org, 'no-answer', true);
  IF (r->>'updated')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A19 setup finalize %', r; END IF;
  PERFORM pg_temp.connect(a1);
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000034', a1);
  IF (r->>'created')::boolean IS DISTINCT FROM false OR r->>'reason' <> 'call_terminal' THEN RAISE EXCEPTION 'A19 late plan %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000034') THEN
    RAISE EXCEPTION 'A19 an attempt was created on a finalized call'; END IF;
  IF public.is_agent_busy(org, a1, NULL) THEN RAISE EXCEPTION 'A19 a late plan must not reserve the owner'; END IF;

  -- (2) a group wave whose parent was finalized meanwhile: the advance into voicemail is refused; closing is allowed
  PERFORM pg_temp.connect(a2); PERFORM pg_temp.connect(a3);
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000035','CA00000000000000000000000000000a35');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000035', NULL);
  IF r->>'stage' <> 'group_browser' THEN RAISE EXCEPTION 'A19 setup group %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000035';
  r := public.finalize_inbound_call_terminal('cccccccc-0000-0000-0000-000000000035', org, 'no-answer', true);
  -- (corrective pass 4) the finalize itself CLOSED the open ring stage atomically; the late advance is refused
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
  IF NOT a.terminal OR a.final_outcome <> 'parent_no-answer' OR cardinality(a.reserved_agent_ids) <> 0 THEN
    RAISE EXCEPTION 'A19 finalize must close the open ring stage atomically, got % / %', a.terminal, a.final_outcome; END IF;
  IF public.is_agent_busy(org, a2, NULL) OR public.is_agent_busy(org, a3, NULL) THEN RAISE EXCEPTION 'A19 members must be released'; END IF;
  r := public.advance_inbound_route_stage(a.id, org, 'group_browser', 'group_voicemail',
         '{"voicemail_kind":"group","outcome":{"event":"dial_action","dial_call_status":"no-answer"}}'::jsonb);
  IF (r->>'updated')::boolean IS DISTINCT FROM false OR r->>'reason' <> 'call_terminal' OR r->>'stage' <> 'group_browser' THEN
    RAISE EXCEPTION 'A19 late advance into voicemail must be refused %', r; END IF;
  -- closing a still-open VOICEMAIL stage after the parent ended stays allowed (the recording callback path)
  PERFORM pg_temp.disconnect(a2); PERFORM pg_temp.disconnect(a3);
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000038','CA00000000000000000000000000000a38');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000038', NULL);
  IF r->>'stage' <> 'group_voicemail' THEN RAISE EXCEPTION 'A19 setup voicemail %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000038';
  r := public.finalize_inbound_call_terminal('cccccccc-0000-0000-0000-000000000038', org, 'completed', false);
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
  IF a.terminal THEN RAISE EXCEPTION 'A19 a voicemail stage must NOT be closed by the parent finalize'; END IF;
  r := public.advance_inbound_route_stage(a.id, org, 'group_voicemail', 'done', '{"final_outcome":"voicemail"}'::jsonb);
  IF (r->>'updated')::boolean IS DISTINCT FROM true OR (r->>'terminal')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A19 closing the voicemail attempt must stay allowed after the parent ended %', r; END IF;
  PERFORM pg_temp.connect(a2); PERFORM pg_temp.connect(a3);

  -- (3) the owner-mobile commit on a finalized parent: refused before any stage change (no dial, no voicemail stage)
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000036','CA00000000000000000000000000000a36');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000036', a1);
  IF r->>'stage' <> 'owner_browser' THEN RAISE EXCEPTION 'A19 setup owner %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000036';
  r := public.finalize_inbound_call_terminal('cccccccc-0000-0000-0000-000000000036', org, 'no-answer', true);
  r := public.advance_to_owner_mobile(a.id, org, 'cccccccc-0000-0000-0000-000000000036');
  IF (r->>'updated')::boolean IS DISTINCT FROM false OR r->>'reason' <> 'call_terminal' THEN RAISE EXCEPTION 'A19 late mobile commit %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
  IF a.stage <> 'owner_browser' OR a.mobile_number_dialed IS NOT NULL THEN RAISE EXCEPTION 'A19 the attempt must be untouched, got %', a.stage; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE id = a.id;

  -- (4) the ordinary flow is unchanged: a LIVE parent still advances into voicemail and into the mobile dial
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000037','CA00000000000000000000000000000a37');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000037', NULL);
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000037';
  r := public.advance_inbound_route_stage(a.id, org, 'group_browser', 'group_voicemail', '{"voicemail_kind":"group"}'::jsonb);
  IF (r->>'updated')::boolean IS DISTINCT FROM true OR r->>'stage' <> 'group_voicemail' THEN RAISE EXCEPTION 'A19 live advance %', r; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE id = a.id;
  UPDATE public.calls SET ended_at = now(), status = 'completed' WHERE id IN ('cccccccc-0000-0000-0000-000000000037');
  RESET ROLE;
END $$;

-- A20 (corrective pass 4): the ONE atomic failure decision and the durable recovery.
--     abandon_inbound_routing finalizes 'no-answer', records the D13 classification (recipients = what was reserved,
--     for-agent = the owner) and closes the open ring stage in one transaction; an answered call is never marked;
--     sweep_inbound_route_attempts closes ring stages left open on a terminal parent after the grace period and
--     abandons stale ringing calls; voicemail stages and telemetry are untouched.
DO $$
DECLARE r jsonb; a public.inbound_route_attempts%ROWTYPE; m jsonb;
  org constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  a1 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  a2 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a2';
  a3 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a3';
BEGIN
  SET LOCAL ROLE service_role;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE NOT terminal;
  UPDATE public.profiles SET availability_status = 'Available' WHERE id IN (a1, a2, a3);
  PERFORM pg_temp.connect(a1);

  -- (1) owner ring in flight, the webhook abandons: finalized + D13 + closed + released, in one call
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000040','CA00000000000000000000000000000a40');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000040', a1);
  IF r->>'stage' <> 'owner_browser' THEN RAISE EXCEPTION 'A20 setup %', r; END IF;
  IF NOT public.is_agent_busy(org, a1, NULL) THEN RAISE EXCEPTION 'A20 setup: owner reserved'; END IF;
  r := public.abandon_inbound_routing('cccccccc-0000-0000-0000-000000000040', org, 'deadline');
  -- the finalize inside abandon already closed the ring stage atomically (attempts_closed counts only stragglers)
  IF (r->>'updated')::boolean IS DISTINCT FROM true OR (r->'finalize'->>'updated')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A20 abandon %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000040');
  IF m->>'status' <> 'no-answer' OR (m->>'is_missed')::boolean IS DISTINCT FROM true OR m->>'reason' <> 'no_answer'
     OR (m->>'for')::uuid <> a1 OR NOT (m->'recipients') ? a1::text THEN RAISE EXCEPTION 'A20 D13 classification %', m; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000040';
  IF NOT a.terminal OR a.final_outcome NOT IN ('parent_no-answer','abandoned:deadline') OR cardinality(a.reserved_agent_ids) <> 0 THEN
    RAISE EXCEPTION 'A20 attempt must be closed, got % / %', a.terminal, a.final_outcome; END IF;
  IF public.is_agent_busy(org, a1, NULL) THEN RAISE EXCEPTION 'A20 the owner must be released'; END IF;
  r := public.abandon_inbound_routing('cccccccc-0000-0000-0000-000000000040', org, 'deadline');   -- idempotent replay
  IF (r->>'attempts_closed')::int <> 0 THEN RAISE EXCEPTION 'A20 abandon replay %', r; END IF;

  -- (2) a claimed (answered) call is never abandoned/marked missed (D13 monotonic)
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000041','CA00000000000000000000000000000a41');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000041', a1);
  UPDATE public.calls SET agent_id = a1, status = 'connected' WHERE id = 'cccccccc-0000-0000-0000-000000000041';
  r := public.abandon_inbound_routing('cccccccc-0000-0000-0000-000000000041', org, 'deadline');
  IF (r->>'updated')::boolean IS DISTINCT FROM false OR r->>'reason' <> 'answered' THEN RAISE EXCEPTION 'A20 answered %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000041');
  IF (m->>'is_missed')::boolean IS TRUE THEN RAISE EXCEPTION 'A20 an answered call was marked missed'; END IF;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE call_id = 'cccccccc-0000-0000-0000-000000000041';
  UPDATE public.calls SET ended_at = now(), status = 'completed' WHERE id = 'cccccccc-0000-0000-0000-000000000041';

  -- (3) durable recovery: a ring stage left open on a terminal parent is swept after the grace period only
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000042','CA00000000000000000000000000000a42');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000042', a1);
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000042';
  UPDATE public.calls SET ended_at = now(), status = 'completed' WHERE id = 'cccccccc-0000-0000-0000-000000000042';   -- a raw projection, no finalize
  r := public.sweep_inbound_route_attempts(interval '2 minutes', interval '30 minutes', 100);
  IF (r->>'attempts_closed')::int <> 0 THEN RAISE EXCEPTION 'A20 sweep must respect the grace period %', r; END IF;
  UPDATE public.inbound_route_attempts SET updated_at = now() - interval '3 minutes' WHERE id = a.id;
  r := public.sweep_inbound_route_attempts(interval '2 minutes', interval '30 minutes', 100);
  IF (r->>'attempts_closed')::int <> 1 THEN RAISE EXCEPTION 'A20 sweep %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
  IF NOT a.terminal OR a.final_outcome <> 'swept:parent_terminal' THEN RAISE EXCEPTION 'A20 swept attempt %', a.final_outcome; END IF;

  -- (4) durable recovery: a call still ringing long after it started, with no claim and no callback, is abandoned
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000043','CA00000000000000000000000000000a43');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000043', a1);
  UPDATE public.calls SET created_at = now() - interval '45 minutes' WHERE id = 'cccccccc-0000-0000-0000-000000000043';
  r := public.sweep_inbound_route_attempts(interval '2 minutes', interval '30 minutes', 100);
  IF (r->>'calls_abandoned')::int <> 1 THEN RAISE EXCEPTION 'A20 stale ringing sweep %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000043');
  IF m->>'status' <> 'no-answer' OR m->>'reason' <> 'no_answer' OR (m->>'for')::uuid <> a1 THEN RAISE EXCEPTION 'A20 stale ringing D13 %', m; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000043';
  IF a.final_outcome NOT IN ('parent_no-answer','abandoned:stale_ringing') THEN RAISE EXCEPTION 'A20 stale ringing attempt outcome %', a.final_outcome; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000043';
  IF NOT a.terminal THEN RAISE EXCEPTION 'A20 stale ringing attempt must be closed'; END IF;
  IF public.is_agent_busy(org, a1, NULL) THEN RAISE EXCEPTION 'A20 stale ringing must release the owner'; END IF;

  -- (5) late telemetry still lands on a closed attempt (mobile leg end), and the notification sweep sees the D13 row
  IF NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.id = 'cccccccc-0000-0000-0000-000000000040' AND c.is_missed
                    AND c.missed_notified_at IS NULL AND cardinality(c.missed_recipient_ids) > 0) THEN
    RAISE EXCEPTION 'A20 the abandoned call must be owed a notification for the durable sweep'; END IF;
  RESET ROLE;
END $$;

-- A21 (corrective pass 5, finding 3): GROUP recipients are preserved before any finalizer clears the reservation,
--     the empty-array fallback is deliberate, and the notification converges to exactly one alert per intended agent.
DO $$
DECLARE r jsonb; a public.inbound_route_attempts%ROWTYPE; m jsonb; n integer;
  org constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  a1 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  a2 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a2';
  a3 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a3';
BEGIN
  SET LOCAL ROLE service_role;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE NOT terminal;
  UPDATE public.profiles SET availability_status = 'Available' WHERE id IN (a1, a2, a3);
  PERFORM pg_temp.connect(a2); PERFORM pg_temp.connect(a3);
  DELETE FROM public.notifications WHERE type = 'missed_call';

  -- (1) group ring abandoned with NO explicit recipients ⇒ the reserved members, not an empty array
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000080','CA00000000000000000000000000000a80');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000080', NULL);
  IF r->>'stage' <> 'group_browser' OR jsonb_array_length(r->'targets') <> 2 THEN RAISE EXCEPTION 'A21 setup %', r; END IF;
  r := public.abandon_inbound_routing('cccccccc-0000-0000-0000-000000000080', org, 'deadline');
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000080');
  IF NOT ((m->'recipients') ? a2::text AND (m->'recipients') ? a3::text AND jsonb_array_length(m->'recipients') = 2) THEN
    RAISE EXCEPTION 'A21 (1) recipients must be the reserved group members, got %', m; END IF;

  -- (2) no attempt, a populated legacy routed set ⇒ the routed agents
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000081','CA00000000000000000000000000000a81');
  UPDATE public.calls SET routed_agent_ids = ARRAY[a2] WHERE id = 'cccccccc-0000-0000-0000-000000000081';
  r := public.abandon_inbound_routing('cccccccc-0000-0000-0000-000000000081', org, 'deadline');
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000081');
  IF NOT ((m->'recipients') ? a2::text AND jsonb_array_length(m->'recipients') = 1) THEN RAISE EXCEPTION 'A21 (2) routed fallback %', m; END IF;

  -- (3) planning committed but routed-agent persistence never completed ⇒ the attempt's reservation
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000082','CA00000000000000000000000000000a82');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000082', NULL);
  IF EXISTS (SELECT 1 FROM public.calls WHERE id = 'cccccccc-0000-0000-0000-000000000082' AND cardinality(coalesce(routed_agent_ids,'{}')) > 0) THEN
    RAISE EXCEPTION 'A21 (3) setup: routed set must be empty'; END IF;
  r := public.abandon_inbound_routing('cccccccc-0000-0000-0000-000000000082', org, 'deadline');
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000082');
  IF NOT ((m->'recipients') ? a2::text AND (m->'recipients') ? a3::text) THEN RAISE EXCEPTION 'A21 (3) reservation snapshot %', m; END IF;

  -- (4) ANOTHER finalizer wins first (the status-callback writer clears the reservation): the snapshot is
  --     preserved at that moment, and a later abandonment keeps it
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000083','CA00000000000000000000000000000a83');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000083', NULL);
  r := public.finalize_inbound_call_terminal('cccccccc-0000-0000-0000-000000000083', org, 'no-answer', true);
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000083';
  IF NOT a.terminal OR cardinality(a.reserved_agent_ids) <> 0 THEN RAISE EXCEPTION 'A21 (4) finalize must close + clear'; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000083');
  IF NOT ((m->'recipients') ? a2::text AND (m->'recipients') ? a3::text) THEN RAISE EXCEPTION 'A21 (4) the finalizer must preserve the reserved members before clearing them, got %', m; END IF;
  r := public.abandon_inbound_routing('cccccccc-0000-0000-0000-000000000083', org, 'deadline');
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000083');
  IF NOT ((m->'recipients') ? a2::text AND (m->'recipients') ? a3::text AND jsonb_array_length(m->'recipients') = 2) THEN
    RAISE EXCEPTION 'A21 (4) abandonment after the finalizer must keep the snapshot %', m; END IF;

  -- (5) repeated abandonment + notification convergence ⇒ exactly ONE alert per intended agent, labelled
  r := public.abandon_inbound_routing('cccccccc-0000-0000-0000-000000000080', org, 'deadline');
  r := public.converge_inbound_notifications('cccccccc-0000-0000-0000-000000000080');
  r := public.converge_inbound_notifications('cccccccc-0000-0000-0000-000000000080');
  SELECT count(*) INTO n FROM public.notifications WHERE event_key = 'missed_call:cccccccc-0000-0000-0000-000000000080';
  IF n <> 2 THEN RAISE EXCEPTION 'A21 (5) expected exactly one alert per member (2), got %', n; END IF;
  IF (SELECT count(DISTINCT user_id) FROM public.notifications WHERE event_key = 'missed_call:cccccccc-0000-0000-0000-000000000080' AND user_id IN (a2, a3)) <> 2 THEN
    RAISE EXCEPTION 'A21 (5) the alerts must go to a2 and a3'; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE event_key = 'missed_call:cccccccc-0000-0000-0000-000000000080' AND user_id = a1) THEN
    RAISE EXCEPTION 'A21 (5) an agent who was not rung must not be alerted'; END IF;
  IF (SELECT missed_notified_at FROM public.calls WHERE id = 'cccccccc-0000-0000-0000-000000000080') IS NULL THEN RAISE EXCEPTION 'A21 (5) notified stamp'; END IF;
  RESET ROLE;
END $$;

-- A22 (corrective pass 5, findings 1–2): a GENUINE live mobile acceptance is never abandoned (sweep or direct); the
--     acceptance RESULT — not the timestamp — decides closure; refused/ended mobile work converges; late callbacks still land.
DO $$
DECLARE r jsonb; a public.inbound_route_attempts%ROWTYPE; m jsonb;
  org constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  a1 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  mk_c uuid; mk_sid text; child text; i integer; digits text[] := ARRAY['2', '', '1']; res text;
BEGIN
  SET LOCAL ROLE service_role;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE NOT terminal;
  UPDATE public.profiles SET availability_status = 'Available' WHERE id = a1;
  PERFORM pg_temp.disconnect(a1);
  INSERT INTO public.agent_inbound_settings (agent_id, organization_id, mobile_forward_enabled, mobile_forward_number)
  VALUES (a1, org, true, '+15559990001') ON CONFLICT (agent_id) DO UPDATE SET mobile_forward_enabled = true, mobile_forward_number = '+15559990001';

  -- (1) accepted, live, older than 30 minutes, parent still 'ringing' (Dial action pending): protected everywhere
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000060','CA00000000000000000000000000000a60');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000060', a1);
  IF r->>'stage' <> 'owner_mobile' THEN RAISE EXCEPTION 'A22 setup %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000060';
  r := public.record_inbound_mobile_accept(a.id, org, 'cccccccc-0000-0000-0000-000000000060', a1, 'CA00000000000000000000000000000c60', '1', 'CA00000000000000000000000000000a60', '+15559990001');
  IF r->>'result' <> 'accepted' THEN RAISE EXCEPTION 'A22 accept %', r; END IF;
  UPDATE public.calls SET created_at = now() - interval '45 minutes' WHERE id = 'cccccccc-0000-0000-0000-000000000060';
  UPDATE public.inbound_route_attempts SET mobile_accepted_at = now() - interval '40 minutes', updated_at = now() - interval '40 minutes' WHERE id = a.id;
  r := public.sweep_inbound_route_attempts(interval '2 minutes', interval '30 minutes', 100);
  IF (r->>'calls_abandoned')::int <> 0 OR (r->>'calls_completed')::int <> 0 OR (r->>'attempts_closed')::int <> 0 THEN
    RAISE EXCEPTION 'A22 (1) the sweep must skip a live accepted conversation %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000060');
  IF m->>'status' <> 'ringing' OR m->>'reason' <> 'forwarded_to_mobile' THEN RAISE EXCEPTION 'A22 (1) parent altered %', m; END IF;
  r := public.abandon_inbound_routing('cccccccc-0000-0000-0000-000000000060', org, 'deadline');
  IF (r->>'updated')::boolean IS DISTINCT FROM false OR r->>'reason' <> 'mobile_accepted_live' THEN RAISE EXCEPTION 'A22 (1) direct abandon %', r; END IF;
  IF NOT public.is_agent_busy(org, a1, NULL) THEN RAISE EXCEPTION 'A22 (1) the accepted owner must stay busy (A5b)'; END IF;
  -- beyond the approved 4-hour ceiling with no leg end the conversation is deemed over: completed, closed, released
  UPDATE public.inbound_route_attempts SET mobile_accepted_at = now() - interval '5 hours' WHERE id = a.id;
  r := public.sweep_inbound_route_attempts(interval '2 minutes', interval '30 minutes', 100);
  IF (r->>'calls_completed')::int <> 1 THEN RAISE EXCEPTION 'A22 (1b) ceiling %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000060');
  IF m->>'status' <> 'completed' OR m->>'reason' <> 'forwarded_to_mobile' OR (m->>'is_missed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A22 (1b) %', m; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
  IF NOT a.terminal OR a.mobile_accept_result <> 'accepted' OR a.mobile_bridge_evidence IS NOT NULL THEN RAISE EXCEPTION 'A22 (1b) nothing fabricated: % %', a.terminal, a.mobile_bridge_evidence; END IF;
  IF public.is_agent_busy(org, a1, NULL) THEN RAISE EXCEPTION 'A22 (1b) released'; END IF;

  -- (2) wrong digit / no digit / accepted after hangup, parent terminal, Dial action LOST: converge after the grace period
  FOR i IN 1..3 LOOP
    mk_c := ('cccccccc-0000-0000-0000-00000000006' || i::text)::uuid;
    mk_sid := 'CA00000000000000000000000000000a6' || i::text;
    child := 'CA00000000000000000000000000000c6' || i::text;
    PERFORM pg_temp.mk_call(mk_c, mk_sid);
    r := pg_temp.plan(mk_c, a1);
    IF r->>'stage' <> 'owner_mobile' THEN RAISE EXCEPTION 'A22 (2) setup % %', i, r; END IF;
    SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = mk_c;
    IF i = 3 THEN UPDATE public.calls SET ended_at = now(), status = 'completed' WHERE id = mk_c; END IF;   -- caller gone before the press
    r := public.record_inbound_mobile_accept(a.id, org, mk_c, a1, child, digits[i], mk_sid, '+15559990001');
    res := r->>'result';
    IF res NOT IN ('wrong_digit','no_digit','accepted_after_hangup') THEN RAISE EXCEPTION 'A22 (2) result % %', i, r; END IF;
    UPDATE public.calls SET ended_at = coalesce(ended_at, now()), status = 'completed' WHERE id = mk_c;
    r := public.sweep_inbound_route_attempts(interval '2 minutes', interval '30 minutes', 100);
    SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
    IF a.terminal THEN RAISE EXCEPTION 'A22 (2) grace period must be respected (%)', res; END IF;
    UPDATE public.inbound_route_attempts SET updated_at = now() - interval '3 minutes' WHERE id = a.id;
    r := public.sweep_inbound_route_attempts(interval '2 minutes', interval '30 minutes', 100);
    SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
    IF NOT a.terminal OR a.final_outcome <> 'swept:parent_terminal' OR cardinality(a.reserved_agent_ids) <> 0 THEN
      RAISE EXCEPTION 'A22 (2) % must converge after the grace period (mobile_accepted_at stamped, result %)', res, a.mobile_accept_result; END IF;
    IF public.is_agent_busy(org, a1, NULL) THEN RAISE EXCEPTION 'A22 (2) % must release the owner', res; END IF;
    m := pg_temp.missed(mk_c);
    IF m->>'reason' <> 'forwarded_to_mobile' OR (m->>'is_missed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A22 (2) D13 altered %', m; END IF;
  END LOOP;

  -- (3) genuinely accepted, child ended, parent Dial action never arrives (parent still 'ringing'): completed and
  --     closed by the stale sweep; a late bridge callback still records; D13 unchanged
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000064','CA00000000000000000000000000000a64');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000064', a1);
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000064';
  r := public.record_inbound_mobile_accept(a.id, org, 'cccccccc-0000-0000-0000-000000000064', a1, 'CA00000000000000000000000000000c64', '1', 'CA00000000000000000000000000000a64', '+15559990001');
  IF r->>'result' <> 'accepted' THEN RAISE EXCEPTION 'A22 (3) accept %', r; END IF;
  r := public.record_inbound_mobile_leg_end(a.id, org, 'CA00000000000000000000000000000c64', 'completed', 95, 'CA00000000000000000000000000000a64');
  IF public.is_agent_busy(org, a1, NULL) THEN RAISE EXCEPTION 'A22 (3) leg end releases the owner'; END IF;
  UPDATE public.calls SET created_at = now() - interval '45 minutes' WHERE id = 'cccccccc-0000-0000-0000-000000000064';
  r := public.sweep_inbound_route_attempts(interval '2 minutes', interval '30 minutes', 100);
  IF (r->>'calls_completed')::int <> 1 OR (r->>'calls_abandoned')::int <> 0 THEN RAISE EXCEPTION 'A22 (3) sweep %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000064');
  IF m->>'status' <> 'completed' OR m->>'reason' <> 'forwarded_to_mobile' THEN RAISE EXCEPTION 'A22 (3) parent %', m; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
  IF NOT a.terminal THEN RAISE EXCEPTION 'A22 (3) attempt must be closed'; END IF;
  r := public.record_inbound_mobile_bridge(a.id, org, 'cccccccc-0000-0000-0000-000000000064', a1, true, 'completed', 'CA00000000000000000000000000000c64', 95, 'CA00000000000000000000000000000a64');
  IF (r->>'attributed')::boolean IS DISTINCT FROM true OR (r->>'bridged')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'A22 (3) a late bridge callback must still record %', r; END IF;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
  IF a.mobile_bridge_evidence IS NULL THEN RAISE EXCEPTION 'A22 (3) bridge attribution must land on the closed attempt'; END IF;
  -- parent-terminal variant: accepted + leg ended + parent completed ⇒ closed by the terminal-parent branch after grace
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000065','CA00000000000000000000000000000a65');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000065', a1);
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000065';
  r := public.record_inbound_mobile_accept(a.id, org, 'cccccccc-0000-0000-0000-000000000065', a1, 'CA00000000000000000000000000000c65', '1', 'CA00000000000000000000000000000a65', '+15559990001');
  r := public.record_inbound_mobile_leg_end(a.id, org, 'CA00000000000000000000000000000c65', 'completed', 40, 'CA00000000000000000000000000000a65');
  UPDATE public.calls SET ended_at = now(), status = 'completed' WHERE id = 'cccccccc-0000-0000-0000-000000000065';
  UPDATE public.inbound_route_attempts SET updated_at = now() - interval '3 minutes' WHERE id = a.id;
  r := public.sweep_inbound_route_attempts(interval '2 minutes', interval '30 minutes', 100);
  SELECT * INTO a FROM public.inbound_route_attempts WHERE id = a.id;
  IF NOT a.terminal THEN RAISE EXCEPTION 'A22 (3b) accepted + leg ended on a terminal parent must close'; END IF;
  RESET ROLE;
END $$;

-- A23 (corrective pass 5, finding 1): the stale-call recovery owns ONLY v2 work — durable ownership from the
--     routing-engine history: legacy calls are never touched; v2 calls stay recoverable after a rollback to legacy,
--     including a failure BEFORE any attempt was created.
DO $$
DECLARE r jsonb; m jsonb;
  org constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  orgb constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000b';
  a1 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  a2 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a2';
  a3 constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a3';
BEGIN
  SET LOCAL ROLE service_role;
  UPDATE public.inbound_route_attempts SET terminal = true WHERE NOT terminal;
  UPDATE public.calls SET ended_at = coalesce(ended_at, now()), status = CASE WHEN status IN ('completed','failed','no-answer') THEN status ELSE 'completed' END
   WHERE direction = 'inbound' AND ended_at IS NULL;                       -- clean slate: nothing else is non-terminal
  UPDATE public.profiles SET availability_status = 'Available' WHERE id IN (a1, a2, a3);
  PERFORM pg_temp.connect(a2); PERFORM pg_temp.connect(a3);

  -- a LEGACY organization (no engine history) with an old ringing call: the cron function leaves it alone
  INSERT INTO public.organizations (id, name) VALUES (orgb, 'Legacy Org') ON CONFLICT DO NOTHING;
  INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, created_at)
  VALUES ('cccccccc-0000-0000-0000-000000000070', orgb, 'inbound', 'ringing', 'CA00000000000000000000000000000a70', '+19995551234', '+15550001111', now() - interval '3 hours');
  -- org A: activated (history written by the trigger, whatever the writer) — backdated so the calls below fall inside it
  INSERT INTO public.inbound_routing_settings (organization_id, routing_engine, inbound_group_agent_ids)
  VALUES (org, 'v2', ARRAY[a2, a3]) ON CONFLICT (organization_id) DO UPDATE SET routing_engine = 'v2', inbound_group_agent_ids = ARRAY[a2, a3];
  RESET ROLE;   -- the private helper is definer-only; the assertions below read it as the migration owner
  IF private.inbound_engine_at(org, now()) <> 'v2' THEN RAISE EXCEPTION 'A23 history must record the activation'; END IF;
  UPDATE public.inbound_routing_engine_history SET effective_from = now() - interval '3 hours' WHERE organization_id = org AND engine = 'v2' AND effective_to IS NULL;
  IF private.inbound_engine_at(org, now() - interval '4 hours') <> 'legacy' THEN RAISE EXCEPTION 'A23 before activation reads legacy (no backfill)'; END IF;
  SET LOCAL ROLE service_role;

  -- v2 calls created inside the v2 window: (71) planned, (72) failed BEFORE any attempt was created
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000071','CA00000000000000000000000000000a71');
  r := pg_temp.plan('cccccccc-0000-0000-0000-000000000071', NULL);
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000072','CA00000000000000000000000000000a72');
  UPDATE public.calls SET created_at = now() - interval '60 minutes' WHERE id IN ('cccccccc-0000-0000-0000-000000000071','cccccccc-0000-0000-0000-000000000072');

  -- the organization ROLLS BACK to legacy (history closes the v2 window), backdated so a later legacy call is stale too
  UPDATE public.inbound_routing_settings SET routing_engine = 'legacy' WHERE organization_id = org;
  RESET ROLE;
  UPDATE public.inbound_routing_engine_history SET effective_to = now() - interval '50 minutes' WHERE organization_id = org AND engine = 'v2';
  UPDATE public.inbound_routing_engine_history SET effective_from = now() - interval '50 minutes' WHERE organization_id = org AND engine = 'legacy' AND effective_to IS NULL;
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000073','CA00000000000000000000000000000a73');   -- created under legacy, no attempt
  UPDATE public.calls SET created_at = now() - interval '40 minutes' WHERE id = 'cccccccc-0000-0000-0000-000000000073';

  r := public.sweep_inbound_route_attempts(interval '2 minutes', interval '30 minutes', 100);
  IF (r->>'calls_abandoned')::int <> 2 THEN RAISE EXCEPTION 'A23 expected the two v2-owned calls to be recovered, got %', r; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000070');
  IF m->>'status' <> 'ringing' OR (m->>'is_missed')::boolean IS TRUE THEN RAISE EXCEPTION 'A23 the legacy organization''s call must be untouched %', m; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000073');
  IF m->>'status' <> 'ringing' THEN RAISE EXCEPTION 'A23 a call created under legacy must be untouched %', m; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000071');
  IF m->>'status' <> 'no-answer' OR NOT ((m->'recipients') ? a2::text AND (m->'recipients') ? a3::text) THEN RAISE EXCEPTION 'A23 planned v2 call after rollback %', m; END IF;
  m := pg_temp.missed('cccccccc-0000-0000-0000-000000000072');
  IF m->>'status' <> 'no-answer' OR NOT ((m->'recipients') ? a2::text AND (m->'recipients') ? a3::text) THEN
    RAISE EXCEPTION 'A23 a v2 call that failed before planning must be recovered with the configured group as recipients %', m; END IF;
  IF EXISTS (SELECT 1 FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000071' AND NOT terminal) THEN RAISE EXCEPTION 'A23 attempt closed'; END IF;
  RESET ROLE;
END $$;

ROLLBACK;
