-- Automations V2 runtime. Leases carry the facts a step needs, internal task steps are created once,
-- appointment waits follow the appointment, a booking's texts, emails and tasks are given once per appointment time
-- across runs (the reminder record, with one retry of a text a provider failed for a temporary reason), and activity
-- shows every contact type with the step name from the version that ran. Installs no job, definition, enrollment or
-- send.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Never installed over a database where Automations V2 was rolled back, or where a stopped installation was backed
-- out: the files after a back-out would run beside restored first-release functions. That takes a new migration.
DO $v2_guard$ BEGIN
  IF to_regprocedure('private.automation_v2_rollback_guard()') IS NOT NULL
      OR to_regprocedure('private.automation_v2_backed_out()') IS NOT NULL THEN
    RAISE EXCEPTION 'Automations V2 was rolled back or backed out on this database. Installing it again takes a new migration.';
  END IF;
END $v2_guard$;

-- The reminder record: what booking runs gave for an appointment time, across runs. One row is one text, email or task
-- a run that a booking started gave for the automation, the appointment, the start time its lease verified and the step
-- (node id, the same step across published versions). A text the provider rejected or reported failed with a code that
-- can be retried gets one more row, attempt 2, written by the one later run that sends it again. Rows are never deleted;
-- only the provider's failure, from a signed status callback, is added to a row: the first failed callback, as a whole
-- (its status, its error code or none, and its time), and never changed after (automation_record_provider_receipt).
CREATE TABLE private.automation_given_steps (
  organization_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  node_id text NOT NULL,
  attempt smallint NOT NULL CHECK (attempt IN (1,2)),
  kind text NOT NULL CHECK (kind IN ('sms','email','task')),
  run_id uuid NOT NULL REFERENCES private.automation_runs(id),
  slot_id uuid,
  version_id uuid,
  given_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  failure_status text CHECK (length(failure_status)<=20),
  failure_code text CHECK (length(failure_code)<=40),
  failure_at timestamptz,
  PRIMARY KEY (organization_id,workflow_id,appointment_id,starts_at,node_id,attempt),
  UNIQUE (organization_id,run_id,node_id),
  CHECK (attempt=1 OR kind='sms')
);
COMMENT ON TABLE private.automation_given_steps IS 'What booking runs gave for an appointment time, by automation, appointment, start and step, across runs: written at the provider handoff and when a task is created, never deleted. Attempt 2 is the one retry of a text that failed with a retryable provider code. Only automation definer functions read or write it.';
ALTER TABLE private.automation_given_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.automation_given_steps FROM PUBLIC,anon,authenticated,service_role;

-- Whether a provider failure may be sent once more. 'request': Twilio refused the request as rate limited (20429, or
-- HTTP 429 without a code). 'callback': a signed status callback reported it failed or undelivered for a temporary
-- reason (30001 queue overflow, 30003 handset unreachable). Every other code, and no code, is permanent.
CREATE FUNCTION private.automation_failure_retryable(p_source text,p_code text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT coalesce(CASE p_source
    WHEN 'request' THEN regexp_replace(p_code,'^first_contact_4xx:','') IN ('20429','429')
    WHEN 'callback' THEN regexp_replace(p_code,'^first_contact_4xx:','') IN ('30001','30003') END,false)
$$;

-- What the reminder record holds for a step at an appointment time (K: the agency, automation, appointment, start and
-- step), not counting what p_except_run gave there itself. 'none': nothing. 'retried': a text was already sent again.
-- 'given': a task or email was given (an email still pending included), or a text may have reached the customer: it
-- was delivered, is pending or uncertain with the provider, or is not confirmed failed. 'permanent': a confirmed failure
-- that is never sent again. 'retry': exactly one text, which failed with a retryable code (a request refused as rate
-- limited, or a signed failed or undelivered callback) and was not delivered; 'retry_wait': the same, refused at the
-- request less than a minute ago. Index lookups only: the record's key, a message, dispatch and intent by their keys.
CREATE FUNCTION private.automation_step_record(p_org uuid,p_workflow uuid,p_appointment uuid,p_starts_at timestamptz,
  p_node text,p_except_run uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE g private.automation_given_steps; m private.automation_messages; d public.sms_dispatches; intent text;
BEGIN
  IF EXISTS (SELECT 1 FROM private.automation_given_steps x WHERE x.organization_id=p_org AND x.workflow_id=p_workflow
      AND x.appointment_id=p_appointment AND x.starts_at=p_starts_at AND x.node_id=p_node AND x.attempt=2) THEN
    RETURN 'retried';
  END IF;
  SELECT * INTO g FROM private.automation_given_steps x WHERE x.organization_id=p_org AND x.workflow_id=p_workflow
    AND x.appointment_id=p_appointment AND x.starts_at=p_starts_at AND x.node_id=p_node AND x.attempt=1
    AND x.run_id IS DISTINCT FROM p_except_run;
  IF NOT FOUND THEN RETURN 'none'; END IF;
  IF g.kind='task' THEN RETURN 'given'; END IF;
  SELECT * INTO m FROM private.automation_messages x WHERE x.organization_id=p_org AND x.run_id=g.run_id AND x.node_id=p_node;
  SELECT i.status INTO intent FROM private.automation_intents i WHERE i.run_id=g.run_id AND i.node_id=p_node
    AND i.organization_id=p_org;
  IF m.state='delivered' THEN RETURN 'given'; END IF;
  IF g.kind='email' THEN
    RETURN CASE WHEN m.state='failed' OR intent='failed' THEN 'permanent' ELSE 'given' END;
  END IF;
  SELECT * INTO d FROM public.sms_dispatches x WHERE x.organization_id=p_org
    AND x.request_key='automation:'||g.run_id::text||':'||p_node;
  -- Pending or uncertain with the provider: a timeout or a missing receipt is never sent again.
  IF d.state IN ('attempting','uncertain') THEN RETURN 'given'; END IF;
  IF d.state='failed' THEN
    IF NOT private.automation_failure_retryable('request',d.error_code) THEN RETURN 'permanent'; END IF;
    RETURN CASE WHEN d.updated_at+interval '60 seconds'<=clock_timestamp() THEN 'retry' ELSE 'retry_wait' END;
  END IF;
  IF m.state='failed' THEN
    RETURN CASE WHEN g.failure_status IN ('failed','undelivered') AND private.automation_failure_retryable('callback',g.failure_code)
      THEN 'retry' ELSE 'permanent' END;
  END IF;
  -- An intent the worker recorded failed, with no failed dispatch or message: a confirmed failure with no code, which is
  -- never sent again.
  IF intent='failed' THEN RETURN 'permanent'; END IF;
  RETURN 'given';
END $$;

-- Whether a retry of step p_node for an appointment starting at p_starts_at may still go out: not once the appointment
-- has started, nor once the next reminder after the step is due (every appointment wait reachable from the step,
-- stopping at the first on each path, its due time computed as automation_appointment_wait does, for this start).
-- Every caller passes the appointment's current start, so this is the wait's own verdict, without reading the slot
-- again under the handoff lock.
CREATE FUNCTION private.automation_retry_open(r private.automation_runs,p_node text,p_starts_at timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE graph jsonb; wait jsonb; zone text; zoned boolean:=false; amount integer; due timestamptz;
BEGIN
  IF p_starts_at IS NULL OR p_starts_at<=clock_timestamp() THEN RETURN false; END IF;
  SELECT v.graph INTO graph FROM public.workflow_versions v
    WHERE v.organization_id=r.organization_id AND v.workflow_id=r.workflow_id AND v.id=r.version_id;
  FOR wait IN WITH RECURSIVE ahead(id) AS (
        SELECT e->>'target' FROM jsonb_array_elements(graph->'edges') e WHERE e->>'source'=p_node
        UNION
        SELECT e->>'target' FROM ahead a JOIN jsonb_array_elements(graph->'edges') e ON e->>'source'=a.id
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(graph->'nodes') n
          WHERE n->>'id'=a.id AND n->>'type'='wait_until_before_appointment'))
      SELECT n FROM ahead a JOIN jsonb_array_elements(graph->'nodes') n ON n->>'id'=a.id
      WHERE n->>'type'='wait_until_before_appointment' LOOP
    amount:=(wait#>>'{config,amount}')::integer;
    IF wait#>>'{config,unit}'='days' THEN
      IF NOT zoned THEN zone:=private.automation_agency_time_zone(r.organization_id); zoned:=true; END IF;
      due:=CASE WHEN zone IS NULL THEN p_starts_at-make_interval(days=>amount)
        ELSE ((p_starts_at AT TIME ZONE zone)-make_interval(days=>amount)) AT TIME ZONE zone END;
    ELSE
      due:=p_starts_at-CASE wait#>>'{config,unit}' WHEN 'minutes' THEN make_interval(mins=>amount)
        ELSE make_interval(hours=>amount) END;
    END IF;
    IF due IS NULL OR due<=clock_timestamp() THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

-- Whether another run of the automation already gave something at this appointment time in the segment of an
-- appointment wait: every step reachable from the wait without entering another appointment wait. A graph may join two
-- paths into one step, so the walk follows every edge. A run that reaches that wait after its time passed, under the
-- rule that skips a passed reminder, then goes on past it instead of ending there (automation_finish_node).
CREATE FUNCTION private.automation_caught_up(r private.automation_runs,p_wait jsonb,p_starts_at timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE graph jsonb; appointment uuid;
BEGIN
  IF p_starts_at IS NULL THEN RETURN false; END IF;
  SELECT nullif(e.subject->>'appointment_id','')::uuid INTO appointment FROM private.automation_events e
    WHERE e.organization_id=r.organization_id AND e.id=r.event_id AND e.event_type='appointment_booked';
  IF appointment IS NULL THEN RETURN false; END IF;
  SELECT v.graph INTO graph FROM public.workflow_versions v
    WHERE v.organization_id=r.organization_id AND v.workflow_id=r.workflow_id AND v.id=r.version_id;
  RETURN EXISTS (WITH RECURSIVE segment(id) AS (
        SELECT e->>'target' FROM jsonb_array_elements(graph->'edges') e WHERE e->>'source'=p_wait->>'id'
        UNION
        SELECT e->>'target' FROM segment s JOIN jsonb_array_elements(graph->'edges') e ON e->>'source'=s.id
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(graph->'nodes') n
          WHERE n->>'id'=s.id AND n->>'type'='wait_until_before_appointment'))
      SELECT 1 FROM segment s WHERE EXISTS (SELECT 1 FROM private.automation_given_steps g
        WHERE g.organization_id=r.organization_id AND g.workflow_id=r.workflow_id AND g.appointment_id=appointment
          AND g.starts_at=p_starts_at AND g.node_id=s.id AND g.run_id<>r.id));
END $$;

-- Whether a step is late in a segment the run caught up through: the appointment wait the run passed last before the
-- step (the nearest before it on the way the run came, by the run's own steps) was passed as already reached for this
-- appointment time (automation_finish_node), under the rule that skips a passed reminder, and the run's reminders are
-- still for the time its lease verified (the slot they were for starts when the leased slot does). Such a step, which no
-- run gave at this time, is skipped as its time passed, as the run that gave the rest of the segment would have skipped
-- it. After a move to a genuinely new time the segment was caught up for the old time, so the step is not late there. A
-- step owed a retry is decided by the retry window instead (automation_message_issue). It reads the run's version's
-- graph, the run's own steps, the slots its reminders and its lease are for (reminded_for, leased_for) and those two
-- slots' start times. None of these changes while the run holds its lease: a published version's graph never changes,
-- only the run's own lease and finish write its steps and those two slots, and a slot's start never changes (a move
-- opens a new slot). So it is asked before the handoff's lock (automation_message_check, automation_create_task) and
-- not again under it; a change that rewrote any of them for a leased run would have to ask it again there. False,
-- never null.
CREATE FUNCTION private.automation_late_in_segment(r private.automation_runs,p_node text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE graph jsonb; passed record;
BEGIN
  SELECT v.graph INTO graph FROM public.workflow_versions v
    WHERE v.organization_id=r.organization_id AND v.workflow_id=r.workflow_id AND v.id=r.version_id;
  SELECT s.status,s.reason,w.node INTO passed
    FROM (WITH RECURSIVE behind(id) AS (
          SELECT e->>'source' FROM jsonb_array_elements(graph->'edges') e WHERE e->>'target'=p_node
          UNION
          SELECT e->>'source' FROM behind b JOIN jsonb_array_elements(graph->'edges') e ON e->>'target'=b.id
          WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(graph->'nodes') n
            WHERE n->>'id'=b.id AND n->>'type'='wait_until_before_appointment'))
        SELECT n AS node FROM behind b JOIN jsonb_array_elements(graph->'nodes') n ON n->>'id'=b.id
        WHERE n->>'type'='wait_until_before_appointment') w
    JOIN private.automation_steps s ON s.run_id=r.id AND s.node_id=w.node->>'id' AND s.organization_id=r.organization_id
    ORDER BY s.updated_at DESC,s.node_id LIMIT 1;
  RETURN coalesce(FOUND AND passed.status='elapsed' AND passed.reason='Already reached for this appointment time'
    AND coalesce(passed.node#>>'{config,late}','skip')<>'continue'
    AND EXISTS (SELECT 1 FROM private.appointment_occurrences o JOIN private.appointment_occurrences l
        ON l.organization_id=o.organization_id AND l.id=r.leased_for
      WHERE o.organization_id=r.organization_id AND o.id=r.reminded_for AND o.scheduled_start=l.scheduled_start),false);
END $$;

-- The times a stopped booking run followed, for a stop rule's end (a verified reply, a conversation, another booking):
-- the times automation_run_holds counts for a person's stop, rule (b). That is the slot of its appointment wait, else of
-- its reminders, else of its booking; the time the appointment stood at when it was stopped; and each time it stood at
-- when the run gave something. A run recorded as rescheduled whose stop rule's end the move back found later
-- (replaced_stop_reason, automation_refresh_appointment_runs) met that end while it followed the time its reminders were
-- for: the slot its appointment wait may name since, and the moment it ended, belong to the move that ended it, so only
-- its reminders' slot and the times it gave something count.
CREATE FUNCTION private.automation_followed_time(p_org uuid,p_run uuid,p_starts_at timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.automation_runs; origin private.automation_events; appointment uuid;
BEGIN
  SELECT * INTO r FROM private.automation_runs x WHERE x.organization_id=p_org AND x.id=p_run;
  IF NOT FOUND OR p_starts_at IS NULL OR r.status<>'stopped' THEN RETURN false; END IF;
  SELECT * INTO origin FROM private.automation_events e WHERE e.organization_id=p_org AND e.id=r.event_id;
  IF origin.event_type IS DISTINCT FROM 'appointment_booked' OR NOT coalesce(origin.subject ? 'appointment_id',false) THEN
    RETURN false;
  END IF;
  appointment:=nullif(origin.subject->>'appointment_id','')::uuid;
  IF EXISTS (SELECT 1 FROM private.appointment_occurrences o WHERE o.organization_id=p_org
      AND o.id=CASE WHEN r.reason='Appointment was rescheduled' THEN r.reminded_for
        ELSE coalesce(r.anchor_id,r.reminded_for,nullif(origin.subject->>'occurrence_id','')::uuid) END
      AND o.scheduled_start=p_starts_at) THEN
    RETURN true;
  END IF;
  IF r.reason IS DISTINCT FROM 'Appointment was rescheduled'
      AND private.automation_stood_at(p_org,appointment,r.ended_at)=p_starts_at THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM (SELECT coalesce((SELECT m.authorized_at FROM private.automation_messages m
          WHERE m.organization_id=p_org AND m.run_id=r.id AND m.node_id=i.node_id),i.created_at) AS at
        FROM private.automation_intents i WHERE i.organization_id=p_org AND i.run_id=r.id AND i.status<>'prepared'
      UNION ALL SELECT k.created_at FROM private.automation_task_receipts k WHERE k.organization_id=p_org AND k.run_id=r.id) given
    WHERE private.automation_stood_at(p_org,appointment,given.at)=p_starts_at);
END $$;

-- Whether a stop of another booking run of the automation for the appointment holds this appointment time: 'person' for
-- a person's stop ('Stopped by user'), 'rule' for a stop rule's end, null otherwise. A stop holds the times its run
-- followed (automation_run_holds, rule (b), and automation_followed_time), so it still holds a time the appointment
-- moved away from and back to. A genuinely new time is not one of them. A stop rule's end counts the same once its run
-- is recorded as replaced, with the stop rule's reason kept as replaced_stop_reason
-- (automation_refresh_appointment_runs): by a move back ('Appointment was moved back'), or as rescheduled ('Appointment
-- was rescheduled') when a cancellation, a move or a pending provider answer ended it before the stop rule's end was
-- recorded. Read before the handoff lock; the final send check's guard holds a message when such a stop was made since
-- its lease (automation_message_issue).
CREATE FUNCTION private.automation_time_stopped(r private.automation_runs,p_starts_at timestamptz)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE origin private.automation_events; other record; by_rule boolean:=false;
BEGIN
  IF p_starts_at IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO origin FROM private.automation_events e WHERE e.organization_id=r.organization_id AND e.id=r.event_id;
  IF origin.event_type IS DISTINCT FROM 'appointment_booked' OR NOT coalesce(origin.subject ? 'appointment_id',false) THEN
    RETURN NULL;
  END IF;
  FOR other IN SELECT x.id,CASE WHEN x.reason IN ('Appointment was moved back','Appointment was rescheduled')
          THEN x.replaced_stop_reason ELSE x.reason END AS reason
      FROM private.automation_events b
      JOIN private.automation_runs x ON x.organization_id=b.organization_id AND x.event_id=b.id
    WHERE b.organization_id=r.organization_id AND b.subject ? 'appointment_id'
      AND b.subject->>'appointment_id'=origin.subject->>'appointment_id' AND b.event_type='appointment_booked'
      AND x.workflow_id=r.workflow_id AND x.id<>r.id AND x.status='stopped'
      AND (x.reason IN ('Stopped by user','Verified reply received','Contact was reached','Appointment booked')
        OR (x.reason IN ('Appointment was moved back','Appointment was rescheduled')
          AND x.replaced_stop_reason IN ('Verified reply received','Contact was reached','Appointment booked')))
    ORDER BY x.reason='Stopped by user' DESC,x.id LOOP
    IF other.reason='Stopped by user' THEN
      IF private.automation_run_holds(r.organization_id,other.id,p_starts_at) THEN RETURN 'person'; END IF;
    ELSIF NOT by_rule AND private.automation_followed_time(r.organization_id,other.id,p_starts_at) THEN
      by_rule:=true;
    END IF;
  END LOOP;
  RETURN CASE WHEN by_rule THEN 'rule' END;
END $$;

-- At the provider handoff of a booking run's message (automation_authorize_handoff, under its locks), the reminder
-- record notes it for the automation, the appointment and the start of the slot the final send check just verified.
-- A text owed its retry is attempt 2, written only while the first attempt's message row is free and not delivered: a
-- delivered message, or a receipt being recorded for it ('A receipt for the first attempt of this text is being
-- recorded.'), refuses the handoff, and the next lease decides. A row already there refuses it too. Other runs write
-- nothing.
CREATE FUNCTION private.automation_record_given(r private.automation_runs,p_node text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE origin private.automation_events; appointment uuid; starts timestamptz; kind text; attempt smallint:=1;
  first_run uuid; first_state text;
BEGIN
  SELECT * INTO origin FROM private.automation_events e WHERE e.organization_id=r.organization_id AND e.id=r.event_id;
  IF origin.event_type IS DISTINCT FROM 'appointment_booked' THEN RETURN; END IF;
  appointment:=nullif(origin.subject->>'appointment_id','')::uuid;
  SELECT o.scheduled_start INTO starts FROM private.appointment_occurrences o
    WHERE o.organization_id=r.organization_id AND o.id=r.leased_for;
  SELECT CASE n->>'type' WHEN 'send_sms' THEN 'sms' WHEN 'send_email' THEN 'email' END INTO kind
    FROM public.workflow_versions v CROSS JOIN LATERAL jsonb_array_elements(v.graph->'nodes') n
    WHERE v.organization_id=r.organization_id AND v.workflow_id=r.workflow_id AND v.id=r.version_id AND n->>'id'=p_node;
  IF appointment IS NULL OR starts IS NULL OR kind IS NULL THEN
    RAISE EXCEPTION 'The appointment time of this message could not be recorded.';
  END IF;
  IF private.automation_step_record(r.organization_id,r.workflow_id,appointment,starts,p_node,r.id)='retry' THEN
    SELECT g.run_id INTO first_run FROM private.automation_given_steps g WHERE g.organization_id=r.organization_id
      AND g.workflow_id=r.workflow_id AND g.appointment_id=appointment AND g.starts_at=starts AND g.node_id=p_node
      AND g.attempt=1;
    BEGIN
      SELECT m.state INTO first_state FROM private.automation_messages m
        WHERE m.organization_id=r.organization_id AND m.run_id=first_run AND m.node_id=p_node FOR SHARE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION 'A receipt for the first attempt of this text is being recorded.';
    END;
    IF first_state='delivered' THEN
      RAISE EXCEPTION 'The first attempt of this text was delivered.';
    END IF;
    attempt:=2;
  END IF;
  INSERT INTO private.automation_given_steps(organization_id,workflow_id,appointment_id,starts_at,node_id,attempt,kind,
      run_id,slot_id,version_id)
    VALUES(r.organization_id,r.workflow_id,appointment,starts,p_node,attempt,kind,r.id,r.leased_for,r.version_id)
    ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This message was already given for this appointment time.';
  END IF;
END $$;

-- A signed SMS status callback: the provider's result is recorded on the message as before (automation_record_receipt),
-- and a failure is kept on the reminder record for the step as the provider reported it: the first failed callback as a
-- whole, its status and its error code (none when it sent none) and its time. A later failed callback changes nothing,
-- so it never adds a code the first one lacked. A late failure for a message already delivered changes nothing.
CREATE FUNCTION public.automation_record_provider_receipt(p_message uuid,p_org uuid,p_provider text,p_state text,
  p_at timestamptz,p_status text,p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.automation_record_receipt(p_message,'sms',p_provider,p_state,p_at,NULL,p_org);
  IF p_state='failed' THEN
    UPDATE private.automation_given_steps g SET failure_status=coalesce(g.failure_status,left(p_status,20)),
        failure_code=coalesce(g.failure_code,nullif(left(regexp_replace(coalesce(p_error_code,''),'[^0-9]','','g'),40),'')),
        failure_at=coalesce(g.failure_at,p_at)
      FROM private.automation_messages m
      WHERE m.id=p_message AND m.organization_id=p_org AND m.state='failed'
        AND g.organization_id=m.organization_id AND g.run_id=m.run_id AND g.node_id=m.node_id
        AND g.failure_at IS NULL;
  END IF;
END $$;

-- A lease covers one node. A run whose stop condition already happened ends here instead of running,
-- and the claim keeps looking, so a page of stopped runs never reads as an empty queue. A lease records
-- the appointment slot its facts describe, which the provider handoff checks again. A message about an appointment
-- that has moved since its reminder time, or that has already started, is skipped here rather than handed out.
CREATE OR REPLACE FUNCTION public.automation_claim_work(p_limit integer default 10)
returns setof jsonb language plpgsql security definer set search_path='' as $$
declare
  run private.automation_runs;
  graph jsonb;
  node jsonb;
  origin private.automation_events;
  slot_id uuid;
  slot_start timestamptz;
  calendar_start timestamptz;
  token uuid;
  previous_intent text;
  cutoff timestamptz := clock_timestamp();
  bounded integer := least(25,greatest(1,coalesce(p_limit,10)));
  leased integer := 0;
  examined integer := 0;
  fetched integer;
begin
  loop
    fetched:=0;
    for run in
      select r.* from private.automation_runs r
      join public.workflows w on w.id=r.workflow_id and w.organization_id=r.organization_id
      where w.status='active' and not r.workflow_paused and r.status in ('queued','waiting','held')
        and greatest(r.due_at,r.leased_until)<=cutoff
      order by greatest(r.due_at,r.leased_until),r.id limit bounded-leased for update of r skip locked
    loop
      fetched:=fetched+1;
      examined:=examined+1;
      if private.automation_settle_stop(run) then continue; end if;
      -- Its appointment moved after it gave a reminder, and admitting the new time will decide whether the
      -- automation starts again. Until then the run does nothing on the old time.
      if private.automation_awaits_restart(run) then
        update private.automation_runs set due_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp()
          where id=run.id;
        continue;
      end if;
      select v.graph into graph from public.workflow_versions v
        where v.id=run.version_id and v.organization_id=run.organization_id and v.workflow_id=run.workflow_id;
      select n into node from jsonb_array_elements(graph->'nodes') n where n->>'id'=run.current_node_id;
      select * into origin from private.automation_events ev where ev.id=run.event_id and ev.organization_id=run.organization_id;
      slot_id:=null;
      slot_start:=null;
      calendar_start:=null;
      if origin.event_type='appointment_booked' then
        select s.occurrence_id,s.starts_at into slot_id,slot_start
          from private.automation_appointment_state(run.organization_id,nullif(origin.subject->>'appointment_id','')::uuid) s;
        select a.start_time into calendar_start from public.appointments a
          where a.organization_id=run.organization_id and a.id=nullif(origin.subject->>'appointment_id','')::uuid;
        calendar_start:=coalesce(calendar_start,slot_start);
      end if;
      -- An appointment moved away and back to the time a reminder was for is still at that time, so the reminder still
      -- describes it: the run follows the slot the appointment is in now.
      if run.reminded_for is not null and slot_id is not null and run.reminded_for is distinct from slot_id
          and exists (select 1 from private.appointment_occurrences o where o.organization_id=run.organization_id
            and o.id=run.reminded_for and o.scheduled_start=slot_start) then
        if run.anchor_id is not distinct from run.reminded_for then run.anchor_id:=slot_id; run.anchor_at:=slot_start; end if;
        run.reminded_for:=slot_id;
      end if;
      token:=gen_random_uuid();
      update private.automation_runs set lease_token=token,leased_until=clock_timestamp()+interval '2 minutes',leased_for=slot_id,
          reminded_for=run.reminded_for,anchor_id=run.anchor_id,anchor_at=run.anchor_at
        where id=run.id;
      -- A message whose provider result arrived while its run was stopped (a cancellation before the receipt) is
      -- finished from that result when the run carries on, never handed out again: written again for another time,
      -- it could not replay the accepted request.
      if node->>'type' in ('send_sms','send_email') then
        select i.status into previous_intent from private.automation_intents i where i.organization_id=run.organization_id
          and i.run_id=run.id and i.node_id=run.current_node_id;
        if previous_intent in ('accepted','failed') then
          perform public.automation_finish_node(run.id,token,previous_intent,
            case previous_intent when 'failed' then 'The provider did not accept this message' end);
          continue;
        end if;
      end if;
      -- A reminder is written for the time it became due for. When the appointment has moved since and the
      -- automation is not starting again for the new time, that reminder is not sent, and the run goes on to
      -- its next step, which follows the current time. A message that may already be with a provider is
      -- reconciled instead.
      if node->>'type' in ('send_sms','send_email') and run.reminded_for is not null
          and run.reminded_for is distinct from slot_id
          and not exists (select 1 from private.automation_intents i where i.organization_id=run.organization_id
            and i.run_id=run.id and i.node_id=run.current_node_id and i.status<>'prepared') then
        perform public.automation_finish_node(run.id,token,'skipped','The appointment moved after this reminder was due');
        continue;
      end if;
      -- A message timed before its appointment is not sent once the appointment has started, as a reminder wait whose
      -- time passed is not: one held until then (by sending hours, a limit, a pause) is skipped, and the run goes on. So
      -- is any message for an appointment that now begins at or before its booking, or, for a booking whose appointment
      -- was reopened, at or before that reopening (any recorded one, after the start included), which admission and
      -- pacing count it from. Reopened after the start, the appointment gets nothing more, as when the worker saw the
      -- cancellation: a run is carried on only for a time still to come. Started means by the slot
      -- record and by the calendar alike: a move the slot record missed to a time still ahead (a capture gap) is held by
      -- the final check until the record catches up, never dropped here (automation_message_issue applies the same rule).
      if node->>'type' in ('send_sms','send_email') and origin.event_type='appointment_booked'
          and greatest(slot_start,calendar_start)<=clock_timestamp()
          and (coalesce(run.paced_from,origin.occurred_at)<least(slot_start,calendar_start)
            or greatest(slot_start,calendar_start)<=greatest(origin.occurred_at,private.automation_stood_again(
              run.organization_id,nullif(origin.subject->>'appointment_id','')::uuid,origin.occurred_at)))
          and not exists (select 1 from private.automation_intents i where i.organization_id=run.organization_id
            and i.run_id=run.id and i.node_id=run.current_node_id and i.status<>'prepared') then
        perform public.automation_finish_node(run.id,token,'skipped','The appointment had already started');
        continue;
      end if;
      previous_intent:=null;
      if node->>'type' in ('send_sms','send_email') then
        insert into private.automation_intents(organization_id,run_id,node_id,status)
          values(run.organization_id,run.id,run.current_node_id,'prepared') on conflict do nothing;
        select i.status into previous_intent from private.automation_intents i where i.run_id=run.id
          and i.node_id=run.current_node_id and i.organization_id=run.organization_id;
      end if;
      return next jsonb_build_object('organization_id',run.organization_id,'workflow_id',run.workflow_id,
        'version_id',run.version_id,'run_id',run.id,'contact_id',run.contact_id,'contact_type',run.contact_type,
        'lease_token',token,'node_id',run.current_node_id,'status',run.status,
        'due_lag_ms',greatest(0,round(extract(epoch from cutoff-run.due_at)*1000)),
        'uncertain_handoff',previous_intent='handed_off','stop_on_reply',graph#>'{settings,stop_on_reply}','graph',graph,
        'trigger',origin.event_type,
        'context',jsonb_strip_nulls(jsonb_build_object(
          'appointment_start',case origin.event_type
            when 'appointment_booked' then slot_start
            when 'appointment_outcome_recorded' then (select o.scheduled_start from private.appointment_occurrences o
              where o.organization_id=run.organization_id and o.id=nullif(origin.subject->>'occurrence_id','')::uuid) end,
          'agency_timezone',private.automation_agency_time_zone(run.organization_id),
          'caller_phone',origin.subject->>'caller_phone',
          'sms_purpose',(select p.purpose from private.automation_sms_purposes p
            where p.organization_id=run.organization_id and p.version_id=run.version_id and p.node_id=run.current_node_id))));
      leased:=leased+1;
    end loop;
    -- Leased and stopped runs no longer match, so another pass only sees work not yet examined.
    exit when fetched=0 or leased>=bounded or examined>=bounded*8;
  end loop;
end $$;

-- Persist the node outcome and graph advancement atomically. A stale lease cannot advance a run.
CREATE OR REPLACE FUNCTION public.automation_finish_node(p_run uuid,p_token uuid,p_result text,p_reason text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  r private.automation_runs;
  graph jsonb;
  node jsonb;
  origin private.automation_events;
  placed record;
  target text;
  next_status text;
  next_due timestamptz:=clock_timestamp();
  next_anchor uuid;
  next_anchor_at timestamptz;
  next_held_since timestamptz;
  next_reminded_for uuid;
  next_paced_from timestamptz;
  held_for interval;
  soon timestamptz;
  step_status text:=p_result;
  advance boolean:=false;
  branch text;
  kind text;
begin
  select * into r from private.automation_runs where id=p_run and lease_token=p_token for update;
  if not found or r.status not in ('queued','waiting','held') then return false; end if;
  select v.graph into graph from public.workflow_versions v where v.organization_id=r.organization_id
    and v.workflow_id=r.workflow_id and v.id=r.version_id;
  select n into strict node from jsonb_array_elements(graph->'nodes') n where n->>'id'=r.current_node_id;
  kind:=node->>'type';
  -- The slot a run last waited for stays on the run, so the same slot is never handled twice.
  next_anchor:=r.anchor_id;
  next_anchor_at:=r.anchor_at;
  next_reminded_for:=r.reminded_for;
  next_paced_from:=r.paced_from;
  -- Worker success alone cannot establish provider acceptance. The channel receipt
  -- transaction marks its original intent before normal or recovered advancement.
  if p_result='accepted' and kind in ('send_sms','send_email') and not exists(
    select 1 from private.automation_intents i where i.organization_id=r.organization_id
      and i.run_id=r.id and i.node_id=r.current_node_id and i.status='accepted'
  ) then
    if exists(select 1 from private.automation_intents i where i.organization_id=r.organization_id
      and i.run_id=r.id and i.node_id=r.current_node_id and i.status='handed_off') then
      p_result:='unknown';
      p_reason:='Awaiting confirmation of the original provider handoff';
    else
      p_result:='held';
      p_reason:='Verified handoff and provider receipt required';
    end if;
    step_status:=p_result;
  end if;
  if p_result='held' then
    -- A hold is retried after five minutes, then less often the longer it lasts (half the time held so
    -- far, at most six hours). A run held for seven days ends with the reason it was held.
    held_for:=case when r.status='held' and r.held_since is not null then clock_timestamp()-r.held_since else interval '0' end;
    if held_for>interval '7 days' then
      next_status:='stopped';
      step_status:='stopped';
      p_reason:='Stopped after 7 days on hold: '||coalesce(p_reason,'no reason given');
    else
      next_status:='held';
      next_held_since:=case when r.status='held' then coalesce(r.held_since,clock_timestamp()) else clock_timestamp() end;
      next_due:=next_due+least(interval '6 hours',greatest(interval '5 minutes',held_for/2));
      -- A message about an appointment still to come is tried again before it starts when the usual retry would come
      -- after: halfway to the start, at most every thirty seconds. A hold a minute before the appointment (a calendar
      -- save in progress) then still sends, instead of reaching the start and being skipped.
      if kind in ('send_sms','send_email') then
        select * into origin from private.automation_events ev where ev.id=r.event_id and ev.organization_id=r.organization_id;
        if origin.event_type='appointment_booked' then
          select s.starts_at into soon from private.automation_appointment_state(r.organization_id,
            nullif(origin.subject->>'appointment_id','')::uuid) s;
          if soon>clock_timestamp() and next_due>=soon then
            next_due:=clock_timestamp()+greatest(interval '30 seconds',(soon-clock_timestamp())/2);
          end if;
        end if;
      end if;
    end if;
  elsif p_result in ('failed','unknown') then
    next_status:=p_result;
    next_due:=next_due+interval '5 minutes';
  elsif kind='create_task' and p_result='stopped' then
    next_status:='stopped';
  elsif kind='wait' and p_result='wait' and r.status<>'waiting' then
    next_status:='waiting';
    next_due:=next_due+(node#>>'{config,duration}')::integer *
      case node#>>'{config,unit}' when 'minutes' then interval '1 minute' when 'hours' then interval '1 hour'
        when 'days' then interval '1 day' end;
  elsif kind='wait_until_before_appointment' and p_result in ('wait','elapsed') then
    select * into origin from private.automation_events ev where ev.id=r.event_id and ev.organization_id=r.organization_id;
    select * into placed from private.automation_appointment_wait(r.organization_id,
      nullif(origin.subject->>'appointment_id','')::uuid,node);
    if placed.verdict='gone' then
      next_status:='stopped';
      step_status:='stopped';
      p_reason:='Appointment was removed';
    elsif r.status='waiting' and r.due_at<=clock_timestamp() and placed.verdict<>'past'
      and placed.anchor is not distinct from r.anchor_id and placed.anchor_start is not distinct from r.anchor_at then
      -- The wait this run was given has elapsed and the appointment still stands at the same time.
      advance:=true;
      step_status:='elapsed';
      next_reminded_for:=r.anchor_id;
      next_paced_from:=r.due_at;
    elsif placed.verdict='wait' then
      -- First arrival, or the appointment moved while this run slept: wait for the current time.
      next_status:='waiting';
      next_due:=placed.due;
      next_anchor:=placed.anchor;
      next_anchor_at:=placed.anchor_start;
      step_status:='wait';
    elsif placed.verdict='advance' then
      advance:=true;
      next_anchor:=placed.anchor;
      next_anchor_at:=placed.anchor_start;
      next_reminded_for:=placed.anchor;
      -- The reminder time passed before the run reached it: later steps count from the reminder time,
      -- or from the event when the event came after it.
      next_paced_from:=greatest(r.paced_from,placed.due);
      step_status:='elapsed';
      p_reason:='The reminder time had already passed';
    elsif placed.verdict='skip' and private.automation_caught_up(r,node,placed.anchor_start) then
      -- Another run of the automation already gave this reminder for this appointment time: the run goes on to the
      -- next reminder instead of ending at the passed wait (the reminder record skips what was given).
      advance:=true;
      next_anchor:=placed.anchor;
      next_anchor_at:=placed.anchor_start;
      next_reminded_for:=placed.anchor;
      next_paced_from:=greatest(r.paced_from,placed.due);
      step_status:='elapsed';
      p_reason:='Already reached for this appointment time';
    else
      next_status:='completed';
      next_anchor:=placed.anchor;
      next_anchor_at:=placed.anchor_start;
      step_status:='skipped';
      p_reason:=case placed.verdict when 'past' then 'The appointment had already started'
        else 'The reminder time had already passed' end;
    end if;
  elsif kind='wait' and p_result='elapsed' and r.status='waiting' and r.due_at<=clock_timestamp() then
    -- Later steps count from the end this wait was given, however late the worker reached it.
    advance:=true;
    next_paced_from:=r.due_at;
  elsif (kind in ('send_sms','send_email') and p_result in ('accepted','skipped'))
    or (kind='create_task' and p_result in ('created','skipped'))
    or (kind='contact_has_email' and p_result in ('yes','no','skipped')) then
    advance:=true;
  else raise exception 'Invalid automation node outcome'; end if;

  if advance then
    -- A condition without a contact has no email, so it follows the No branch.
    branch:=case when kind='contact_has_email' then case p_result when 'yes' then 'yes' else 'no' end end;
    select edge->>'target' into target from jsonb_array_elements(graph->'edges') edge
      where edge->>'source'=r.current_node_id and edge->>'branch' is not distinct from branch;
    next_status:=case when target is null then 'completed' else 'queued' end;
  end if;

  if kind in ('send_sms','send_email') and p_result in ('accepted','failed','unknown') then
    update private.automation_intents set status=p_result where organization_id=r.organization_id
      and run_id=p_run and node_id=r.current_node_id;
  end if;
  insert into private.automation_steps(organization_id,run_id,node_id,status,reason)
    values(r.organization_id,p_run,r.current_node_id,step_status,left(p_reason,500))
    on conflict (run_id,node_id) do update set status=excluded.status,reason=excluded.reason,updated_at=clock_timestamp();
  update private.automation_runs set current_node_id=coalesce(target,r.current_node_id),status=next_status,
    reason=left(p_reason,500),due_at=next_due,anchor_id=next_anchor,anchor_at=next_anchor_at,held_since=next_held_since,
    reminded_for=next_reminded_for,paced_from=next_paced_from,
    lease_token=null,leased_until=null,updated_at=clock_timestamp(),
    ended_at=case when next_status in ('completed','failed','unknown','stopped') then clock_timestamp() end
    where id=p_run;
  return true;
end $$;

-- What would keep a leased message from going out now, or null. Nothing that ends the run has happened since the
-- lease, and a message about a booking still describes the appointment's current time: the time of the slot its
-- lease's facts came from, and of the slot its reminders were for, is the appointment's time now. The calendar itself
-- shows that time too: a move whose slot record could not be written in time (a capture gap, repaired by the
-- appointment's next save) holds the message until the record catches up, and a calendar row that is gone shows no
-- time, so the message is never sent (automation_stop_check ends the run). While the appointment is still ahead and
-- its current slot holds an outcome other than a retraction (No Show or Completed recorded before the start), the
-- booking is not eligible, as admission requires: the message is held, not sent. A person's outcome stands over a
-- later save by the calendar sync (automation_appointment_state), so the message stays held while the calendar shows
-- Scheduled. Taken back before the start, the message goes out on a later lease. Otherwise it stays held until the
-- appointment starts, and the started rule then decides. The hold's seven-day limit ends the run only when the message
-- is held that long before the start, and the run then takes none of its later steps; an outcome taken back after that,
-- still before the start, by a save the worker is told about, lets the cancellation carry-on
-- (automation_refresh_appointment_runs) carry the run on at a time it followed (for a run that has not reached an
-- appointment wait, also the time the appointment stood at when the hold ended it, unless another booking run of the
-- automation holds that time), so the held message goes out then. Once the appointment has started an outcome is
-- expected and the started rule decides, whatever outcome the slot holds: a message timed before the appointment is not
-- sent once it has started by both the slot record and the calendar, nor is any message for an appointment that now
-- begins at or before its booking (for a reopened booking, its latest recorded reopening, one after the start
-- included), and a follow-up timed after the start goes out.
-- After every check above, a booking's message also answers to the reminder record for its step at this appointment
-- time (automation_step_record), so a time gets each reminder once across runs. A refusal from the record starts with
-- 'skip:': the worker finishes the step as skipped and goes on, rather than holding it. Given already, failed for good
-- or retried once: skipped. Owed its one retry: sent, while the retry window is open (automation_retry_open), else
-- skipped; a text the provider rate-limited is held until a minute has passed. Before that, a stop of another booking run
-- of the automation for the appointment made since this lease holds the message, and the next lease's full check
-- decides (automation_time_stopped, in automation_message_check). This runs under the handoff lock: index lookups only.
-- A step no run gave that is late in a segment the run caught up through is decided before the lock
-- (automation_late_in_segment, in automation_message_check): what it reads (the run's version's graph, its own steps,
-- the slots its reminders and its lease are for and their start times) does not change while the run holds its lease.
CREATE FUNCTION private.automation_message_issue(r private.automation_runs)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE origin private.automation_events; reason text; appointment uuid; current_slot uuid; slot_start timestamptz; booked_start timestamptz;
  outcome text; recorded text;
BEGIN
  SELECT s.stop_reason INTO reason FROM private.automation_stop_check(r) s WHERE s.stop_reason IS NOT NULL LIMIT 1;
  IF reason IS NOT NULL THEN RETURN reason; END IF;
  SELECT * INTO origin FROM private.automation_events e WHERE e.organization_id=r.organization_id AND e.id=r.event_id;
  IF origin.event_type IS DISTINCT FROM 'appointment_booked' THEN RETURN NULL; END IF;
  appointment:=nullif(origin.subject->>'appointment_id','')::uuid;
  SELECT s.occurrence_id,s.starts_at,s.head_outcome INTO current_slot,slot_start,outcome
    FROM private.automation_appointment_state(r.organization_id,appointment) s;
  IF current_slot IS NOT NULL AND coalesce(outcome,'retracted')<>'retracted' AND slot_start>clock_timestamp() THEN
    RETURN 'The appointment has an outcome recorded';
  END IF;
  SELECT a.start_time INTO booked_start FROM public.appointments a WHERE a.organization_id=r.organization_id AND a.id=appointment;
  IF current_slot IS NULL
      OR NOT EXISTS (SELECT 1 FROM private.appointment_occurrences o WHERE o.organization_id=r.organization_id
        AND o.id=r.leased_for AND o.scheduled_start=slot_start)
      OR (r.reminded_for IS NOT NULL AND NOT EXISTS (SELECT 1 FROM private.appointment_occurrences o
        WHERE o.organization_id=r.organization_id AND o.id=r.reminded_for AND o.scheduled_start=slot_start)) THEN
    RETURN 'The appointment moved after this message was prepared';
  END IF;
  -- Started by the slot record and the calendar alike: a message timed before the appointment, or any message for an
  -- appointment that now begins at or before its booking or its reopening, is not sent (the claim skips it by the same
  -- rule).
  IF greatest(slot_start,booked_start)<=clock_timestamp() AND (coalesce(r.paced_from,origin.occurred_at)<least(slot_start,booked_start)
      OR greatest(slot_start,booked_start)<=greatest(origin.occurred_at,
        private.automation_stood_again(r.organization_id,appointment,origin.occurred_at))) THEN
    RETURN 'The appointment had already started';
  END IF;
  IF booked_start IS DISTINCT FROM slot_start THEN
    RETURN 'The appointment''s new time is not recorded yet';
  END IF;
  -- Another booking run of the automation for this appointment was stopped by a person or a stop rule since this lease
  -- began (its stop's own time, or when it was recorded): held, and the next lease's full check decides.
  IF EXISTS (SELECT 1 FROM private.automation_events b
      JOIN private.automation_runs x ON x.organization_id=b.organization_id AND x.event_id=b.id
    WHERE b.organization_id=r.organization_id AND b.subject ? 'appointment_id'
      AND b.subject->>'appointment_id'=origin.subject->>'appointment_id' AND b.event_type='appointment_booked'
      AND x.workflow_id=r.workflow_id AND x.id<>r.id AND x.status='stopped'
      AND x.reason IN ('Stopped by user','Verified reply received','Contact was reached','Appointment booked')
      AND greatest(x.ended_at,x.updated_at)>=r.leased_until-interval '2 minutes') THEN
    RETURN 'A run of this automation for this appointment was stopped just now';
  END IF;
  recorded:=private.automation_step_record(r.organization_id,r.workflow_id,appointment,slot_start,r.current_node_id,r.id);
  IF recorded='given' THEN RETURN 'skip:Already sent for this appointment time'; END IF;
  IF recorded='permanent' THEN
    RETURN 'skip:Not sent again: delivery failed for this appointment time and cannot be retried';
  END IF;
  IF recorded='retried' THEN RETURN 'skip:Not sent again: already retried once for this appointment time'; END IF;
  IF recorded IN ('retry','retry_wait') AND NOT private.automation_retry_open(r,r.current_node_id,slot_start) THEN
    RETURN 'skip:Not retried: the next reminder for this appointment time is already due';
  END IF;
  IF recorded='retry_wait' THEN RETURN 'Waiting before retrying a text the provider rate-limited'; END IF;
  RETURN NULL;
END $$;

-- Asked by the worker before it reserves a provider request, so a change already made holds the message without
-- spending that request. Only an answer sooner: the handoff checks again under lock. A message already handed to a
-- provider is left to its own record, so a replay still finds its original receipt. Null sends it; an answer starting
-- 'skip:' finishes the step as skipped with the rest as its reason; 'retry:' sends a text owed its one retry; any other
-- answer holds it. For a booking, the full stop check runs here, before the lock: a person's stop or a stop rule's end
-- of another booking run of the automation for the appointment holds the times that run followed
-- (automation_time_stopped), also after the appointment moved away and back. A retry is not sent to a lead whose number
-- is now suppressed or on the do-not-call list; the run goes on. A step the record has nothing for at this time that is
-- late in a segment the run caught up through (automation_late_in_segment) is skipped as its time passed: the handoff
-- does not ask again, since none of what that reads (the run's version's graph, its own steps, the slots its reminders
-- and its lease are for, and their start times) changes while the run holds its lease, and the handoff reads the record
-- itself again (automation_message_issue).
CREATE FUNCTION public.automation_message_check(p_run uuid,p_token uuid,p_node text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.automation_runs; origin private.automation_events; answer text; slot_start timestamptz;
  stopped text; destination text; recorded text;
BEGIN
  IF EXISTS (SELECT 1 FROM private.automation_intents i WHERE i.run_id=p_run AND i.node_id=p_node
      AND i.status<>'prepared') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO r FROM private.automation_runs x WHERE x.id=p_run AND x.lease_token=p_token AND x.current_node_id=p_node
    AND x.leased_until>=clock_timestamp() AND x.status IN ('queued','held','waiting');
  IF NOT FOUND THEN RETURN 'This step is no longer leased to this worker'; END IF;
  answer:=private.automation_message_issue(r);
  IF answer IS NOT NULL THEN RETURN answer; END IF;
  SELECT * INTO origin FROM private.automation_events e WHERE e.organization_id=r.organization_id AND e.id=r.event_id;
  IF origin.event_type IS DISTINCT FROM 'appointment_booked' THEN RETURN NULL; END IF;
  SELECT o.scheduled_start INTO slot_start FROM private.appointment_occurrences o
    WHERE o.organization_id=r.organization_id AND o.id=r.leased_for;
  stopped:=private.automation_time_stopped(r,slot_start);
  IF stopped='person' THEN RETURN 'skip:Stopped by a person for this appointment time'; END IF;
  IF stopped='rule' THEN RETURN 'skip:Stopped by a stop rule for this appointment time'; END IF;
  recorded:=private.automation_step_record(r.organization_id,r.workflow_id,nullif(origin.subject->>'appointment_id','')::uuid,
    slot_start,p_node,r.id);
  IF recorded='retry' THEN
    -- A confirmed opt-out recorded here (a suppression or a do-not-call entry for the lead's current number). A number
    -- that cannot be normalized is not one: the sending path refuses it and holds the text.
    SELECT l.phone INTO destination FROM public.leads l
      WHERE r.contact_type='lead' AND l.organization_id=r.organization_id AND l.id=r.contact_id;
    BEGIN
      destination:=private.affinity_phone(destination);
    EXCEPTION WHEN OTHERS THEN
      destination:=NULL;
    END;
    IF destination IS NOT NULL AND private.sms_recipient_guard(r.organization_id,destination) THEN
      RETURN 'skip:Not retried: the lead can no longer receive this message';
    END IF;
    RETURN 'retry:';
  END IF;
  IF recorded='none' AND private.automation_late_in_segment(r,p_node) THEN
    RETURN 'skip:The reminder time had already passed';
  END IF;
  RETURN NULL;
END $$;

-- Linearize the last local authorization against pause, stop, revocation and release gates, and against the
-- appointment the message is about (automation_message_issue). The appointment row is share-locked before it is
-- read, so a move or cancellation either committed first and refuses the handoff, or waits until the handoff is
-- recorded. Saves of the appointment still in progress are waited out for at most half a second in all, by trying the
-- lock again every 20 ms without queueing for it, so short ones commit and the check sees what they changed. Longer
-- ones refuse the handoff without spending the provider request (automation_release_refused_dispatch): the worker
-- holds the message, and the next lease sends it if it is still due. The worker never queues for the lock, so a
-- calendar save never waits behind a handoff that is still trying. Once the handoff holds the lock, a save of that
-- appointment waits until the handoff's transaction commits. In automation_begin_message that transaction also starts
-- a text's dispatch (the recipient's sending lock and its dispatch row) and records the message: keep nothing slow
-- after this lock. The handoff of a booking run's message is noted in the reminder record for its appointment time
-- (automation_record_given): a refusal from the record (already given, or a second run reaching the same reminder) is
-- a refusal here, and the workflow row this takes for update orders the handoffs of an automation, so the run that
-- loses sees the winner's record and is skipped.
CREATE OR REPLACE FUNCTION public.automation_authorize_handoff(p_run uuid,p_token uuid,p_node text)
returns boolean language plpgsql security definer set search_path='' as $$
declare scope record; run private.automation_runs; origin private.automation_events; deadline timestamptz;
begin
  select r.organization_id,r.workflow_id,v.published_by,e.campaign_id into scope
    from private.automation_runs r
    join public.workflows w on w.id=r.workflow_id and w.organization_id=r.organization_id
    join public.workflow_versions v on v.id=r.version_id and v.workflow_id=w.id and v.organization_id=w.organization_id
    join private.automation_events e on e.id=r.event_id and e.organization_id=r.organization_id
    join private.automation_release_controls ctl on ctl.organization_id=w.organization_id
    where r.id=p_run and r.lease_token=p_token and r.current_node_id=p_node and r.leased_until>=clock_timestamp()
      and r.status in ('queued','held','waiting') and w.status='active' and ctl.dispatch_enabled
    for update of w,r for share of ctl;
  if not found or not private.automation_audience_allowed(scope.organization_id,scope.published_by,scope.campaign_id)
    then return false; end if;
  select * into run from private.automation_runs where id=p_run;
  select * into origin from private.automation_events ev where ev.id=run.event_id and ev.organization_id=run.organization_id;
  if origin.event_type in ('appointment_booked','appointment_outcome_recorded') then
    deadline:=clock_timestamp()+interval '500 milliseconds';
    loop
      begin
        perform 1 from public.appointments a where a.organization_id=run.organization_id
          and a.id=nullif(origin.subject->>'appointment_id','')::uuid for share nowait;
        exit;
      exception when lock_not_available then
        if clock_timestamp()>=deadline then return false; end if;
        perform pg_sleep(0.02);
      end;
    end loop;
  end if;
  if private.automation_message_issue(run) is not null then return false; end if;
  update private.automation_intents set status='handed_off'
    where organization_id=scope.organization_id and run_id=p_run and node_id=p_node and status='prepared';
  if not found then return false; end if;
  perform private.automation_record_given(run, p_node);
  return true;
end $$;

-- A text refused before its handoff can try again on a later lease. The sticky sending path cancels a reservation that
-- a refusal left unsent (sms_cancel_prepared_dispatch), and a step's request key never changes, so a cancelled
-- reservation would otherwise keep the step from ever sending: a reminder refused for sending hours, a daily limit,
-- delivery being off, a stale reply feed or a calendar save in progress. The worker holding the step's lease clears
-- it before it reserves again, and only a reservation no provider has seen: cancelled before any handoff, with no
-- provider message, no message written for the step and an intent never handed off. A reservation in any other state,
-- or none, is left to the sending path, which never sends it twice and finds a replay's own receipt.
CREATE FUNCTION public.automation_release_refused_dispatch(p_run uuid,p_token uuid,p_node text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.automation_runs; d public.sms_dispatches; request text:='automation:'||p_run::text||':'||p_node;
BEGIN
  SELECT * INTO r FROM private.automation_runs WHERE id=p_run;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO d FROM public.sms_dispatches WHERE organization_id=r.organization_id AND request_key=request;
  IF NOT FOUND OR d.state<>'failed' OR d.error_code IS DISTINCT FROM 'pre_handoff_cancelled' THEN RETURN true; END IF;
  IF r.lease_token IS DISTINCT FROM p_token OR r.current_node_id IS DISTINCT FROM p_node
      OR r.leased_until<clock_timestamp() OR r.status NOT IN ('queued','held','waiting') THEN RETURN false; END IF;
  -- The recipient's lock, as the sending path takes it before it cancels or starts a reservation.
  PERFORM private.affinity_lock(r.organization_id,d.phone_e164);
  DELETE FROM public.sms_dispatches s WHERE s.organization_id=r.organization_id AND s.request_key=request
    AND s.state='failed' AND s.error_code='pre_handoff_cancelled' AND s.provider_sid IS NULL AND s.message_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM private.automation_messages m WHERE m.organization_id=r.organization_id
      AND m.run_id=p_run AND m.node_id=p_node)
    AND EXISTS (SELECT 1 FROM private.automation_intents i WHERE i.organization_id=r.organization_id
      AND i.run_id=p_run AND i.node_id=p_node AND i.status='prepared');
  RETURN true;
END $$;

-- Create the task for a "Create task" step exactly once. The worker supplies the rendered text.
-- The database decides who it is for, when it is due and whether it should exist at all. A booking run's task is
-- created once for its appointment time across runs (the reminder record, keyed by the start of the slot its lease
-- verified, else the appointment's current one): one already created there, a time a person's stop or a stop rule's end
-- of another booking run holds, and a task late in a segment the run caught up through are skipped. The record's row
-- is written just before the task, and a second run creating the same one at the same moment waits for it and skips.
CREATE FUNCTION public.automation_create_task(p_run uuid,p_token uuid,p_node text,p_title text,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.automation_runs; published record; node jsonb; cfg jsonb; origin private.automation_events;
  title text:=left(btrim(coalesce(p_title,'')),200); notes text:=nullif(left(btrim(coalesce(p_notes,'')),2000),'');
  kind text; owner_id uuid; claimant uuid; due timestamptz; made uuid; inbound uuid; evidence text; known boolean;
  appointment uuid; slot uuid; starts timestamptz; stopped text; keyed boolean:=false; recorded boolean;
BEGIN
  SELECT run.* INTO r FROM private.automation_runs run WHERE run.id=p_run;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','held','reason','Run is unavailable'); END IF;
  -- Workflow before run, the same order a pause takes, so a pause never waits behind this step.
  PERFORM 1 FROM public.workflows w WHERE w.id=r.workflow_id AND w.organization_id=r.organization_id
    AND w.status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','held','reason','Workflow is not active'); END IF;
  SELECT run.* INTO r FROM private.automation_runs run WHERE run.id=p_run AND run.lease_token=p_token
    AND run.current_node_id=p_node AND run.leased_until>=clock_timestamp()
    AND run.status IN ('queued','held','waiting') AND NOT run.workflow_paused FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','held','reason','Run no longer permits this step'); END IF;
  SELECT v.graph,v.published_by INTO published FROM public.workflow_versions v
    WHERE v.organization_id=r.organization_id AND v.workflow_id=r.workflow_id AND v.id=r.version_id;
  SELECT n INTO node FROM jsonb_array_elements(published.graph->'nodes') n WHERE n->>'id'=p_node AND n->>'type'='create_task';
  IF NOT FOUND THEN RAISE EXCEPTION 'Published task step changed.'; END IF;
  cfg:=node->'config';
  SELECT * INTO origin FROM private.automation_events ev WHERE ev.id=r.event_id AND ev.organization_id=r.organization_id;
  IF NOT private.automation_audience_allowed(r.organization_id,published.published_by,origin.campaign_id) THEN
    RETURN jsonb_build_object('status','held','reason','Publisher no longer has authority over this audience'); END IF;
  -- A replayed or re-leased step finds its own record and creates nothing more.
  IF EXISTS (SELECT 1 FROM private.automation_task_receipts x WHERE x.run_id=r.id AND x.node_id=p_node) THEN
    RETURN jsonb_build_object('status','created'); END IF;
  -- Turning enrollment off stops automation output for the agency, the way turning message delivery off
  -- stops messages. An operator's change waits for this step, or this step sees the change.
  PERFORM 1 FROM private.automation_release_controls c WHERE c.organization_id=r.organization_id AND c.enrollment_enabled FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','held','reason','Automations are turned off for this agency'); END IF;
  IF private.automation_settle_stop(r) THEN
    RETURN jsonb_build_object('status','stopped','reason',(SELECT run.reason FROM private.automation_runs run WHERE run.id=r.id));
  END IF;
  IF origin.event_type='appointment_booked' THEN
    appointment:=nullif(origin.subject->>'appointment_id','')::uuid;
    SELECT o.id,o.scheduled_start INTO slot,starts FROM private.appointment_occurrences o
      WHERE o.organization_id=r.organization_id AND o.id=r.leased_for;
    IF starts IS NULL THEN
      SELECT s.occurrence_id,s.starts_at INTO slot,starts FROM private.automation_appointment_state(r.organization_id,appointment) s;
    END IF;
    IF appointment IS NOT NULL AND starts IS NOT NULL THEN
      IF private.automation_step_record(r.organization_id,r.workflow_id,appointment,starts,p_node,r.id)<>'none' THEN
        RETURN jsonb_build_object('status','skipped','reason','Already created for this appointment time'); END IF;
      stopped:=private.automation_time_stopped(r,starts);
      IF stopped='person' THEN
        RETURN jsonb_build_object('status','skipped','reason','Stopped by a person for this appointment time'); END IF;
      IF stopped='rule' THEN
        RETURN jsonb_build_object('status','skipped','reason','Stopped by a stop rule for this appointment time'); END IF;
      IF private.automation_late_in_segment(r,p_node) THEN
        RETURN jsonb_build_object('status','skipped','reason','The reminder time had already passed'); END IF;
      keyed:=true;
    END IF;
  END IF;
  -- Fields that render to nothing (an unmatched caller, a contact without a name) still give the task
  -- a title: the step's name, the caller for a missed call, or the task type.
  IF title='' THEN
    title:=left(coalesce(nullif(btrim(node#>>'{meta,name}'),''),
      CASE WHEN origin.event_type='inbound_call_missed' THEN 'Call back '||coalesce(nullif(origin.subject->>'caller_phone',''),'the caller') END,
      cfg->>'task_type','Follow Up'),200);
  END IF;
  -- Due a set time after the moment this step counts from: the event for a step with no wait before it, or
  -- the end the last wait was given. A worker that reaches the step late, a hold or a replay leaves it unchanged.
  due:=coalesce(r.paced_from,clock_timestamp())+(cfg->>'due_amount')::integer * CASE cfg->>'due_unit'
    WHEN 'minutes' THEN interval '1 minute' WHEN 'hours' THEN interval '1 hour' ELSE interval '1 day' END;
  known:=r.contact_id IS NOT NULL
    AND private.automation_contact_type(r.organization_id,r.contact_id) IS NOT DISTINCT FROM r.contact_type;

  IF origin.event_type='inbound_call_missed' THEN
    inbound:=nullif(origin.subject->>'call_id','')::uuid;
    -- Every writer of an answer updates or locks this call row, so an answer is ordered against this step: either it
    -- committed first and is read below, or it waits for this step to commit and automation_settle_answered_call then
    -- closes what this step made.
    PERFORM 1 FROM public.calls c WHERE c.organization_id=r.organization_id AND c.id=inbound FOR SHARE;
    evidence:=private.automation_inbound_evidence(r.organization_id,inbound);
    IF evidence='unknown' THEN RETURN jsonb_build_object('status','stopped','reason','Call record no longer exists'); END IF;
    IF evidence='answered' THEN RETURN jsonb_build_object('status','stopped','reason','Call was answered'); END IF;
    IF evidence='ambiguous' THEN
      RETURN jsonb_build_object('status','held','reason','Waiting for confirmation of whether the call was answered'); END IF;
    IF evidence='conflicting' THEN
      RETURN jsonb_build_object('status','held','reason','The call''s answer records disagree. Waiting until they agree'); END IF;
    IF evidence<>'missed' THEN
      RETURN jsonb_build_object('status','held','reason','Waiting for confirmation of whether the call was answered'); END IF;
    -- At most one callback per inbound call, whichever automation reaches it first.
    PERFORM pg_advisory_xact_lock(hashtextextended('automation-callback:'||inbound::text,0));
    IF EXISTS (SELECT 1 FROM private.automation_task_receipts x
        WHERE x.organization_id=r.organization_id AND x.scope_key='call:'||inbound::text) THEN
      RETURN jsonb_build_object('status','skipped','reason','A callback already exists for this call'); END IF;
    -- A known caller's task belongs to the contact's own active agent, like every automation task.
    IF known THEN owner_id:=private.automation_contact_owner(r.organization_id,r.contact_type,r.contact_id); END IF;
    IF owner_id IS NULL THEN
      -- The caller is not a contact, or the contact has no active agent: the callback waits in Inbounds,
      -- already claimed by the agent the call was for (the direct line dialed, or a recent outbound call)
      -- when there is one. The list shows a contact's name, and title and notes rendered for the contact,
      -- only to people who can see the contact.
      claimant:=private.automation_inbound_responsible(r.organization_id,inbound,NULL,NULL);
      INSERT INTO public.inbound_callbacks(organization_id,call_id,run_id,caller_phone,contact_id,contact_type,title,notes,due_at,
          status,claimed_by,claimed_at)
        VALUES(r.organization_id,inbound,r.id,nullif(origin.subject->>'caller_phone',''),
          CASE WHEN known THEN r.contact_id END,CASE WHEN known THEN r.contact_type END,title,notes,due,
          CASE WHEN claimant IS NULL THEN 'open' ELSE 'claimed' END,claimant,
          CASE WHEN claimant IS NOT NULL THEN clock_timestamp() END)
        ON CONFLICT (call_id) DO NOTHING RETURNING id INTO made;
      IF made IS NULL THEN
        RETURN jsonb_build_object('status','skipped','reason','A callback already exists for this call'); END IF;
      INSERT INTO private.automation_task_receipts(organization_id,run_id,node_id,workflow_id,scope_key,kind,record_id)
        VALUES(r.organization_id,r.id,p_node,r.workflow_id,'call:'||inbound::text,'callback',made);
      RETURN jsonb_build_object('status','created');
    END IF;
  ELSE
    IF r.contact_id IS NULL THEN
      RETURN jsonb_build_object('status','skipped','reason','This run has no matched contact'); END IF;
    IF NOT known THEN
      RETURN jsonb_build_object('status','stopped','reason',CASE WHEN r.contact_type='lead' AND EXISTS (
          SELECT 1 FROM public.clients c WHERE c.organization_id=r.organization_id AND c.lead_id=r.contact_id)
        THEN 'Lead converted to client' ELSE 'Contact no longer exists' END); END IF;
    owner_id:=private.automation_contact_owner(r.organization_id,r.contact_type,r.contact_id);
    IF owner_id IS NULL THEN
      RETURN jsonb_build_object('status','held','reason','Contact has no active assigned agent'); END IF;
    -- A repeated trigger does not stack a second task on the agent while their earlier one is still open.
    -- A task left with an agent the contact no longer belongs to does not hold back the current agent's.
    IF EXISTS (SELECT 1 FROM private.automation_task_receipts x
        JOIN public.tasks t ON t.id=x.record_id AND t.organization_id=x.organization_id
        WHERE x.organization_id=r.organization_id AND x.workflow_id=r.workflow_id AND x.node_id=p_node AND x.kind='task'
          AND x.scope_key IS NOT DISTINCT FROM r.scope_key AND x.run_id<>r.id AND t.completed_at IS NULL
          AND t.assigned_to=owner_id) THEN
      RETURN jsonb_build_object('status','skipped','reason','An earlier task from this automation is still open'); END IF;
  END IF;

  IF keyed THEN
    INSERT INTO private.automation_given_steps(organization_id,workflow_id,appointment_id,starts_at,node_id,attempt,kind,
        run_id,slot_id,version_id)
      VALUES(r.organization_id,r.workflow_id,appointment,starts,p_node,1,'task',r.id,slot,r.version_id)
      ON CONFLICT DO NOTHING RETURNING true INTO recorded;
    IF recorded IS NULL THEN
      RETURN jsonb_build_object('status','skipped','reason','Already created for this appointment time'); END IF;
  END IF;
  INSERT INTO public.tasks(organization_id,contact_id,contact_type,assigned_to,created_by,title,task_type,due_date,notes,
      all_day,automation_run_id)
    VALUES(r.organization_id,r.contact_id,r.contact_type,owner_id,NULL,title,cfg->>'task_type',due,notes,false,r.id)
    RETURNING id INTO made;
  INSERT INTO private.automation_task_receipts(organization_id,run_id,node_id,workflow_id,scope_key,kind,record_id)
    VALUES(r.organization_id,r.id,p_node,r.workflow_id,
      CASE WHEN origin.event_type='inbound_call_missed' THEN 'call:'||inbound::text ELSE r.scope_key END,'task',made);
  RETURN jsonb_build_object('status','created');
END $$;

-- The verified zone an automated message to this recipient is written in. The recipient is normalized
-- the way the handoff normalizes it (E.164 for a phone, trimmed lower case for an email), so a lead
-- phone stored as 11 digits finds the same eligibility record the handoff requires.
CREATE FUNCTION public.automation_message_timezone(p_run uuid,p_channel text,p_recipient text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE wanted text;
BEGIN
  IF p_channel='sms' THEN
    BEGIN wanted:=private.affinity_phone(p_recipient);
    EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
  ELSE wanted:=lower(btrim(p_recipient)); END IF;
  RETURN (SELECT f.timezone_name FROM private.automation_runs r JOIN private.automation_recipient_facts f
      ON f.organization_id=r.organization_id AND f.contact_id=r.contact_id AND f.contact_type=r.contact_type
    WHERE r.id=p_run AND f.channel=p_channel AND f.destination=wanted AND f.valid_until>clock_timestamp()
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=f.timezone_name)
    LIMIT 1);
END $$;

CREATE OR REPLACE FUNCTION public.automation_activity(p_session_revision bigint,p_viewer_id uuid,p_workflow uuid default null,p_contact uuid default null,p_type text default null,
  p_before_at timestamptz default null,p_before_run uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  viewer uuid:=private.automation_viewer_id();
  visible_org uuid;
  may_stop boolean;
  agency_wide boolean;
  activity jsonb;
begin
  if viewer is distinct from p_viewer_id or not exists (
    select 1 from private.automation_sessions s where s.session_id=private.automation_session_id()
      and s.actor_id=auth.uid() and s.revision=p_session_revision
  ) then raise exception 'Automation activity viewer changed' using errcode='42501'; end if;
  if (p_before_at is null) <> (p_before_run is null) then
    raise exception 'Incomplete activity cursor' using errcode='22023'; end if;
  select p.organization_id,(p.role='Admin' or p.is_super_admin is true) into visible_org,agency_wide
    from public.profiles p join private.automation_release_controls c
    on c.organization_id=p.organization_id and c.builder_visible where p.id=viewer and p.status='Active';
  may_stop:=viewer=auth.uid() and private.automation_can_author(visible_org);
  select coalesce(jsonb_agg(to_jsonb(item) order by item.updated_at desc,item.run_id desc),'[]'::jsonb) into activity from (
    select r.id run_id,r.version_id,r.workflow_id,v.name workflow_name,r.contact_id,r.contact_type,
      coalesce(person.name,case when r.contact_id is null then nullif(origin.subject->>'caller_phone','') end) contact_name,
      r.current_node_id node_id,
      case when r.workflow_paused and r.status in ('waiting','held','queued') then 'paused' else r.status end status,
      case when r.workflow_paused and r.status in ('waiting','held','queued') then 'Workflow paused' else r.reason end reason,
      r.updated_at,
      v.revision version_revision,block.node_type,
      case block.node_type when 'send_sms' then 'Send SMS' when 'send_email' then 'Send email'
        when 'wait' then 'Wait' when 'contact_has_email' then 'Contact has email'
        when 'create_task' then 'Create task for assigned agent'
        when 'wait_until_before_appointment' then 'Wait until before appointment' else 'Automation step' end node_label,
      -- The name the step had in the version this run executed.
      block.node_name,
      case when r.status in ('waiting','held') then r.due_at end due_at,
      private.automation_message_status(r.organization_id,r.id,r.current_node_id) message_status,last_step.reason step_reason,
      may_stop and r.status in ('queued','waiting','held','unknown') can_stop
    from private.automation_runs r
    join public.workflows w on w.organization_id=r.organization_id and w.id=r.workflow_id
    join private.automation_events origin on origin.organization_id=r.organization_id and origin.id=r.event_id
    join public.workflow_versions v on v.organization_id=r.organization_id and v.workflow_id=r.workflow_id and v.id=r.version_id
    left join lateral (
      select nullif(trim(concat_ws(' ',found.first_name,found.last_name)),'') as name from (
        select l.first_name,l.last_name from public.leads l where r.contact_type='lead' and l.organization_id=r.organization_id and l.id=r.contact_id
        union all select c.first_name,c.last_name from public.clients c where r.contact_type='client' and c.organization_id=r.organization_id and c.id=r.contact_id
        union all select x.first_name,x.last_name from public.recruits x where r.contact_type='recruit' and x.organization_id=r.organization_id and x.id=r.contact_id
      ) found limit 1) person on true
    left join lateral (select n->>'type' node_type,nullif(btrim(n#>>'{meta,name}'),'') node_name
      from jsonb_array_elements(v.graph->'nodes') n where n->>'id'=r.current_node_id limit 1) block on true
    left join lateral (select s.reason from private.automation_steps s where s.organization_id=r.organization_id and s.run_id=r.id
      order by s.updated_at desc limit 1) last_step on true
    where r.organization_id=visible_org and (p_contact is null or r.contact_id=p_contact)
      and (p_workflow is null or r.workflow_id=p_workflow) and (p_type is null or r.contact_type=p_type)
      and (p_before_at is null or (r.updated_at,r.id)<(p_before_at,p_before_run))
      -- A run for an unmatched caller has no contact to scope by, so only agency-wide viewers see it.
      and case when r.contact_id is null then agency_wide
        else private.automation_visible_contact(viewer,r.organization_id,r.contact_type,r.contact_id) end
    order by r.updated_at desc,r.id desc limit 100
  ) item;
  return activity;
end $$;

CREATE OR REPLACE FUNCTION public.automation_stop_run(p_run uuid,p_session_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid:=private.automation_require_author(p_session_revision);
begin
  update private.automation_runs set status='stopped',reason='Stopped by user',ended_at=clock_timestamp(),
    updated_at=clock_timestamp(),lease_token=null,leased_until=null
    where id=p_run and organization_id=org and status in ('queued','waiting','held','unknown')
      and case when contact_id is null then private.automation_audience_allowed(org,auth.uid(),null)
        else private.automation_visible_contact(auth.uid(),organization_id,contact_type,contact_id) end;
  if not found then raise exception 'Running automation unavailable' using errcode='42501'; end if;
end $$;

REVOKE ALL ON FUNCTION public.automation_create_task(uuid,uuid,text,text,text),
  public.automation_message_timezone(uuid,text,text),public.automation_message_check(uuid,uuid,text),
  public.automation_release_refused_dispatch(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.automation_message_issue(private.automation_runs) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.automation_failure_retryable(text,text),
  private.automation_step_record(uuid,uuid,uuid,timestamptz,text,uuid),
  private.automation_retry_open(private.automation_runs,text,timestamptz),
  private.automation_caught_up(private.automation_runs,jsonb,timestamptz),
  private.automation_late_in_segment(private.automation_runs,text),
  private.automation_followed_time(uuid,uuid,timestamptz),
  private.automation_time_stopped(private.automation_runs,timestamptz),
  private.automation_record_given(private.automation_runs,text)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.automation_record_provider_receipt(uuid,uuid,text,text,timestamptz,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_create_task(uuid,uuid,text,text,text),
  public.automation_message_timezone(uuid,text,text),public.automation_message_check(uuid,uuid,text),
  public.automation_release_refused_dispatch(uuid,uuid,text),
  public.automation_record_provider_receipt(uuid,uuid,text,text,timestamptz,text,text) TO service_role;
COMMIT;
