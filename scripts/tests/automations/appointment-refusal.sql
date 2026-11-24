-- Explicit, disposable native test: a reminder the final authorization refuses (outside the recipient's sending hours)
-- is held without leaving its step unable to send, and once the window opens the next lease sends it exactly once.
-- Run with -v phase=refuse before the first appointment-refusal-native.ts pass, -v phase=open before the second,
-- and -v phase=check after it, on the database appointment-handoff-fixture.sql prepared.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_setting('agentflow.synthetic_channels', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'This fixture requires an explicitly selected synthetic database.';
 END IF;
END $$;
CREATE FUNCTION pg_temp.cid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('aacc0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
CREATE FUNCTION pg_temp.ok(passed boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF passed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Appointment refusal: %', message; END IF;
END $$;
CREATE TEMPORARY TABLE refusal_phase(phase text) ON COMMIT DROP;
INSERT INTO refusal_phase VALUES (:'phase');
DO $$
DECLARE phase text:=(SELECT r.phase FROM refusal_phase r); run private.automation_runs;
BEGIN
  IF phase='refuse' THEN
    -- The agency's sending window moves to later today, so the text is due outside it. Its run becomes the oldest work.
    UPDATE private.automation_channel_policies SET local_start=(clock_timestamp() AT TIME ZONE 'UTC'+interval '2 hours')::time,
      local_end=(clock_timestamp() AT TIME ZONE 'UTC'+interval '3 hours')::time
      WHERE organization_id=pg_temp.cid(1) AND channel='sms';
    UPDATE private.automation_runs SET due_at='2001-01-01' WHERE id=pg_temp.cid(28);
  ELSIF phase='open' THEN
    SELECT * INTO STRICT run FROM private.automation_runs WHERE id=pg_temp.cid(28);
    PERFORM pg_temp.ok(run.status='held' AND run.reason='Outside the recipient local sending window.'
        AND (SELECT status='prepared' FROM private.automation_intents WHERE run_id=run.id AND node_id='text')
        AND NOT EXISTS (SELECT FROM private.automation_messages WHERE run_id=run.id),
      'the text refused outside sending hours is held with that reason, and nothing was handed off');
    -- The window opens again, with room under the daily limit, and the held text's next lease is due.
    UPDATE private.automation_channel_policies SET local_start=(clock_timestamp() AT TIME ZONE 'UTC'-interval '1 hour')::time,
      local_end=(clock_timestamp() AT TIME ZONE 'UTC'+interval '1 hour')::time,daily_limit=50
      WHERE organization_id=pg_temp.cid(1) AND channel='sms';
    UPDATE private.automation_runs SET due_at='2001-01-01' WHERE id=pg_temp.cid(28);
  ELSIF phase='check' THEN
    SELECT * INTO STRICT run FROM private.automation_runs WHERE id=pg_temp.cid(28);
    PERFORM pg_temp.ok(run.status='completed' AND (SELECT status='accepted' FROM private.automation_intents
        WHERE run_id=run.id AND node_id='text') AND (SELECT count(*)=1 FROM private.automation_messages WHERE run_id=run.id)
        AND (SELECT count(*)=1 FROM public.sms_dispatches WHERE organization_id=pg_temp.cid(1)
          AND request_key='automation:'||run.id::text||':text' AND state='accepted'),
      'once the window opened the text was accepted once and the run completed');
  ELSE
    RAISE EXCEPTION 'Choose phase refuse, open or check.';
  END IF;
END $$;
COMMIT;
