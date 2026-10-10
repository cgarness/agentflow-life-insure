-- =====================================================================================================
-- Behaviour suite for supabase/migrations/pending/20261011120000_onboarding_email_foundation.sql.
-- LOCAL synthetic database only (run via scripts/run_onboarding_email_tests.sh). Every block raises on
-- failure; ON_ERROR_STOP aborts the run. Tests run in order and share state.
-- Agencies: A1 …a1 (New York), A2 …a2 (Los Angeles, other tenant), A3 …a3 (suspended),
--           A4 …a4 (no settings row), A5 …a5 (invalid zone, NULL status).
-- =====================================================================================================
\set QUIET on
\set ON_ERROR_STOP on

CREATE FUNCTION pg_temp.mk_user(
  p_id uuid, p_org uuid, p_role text, p_welcome timestamptz,
  p_confirmed boolean DEFAULT true, p_status text DEFAULT 'Active', p_super boolean DEFAULT false,
  p_created timestamptz DEFAULT now(), p_banned timestamptz DEFAULT NULL, p_deleted timestamptz DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email, email_confirmed_at, banned_until, deleted_at)
  VALUES (p_id, 'u' || right(p_id::text, 3) || '@example.test', CASE WHEN p_confirmed THEN now() END, p_banned, p_deleted);
  INSERT INTO public.profiles (id, email, first_name, organization_id, role, status, is_super_admin,
                               welcome_email_sent_at, created_at)
  VALUES (p_id, 'u' || right(p_id::text, 3) || '@example.test', 'User' || right(p_id::text, 3), p_org, p_role,
          p_status, p_super, p_welcome, p_created);
$$;

-- Eligible-looking users created now (after the future watermark 2026-01-01) plus every exclusion case.
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000a1', 'Agent', now());
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000a1', 'Team Leader', now());
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000a1', 'Admin', now());
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-0000000000a1', 'Agent', now(), p_confirmed => false);
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000a1', 'Agent', now(), p_status => 'Deleted');
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000a1', 'Agent', now(), p_status => 'Inactive');
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-0000000000a1', 'Admin', now(), p_super => true);
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-0000000000a1', 'Super Admin', now());
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000109', NULL, 'Agent', now());
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-0000000000a3', 'Agent', now());
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-0000000000a1', 'Agent', now(), p_banned => now() + interval '30 days');
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-0000000000a1', 'Agent', now(), p_deleted => now());
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000113', '00000000-0000-0000-0000-0000000000a1', 'Agent', NULL);
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000114', '00000000-0000-0000-0000-0000000000a1', 'Agent', now(), p_created => '2025-12-01');
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000115', '00000000-0000-0000-0000-0000000000a1', 'Agent', now());
INSERT INTO public.user_email_subscriptions (user_id, organization_id, onboarding_opted_out_at, onboarding_opt_out_source)
VALUES ('00000000-0000-0000-0000-000000000115', '00000000-0000-0000-0000-0000000000a1', now(), 'settings');
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000116', '00000000-0000-0000-0000-0000000000a2', 'Agent', now());
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000117', '00000000-0000-0000-0000-0000000000a5', 'Agent', now());
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000118', '00000000-0000-0000-0000-0000000000a4', 'Admin', now());
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000119', '00000000-0000-0000-0000-0000000000a1', 'Agent', now(), p_banned => now() - interval '1 day');

-- T0 Inactive defaults: disabled, no watermark, no pilot, nine steps, no rows, no trigger, no schedule.
DO $$ BEGIN
  ASSERT (SELECT NOT enabled AND enrollment_starts_at IS NULL AND pilot_organization_ids IS NULL
                 AND send_hour_local = 10 AND step_expiry = interval '72 hours'
            FROM public.onboarding_email_program WHERE id = 1), 'T0: program must start disabled with no watermark or pilot';
  ASSERT (SELECT string_agg(step_key || ':' || day_offset, ',' ORDER BY sequence_key, position)
            FROM public.onboarding_email_steps)
         = 'admin_day02_agency_setup:2,admin_day04_agents_dialing:4,admin_day07_team_performance:7,'
           'admin_day12_high_performing:12,agent_day01_dialer_ready:1,agent_day03_work_leads:3,'
           'agent_day05_campaigns:5,agent_day08_numbers:8,agent_day14_routine:14', 'T0: step catalog';
  ASSERT NOT EXISTS (SELECT 1 FROM public.onboarding_email_enrollments)
     AND NOT EXISTS (SELECT 1 FROM public.onboarding_email_deliveries), 'T0: no backfill at creation';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                       JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'auth', 'private')),
         'T0: the migration must not install any trigger';
  RAISE NOTICE 'T0 pass: inactive defaults, 9 steps, no rows, no triggers';
END $$;

-- T1 DISABLED MEANS ZERO: no enrollment and no claim while disabled, with and without a watermark.
SET ROLE service_role;
DO $$ BEGIN
  ASSERT public.onboarding_email_enroll_due(100) = 0, 'T1: disabled program must enroll nobody';
  ASSERT (SELECT count(*) FROM public.claim_onboarding_email_deliveries(25)) = 0, 'T1: disabled program must claim nothing';
END $$;
RESET ROLE;
UPDATE public.onboarding_email_program SET enrollment_starts_at = '2026-01-01 00:00+00' WHERE id = 1;
SET ROLE service_role;
DO $$ BEGIN
  ASSERT public.onboarding_email_enroll_due(100) = 0, 'T1: a watermark alone must not enable enrollment';
  ASSERT (SELECT count(*) FROM public.claim_onboarding_email_deliveries(25)) = 0, 'T1: a watermark alone must not enable claims';
END $$;
RESET ROLE;
DO $$ BEGIN
  BEGIN
    UPDATE public.onboarding_email_program SET enabled = true, enrollment_starts_at = NULL WHERE id = 1;
    RAISE EXCEPTION 'T1: enabled without a watermark was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.onboarding_email_enrollments), 'T1: zero enrollments while disabled';
  ASSERT NOT EXISTS (SELECT 1 FROM public.onboarding_email_deliveries), 'T1: zero deliveries while disabled';
  RAISE NOTICE 'T1 pass: disabled = zero enrollment and zero claims';
END $$;

-- T2 Privileges: anon and authenticated cannot touch the queue or the worker RPCs; service_role reads
-- only and writes only through the RPCs; nobody but the owner can write user_email_subscriptions.
SET ROLE anon;
DO $$
DECLARE t text; f text;
BEGIN
  FOREACH t IN ARRAY ARRAY['onboarding_email_program', 'onboarding_email_steps', 'onboarding_email_enrollments',
                           'onboarding_email_deliveries', 'onboarding_email_delivery_attempts', 'user_email_subscriptions'] LOOP
    BEGIN EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', t); RAISE EXCEPTION 'T2: anon can read %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.onboarding_email_enroll_due(1)', 'public.claim_onboarding_email_deliveries(1)',
      'public.get_onboarding_email_context(gen_random_uuid())',
      'public.complete_onboarding_email_delivery(gen_random_uuid(), ''sent'')',
      'public.record_onboarding_email_opt_out(gen_random_uuid(), ''settings'')',
      'public.get_my_email_subscriptions()', 'public.set_my_onboarding_email_opt_out(true)'] LOOP
    BEGIN EXECUTE 'SELECT * FROM ' || f; RAISE EXCEPTION 'T2: anon can execute %', f;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$
DECLARE t text; f text;
BEGIN
  FOREACH t IN ARRAY ARRAY['onboarding_email_program', 'onboarding_email_steps', 'onboarding_email_enrollments',
                           'onboarding_email_deliveries', 'onboarding_email_delivery_attempts'] LOOP
    BEGIN EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', t); RAISE EXCEPTION 'T2: authenticated can read %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.onboarding_email_enroll_due(1)', 'public.claim_onboarding_email_deliveries(1)',
      'public.get_onboarding_email_context(gen_random_uuid())',
      'public.complete_onboarding_email_delivery(gen_random_uuid(), ''sent'')',
      'public.record_onboarding_email_opt_out(gen_random_uuid(), ''settings'')'] LOOP
    BEGIN EXECUTE 'SELECT * FROM ' || f; RAISE EXCEPTION 'T2: authenticated can execute %', f;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['onboarding_email_program', 'onboarding_email_steps', 'onboarding_email_enrollments',
                           'onboarding_email_deliveries', 'onboarding_email_delivery_attempts', 'user_email_subscriptions'] LOOP
    EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', t);
    BEGIN EXECUTE format('DELETE FROM public.%I', t); RAISE EXCEPTION 'T2: service_role can delete from %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN UPDATE public.onboarding_email_program SET enabled = true; RAISE EXCEPTION 'T2: service_role can flip the flag';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.set_my_onboarding_email_opt_out(true); RAISE EXCEPTION 'T2: service_role can call set_my';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'T2 pass: privilege matrix (anon, authenticated, service_role)';
END $$;
RESET ROLE;

-- T3 Enable with a pilot, then for all agencies: only new, eligible users enroll, in the right series.
UPDATE public.onboarding_email_program
   SET enabled = true, pilot_organization_ids = ARRAY['00000000-0000-0000-0000-0000000000a2']::uuid[] WHERE id = 1;
DO $$ BEGIN
  ASSERT public.onboarding_email_enroll_due(100) = 1, 'T3: the pilot must enroll exactly the A2 user';
  ASSERT (SELECT user_id FROM public.onboarding_email_enrollments) = '00000000-0000-0000-0000-000000000116', 'T3: pilot user';
END $$;
UPDATE public.onboarding_email_program SET pilot_organization_ids = NULL WHERE id = 1;
DO $$
DECLARE v_ids text;
BEGIN
  ASSERT public.onboarding_email_enroll_due(100) = 6, 'T3: six more eligible users';
  SELECT string_agg(right(user_id::text, 3) || ':' || sequence_key, ',' ORDER BY user_id) INTO v_ids
    FROM public.onboarding_email_enrollments;
  ASSERT v_ids = '101:agent,102:agent,103:agency_admin,116:agent,117:agent,118:agency_admin,119:agent',
         format('T3: wrong enrollment set %s', v_ids);
  ASSERT NOT EXISTS (SELECT 1 FROM public.onboarding_email_enrollments
                      WHERE user_id = '00000000-0000-0000-0000-000000000901'), 'T3: historical user must never enroll';
  ASSERT (SELECT count(*) FROM public.onboarding_email_deliveries WHERE user_id = '00000000-0000-0000-0000-000000000101') = 5, 'T3: agent gets 5 steps';
  ASSERT (SELECT count(*) FROM public.onboarding_email_deliveries WHERE user_id = '00000000-0000-0000-0000-000000000103') = 4, 'T3: admin gets 4 steps';
  ASSERT NOT EXISTS (SELECT 1 FROM public.onboarding_email_deliveries d JOIN public.onboarding_email_steps s USING (step_key)
                      JOIN public.onboarding_email_enrollments e ON e.id = d.enrollment_id
                      WHERE s.sequence_key <> e.sequence_key), 'T3: steps must match the series';
  ASSERT (SELECT bool_and(anchor_at = p.welcome_email_sent_at AND role_at_enrollment = p.role)
            FROM public.onboarding_email_enrollments e JOIN public.profiles p ON p.id = e.user_id), 'T3: anchor and role recorded';
  ASSERT (SELECT bool_and(status = 'scheduled' AND attempts = 0 AND available_at = scheduled_at
                          AND expires_at = scheduled_at + interval '72 hours')
            FROM public.onboarding_email_deliveries), 'T3: deliveries start scheduled with a 72 h expiry';
  RAISE NOTICE 'T3 pass: pilot gate, eligibility, exclusions, role-based series, no backfill';
END $$;

-- T4 Scheduling: Day N at 10:00 on the agency's local calendar (DST-correct), fallback without a zone.
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-0000000000a1', 'Agent', '2026-03-07 23:30-05');
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-0000000000a2', 'Admin', '2026-10-31 18:00-07');
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000122', '00000000-0000-0000-0000-0000000000a2', 'Agent', '2026-10-31 18:00-07');
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000123', '00000000-0000-0000-0000-0000000000a4', 'Agent', '2026-05-05 13:45+00');
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000124', '00000000-0000-0000-0000-0000000000a5', 'Agent', '2026-05-05 13:45+00');
DO $$
  DECLARE slot timestamptz;
BEGIN
  ASSERT public.onboarding_email_enroll_due(100) = 5, 'T4: five dated users enroll';
  SELECT scheduled_at INTO slot FROM public.onboarding_email_deliveries
   WHERE user_id = '00000000-0000-0000-0000-000000000120' AND step_key = 'agent_day01_dialer_ready';
  ASSERT slot = '2026-03-08 10:00-04', format('T4: New York day 1 across spring DST, got %s', slot);
  ASSERT (SELECT scheduled_at FROM public.onboarding_email_deliveries
           WHERE user_id = '00000000-0000-0000-0000-000000000120' AND step_key = 'agent_day14_routine') = '2026-03-21 10:00-04',
         'T4: New York day 14';
  ASSERT (SELECT scheduled_at FROM public.onboarding_email_deliveries
           WHERE user_id = '00000000-0000-0000-0000-000000000122' AND step_key = 'agent_day01_dialer_ready') = '2026-11-01 10:00-08',
         'T4: Los Angeles day 1 on the fall-back day';
  ASSERT (SELECT scheduled_at FROM public.onboarding_email_deliveries
           WHERE user_id = '00000000-0000-0000-0000-000000000121' AND step_key = 'admin_day02_agency_setup') = '2026-11-02 10:00-08',
         'T4: Los Angeles admin day 2';
  ASSERT (SELECT scheduled_at FROM public.onboarding_email_deliveries
           WHERE user_id = '00000000-0000-0000-0000-000000000123' AND step_key = 'agent_day03_work_leads') = '2026-05-08 13:45+00',
         'T4: no settings row falls back to anchor + N days';
  ASSERT (SELECT scheduled_at FROM public.onboarding_email_deliveries
           WHERE user_id = '00000000-0000-0000-0000-000000000124' AND step_key = 'agent_day01_dialer_ready') = '2026-05-06 13:45+00',
         'T4: an invalid zone falls back to anchor + N days';
  -- Remove the two November fixtures so later due-row counts never depend on the run date.
  DELETE FROM auth.users WHERE id IN ('00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-000000000122');
  RAISE NOTICE 'T4 pass: 10:00 agency-local, DST-correct, fallback without a valid zone';
END $$;

-- T5 Duplicate prevention: re-running enrolls nobody; the unique keys hold.
DO $$ BEGIN
  ASSERT public.onboarding_email_enroll_due(100) = 0, 'T5: a second run must enroll nobody';
  BEGIN
    INSERT INTO public.onboarding_email_enrollments (user_id, organization_id, sequence_key, role_at_enrollment, anchor_at)
    VALUES ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000a1', 'agent', 'Agent', now());
    RAISE EXCEPTION 'T5: second enrollment accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.onboarding_email_deliveries (enrollment_id, user_id, organization_id, step_key, template_version,
                                                    scheduled_at, expires_at, available_at)
    SELECT enrollment_id, user_id, organization_id, step_key, 1, now(), now() + interval '1 hour', now()
      FROM public.onboarding_email_deliveries
     WHERE user_id = '00000000-0000-0000-0000-000000000101' AND step_key = 'agent_day01_dialer_ready';
    RAISE EXCEPTION 'T5: duplicate step accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RAISE NOTICE 'T5 pass: no duplicate enrollment or step';
END $$;

-- Helper: make one step due now (and keep it unexpired).
CREATE FUNCTION pg_temp.make_due(p_user uuid, p_step text) RETURNS uuid LANGUAGE sql AS $$
  UPDATE public.onboarding_email_deliveries
     SET scheduled_at = now() - interval '1 minute', available_at = now() - interval '1 minute',
         expires_at = now() + interval '72 hours'
   WHERE user_id = p_user AND step_key = p_step
  RETURNING id;
$$;

-- T6 Claim, lease, stale sweep, complete(sent).
DO $$
DECLARE v_id uuid; v_row public.onboarding_email_deliveries%ROWTYPE; v_n integer;
BEGIN
  v_id := pg_temp.make_due('00000000-0000-0000-0000-000000000101', 'agent_day01_dialer_ready');
  SELECT count(*) INTO v_n FROM public.claim_onboarding_email_deliveries(5);
  ASSERT v_n = 1, format('T6: exactly one due row, claimed %s', v_n);
  SELECT * INTO v_row FROM public.onboarding_email_deliveries WHERE id = v_id;
  ASSERT v_row.status = 'sending' AND v_row.attempts = 1 AND v_row.first_attempted_at IS NOT NULL
     AND v_row.locked_until > now() + interval '4 minutes', 'T6: claim sets sending, attempt 1, lease';
  ASSERT (SELECT count(*) FROM public.onboarding_email_deliveries
           WHERE user_id IN ('00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000123',
                             '00000000-0000-0000-0000-000000000124')
             AND status = 'skipped' AND skip_reason = 'stale') = 15, 'T6: expired never-attempted rows become stale';
  ASSERT (SELECT count(*) FROM public.onboarding_email_delivery_attempts WHERE outcome = 'skipped' AND error = 'stale') >= 15,
         'T6: stale sweep is logged';
  ASSERT (SELECT status FROM public.onboarding_email_enrollments WHERE user_id = '00000000-0000-0000-0000-000000000120') = 'completed',
         'T6: an enrollment with nothing outstanding completes';
  ASSERT (SELECT count(*) FROM public.claim_onboarding_email_deliveries(5)) = 0, 'T6: a held lease is not reclaimed';
  ASSERT public.complete_onboarding_email_delivery(v_id, 'sent', 'msg_1') = 'sent', 'T6: complete sent';
  ASSERT public.complete_onboarding_email_delivery(v_id, 'sent', 'msg_2') IS NULL, 'T6: a finished row cannot be completed again';
  SELECT * INTO v_row FROM public.onboarding_email_deliveries WHERE id = v_id;
  ASSERT v_row.status = 'sent' AND v_row.provider_message_id = 'msg_1' AND v_row.sent_at IS NOT NULL, 'T6: sent recorded once';
  ASSERT (SELECT count(*) FROM public.onboarding_email_delivery_attempts WHERE delivery_id = v_id AND outcome = 'sent') = 1,
         'T6: attempt logged';
  RAISE NOTICE 'T6 pass: claim, lease, stale sweep, settle, complete(sent)';
END $$;

-- T7 Retry with backoff until the 6-attempt cap; the 23 h window from the first attempt; lease reclaim.
DO $$
DECLARE v_id uuid; v_row public.onboarding_email_deliveries%ROWTYPE; i integer; v_status text;
BEGIN
  v_id := pg_temp.make_due('00000000-0000-0000-0000-000000000102', 'agent_day01_dialer_ready');
  FOR i IN 1..6 LOOP
    UPDATE public.onboarding_email_deliveries SET available_at = now() - interval '1 second' WHERE id = v_id;
    ASSERT (SELECT count(*) FROM public.claim_onboarding_email_deliveries(5) c WHERE c.id = v_id) = 1, format('T7: claim %s', i);
    v_status := public.complete_onboarding_email_delivery(v_id, 'retry', NULL, E'Resend HTTP 500\nline2');
    SELECT * INTO v_row FROM public.onboarding_email_deliveries WHERE id = v_id;
    IF i < 6 THEN
      ASSERT v_status = 'scheduled', format('T7: attempt %s must reschedule, got %s', i, v_status);
      ASSERT v_row.available_at BETWEEN now() + (CASE i WHEN 1 THEN 1 WHEN 2 THEN 2 WHEN 3 THEN 5 WHEN 4 THEN 15 ELSE 30 END)
                                         * interval '1 minute' - interval '5 seconds'
                                    AND now() + (CASE i WHEN 1 THEN 1 WHEN 2 THEN 2 WHEN 3 THEN 5 WHEN 4 THEN 15 ELSE 30 END)
                                         * interval '1 minute' + interval '5 seconds', format('T7: backoff after attempt %s', i);
      ASSERT v_row.last_error = 'Resend HTTP 500 line2', 'T7: error stored on one line';
    ELSE
      ASSERT v_status = 'failed' AND v_row.status = 'failed', 'T7: the sixth failure is final';
    END IF;
  END LOOP;

  v_id := pg_temp.make_due('00000000-0000-0000-0000-000000000103', 'admin_day02_agency_setup');
  ASSERT (SELECT count(*) FROM public.claim_onboarding_email_deliveries(5) c WHERE c.id = v_id) = 1, 'T7: claim admin row';
  UPDATE public.onboarding_email_deliveries SET first_attempted_at = now() - interval '24 hours' WHERE id = v_id;
  ASSERT public.complete_onboarding_email_delivery(v_id, 'retry', NULL, 'timeout') = 'failed',
         'T7: no retry once 23 h have passed since the first attempt';

  v_id := pg_temp.make_due('00000000-0000-0000-0000-000000000116', 'agent_day01_dialer_ready');
  ASSERT (SELECT count(*) FROM public.claim_onboarding_email_deliveries(5) c WHERE c.id = v_id) = 1, 'T7: claim A2 row';
  UPDATE public.onboarding_email_deliveries SET locked_until = now() - interval '1 second' WHERE id = v_id;
  ASSERT (SELECT attempts FROM public.claim_onboarding_email_deliveries(5) c WHERE c.id = v_id) = 2, 'T7: expired lease is reclaimed';
  UPDATE public.onboarding_email_deliveries SET locked_until = now() - interval '1 second', attempts = 6 WHERE id = v_id;
  ASSERT (SELECT count(*) FROM public.claim_onboarding_email_deliveries(5) c WHERE c.id = v_id) = 0, 'T7: out of attempts';
  ASSERT (SELECT status FROM public.onboarding_email_deliveries WHERE id = v_id) = 'failed', 'T7: swept to failed';
  RAISE NOTICE 'T7 pass: backoff 1/2/5/15/30, 6-attempt cap, 23 h window, lease reclaim';
END $$;

-- T8 skipped (this step only) and cancelled (the rest of the enrollment); argument validation.
DO $$
DECLARE v_id uuid;
BEGIN
  v_id := pg_temp.make_due('00000000-0000-0000-0000-000000000117', 'agent_day01_dialer_ready');
  PERFORM count(*) FROM public.claim_onboarding_email_deliveries(5);
  ASSERT public.complete_onboarding_email_delivery(v_id, 'skipped', NULL, NULL, 'organization_inactive') = 'skipped', 'T8: skip';
  ASSERT (SELECT count(*) FROM public.onboarding_email_deliveries
           WHERE user_id = '00000000-0000-0000-0000-000000000117' AND status = 'scheduled') = 4, 'T8: skipping keeps later steps';

  v_id := pg_temp.make_due('00000000-0000-0000-0000-000000000118', 'admin_day02_agency_setup');
  PERFORM count(*) FROM public.claim_onboarding_email_deliveries(5);
  BEGIN PERFORM public.complete_onboarding_email_delivery(v_id, 'skipped', NULL, NULL, 'opted_out');
        RAISE EXCEPTION 'T8: enrollment reason accepted for skipped';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.complete_onboarding_email_delivery(v_id, 'sent', NULL, NULL, 'stale');
        RAISE EXCEPTION 'T8: reason accepted for sent';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.complete_onboarding_email_delivery(v_id, 'bogus');
        RAISE EXCEPTION 'T8: unknown outcome accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  ASSERT public.complete_onboarding_email_delivery(v_id, 'cancelled', NULL, NULL, 'role_changed') = 'cancelled', 'T8: cancel';
  ASSERT (SELECT count(*) FROM public.onboarding_email_deliveries
           WHERE user_id = '00000000-0000-0000-0000-000000000118' AND status = 'cancelled' AND skip_reason = 'role_changed') = 4,
         'T8: cancel stops every remaining step';
  ASSERT (SELECT status = 'cancelled' AND cancel_reason = 'role_changed' FROM public.onboarding_email_enrollments
           WHERE user_id = '00000000-0000-0000-0000-000000000118'), 'T8: enrollment cancelled';
  RAISE NOTICE 'T8 pass: skipped vs cancelled, argument validation';
END $$;

-- T9 Opt-out through the unsubscribe path (service role RPC): idempotent, cancels remaining steps.
DO $$
DECLARE v_at timestamptz;
BEGIN
  ASSERT public.record_onboarding_email_opt_out('00000000-0000-0000-0000-000000000101', 'unsubscribe_link'), 'T9: opt-out';
  SELECT onboarding_opted_out_at INTO v_at FROM public.user_email_subscriptions WHERE user_id = '00000000-0000-0000-0000-000000000101';
  ASSERT v_at IS NOT NULL, 'T9: opt-out stored';
  ASSERT (SELECT count(*) FROM public.onboarding_email_deliveries
           WHERE user_id = '00000000-0000-0000-0000-000000000101' AND status = 'scheduled') = 0, 'T9: no step left scheduled';
  ASSERT (SELECT count(*) FROM public.onboarding_email_deliveries
           WHERE user_id = '00000000-0000-0000-0000-000000000101' AND status = 'sent') = 1, 'T9: history kept';
  ASSERT (SELECT status FROM public.onboarding_email_enrollments WHERE user_id = '00000000-0000-0000-0000-000000000101') = 'cancelled',
         'T9: enrollment cancelled';
  PERFORM pg_sleep(0.01);
  ASSERT public.record_onboarding_email_opt_out('00000000-0000-0000-0000-000000000101', 'unsubscribe_link'), 'T9: idempotent';
  ASSERT (SELECT onboarding_opted_out_at FROM public.user_email_subscriptions
           WHERE user_id = '00000000-0000-0000-0000-000000000101') = v_at, 'T9: first opt-out time kept';
  ASSERT NOT public.record_onboarding_email_opt_out(gen_random_uuid(), 'unsubscribe_link'), 'T9: unknown user is false';
  BEGIN PERFORM public.record_onboarding_email_opt_out('00000000-0000-0000-0000-000000000101', 'email');
        RAISE EXCEPTION 'T9: unknown source accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'T9 pass: unsubscribe opt-out';
END $$;

-- T10 Send-time context: current facts for the worker; zero rows for an unknown delivery.
DO $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.get_onboarding_email_context(
    (SELECT id FROM public.onboarding_email_deliveries
      WHERE user_id = '00000000-0000-0000-0000-000000000119' AND step_key = 'agent_day03_work_leads'));
  ASSERT c.sequence_key = 'agent' AND c.profile_role = 'Agent' AND c.profile_status = 'Active'
     AND c.email = 'u119@example.test' AND c.email_confirmed AND NOT c.auth_deleted AND NOT c.auth_banned
     AND c.organization_status = 'active' AND NOT c.opted_out AND c.first_name = 'User119'
     AND c.enrollment_organization_id = '00000000-0000-0000-0000-0000000000a1'
     AND c.profile_organization_id = '00000000-0000-0000-0000-0000000000a1', 'T10: context facts';
  ASSERT (SELECT count(*) FROM public.get_onboarding_email_context(gen_random_uuid())) = 0, 'T10: unknown delivery';
  SELECT * INTO c FROM public.get_onboarding_email_context(
    (SELECT id FROM public.onboarding_email_deliveries
      WHERE user_id = '00000000-0000-0000-0000-000000000101' AND step_key = 'agent_day03_work_leads'));
  ASSERT c.opted_out, 'T10: opt-out visible to the worker';
  RAISE NOTICE 'T10 pass: send-time context';
END $$;

-- T11 Correction A: user_email_subscriptions is readable only by its owner, in the owner's agency.
-- Fixtures: agent 102 (A1), admin 103 (A1), agent 116 (A2); each writes a row through set_my.
CREATE FUNCTION pg_temp.as_user(p_user uuid, p_org uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated',
                      'app_metadata', json_build_object('organization_id', p_org))::text, false);
$$;

SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000a1');
SET ROLE authenticated;
DO $$ BEGIN
  ASSERT public.set_my_onboarding_email_opt_out(false) = false, 'T11: agent writes own row (opted in)';
  ASSERT (SELECT count(*) FROM public.user_email_subscriptions) = 1, 'T11: agent sees exactly one row';
  ASSERT (SELECT user_id FROM public.user_email_subscriptions) = '00000000-0000-0000-0000-000000000102', 'T11: agent sees only own row';
  ASSERT (SELECT NOT onboarding_opted_out AND onboarding_program_enabled FROM public.get_my_email_subscriptions()), 'T11: agent status';
  BEGIN INSERT INTO public.user_email_subscriptions (user_id, organization_id)
        VALUES ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000a1');
        RAISE EXCEPTION 'T11: agent INSERT allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.user_email_subscriptions SET onboarding_opted_out_at = now(), onboarding_opt_out_source = 'settings';
        RAISE EXCEPTION 'T11: agent UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.user_email_subscriptions; RAISE EXCEPTION 'T11: agent DELETE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT public.set_my_onboarding_email_opt_out(true) = true, 'T11: agent opts out';
  ASSERT (SELECT onboarding_opted_out FROM public.get_my_email_subscriptions()), 'T11: opt-out visible to the agent';
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.onboarding_email_deliveries
           WHERE user_id = '00000000-0000-0000-0000-000000000102' AND status = 'scheduled') = 0, 'T11: settings opt-out cancels steps';
  ASSERT (SELECT onboarding_opt_out_source FROM public.user_email_subscriptions
           WHERE user_id = '00000000-0000-0000-0000-000000000102') = 'settings', 'T11: source recorded';
END $$;

SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000a1');
SET ROLE authenticated;
DO $$ BEGIN
  ASSERT public.set_my_onboarding_email_opt_out(false) = false, 'T11: admin writes own row';
  ASSERT (SELECT count(*) FROM public.user_email_subscriptions) = 1, 'T11: admin sees exactly one row';
  ASSERT (SELECT user_id FROM public.user_email_subscriptions) = '00000000-0000-0000-0000-000000000103',
         'T11: an Admin must not read agents'' rows in the same agency';
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_email_subscriptions
                      WHERE user_id IN ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102')),
         'T11: admin cannot see agent preferences';
  BEGIN UPDATE public.user_email_subscriptions SET onboarding_opted_out_at = NULL; RAISE EXCEPTION 'T11: admin UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000116', '00000000-0000-0000-0000-0000000000a2');
SET ROLE authenticated;
DO $$ BEGIN
  ASSERT public.set_my_onboarding_email_opt_out(false) = false, 'T11: other-agency user writes own row';
  ASSERT (SELECT count(*) FROM public.user_email_subscriptions) = 1
     AND (SELECT user_id FROM public.user_email_subscriptions) = '00000000-0000-0000-0000-000000000116',
         'T11: no cross-agency read';
END $$;
RESET ROLE;

-- Same user, forged/stale agency claim: the row is hidden and writes are refused.
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000a2');
SET ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.user_email_subscriptions) = 0, 'T11: an agency mismatch must hide the row';
  BEGIN PERFORM public.set_my_onboarding_email_opt_out(true); RAISE EXCEPTION 'T11: agency mismatch write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Inactive profile and no session are refused.
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000a1');
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.set_my_onboarding_email_opt_out(true); RAISE EXCEPTION 'T11: inactive profile write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', false);
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.set_my_onboarding_email_opt_out(true); RAISE EXCEPTION 'T11: anonymous session write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM public.get_my_email_subscriptions()) = 0, 'T11: no session, no status';
  ASSERT (SELECT count(*) FROM public.user_email_subscriptions) = 0, 'T11: no session, no rows';
  RAISE NOTICE 'T11 pass: own-row read only (agent, admin, other agency), no direct writes, mismatch/inactive refused';
END $$;
RESET ROLE;

-- T12 get_my_email_subscriptions reflects the pilot list for the caller's agency only.
UPDATE public.onboarding_email_program SET pilot_organization_ids = ARRAY['00000000-0000-0000-0000-0000000000a2']::uuid[] WHERE id = 1;
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000a1');
SET ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT NOT onboarding_program_enabled FROM public.get_my_email_subscriptions()), 'T12: A1 is outside the pilot';
END $$;
RESET ROLE;
SELECT pg_temp.as_user('00000000-0000-0000-0000-000000000116', '00000000-0000-0000-0000-0000000000a2');
SET ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT onboarding_program_enabled FROM public.get_my_email_subscriptions()), 'T12: A2 is in the pilot';
  RAISE NOTICE 'T12 pass: program status follows the pilot';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', false);
UPDATE public.onboarding_email_program SET pilot_organization_ids = NULL WHERE id = 1;

-- T13 Deleting a user removes their enrollment, deliveries and attempts (no email to deleted users).
DO $$ BEGIN
  DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000119';
  ASSERT NOT EXISTS (SELECT 1 FROM public.onboarding_email_enrollments WHERE user_id = '00000000-0000-0000-0000-000000000119'),
         'T13: enrollment removed';
  ASSERT NOT EXISTS (SELECT 1 FROM public.onboarding_email_deliveries WHERE user_id = '00000000-0000-0000-0000-000000000119'),
         'T13: deliveries removed';
  RAISE NOTICE 'T13 pass: hard deletion cascades';
END $$;

-- T14 DISABLED MEANS ZERO (again, with live data): due rows and eligible users exist, nothing moves.
SELECT pg_temp.mk_user('00000000-0000-0000-0000-000000000125', '00000000-0000-0000-0000-0000000000a1', 'Agent', now());
SELECT pg_temp.make_due('00000000-0000-0000-0000-000000000117', 'agent_day03_work_leads');
UPDATE public.onboarding_email_program SET enabled = false WHERE id = 1;
SET ROLE service_role;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.claim_onboarding_email_deliveries(25)) = 0, 'T14: disabled program must claim nothing';
  ASSERT public.onboarding_email_enroll_due(100) = 0, 'T14: disabled program must enroll nobody';
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT status = 'scheduled' AND attempts = 0 FROM public.onboarding_email_deliveries
           WHERE user_id = '00000000-0000-0000-0000-000000000117' AND step_key = 'agent_day03_work_leads'),
         'T14: the due row is untouched while disabled';
  ASSERT NOT EXISTS (SELECT 1 FROM public.onboarding_email_enrollments WHERE user_id = '00000000-0000-0000-0000-000000000125'),
         'T14: the eligible user is not enrolled while disabled';
  RAISE NOTICE 'T14 pass: disabling stops enrollment and claims immediately';
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL ONBOARDING EMAIL TESTS PASSED'; END $$;
