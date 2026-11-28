-- Run after appointment-handoff-native.ts. Confirms what the worker recorded for each reminder and that the next
-- lease settles each refusal. Read-only: every change rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.cid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('aacc0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
CREATE FUNCTION pg_temp.ok(passed boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF passed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Appointment handoff: %', message; END IF;
END $$;
DO $$
DECLARE run private.automation_runs; n int;
BEGIN
  SELECT * INTO STRICT run FROM private.automation_runs WHERE id=pg_temp.cid(23);
  PERFORM pg_temp.ok(run.status='held' AND run.reason='The appointment moved after this message was prepared',
    'a move before the worker started holds the text with that reason');
  SELECT * INTO STRICT run FROM private.automation_runs WHERE id=pg_temp.cid(24);
  PERFORM pg_temp.ok(run.status='held' AND run.reason='Appointment was cancelled',
    'a cancellation before the worker started holds the text with that reason');
  FOR n IN 26..27 LOOP
    SELECT * INTO STRICT run FROM private.automation_runs WHERE id=pg_temp.cid(n);
    PERFORM pg_temp.ok(run.status='held' AND run.reason='Run no longer permits a provider handoff.',
      'a change just before the final authorization is refused there');
  END LOOP;
  PERFORM pg_temp.ok((SELECT count(*)=4 FROM private.automation_intents WHERE run_id IN (pg_temp.cid(23),pg_temp.cid(24),pg_temp.cid(26),pg_temp.cid(27))
      AND node_id='text' AND status='prepared')
    AND NOT EXISTS (SELECT FROM private.automation_messages WHERE run_id IN (pg_temp.cid(23),pg_temp.cid(24),pg_temp.cid(26),pg_temp.cid(27))),
    'no refused reminder was recorded as handed to a provider');
  SELECT * INTO STRICT run FROM private.automation_runs WHERE id=pg_temp.cid(25);
  PERFORM pg_temp.ok(run.status='completed' AND (SELECT status='accepted' FROM private.automation_intents
      WHERE run_id=run.id AND node_id='text') AND (SELECT count(*)=1 FROM private.automation_messages WHERE run_id=run.id),
    'the unchanged reminder was accepted once and the run completed');
  -- The next lease: a cancelled appointment ends its run, and a moved one waits for the automation to start over for
  -- the new time. These four runs are the oldest work due anywhere; any other agency's work it leases rolls back.
  UPDATE private.automation_runs SET due_at='2001-01-01'
    WHERE id IN (pg_temp.cid(23),pg_temp.cid(24),pg_temp.cid(26),pg_temp.cid(27));
  PERFORM pg_temp.ok(NOT EXISTS (SELECT FROM public.automation_claim_work(4) c
      WHERE c->>'run_id' IN (pg_temp.cid(23)::text,pg_temp.cid(24)::text,pg_temp.cid(26)::text,pg_temp.cid(27)::text)),
    'none of them is handed to the worker again');
  FOR n IN 24..27 BY 3 LOOP
    SELECT * INTO STRICT run FROM private.automation_runs WHERE id=pg_temp.cid(n);
    PERFORM pg_temp.ok(run.status='stopped' AND run.reason='Appointment was cancelled','a cancelled reminder''s run ended');
  END LOOP;
  FOR n IN 23..26 BY 3 LOOP
    SELECT * INTO STRICT run FROM private.automation_runs WHERE id=pg_temp.cid(n);
    PERFORM pg_temp.ok(run.status='held' AND run.due_at>clock_timestamp() AND private.automation_awaits_restart(run),
      'a moved reminder waits for the automation to start over for the new time');
  END LOOP;
END $$;
ROLLBACK;
