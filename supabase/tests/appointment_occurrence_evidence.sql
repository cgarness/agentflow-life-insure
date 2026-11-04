-- PKG-D appointment occurrence evidence (D4 §3.4, §7). Synthetic data only (reporting_fixture.py appointments mode),
-- after the category baseline and 20261104120041. Agent test_uuid(11) books for assignee test_uuid(12); test_uuid(19)
-- is an Admin. The bookings go through the verbatim booking writer (create_appointment_once → persist_booking).
CREATE FUNCTION public.t_appt(n integer) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.appointments WHERE booking_request_id = public.test_uuid(n) $$;
CREATE FUNCTION public.t_occ(n integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(concat_ws('|', o.seq, o.opened_source, o.category, coalesce(o.close_reason, 'open')), ' ; ' ORDER BY o.seq)
    FROM private.appointment_occurrences o WHERE o.appointment_id = public.t_appt(n) $$;
CREATE FUNCTION public.t_outcomes(n integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(concat_ws('|', o.seq, e.outcome, e.source, e.actor_kind, e.category, (e.supersedes_event_id IS NOT NULL)::text), ' ; '
                    ORDER BY e.recorded_at, e.id)
    FROM private.appointment_outcome_events e JOIN private.appointment_occurrences o ON o.id = e.occurrence_id
   WHERE o.appointment_id = public.t_appt(n) $$;
CREATE FUNCTION public.t_obs(n integer) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM private.appointment_evidence_observations WHERE appointment_id = public.t_appt(n) $$;
CREATE FUNCTION public.t_book(n integer, p_start timestamptz, p_type text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.create_appointment_once(public.test_uuid(n), jsonb_build_object('title', 'Evidence ' || n, 'start_time', p_start,
    'contact_id', public.test_uuid(201), 'user_id', public.test_uuid(12)) || CASE WHEN p_type IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object('type', p_type) END) $$;
GRANT EXECUTE ON FUNCTION public.t_book(integer, timestamptz, text) TO authenticated;

-- Seal (class W): only the outcome RPC is callable, by authenticated only; the evidence is unreadable.
SELECT test_assert(has_function_privilege('authenticated', 'public.record_appointment_outcome(uuid,uuid,timestamptz,text)', 'EXECUTE')
                   AND NOT has_function_privilege('anon', 'public.record_appointment_outcome(uuid,uuid,timestamptz,text)', 'EXECUTE')
                   AND NOT has_function_privilege('service_role', 'public.record_appointment_outcome(uuid,uuid,timestamptz,text)', 'EXECUTE'),
                   'outcome RPC: authenticated only');
SELECT test_assert(NOT has_table_privilege(r, 'private.' || t, 'SELECT'), r || ' cannot read ' || t)
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
       unnest(ARRAY['appointment_evidence_capture_windows', 'appointment_evidence_observations', 'appointment_occurrences',
                    'appointment_assignment_events', 'appointment_outcome_events', 'appointment_evidence_capture_gaps']) t;
SELECT test_assert((SELECT count(*) = 1 FROM private.appointment_evidence_capture_windows WHERE capture_kind = 'appointment_outcomes' AND ended_at IS NULL),
                   'the outcome capture window is open');
SELECT test_assert((SELECT proconfig @> ARRAY['lock_timeout=200ms'] AND prosecdef FROM pg_proc WHERE oid = 'private.appointment_evidence_capture()'::regprocedure),
                   'the capture trigger function is definer-rights with a 200 ms lock bound');

-- Bookings: one future (41001), several past ones (41002-41006).
SELECT test_actor(11); SET ROLE authenticated;
SELECT t_book(41001, now() + interval '2 days');
SELECT t_book(41001, now() + interval '2 days');   -- E1: a replay writes nothing new
SELECT t_book(41002, now() - interval '2 hours');
SELECT t_book(41003, now() - interval '3 hours');
SELECT t_book(41004, now() - interval '4 hours');
SELECT t_book(41005, now() - interval '5 hours', 'Follow Up');
SELECT t_book(41006, now() - interval '6 hours');
RESET ROLE;
SELECT test_assert(t_occ(41001) = '1|booking|sales|open' AND t_obs(41001) = 1, 'a booking opens seq 1 with the booking-time category; its replay adds nothing');
SELECT test_assert((SELECT setter_id = test_uuid(11) AND assignee_at_open = test_uuid(12) AND booking_kind = 'appointment'
                      AND contact_id = test_uuid(201) AND type_name = 'Sales Call' AND type_id IS NOT NULL
                      FROM private.appointment_occurrences WHERE appointment_id = t_appt(41001)), 'booking snapshot');
SELECT test_assert(t_occ(41005) = '1|booking|follow_up|open', 'a Follow Up booking is snapshotted as follow_up');

-- E1: a notes edit writes one observation only. E13: an assignment event on every user_id change.
SELECT test_actor(11); SET ROLE authenticated;
UPDATE appointments SET notes = 'edited' WHERE id = t_appt(41001);
RESET ROLE;
SELECT test_assert(t_obs(41001) = 2 AND t_occ(41001) = '1|booking|sales|open' AND t_outcomes(41001) IS NULL, 'a notes edit: one observation only');
SELECT test_actor(19, 1, 'Admin'); SET ROLE authenticated;
UPDATE appointments SET user_id = test_uuid(11) WHERE id = t_appt(41001);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
UPDATE appointments SET user_id = test_uuid(12) WHERE id = t_appt(41001);  -- a system (no JWT) reassignment
SELECT test_assert((SELECT string_agg(concat_ws('|', (assignee_before = test_uuid(12))::text, (assignee_after = test_uuid(11))::text, actor_kind), ' ; ' ORDER BY id)
                      FROM private.appointment_assignment_events WHERE appointment_id = t_appt(41001)) = 'true|true|human ; false|false|system',
                   'assignment events for human and system changes');

-- E2: a reschedule before start closes the slot and opens the next one.
SELECT test_actor(12); SET ROLE authenticated;
UPDATE appointments SET start_time = start_time + interval '1 day' WHERE id = t_appt(41001);
RESET ROLE;
SELECT test_assert(t_occ(41001) = '1|booking|sales|rescheduled_before_start ; 2|reschedule|sales|open', 'reschedule before start');

-- E8: the outcome RPC (the assignee records Held on a started slot).
SELECT test_actor(12); SET ROLE authenticated;
CREATE TEMP TABLE outcome_results(k text, v jsonb);
INSERT INTO outcome_results SELECT 'held', record_appointment_outcome(test_uuid(41102), t_appt(41002),
  (SELECT start_time FROM appointments WHERE id = t_appt(41002)), 'held');
INSERT INTO outcome_results SELECT 'replay', record_appointment_outcome(test_uuid(41102), t_appt(41002),
  (SELECT start_time FROM appointments WHERE id = t_appt(41002)), 'held');
SELECT test_reject($q$SELECT record_appointment_outcome(test_uuid(41102), t_appt(41002), (SELECT start_time FROM appointments WHERE id = t_appt(41002)), 'no_show')$q$, '22023');
SELECT test_reject($q$SELECT record_appointment_outcome(test_uuid(41103), t_appt(41002), now() - interval '1 minute', 'held')$q$, 'PT409');
SELECT test_reject($q$SELECT record_appointment_outcome(test_uuid(41104), t_appt(41001), (SELECT start_time FROM appointments WHERE id = t_appt(41001)), 'held')$q$, '22023');
SELECT test_reject($q$SELECT record_appointment_outcome(test_uuid(41105), t_appt(41002), (SELECT start_time FROM appointments WHERE id = t_appt(41002)), 'cancelled')$q$, '22023');
RESET ROLE;
SELECT test_assert((SELECT v - 'start_time' FROM outcome_results WHERE k = 'held') = (SELECT v - 'start_time' FROM outcome_results WHERE k = 'replay')
                   AND (SELECT v ->> 'status' FROM outcome_results WHERE k = 'held') = 'Completed', 'a replay returns the same body');
SELECT test_assert(t_outcomes(41002) = '1|held|outcome_action|human|sales|false'
                   AND (SELECT request_id = test_uuid(41102) AND recorded_by = test_uuid(12) FROM private.appointment_outcome_events e
                          JOIN private.appointment_occurrences o ON o.id = e.occurrence_id WHERE o.appointment_id = t_appt(41002))
                   AND (SELECT status FROM appointments WHERE id = t_appt(41002)) = 'Completed',
                   'one held event with its request id and recorder; a different outcome on the same request changed nothing');
-- An agent who cannot see the appointment cannot record its outcome (RLS): 0 rows → PT409.
CREATE TEMP TABLE probe AS SELECT id, start_time FROM appointments WHERE id = t_appt(41003);
GRANT SELECT ON probe TO authenticated;
SELECT test_actor(21, 2); SET ROLE authenticated;
SELECT test_reject($q$SELECT record_appointment_outcome(test_uuid(41106), (SELECT id FROM probe), (SELECT start_time FROM probe), 'held')$q$, 'PT409');
RESET ROLE;

-- E5: status edits supersede; →open retracts; one root per occurrence; no credit is stored on an outcome.
SELECT test_actor(12); SET ROLE authenticated;
UPDATE appointments SET status = 'Completed' WHERE id = t_appt(41003);
UPDATE appointments SET status = 'No Show' WHERE id = t_appt(41003);
UPDATE appointments SET status = 'Scheduled' WHERE id = t_appt(41003);
RESET ROLE;
SELECT test_assert(t_outcomes(41003) = '1|held|status_edit|human|sales|false ; 1|no_show|status_edit|human|sales|true ; 1|retracted|status_edit|human|sales|true',
                   'supersede and retract');
SELECT test_assert(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'private' AND table_name = 'appointment_outcome_events'
                                 AND column_name IN ('agent_id', 'credited_agent_id', 'user_id')), 'no credit column on outcomes');

-- E4: an open past slot whose start and status change in one write is a slot correction.
SELECT test_actor(12); SET ROLE authenticated;
UPDATE appointments SET start_time = start_time + interval '30 minutes', status = 'Completed' WHERE id = t_appt(41004);
RESET ROLE;
SELECT test_assert(t_occ(41004) = '1|booking|sales|slot_corrected ; 2|reschedule|sales|open' AND t_outcomes(41004) = '2|held|status_edit|human|sales|false',
                   'slot_corrected: the outcome lands on the corrected slot');

-- E3: a missed slot moved after its start stays unresolved (no outcome on either slot).
SELECT test_actor(12); SET ROLE authenticated;
UPDATE appointments SET start_time = now() + interval '1 day' WHERE id = t_appt(41006);
RESET ROLE;
SELECT test_assert(t_occ(41006) = '1|booking|sales|rescheduled_after_start ; 2|reschedule|sales|open' AND t_outcomes(41006) IS NULL,
                   'a missed slot moved after start');

-- A human retype of a held occurrence restates its head under the new category.
SELECT test_actor(12); SET ROLE authenticated;
UPDATE appointments SET status = 'Completed' WHERE id = t_appt(41005);
UPDATE appointments SET type = 'Sales Call' WHERE id = t_appt(41005);
RESET ROLE;
SELECT test_assert(t_outcomes(41005) = '1|held|status_edit|human|follow_up|false ; 1|held|reclassified|human|sales|true', 'reclassified on a human retype');

-- E6: the system actor (Google sync, no JWT) cannot retract or reclassify; it may record a cancellation.
-- The system actor is auth.uid() NULL (the Google sync's service role); run as the table owner so RLS does not apply.
SELECT set_config('request.jwt.claims', '', false);
UPDATE appointments SET status = 'Scheduled' WHERE id = t_appt(41002);
UPDATE appointments SET type = 'Other' WHERE id = t_appt(41002);
UPDATE appointments SET status = 'Cancelled' WHERE id = t_appt(41002);
RESET ROLE;
SELECT test_assert(t_outcomes(41002) = '1|held|outcome_action|human|sales|false ; 1|cancelled|external_sync|system|sales|true',
                   'system: no retraction or reclassification; a cancellation is recorded');

-- E7: a delete closes the slot and keeps every event.
SELECT test_actor(12); SET ROLE authenticated;
DELETE FROM appointments WHERE id = t_appt(41003);
RESET ROLE;
SELECT test_assert((SELECT count(*) = 1 FROM private.appointment_occurrences o WHERE o.close_reason = 'deleted'
                      AND EXISTS (SELECT 1 FROM private.appointment_evidence_observations b WHERE b.appointment_id = o.appointment_id AND b.op = 'DELETE')
                      AND (SELECT count(*) FROM private.appointment_outcome_events e WHERE e.occurrence_id = o.id) = 3),
                   'delete: slot closed, observation and events kept');

-- E14: every observation's previous state is the prior observation's new state.
SELECT test_assert(NOT EXISTS (
  SELECT 1 FROM (SELECT appointment_id, prev, lag(next) OVER (PARTITION BY appointment_id ORDER BY id) AS prior_next,
                        row_number() OVER (PARTITION BY appointment_id ORDER BY id) AS n
                   FROM private.appointment_evidence_observations) c
   WHERE c.n > 1 AND c.prev IS DISTINCT FROM c.prior_next), 'the observation chain is unbroken');

-- Pre-capture rows: the booking fixture's appointments predate …41; their first update opens a pre_capture slot.
SELECT test_assert((SELECT count(*) > 0 FROM appointments a WHERE NOT EXISTS
                     (SELECT 1 FROM private.appointment_evidence_observations o WHERE o.appointment_id = a.id)), 'pre-capture rows exist');
CREATE TEMP TABLE pre_capture AS SELECT a.id FROM appointments a WHERE NOT EXISTS
  (SELECT 1 FROM private.appointment_evidence_observations o WHERE o.appointment_id = a.id) ORDER BY a.created_at, a.id LIMIT 1;
UPDATE appointments SET notes = 'touched' WHERE id = (SELECT id FROM pre_capture);
SELECT test_assert((SELECT opened_source = 'pre_capture' AND category_basis = 'type_history' AND seq = 1 FROM private.appointment_occurrences
                     WHERE appointment_id = (SELECT id FROM pre_capture)), 'a pre-capture slot opens from the previous row');

-- E10: a capture failure never blocks the write: one gap row. E10b: the gap write also fails: WARNING, no row.
-- E10c: under the outcome RPC the same failure raises and nothing changes. An assertion failure aborts the write.
SAVEPOINT failures;
CREATE OR REPLACE FUNCTION private.appointment_evidence_apply(p_op text, p_old public.appointments, p_new public.appointments) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'forced capture failure' USING ERRCODE = 'XX000'; END $$;
SELECT test_actor(11); SET ROLE authenticated;
SELECT t_book(41201, now() + interval '3 days');
RESET ROLE;
SELECT test_assert(t_appt(41201) IS NOT NULL AND t_obs(41201) = 0
                   AND (SELECT count(*) = 1 AND min(sqlstate) = 'XX000' AND min(operation) = 'INSERT' FROM private.appointment_evidence_capture_gaps
                         WHERE appointment_id = t_appt(41201)), 'E10: the booking commits with one gap row');
ALTER TABLE private.appointment_evidence_capture_gaps ADD CONSTRAINT forced_gap_failure CHECK (false) NOT VALID;
SELECT test_actor(11); SET ROLE authenticated;
SELECT t_book(41202, now() + interval '3 days');
RESET ROLE;
SELECT test_assert(t_appt(41202) IS NOT NULL AND (SELECT count(*) = 0 FROM private.appointment_evidence_capture_gaps WHERE appointment_id = t_appt(41202)),
                   'E10b: the booking commits with no gap row');
CREATE OR REPLACE FUNCTION private.appointment_evidence_apply(p_op text, p_old public.appointments, p_new public.appointments) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'forced capture failure' USING ERRCODE = '55P03'; END $$;
SELECT test_actor(12); SET ROLE authenticated;
UPDATE appointments SET start_time = now() - interval '10 minutes' WHERE id = t_appt(41001);
SELECT test_reject($q$SELECT record_appointment_outcome(test_uuid(41204), t_appt(41001), now() - interval '10 minutes', 'held')$q$, '55P03');
RESET ROLE;
SELECT test_assert((SELECT status FROM appointments WHERE id = t_appt(41001)) = 'Scheduled', 'E10c: the failed outcome RPC changed nothing');
CREATE OR REPLACE FUNCTION private.appointment_evidence_apply(p_op text, p_old public.appointments, p_new public.appointments) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN ASSERT false, 'forced assertion'; END $$;
-- WHEN OTHERS cannot catch ASSERT_FAILURE (that is the point): only an explicit assert_failure handler sees it.
DO $assert$ BEGIN
  BEGIN UPDATE appointments SET notes = 'assert' WHERE id = t_appt(41005); RAISE EXCEPTION 'the write was not aborted';
  EXCEPTION WHEN assert_failure THEN NULL; END;
END $assert$;
SELECT test_assert((SELECT notes IS DISTINCT FROM 'assert' FROM appointments WHERE id = t_appt(41005)), 'an assertion failure aborts the write');
ROLLBACK TO SAVEPOINT failures;
SELECT test_assert(md5(prosrc) <> md5('BEGIN RAISE EXCEPTION ''forced capture failure'' USING ERRCODE = ''XX000''; END'), 'the real capture is back')
  FROM pg_proc WHERE oid = 'private.appointment_evidence_apply(text,public.appointments,public.appointments)'::regprocedure;

-- Append-only.
SELECT test_reject($q$UPDATE private.appointment_evidence_observations SET op = 'UPDATE'$q$, '23514');
SELECT test_reject($q$DELETE FROM private.appointment_outcome_events$q$, '23514');
SELECT test_reject($q$UPDATE private.appointment_occurrences SET close_reason = 'deleted' WHERE close_reason = 'rescheduled_before_start'$q$, '23514');
SELECT test_reject($q$UPDATE private.appointment_occurrences SET category = 'other' WHERE closed_at IS NULL$q$, '23514');
SELECT test_reject($q$TRUNCATE private.appointment_assignment_events$q$, '23514');
SELECT test_reject($q$DELETE FROM private.appointment_evidence_capture_windows$q$, '23514');

-- The classification resolves through the audited type history.
SELECT test_assert(private.appointment_evidence_classify(test_uuid(1), 'Sales Call', 'appointment', now(), now()) = 'sales'
                   AND private.appointment_evidence_classify(test_uuid(1), 'Sales Call', 'callback', now(), now()) = 'callback'
                   AND private.appointment_evidence_classify(test_uuid(1), 'No Such Type', 'appointment', now(), now()) = 'unclassified'
                   AND private.appointment_evidence_classify(test_uuid(1), 'sales call ', 'appointment', now(), now()) = 'sales',
                   'classify: by name at the instant, callback kind, unknown type');
-- Appointments a role may not see are invisible to it; nothing in this suite widened RLS.
SELECT test_actor(21, 2); SET ROLE authenticated;
SELECT test_assert((SELECT count(*) = 0 FROM appointments WHERE organization_id = test_uuid(1)), 'cross-organization appointments stay invisible');
RESET ROLE;
