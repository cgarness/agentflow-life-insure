-- =====================================================================================================
-- Behaviour suite for 20261010200000_platform_admin_registration_notifications.sql.
-- LOCAL synthetic database only (run via scripts/run_platform_admin_notification_tests.sh).
-- Every block raises on failure; ON_ERROR_STOP aborts the run.
-- =====================================================================================================
\set QUIET on

-- T0 No backfill of rows that existed before the migration.
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.platform_admin_notifications) = 0, 'T0: queue must start empty (no backfill)';
  RAISE NOTICE 'T0 pass: no backfill';
END $$;

-- T1 Invite-style signup: one auth.users INSERT -> exactly one user_registered row, pending, settle delay.
DO $$
DECLARE r public.platform_admin_notifications%ROWTYPE;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-0000000000c1', 'invitee@example.test',
          '{"first_name":"Ina","role":"Agent","organization_id":"00000000-0000-0000-0000-0000000000a1","signup_source":"invite"}');
  SELECT * INTO r FROM public.platform_admin_notifications WHERE subject_id = '00000000-0000-0000-0000-0000000000c1';
  ASSERT FOUND, 'T1: user_registered row missing';
  ASSERT r.event_type = 'user_registered', 'T1: wrong event type';
  ASSERT r.organization_id = '00000000-0000-0000-0000-0000000000a1', 'T1: organization id not recorded';
  ASSERT r.status = 'pending' AND r.attempts = 0, 'T1: must start pending with 0 attempts';
  ASSERT r.available_at BETWEEN now() + interval '55 seconds' AND now() + interval '65 seconds', 'T1: 60 s settle delay';
  ASSERT (SELECT count(*) FROM public.platform_admin_notifications) = 1, 'T1: exactly one row';
  RAISE NOTICE 'T1 pass: registration enqueues once';
END $$;

-- T2 Logins, profile edits, onboarding saves and role/org changes are UPDATEs: no new rows.
DO $$ BEGIN
  UPDATE public.profiles SET last_login_at = now() WHERE id = '00000000-0000-0000-0000-0000000000c1';
  UPDATE public.profiles SET first_name = 'Ina2', last_name = 'Edited' WHERE id = '00000000-0000-0000-0000-0000000000c1';
  UPDATE public.profiles SET role = 'Team Leader' WHERE id = '00000000-0000-0000-0000-0000000000c1';
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = '00000000-0000-0000-0000-0000000000c1';
  UPDATE public.organizations SET status = 'suspended' WHERE id = '00000000-0000-0000-0000-0000000000a1';
  UPDATE public.organizations SET status = 'active', name = 'Renamed' WHERE id = '00000000-0000-0000-0000-0000000000a1';
  ASSERT (SELECT count(*) FROM public.platform_admin_notifications) = 1, 'T2: updates must not enqueue';
  RAISE NOTICE 'T2 pass: logins/profile/org updates do not enqueue';
END $$;

-- T3 Self-serve: user first, then provision_organization -> one user row + one agency row.
DO $$
DECLARE v_org uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-0000000000c2', 'founder@example.test', '{"first_name":"Fay","signup_source":"self_serve"}');
  v_org := public.provision_organization('Fay Agency', 'fay-agency-1', '00000000-0000-0000-0000-0000000000c2');
  ASSERT (SELECT count(*) FROM public.platform_admin_notifications
           WHERE event_type = 'agency_created' AND subject_id = v_org AND organization_id = v_org) = 1, 'T3: agency row';
  ASSERT (SELECT count(*) FROM public.platform_admin_notifications
           WHERE event_type = 'user_registered' AND subject_id = '00000000-0000-0000-0000-0000000000c2') = 1, 'T3: user row';
  ASSERT (SELECT count(*) FROM public.platform_admin_notifications) = 3, 'T3: three rows total';
  RAISE NOTICE 'T3 pass: self-serve signup enqueues one user + one agency';
END $$;

-- T4 Failed provisioning rolls back the organization AND its queue row.
DO $$
DECLARE v_before bigint := (SELECT count(*) FROM public.platform_admin_notifications);
BEGIN
  BEGIN
    PERFORM public.provision_organization('Ghost Agency', 'ghost-agency-1', '00000000-0000-0000-0000-00000000dead');
    RAISE EXCEPTION 'T4: provisioning should have failed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'T4:%' THEN RAISE; END IF;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.organizations WHERE slug = 'ghost-agency-1'), 'T4: org must roll back';
  ASSERT (SELECT count(*) FROM public.platform_admin_notifications) = v_before, 'T4: queue row must roll back';
  RAISE NOTICE 'T4 pass: failed provisioning leaves no agency notification';
END $$;

-- T5 Compensated self-serve failure: auth user deleted -> profile cascades; queue row stays for the
--    worker to mark skipped (it re-checks the subject after the settle delay).
DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000c3', 'gone@example.test');
  DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000c3';
  ASSERT NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000c3'), 'T5: cascade';
  ASSERT EXISTS (SELECT 1 FROM public.platform_admin_notifications
                  WHERE subject_id = '00000000-0000-0000-0000-0000000000c3' AND status = 'pending'), 'T5: row kept';
  RAISE NOTICE 'T5 pass: compensated signup leaves a row the worker will skip';
END $$;

-- T6 Duplicate protection: the unique key rejects a second row per subject.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.platform_admin_notifications (event_type, subject_id)
    VALUES ('user_registered', '00000000-0000-0000-0000-0000000000c1');
    RAISE EXCEPTION 'T6: duplicate insert should fail';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  ASSERT (SELECT count(*) FROM public.platform_admin_notifications
           WHERE subject_id = '00000000-0000-0000-0000-0000000000c1') = 1, 'T6: one row per subject';
  RAISE NOTICE 'T6 pass: unique (event_type, subject_id)';
END $$;

-- T7 Enqueue failure never blocks the parent write (failure injection: queue rejects every new row).
ALTER TABLE public.platform_admin_notifications ADD CONSTRAINT t7_reject_all CHECK (false) NOT VALID;
DO $$
DECLARE v_org uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000c4', 'resilient@example.test');
  ASSERT EXISTS (SELECT 1 FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000c4'), 'T7: profile must commit';
  v_org := public.provision_organization('Resilient Agency', 'resilient-1', '00000000-0000-0000-0000-0000000000c4');
  ASSERT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org), 'T7: organization must commit';
  ASSERT NOT EXISTS (SELECT 1 FROM public.platform_admin_notifications
                      WHERE subject_id IN ('00000000-0000-0000-0000-0000000000c4', v_org)), 'T7: nothing enqueued';
  RAISE NOTICE 'T7 pass: enqueue failure is a warning, never an abort';
END $$;
ALTER TABLE public.platform_admin_notifications DROP CONSTRAINT t7_reject_all;

-- T8 Claim honours the settle delay, then claims atomically with a lease.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.claim_platform_admin_notifications(10);
  ASSERT n = 0, 'T8: nothing is due during the settle delay';
  UPDATE public.platform_admin_notifications SET available_at = now() - interval '1 second';
  SELECT count(*) INTO n FROM public.claim_platform_admin_notifications(2);
  ASSERT n = 2, 'T8: p_limit respected';
  ASSERT (SELECT count(*) FROM public.platform_admin_notifications
           WHERE status = 'sending' AND attempts = 1 AND locked_until > now() + interval '4 minutes'
             AND last_attempt_at IS NOT NULL) = 2, 'T8: claimed rows leased';
  SELECT count(*) INTO n FROM public.claim_platform_admin_notifications(50);
  ASSERT n = 2, 'T8: remaining due rows claimed';
  SELECT count(*) INTO n FROM public.claim_platform_admin_notifications(50);
  ASSERT n = 0, 'T8: leased rows are never claimed twice';
  RAISE NOTICE 'T8 pass: settle delay, limit, lease';
END $$;

-- T9 Outcomes: sent / skipped / stale completion.
DO $$
DECLARE v_sent uuid; v_skip uuid; v_res text;
BEGIN
  SELECT id INTO v_sent FROM public.platform_admin_notifications
   WHERE subject_id = '00000000-0000-0000-0000-0000000000c1';
  SELECT id INTO v_skip FROM public.platform_admin_notifications
   WHERE subject_id = '00000000-0000-0000-0000-0000000000c3';
  v_res := public.complete_platform_admin_notification(v_sent, 'sent', 'resend-msg-123', NULL);
  ASSERT v_res = 'sent', 'T9: sent';
  ASSERT (SELECT status = 'sent' AND sent_at IS NOT NULL AND provider_message_id = 'resend-msg-123'
                 AND locked_until IS NULL FROM public.platform_admin_notifications WHERE id = v_sent), 'T9: sent row';
  ASSERT public.complete_platform_admin_notification(v_sent, 'retry', NULL, 'late') IS NULL, 'T9: terminal row is frozen';
  ASSERT (SELECT status FROM public.platform_admin_notifications WHERE id = v_sent) = 'sent', 'T9: still sent';
  v_res := public.complete_platform_admin_notification(v_skip, 'skipped', NULL, 'subject_deleted');
  ASSERT v_res = 'skipped', 'T9: skipped';
  ASSERT (SELECT last_error FROM public.platform_admin_notifications WHERE id = v_skip) = 'subject_deleted', 'T9: reason';
  RAISE NOTICE 'T9 pass: sent/skipped are terminal';
END $$;

-- T10 Retry backoff 1/2/5/15/30 min, then failed after the 6th attempt. Errors are sanitized.
DO $$
DECLARE v_id uuid; v_res text; i int; v_wait interval;
  v_expected interval[] := ARRAY[interval '1 minute', interval '2 minutes', interval '5 minutes',
                                 interval '15 minutes', interval '30 minutes'];
BEGIN
  SELECT id INTO v_id FROM public.platform_admin_notifications
   WHERE subject_id = '00000000-0000-0000-0000-0000000000c2';
  FOR i IN 1..5 LOOP
    v_res := public.complete_platform_admin_notification(v_id, 'retry', NULL,
               E'Resend HTTP 500\n\tline2' || repeat('x', 600));
    ASSERT v_res = 'pending', format('T10: attempt %s should retry', i);
    SELECT available_at - now() INTO v_wait FROM public.platform_admin_notifications WHERE id = v_id;
    ASSERT v_wait BETWEEN v_expected[i] - interval '5 seconds' AND v_expected[i] + interval '5 seconds',
           format('T10: backoff after attempt %s was %s', i, v_wait);
    ASSERT (SELECT char_length(last_error) <= 500 AND last_error !~ '[[:cntrl:]]'
              FROM public.platform_admin_notifications WHERE id = v_id), 'T10: error sanitized';
    UPDATE public.platform_admin_notifications SET available_at = now() - interval '1 second' WHERE id = v_id;
    ASSERT (SELECT count(*) FROM public.claim_platform_admin_notifications(50) c WHERE c.id = v_id) = 1,
           format('T10: reclaim %s', i);
  END LOOP;
  ASSERT (SELECT attempts FROM public.platform_admin_notifications WHERE id = v_id) = 6, 'T10: six attempts';
  v_res := public.complete_platform_admin_notification(v_id, 'retry', NULL, 'still failing');
  ASSERT v_res = 'failed', 'T10: sixth failure is final';
  ASSERT (SELECT count(*) FROM public.claim_platform_admin_notifications(50) c WHERE c.id = v_id) = 0, 'T10: failed never reclaimed';
  RAISE NOTICE 'T10 pass: backoff schedule, max 6 attempts, sanitized errors';
END $$;

-- T11 Lease expiry: an abandoned 'sending' row is reclaimed (attempts+1); at the final attempt it fails.
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.platform_admin_notifications WHERE event_type = 'agency_created' LIMIT 1;
  ASSERT (SELECT status FROM public.platform_admin_notifications WHERE id = v_id) = 'sending', 'T11: setup';
  UPDATE public.platform_admin_notifications SET locked_until = now() - interval '1 second' WHERE id = v_id;
  ASSERT (SELECT count(*) FROM public.claim_platform_admin_notifications(50) c WHERE c.id = v_id AND c.attempts = 2) = 1,
         'T11: expired lease reclaimed';
  UPDATE public.platform_admin_notifications SET locked_until = now() - interval '1 second', attempts = 6 WHERE id = v_id;
  ASSERT (SELECT count(*) FROM public.claim_platform_admin_notifications(50) c WHERE c.id = v_id) = 0, 'T11: not reclaimed';
  ASSERT (SELECT status = 'failed' AND last_error LIKE '%final attempt%'
            FROM public.platform_admin_notifications WHERE id = v_id), 'T11: closed as failed';
  RAISE NOTICE 'T11 pass: lease expiry handling';
END $$;

-- T12 23-hour window: an old pending row is closed as failed instead of being sent.
DO $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000c5', 'old@example.test');
  SELECT id INTO v_id FROM public.platform_admin_notifications WHERE subject_id = '00000000-0000-0000-0000-0000000000c5';
  UPDATE public.platform_admin_notifications
     SET created_at = now() - interval '24 hours', available_at = now() - interval '1 second' WHERE id = v_id;
  ASSERT (SELECT count(*) FROM public.claim_platform_admin_notifications(50) c WHERE c.id = v_id) = 0, 'T12: not claimed';
  ASSERT (SELECT status = 'failed' AND last_error LIKE '%window expired%'
            FROM public.platform_admin_notifications WHERE id = v_id), 'T12: closed as failed';
  RAISE NOTICE 'T12 pass: 23-hour window';
END $$;

-- T12b A non-retryable failure closes the row immediately.
DO $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000c6', 'conflict@example.test');
  SELECT id INTO v_id FROM public.platform_admin_notifications WHERE subject_id = '00000000-0000-0000-0000-0000000000c6';
  UPDATE public.platform_admin_notifications SET available_at = now() - interval '1 second' WHERE id = v_id;
  ASSERT (SELECT count(*) FROM public.claim_platform_admin_notifications(50) c WHERE c.id = v_id) = 1, 'T12b: claimed';
  ASSERT public.complete_platform_admin_notification(v_id, 'failed', NULL, 'Resend idempotency conflict') = 'failed', 'T12b';
  ASSERT (SELECT status = 'failed' AND attempts = 1 AND last_error = 'Resend idempotency conflict'
            FROM public.platform_admin_notifications WHERE id = v_id), 'T12b: closed on first attempt';
  RAISE NOTICE 'T12b pass: non-retryable failure is terminal';
END $$;

-- T13 Argument validation.
DO $$ BEGIN
  BEGIN PERFORM public.claim_platform_admin_notifications(0); RAISE EXCEPTION 'T13a';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'T13a' THEN RAISE; END IF; END;
  BEGIN PERFORM public.claim_platform_admin_notifications(51); RAISE EXCEPTION 'T13b';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'T13b' THEN RAISE; END IF; END;
  BEGIN PERFORM public.complete_platform_admin_notification(gen_random_uuid(), 'bogus'); RAISE EXCEPTION 'T13c';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'T13c' THEN RAISE; END IF; END;
  ASSERT public.complete_platform_admin_notification(gen_random_uuid(), 'sent') IS NULL, 'T13: unknown id is a no-op';
  RAISE NOTICE 'T13 pass: argument validation';
END $$;

-- T14 Server-only access: anon/authenticated cannot read, write or drive the queue; service_role can.
DO $$
DECLARE r text; ok boolean;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    ASSERT NOT has_table_privilege(r, 'public.platform_admin_notifications', 'SELECT'), r || ': SELECT';
    ASSERT NOT has_table_privilege(r, 'public.platform_admin_notifications', 'INSERT'), r || ': INSERT';
    ASSERT NOT has_table_privilege(r, 'public.platform_admin_notifications', 'UPDATE'), r || ': UPDATE';
    ASSERT NOT has_table_privilege(r, 'public.platform_admin_notifications', 'DELETE'), r || ': DELETE';
    ASSERT NOT has_function_privilege(r, 'public.claim_platform_admin_notifications(integer)', 'EXECUTE'), r || ': claim';
    ASSERT NOT has_function_privilege(r, 'public.complete_platform_admin_notification(uuid,text,text,text)', 'EXECUTE'), r || ': complete';
    ASSERT NOT has_function_privilege(r, 'private.enqueue_platform_admin_user_registered()', 'EXECUTE'), r || ': enqueue user';
    ASSERT NOT has_function_privilege(r, 'private.enqueue_platform_admin_agency_created()', 'EXECUTE'), r || ': enqueue agency';
  END LOOP;
  ASSERT has_table_privilege('service_role', 'public.platform_admin_notifications', 'SELECT,UPDATE'), 'service_role table';
  ASSERT has_function_privilege('service_role', 'public.claim_platform_admin_notifications(integer)', 'EXECUTE'), 'service_role claim';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.platform_admin_notifications'::regclass), 'RLS on';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'platform_admin_notifications'), 'no policies';

  -- Live role checks, not just catalog reads.
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM 1 FROM public.platform_admin_notifications; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'T14: authenticated SELECT must be denied';
  ok := false;
  BEGIN PERFORM public.claim_platform_admin_notifications(1); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'T14: authenticated claim must be denied';
  RESET ROLE;
  SET LOCAL ROLE service_role;
  PERFORM count(*) FROM public.platform_admin_notifications;
  RESET ROLE;
  RAISE NOTICE 'T14 pass: queue is server-only';
END $$;

-- T15 Trigger shape: AFTER INSERT row triggers only (never UPDATE/DELETE).
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM pg_trigger t
           WHERE t.tgname IN ('trg_zz_platform_admin_notify_user_registered', 'trg_zz_platform_admin_notify_agency_created')
             AND (t.tgtype & 1) = 1      -- ROW
             AND (t.tgtype & 2) = 0      -- AFTER
             AND (t.tgtype & 4) = 4      -- INSERT
             AND (t.tgtype & 8) = 0      -- not DELETE
             AND (t.tgtype & 16) = 0) = 2, 'T15: AFTER INSERT FOR EACH ROW only';
  RAISE NOTICE 'T15 pass: trigger shape';
END $$;

SELECT 'ALL PLATFORM ADMIN NOTIFICATION TESTS PASSED' AS result;
