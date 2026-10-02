-- =====================================================================================================
-- Inbound Calling v2 — recent-outbound callback routing (20260927052736; implementation_plan.md §A9) — SQL
-- tests. LOCAL disposable stack only (AGENT_RULES #28). Whole file rolls back.
-- Apply: inbound_harness → M1–M3 → inbound_v2_harness → M4–M9 → 20260927052736, then run with ON_ERROR_STOP=1.
-- Every RPC is invoked as production does: through service_role. The permission matrix (§A7) runs as the real
-- roles (anon / authenticated with JWT claims / service_role). The runner additionally checks that the two
-- contained-fault cases (RO-D9a/b) emitted their WARNING lines.
-- =====================================================================================================
BEGIN;

-- ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────
-- pg_temp.u('xx') = 'e0000000-0000-0000-0000-0000000000xx': e0 org, f0 other org, d1/d2/d3 dialers, a1/a2 group,
-- ad admin, f1 other-org agent, b1/b2 duplicate identity, c1 identity without organization.
CREATE OR REPLACE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('e0000000-0000-0000-0000-0000000000' || p_tag)::uuid
$$;
CREATE OR REPLACE FUNCTION pg_temp.ca(n integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'CA' || lpad(to_hex(n), 32, '0')
$$;

INSERT INTO public.organizations (id, name) VALUES (pg_temp.u('e0'), 'RO Org'), (pg_temp.u('f0'), 'RO Other Org');
INSERT INTO auth.users (id) SELECT pg_temp.u(t) FROM unnest(ARRAY['d1','d2','d3','a1','a2','ad','f1','b1','b2','c1']) t;
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity, availability_status) VALUES
  (pg_temp.u('d1'), pg_temp.u('e0'), 'Agent', 'Active', 'ro_d1', 'Available'),   -- dialer 1
  (pg_temp.u('d2'), pg_temp.u('e0'), 'Agent', 'Active', 'ro_d2', 'Available'),   -- dialer 2
  (pg_temp.u('d3'), pg_temp.u('e0'), 'Agent', 'Active', 'ro_d3', 'Available'),   -- dialer 3
  (pg_temp.u('a1'), pg_temp.u('e0'), 'Agent', 'Active', 'ro_g1', 'Available'),   -- inbound group
  (pg_temp.u('a2'), pg_temp.u('e0'), 'Agent', 'Active', 'ro_g2', 'Available'),   -- inbound group
  (pg_temp.u('ad'), pg_temp.u('e0'), 'Admin', 'Active', 'ro_ad', 'Available'),
  (pg_temp.u('f1'), pg_temp.u('f0'), 'Agent', 'Active', 'ro_x1', 'Available'),   -- another organization
  (pg_temp.u('b1'), pg_temp.u('e0'), 'Agent', 'Active', 'ro_dup', 'Available'), -- duplicated identity
  (pg_temp.u('b2'), pg_temp.u('e0'), 'Agent', 'Active', 'ro_dup', 'Available'),
  (pg_temp.u('c1'), NULL,            'Agent', 'Active', 'ro_noorg', 'Available');
INSERT INTO public.phone_numbers (organization_id, phone_number, assigned_to, is_direct_line, assignment_type, status) VALUES
  (pg_temp.u('e0'), '+15550002222', NULL,             false, 'agency',   'active'),    -- DID A (agency)
  (pg_temp.u('e0'), '+15550003333', NULL,             false, 'agency',   'active'),    -- DID B (agency)
  (pg_temp.u('e0'), '+15550004444', pg_temp.u('d1'), false, 'personal', 'active'),    -- d1's personal number
  (pg_temp.u('e0'), '+15550005555', pg_temp.u('d2'), false, 'personal', 'active'),    -- d2's personal number
  (pg_temp.u('e0'), '+15550006666', pg_temp.u('a1'), true,  'agency',   'active'),    -- a1's direct line
  (pg_temp.u('e0'), '+15550007777', NULL,             false, 'agency',   'released'),  -- released number
  (pg_temp.u('f0'), '+15550008888', NULL,             false, 'agency',   'active');    -- other organization
INSERT INTO public.inbound_routing_settings (organization_id, routing_engine, inbound_group_agent_ids)
VALUES (pg_temp.u('e0'), 'v2', ARRAY[pg_temp.u('a1'), pg_temp.u('a2')]);
INSERT INTO public.agent_inbound_settings (agent_id, organization_id, mobile_forward_enabled, mobile_forward_number)
VALUES (pg_temp.u('d1'), pg_temp.u('e0'), true, '+15559990001');

CREATE OR REPLACE FUNCTION pg_temp.connect(p uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.agent_phone_registrations (agent_id, registration_id, organization_id, seq, registered, registered_at, last_seen_at, last_state)
  SELECT p, gen_random_uuid(), pr.organization_id, 1, true, now(), now(), 'registered' FROM public.profiles pr WHERE pr.id = p
$$;
CREATE OR REPLACE FUNCTION pg_temp.disconnect(p uuid) RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.agent_phone_registrations WHERE agent_id = p
$$;
DO $$ BEGIN PERFORM pg_temp.connect(pg_temp.u(t)) FROM unnest(ARRAY['d1','d2','d3','a1','a2']) t; END $$;

-- An outbound calls row as the browser writes it (k → id …0001-<k>, parent CallSid ca(1000+k)); x overrides.
CREATE OR REPLACE FUNCTION pg_temp.mk_out(k integer, p_agent uuid, p_to text, p_did text, x jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO public.calls (id, organization_id, agent_id, direction, status, twilio_call_sid, contact_phone, caller_id_used,
                            contact_type, contact_id, campaign_id, campaign_lead_id, started_at, ended_at, created_at)
  VALUES (('e0000000-0000-0000-0001-' || lpad(k::text, 12, '0'))::uuid, coalesce((x->>'org')::uuid, pg_temp.u('e0')), p_agent,
          coalesce(x->>'direction', 'outbound'), 'completed', coalesce(x->>'sid', pg_temp.ca(1000 + k)), p_to, p_did,
          NULL, (x->>'contact_id')::uuid, (x->>'campaign_id')::uuid, (x->>'campaign_lead_id')::uuid,
          now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours')
  RETURNING id
$$;
-- The record RPC exactly as twilio-voice-status calls it, for a verified answered dial (parent ca(1000+k), child
-- ca(2000+k)); o overrides any argument (a JSON null passes SQL NULL).
CREATE OR REPLACE FUNCTION pg_temp.dial(k integer, p_identity text, p_to text, p_did text, p_start timestamptz, o jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.record_outbound_dial_evidence(
           d->>'signed_account', d->>'credential_account', d->>'parent', d->>'dial', d->>'status', d->>'signed_from', d->>'signed_to',
           d->>'parent_account', d->>'parent_from', d->>'child_account', d->>'child_parent', d->>'child_to', d->>'child_from',
           d->>'child_status', (d->>'child_start')::timestamptz)
    FROM (SELECT jsonb_build_object(
            'signed_account', 'AC000000000000000000000000000000aa', 'credential_account', 'AC000000000000000000000000000000aa',
            'parent', pg_temp.ca(1000 + k), 'dial', pg_temp.ca(2000 + k), 'status', 'completed',
            'signed_from', 'client:' || p_identity, 'signed_to', p_to,
            'parent_account', 'AC000000000000000000000000000000aa', 'parent_from', 'client:' || p_identity,
            'child_account', 'AC000000000000000000000000000000aa', 'child_parent', pg_temp.ca(1000 + k),
            'child_to', p_to, 'child_from', p_did, 'child_status', 'completed', 'child_start', p_start) || o AS d) s
$$;
CREATE OR REPLACE FUNCTION pg_temp.expect(p_label text, r jsonb, p_category text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF r IS NULL OR NOT (r ?& ARRAY['recorded','category','reason','outcome','dialed_context']) THEN
    RAISE EXCEPTION '% result shape %', p_label, r; END IF;
  IF r->>'category' IS DISTINCT FROM p_category OR r->>'reason' IS DISTINCT FROM p_reason THEN
    RAISE EXCEPTION '% expected %/% got %', p_label, p_category, p_reason, r; END IF;
  IF (r->>'recorded')::boolean IS DISTINCT FROM (p_reason = 'recorded') THEN RAISE EXCEPTION '% recorded flag %', p_label, r; END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ev(k integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(e) FROM private.outbound_dial_evidence e WHERE e.dial_call_sid = pg_temp.ca(2000 + k)
$$;
CREATE OR REPLACE FUNCTION pg_temp.ev_count() RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM private.outbound_dial_evidence
$$;
-- An inbound call as ingest + record_inbound_engine_decision leave it (k → id …0002-<k>).
CREATE OR REPLACE FUNCTION pg_temp.mk_in(k integer, p_from text, p_did text, p_created timestamptz DEFAULT now(), x jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, contact_type, contact_id, routing_engine, created_at)
  VALUES (('e0000000-0000-0000-0002-' || lpad(k::text, 12, '0'))::uuid, pg_temp.u('e0'), 'inbound', 'ringing',
          'CA' || lpad(to_hex(900000 + k), 32, '0'), p_from, p_did,
          CASE WHEN x ? 'contact_id' THEN 'lead' END, (x->>'contact_id')::uuid, coalesce(x->>'engine', 'v2'), p_created)
  RETURNING id
$$;
CREATE OR REPLACE FUNCTION pg_temp.plan(p_call uuid, p_owner uuid DEFAULT NULL, p_source text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.plan_inbound_route(p_call, pg_temp.u('e0'), p_owner, p_source, ARRAY[pg_temp.u('a1'), pg_temp.u('a2')], 20)
$$;
CREATE OR REPLACE FUNCTION pg_temp.att(p_call uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(a) FROM public.inbound_route_attempts a WHERE a.call_id = p_call
$$;
CREATE OR REPLACE FUNCTION pg_temp.missed(p_call uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('is_missed', c.is_missed, 'reason', c.missed_reason, 'for', c.missed_for_agent_id,
                            'recipients', to_jsonb(c.missed_recipient_ids), 'agent_id', c.agent_id, 'status', c.status)
    FROM public.calls c WHERE c.id = p_call
$$;
-- Close every open attempt / ringing call of the test organization (reservations are per-transaction now()).
CREATE OR REPLACE FUNCTION pg_temp.reset() RETURNS void LANGUAGE sql AS $$
  UPDATE public.inbound_route_attempts SET terminal = true, reserved_agent_ids = '{}'::uuid[] WHERE organization_id = pg_temp.u('e0') AND NOT terminal;
  UPDATE public.calls SET status = 'completed', ended_at = coalesce(ended_at, now())
   WHERE organization_id = pg_temp.u('e0') AND ended_at IS NULL AND status IN ('ringing','connected');
$$;
-- The ops scripts' effect on the switch (the scripts themselves are proven by run_recent_outbound_rollback_test.sh).
CREATE OR REPLACE FUNCTION pg_temp.cfg(p_enabled boolean, p_unanswered boolean DEFAULT false, p_allow text[] DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO private.recent_outbound_routing_orgs (organization_id, enabled, unanswered_eligible, did_allowlist)
  VALUES (pg_temp.u('e0'), p_enabled, p_unanswered, p_allow)
  ON CONFLICT (organization_id) DO UPDATE
    SET enabled = EXCLUDED.enabled, unanswered_eligible = EXCLUDED.unanswered_eligible, did_allowlist = EXCLUDED.did_allowlist, updated_at = now()
$$;
CREATE OR REPLACE FUNCTION pg_temp.crm_md5() RETURNS text LANGUAGE sql AS $$
  SELECT md5(coalesce((SELECT string_agg(to_jsonb(l)::text, '|' ORDER BY l.id) FROM public.leads l), '') ||
             coalesce((SELECT string_agg(to_jsonb(c)::text, '|' ORDER BY c.id) FROM public.clients c), '') ||
             coalesce((SELECT string_agg(to_jsonb(r)::text, '|' ORDER BY r.id) FROM public.recruits r), '') ||
             coalesce((SELECT string_agg(to_jsonb(cl)::text, '|' ORDER BY cl.id) FROM public.campaign_leads cl), ''))
$$;
-- PostgreSQL's own SQLSTATE for a statement run as a role ('OK' when it succeeds).
CREATE OR REPLACE FUNCTION pg_temp.state_as(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
    v := 'OK';
  EXCEPTION WHEN OTHERS THEN
    v := SQLSTATE;
  END;
  RESET ROLE;
  RETURN v;
END $$;

-- ══ RO-R: the record RPC contract (§1.3) ══════════════════════════════════════════════════════════════

-- RO-R1: a verified ANSWERED dial is recorded with the CHILD record's digits; the RPC writes no calls/CRM row
DO $$
DECLARE r jsonb; e jsonb; before_row jsonb; before_trg integer; before_crm text; kk constant integer := 1;
BEGIN
  PERFORM pg_temp.mk_out(kk, pg_temp.u('d1'), '+19995550101', '+15550002222');
  SELECT to_jsonb(c) INTO before_row FROM public.calls c WHERE c.twilio_call_sid = pg_temp.ca(1000 + kk);
  SELECT t.n INTO before_trg FROM public.harness_trigger_counts t WHERE t.k = 'calls_update';
  before_crm := pg_temp.crm_md5();
  SET LOCAL ROLE service_role;
  r := pg_temp.dial(kk, 'ro_d1', '+19995550101', '+15550002222', now() - interval '2 hours',
                    '{"signed_to":"+1 999 555 0101","child_to":"(999) 555-0101","child_from":"555.000.2222"}');
  RESET ROLE;
  PERFORM pg_temp.expect('RO-R1', r, 'persisted', 'recorded');
  IF r->>'outcome' IS DISTINCT FROM 'answered' OR r->>'dialed_context' IS DISTINCT FROM 'unsaved' THEN RAISE EXCEPTION 'RO-R1 %', r; END IF;
  e := pg_temp.ev(kk);
  IF e->>'dialed_to_digits' IS DISTINCT FROM '19995550101' OR e->>'caller_id_digits' IS DISTINCT FROM '15550002222'
     OR e->>'agent_id' IS DISTINCT FROM pg_temp.u('d1')::text OR e->>'organization_id' IS DISTINCT FROM pg_temp.u('e0')::text
     OR e->>'call_id' IS DISTINCT FROM (before_row->>'id') OR e->>'parent_call_sid' IS DISTINCT FROM pg_temp.ca(1000 + kk)
     OR e->>'account_sid' IS DISTINCT FROM 'AC000000000000000000000000000000aa' OR e->>'outcome' IS DISTINCT FROM 'answered'
     OR e->>'dial_call_status' IS DISTINCT FROM 'completed' OR e->>'provider_call_status' IS DISTINCT FROM 'completed'
     OR (e->>'provider_started_at')::timestamptz IS DISTINCT FROM now() - interval '2 hours' OR e->>'dialed_context' IS DISTINCT FROM 'unsaved'
     OR (e->>'context_checked_at') IS NULL THEN
    RAISE EXCEPTION 'RO-R1 stored evidence wrong %', e; END IF;
  IF (SELECT to_jsonb(c) FROM public.calls c WHERE c.twilio_call_sid = pg_temp.ca(1000 + kk)) IS DISTINCT FROM before_row
     OR (SELECT t.n FROM public.harness_trigger_counts t WHERE t.k = 'calls_update') IS DISTINCT FROM before_trg THEN
    RAISE EXCEPTION 'RO-R1 the RPC must never write public.calls'; END IF;
  IF pg_temp.crm_md5() IS DISTINCT FROM before_crm THEN RAISE EXCEPTION 'RO-R1 the RPC must never write a CRM row'; END IF;
END $$;

-- RO-R2: signed 'answered' + child completed = answered; the browser-ended ring (signed no-answer) is recorded as
--        UNANSWERED with child no-answer AND with child canceled
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.mk_out(2, pg_temp.u('d1'), '+19995550102', '+15550002222');
  PERFORM pg_temp.mk_out(3, pg_temp.u('d1'), '+19995550103', '+15550002222');
  PERFORM pg_temp.mk_out(4, pg_temp.u('d1'), '+19995550104', '+15550002222');
  SET LOCAL ROLE service_role;
  r := pg_temp.dial(2, 'ro_d1', '+19995550102', '+15550002222', now() - interval '1 hour', '{"status":"answered"}');
  PERFORM pg_temp.expect('RO-R2 answered', r, 'persisted', 'recorded');
  IF r->>'outcome' IS DISTINCT FROM 'answered' THEN RAISE EXCEPTION 'RO-R2 answered %', r; END IF;
  r := pg_temp.dial(3, 'ro_d1', '+19995550103', '+15550002222', now() - interval '1 hour', '{"status":"no-answer","child_status":"no-answer"}');
  PERFORM pg_temp.expect('RO-R2 no-answer/no-answer', r, 'persisted', 'recorded');
  IF r->>'outcome' IS DISTINCT FROM 'unanswered' THEN RAISE EXCEPTION 'RO-R2 no-answer/no-answer %', r; END IF;
  r := pg_temp.dial(4, 'ro_d1', '+19995550104', '+15550002222', now() - interval '1 hour', '{"status":"no-answer","child_status":"canceled"}');
  PERFORM pg_temp.expect('RO-R2 no-answer/canceled', r, 'persisted', 'recorded');
  IF r->>'outcome' IS DISTINCT FROM 'unanswered' THEN RAISE EXCEPTION 'RO-R2 no-answer/canceled %', r; END IF;
  RESET ROLE;
  IF pg_temp.ev(3)->>'provider_call_status' IS DISTINCT FROM 'no-answer' OR pg_temp.ev(4)->>'provider_call_status' IS DISTINCT FROM 'canceled'
     OR pg_temp.ev(4)->>'dial_call_status' IS DISTINCT FROM 'no-answer' OR pg_temp.ev(4)->>'dialed_to_digits' IS DISTINCT FROM '19995550104' THEN
    RAISE EXCEPTION 'RO-R2 stored statuses/digits %', pg_temp.ev(4); END IF;
END $$;

-- RO-R3: redelivery with ALTERED values (later start, different outcome) = persisted/duplicate; stored row untouched.
--        A different DialCallSid for an already-evidenced parent row = unverified/call_already_evidenced.
DO $$
DECLARE r jsonb; before_ev jsonb; n bigint;
BEGIN
  before_ev := pg_temp.ev(1);
  SET LOCAL ROLE service_role;
  r := pg_temp.dial(1, 'ro_d1', '+19995550101', '+15550002222', now() - interval '30 minutes', '{"status":"no-answer","child_status":"canceled"}');
  PERFORM pg_temp.expect('RO-R3 duplicate', r, 'persisted', 'duplicate');
  IF r->>'outcome' IS DISTINCT FROM 'answered' OR r->>'dialed_context' IS DISTINCT FROM 'unsaved' THEN RAISE EXCEPTION 'RO-R3 duplicate must report the STORED values %', r; END IF;
  RESET ROLE;
  IF pg_temp.ev(1) IS DISTINCT FROM before_ev THEN RAISE EXCEPTION 'RO-R3 a duplicate changed the stored row'; END IF;
  n := pg_temp.ev_count();
  SET LOCAL ROLE service_role;
  r := pg_temp.dial(1, 'ro_d1', '+19995550101', '+15550002222', now() - interval '2 hours', jsonb_build_object('dial', pg_temp.ca(2999)));
  RESET ROLE;
  PERFORM pg_temp.expect('RO-R3 second dial on one call row', r, 'unverified', 'call_already_evidenced');
  IF pg_temp.ev_count() IS DISTINCT FROM n THEN RAISE EXCEPTION 'RO-R3 no row may be added'; END IF;
END $$;

-- RO-R4: every rejection — category + reason, first failing check wins, and NOTHING is stored
DO $$
DECLARE r jsonb; n bigint; c record;
BEGIN
  PERFORM pg_temp.mk_out(10, pg_temp.u('d1'), '+19995550110', '+15550002222');
  -- rows for the row/number checks
  PERFORM pg_temp.mk_out(11, pg_temp.u('d2'), '+19995550111', '+15550002222');                        -- another agent's row
  PERFORM pg_temp.mk_out(12, NULL, '+19995550112', '+15550002222', '{"direction":"inbound"}');        -- an INBOUND row with the SID
  PERFORM pg_temp.mk_out(13, pg_temp.u('d1'), '+19995550113', '+15550002222');                        -- two outbound rows, one SID
  INSERT INTO public.calls (id, organization_id, agent_id, direction, status, twilio_call_sid, contact_phone, caller_id_used)
  VALUES ('e0000000-0000-0000-0001-000000009013', pg_temp.u('e0'), pg_temp.u('d1'), 'outbound', 'completed', pg_temp.ca(1013), '+19995550113', '+15550002222');
  PERFORM pg_temp.mk_out(14, pg_temp.u('d1'), '+19995550114', '+15550003333');                        -- browser caller ID ≠ provider's
  PERFORM pg_temp.mk_out(15, pg_temp.u('d1'), '+19995550115', '+15550005555');                        -- d2's PERSONAL number
  PERFORM pg_temp.mk_out(16, pg_temp.u('d1'), '+19995550116', '+15550007777');                        -- released number
  PERFORM pg_temp.mk_out(17, pg_temp.u('d1'), '+19995550117', '+15550008888');                        -- other organization's number
  PERFORM pg_temp.mk_out(18, pg_temp.u('d1'), '+19995550118', '+15550009999');                        -- not an organization number
  PERFORM pg_temp.mk_out(19, pg_temp.u('d1'), '+19995550119', '+15550002222', jsonb_build_object('org', pg_temp.u('f0')));  -- row in another org
  n := pg_temp.ev_count();
  SET LOCAL ROLE service_role;
  FOR c IN
    SELECT * FROM (VALUES
      -- 1. invalid input
      ('null signed account', 10, '{"signed_account":null}'::jsonb, 'unverified', 'invalid_input'),
      ('malformed signed account', 10, '{"signed_account":"AC123"}', 'unverified', 'invalid_input'),
      ('malformed credential account', 10, '{"credential_account":"XX0123456789abcdef0123456789abcdef"}', 'unverified', 'invalid_input'),
      ('null credential (credentials missing)', 10, '{"credential_account":null}', 'unverified', 'invalid_input'),
      ('malformed parent sid', 10, '{"parent":"CA0123"}', 'unverified', 'invalid_input'),
      ('malformed dial sid', 10, '{"dial":"CAzz000000000000000000000000000000"}', 'unverified', 'invalid_input'),
      ('blank dial status', 10, '{"status":"  "}', 'unverified', 'invalid_input'),
      ('non-client caller', 10, '{"signed_from":"+15550002222"}', 'unverified', 'invalid_input'),
      ('blank client identity', 10, '{"signed_from":"client:"}', 'unverified', 'invalid_input'),
      ('blank signed To', 10, '{"signed_to":""}', 'unverified', 'invalid_input'),
      -- 2. expected exclusions
      ('signed busy', 10, '{"status":"busy"}', 'excluded', 'status_not_qualifying'),
      ('signed failed', 10, '{"status":"failed"}', 'excluded', 'status_not_qualifying'),
      ('signed canceled', 10, '{"status":"canceled"}', 'excluded', 'status_not_qualifying'),
      -- 3. account binding
      ('credential ≠ signed', 10, '{"credential_account":"AC00000000000000000000000000000fff"}', 'unverified', 'account_mismatch'),
      ('parent account ≠', 10, '{"parent_account":"AC00000000000000000000000000000fff"}', 'unverified', 'account_mismatch'),
      ('parent account absent', 10, '{"parent_account":null}', 'unverified', 'account_mismatch'),
      ('child account ≠', 10, '{"child_account":"AC00000000000000000000000000000fff"}', 'unverified', 'account_mismatch'),
      -- 4. parent from
      ('parent placed by another identity', 10, '{"parent_from":"client:ro_d2"}', 'unverified', 'parent_from_mismatch'),
      ('parent from absent', 10, '{"parent_from":null}', 'unverified', 'parent_from_mismatch'),
      -- 5. child parent
      ('child of another parent', 10, '{"child_parent":"CA00000000000000000000000000000fff"}', 'unverified', 'child_parent_mismatch'),
      ('child parent absent', 10, '{"child_parent":null}', 'unverified', 'child_parent_mismatch'),
      -- 6. provider start
      ('child start absent', 10, '{"child_start":null}', 'missing', 'child_start_missing'),
      -- 7. status pairs outside §A3
      ('completed / child no-answer', 10, '{"child_status":"no-answer"}', 'unverified', 'status_pair_unaccepted'),
      ('completed / child canceled', 10, '{"child_status":"canceled"}', 'unverified', 'status_pair_unaccepted'),
      ('completed / child in-progress', 10, '{"child_status":"in-progress"}', 'unverified', 'status_pair_unaccepted'),
      ('no-answer / child completed', 10, '{"status":"no-answer"}', 'unverified', 'status_pair_unaccepted'),
      ('no-answer / child busy', 10, '{"status":"no-answer","child_status":"busy"}', 'unverified', 'status_pair_unaccepted'),
      ('no-answer / child ringing', 10, '{"status":"no-answer","child_status":"ringing"}', 'unverified', 'status_pair_unaccepted'),
      ('answered / child status absent', 10, '{"status":"answered","child_status":null}', 'unverified', 'status_pair_unaccepted'),
      -- 8. digits
      ('short child To', 10, '{"child_to":"12345","signed_to":"12345"}', 'unverified', 'destination_invalid'),
      ('16-digit child To', 10, '{"child_to":"+1234567890123456","signed_to":"+1234567890123456"}', 'unverified', 'destination_invalid'),
      ('child from absent', 10, '{"child_from":null}', 'unverified', 'destination_invalid'),
      ('anonymous signed To', 10, '{"signed_to":"anonymous"}', 'unverified', 'destination_invalid'),
      ('child To ≠ signed To', 10, '{"child_to":"+19995550199"}', 'unverified', 'child_to_mismatch'),
      ('country-code collision', 10, '{"signed_to":"+442079460958","child_to":"+12079460958"}', 'unverified', 'child_to_mismatch'),
      -- 9. identity
      ('unknown identity', 10, '{"signed_from":"client:ro_nobody","parent_from":"client:ro_nobody"}', 'unverified', 'identity_not_unique'),
      ('duplicated identity', 10, '{"signed_from":"client:ro_dup","parent_from":"client:ro_dup"}', 'unverified', 'identity_not_unique'),
      ('identity without organization', 10, '{"signed_from":"client:ro_noorg","parent_from":"client:ro_noorg"}', 'unverified', 'identity_not_unique'),
      -- 10. outbound row
      ('no row for the parent', 20, '{}', 'unverified', 'call_row_not_found'),
      ('row belongs to another agent', 11, '{}', 'unverified', 'call_row_not_found'),
      ('only an inbound row carries the SID', 12, '{}', 'unverified', 'call_row_not_found'),
      ('row in another organization', 19, '{}', 'unverified', 'call_row_not_found'),
      ('two outbound rows', 13, '{}', 'unverified', 'call_row_not_unique'),
      -- 11. caller-ID consistency
      ('browser caller ID ≠ provider caller ID', 14, '{}', 'unverified', 'caller_id_mismatch'),
      -- 12. number permission (#18)
      ('another agent''s personal number', 15, '{}', 'unverified', 'number_not_permitted'),
      ('released number', 16, '{}', 'unverified', 'number_not_permitted'),
      ('another organization''s number', 17, '{}', 'unverified', 'number_not_permitted'),
      ('not an organization number', 18, '{}', 'unverified', 'number_not_permitted')
    ) v(label, k, o, category, reason)
  LOOP
    -- the provider's numbers for the case: the dialed person of row k; DID A unless the row's #18 case needs its own number
    r := pg_temp.dial(c.k, 'ro_d1', '+1999555' || lpad((100 + c.k)::text, 4, '0'),
                      CASE c.k WHEN 15 THEN '+15550005555' WHEN 16 THEN '+15550007777' WHEN 17 THEN '+15550008888'
                               WHEN 18 THEN '+15550009999' ELSE '+15550002222' END,
                      now() - interval '1 hour', c.o);
    PERFORM pg_temp.expect('RO-R4 ' || c.label, r, c.category, c.reason);
  END LOOP;
  RESET ROLE;
  IF pg_temp.ev_count() IS DISTINCT FROM n THEN RAISE EXCEPTION 'RO-R4 a rejected dial stored a row'; END IF;
  -- the positive control for the #18 check: the agent's OWN personal number is permitted
  PERFORM pg_temp.mk_out(21, pg_temp.u('d1'), '+19995550121', '+15550004444');
  SET LOCAL ROLE service_role;
  r := pg_temp.dial(21, 'ro_d1', '+19995550121', '+15550004444', now() - interval '1 hour');
  RESET ROLE;
  PERFORM pg_temp.expect('RO-R4 own personal number', r, 'persisted', 'recorded');
END $$;

-- RO-R5 (D3, clarification 5): dialed_context is checked WHEN THE EVIDENCE IS CAPTURED — contact / ambiguous /
--        campaign / browser-marked are recorded but never 'unsaved'; a lead saved DURING the call is excluded
DO $$
DECLARE r jsonb; c record;
BEGIN
  INSERT INTO public.leads (id, organization_id, phone, first_name, assigned_agent_id) VALUES
    ('e0000000-0000-0000-0003-000000000031', pg_temp.u('e0'), '999-555-0131', 'Lead', NULL),
    ('e0000000-0000-0000-0003-000000000035', pg_temp.u('e0'), '+19995550135', 'Twice', NULL);
  INSERT INTO public.clients (id, organization_id, phone, first_name) VALUES
    ('e0000000-0000-0000-0003-000000000032', pg_temp.u('e0'), '+1 (999) 555-0132', 'Client'),
    ('e0000000-0000-0000-0003-000000000036', pg_temp.u('e0'), '9995550135', 'Twice');
  INSERT INTO public.recruits (id, organization_id, phone, first_name) VALUES
    ('e0000000-0000-0000-0003-000000000033', pg_temp.u('e0'), '9995550133', 'Recruit');
  INSERT INTO public.campaign_leads (id, organization_id, phone) VALUES
    ('e0000000-0000-0000-0003-000000000037', pg_temp.u('e0'), '(999) 555-0137');
  -- another organization's contact never counts
  INSERT INTO public.leads (organization_id, phone, first_name) VALUES (pg_temp.u('f0'), '+19995550134', 'Other org');
  PERFORM pg_temp.mk_out(31, pg_temp.u('d1'), '+19995550131', '+15550002222');
  PERFORM pg_temp.mk_out(32, pg_temp.u('d1'), '+19995550132', '+15550002222');
  PERFORM pg_temp.mk_out(33, pg_temp.u('d1'), '+19995550133', '+15550002222');
  PERFORM pg_temp.mk_out(34, pg_temp.u('d1'), '+19995550134', '+15550002222');
  PERFORM pg_temp.mk_out(35, pg_temp.u('d1'), '+19995550135', '+15550002222');
  PERFORM pg_temp.mk_out(37, pg_temp.u('d1'), '+19995550137', '+15550002222');
  PERFORM pg_temp.mk_out(38, pg_temp.u('d1'), '+19995550138', '+15550002222', jsonb_build_object('contact_id', gen_random_uuid()));
  PERFORM pg_temp.mk_out(39, pg_temp.u('d1'), '+19995550139', '+15550002222', jsonb_build_object('campaign_id', gen_random_uuid()));
  PERFORM pg_temp.mk_out(40, pg_temp.u('d1'), '+19995550140', '+15550002222', jsonb_build_object('campaign_lead_id', gen_random_uuid()));
  PERFORM pg_temp.mk_out(41, pg_temp.u('d1'), '+19995550141', '+15550002222');
  -- saved DURING the call: the lead is created after the dial started, before the evidence is captured
  INSERT INTO public.leads (organization_id, phone, first_name, created_at) VALUES (pg_temp.u('e0'), '+19995550141', 'Saved mid-call', now());
  SET LOCAL ROLE service_role;
  FOR c IN SELECT * FROM (VALUES (31, 'contact'), (32, 'contact'), (33, 'contact'), (34, 'unsaved'), (35, 'ambiguous'),
                                 (37, 'campaign'), (38, 'browser_marked'), (39, 'browser_marked'), (40, 'browser_marked'),
                                 (41, 'contact')) v(k, ctx) LOOP
    r := pg_temp.dial(c.k, 'ro_d1', '+1999555' || lpad((100 + c.k)::text, 4, '0'), '+15550002222', now() - interval '3 hours');
    PERFORM pg_temp.expect('RO-R5 k=' || c.k, r, 'persisted', 'recorded');
    IF r->>'dialed_context' IS DISTINCT FROM c.ctx THEN RAISE EXCEPTION 'RO-R5 k=% expected context % got %', c.k, c.ctx, r; END IF;
  END LOOP;
  RESET ROLE;
  IF pg_temp.ev(37)->>'dialed_context' IS DISTINCT FROM 'campaign' OR pg_temp.ev(34)->>'dialed_context' IS DISTINCT FROM 'unsaved' THEN RAISE EXCEPTION 'RO-R5 stored contexts'; END IF;
END $$;

-- ══ RO-T: routing through plan_inbound_route (§1.6) ═════════════════════════════════════════════════════

-- Evidence used below (all answered, unsaved, DID A unless noted):
--   k=50  d1 → +19995550150 (T-2h)           k=51 d1 → +15551234567 (T-2h)       k=52 d1 → +12079460958 (T-2h)
--   k=53  d1 → +19995550153 from the DIRECT line (T-2h)
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.mk_out(50, pg_temp.u('d1'), '+19995550150', '+15550002222');
  PERFORM pg_temp.mk_out(51, pg_temp.u('d1'), '+15551234567', '+15550002222');
  PERFORM pg_temp.mk_out(52, pg_temp.u('d1'), '+12079460958', '+15550002222');
  PERFORM pg_temp.mk_out(53, pg_temp.u('d1'), '+19995550153', '+15550006666');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.expect('RO-T fixture 50', pg_temp.dial(50, 'ro_d1', '+19995550150', '+15550002222', now() - interval '2 hours'), 'persisted', 'recorded');
  PERFORM pg_temp.expect('RO-T fixture 51', pg_temp.dial(51, 'ro_d1', '+15551234567', '+15550002222', now() - interval '2 hours'), 'persisted', 'recorded');
  PERFORM pg_temp.expect('RO-T fixture 52', pg_temp.dial(52, 'ro_d1', '+12079460958', '+15550002222', now() - interval '2 hours'), 'persisted', 'recorded');
  PERFORM pg_temp.expect('RO-T fixture 53', pg_temp.dial(53, 'ro_d1', '+19995550153', '+15550006666', now() - interval '2 hours'), 'persisted', 'recorded');
  RESET ROLE;
END $$;

-- RO-T0: ships DARK — no configuration row, then a disabled row: M6 behaviour (group, no evidence columns, no WARNING)
DO $$
DECLARE r jsonb; call uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM private.recent_outbound_routing_orgs) THEN RAISE EXCEPTION 'RO-T0 the migration must add no configuration row'; END IF;
  call := pg_temp.mk_in(1, '+19995550150', '+15550002222');
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(call);
  RESET ROLE;
  IF r->>'stage' IS DISTINCT FROM 'group_browser' OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'no_owner->group' OR r->'attempt'->>'owner_source' IS NOT NULL
     OR r->'attempt'->>'owner_evidence_dial_call_sid' IS NOT NULL OR r->'attempt'->>'owner_evidence_outcome' IS NOT NULL THEN
    RAISE EXCEPTION 'RO-T0 no config row must route exactly as M6 %', r; END IF;
  PERFORM pg_temp.reset();
  PERFORM pg_temp.cfg(false, true, NULL);
  call := pg_temp.mk_in(2, '+19995550150', '+15550002222');
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(call);
  RESET ROLE;
  IF r->>'stage' IS DISTINCT FROM 'group_browser' OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'no_owner->group' THEN RAISE EXCEPTION 'RO-T0 disabled %', r; END IF;
  PERFORM pg_temp.reset();
END $$;

-- RO-T1: an unknown caller with eligible evidence ⇒ owner mode for the dialer (owner_source recent_outbound + the
--        evidence columns); the handler's replay returns the persisted attempt; calls.agent_id stays NULL (claim
--        only); no CRM row is written
DO $$
DECLARE r jsonb; r2 jsonb; call uuid; crm text;
BEGIN
  PERFORM pg_temp.cfg(true);
  crm := pg_temp.crm_md5();
  call := pg_temp.mk_in(10, '+19995550150', '+15550002222');
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(call);
  r2 := pg_temp.plan(call);
  RESET ROLE;
  IF (r->>'created')::boolean IS NOT TRUE OR r->>'stage' IS DISTINCT FROM 'owner_browser' OR r->'attempt'->>'mode' IS DISTINCT FROM 'owner'
     OR r->'attempt'->>'owner_agent_id' IS DISTINCT FROM pg_temp.u('d1')::text OR r->'attempt'->>'owner_source' IS DISTINCT FROM 'recent_outbound'
     OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'owner_available_connected'
     OR r->'attempt'->>'owner_evidence_dial_call_sid' IS DISTINCT FROM pg_temp.ca(2050) OR r->'attempt'->>'owner_evidence_outcome' IS DISTINCT FROM 'answered'
     OR (r->'attempt'->>'owner_evidence_provider_started_at')::timestamptz IS DISTINCT FROM now() - interval '2 hours'
     OR r->'targets' IS DISTINCT FROM jsonb_build_array(pg_temp.u('d1')) THEN
    RAISE EXCEPTION 'RO-T1 %', r; END IF;
  IF (r2->>'created')::boolean IS NOT FALSE OR r2->'attempt' IS DISTINCT FROM pg_temp.att(call) OR r2->'attempt'->>'id' IS DISTINCT FROM r->'attempt'->>'id' THEN
    RAISE EXCEPTION 'RO-T1 replay must return the persisted attempt %', r2; END IF;
  IF (pg_temp.missed(call)->>'agent_id') IS NOT NULL OR (pg_temp.missed(call)->>'is_missed')::boolean THEN
    RAISE EXCEPTION 'RO-T1 planning must not claim or mark the call %', pg_temp.missed(call); END IF;
  IF pg_temp.crm_md5() IS DISTINCT FROM crm THEN RAISE EXCEPTION 'RO-T1 routing must not write a CRM row'; END IF;
  PERFORM pg_temp.reset();
END $$;

-- RO-T2: canonical-digit normalization; a country-code collision never matches; anonymous / short ANI never matches
DO $$
DECLARE r jsonb; c record; i integer := 20;
BEGIN
  FOR c IN SELECT * FROM (VALUES
      ('(555) 123-4567', 'owner'), ('5551234567', 'owner'), ('15551234567', 'owner'), ('+15551234567', 'owner'),
      ('+12079460958', 'owner'), ('+442079460958', 'group'), ('anonymous', 'group'), ('', 'group'), ('12345', 'group'),
      (NULL, 'group')) v(from_number, expect) LOOP
    i := i + 1;
    SET LOCAL ROLE service_role;
    r := pg_temp.plan(pg_temp.mk_in(i, c.from_number, '+15550002222'));
    RESET ROLE;
    IF (c.expect = 'owner' AND (r->'attempt'->>'owner_source' IS DISTINCT FROM 'recent_outbound' OR r->'attempt'->>'owner_agent_id' IS DISTINCT FROM pg_temp.u('d1')::text))
       OR (c.expect = 'group' AND (r->'attempt'->>'mode' IS DISTINCT FROM 'group' OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'no_owner->group')) THEN
      RAISE EXCEPTION 'RO-T2 caller % expected % got %', c.from_number, c.expect, r; END IF;
    PERFORM pg_temp.reset();
  END LOOP;
  -- a short / absent DID never matches either
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(39, '+19995550150', '2222'));
  RESET ROLE;
  IF r->'attempt'->>'mode' IS DISTINCT FROM 'group' THEN RAISE EXCEPTION 'RO-T2 short DID %', r; END IF;
  PERFORM pg_temp.reset();
END $$;

-- RO-T3: the DID allowlist compares canonical digits; '{}' = none; a short entry never matches
DO $$
DECLARE r jsonb; c record; i integer := 40;
BEGIN
  FOR c IN SELECT * FROM (VALUES
      (ARRAY['15550002222'], 'owner'), (ARRAY['(555) 000-2222'], 'owner'), (ARRAY['+15550003333', '+1 555 000 2222'], 'owner'),
      ('{}'::text[], 'group'), (ARRAY['+15550003333'], 'group'), (ARRAY['2222'], 'group')) v(allow, expect) LOOP
    i := i + 1;
    PERFORM pg_temp.cfg(true, false, c.allow);
    SET LOCAL ROLE service_role;
    r := pg_temp.plan(pg_temp.mk_in(i, '+19995550150', '+15550002222'));
    RESET ROLE;
    IF (c.expect = 'owner' AND r->'attempt'->>'owner_source' IS DISTINCT FROM 'recent_outbound')
       OR (c.expect = 'group' AND r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'no_owner->group') THEN
      RAISE EXCEPTION 'RO-T3 allowlist % expected % got %', c.allow, c.expect, r; END IF;
    PERFORM pg_temp.reset();
  END LOOP;
  PERFORM pg_temp.cfg(true);
END $$;

-- RO-T4: legacy-decided call ⇒ engine_mismatch (unchanged); precedence: direct line and contact owner unchanged;
--        unassigned contact, ambiguous caller and Auto-Create (contact linked at ingest) ⇒ group; a direct line
--        with no owner supplied is never taken over; a caller who became a contact after capture ⇒ not not_found
DO $$
DECLARE r jsonb; call uuid;
BEGIN
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(50, '+19995550150', '+15550002222', now(), '{"engine":"legacy"}'));
  RESET ROLE;
  IF r->>'reason' IS DISTINCT FROM 'engine_mismatch' OR (r->>'created')::boolean THEN RAISE EXCEPTION 'RO-T4 legacy %', r; END IF;

  -- direct line: the handler supplies its owner (a1) ⇒ direct_line owner, evidence ignored
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(51, '+19995550153', '+15550006666'), pg_temp.u('a1'), 'direct_line');
  RESET ROLE;
  IF r->'attempt'->>'owner_source' IS DISTINCT FROM 'direct_line' OR r->'attempt'->>'owner_agent_id' IS DISTINCT FROM pg_temp.u('a1')::text
     OR r->'attempt'->>'owner_evidence_dial_call_sid' IS NOT NULL THEN RAISE EXCEPTION 'RO-T4 direct line %', r; END IF;
  PERFORM pg_temp.reset();
  -- direct line whose owner the handler could not supply ⇒ never recent_outbound (re-check) ⇒ group
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(52, '+19995550153', '+15550006666'));
  RESET ROLE;
  IF r->'attempt'->>'mode' IS DISTINCT FROM 'group' OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'no_owner->group' THEN RAISE EXCEPTION 'RO-T4 direct line without owner %', r; END IF;
  PERFORM pg_temp.reset();

  -- contact owner supplied by the handler ⇒ contact (the evidence was captured while the caller was unsaved)
  INSERT INTO public.leads (id, organization_id, phone, first_name, assigned_agent_id)
  VALUES ('e0000000-0000-0000-0003-000000000150', pg_temp.u('e0'), '+19995550150', 'Now saved', pg_temp.u('d2'));
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(53, '+19995550150', '+15550002222', now(), '{"contact_id":"e0000000-0000-0000-0003-000000000150"}'),
                    pg_temp.u('d2'), 'contact');
  RESET ROLE;
  IF r->'attempt'->>'owner_source' IS DISTINCT FROM 'contact' OR r->'attempt'->>'owner_agent_id' IS DISTINCT FROM pg_temp.u('d2')::text
     OR r->'attempt'->>'owner_evidence_dial_call_sid' IS NOT NULL THEN RAISE EXCEPTION 'RO-T4 contact owner %', r; END IF;
  PERFORM pg_temp.reset();
  -- saved but UNASSIGNED contact (contact_id set, no owner) ⇒ group
  UPDATE public.leads SET assigned_agent_id = NULL WHERE id = 'e0000000-0000-0000-0003-000000000150';
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(54, '+19995550150', '+15550002222', now(), '{"contact_id":"e0000000-0000-0000-0003-000000000150"}'));
  RESET ROLE;
  IF r->'attempt'->>'mode' IS DISTINCT FROM 'group' THEN RAISE EXCEPTION 'RO-T4 unassigned contact %', r; END IF;
  PERFORM pg_temp.reset();
  -- the caller is now a contact but the call is not linked (e.g. a stale ingest): the re-check says unique ⇒ group
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(55, '+19995550150', '+15550002222'));
  RESET ROLE;
  IF r->'attempt'->>'mode' IS DISTINCT FROM 'group' THEN RAISE EXCEPTION 'RO-T4 caller resolves unique now %', r; END IF;
  PERFORM pg_temp.reset();
  -- AMBIGUOUS caller (two records; ingest leaves the call unlinked) ⇒ group
  INSERT INTO public.leads (organization_id, phone, first_name) VALUES (pg_temp.u('e0'), '+15551234567', 'A'), (pg_temp.u('e0'), '5551234567', 'B');
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(56, '+15551234567', '+15550002222'));
  RESET ROLE;
  IF r->'attempt'->>'mode' IS DISTINCT FROM 'group' THEN RAISE EXCEPTION 'RO-T4 ambiguous caller %', r; END IF;
  PERFORM pg_temp.reset();
  -- Auto-Create Leads: ingest links the not-found caller to a NEW unassigned lead before routing ⇒ inert
  INSERT INTO public.leads (id, organization_id, phone, first_name, lead_source)
  VALUES ('e0000000-0000-0000-0003-000000000152', pg_temp.u('e0'), '+12079460958', 'Inbound', 'Inbound Call');
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(57, '+12079460958', '+15550002222', now(), '{"contact_id":"e0000000-0000-0000-0003-000000000152"}'));
  RESET ROLE;
  IF r->'attempt'->>'mode' IS DISTINCT FROM 'group' THEN RAISE EXCEPTION 'RO-T4 auto-created lead %', r; END IF;
  PERFORM pg_temp.reset();
  DELETE FROM public.leads WHERE id = 'e0000000-0000-0000-0003-000000000150';   -- +19995550150 is unknown again below
END $$;

-- RO-T5 (D1): the 168 h window is anchored on the provider start of the verified child: exactly 168 h eligible,
--        168 h + 1 s not; a start at or after the inbound call's creation never qualifies
DO $$
DECLARE r jsonb; c record; t constant timestamptz := now(); i integer := 60;
BEGIN
  FOR c IN SELECT * FROM (VALUES
      (61, interval '168 hours', 'owner'), (62, interval '168 hours 1 second', 'group'),
      (63, interval '0', 'group'), (64, interval '-1 second', 'group'), (65, interval '1 microsecond', 'owner')) v(k, age, expect) LOOP
    PERFORM pg_temp.mk_out(c.k, pg_temp.u('d1'), '+1999555' || lpad((100 + c.k)::text, 4, '0'), '+15550002222');
    SET LOCAL ROLE service_role;
    PERFORM pg_temp.expect('RO-T5 fixture', pg_temp.dial(c.k, 'ro_d1', '+1999555' || lpad((100 + c.k)::text, 4, '0'), '+15550002222', t - c.age), 'persisted', 'recorded');
    r := pg_temp.plan(pg_temp.mk_in(c.k, '+1999555' || lpad((100 + c.k)::text, 4, '0'), '+15550002222', t));
    RESET ROLE;
    IF (c.expect = 'owner' AND r->'attempt'->>'owner_source' IS DISTINCT FROM 'recent_outbound')
       OR (c.expect = 'group' AND r->'attempt'->>'mode' IS DISTINCT FROM 'group') THEN
      RAISE EXCEPTION 'RO-T5 start inbound-% expected % got %', c.age, c.expect, r; END IF;
    PERFORM pg_temp.reset();
  END LOOP;
END $$;

-- RO-T6 (D1/D4): out-of-order capture is ordered by PROVIDER start; equal starts tie-break on DialCallSid DESC;
--        a deactivated agent and an agent no longer permitted the number (reassigned Personal, released) are skipped
DO $$
DECLARE r jsonb;
BEGIN
  -- out of order: the NEWER dial (d1, T-1h) is captured first, the OLDER one (d2, T-3h) afterwards
  PERFORM pg_temp.mk_out(70, pg_temp.u('d1'), '+19995550170', '+15550003333');
  PERFORM pg_temp.mk_out(71, pg_temp.u('d2'), '+19995550170', '+15550003333');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.expect('RO-T6 newer', pg_temp.dial(70, 'ro_d1', '+19995550170', '+15550003333', now() - interval '1 hour'), 'persisted', 'recorded');
  PERFORM pg_temp.expect('RO-T6 older', pg_temp.dial(71, 'ro_d2', '+19995550170', '+15550003333', now() - interval '3 hours'), 'persisted', 'recorded');
  r := pg_temp.plan(pg_temp.mk_in(70, '+19995550170', '+15550003333'));
  RESET ROLE;
  IF r->'attempt'->>'owner_agent_id' IS DISTINCT FROM pg_temp.u('d1')::text OR r->'attempt'->>'owner_evidence_dial_call_sid' IS DISTINCT FROM pg_temp.ca(2070) THEN
    RAISE EXCEPTION 'RO-T6 out-of-order capture must not change the order %', r; END IF;
  PERFORM pg_temp.reset();

  -- deactivated newest dialer ⇒ the next eligible dialer
  UPDATE public.profiles SET status = 'Inactive' WHERE id = pg_temp.u('d1');
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(71, '+19995550170', '+15550003333'));
  RESET ROLE;
  IF r->'attempt'->>'owner_agent_id' IS DISTINCT FROM pg_temp.u('d2')::text OR r->'attempt'->>'owner_evidence_dial_call_sid' IS DISTINCT FROM pg_temp.ca(2071) THEN
    RAISE EXCEPTION 'RO-T6 deactivated agent must be skipped %', r; END IF;
  UPDATE public.profiles SET status = 'Active' WHERE id = pg_temp.u('d1');
  PERFORM pg_temp.reset();

  -- DID B reassigned as d2's PERSONAL number ⇒ d1 may no longer use it (skipped) ⇒ d2
  UPDATE public.phone_numbers SET assignment_type = 'personal', assigned_to = pg_temp.u('d2') WHERE phone_number = '+15550003333';
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(72, '+19995550170', '+15550003333'));
  RESET ROLE;
  IF r->'attempt'->>'owner_agent_id' IS DISTINCT FROM pg_temp.u('d2')::text THEN RAISE EXCEPTION 'RO-T6 reassigned number (d2 owns it) %', r; END IF;
  PERFORM pg_temp.reset();
  -- … reassigned to d3 ⇒ neither dialer is permitted ⇒ group
  UPDATE public.phone_numbers SET assigned_to = pg_temp.u('d3') WHERE phone_number = '+15550003333';
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(73, '+19995550170', '+15550003333'));
  RESET ROLE;
  IF r->'attempt'->>'mode' IS DISTINCT FROM 'group' THEN RAISE EXCEPTION 'RO-T6 reassigned number (d3 owns it) %', r; END IF;
  PERFORM pg_temp.reset();
  -- … released ⇒ group
  UPDATE public.phone_numbers SET assignment_type = 'agency', assigned_to = NULL, status = 'released' WHERE phone_number = '+15550003333';
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(74, '+19995550170', '+15550003333'));
  RESET ROLE;
  IF r->'attempt'->>'mode' IS DISTINCT FROM 'group' THEN RAISE EXCEPTION 'RO-T6 released number %', r; END IF;
  UPDATE public.phone_numbers SET status = 'active' WHERE phone_number = '+15550003333';
  PERFORM pg_temp.reset();

  -- equal provider starts ⇒ the greater DialCallSid wins
  PERFORM pg_temp.mk_out(75, pg_temp.u('d2'), '+19995550175', '+15550003333');
  PERFORM pg_temp.mk_out(76, pg_temp.u('d3'), '+19995550175', '+15550003333');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.expect('RO-T6 tie a', pg_temp.dial(75, 'ro_d2', '+19995550175', '+15550003333', now() - interval '1 hour'), 'persisted', 'recorded');
  PERFORM pg_temp.expect('RO-T6 tie b', pg_temp.dial(76, 'ro_d3', '+19995550175', '+15550003333', now() - interval '1 hour'), 'persisted', 'recorded');
  r := pg_temp.plan(pg_temp.mk_in(75, '+19995550175', '+15550003333'));
  RESET ROLE;
  IF r->'attempt'->>'owner_agent_id' IS DISTINCT FROM pg_temp.u('d3')::text OR r->'attempt'->>'owner_evidence_dial_call_sid' IS DISTINCT FROM pg_temp.ca(2076) THEN
    RAISE EXCEPTION 'RO-T6 tie-break must pick the greater DialCallSid %', r; END IF;
  PERFORM pg_temp.reset();

  -- evidence whose context was not 'unsaved' at capture never routes (k=31 contact at capture, k=38 browser-marked)
  DELETE FROM public.leads WHERE id = 'e0000000-0000-0000-0003-000000000031';
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(76, '+19995550131', '+15550002222'));
  RESET ROLE;
  IF r->'attempt'->>'mode' IS DISTINCT FROM 'group' THEN RAISE EXCEPTION 'RO-T6 contact-context evidence must not route %', r; END IF;
  PERFORM pg_temp.reset();
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(77, '+19995550138', '+15550002222'));
  RESET ROLE;
  IF r->'attempt'->>'mode' IS DISTINCT FROM 'group' THEN RAISE EXCEPTION 'RO-T6 browser-marked evidence must not route %', r; END IF;
  PERFORM pg_temp.reset();
END $$;

-- RO-T7 (clarification 4): UNANSWERED evidence is captured but routes the group while unanswered_eligible = false,
--        and the dialer only once it is set
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(80, '+19995550103', '+15550002222'));   -- k=3: signed no-answer / child no-answer
  RESET ROLE;
  IF r->'attempt'->>'mode' IS DISTINCT FROM 'group' OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'no_owner->group' THEN
    RAISE EXCEPTION 'RO-T7 unanswered evidence must not route while unanswered_eligible=false %', r; END IF;
  PERFORM pg_temp.reset();
  PERFORM pg_temp.cfg(true, true);
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(81, '+19995550104', '+15550002222'));   -- k=4: signed no-answer / child canceled
  RESET ROLE;
  IF r->'attempt'->>'owner_source' IS DISTINCT FROM 'recent_outbound' OR r->'attempt'->>'owner_agent_id' IS DISTINCT FROM pg_temp.u('d1')::text
     OR r->'attempt'->>'owner_evidence_outcome' IS DISTINCT FROM 'unanswered' THEN
    RAISE EXCEPTION 'RO-T7 unanswered_eligible=true must route the dialer %', r; END IF;
  PERFORM pg_temp.reset();
  PERFORM pg_temp.cfg(true, false);
END $$;

-- RO-T8 (D5/D13): the unchanged individual-agent flow for the dialer — DND / Break / busy ⇒ agent voicemail;
--        offline + mobile ⇒ owner_mobile with the D13 mark; offline without mobile ⇒ agent voicemail; every
--        D13 snapshot is [dialer]
DO $$
DECLARE r jsonb; m jsonb; c record; i integer := 90; v_busy uuid;
BEGIN
  FOR c IN SELECT * FROM (VALUES ('On Break', 'owner_voicemail', 'owner_dnd', 'dnd'), ('Do Not Disturb', 'owner_voicemail', 'owner_dnd', 'dnd'))
           v(avail, stage, reason, missed) LOOP
    i := i + 1;
    UPDATE public.profiles SET availability_status = c.avail WHERE id = pg_temp.u('d1');
    SET LOCAL ROLE service_role;
    r := pg_temp.plan(pg_temp.mk_in(i, '+19995550150', '+15550002222'));
    RESET ROLE;
    m := pg_temp.missed((r->'attempt'->>'call_id')::uuid);
    IF r->>'stage' IS DISTINCT FROM c.stage OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM c.reason OR r->'attempt'->>'owner_source' IS DISTINCT FROM 'recent_outbound'
       OR r->'attempt'->>'voicemail_kind' IS DISTINCT FROM 'agent' OR r->'attempt'->>'voicemail_agent_id' IS DISTINCT FROM pg_temp.u('d1')::text
       OR (m->>'is_missed')::boolean IS NOT TRUE OR m->>'reason' IS DISTINCT FROM c.missed OR m->>'for' IS DISTINCT FROM pg_temp.u('d1')::text
       OR m->'recipients' IS DISTINCT FROM jsonb_build_array(pg_temp.u('d1')) THEN
      RAISE EXCEPTION 'RO-T8 % %  %', c.avail, r, m; END IF;
    PERFORM pg_temp.reset();
  END LOOP;
  UPDATE public.profiles SET availability_status = 'Available' WHERE id = pg_temp.u('d1');

  -- busy on a live outbound call
  v_busy := pg_temp.mk_out(99, pg_temp.u('d1'), '+19995550999', '+15550002222');
  UPDATE public.calls SET status = 'connected', ended_at = NULL, created_at = now() WHERE id = v_busy;
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(95, '+19995550150', '+15550002222'));
  RESET ROLE;
  m := pg_temp.missed((r->'attempt'->>'call_id')::uuid);
  IF r->>'stage' IS DISTINCT FROM 'owner_voicemail' OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'owner_busy' OR m->>'reason' IS DISTINCT FROM 'busy'
     OR m->'recipients' IS DISTINCT FROM jsonb_build_array(pg_temp.u('d1')) THEN RAISE EXCEPTION 'RO-T8 busy % %', r, m; END IF;
  UPDATE public.calls SET status = 'completed', ended_at = now() WHERE id = v_busy;
  PERFORM pg_temp.reset();

  -- offline with a mobile ⇒ immediate forward, D13 committed in the same call
  PERFORM pg_temp.disconnect(pg_temp.u('d1'));
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(96, '+19995550150', '+15550002222'));
  RESET ROLE;
  m := pg_temp.missed((r->'attempt'->>'call_id')::uuid);
  IF r->>'stage' IS DISTINCT FROM 'owner_mobile' OR r->>'mobile' IS DISTINCT FROM '+15559990001' OR r->'attempt'->>'owner_source' IS DISTINCT FROM 'recent_outbound'
     OR m->>'reason' IS DISTINCT FROM 'forwarded_to_mobile' OR m->'recipients' IS DISTINCT FROM jsonb_build_array(pg_temp.u('d1')) THEN
    RAISE EXCEPTION 'RO-T8 offline + mobile % %', r, m; END IF;
  PERFORM pg_temp.reset();
  -- offline without a mobile ⇒ agent voicemail
  UPDATE public.agent_inbound_settings SET mobile_forward_enabled = false WHERE agent_id = pg_temp.u('d1');
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(97, '+19995550150', '+15550002222'));
  RESET ROLE;
  m := pg_temp.missed((r->'attempt'->>'call_id')::uuid);
  IF r->>'stage' IS DISTINCT FROM 'owner_voicemail' OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'owner_offline_no_mobile'
     OR m->>'reason' IS DISTINCT FROM 'offline_no_mobile' OR m->'recipients' IS DISTINCT FROM jsonb_build_array(pg_temp.u('d1')) THEN
    RAISE EXCEPTION 'RO-T8 offline without mobile % %', r, m; END IF;
  UPDATE public.agent_inbound_settings SET mobile_forward_enabled = true WHERE agent_id = pg_temp.u('d1');
  PERFORM pg_temp.connect(pg_temp.u('d1'));
  PERFORM pg_temp.reset();
END $$;

-- RO-T9 (clarification 3): a callback that arrives BEFORE its evidence is captured is group-routed; the evidence is
--        then recorded; the handler's replay still returns the SAME committed group attempt. Recovery reads ONLY the
--        committed attempt: although the resolver now names the dialer for this very call, intended_recipients_for_call
--        keeps the group and an EMPTY snapshot converges to the group — never the dialer
DO $$
DECLARE r jsonb; r2 jsonb; call uuid; before_att jsonb;
BEGIN
  PERFORM pg_temp.mk_out(100, pg_temp.u('d1'), '+19995550200', '+15550002222');
  call := pg_temp.mk_in(100, '+19995550200', '+15550002222');
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(call);
  RESET ROLE;
  IF r->>'stage' IS DISTINCT FROM 'group_browser' OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'no_owner->group' THEN RAISE EXCEPTION 'RO-T9 first plan %', r; END IF;
  before_att := pg_temp.att(call);
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.expect('RO-T9 late capture', pg_temp.dial(100, 'ro_d1', '+19995550200', '+15550002222', now() - interval '30 seconds'), 'persisted', 'recorded');
  r2 := pg_temp.plan(call);
  RESET ROLE;
  IF (r2->>'created')::boolean IS NOT FALSE OR r2->>'stage' IS DISTINCT FROM 'group_browser' OR pg_temp.att(call) IS DISTINCT FROM before_att THEN
    RAISE EXCEPTION 'RO-T9 the committed group decision must be replayed unchanged %', r2; END IF;
  -- the late evidence IS eligible for this call (a resolver-reading recovery tier would name the dialer) …
  IF (SELECT array_agg(cand.o_agent_id) FROM private.recent_outbound_route_candidate(pg_temp.u('e0'), call, false) cand)
       IS DISTINCT FROM ARRAY[pg_temp.u('d1')] THEN
    RAISE EXCEPTION 'RO-T9 setup: the late evidence must be eligible for the committed call'; END IF;
  -- … yet recovery follows the committed GROUP attempt
  IF private.intended_recipients_for_call(call, pg_temp.u('e0')) IS DISTINCT FROM ARRAY[pg_temp.u('a1'), pg_temp.u('a2')] THEN
    RAISE EXCEPTION 'RO-T9 recovery must keep the committed group, got %', private.intended_recipients_for_call(call, pg_temp.u('e0')); END IF;
  -- the worker was lost: the parent ended with the missed row committed but NO snapshot ⇒ the group is notified, not the dialer
  UPDATE public.inbound_route_attempts SET terminal = true, reserved_agent_ids = '{}' WHERE call_id = call;
  UPDATE public.calls SET status = 'no-answer', ended_at = now(), is_missed = true, missed_reason = 'no_answer', missed_recipient_ids = '{}'
   WHERE id = call;
  SET LOCAL ROLE service_role;
  r2 := public.converge_inbound_notifications(call);
  RESET ROLE;
  IF (SELECT array_agg(n.user_id ORDER BY n.user_id) FROM public.notifications n WHERE n.event_key = 'missed_call:' || call::text)
       IS DISTINCT FROM ARRAY[pg_temp.u('a1'), pg_temp.u('a2')]
     OR pg_temp.missed(call)->'recipients' IS DISTINCT FROM jsonb_build_array(pg_temp.u('a1'), pg_temp.u('a2')) THEN
    RAISE EXCEPTION 'RO-T9 an empty snapshot must converge to the group (a1, a2), never the dialer: % %', r2, pg_temp.missed(call); END IF;
  PERFORM pg_temp.reset();
  -- a LATER call from the same person is routed on the evidence
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(101, '+19995550200', '+15550002222'));
  RESET ROLE;
  IF r->'attempt'->>'owner_source' IS DISTINCT FROM 'recent_outbound' THEN RAISE EXCEPTION 'RO-T9 later call %', r; END IF;
  PERFORM pg_temp.reset();
END $$;

-- RO-T10: the tier runs only for a call that carries NO contact. A call linked at ingest to a lead whose phone no longer
--         matches the caller (the re-check answers not_found) with eligible evidence present ⇒ group, never recent_outbound
DO $$
DECLARE r jsonb; call uuid;
BEGIN
  INSERT INTO public.leads (id, organization_id, phone, first_name, assigned_agent_id)
  VALUES ('e0000000-0000-0000-0003-000000000160', pg_temp.u('e0'), '+19990001160', 'Number changed', NULL);
  call := pg_temp.mk_in(130, '+19995550150', '+15550002222', now(), '{"contact_id":"e0000000-0000-0000-0003-000000000160"}');
  IF public.resolve_inbound_contact(pg_temp.u('e0'), '+19995550150')->>'resolution' IS DISTINCT FROM 'not_found'
     OR (SELECT array_agg(cand.o_agent_id) FROM private.recent_outbound_route_candidate(pg_temp.u('e0'), call, false) cand)
          IS DISTINCT FROM ARRAY[pg_temp.u('d1')] THEN
    RAISE EXCEPTION 'RO-T10 setup: the caller must re-check not_found with evidence eligible for d1'; END IF;
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(call);
  RESET ROLE;
  IF r->'attempt'->>'mode' IS DISTINCT FROM 'group' OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'no_owner->group'
     OR r->'attempt'->>'owner_source' IS NOT NULL OR r->'attempt'->>'owner_evidence_dial_call_sid' IS NOT NULL THEN
    RAISE EXCEPTION 'RO-T10 a call carrying a contact must never route on recent-outbound evidence %', r; END IF;
  PERFORM pg_temp.reset();
  DELETE FROM public.leads WHERE id = 'e0000000-0000-0000-0003-000000000160';
END $$;

-- ══ RO-D9: optional lookups are CONTAINED (group + WARNING + reason); identity/ownership checks fail CLOSED ══
-- RO-D9a: configuration read fault
SAVEPOINT ro_d9a;
ALTER TABLE private.recent_outbound_routing_orgs RENAME TO recent_outbound_routing_orgs_fault;
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(110, '+19995550150', '+15550002222'));
  RESET ROLE;
  IF r->>'stage' IS DISTINCT FROM 'group_browser' OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'recent_outbound_unavailable->group' THEN
    RAISE EXCEPTION 'RO-D9a config fault must route the group with its reason %', r; END IF;
  PERFORM pg_temp.reset();
  PERFORM pg_temp.disconnect(pg_temp.u('a1')); PERFORM pg_temp.disconnect(pg_temp.u('a2'));
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(111, '+19995550150', '+15550002222'));
  RESET ROLE;
  IF r->>'stage' IS DISTINCT FROM 'group_voicemail' OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'recent_outbound_unavailable->group_empty' THEN
    RAISE EXCEPTION 'RO-D9a config fault with nobody eligible %', r; END IF;
END $$;
ROLLBACK TO SAVEPOINT ro_d9a;
-- RO-D9b: evidence lookup fault
SAVEPOINT ro_d9b;
ALTER TABLE private.outbound_dial_evidence RENAME TO outbound_dial_evidence_fault;
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(112, '+19995550150', '+15550002222'));
  RESET ROLE;
  IF r->>'stage' IS DISTINCT FROM 'group_browser' OR r->'attempt'->>'eligibility_reason' IS DISTINCT FROM 'recent_outbound_unavailable->group' THEN
    RAISE EXCEPTION 'RO-D9b evidence fault must route the group with its reason %', r; END IF;
END $$;
ROLLBACK TO SAVEPOINT ro_d9b;
-- RO-D9c: the CRM re-check (resolve_inbound_contact) fails ⇒ plan_inbound_route RAISES; nothing is planned
SAVEPOINT ro_d9c;
CREATE OR REPLACE FUNCTION public.resolve_inbound_contact(p_org_id uuid, p_phone text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $f$
BEGIN RAISE EXCEPTION 'simulated CRM resolver fault'; END $f$;
DO $$
DECLARE r jsonb; v_raised boolean := false; v_msg text; call uuid;
BEGIN
  call := pg_temp.mk_in(113, '+19995550150', '+15550002222');
  BEGIN
    SET LOCAL ROLE service_role;
    r := pg_temp.plan(call);
  EXCEPTION WHEN OTHERS THEN
    v_raised := true; v_msg := SQLERRM;
  END;
  RESET ROLE;
  IF NOT v_raised OR v_msg NOT LIKE '%simulated CRM resolver fault%' THEN RAISE EXCEPTION 'RO-D9c must fail closed, got % / %', r, v_msg; END IF;
  IF pg_temp.att(call) IS NOT NULL THEN RAISE EXCEPTION 'RO-D9c no attempt may be created'; END IF;
END $$;
ROLLBACK TO SAVEPOINT ro_d9c;
-- RO-D9d: the direct-line re-check fails ⇒ plan_inbound_route RAISES
SAVEPOINT ro_d9d;
ALTER TABLE public.phone_numbers RENAME TO phone_numbers_fault;
DO $$
DECLARE r jsonb; v_raised boolean := false; call uuid;
BEGIN
  call := pg_temp.mk_in(114, '+19995550150', '+15550002222');
  BEGIN
    SET LOCAL ROLE service_role;
    r := pg_temp.plan(call);
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised OR pg_temp.att(call) IS NOT NULL THEN RAISE EXCEPTION 'RO-D9d the direct-line re-check must fail closed %', r; END IF;
END $$;
ROLLBACK TO SAVEPOINT ro_d9d;
-- after every fault is restored, routing works again
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(pg_temp.mk_in(115, '+19995550150', '+15550002222'));
  RESET ROLE;
  IF r->'attempt'->>'owner_source' IS DISTINCT FROM 'recent_outbound' THEN RAISE EXCEPTION 'RO-D9 restored %', r; END IF;
  PERFORM pg_temp.reset();
END $$;

-- ══ RO-L: lifecycle of a recent_outbound attempt ═══════════════════════════════════════════════════════

-- RO-L1: claim — only the dialer (the persisted wave) may claim; a group member is not_routed
DO $$
DECLARE r jsonb; call uuid; sid text;
BEGIN
  call := pg_temp.mk_in(120, '+19995550150', '+15550002222');
  sid := 'CA' || lpad(to_hex(900000 + 120), 32, '0');
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(call);
  PERFORM public.append_call_routed_agents(call, pg_temp.u('e0'), ARRAY(SELECT jsonb_array_elements_text(r->'targets')::uuid));
  r := public.claim_inbound_call(pg_temp.u('a1'), call, pg_temp.ca(5120), sid);
  IF (r->>'claimed')::boolean OR r->>'reason' IS DISTINCT FROM 'not_routed' THEN RESET ROLE; RAISE EXCEPTION 'RO-L1 group member %', r; END IF;
  r := public.claim_inbound_call(pg_temp.u('d1'), call, pg_temp.ca(5120), sid);
  RESET ROLE;
  IF (r->>'claimed')::boolean IS NOT TRUE OR r->>'agent_id' IS DISTINCT FROM pg_temp.u('d1')::text THEN RAISE EXCEPTION 'RO-L1 dialer claim %', r; END IF;
  PERFORM pg_temp.reset();
END $$;

-- RO-L2: browser timeout ⇒ advance_to_owner_mobile commits the dialer's mobile with the D13 mark [dialer]
--        (the attempt's owner binding is all the mobile stage reads; owner_source is never consulted)
DO $$
DECLARE r jsonb; call uuid; m jsonb;
BEGIN
  call := pg_temp.mk_in(121, '+19995550150', '+15550002222');
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(call);
  r := public.advance_to_owner_mobile((r->'attempt'->>'id')::uuid, pg_temp.u('e0'), call);
  RESET ROLE;
  m := pg_temp.missed(call);
  IF (r->>'forward')::boolean IS NOT TRUE OR r->>'mobile' IS DISTINCT FROM '+15559990001' OR m->>'reason' IS DISTINCT FROM 'forwarded_to_mobile'
     OR m->'recipients' IS DISTINCT FROM jsonb_build_array(pg_temp.u('d1')) THEN RAISE EXCEPTION 'RO-L2 % %', r, m; END IF;
  PERFORM pg_temp.reset();
END $$;

-- RO-L3: finalize closes the open ring and preserves [dialer]; the durable sweep abandons a stale recent_outbound
--        ring with the snapshot [dialer]
DO $$
DECLARE r jsonb; call uuid; a jsonb;
BEGIN
  call := pg_temp.mk_in(122, '+19995550150', '+15550002222');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.plan(call);
  r := public.finalize_inbound_call_terminal(call, pg_temp.u('e0'), 'no-answer', true);
  RESET ROLE;
  a := pg_temp.att(call);
  IF (r->>'updated')::boolean IS NOT TRUE OR (a->>'terminal')::boolean IS NOT TRUE OR a->>'final_outcome' IS DISTINCT FROM 'parent_no-answer'
     OR a->'reserved_agent_ids' IS DISTINCT FROM '[]'::jsonb OR pg_temp.missed(call)->'recipients' IS DISTINCT FROM jsonb_build_array(pg_temp.u('d1')) THEN
    RAISE EXCEPTION 'RO-L3 finalize % % %', r, a, pg_temp.missed(call); END IF;

  call := pg_temp.mk_in(123, '+19995550150', '+15550002222', now() - interval '60 minutes');
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(call);
  IF r->'attempt'->>'owner_source' IS DISTINCT FROM 'recent_outbound' THEN RESET ROLE; RAISE EXCEPTION 'RO-L3 stale setup %', r; END IF;
  r := public.sweep_inbound_route_attempts(interval '2 minutes', interval '30 minutes', 100);
  RESET ROLE;
  a := pg_temp.att(call);
  IF pg_temp.missed(call)->>'status' IS DISTINCT FROM 'no-answer' OR (a->>'terminal')::boolean IS NOT TRUE
     OR pg_temp.missed(call)->'recipients' IS DISTINCT FROM jsonb_build_array(pg_temp.u('d1'))
     OR public.is_agent_busy(pg_temp.u('e0'), pg_temp.u('d1'), NULL) THEN
    RAISE EXCEPTION 'RO-L3 sweep % % %', r, a, pg_temp.missed(call); END IF;
  PERFORM pg_temp.reset();
END $$;

-- RO-L4: the dialer's voicemail is stored in mailbox agent:<dialer>; convergence notifies the dialer exactly once
--        for the missed call and once for the voicemail — nobody else
DO $$
DECLARE r jsonb; call uuid; v jsonb; n integer;
BEGIN
  UPDATE public.profiles SET availability_status = 'Do Not Disturb' WHERE id = pg_temp.u('d1');
  call := pg_temp.mk_in(124, '+19995550150', '+15550002222');
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(call);
  v := public.upsert_voicemail_from_recording('RE' || lpad(to_hex(124), 32, '0'), call, pg_temp.u('e0'), (r->'attempt'->>'id')::uuid,
                                              'agent:' || pg_temp.u('d1')::text, 'ro/voicemail-124.mp3', 12, 'stored');
  PERFORM public.converge_inbound_notifications(call);
  PERFORM public.converge_inbound_notifications(call);   -- redelivery converges to the same rows
  RESET ROLE;
  UPDATE public.profiles SET availability_status = 'Available' WHERE id = pg_temp.u('d1');
  IF v->>'recipient_kind' IS DISTINCT FROM 'agent' OR v->>'recipient_agent_id' IS DISTINCT FROM pg_temp.u('d1')::text THEN RAISE EXCEPTION 'RO-L4 voicemail %', v; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE event_key = 'missed_call:' || call::text;
  IF n IS DISTINCT FROM 1 OR NOT EXISTS (SELECT 1 FROM public.notifications WHERE event_key = 'missed_call:' || call::text AND user_id = pg_temp.u('d1')) THEN
    RAISE EXCEPTION 'RO-L4 exactly one missed-call alert for the dialer, got %', n; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE event_key = 'voicemail:' || (v->>'id');
  IF n IS DISTINCT FROM 1 OR NOT EXISTS (SELECT 1 FROM public.notifications WHERE event_key = 'voicemail:' || (v->>'id') AND user_id = pg_temp.u('d1')) THEN
    RAISE EXCEPTION 'RO-L4 exactly one voicemail alert for the dialer, got %', n; END IF;
  PERFORM pg_temp.reset();
END $$;

-- RO-L5: the recovery tier — intended_recipients_for_call returns [dialer] for a committed recent_outbound attempt
--        (while the dialer is Active; otherwise the group), never for a group attempt; an EMPTY snapshot is
--        resolved through it and converges to exactly one alert for the dialer
DO $$
DECLARE r jsonb; call uuid; call_g uuid; n integer;
BEGIN
  call := pg_temp.mk_in(125, '+19995550150', '+15550002222');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.plan(call);
  RESET ROLE;
  IF private.intended_recipients_for_call(call, pg_temp.u('e0')) IS DISTINCT FROM ARRAY[pg_temp.u('d1')] THEN
    RAISE EXCEPTION 'RO-L5 tier must name the dialer, got %', private.intended_recipients_for_call(call, pg_temp.u('e0')); END IF;
  UPDATE public.profiles SET status = 'Inactive' WHERE id = pg_temp.u('d1');
  IF private.intended_recipients_for_call(call, pg_temp.u('e0')) IS DISTINCT FROM ARRAY[pg_temp.u('a1'), pg_temp.u('a2')] THEN
    RAISE EXCEPTION 'RO-L5 an inactive dialer falls through to the group'; END IF;
  UPDATE public.profiles SET status = 'Active' WHERE id = pg_temp.u('d1');
  -- a group attempt of an unknown caller keeps the group
  call_g := pg_temp.mk_in(126, '+19995559876', '+15550002222');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.plan(call_g);
  RESET ROLE;
  IF private.intended_recipients_for_call(call_g, pg_temp.u('e0')) IS DISTINCT FROM ARRAY[pg_temp.u('a1'), pg_temp.u('a2')] THEN
    RAISE EXCEPTION 'RO-L5 group attempt must keep the group'; END IF;
  -- the worker was lost: the parent ended with the missed row committed but NO snapshot
  UPDATE public.inbound_route_attempts SET terminal = true, reserved_agent_ids = '{}' WHERE call_id = call;
  UPDATE public.calls SET status = 'no-answer', ended_at = now(), is_missed = true, missed_reason = 'no_answer', missed_recipient_ids = '{}'
   WHERE id = call;
  SET LOCAL ROLE service_role;
  r := public.converge_inbound_notifications(call);
  RESET ROLE;
  SELECT count(*) INTO n FROM public.notifications WHERE event_key = 'missed_call:' || call::text;
  IF n IS DISTINCT FROM 1 OR NOT EXISTS (SELECT 1 FROM public.notifications WHERE event_key = 'missed_call:' || call::text AND user_id = pg_temp.u('d1'))
     OR pg_temp.missed(call)->'recipients' IS DISTINCT FROM jsonb_build_array(pg_temp.u('d1')) THEN
    RAISE EXCEPTION 'RO-L5 empty snapshot must converge to one alert for the dialer, got % %', n, r; END IF;
  PERFORM pg_temp.reset();
END $$;

-- RO-L6: the resolver is read-only and tenant-scoped; the attempt CHECKs refuse inconsistent evidence columns
DO $$
DECLARE n integer; call uuid;
BEGIN
  call := pg_temp.mk_in(127, '+19995550150', '+15550002222');
  SELECT count(*) INTO n FROM private.recent_outbound_route_candidate(pg_temp.u('e0'), call, false);
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'RO-L6 resolver must return one row, got %', n; END IF;
  SELECT count(*) INTO n FROM private.recent_outbound_route_candidate(pg_temp.u('f0'), call, false);
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'RO-L6 another organization must see nothing'; END IF;
  BEGIN
    INSERT INTO public.inbound_route_attempts (call_id, organization_id, mode, owner_agent_id, owner_source, eligibility_reason, stage,
                                               owner_evidence_dial_call_sid, owner_evidence_provider_started_at, owner_evidence_outcome)
    VALUES (call, pg_temp.u('e0'), 'owner', pg_temp.u('d1'), 'recent_outbound', 'x', 'owner_browser', pg_temp.ca(2050), now(), NULL);
    RAISE EXCEPTION 'RO-L6 a recent_outbound attempt with a NULL outcome must be refused';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.inbound_route_attempts (call_id, organization_id, mode, owner_agent_id, owner_source, eligibility_reason, stage,
                                               owner_evidence_dial_call_sid)
    VALUES (call, pg_temp.u('e0'), 'owner', pg_temp.u('d1'), 'contact', 'x', 'owner_browser', pg_temp.ca(2050));
    RAISE EXCEPTION 'RO-L6 evidence columns on a contact attempt must be refused';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.inbound_route_attempts (call_id, organization_id, mode, owner_agent_id, owner_source, eligibility_reason, stage)
    VALUES (call, pg_temp.u('e0'), 'owner', pg_temp.u('d1'), 'somebody', 'x', 'owner_browser');
    RAISE EXCEPTION 'RO-L6 an unknown owner_source must be refused';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- group attempts keep owner_source NULL (M6 NULL semantics preserved)
  INSERT INTO public.inbound_route_attempts (call_id, organization_id, mode, eligibility_reason, stage)
  VALUES (call, pg_temp.u('e0'), 'group', 'x', 'group_browser');
  PERFORM pg_temp.reset();
END $$;

-- RO-L7: the recovery tier applies only while the call carries NO contact. A committed recent_outbound attempt whose call
--        is later linked to an UNASSIGNED lead follows the contact tier (established unassigned ⇒ the group), never the dialer
DO $$
DECLARE r jsonb; call uuid;
BEGIN
  call := pg_temp.mk_in(131, '+19995550150', '+15550002222');
  SET LOCAL ROLE service_role;
  r := pg_temp.plan(call);
  RESET ROLE;
  IF r->'attempt'->>'owner_source' IS DISTINCT FROM 'recent_outbound'
     OR private.intended_recipients_for_call(call, pg_temp.u('e0')) IS DISTINCT FROM ARRAY[pg_temp.u('d1')] THEN
    RAISE EXCEPTION 'RO-L7 setup: a committed recent_outbound attempt naming d1 %', r; END IF;
  INSERT INTO public.leads (id, organization_id, phone, first_name, assigned_agent_id)
  VALUES ('e0000000-0000-0000-0003-000000000161', pg_temp.u('e0'), '+19995550150', 'Saved after the call', NULL);
  UPDATE public.calls SET contact_id = 'e0000000-0000-0000-0003-000000000161', contact_type = 'lead' WHERE id = call;
  IF private.intended_recipients_for_call(call, pg_temp.u('e0')) IS DISTINCT FROM ARRAY[pg_temp.u('a1'), pg_temp.u('a2')] THEN
    RAISE EXCEPTION 'RO-L7 a call linked to an unassigned lead must resolve to the group, got %',
      private.intended_recipients_for_call(call, pg_temp.u('e0')); END IF;
  PERFORM pg_temp.reset();
  DELETE FROM public.leads WHERE id = 'e0000000-0000-0000-0003-000000000161';   -- +19995550150 is unknown again
END $$;

-- ══ RO-P: effective permissions (§A7) as the real roles ════════════════════════════════════════════════
DO $$
DECLARE c record; st text; v_role text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u('d1'), 'role', 'authenticated', 'org_id', pg_temp.u('e0'))::text, true);
  CREATE ROLE ro_public_probe NOLOGIN;   -- holds nothing but PUBLIC's privileges (rolled back with the file)
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','ro_public_probe'] LOOP
    IF has_schema_privilege(v_role, 'private', 'USAGE') THEN RAISE EXCEPTION 'RO-P % must not hold USAGE on private', v_role; END IF;
    FOR c IN SELECT * FROM (VALUES
        ('SELECT 1 FROM private.outbound_dial_evidence LIMIT 1'),
        ('INSERT INTO private.outbound_dial_evidence DEFAULT VALUES'),
        ('UPDATE private.outbound_dial_evidence SET dial_call_status = dial_call_status'),
        ('DELETE FROM private.outbound_dial_evidence'),
        ('TRUNCATE private.outbound_dial_evidence'),
        ('SELECT 1 FROM private.recent_outbound_routing_orgs LIMIT 1'),
        ('INSERT INTO private.recent_outbound_routing_orgs (organization_id, enabled) VALUES (gen_random_uuid(), true)'),
        ('UPDATE private.recent_outbound_routing_orgs SET enabled = true'),
        ('DELETE FROM private.recent_outbound_routing_orgs'),
        ('TRUNCATE private.recent_outbound_routing_orgs'),
        ('SELECT * FROM private.recent_outbound_route_candidate(NULL, NULL, true)'),
        ('SELECT private.intended_recipients_for_call(NULL, NULL)')) v(stmt) LOOP
      st := pg_temp.state_as(v_role, c.stmt);
      IF st IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'RO-P % must be refused 42501: % (got %)', v_role, c.stmt, st; END IF;
    END LOOP;
  END LOOP;
  -- the record RPC: service_role only
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','ro_public_probe'] LOOP
    st := pg_temp.state_as(v_role, 'SELECT public.record_outbound_dial_evidence(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)');
    IF st IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'RO-P % must not execute record_outbound_dial_evidence (got %)', v_role, st; END IF;
    -- the existing wrappers that reach the new objects stay service-role only
    FOR c IN SELECT * FROM (VALUES
        ('SELECT public.plan_inbound_route(NULL, NULL, NULL, NULL, NULL, 20)'),
        ('SELECT public.converge_inbound_notifications(NULL)'),
        ('SELECT public.abandon_inbound_routing(NULL, NULL, NULL)'),
        ('SELECT public.sweep_inbound_route_attempts()'),
        ('SELECT public.sweep_inbound_notifications()')) v(stmt) LOOP
      st := pg_temp.state_as(v_role, c.stmt);
      IF st IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'RO-P % must be refused 42501: % (got %)', v_role, c.stmt, st; END IF;
    END LOOP;
  END LOOP;
  st := pg_temp.state_as('service_role', 'SELECT public.record_outbound_dial_evidence(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)');
  IF st IS DISTINCT FROM 'OK' THEN RAISE EXCEPTION 'RO-P service_role must execute record_outbound_dial_evidence (got %)', st; END IF;
  SET LOCAL ROLE service_role;
  IF public.record_outbound_dial_evidence(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)->>'reason' IS DISTINCT FROM 'invalid_input' THEN
    RESET ROLE; RAISE EXCEPTION 'RO-P all-NULL input must answer invalid_input, never raise'; END IF;
  RESET ROLE;
  -- catalog view of the same matrix
  IF has_function_privilege('anon', 'public.record_outbound_dial_evidence(text,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_outbound_dial_evidence(text,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.record_outbound_dial_evidence(text,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('service_role', 'private.recent_outbound_route_candidate(uuid,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.plan_inbound_route(uuid,uuid,uuid,text,uuid[],integer)', 'EXECUTE')
     OR has_table_privilege('service_role', 'private.outbound_dial_evidence', 'SELECT')
     OR has_table_privilege('service_role', 'private.recent_outbound_routing_orgs', 'UPDATE') THEN
    RAISE EXCEPTION 'RO-P catalog privileges differ from §A7'; END IF;
END $$;

ROLLBACK;
