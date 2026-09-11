-- =====================================================================================================
-- Inbound Calling v2 — voicemails, mailbox authorization, source-cleanup state, durable notification
-- convergence + sweep (M7) — SQL tests. LOCAL disposable stack only. Whole file rolls back.
-- =====================================================================================================
BEGIN;

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','VM Org A'), ('bbbbbbbb-0000-0000-0000-00000000000b','VM Org B') ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1'), ('aaaaaaaa-0000-0000-0000-0000000000a2'), ('aaaaaaaa-0000-0000-0000-0000000000a3'),
  ('aaaaaaaa-0000-0000-0000-0000000000a4'), ('aaaaaaaa-0000-0000-0000-0000000000ad'), ('bbbbbbbb-0000-0000-0000-0000000000b1');
INSERT INTO public.profiles (id, organization_id, role, status, twilio_client_identity, availability_status) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a1','Available'),  -- owner A (offline)
  ('aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a2','Available'),  -- group member
  ('aaaaaaaa-0000-0000-0000-0000000000a3','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a3','Available'),  -- unrelated agent
  ('aaaaaaaa-0000-0000-0000-0000000000a4','aaaaaaaa-0000-0000-0000-00000000000a','Agent','Active','agent_a4','Available'),  -- number owner B
  ('aaaaaaaa-0000-0000-0000-0000000000ad','aaaaaaaa-0000-0000-0000-00000000000a','Admin','Active','agent_ad','Available'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-00000000000b','Admin','Active','agent_b1','Available');
INSERT INTO public.phone_numbers (id, organization_id, phone_number, assigned_to) VALUES
  ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','+15550001111','aaaaaaaa-0000-0000-0000-0000000000a4');
INSERT INTO public.inbound_routing_settings (organization_id, inbound_group_agent_ids)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', ARRAY['aaaaaaaa-0000-0000-0000-0000000000a2']::uuid[]);
INSERT INTO public.agent_inbound_settings (agent_id, organization_id, mobile_forward_number) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-00000000000a','+15559990001');

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid, p_role text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated', 'app_metadata', json_build_object('role', p_role))::text, true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.mk_call(p_id uuid, p_sid text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.calls (id, organization_id, direction, status, twilio_call_sid, contact_phone, caller_id_used, contact_type, contact_name)
  VALUES (p_id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'inbound', 'ringing', p_sid, '+19995551234', '+15550001111', NULL, 'Unknown caller')
$$;

-- V1 (safeguard 2 scenario): offline contact owner A, dialed-number owner B, no browser targets ⇒ A one notification, B none —
--     through the immediate forward commit + converge; repeated converge is idempotent; completion stamped
DO $$
DECLARE r jsonb; nA int; nB int; nAll int; stamped timestamptz;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000001','CA000000000000000000000000000000a1');
  r := public.plan_inbound_route('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a',
         'aaaaaaaa-0000-0000-0000-0000000000a1','contact','{}'::uuid[], 20);
  IF r->>'stage' <> 'owner_mobile' THEN RAISE EXCEPTION 'V1 setup expected immediate forward, got %', r; END IF;
  r := public.converge_inbound_notifications('cccccccc-0000-0000-0000-000000000001');
  r := public.converge_inbound_notifications('cccccccc-0000-0000-0000-000000000001');   -- repeat: idempotent
  RESET ROLE;
  SELECT count(*) INTO nA FROM public.notifications WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' AND event_key = 'missed_call:cccccccc-0000-0000-0000-000000000001';
  SELECT count(*) INTO nB FROM public.notifications WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a4' AND event_key LIKE 'missed_call:%';
  SELECT count(*) INTO nAll FROM public.notifications WHERE event_key = 'missed_call:cccccccc-0000-0000-0000-000000000001';
  IF nA <> 1 OR nB <> 0 OR nAll <> 1 THEN RAISE EXCEPTION 'V1 A=% B=% all=%', nA, nB, nAll; END IF;
  SELECT missed_notified_at INTO stamped FROM public.calls WHERE id = 'cccccccc-0000-0000-0000-000000000001';
  IF stamped IS NULL THEN RAISE EXCEPTION 'V1 completion not stamped'; END IF;
  IF (SELECT body FROM public.notifications WHERE event_key = 'missed_call:cccccccc-0000-0000-0000-000000000001') NOT LIKE 'Missed in AgentFlow — forwarded to mobile.%' THEN
    RAISE EXCEPTION 'V1 label wrong'; END IF;
END $$;

-- V2: ownership change afterward does not change the recipient; a later mobile bridge does not clear D13 or add a notification
DO $$
DECLARE r jsonb; a public.inbound_route_attempts%ROWTYPE; nAll int;
BEGIN
  SET LOCAL ROLE service_role;
  -- simulate "contact reassigned to B" = a stale tier would now pick B; the snapshot says A
  UPDATE public.calls SET missed_notified_at = NULL WHERE id = 'cccccccc-0000-0000-0000-000000000001';   -- force re-evaluation
  r := public.converge_inbound_notifications('cccccccc-0000-0000-0000-000000000001');
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000001';
  PERFORM public.record_inbound_mobile_accept(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000000a1', 'CA000000000000000000000000000000c1', '1');
  PERFORM public.record_inbound_mobile_bridge(a.id, 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000000a1', true, 'completed', 'CA000000000000000000000000000000c1', 30);
  r := public.converge_inbound_notifications('cccccccc-0000-0000-0000-000000000001');
  RESET ROLE;
  SELECT count(*) INTO nAll FROM public.notifications WHERE event_key LIKE 'missed_call:cccccccc-0000-0000-0000-000000000001';
  IF nAll <> 1 THEN RAISE EXCEPTION 'V2 expected exactly one missed notification, got %', nAll; END IF;
  IF (SELECT user_id FROM public.notifications WHERE event_key = 'missed_call:cccccccc-0000-0000-0000-000000000001') <> 'aaaaaaaa-0000-0000-0000-0000000000a1' THEN
    RAISE EXCEPTION 'V2 recipient changed'; END IF;
  IF (SELECT is_missed FROM public.calls WHERE id = 'cccccccc-0000-0000-0000-000000000001') IS DISTINCT FROM true THEN RAISE EXCEPTION 'V2 D13 cleared'; END IF;
END $$;

-- V3: voicemail upsert — invalid attempt id ⇒ NULL reference (never an FK violation); stored is sticky; calls.voicemail_id set
DO $$
DECLARE r jsonb; a public.inbound_route_attempts%ROWTYPE; vm_id uuid;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT * INTO a FROM public.inbound_route_attempts WHERE call_id = 'cccccccc-0000-0000-0000-000000000001';
  r := public.upsert_voicemail_from_recording('RE000000000000000000000000000000a1', 'cccccccc-0000-0000-0000-000000000001',
         'aaaaaaaa-0000-0000-0000-00000000000a', '99999999-9999-9999-9999-999999999999', 'agent:aaaaaaaa-0000-0000-0000-0000000000a1',
         NULL, NULL, 'pending');
  IF r->>'attempt_id' IS NOT NULL THEN RAISE EXCEPTION 'V3 nonexistent attempt must map to NULL, got %', r->>'attempt_id'; END IF;
  r := public.upsert_voicemail_from_recording('RE000000000000000000000000000000a1', 'cccccccc-0000-0000-0000-000000000001',
         'aaaaaaaa-0000-0000-0000-00000000000a', a.id, 'agent:aaaaaaaa-0000-0000-0000-0000000000a1',
         'aaaaaaaa-0000-0000-0000-00000000000a/cccccccc-0000-0000-0000-000000000001/RE000000000000000000000000000000a1.mp3', 12, 'stored');
  vm_id := (r->>'id')::uuid;
  IF r->>'status' <> 'stored' OR (r->>'attempt_id')::uuid <> a.id THEN RAISE EXCEPTION 'V3 stored upsert %', r; END IF;
  -- a late 'pending' redelivery cannot demote stored
  r := public.upsert_voicemail_from_recording('RE000000000000000000000000000000a1', 'cccccccc-0000-0000-0000-000000000001',
         'aaaaaaaa-0000-0000-0000-00000000000a', a.id, 'agent:aaaaaaaa-0000-0000-0000-0000000000a1', NULL, NULL, 'pending');
  IF r->>'status' <> 'stored' THEN RAISE EXCEPTION 'V3 stored must be sticky'; END IF;
  IF (SELECT voicemail_id FROM public.calls WHERE id = 'cccccccc-0000-0000-0000-000000000001') <> vm_id THEN RAISE EXCEPTION 'V3 calls.voicemail_id not linked'; END IF;
  -- the owning Twilio account is remembered for cleanup retries (first non-null value wins)
  r := public.upsert_voicemail_from_recording('RE000000000000000000000000000000a1', 'cccccccc-0000-0000-0000-000000000001',
         'aaaaaaaa-0000-0000-0000-00000000000a', a.id, 'agent:aaaaaaaa-0000-0000-0000-0000000000a1', NULL, NULL, 'pending', 'AC000000000000000000000000000000aa');
  IF r->>'provider_account_sid' <> 'AC000000000000000000000000000000aa' THEN RAISE EXCEPTION 'V3 provider_account_sid not stored %', r; END IF;
  -- cross-call reuse of a RecordingSid is refused
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000002','CA000000000000000000000000000000a2');
  BEGIN
    PERFORM public.upsert_voicemail_from_recording('RE000000000000000000000000000000a1', 'cccccccc-0000-0000-0000-000000000002',
              'aaaaaaaa-0000-0000-0000-00000000000a', NULL, 'group', NULL, NULL, 'stored');
    RAISE EXCEPTION 'V3 RecordingSid reuse across calls must fail';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  RESET ROLE;
END $$;

-- V4: source-cleanup state — a failed delete after storage is retryable and never loses the notification path
DO $$
DECLARE r jsonb; n int;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.record_voicemail_cleanup_failure('RE000000000000000000000000000000a1', 'twilio 503');
  SELECT count(*) INTO n FROM public.voicemails_cleanup_batch(10) b WHERE b.recording_sid = 'RE000000000000000000000000000000a1';
  -- backoff: not due immediately
  IF n <> 0 THEN RAISE EXCEPTION 'V4 backoff must defer the retry'; END IF;
  UPDATE public.voicemails SET source_cleanup_next_at = now() - interval '1 second' WHERE recording_sid = 'RE000000000000000000000000000000a1';
  SELECT count(*) INTO n FROM public.voicemails_cleanup_batch(10) b WHERE b.recording_sid = 'RE000000000000000000000000000000a1'
     AND b.provider_account_sid = 'AC000000000000000000000000000000aa';
  IF n <> 1 THEN RAISE EXCEPTION 'V4 due retry must be listed with its owning account'; END IF;
  r := public.converge_inbound_notifications('cccccccc-0000-0000-0000-000000000001');   -- voicemail notification independent of cleanup
  IF (r->>'voicemails_notified')::int <> 1 THEN RAISE EXCEPTION 'V4 voicemail notification %', r; END IF;
  r := public.mark_voicemail_source_deleted('RE000000000000000000000000000000a1');
  SELECT count(*) INTO n FROM public.voicemails_cleanup_batch(10) b WHERE b.recording_sid = 'RE000000000000000000000000000000a1';
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'V4 deleted source must leave the cleanup batch'; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE type = 'voicemail' AND user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
  IF n <> 1 THEN RAISE EXCEPTION 'V4 expected one voicemail notification for A, got %', n; END IF;
END $$;

-- V5: mailbox authorization — recipient, group member, admin can read; other agent and other org cannot;
--     recipient may update listened_at only; storage object predicate mirrors the row predicate
DO $$
DECLARE n int; vm uuid; path text;
BEGIN
  SELECT id, storage_path INTO vm, path FROM public.voicemails WHERE recording_sid = 'RE000000000000000000000000000000a1';
  SET LOCAL ROLE service_role;
  INSERT INTO storage.objects (bucket_id, name) VALUES ('voicemails', path);
  RESET ROLE;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.voicemails WHERE id = vm;
  IF n <> 1 THEN RAISE EXCEPTION 'V5 recipient must read'; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'voicemails' AND name = path;
  IF n <> 1 THEN RAISE EXCEPTION 'V5 recipient must read the object'; END IF;
  UPDATE public.voicemails SET listened_at = now() WHERE id = vm;
  BEGIN
    UPDATE public.voicemails SET status = 'purged' WHERE id = vm;
    RAISE EXCEPTION 'V5 recipient must not update status';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a3');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.voicemails WHERE id = vm;
  IF n <> 0 THEN RAISE EXCEPTION 'V5 unrelated agent must not read'; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'voicemails' AND name = path;
  IF n <> 0 THEN RAISE EXCEPTION 'V5 unrelated agent must not read the object'; END IF;
  RESET ROLE;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000ad', 'Admin');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.voicemails WHERE id = vm;
  IF n <> 1 THEN RAISE EXCEPTION 'V5 admin must read'; END IF;
  RESET ROLE;
  PERFORM pg_temp.as_user('bbbbbbbb-0000-0000-0000-0000000000b1', 'Admin');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.voicemails WHERE id = vm;
  IF n <> 0 THEN RAISE EXCEPTION 'V5 other-org admin must not read'; END IF;
  RESET ROLE;
  IF (SELECT listened_at FROM public.voicemails WHERE id = vm) IS NULL THEN RAISE EXCEPTION 'V5 listened_at update lost'; END IF;
END $$;

-- V6: group voicemail (unknown caller, no contact) — group member and admin read; unlinked caller needs no contact record
DO $$
DECLARE r jsonb; n int; vm uuid;
BEGIN
  SET LOCAL ROLE service_role;
  r := public.plan_inbound_route('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a', NULL, NULL,
         ARRAY['aaaaaaaa-0000-0000-0000-0000000000a2']::uuid[], 20);
  IF r->>'stage' <> 'group_voicemail' THEN RAISE EXCEPTION 'V6 setup %', r; END IF;
  r := public.upsert_voicemail_from_recording('RE000000000000000000000000000000a2', 'cccccccc-0000-0000-0000-000000000002',
         'aaaaaaaa-0000-0000-0000-00000000000a', (r->'attempt'->>'id')::uuid, 'group',
         'aaaaaaaa-0000-0000-0000-00000000000a/cccccccc-0000-0000-0000-000000000002/RE000000000000000000000000000000a2.mp3', 5, 'stored');
  vm := (r->>'id')::uuid;
  IF NOT ((r->'recipient_group_ids') ? 'aaaaaaaa-0000-0000-0000-0000000000a2') THEN RAISE EXCEPTION 'V6 group snapshot %', r; END IF;
  r := public.converge_inbound_notifications('cccccccc-0000-0000-0000-000000000002');
  RESET ROLE;
  SELECT count(*) INTO n FROM public.notifications WHERE type = 'voicemail' AND user_id = 'aaaaaaaa-0000-0000-0000-0000000000a2' AND event_key = 'voicemail:' || vm::text;
  IF n <> 1 THEN RAISE EXCEPTION 'V6 group member notification %', n; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE type = 'missed_call' AND user_id = 'aaaaaaaa-0000-0000-0000-0000000000a4';
  IF n <> 0 THEN RAISE EXCEPTION 'V6 number owner must never be notified through tiers'; END IF;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a2');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.voicemails WHERE id = vm;
  IF n <> 1 THEN RAISE EXCEPTION 'V6 group member must read'; END IF;
  RESET ROLE;
END $$;

-- V7: sweep — due rows are processed, one failing record does not block others, bounded attempts, no age abandonment
DO $$
DECLARE r jsonb; n int;
BEGIN
  SET LOCAL ROLE service_role;
  -- a call whose snapshot points at an agent that is no longer Active ⇒ Admins get it (never number owner)
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000003','CA000000000000000000000000000000a3');
  PERFORM public.mark_inbound_missed('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a', 'no_answer',
            ARRAY['aaaaaaaa-0000-0000-0000-0000000000a3']::uuid[], 'aaaaaaaa-0000-0000-0000-0000000000a3');
  UPDATE public.profiles SET status = 'Inactive' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a3';
  -- an old owed row (30 days) is still processed: no time-based abandonment
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000004','CA000000000000000000000000000000a4');
  PERFORM public.mark_inbound_missed('cccccccc-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-00000000000a', 'no_answer',
            ARRAY['aaaaaaaa-0000-0000-0000-0000000000a2']::uuid[], 'aaaaaaaa-0000-0000-0000-0000000000a2');
  UPDATE public.calls SET created_at = now() - interval '30 days' WHERE id = 'cccccccc-0000-0000-0000-000000000004';
  -- an exhausted row (50 attempts) is skipped by the sweep
  PERFORM pg_temp.mk_call('cccccccc-0000-0000-0000-000000000005','CA000000000000000000000000000000a5');
  PERFORM public.mark_inbound_missed('cccccccc-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-00000000000a', 'no_answer',
            ARRAY['aaaaaaaa-0000-0000-0000-0000000000a2']::uuid[], 'aaaaaaaa-0000-0000-0000-0000000000a2');
  UPDATE public.calls SET missed_notify_attempts = 50 WHERE id = 'cccccccc-0000-0000-0000-000000000005';
  r := public.sweep_inbound_notifications(100);
  RESET ROLE;
  SELECT count(*) INTO n FROM public.notifications WHERE event_key = 'missed_call:cccccccc-0000-0000-0000-000000000003' AND user_id = 'aaaaaaaa-0000-0000-0000-0000000000ad';
  IF n <> 1 THEN RAISE EXCEPTION 'V7 inactive recipient must fall back to org Admins (got %)', n; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE event_key = 'missed_call:cccccccc-0000-0000-0000-000000000003' AND user_id = 'aaaaaaaa-0000-0000-0000-0000000000a4';
  IF n <> 0 THEN RAISE EXCEPTION 'V7 number owner must not be notified'; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE event_key = 'missed_call:cccccccc-0000-0000-0000-000000000004';
  IF n <> 1 THEN RAISE EXCEPTION 'V7 30-day-old owed row must still be processed'; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE event_key = 'missed_call:cccccccc-0000-0000-0000-000000000005';
  IF n <> 0 THEN RAISE EXCEPTION 'V7 exhausted row must be skipped'; END IF;
  IF (r->>'exhausted_missed')::int < 1 THEN RAISE EXCEPTION 'V7 exhausted count %', r; END IF;
  IF (SELECT missed_notified_at FROM public.calls WHERE id = 'cccccccc-0000-0000-0000-000000000004') IS NULL THEN RAISE EXCEPTION 'V7 completion not stamped'; END IF;
END $$;

-- V8: retention batches — listened past org retention vs unheard past 90 days
DO $$
DECLARE n int;
BEGIN
  SET LOCAL ROLE service_role;
  UPDATE public.voicemails SET listened_at = now() - interval '31 days', created_at = now() - interval '40 days' WHERE recording_sid = 'RE000000000000000000000000000000a1';
  UPDATE public.voicemails SET listened_at = NULL, created_at = now() - interval '91 days' WHERE recording_sid = 'RE000000000000000000000000000000a2';
  SELECT count(*) INTO n FROM public.voicemails_expired_batch('aaaaaaaa-0000-0000-0000-00000000000a', now() - interval '30 days', now() - interval '90 days', 100);
  IF n <> 2 THEN RAISE EXCEPTION 'V8 expected 2 expired, got %', n; END IF;
  UPDATE public.voicemails SET created_at = now() - interval '10 days' WHERE recording_sid = 'RE000000000000000000000000000000a2';
  SELECT count(*) INTO n FROM public.voicemails_expired_batch('aaaaaaaa-0000-0000-0000-00000000000a', now() - interval '30 days', now() - interval '90 days', 100);
  IF n <> 1 THEN RAISE EXCEPTION 'V8 unheard within 90 days must be kept, got %', n; END IF;
  RESET ROLE;
END $$;

-- V9: notifications type CHECK accepts 'voicemail'; authenticated cannot execute converge/sweep
DO $$
BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.converge_inbound_notifications('cccccccc-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'V9 authenticated must not execute converge';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.sweep_inbound_notifications(1);
    RAISE EXCEPTION 'V9 authenticated must not execute sweep';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
END $$;

ROLLBACK;
