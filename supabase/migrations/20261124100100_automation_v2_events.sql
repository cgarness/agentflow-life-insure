-- Automations V2 events. Typed contacts, optional contacts, event facts and re-entry scopes, plus
-- observers for saved dispositions and recorded sales. Installs no job, definition, enrollment or send.
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

ALTER TABLE private.automation_events
  DROP CONSTRAINT automation_events_event_type_check,
  -- appointment_changed never starts a run. It tells the worker an appointment moved, was cancelled or was removed.
  ADD CONSTRAINT automation_events_event_type_check CHECK (event_type IN ('lead_created','campaign_membership_created',
    'disposition_recorded','appointment_booked','appointment_outcome_recorded','inbound_call_missed','sale_recorded',
    'policy_issuance_confirmed','appointment_changed')),
  ALTER COLUMN contact_id DROP NOT NULL,
  ADD COLUMN contact_type text DEFAULT 'lead' CHECK (contact_type IN ('lead','client','recruit')),
  ADD COLUMN subject jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN scope_key text;
UPDATE private.automation_events SET scope_key='lead:'||contact_id::text WHERE scope_key IS NULL AND contact_id IS NOT NULL;
ALTER TABLE private.automation_events
  ADD CONSTRAINT automation_events_contact_typed CHECK ((contact_id IS NULL) = (contact_type IS NULL));
CREATE INDEX automation_events_appointment ON private.automation_events(organization_id,(subject->>'appointment_id'))
  WHERE subject ? 'appointment_id';

ALTER TABLE private.automation_intake_recovery
  ALTER COLUMN contact_id DROP NOT NULL,
  ADD COLUMN contact_type text DEFAULT 'lead',
  ADD COLUMN subject jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN scope_key text,
  -- The earliest moment the recovered event may enroll, so a repair keeps the event's settle time.
  ADD COLUMN available_at timestamptz;

ALTER TABLE private.automation_runs
  DROP CONSTRAINT automation_runs_contact_type_check,
  ALTER COLUMN contact_id DROP NOT NULL,
  ALTER COLUMN contact_type DROP NOT NULL,
  ADD CONSTRAINT automation_runs_contact_type_check CHECK (contact_type IN ('lead','client','recruit')),
  ADD CONSTRAINT automation_runs_contact_typed CHECK ((contact_id IS NULL) = (contact_type IS NULL)),
  -- The identity re-entry is decided on: a contact, an appointment slot, an outcome, a call or a policy.
  ADD COLUMN scope_key text,
  -- The appointment slot a waiting step is anchored to, and its start when the due time was set.
  ADD COLUMN anchor_id uuid,
  ADD COLUMN anchor_at timestamptz,
  -- When the current hold began. Retries back off from it and a run on hold too long ends.
  ADD COLUMN held_since timestamptz,
  -- The appointment slot the reminders this run already gave were for.
  ADD COLUMN reminded_for uuid,
  -- The appointment slot the facts handed out with the current lease describe. A message is handed to a
  -- provider only while this is still the appointment's current slot.
  ADD COLUMN leased_for uuid,
  -- The moment a step's own timing counts from: the event that started the run, then the time the last
  -- wait was scheduled to end. A due time measured from it does not move when the worker runs late.
  ADD COLUMN paced_from timestamptz;
UPDATE private.automation_runs SET scope_key=contact_type||':'||contact_id::text WHERE scope_key IS NULL AND contact_id IS NOT NULL;
CREATE INDEX automation_runs_scope ON private.automation_runs(organization_id,workflow_id,scope_key,ended_at);
-- An appointment change finds the runs that its booking started.
CREATE INDEX automation_runs_by_event ON private.automation_runs(organization_id,event_id);
-- "Stop when an appointment is booked" looks up a contact's first slots.
CREATE INDEX automation_appointment_first_slots ON private.appointment_occurrences(organization_id,contact_id) WHERE seq=1;

CREATE FUNCTION private.automation_contact_type(p_org uuid,p_contact uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT kind FROM (
    SELECT 'lead' AS kind,1 AS ord FROM public.leads WHERE organization_id=p_org AND id=p_contact
    UNION ALL SELECT 'client',2 FROM public.clients WHERE organization_id=p_org AND id=p_contact
    UNION ALL SELECT 'recruit',3 FROM public.recruits WHERE organization_id=p_org AND id=p_contact
  ) found ORDER BY ord LIMIT 1
$$;

-- The contact's current owner, only while that person is an active member of the same agency.
CREATE FUNCTION private.automation_contact_owner(p_org uuid,p_type text,p_contact uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p.id FROM (
    SELECT coalesce(l.assigned_agent_id,l.user_id) AS owner_id FROM public.leads l
      WHERE p_type='lead' AND l.organization_id=p_org AND l.id=p_contact
    UNION ALL SELECT c.assigned_agent_id FROM public.clients c WHERE p_type='client' AND c.organization_id=p_org AND c.id=p_contact
    UNION ALL SELECT r.assigned_agent_id FROM public.recruits r WHERE p_type='recruit' AND r.organization_id=p_org AND r.id=p_contact
  ) contact JOIN public.profiles p ON p.id=contact.owner_id AND p.organization_id=p_org AND p.status='Active'
$$;

-- The configured agency zone when it is a real zone name. Callers decide what to do without one.
CREATE FUNCTION private.automation_agency_time_zone(p_org uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT cs.timezone FROM public.company_settings cs
  WHERE cs.organization_id=p_org AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=cs.timezone)
  LIMIT 1
$$;

-- One capture path for every new observer. The business write that fired the observer never waits
-- long and never fails: a bounded lock wait or any error keeps the original facts for a later repair.
-- p_settle delays enrollment for facts whose confirming evidence can arrive a moment after the event.
CREATE FUNCTION private.automation_record_event(p_org uuid,p_type text,p_source uuid,p_contact uuid,p_contact_type text,
  p_subject jsonb,p_scope text,p_settle interval)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='200ms' AS $$
DECLARE occurred timestamptz:=clock_timestamp(); kind text:=CASE WHEN p_contact IS NULL THEN NULL ELSE p_contact_type END;
BEGIN
  IF p_org IS NULL OR p_source IS NULL OR NOT EXISTS (SELECT 1 FROM private.automation_release_controls
    WHERE organization_id=p_org AND enrollment_enabled) THEN RETURN; END IF;
  BEGIN
    PERFORM 1 FROM private.automation_release_controls WHERE organization_id=p_org AND enrollment_enabled FOR SHARE;
    IF NOT FOUND THEN RETURN; END IF;
    -- Order committed source events against publish and pause boundaries without serializing saves together.
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('automation-activation:'||p_org::text,0));
    occurred:=clock_timestamp();
    INSERT INTO private.automation_events(organization_id,event_type,source_id,source_revision,contact_id,contact_type,
        occurred_at,subject,scope_key,available_at)
      VALUES(p_org,p_type,p_source,1,p_contact,kind,occurred,coalesce(p_subject,'{}'::jsonb),p_scope,
        occurred+coalesce(p_settle,interval '0'))
      ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO private.automation_intake_recovery(organization_id,event_type,source_id,contact_id,contact_type,occurred_at,
        subject,scope_key,available_at)
      VALUES(p_org,p_type,p_source,p_contact,kind,occurred,coalesce(p_subject,'{}'::jsonb),p_scope,
        occurred+coalesce(p_settle,interval '0'))
      ON CONFLICT DO NOTHING;
  END;
END $$;

-- Lead and campaign capture keep their behaviour and now state the contact type and scope explicitly.
CREATE OR REPLACE FUNCTION private.automation_capture_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  kind text := tg_argv[0];
  org uuid := new.organization_id;
  recipient uuid;
  campaign uuid;
  source text;
  occurred timestamptz;
begin
  if org is null or not exists (select 1 from private.automation_release_controls
    where organization_id=org and enrollment_enabled for share) then return new; end if;
  -- Order committed source events against publish/pause boundaries without serializing imports together.
  perform pg_advisory_xact_lock_shared(hashtextextended('automation-activation:'||org::text,0));
  occurred:=clock_timestamp();
  if kind='lead_created' then
    recipient:=new.id;
    source:=new.lead_source;
  else
    recipient:=new.lead_id;
    campaign:=new.campaign_id;
    if recipient is null then return new; end if;
    select l.lead_source into source from public.leads l
      join public.campaigns c on c.organization_id=l.organization_id and c.id=campaign
      where l.id=recipient and l.organization_id=org;
    if not found then return new; end if;
  end if;
  begin
    insert into private.automation_events(organization_id,event_type,source_id,source_revision,contact_id,contact_type,
        campaign_id,lead_source,occurred_at,scope_key)
      values(org,kind,new.id,1,recipient,'lead',campaign,source,occurred,'lead:'||recipient::text) on conflict do nothing;
  exception when others then
    insert into private.automation_intake_recovery(organization_id,event_type,source_id,contact_id,contact_type,campaign_id,
        lead_source,occurred_at,scope_key)
      values(org,kind,new.id,recipient,'lead',campaign,source,occurred,'lead:'||recipient::text) on conflict do nothing;
  end;
  return new;
exception when others then
  raise warning 'Automation event capture requires investigation (table %, SQLSTATE %)', tg_table_name, sqlstate;
  return new;
end $$;

-- A saved disposition has exactly one receipt and a replay inserts nothing, so one save is one event.
-- These agency-wide events carry no campaign: authority over them is always agency-wide.
CREATE FUNCTION private.automation_capture_disposition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE contact uuid; kind text;
BEGIN
  IF NEW.payload->>'action' IS DISTINCT FROM 'disposition' OR nullif(NEW.payload->>'disposition_id','') IS NULL THEN RETURN NEW; END IF;
  contact:=nullif(NEW.result->>'contact_id','')::uuid;
  kind:=coalesce(nullif(NEW.result->>'contact_type',''),'lead');
  IF contact IS NULL OR kind NOT IN ('lead','client','recruit') THEN RETURN NEW; END IF;
  PERFORM private.automation_record_event(NEW.organization_id,'disposition_recorded',NEW.operation_id,contact,kind,
    jsonb_build_object('disposition_id',NEW.payload->>'disposition_id','call_id',NEW.call_id,'agent_id',NEW.agent_id,
      'campaign_lead_id',NEW.campaign_lead_id),kind||':'||contact::text,interval '0');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Automation disposition capture requires investigation (SQLSTATE %)', SQLSTATE;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_capture_disposition AFTER INSERT ON private.dialer_disposition_receipts
  FOR EACH ROW EXECUTE FUNCTION private.automation_capture_disposition();

-- A sale is one immutable row per policy. Historical entries and repairs carry a proxy event time
-- and never start follow-up.
CREATE FUNCTION private.automation_capture_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.policy_id IS NULL OR NEW.contact_id IS NULL OR NEW.event_time_source IS DISTINCT FROM 'event' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.organization_id=NEW.organization_id AND c.id=NEW.contact_id) THEN RETURN NEW; END IF;
  PERFORM private.automation_record_event(NEW.organization_id,'sale_recorded',NEW.id,NEW.contact_id,'client',
    jsonb_build_object('policy_id',NEW.policy_id,'win_id',NEW.id,'agent_id',NEW.agent_id),'sale:'||NEW.policy_id::text,interval '0');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Automation sale capture requires investigation (SQLSTATE %)', SQLSTATE;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_capture_sale AFTER INSERT ON public.wins
  FOR EACH ROW EXECUTE FUNCTION private.automation_capture_sale();

-- The appointment's current open slot with its latest recorded outcome. A slot with no recorded outcome takes
-- the appointment's own status when that is final: moving a cancelled appointment opens a new slot without
-- restating the cancellation, and such a slot must never read as a live appointment to remind about.
CREATE FUNCTION private.automation_appointment_state(p_org uuid,p_appointment uuid)
RETURNS TABLE(occurrence_id uuid,starts_at timestamptz,head_outcome text,outcome_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT o.id,o.scheduled_start,coalesce(head.outcome,crm.final),
    CASE WHEN head.outcome IS NOT NULL THEN head.recorded_at WHEN crm.final IS NOT NULL THEN o.opened_at END
  FROM private.appointment_occurrences o
  LEFT JOIN LATERAL (
    SELECT oe.outcome,oe.recorded_at FROM private.appointment_outcome_events oe
    WHERE oe.occurrence_id=o.id AND NOT EXISTS (
      SELECT 1 FROM private.appointment_outcome_events newer WHERE newer.supersedes_event_id=oe.id)
    LIMIT 1) head ON true
  LEFT JOIN LATERAL (
    SELECT nullif(private.appointment_status_key(a.status),'open') AS final FROM public.appointments a
    WHERE a.organization_id=o.organization_id AND a.id=o.appointment_id) crm ON true
  WHERE o.organization_id=p_org AND o.appointment_id=p_appointment AND o.closed_at IS NULL
$$;

-- Where a "wait until before the appointment" step stands against the appointment's current slot.
-- wait: sleep until due. advance: the reminder time passed and the author chose to continue.
-- skip: the reminder time passed. past: the appointment already started. gone: no open slot remains.
CREATE FUNCTION private.automation_appointment_wait(p_org uuid,p_appointment uuid,p_node jsonb,
  OUT verdict text,OUT anchor uuid,OUT anchor_start timestamptz,OUT due timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE slot record; zone text; amount integer:=(p_node#>>'{config,amount}')::integer; unit text:=p_node#>>'{config,unit}';
BEGIN
  SELECT s.occurrence_id,s.starts_at INTO slot FROM private.automation_appointment_state(p_org,p_appointment) s;
  IF NOT FOUND THEN verdict:='gone'; RETURN; END IF;
  anchor:=slot.occurrence_id;
  anchor_start:=slot.starts_at;
  IF unit='days' THEN
    -- A day before a 3 PM appointment is 3 PM the previous day in the agency's zone, across clock changes.
    zone:=private.automation_agency_time_zone(p_org);
    due:=CASE WHEN zone IS NULL THEN slot.starts_at-make_interval(days=>amount)
      ELSE ((slot.starts_at AT TIME ZONE zone)-make_interval(days=>amount)) AT TIME ZONE zone END;
  ELSE
    due:=slot.starts_at-CASE unit WHEN 'minutes' THEN make_interval(mins=>amount) ELSE make_interval(hours=>amount) END;
  END IF;
  verdict:=CASE WHEN due>clock_timestamp() THEN 'wait' WHEN slot.starts_at<=clock_timestamp() THEN 'past'
    WHEN p_node#>>'{config,late}'='continue' THEN 'advance' ELSE 'skip' END;
END $$;

-- When an automation began following an appointment: the first of the appointment's bookings made while the automation
-- was on with a booking trigger, or null when it never followed the appointment. A booking taken up because its
-- appointment was reopened is judged from then, as the run that followed the appointment would have been.
CREATE FUNCTION private.automation_following_since(p_org uuid,p_workflow uuid,p_appointment text)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT min(b.occurred_at) FROM private.automation_events b
  WHERE b.organization_id=p_org AND b.event_type='appointment_booked' AND b.subject->>'appointment_id'=p_appointment
    AND EXISTS (SELECT 1 FROM public.automation_intervals i
      JOIN public.workflow_versions v ON v.organization_id=i.organization_id AND v.workflow_id=i.workflow_id AND v.id=i.version_id
      WHERE i.organization_id=p_org AND i.workflow_id=p_workflow AND i.starts_at<=b.occurred_at
        AND (i.ends_at IS NULL OR i.ends_at>b.occurred_at)
        AND private.automation_trigger(v.graph)->>'type'='appointment_booked')
$$;

-- The first conversation or other booking after p_since that ends a run under these settings, with when it happened.
-- The appointment a disposition save booked is part of that save (one booking request per call, or per operation
-- without a call), so it never counts.
CREATE FUNCTION private.automation_contact_stop(p_org uuid,p_settings jsonb,p_contact uuid,p_since timestamptz,
  p_appointment text,p_booking_request uuid)
RETURNS TABLE(stop_reason text,stopped_at timestamptz) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE found_at timestamptz;
BEGIN
  IF p_contact IS NULL THEN RETURN; END IF;
  IF p_settings->>'stop_on_booking'='true' THEN
    SELECT min(o.opened_at) INTO found_at FROM private.appointment_occurrences o
      WHERE o.organization_id=p_org AND o.contact_id=p_contact AND o.seq=1
        AND o.opened_source IN ('booking','external_sync') AND o.booking_kind IS DISTINCT FROM 'callback'
        AND o.category<>'callback' AND o.opened_at>p_since
        AND o.appointment_id::text IS DISTINCT FROM p_appointment
        AND NOT (p_booking_request IS NOT NULL AND EXISTS (SELECT 1 FROM public.appointments a
          WHERE a.organization_id=o.organization_id AND a.id=o.appointment_id AND a.booking_request_id=p_booking_request));
    IF found_at IS NOT NULL THEN RETURN QUERY SELECT 'Appointment booked'::text,found_at; RETURN; END IF;
  END IF;
  IF p_settings->>'stop_on_contact'='true' THEN
    -- The same rule the CRM uses for a contacted call: a real conversation or a disposition that counts.
    SELECT min(coalesce(c.started_at,c.created_at)) INTO found_at FROM public.calls c
      LEFT JOIN public.dispositions d ON d.id=c.disposition_id AND d.organization_id=c.organization_id
      WHERE c.organization_id=p_org AND c.contact_id=p_contact
        AND coalesce(c.started_at,c.created_at)>p_since
        AND lower(btrim(coalesce(d.name,c.disposition_name,'')))<>'no answer'
        AND (coalesce(c.duration,0)>45 OR coalesce(d.counts_as_contacted,false));
    IF found_at IS NOT NULL THEN RETURN QUERY SELECT 'Contact was reached'::text,found_at; RETURN; END IF;
  END IF;
END $$;

-- Facts that end a run early, with the moment they happened. Evaluated when work is leased, inside
-- internal actions and when an unfinished run would block re-entry.
CREATE FUNCTION private.automation_stop_check(r private.automation_runs)
RETURNS TABLE(stop_reason text,stopped_at timestamptz) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.automation_events; settings jsonb; slot record; inbound record;
BEGIN
  SELECT * INTO e FROM private.automation_events ev WHERE ev.id=r.event_id AND ev.organization_id=r.organization_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT v.graph->'settings' INTO settings FROM public.workflow_versions v
    WHERE v.organization_id=r.organization_id AND v.workflow_id=r.workflow_id AND v.id=r.version_id;

  IF e.event_type='appointment_booked' THEN
    SELECT s.head_outcome,s.outcome_at INTO slot
      FROM private.automation_appointment_state(r.organization_id,nullif(e.subject->>'appointment_id','')::uuid) s;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'Appointment was removed'::text,coalesce((SELECT max(o.closed_at) FROM private.appointment_occurrences o
        WHERE o.organization_id=r.organization_id AND o.appointment_id=nullif(e.subject->>'appointment_id','')::uuid),clock_timestamp());
      RETURN;
    ELSIF slot.head_outcome='cancelled' THEN
      RETURN QUERY SELECT 'Appointment was cancelled'::text,slot.outcome_at; RETURN;
    END IF;
  ELSIF e.event_type='appointment_outcome_recorded' THEN
    SELECT o.closed_at,o.close_reason,head.outcome,head.recorded_at INTO slot FROM private.appointment_occurrences o
      LEFT JOIN LATERAL (SELECT oe.outcome,oe.recorded_at FROM private.appointment_outcome_events oe
        WHERE oe.occurrence_id=o.id AND NOT EXISTS (
          SELECT 1 FROM private.appointment_outcome_events newer WHERE newer.supersedes_event_id=oe.id) LIMIT 1) head ON true
      WHERE o.organization_id=r.organization_id AND o.id=nullif(e.subject->>'occurrence_id','')::uuid;
    IF NOT FOUND THEN RETURN QUERY SELECT 'Appointment was removed'::text,clock_timestamp(); RETURN;
    ELSIF slot.closed_at IS NOT NULL THEN
      RETURN QUERY SELECT CASE slot.close_reason WHEN 'deleted' THEN 'Appointment was removed'
        ELSE 'Appointment was rescheduled' END,slot.closed_at; RETURN;
    ELSIF slot.outcome IS DISTINCT FROM e.subject->>'outcome' THEN
      RETURN QUERY SELECT 'Appointment outcome was changed'::text,coalesce(slot.recorded_at,clock_timestamp()); RETURN;
    END IF;
  ELSIF e.event_type='inbound_call_missed' THEN
    -- The same verdict the task step uses (automation_inbound_evidence, installed by the inbound callbacks
    -- migration): an answer confirmed late ends the run, so nothing after it treats the call as missed.
    SELECT c.updated_at INTO inbound FROM public.calls c
      WHERE c.organization_id=r.organization_id AND c.id=nullif(e.subject->>'call_id','')::uuid;
    IF FOUND AND to_regprocedure('private.automation_inbound_evidence(uuid,uuid)') IS NOT NULL
        AND private.automation_inbound_evidence(r.organization_id,nullif(e.subject->>'call_id','')::uuid)='answered' THEN
      RETURN QUERY SELECT 'Call was answered'::text,coalesce(inbound.updated_at,clock_timestamp()); RETURN;
    END IF;
  END IF;

  IF r.contact_id IS NULL THEN RETURN; END IF;
  -- A later booking or a conversation ends the run, counted from the event that started it. Admission already judged
  -- a reopened booking from when the automation began following the appointment.
  RETURN QUERY SELECT s.stop_reason,s.stopped_at FROM private.automation_contact_stop(r.organization_id,settings,r.contact_id,
    e.occurred_at,e.subject->>'appointment_id',
    CASE WHEN e.event_type='disposition_recorded' THEN coalesce(nullif(e.subject->>'call_id','')::uuid,e.source_id) END) s;
END $$;

-- Whether a run following an appointment starts over for the appointment's current time. It does when the
-- reminders it already gave were for another time (an appointment moved away and back is at the same time, so it
-- does not), and every reminder it passed would still be ahead for the
-- current time, or the author chose to send it late. A restarted run then gives the current time every
-- reminder. Otherwise the run keeps its place: its pending reminder moves to the current time, so a move into
-- the first reminder's window never loses the reminders after it. Only admitting the current time restarts a
-- run, so the old run ends exactly when the new one starts.
CREATE FUNCTION private.automation_restarts_for_new_time(p_org uuid,p_run uuid,p_version uuid,p_appointment uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH passed AS (SELECT n AS node FROM private.automation_steps s
    JOIN public.workflow_versions v ON v.organization_id=s.organization_id AND v.id=p_version
    CROSS JOIN LATERAL jsonb_array_elements(v.graph->'nodes') n
    WHERE s.organization_id=p_org AND s.run_id=p_run AND s.status='elapsed'
      AND n->>'id'=s.node_id AND n->>'type'='wait_until_before_appointment')
  SELECT EXISTS (SELECT 1 FROM passed)
    AND EXISTS (SELECT 1 FROM private.automation_runs r CROSS JOIN LATERAL private.automation_appointment_state(p_org,p_appointment) slot
      WHERE r.organization_id=p_org AND r.id=p_run AND NOT EXISTS (SELECT 1 FROM private.appointment_occurrences o
        WHERE o.organization_id=p_org AND o.id=r.reminded_for AND o.scheduled_start=slot.starts_at))
    AND NOT EXISTS (SELECT 1 FROM passed p
      CROSS JOIN LATERAL private.automation_appointment_wait(p_org,p_appointment,p.node) placed
      WHERE placed.verdict NOT IN ('wait','advance'))
$$;

-- Whether a run must not act yet because its appointment moved after it gave a reminder and admitting the new
-- time, which is still to come, decides whether the automation starts again for it. The worker leaves such a
-- run alone until then, so it never acts on the old time. When the admission refuses, the run keeps its place.
CREATE FUNCTION private.automation_awaits_restart(r private.automation_runs)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT r.reminded_for IS NOT NULL AND EXISTS (SELECT 1 FROM private.automation_events origin
      JOIN private.automation_release_controls ctl ON ctl.organization_id=origin.organization_id AND ctl.enrollment_enabled
      CROSS JOIN LATERAL private.automation_appointment_state(origin.organization_id,nullif(origin.subject->>'appointment_id','')::uuid) slot
    WHERE origin.organization_id=r.organization_id AND origin.id=r.event_id AND origin.event_type='appointment_booked'
      AND slot.occurrence_id IS DISTINCT FROM r.reminded_for
      AND EXISTS (SELECT 1 FROM private.automation_events booked WHERE booked.organization_id=origin.organization_id
        AND booked.subject->>'appointment_id'=origin.subject->>'appointment_id' AND booked.event_type='appointment_booked'
        AND booked.subject->>'occurrence_id'=slot.occurrence_id::text
        AND (booked.processed_at IS NULL OR EXISTS (SELECT 1 FROM private.automation_deferred_admissions d
          WHERE d.organization_id=booked.organization_id AND d.workflow_id=r.workflow_id AND d.event_id=booked.id)))
      AND private.automation_restarts_for_new_time(r.organization_id,r.id,r.version_id,
        nullif(origin.subject->>'appointment_id','')::uuid))
$$;

-- Whether a run sits in a plain wait that had already started, so its due time is when that wait ends.
CREATE FUNCTION private.automation_waiting_out(r private.automation_runs)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM private.automation_steps s
    JOIN public.workflow_versions v ON v.organization_id=s.organization_id AND v.id=r.version_id
    CROSS JOIN LATERAL jsonb_array_elements(v.graph->'nodes') n
    WHERE s.organization_id=r.organization_id AND s.run_id=r.id AND s.node_id=r.current_node_id AND s.status='wait'
      AND n->>'id'=r.current_node_id AND n->>'type'='wait')
$$;

CREATE FUNCTION private.automation_settle_stop(r private.automation_runs)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE verdict record;
BEGIN
  SELECT * INTO verdict FROM private.automation_stop_check(r);
  IF NOT FOUND OR verdict.stop_reason IS NULL THEN RETURN false; END IF;
  -- The run ended when the fact happened, so later events are judged against that moment.
  UPDATE private.automation_runs SET status='stopped',reason=verdict.stop_reason,
    ended_at=least(coalesce(verdict.stopped_at,clock_timestamp()),clock_timestamp()),
    updated_at=clock_timestamp(),lease_token=NULL,leased_until=NULL,held_since=NULL
    WHERE id=r.id AND organization_id=r.organization_id AND status IN ('queued','waiting','held');
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION private.automation_admit_event(e private.automation_events,p_interval uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; trigger_node jsonb; first_node text; halt text; scope text; lock_scope text; reentry text;
  prior private.automation_runs; slot record; stood_again timestamptz; since timestamptz;
begin
  select i.workflow_id,i.version_id,i.starts_at,i.ends_at,v.graph,v.published_by,w.status into candidate
    from public.automation_intervals i
    join public.workflow_versions v on v.id=i.version_id and v.organization_id=i.organization_id and v.workflow_id=i.workflow_id
    join public.workflows w on w.id=i.workflow_id and w.organization_id=i.organization_id
    where i.organization_id=e.organization_id and i.id=p_interval
    for share of w;
  if not found or candidate.status not in ('paused','active') then return 0; end if;
  if e.event_type='appointment_booked' then
    -- When the appointment was opened again after this booking, as its own change log records it.
    select max(x.observed_at) into stood_again from private.appointment_evidence_observations x
      where x.organization_id=e.organization_id and x.appointment_id=(e.subject->>'appointment_id')::uuid and x.op='UPDATE'
        and x.observed_at>e.occurred_at and private.appointment_status_key(x.prev->>'status')='cancelled'
        and private.appointment_status_key(x.next->>'status')='open';
    since:=private.automation_following_since(e.organization_id,candidate.workflow_id,e.subject->>'appointment_id');
  end if;
  -- The automation was on when the event happened. A booking first seen while its appointment was cancelled, and opened
  -- again afterwards, is also taken by the automation on at that reopening, or by the one that followed the appointment
  -- from an earlier booking, which keeps it while paused until it resumes.
  if not ((candidate.starts_at<=e.occurred_at and (candidate.ends_at is null or candidate.ends_at>e.occurred_at))
      or (stood_again is not null and (
        (candidate.starts_at<=stood_again and (candidate.ends_at is null or candidate.ends_at>stood_again))
        or (since is not null and candidate.starts_at<=since and (candidate.ends_at is null or candidate.ends_at>since))))) then
    return 0;
  end if;
  if not private.automation_audience_allowed(e.organization_id,candidate.published_by,e.campaign_id)
    then return 0; end if;
  trigger_node:=private.automation_trigger(candidate.graph);
  if trigger_node is null or trigger_node->>'type' is distinct from e.event_type then return 0; end if;
  if nullif(trigger_node#>>'{config,lead_source}','') is not null
    and trigger_node#>>'{config,lead_source}' is distinct from e.lead_source then return 0; end if;
  if e.event_type='campaign_membership_created' and (
    coalesce(trigger_node#>>'{config,any_campaign}','false')<>'true'
    and trigger_node#>>'{config,campaign_id}' is distinct from e.campaign_id::text
  ) then return 0; end if;
  if e.event_type='disposition_recorded' and not coalesce(
    trigger_node#>'{config,disposition_ids}' ? (e.subject->>'disposition_id'),false) then return 0; end if;
  if e.event_type='appointment_outcome_recorded' and not coalesce(
    trigger_node#>'{config,outcomes}' ? (e.subject->>'outcome'),false) then return 0; end if;
  select edge->>'target' into first_node from jsonb_array_elements(candidate.graph->'edges') edge
    where edge->>'source'=trigger_node->>'id';
  if first_node is null then return 0; end if;

  if candidate.status='paused' then
    insert into private.automation_deferred_admissions(organization_id,event_id,interval_id,workflow_id)
      values(e.organization_id,e.id,p_interval,candidate.workflow_id) on conflict do nothing;
    return 0;
  end if;

  scope:=coalesce(e.scope_key,coalesce(e.contact_type,'lead')||':'||e.contact_id::text);
  if scope is null then return 0; end if;
  -- One admission at a time per contact, and per appointment or other subject.
  lock_scope:=coalesce('appointment:'||nullif(e.subject->>'appointment_id',''),scope);
  if e.contact_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('automation-contact:'||e.organization_id::text||
      coalesce(e.contact_type,'lead')||e.contact_id::text,0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('automation-scope:'||candidate.workflow_id::text||lock_scope,0));

  if e.event_type='appointment_booked' then
    select s.occurrence_id,s.starts_at,s.head_outcome into slot
      from private.automation_appointment_state(e.organization_id,nullif(e.subject->>'appointment_id','')::uuid) s;
    -- Only the appointment's current slot, still ahead and without an outcome, starts a run. A booking admitted after
    -- its appointment was opened again counts from that reopening (stood_again), never from a moment while it was
    -- cancelled. A recorded time, so a late worker moves nothing.
    if not found or slot.occurrence_id::text is distinct from e.subject->>'occurrence_id'
      or coalesce(slot.head_outcome,'retracted')<>'retracted'
      or slot.starts_at<=greatest(e.occurred_at,stood_again) then return 0; end if;
    -- A booking taken up because its appointment was reopened, whether it was opened again after this booking or this
    -- slot was opened by a save made while the appointment was cancelled (a move while cancelled, or one save that moves
    -- and reopens it), is judged as the run that followed the appointment would have been: its stop rules (a verified
    -- reply, a conversation, another booking) count from when this automation began following the appointment
    -- (automation_following_since). So the same facts give the same answer whether or not the worker saw the booking
    -- before the cancellation, and in whatever order it sees the changes. Ended so already, the automation starts
    -- nothing again for the appointment; otherwise the run is recorded as stopped, so its activity shows why nothing
    -- went out. An ordinary move of an appointment that stood counts from its own booking, as every booking does.
    if stood_again is not null or exists(select 1 from (select x.prev from private.appointment_evidence_observations x
        where x.organization_id=e.organization_id and x.appointment_id=(e.subject->>'appointment_id')::uuid
          and x.observed_at<=e.occurred_at order by x.id desc limit 1) opening
      where private.appointment_status_key(opening.prev->>'status')='cancelled') then
      since:=least(e.occurred_at,coalesce(since,e.occurred_at));
      select s.stop_reason into halt from private.automation_contact_stop(e.organization_id,candidate.graph->'settings',
        e.contact_id,since,e.subject->>'appointment_id',null) s limit 1;
      if halt is null and e.contact_id is not null and candidate.graph#>>'{settings,stop_on_reply}'='true' and exists(
          select 1 from private.automation_reply_watermarks m where m.organization_id=e.organization_id
            and m.contact_type=coalesce(e.contact_type,'lead') and m.contact_id=e.contact_id and m.latest_reply_at>=since) then
        halt:='Verified reply received';
      end if;
      if halt is not null and exists(select 1 from private.automation_runs r join private.automation_events origin
          on origin.organization_id=r.organization_id and origin.id=r.event_id
        where r.organization_id=e.organization_id and r.workflow_id=candidate.workflow_id
          and origin.subject ? 'appointment_id' and origin.subject->>'appointment_id'=e.subject->>'appointment_id') then
        return 0;
      end if;
    end if;
    -- A run whose reminders were for an earlier time starts over for the new time when that gives the new
    -- time every reminder the automation gives (automation_restarts_for_new_time). A run waiting to hear
    -- whether its last message was accepted is included, so it never holds the new time back.
    update private.automation_runs r set status='stopped',reason='Appointment was rescheduled',ended_at=clock_timestamp(),
        updated_at=clock_timestamp(),lease_token=null,leased_until=null,held_since=null
      from private.automation_events origin
      where origin.organization_id=r.organization_id and origin.id=r.event_id and origin.subject ? 'appointment_id'
        and origin.subject->>'appointment_id'=e.subject->>'appointment_id'
        and r.organization_id=e.organization_id and r.workflow_id=candidate.workflow_id
        and r.status in ('queued','waiting','held','unknown')
        and private.automation_restarts_for_new_time(r.organization_id,r.id,r.version_id,(e.subject->>'appointment_id')::uuid);
    -- Any other run still following this appointment moves with it instead of starting again, and a
    -- slot a run has already waited for is never handled twice.
    if exists(select 1 from private.automation_runs r join private.automation_events origin
        on origin.organization_id=r.organization_id and origin.id=r.event_id
      where r.organization_id=e.organization_id and r.workflow_id=candidate.workflow_id
        and origin.subject ? 'appointment_id' and origin.subject->>'appointment_id'=e.subject->>'appointment_id'
        and (r.status in ('queued','waiting','held','unknown')
          or (r.anchor_id=slot.occurrence_id and r.reason is distinct from 'Appointment was rescheduled'))) then return 0; end if;
  end if;

  if halt is null and e.contact_id is not null
      and candidate.graph#>>'{settings,stop_on_reply}'='true' and exists(
    select 1 from private.automation_reply_watermarks m where m.organization_id=e.organization_id
      and m.contact_type=coalesce(e.contact_type,'lead') and m.contact_id=e.contact_id and m.latest_reply_at>=e.occurred_at
  ) then halt:='Verified reply received'; end if;
  -- A run whose stop condition already happened has ended, even when no worker has looked at it since.
  for prior in select r.* from private.automation_runs r where r.organization_id=e.organization_id
      and r.workflow_id=candidate.workflow_id and r.status in ('queued','waiting','held')
      and r.scope_key=scope for update loop
    perform private.automation_settle_stop(prior);
  end loop;
  reentry:=candidate.graph#>>'{settings,reentry}';
  if exists(select 1 from private.automation_runs r where r.organization_id=e.organization_id
    and r.workflow_id=candidate.workflow_id and r.scope_key=scope
    and case reentry
      when 'after_completion' then r.status<>'completed' or r.ended_at>e.occurred_at
      when 'after_end' then r.status not in ('completed','stopped','failed') or r.ended_at is null or r.ended_at>e.occurred_at
      else true end) then return 0; end if;
  insert into private.automation_runs(organization_id,workflow_id,version_id,event_id,contact_id,contact_type,scope_key,
      current_node_id,status,reason,ended_at,paced_from)
    values(e.organization_id,candidate.workflow_id,candidate.version_id,e.id,e.contact_id,
      case when e.contact_id is null then null else coalesce(e.contact_type,'lead') end,scope,first_node,
      case when halt is not null then 'stopped' else 'queued' end,
      halt,case when halt is not null then clock_timestamp() end,
      greatest(e.occurred_at,stood_again))
    on conflict do nothing;
  return case when found then 1 else 0 end;
end $$;

-- An appointment moved, was cancelled or was removed. Unfinished runs following it stop when the
-- appointment no longer stands, and a pending reminder moves to the new time.
CREATE FUNCTION private.automation_refresh_appointment_runs(p_org uuid,p_appointment text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior private.automation_runs; node jsonb; placed record; current_slot record; booked private.automation_events;
  person record; flow record; window_id uuid; stood_at timestamptz; reopened timestamptz;
BEGIN
  -- The appointment stands again at a time still to come, so no cancellation of it is in effect: on each
  -- automation, the latest run that followed this appointment carries on from the step it was on when a
  -- cancellation is what stopped it. That covers taking a cancellation back on the same slot, a cancellation
  -- restated by retyping, and reopening an appointment that was moved while it was cancelled (its new slot has
  -- no outcome to take back). A run is passed over when the automation has a live run for the appointment or a
  -- later run for it, so reminders resume exactly once, and when a verified reply after the booking it followed
  -- ended it for an automation that stops on a reply. A plain wait that had started keeps
  -- its end, or ends at the reopening when that end passed while the appointment was cancelled. Any other step runs
  -- again now, and the worker places an appointment wait against the appointment's time again, so a reminder time that
  -- passed in the meantime follows the step's own rule. Nothing the run does after it carries on counts from a moment
  -- while it was cancelled, so a task it creates is never due before the recorded moment the appointment stood again.
  -- A run whose reminders were for an earlier time is treated as a move of an appointment that stood: when every
  -- reminder it passed is still ahead for the new time (automation_restarts_for_new_time), the automation starts over
  -- for the new time through the normal admission of the new slot's booking, so the new time gets every reminder,
  -- whenever the worker sees the changes. If that admission refuses, the run carries on as above.
  -- When the worker first saw the booking while the appointment was cancelled, there is no run to carry on: each
  -- automation that followed the appointment then admits the current slot's booking normally, once.
  SELECT s.occurrence_id,s.starts_at,s.head_outcome,s.outcome_at INTO current_slot
    FROM private.automation_appointment_state(p_org,p_appointment::uuid) s;
  IF FOUND AND coalesce(current_slot.head_outcome,'retracted')='retracted' AND current_slot.starts_at>clock_timestamp() THEN
    -- Decided under the locks admission takes for this contact and appointment, so a run carried on here and a run
    -- admitted for the appointment at the same moment never both follow it.
    SELECT e.contact_id,e.contact_type INTO person FROM private.automation_events e
      WHERE e.organization_id=p_org AND e.event_type='appointment_booked' AND e.subject->>'appointment_id'=p_appointment
        AND e.contact_id IS NOT NULL ORDER BY e.id DESC LIMIT 1;
    IF FOUND THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('automation-contact:'||p_org::text||
        coalesce(person.contact_type,'lead')||person.contact_id::text,0));
    END IF;
    FOR flow IN SELECT DISTINCT r.workflow_id FROM private.automation_runs r JOIN private.automation_events origin
        ON origin.organization_id=r.organization_id AND origin.id=r.event_id
      WHERE r.organization_id=p_org AND r.status='stopped' AND r.reason='Appointment was cancelled'
        AND origin.event_type='appointment_booked' AND origin.subject->>'appointment_id'=p_appointment
      ORDER BY r.workflow_id LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('automation-scope:'||flow.workflow_id::text||'appointment:'||p_appointment,0));
    END LOOP;
    SELECT * INTO booked FROM private.automation_events e WHERE e.organization_id=p_org AND e.event_type='appointment_booked'
      AND e.subject->>'appointment_id'=p_appointment AND e.subject->>'occurrence_id'=current_slot.occurrence_id::text
      ORDER BY e.id DESC LIMIT 1;
    -- When the appointment stood again, as recorded: its latest reopening in its own change log, or the latest retraction
    -- of a cancellation on its current slot. A late worker moves nothing.
    SELECT max(x.observed_at) INTO stood_at FROM private.appointment_evidence_observations x
      WHERE x.organization_id=p_org AND x.appointment_id=p_appointment::uuid AND x.op='UPDATE'
        AND private.appointment_status_key(x.prev->>'status')='cancelled'
        AND private.appointment_status_key(x.next->>'status')='open';
    IF current_slot.head_outcome='retracted' THEN stood_at:=greatest(stood_at,current_slot.outcome_at); END IF;
    stood_at:=least(coalesce(stood_at,clock_timestamp()),clock_timestamp());
    FOR prior IN SELECT r.* FROM private.automation_runs r
        JOIN private.automation_events origin ON origin.organization_id=r.organization_id AND origin.id=r.event_id
        JOIN public.workflows w ON w.organization_id=r.organization_id AND w.id=r.workflow_id AND w.status IN ('active','paused')
        JOIN public.workflow_versions v ON v.organization_id=r.organization_id AND v.id=r.version_id
      WHERE r.organization_id=p_org AND r.status='stopped' AND r.reason='Appointment was cancelled'
        AND origin.event_type='appointment_booked' AND origin.subject->>'appointment_id'=p_appointment
        AND NOT EXISTS (SELECT 1 FROM private.automation_runs other JOIN private.automation_events later
            ON later.organization_id=other.organization_id AND later.id=other.event_id
          WHERE other.organization_id=p_org AND other.workflow_id=r.workflow_id AND other.id<>r.id
            AND later.subject ? 'appointment_id' AND later.subject->>'appointment_id'=p_appointment
            AND (other.status IN ('queued','waiting','held','unknown') OR later.occurred_at>origin.occurred_at))
        AND NOT (v.graph#>>'{settings,stop_on_reply}'='true' AND origin.contact_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM private.automation_reply_watermarks m WHERE m.organization_id=p_org
            AND m.contact_type=coalesce(origin.contact_type,'lead') AND m.contact_id=origin.contact_id
            AND m.latest_reply_at>=origin.occurred_at))
      ORDER BY r.id FOR UPDATE OF r
    LOOP
      IF booked.id IS NOT NULL AND private.automation_restarts_for_new_time(p_org,prior.id,prior.version_id,p_appointment::uuid) THEN
        SELECT i.id INTO window_id FROM public.automation_intervals i
          WHERE i.organization_id=p_org AND i.workflow_id=prior.workflow_id AND i.starts_at<=booked.occurred_at
            AND (i.ends_at IS NULL OR i.ends_at>booked.occurred_at) ORDER BY i.id DESC LIMIT 1;
        IF FOUND THEN
          -- Admission counts the new run from the recorded reopening.
          IF private.automation_admit_event(booked,window_id)=1 THEN CONTINUE; END IF;
          -- A paused automation keeps the booking and starts over for it when it resumes.
          IF EXISTS (SELECT 1 FROM private.automation_deferred_admissions d WHERE d.organization_id=p_org
              AND d.event_id=booked.id AND d.interval_id=window_id) THEN CONTINUE; END IF;
        END IF;
      END IF;
      UPDATE private.automation_runs r SET
          status=CASE WHEN private.automation_waiting_out(r) THEN 'waiting' ELSE 'queued' END,
          due_at=CASE WHEN private.automation_waiting_out(r) THEN greatest(r.due_at,stood_at) ELSE clock_timestamp() END,
          paced_from=greatest(r.paced_from,stood_at),
          reason=NULL,ended_at=NULL,updated_at=clock_timestamp(),held_since=NULL,
          workflow_paused=(SELECT w.status='paused' FROM public.workflows w WHERE w.organization_id=r.organization_id AND w.id=r.workflow_id)
        WHERE r.id=prior.id AND r.organization_id=p_org;
    END LOOP;
    -- A booking the worker first saw while the appointment was cancelled started no run, so nothing above carries on.
    -- Once the appointment's own change log shows it opened again after the current slot was booked, each automation
    -- that followed the appointment (automation_following_since) admits that booking through the normal admission.
    -- Admission applies every eligibility rule (its filters, the slot still ahead without an outcome, re-entry), counts
    -- the stop rules from when the automation began following the appointment, takes the same locks, counts the run from
    -- the reopening, and starts at most one run per automation and booking however often the reopening is seen. It
    -- refuses while a run still follows the appointment, such as one carried on above, and lets a run that already
    -- finished for an earlier time be followed by one for this time. The automation on when the slot was booked admits
    -- it, or else the one on at the reopening, or else the one that began following the appointment, which keeps the
    -- booking while paused until it resumes. An ordinary move of an appointment that stood is left to the booking's own
    -- admission.
    IF booked.id IS NOT NULL THEN
      SELECT max(x.observed_at) INTO reopened FROM private.appointment_evidence_observations x
        WHERE x.organization_id=p_org AND x.appointment_id=p_appointment::uuid AND x.op='UPDATE'
          AND x.observed_at>booked.occurred_at
          AND private.appointment_status_key(x.prev->>'status')='cancelled'
          AND private.appointment_status_key(x.next->>'status')='open';
    END IF;
    IF reopened IS NOT NULL THEN
      FOR flow IN SELECT f.workflow_id,f.since FROM (SELECT w.id AS workflow_id,
            private.automation_following_since(p_org,w.id,p_appointment) AS since
          FROM public.workflows w WHERE w.organization_id=p_org AND w.status IN ('active','paused')) f
        WHERE f.since IS NOT NULL ORDER BY f.workflow_id LOOP
        SELECT i.id INTO window_id FROM public.automation_intervals i
          JOIN public.workflow_versions v ON v.organization_id=i.organization_id AND v.workflow_id=i.workflow_id AND v.id=i.version_id
          WHERE i.organization_id=p_org AND i.workflow_id=flow.workflow_id
            AND private.automation_trigger(v.graph)->>'type'='appointment_booked'
            AND ((i.starts_at<=booked.occurred_at AND (i.ends_at IS NULL OR i.ends_at>booked.occurred_at))
              OR (i.starts_at<=reopened AND (i.ends_at IS NULL OR i.ends_at>reopened))
              OR (i.starts_at<=flow.since AND (i.ends_at IS NULL OR i.ends_at>flow.since)))
          ORDER BY CASE WHEN i.starts_at<=booked.occurred_at AND (i.ends_at IS NULL OR i.ends_at>booked.occurred_at) THEN 0
              WHEN i.starts_at<=reopened AND (i.ends_at IS NULL OR i.ends_at>reopened) THEN 1 ELSE 2 END,i.id DESC
          LIMIT 1;
        IF FOUND THEN PERFORM private.automation_admit_event(booked,window_id); END IF;
      END LOOP;
    END IF;
  END IF;
  FOR prior IN SELECT r.* FROM private.automation_runs r JOIN private.automation_events origin
      ON origin.organization_id=r.organization_id AND origin.id=r.event_id
    WHERE r.organization_id=p_org AND origin.organization_id=p_org AND origin.subject ? 'appointment_id'
      AND origin.subject->>'appointment_id'=p_appointment
      AND r.status IN ('queued','waiting','held') ORDER BY r.id FOR UPDATE OF r LOOP
    IF private.automation_settle_stop(prior) OR prior.status<>'waiting' OR prior.anchor_id IS NULL THEN CONTINUE; END IF;
    -- Every pending reminder moves to the new time. A run that starts over for the new time is then stopped
    -- when that time is admitted; if the admission refuses, the run already waits for the right time.
    SELECT n INTO node FROM public.workflow_versions v,jsonb_array_elements(v.graph->'nodes') n
      WHERE v.organization_id=prior.organization_id AND v.workflow_id=prior.workflow_id AND v.id=prior.version_id
        AND n->>'id'=prior.current_node_id AND n->>'type'='wait_until_before_appointment';
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO placed FROM private.automation_appointment_wait(p_org,p_appointment::uuid,node);
    IF placed.verdict='gone' OR placed.anchor=prior.anchor_id THEN CONTINUE; END IF;
    IF placed.verdict IN ('wait','advance') THEN
      UPDATE private.automation_runs SET anchor_id=placed.anchor,anchor_at=placed.anchor_start,
        due_at=CASE placed.verdict WHEN 'wait' THEN placed.due ELSE clock_timestamp() END,updated_at=clock_timestamp()
        WHERE id=prior.id AND organization_id=prior.organization_id;
    ELSE
      INSERT INTO private.automation_steps(organization_id,run_id,node_id,status,reason)
        VALUES(prior.organization_id,prior.id,prior.current_node_id,'skipped','The reminder time had already passed')
        ON CONFLICT (run_id,node_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,updated_at=clock_timestamp();
      UPDATE private.automation_runs SET status='completed',reason='The reminder time had already passed',
        anchor_id=placed.anchor,anchor_at=placed.anchor_start,ended_at=clock_timestamp(),updated_at=clock_timestamp(),
        lease_token=NULL,leased_until=NULL WHERE id=prior.id AND organization_id=prior.organization_id;
    END IF;
  END LOOP;
END $$;

-- Recovered intake keeps every original fact, including the contact type, event facts and scope.
CREATE OR REPLACE FUNCTION public.automation_process_events(p_limit integer default 10)
returns integer language plpgsql security definer set search_path='' as $$
declare
  e private.automation_events;
  candidate record;
  recovery private.automation_intake_recovery;
  visited integer;
  last_interval uuid;
  count_enrolled integer:=0;
  bounded integer:=least(25,greatest(1,coalesce(p_limit,10)));
  cutoff timestamptz:=clock_timestamp();
begin
  for recovery in select * from private.automation_intake_recovery
    where retry_at<=cutoff order by retry_at,id limit bounded for update skip locked
  loop
    begin
      insert into private.automation_events(organization_id,event_type,source_id,source_revision,contact_id,contact_type,
          campaign_id,lead_source,occurred_at,subject,scope_key,available_at)
        values(recovery.organization_id,recovery.event_type,recovery.source_id,1,recovery.contact_id,
          case when recovery.contact_id is null then null else coalesce(recovery.contact_type,'lead') end,
          recovery.campaign_id,recovery.lead_source,recovery.occurred_at,coalesce(recovery.subject,'{}'::jsonb),recovery.scope_key,
          greatest(cutoff,coalesce(recovery.available_at,cutoff)))
        on conflict do nothing;
      delete from private.automation_intake_recovery where id=recovery.id and organization_id=recovery.organization_id;
    exception when others then
      update private.automation_intake_recovery set attempts=attempts+1,last_sqlstate=sqlstate,
        retry_at=cutoff+interval '1 minute' where id=recovery.id and organization_id=recovery.organization_id;
      raise warning 'Automation intake repair delayed (SQLSTATE %)',sqlstate;
    end;
  end loop;

  -- A paused workflow never holds another interval behind its cursor.
  for candidate in select d.organization_id,d.event_id,d.interval_id from private.automation_deferred_admissions d
    join public.workflows w on w.id=d.workflow_id and w.organization_id=d.organization_id
    join private.automation_release_controls c on c.organization_id=w.organization_id
    where w.status<>'paused' and c.enrollment_enabled and d.retry_at<=cutoff order by d.retry_at,d.event_id,d.interval_id
    limit bounded for update of d skip locked for share of w,c
  loop
    begin
      select * into strict e from private.automation_events where id=candidate.event_id and organization_id=candidate.organization_id;
      count_enrolled:=count_enrolled+private.automation_admit_event(e,candidate.interval_id);
      delete from private.automation_deferred_admissions where event_id=e.id and interval_id=candidate.interval_id
        and organization_id=candidate.organization_id;
    exception when others then
      update private.automation_deferred_admissions set attempts=attempts+1,last_sqlstate=sqlstate,retry_at=cutoff+interval '1 minute'
        where event_id=candidate.event_id and interval_id=candidate.interval_id and organization_id=candidate.organization_id;
      raise warning 'Automation admission repair delayed (SQLSTATE %)',sqlstate;
    end;
  end loop;

  for e in select ev.* from private.automation_events ev
    join private.automation_release_controls ctl using(organization_id)
    where ev.processed_at is null and ev.available_at<=cutoff and ctl.enrollment_enabled
    order by ev.available_at,ev.id limit bounded for update of ev skip locked for share of ctl
  loop
    if e.event_type='appointment_changed' then
      begin
        perform private.automation_refresh_appointment_runs(e.organization_id,e.subject->>'appointment_id');
        update private.automation_events set processed_at=clock_timestamp(),available_at=clock_timestamp() where id=e.id;
      exception when others then
        -- Every run is still checked against the appointment when it is next leased.
        update private.automation_events set available_at=cutoff+interval '1 minute' where id=e.id;
        raise warning 'Automation appointment refresh delayed (SQLSTATE %)',sqlstate;
      end;
      continue;
    end if;
    visited:=0;
    last_interval:=e.interval_cursor;
    for candidate in select i.id,i.workflow_id from public.automation_intervals i
      where i.organization_id=e.organization_id and i.starts_at<=e.occurred_at
        and (i.ends_at is null or i.ends_at>e.occurred_at)
        and (e.interval_cursor is null or i.id>e.interval_cursor)
      order by i.id limit 25
    loop
      visited:=visited+1;
      last_interval:=candidate.id;
      begin
        count_enrolled:=count_enrolled+private.automation_admit_event(e,candidate.id);
      exception when others then
        insert into private.automation_deferred_admissions(organization_id,event_id,interval_id,workflow_id,retry_at,attempts,last_sqlstate)
          values(e.organization_id,e.id,candidate.id,candidate.workflow_id,cutoff+interval '1 minute',1,sqlstate)
          on conflict(event_id,interval_id) do nothing;
        raise warning 'Automation admission retained for repair (SQLSTATE %)',sqlstate;
      end;
    end loop;
    update private.automation_events set processed_at=case when visited<25 then clock_timestamp() end,
      available_at=clock_timestamp(),interval_cursor=last_interval where id=e.id;
  end loop;
  -- Late-answer cleanup that a busy callback or task held up when the answer was recorded. Last, so the rows it
  -- closes stay locked only until this pass commits. It is installed by the inbound callbacks migration, so an
  -- installation stopped before that file has nothing to finish.
  if to_regprocedure('private.automation_retry_answer_settlements(integer)') is not null then
    perform private.automation_retry_answer_settlements(bounded);
  end if;
  return count_enrolled;
end $$;

REVOKE ALL ON FUNCTION private.automation_contact_type(uuid,uuid),private.automation_contact_owner(uuid,text,uuid),
  private.automation_agency_time_zone(uuid),
  private.automation_record_event(uuid,text,uuid,uuid,text,jsonb,text,interval),
  private.automation_capture_disposition(),private.automation_capture_sale(),
  private.automation_appointment_state(uuid,uuid),private.automation_appointment_wait(uuid,uuid,jsonb),
  private.automation_following_since(uuid,uuid,text),private.automation_contact_stop(uuid,jsonb,uuid,timestamptz,text,uuid),
  private.automation_stop_check(private.automation_runs),private.automation_settle_stop(private.automation_runs),
  private.automation_restarts_for_new_time(uuid,uuid,uuid,uuid),
  private.automation_waiting_out(private.automation_runs),private.automation_awaits_restart(private.automation_runs),
  private.automation_refresh_appointment_runs(uuid,text)
  FROM PUBLIC,anon,authenticated;
COMMIT;
