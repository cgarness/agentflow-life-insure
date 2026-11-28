-- Explicit, disposable native test of the reminder record: what booking runs gave for an appointment time, across runs.
-- Run after appointment-refusal.sql (phase check) on the same fresh local database, with isolated dummy credentials
-- and the loopback-only channel transport, then appointment-record-native.ts and appointment-record-check.sql.
-- One automation reminds a day before an appointment and an hour before it, by text. Leads 101 to 108 are booked,
-- moved, cancelled, reopened and marked by a signed-in person in the native script, as the CRM does. Leads 111 and 112
-- are booked here, and their runs are written here too: admission never lets two booking runs of one automation follow
-- one appointment at once, so these runs stand in for the races the worker must still settle (two runs at the same
-- reminder, and another run of the automation stopped at that time).
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_setting('agentflow.synthetic_channels', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'This fixture requires an explicitly selected synthetic database.';
 END IF;
 IF NOT EXISTS (SELECT FROM public.organizations WHERE id='aacc0000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Run channel-fixture.sql first.';
 END IF;
END $$;
CREATE FUNCTION pg_temp.cid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('aacc0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
-- The earlier fixtures' automations are paused now that their checks have run, so the only work due from here on is
-- this fixture's.
UPDATE public.workflows SET status='paused'
 WHERE organization_id=pg_temp.cid(1) AND id IN (pg_temp.cid(4),pg_temp.cid(6)) AND status='active';
-- Sending hours around now, room under the daily limit and a current reply feed, for every text below.
UPDATE private.automation_channel_policies
 SET local_start=((clock_timestamp() AT TIME ZONE 'UTC')-interval '3 hours')::time,
  local_end=((clock_timestamp() AT TIME ZONE 'UTC')+interval '3 hours')::time,daily_limit=100,reply_checked_at=clock_timestamp()
 WHERE organization_id=pg_temp.cid(1) AND channel='sms';
DO $$
DECLARE g jsonb:='{"format":1,"settings":{"reentry":"once","stop_on_reply":true},"nodes":[
   {"id":"start","type":"appointment_booked","version":1,"config":{}},
   {"id":"w24","type":"wait_until_before_appointment","version":1,"config":{"amount":24,"unit":"hours","late":"skip"}},
   {"id":"t24","type":"send_sms","version":1,"config":{"body":"Day before: see you {{appointment_date}} at {{appointment_time}}","purpose":"informational"}},
   {"id":"w1","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"hours","late":"skip"}},
   {"id":"t1","type":"send_sms","version":1,"config":{"body":"Hour before: see you {{appointment_date}} at {{appointment_time}}","purpose":"informational"}}],
  "edges":[{"id":"a","source":"start","target":"w24"},{"id":"b","source":"w24","target":"t24"},
   {"id":"c","source":"t24","target":"w1"},{"id":"d","source":"w1","target":"t1"}]}';
 n int; k int; destination text; starts timestamptz:=date_trunc('minute',clock_timestamp())+interval '23 hours 30 minutes';
 slot uuid; booked private.automation_events; event_id_ bigint;
BEGIN
 INSERT INTO public.workflows(id,organization_id,name,status,trigger_type,automation_graph,automation_revision)
 VALUES(pg_temp.cid(60),pg_temp.cid(1),'Reminder record sign-off','active','manual',g,1);
 INSERT INTO public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
 VALUES(pg_temp.cid(61),pg_temp.cid(1),pg_temp.cid(60),'Reminder record sign-off',1,g,clock_timestamp(),pg_temp.cid(2));
 UPDATE public.workflows SET automation_version_id=pg_temp.cid(61) WHERE id=pg_temp.cid(60);
 -- Turned on from now: bookings from here on start its runs.
 INSERT INTO public.automation_intervals(organization_id,workflow_id,version_id,starts_at)
 VALUES(pg_temp.cid(1),pg_temp.cid(60),pg_temp.cid(61),clock_timestamp());
 FOR n IN SELECT * FROM generate_series(101,108) UNION ALL SELECT * FROM generate_series(111,112) LOOP
   destination:='+1202555'||lpad(n::text,4,'0');
   INSERT INTO public.leads(id,organization_id,first_name,phone,user_id)
    VALUES(pg_temp.cid(n),pg_temp.cid(1),'Record '||n,destination,pg_temp.cid(2));
   INSERT INTO private.automation_recipient_facts(organization_id,contact_id,contact_type,channel,destination,timezone_name,valid_until,evidence_reference)
    VALUES(pg_temp.cid(1),pg_temp.cid(n),'lead','sms',destination,'UTC',now()+interval '2 hours','Synthetic verified timezone');
   INSERT INTO public.sms_enrollments(organization_id,phone_e164,informational_confirmed) VALUES(pg_temp.cid(1),destination,true);
 END LOOP;
 -- Leads 111 and 112: an appointment a day ahead, booked through the CRM's own observers, which record its slot and its
 -- booked event. The event is marked processed (these runs are written below), and further booked events for the same
 -- slot carry one run each, all at the day-before text, its wait passed: lead 111's runs A to E (301 to 305) and lead
 -- 112's runs P and Q (311 and 312). Each is held back (due at infinity) until the native script makes it due.
 FOR n IN 111..112 LOOP
   INSERT INTO public.appointments(id,organization_id,title,start_time,end_time,contact_id,user_id)
    VALUES(pg_temp.cid(100+n),pg_temp.cid(1),'Reminder record race',starts,starts+interval '30 minutes',pg_temp.cid(n),pg_temp.cid(2));
   SELECT o.id INTO STRICT slot FROM private.appointment_occurrences o
    WHERE o.organization_id=pg_temp.cid(1) AND o.appointment_id=pg_temp.cid(100+n) AND o.closed_at IS NULL;
   SELECT * INTO STRICT booked FROM private.automation_events e WHERE e.organization_id=pg_temp.cid(1)
    AND e.event_type='appointment_booked' AND e.subject->>'appointment_id'=pg_temp.cid(100+n)::text;
   UPDATE private.automation_events SET processed_at=clock_timestamp() WHERE id=booked.id;
   FOR k IN 1..CASE n WHEN 111 THEN 5 ELSE 2 END LOOP
     event_id_:=booked.id;
     IF k>1 THEN
       INSERT INTO private.automation_events(organization_id,event_type,source_id,source_revision,contact_id,contact_type,
           occurred_at,subject,scope_key,available_at,processed_at)
        VALUES(pg_temp.cid(1),'appointment_booked',pg_temp.cid(400+10*(n-111)+k),1,pg_temp.cid(n),'lead',booked.occurred_at,
          booked.subject,booked.scope_key,clock_timestamp(),clock_timestamp())
        RETURNING id INTO event_id_;
     END IF;
     INSERT INTO private.automation_runs(id,organization_id,workflow_id,version_id,event_id,contact_id,contact_type,scope_key,
       current_node_id,status,due_at,anchor_id,anchor_at,reminded_for,paced_from)
      VALUES(pg_temp.cid(300+10*(n-111)+k),pg_temp.cid(1),pg_temp.cid(60),pg_temp.cid(61),event_id_,pg_temp.cid(n),'lead',
       booked.scope_key,'t24','queued',timestamptz 'infinity',slot,starts,slot,starts-interval '24 hours');
     INSERT INTO private.automation_steps(organization_id,run_id,node_id,status)
      VALUES(pg_temp.cid(1),pg_temp.cid(300+10*(n-111)+k),'w24','elapsed');
   END LOOP;
 END LOOP;
END $$;
-- Test-only, for appointment-record-native.ts on this synthetic database (the loopback worker script reaches the
-- database only through PostgREST), and dropped by appointment-record-check.sql. Only this fixture's automation, in the
-- fixture agency, and only the runs named.
-- Time passes for the named runs: a run waiting for an appointment wait reaches its time (it is due a second ago, as
-- the SQL suites make it due), and a run queued or held at a text is the oldest work due anywhere, as the other
-- fixtures make their runs due, so the next lease takes exactly these runs.
CREATE FUNCTION public.automation_record_fixture_due(p_runs uuid[]) RETURNS uuid[]
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  WITH due AS (
    UPDATE private.automation_runs r SET due_at=CASE WHEN r.status='waiting' THEN clock_timestamp()-interval '1 second'
        ELSE timestamptz '2001-01-01' END
      WHERE r.organization_id='aacc0000-0000-4000-8000-000000000001' AND r.workflow_id='aacc0000-0000-4000-8000-000000000060'
        AND r.id=ANY(p_runs) AND r.status IN ('queued','waiting','held')
      RETURNING r.id)
  SELECT coalesce(array_agg(due.id ORDER BY due.id),'{}'::uuid[]) FROM due
$$;
-- A lead's runs on this fixture's automation, by booking: how each stands, its steps, intents and messages by step, the
-- start of the slot it follows, and the reminder record's rows it wrote.
CREATE FUNCTION public.automation_record_fixture_runs(p_contact uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'reason',r.reason,'node',r.current_node_id,
      'due_at',r.due_at,
      'slot_start',(SELECT o.scheduled_start FROM private.appointment_occurrences o
        WHERE o.organization_id=r.organization_id AND o.id=coalesce(r.anchor_id,r.reminded_for)),
      'steps',(SELECT coalesce(jsonb_object_agg(s.node_id,s.status||coalesce(':'||s.reason,'')),'{}'::jsonb)
        FROM private.automation_steps s WHERE s.organization_id=r.organization_id AND s.run_id=r.id),
      'intents',(SELECT coalesce(jsonb_object_agg(i.node_id,i.status),'{}'::jsonb)
        FROM private.automation_intents i WHERE i.organization_id=r.organization_id AND i.run_id=r.id),
      'messages',(SELECT coalesce(jsonb_object_agg(m.node_id,m.state),'{}'::jsonb)
        FROM private.automation_messages m WHERE m.organization_id=r.organization_id AND m.run_id=r.id),
      'record',(SELECT coalesce(jsonb_agg(jsonb_build_object('node',g.node_id,'starts_at',g.starts_at,'attempt',g.attempt,
          'kind',g.kind,'failure_status',g.failure_status,'failure_code',g.failure_code) ORDER BY g.given_at,g.attempt),'[]'::jsonb)
        FROM private.automation_given_steps g WHERE g.organization_id=r.organization_id AND g.run_id=r.id))
    ORDER BY r.event_id,r.id),'[]'::jsonb)
  FROM private.automation_runs r
  WHERE r.organization_id='aacc0000-0000-4000-8000-000000000001' AND r.workflow_id='aacc0000-0000-4000-8000-000000000060'
    AND r.contact_id=p_contact
$$;
REVOKE ALL ON FUNCTION public.automation_record_fixture_due(uuid[]),public.automation_record_fixture_runs(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_record_fixture_due(uuid[]),public.automation_record_fixture_runs(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
