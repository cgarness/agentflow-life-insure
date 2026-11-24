-- Explicit, disposable native test of the last check before an appointment reminder reaches a provider.
-- Run after channel-fixture.sql on the same fresh local database, with isolated dummy credentials and the
-- loopback-only channel transport. Five reminder texts are due, each one hour before its appointment.
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
DO $$
DECLARE g jsonb:='{"format":1,"settings":{"reentry":"once","stop_on_reply":false},"nodes":[{"id":"start","type":"appointment_booked","version":1,"config":{}},{"id":"hour","type":"wait_until_before_appointment","version":1,"config":{"amount":1,"unit":"hours"}},{"id":"text","type":"send_sms","version":1,"config":{"body":"Reminder: {{appointment_time}}","purpose":"informational"}}],"edges":[{"id":"a","source":"start","target":"hour"},{"id":"b","source":"hour","target":"text"}]}';
 n int; destination text; starts timestamptz:=date_trunc('minute',clock_timestamp())+interval '50 minutes'; slot uuid; booked private.automation_events;
BEGIN
 INSERT INTO public.workflows(id,organization_id,name,status,trigger_type,automation_graph,automation_revision)
 VALUES(pg_temp.cid(6),pg_temp.cid(1),'Synthetic appointment reminder','active','manual',g,1);
 INSERT INTO public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
 VALUES(pg_temp.cid(7),pg_temp.cid(1),pg_temp.cid(6),'Synthetic appointment reminder',1,g,clock_timestamp(),pg_temp.cid(2));
 UPDATE public.workflows SET automation_version_id=pg_temp.cid(7) WHERE id=pg_temp.cid(6);
 FOR n IN 3..7 LOOP
   destination:='+1202555014'||(n+1);
   INSERT INTO public.leads(id,organization_id,first_name,phone,user_id) VALUES(pg_temp.cid(10+n),pg_temp.cid(1),'Alex',destination,pg_temp.cid(2));
   -- The booking records its slot and the booked event through the CRM's own observers.
   INSERT INTO public.appointments(id,organization_id,title,start_time,end_time,contact_id,user_id)
    VALUES(pg_temp.cid(40+n),pg_temp.cid(1),'Synthetic review',starts,starts+interval '30 minutes',pg_temp.cid(10+n),pg_temp.cid(2));
   SELECT o.id INTO STRICT slot FROM private.appointment_occurrences o
    WHERE o.organization_id=pg_temp.cid(1) AND o.appointment_id=pg_temp.cid(40+n) AND o.closed_at IS NULL;
   SELECT * INTO STRICT booked FROM private.automation_events e WHERE e.organization_id=pg_temp.cid(1)
    AND e.event_type='appointment_booked' AND e.subject->>'appointment_id'=pg_temp.cid(40+n)::text;
   UPDATE private.automation_events SET processed_at=clock_timestamp() WHERE id=booked.id;
   -- The run has waited until an hour before the appointment and its reminder text is due. It is the oldest work
   -- due anywhere, so the next lease takes exactly these runs.
   INSERT INTO private.automation_runs(id,organization_id,workflow_id,version_id,event_id,contact_id,contact_type,scope_key,
     current_node_id,status,due_at,anchor_id,anchor_at,reminded_for,paced_from)
    VALUES(pg_temp.cid(20+n),pg_temp.cid(1),pg_temp.cid(6),pg_temp.cid(7),booked.id,pg_temp.cid(10+n),'lead',booked.scope_key,
     'text','queued','2001-01-01',slot,starts,slot,starts-interval '1 hour');
   INSERT INTO private.automation_steps(organization_id,run_id,node_id,status) VALUES(pg_temp.cid(1),pg_temp.cid(20+n),'hour','elapsed');
   INSERT INTO private.automation_recipient_facts(organization_id,contact_id,contact_type,channel,destination,timezone_name,valid_until,evidence_reference)
    VALUES(pg_temp.cid(1),pg_temp.cid(10+n),'lead','sms',destination,'UTC',now()+interval '1 hour','Synthetic verified timezone');
   INSERT INTO public.sms_enrollments(organization_id,phone_e164,informational_confirmed) VALUES(pg_temp.cid(1),destination,true);
 END LOOP;
END $$;
COMMIT;
