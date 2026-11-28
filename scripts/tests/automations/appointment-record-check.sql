-- Run after appointment-record-native.ts. Confirms from the database what the worker recorded for each sign-off
-- demonstration: the reminder record's rows (one per step and appointment time, and at most one retry of a text), the
-- runs and their steps, the messages handed to the provider and the requests that never were. Then drops the fixture's
-- test-only functions.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.cid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('aacc0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
CREATE FUNCTION pg_temp.ok(passed boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF passed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Reminder record: %', message; END IF;
END $$;
-- The lead's runs on the automation by booking, r1 first.
CREATE FUNCTION pg_temp.ords(lead_n int) RETURNS TABLE(run_id uuid, ord bigint) LANGUAGE sql STABLE AS $$
  SELECT r.id,row_number() OVER (ORDER BY r.event_id,r.id) FROM private.automation_runs r
  WHERE r.organization_id=pg_temp.cid(1) AND r.workflow_id=pg_temp.cid(60) AND r.contact_id=pg_temp.cid(lead_n)
$$;
-- The record's rows for the lead's appointment: step @ time (T is where the appointment stands now) # attempt : kind :
-- run, and the provider's failure status and code.
CREATE FUNCTION pg_temp.record(lead_n int) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(g.node_id||'@'||CASE WHEN g.starts_at=a.start_time THEN 'T' ELSE 'T2' END||'#'||g.attempt||':'||g.kind
      ||':r'||o.ord||coalesce(':'||g.failure_status,'')||coalesce(':'||g.failure_code,''),', ' ORDER BY g.given_at,g.attempt),'none')
  FROM private.automation_given_steps g
  JOIN public.appointments a ON a.organization_id=g.organization_id AND a.id=g.appointment_id
  JOIN pg_temp.ords(lead_n) o ON o.run_id=g.run_id
  WHERE g.organization_id=pg_temp.cid(1) AND g.workflow_id=pg_temp.cid(60) AND a.contact_id=pg_temp.cid(lead_n)
$$;
-- Each run of the lead, by booking: how it ended, and its steps in graph order with their reasons.
CREATE FUNCTION pg_temp.runs(lead_n int) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(r.status||':'||coalesce(r.reason,'-')||' ['||coalesce((SELECT string_agg(s.node_id||'='||s.status
      ||coalesce(':'||s.reason,''),', ' ORDER BY array_position(ARRAY['w24','t24','w1','t1'],s.node_id))
      FROM private.automation_steps s WHERE s.organization_id=r.organization_id AND s.run_id=r.id),'')||']',' | '
      ORDER BY o.ord),'none')
  FROM private.automation_runs r JOIN pg_temp.ords(lead_n) o ON o.run_id=r.id
$$;
-- The texts handed to the provider for the lead, in order: the step, the run, and the message's state.
CREATE FUNCTION pg_temp.texts(lead_n int) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(m.node_id||':r'||o.ord||':'||m.state,', ' ORDER BY m.authorized_at,m.id),'none')
  FROM private.automation_messages m JOIN pg_temp.ords(lead_n) o ON o.run_id=m.run_id
  WHERE m.organization_id=pg_temp.cid(1)
$$;
-- The lead's provider requests that were reserved and cancelled before any handoff, by run.
CREATE FUNCTION pg_temp.cancelled(lead_n int) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg('r'||o.ord||':'||split_part(d.request_key,':',3),', ' ORDER BY o.ord),'none')
  FROM public.sms_dispatches d JOIN pg_temp.ords(lead_n) o ON d.request_key='automation:'||o.run_id::text||':'||split_part(d.request_key,':',3)
  WHERE d.organization_id=pg_temp.cid(1) AND d.state='failed' AND d.error_code='pre_handoff_cancelled' AND d.provider_sid IS NULL
$$;
DO $$
DECLARE n int;
BEGIN
  -- 1. Friday at 2 PM, moved away and back.
  PERFORM pg_temp.ok(pg_temp.record(101)='t24@T#1:sms:r1, t1@T#1:sms:r1' AND pg_temp.texts(101)='t24:r1:accepted, t1:r1:accepted'
      AND pg_temp.runs(101)='completed:Verified provider receipt [w24=elapsed, t24=accepted:Verified provider receipt, w1=elapsed, '
        ||'t1=accepted:Verified provider receipt] | stopped:Appointment was moved back [w24=wait]',
    'lead 101, moved away and straight back: one day-before and one hour-before text for T: '||pg_temp.record(101)||' / '||pg_temp.runs(101));
  PERFORM pg_temp.ok(pg_temp.record(102)='t24@T#1:sms:r1, t24@T2#1:sms:r2, t1@T2#1:sms:r2, t1@T#1:sms:r3'
      AND pg_temp.texts(102)='t24:r1:accepted, t24:r2:accepted, t1:r2:accepted, t1:r3:accepted'
      AND split_part(pg_temp.runs(102),' | ',3)='completed:Verified provider receipt [w24=elapsed:Already reached for this '
        ||'appointment time, t24=skipped:Already sent for this appointment time, w1=elapsed, t1=accepted:Verified provider receipt]',
    'lead 102, back at T on a new run: T''s day-before text is not given again: '||pg_temp.record(102)||' / '||pg_temp.runs(102));
  -- 2. Corrected outcomes: each recorded by a person, then taken back by that person.
  FOREACH n IN ARRAY ARRAY[103,104] LOOP
    PERFORM pg_temp.ok(pg_temp.record(n)='t24@T#1:sms:r1, t1@T#1:sms:r1' AND pg_temp.texts(n)='t24:r1:accepted, t1:r1:accepted'
        AND pg_temp.runs(n)='completed:Verified provider receipt [w24=elapsed, t24=accepted:Verified provider receipt, w1=elapsed, '
          ||'t1=accepted:Verified provider receipt]',
      'lead '||n||', a corrected outcome: one day-before and one hour-before text: '||pg_temp.record(n)||' / '||pg_temp.runs(n));
    PERFORM pg_temp.ok((SELECT string_agg(e.outcome||':'||e.actor_kind,', ' ORDER BY e.recorded_at) FROM private.appointment_outcome_events e
        JOIN private.appointment_occurrences o ON o.id=e.occurrence_id
        JOIN public.appointments a ON a.id=o.appointment_id AND a.organization_id=o.organization_id
        WHERE a.organization_id=pg_temp.cid(1) AND a.contact_id=pg_temp.cid(n))
        =CASE n WHEN 103 THEN 'no_show:human, retracted:human' ELSE 'held:human, retracted:human' END,
      'lead '||n||'''s outcome was a person''s, and so was its correction');
  END LOOP;
  -- 3 and 5. Two workers, the one retry, and receipts after it.
  PERFORM pg_temp.ok(pg_temp.texts(111) IN ('t24:r1:failed, t24:r3:failed','t24:r1:failed, t24:r4:failed',
        't24:r2:failed, t24:r3:failed','t24:r2:failed, t24:r4:failed')
      AND pg_temp.record(111) ~ '^t24@T#1:sms:r[12]:undelivered:30003, t24@T#2:sms:r[34]:undelivered:30003$',
    'lead 111: two texts in all for the time, the first and its one retry, each with the provider''s first failure: '
      ||pg_temp.texts(111)||' / '||pg_temp.record(111));
  PERFORM pg_temp.ok((SELECT count(*) FROM private.automation_given_steps g WHERE g.organization_id=pg_temp.cid(1)
      AND g.appointment_id=pg_temp.cid(211))=2, 'lead 111: no third attempt');
  PERFORM pg_temp.ok(pg_temp.runs(111) ~ ('^(waiting:- \[w24=elapsed, t24=(accepted:Verified provider receipt|skipped:Already sent for '
        ||'this appointment time), w1=wait\] \| ){2}(waiting:- \[w24=elapsed, t24=(accepted:Verified provider receipt|skipped:Not '
        ||'sent again: already retried once for this appointment time), w1=wait\] \| ){2}waiting:- \[w24=elapsed, t24=skipped:Not '
        ||'sent again: already retried once for this appointment time, w1=wait\]$')
      AND (SELECT count(*) FROM private.automation_steps s JOIN pg_temp.ords(111) o ON o.run_id=s.run_id
        WHERE s.node_id='t24' AND s.status='accepted')=2,
    'lead 111: each race''s loser and the further run went on past the text: '||pg_temp.runs(111));
  PERFORM pg_temp.ok(pg_temp.cancelled(111) IN ('r1:t24, r3:t24','r1:t24, r4:t24','r2:t24, r3:t24','r2:t24, r4:t24')
      AND NOT EXISTS (SELECT 1 FROM public.sms_dispatches d WHERE d.organization_id=pg_temp.cid(1)
        AND d.request_key='automation:'||pg_temp.cid(305)::text||':t24'),
    'lead 111: each loser''s request was cancelled before any handoff, and the further run reserved none: '||pg_temp.cancelled(111));
  -- 4. A stop committed before the final handoff wins.
  PERFORM pg_temp.ok(pg_temp.texts(105)='none' AND pg_temp.record(105)='none' AND pg_temp.cancelled(105)='r1:t24'
      AND pg_temp.runs(105)='stopped:Stopped by user [w24=elapsed]',
    'lead 105, a person''s stop before the final authorization: '||pg_temp.runs(105));
  PERFORM pg_temp.ok(pg_temp.texts(106)='none' AND pg_temp.record(106)='none' AND pg_temp.cancelled(106)='r1:t24'
      AND pg_temp.runs(106)='stopped:Verified reply received [w24=elapsed]',
    'lead 106, a verified reply before the final authorization: '||pg_temp.runs(106));
  PERFORM pg_temp.ok(pg_temp.texts(112)='none' AND pg_temp.record(112)='none' AND pg_temp.cancelled(112)='r1:t24'
      AND pg_temp.runs(112)='waiting:- [w24=elapsed, t24=skipped:Stopped by a person for this appointment time, w1=wait] | '
        ||'stopped:Stopped by user [w24=elapsed]',
    'lead 112, another run stopped before the final authorization: '||pg_temp.runs(112));
  PERFORM pg_temp.ok((SELECT count(*) FROM private.automation_intents i JOIN private.automation_runs r ON r.id=i.run_id
      WHERE r.organization_id=pg_temp.cid(1) AND r.contact_id IN (pg_temp.cid(105),pg_temp.cid(106),pg_temp.cid(112))
        AND i.node_id='t24' AND i.status<>'prepared')=0, 'no refused text was recorded as handed to a provider');
  -- 6. A carried-on run, and a qualifying new run.
  PERFORM pg_temp.ok(pg_temp.record(107)='t24@T#1:sms:r1:undelivered:30003, t1@T#1:sms:r1'
      AND pg_temp.texts(107)='t24:r1:failed, t1:r1:accepted'
      AND pg_temp.runs(107)='completed:Verified provider receipt [w24=elapsed, t24=accepted:Verified provider receipt, w1=elapsed, '
        ||'t1=accepted:Verified provider receipt]',
    'lead 107, carried on: no retry, the hour-before text once: '||pg_temp.record(107)||' / '||pg_temp.runs(107));
  PERFORM pg_temp.ok(pg_temp.record(108)='t24@T#1:sms:r1:undelivered:30003, t24@T2#1:sms:r2, t1@T2#1:sms:r2, t24@T#2:sms:r3, '
        ||'t1@T#1:sms:r3'
      AND pg_temp.texts(108)='t24:r1:failed, t24:r2:accepted, t1:r2:accepted, t24:r3:accepted, t1:r3:accepted',
    'lead 108, a qualifying new run: the one retry, then the hour-before text: '||pg_temp.record(108));
  -- Every row of the record is this agency's, and each run wrote at most one per step.
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM private.automation_given_steps g JOIN private.automation_runs r ON r.id=g.run_id
      WHERE r.organization_id<>g.organization_id OR r.workflow_id<>g.workflow_id), 'every record row is its run''s agency and automation');
END $$;
DROP FUNCTION public.automation_record_fixture_due(uuid[]),public.automation_record_fixture_runs(uuid);
NOTIFY pgrst,'reload schema';
COMMIT;
\echo 'Verified the reminder record the sign-off demonstrations left: each step once per appointment time, one retry at most, and no handoff after a stop.'
