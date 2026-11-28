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
  ADD COLUMN paced_from timestamptz,
  -- For a booking taken up because its appointment was reopened, the moment its stop rules count from
  -- (automation_stops_from), and for a run carried on by a move back to the time its reminders were for, the same
  -- moment for that move back. Empty for every other run, whose stop rules count from its event.
  ADD COLUMN stops_from timestamptz,
  -- For a run a stop rule ended (a verified reply, a conversation, another booking) that a move back then recorded as
  -- replaced ('Appointment was moved back'), that stop rule's reason, so its end still holds the times the run followed
  -- at send time (automation_time_stopped). The same for a run recorded as rescheduled ('Appointment was rescheduled')
  -- that such a fact had ended while it still followed the time its reminders were for, before that end was recorded;
  -- a move back to that time finds it. Empty for every other run.
  ADD COLUMN replaced_stop_reason text;
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

-- When an appointment booked at p_at stood again after a cancellation, as its own change log records it: the latest
-- reopening after the booking, or the save that opened the booked slot when that save was one (one calendar save that
-- moves and reopens it). Null when it was not reopened; given -infinity, the latest reopening of all. A reopening is a
-- save that left the appointment open when it was cancelled after the save that last left it open: from Cancelled, or
-- from a status it was changed to since (No Show, Completed, or one the outcome record ignores), whether on the slot
-- that was cancelled or on one it was moved to while cancelled. It dates such a save whoever made it, a calendar sync's
-- included, though the change log records who saved (actor_id, empty for a sync); whether the cancellation is then
-- over is the slot's to say (automation_appointment_state): a sync's save takes back only a cancellation a sync
-- recorded, and a slot opened by a move made while cancelled holds no outcome, so there a sync's save reopens it, a
-- policy choice left to the owner. A No Show or Completed taken back with no cancellation since the appointment last
-- stood is not one.
CREATE FUNCTION private.automation_stood_again(p_org uuid,p_appointment uuid,p_at timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT max(x.observed_at) FROM private.appointment_evidence_observations x
  WHERE x.organization_id=p_org AND x.appointment_id=p_appointment AND x.op='UPDATE'
    AND private.appointment_status_key(x.next->>'status')='open'
    AND (private.appointment_status_key(x.prev->>'status')='cancelled'
      OR (private.appointment_status_key(x.prev->>'status') IS DISTINCT FROM 'open' AND EXISTS (
        SELECT 1 FROM private.appointment_evidence_observations z
        WHERE z.organization_id=p_org AND z.appointment_id=p_appointment AND z.id<x.id
          AND z.id>coalesce((SELECT w.id FROM private.appointment_evidence_observations w
            WHERE w.organization_id=p_org AND w.appointment_id=p_appointment AND w.id<x.id
              AND private.appointment_status_key(w.next->>'status')='open' ORDER BY w.id DESC LIMIT 1),0)
          AND 'cancelled' IN (private.appointment_status_key(z.prev->>'status'),
            private.appointment_status_key(z.next->>'status')))))
    AND (x.observed_at>p_at OR x.id=(SELECT o.id FROM private.appointment_evidence_observations o
      WHERE o.organization_id=p_org AND o.appointment_id=p_appointment AND o.observed_at<=p_at ORDER BY o.id DESC LIMIT 1))
$$;

-- The appointment's current open slot with its latest recorded outcome. A slot with no outcome in effect (none
-- recorded, or a cancellation taken back) takes the appointment's own status when that is final: moving a cancelled
-- appointment opens a new slot without restating the cancellation, and a cancellation whose record could not be
-- written in time (a capture gap) still shows on the appointment itself. A status the outcome record ignores counts as
-- cancelled while the change log shows a cancellation since the save that last left the appointment open, so a move
-- made in such a status after a cancellation opens a slot that is still cancelled. Such a slot never reads as a live
-- appointment to remind about. A save without a signed-in person (a calendar sync) records no retraction, and it takes
-- back only a cancellation such a save recorded: that cancellation reads as taken back at the appointment's latest
-- reopening after it in the change log (automation_stood_again). A person's retype restates the slot's outcome under
-- the person; a restated cancellation is judged by the record it restates, found by following the record's chain back
-- past each retype, not by recorded times, which can tie or step back with the clock. A person's cancellation,
-- No Show or Completed on the slot, retyped or not, stands over a sync's save, because the two-way sync writes
-- Scheduled over every changed event that Google does not show as cancelled, an event the CRM's own update changed
-- after a person cancelled in the CRM included. A slot opened by a move made while the appointment was cancelled holds
-- no outcome, so there the appointment's own status decides, whoever saved it, a sync's one save that moves the
-- appointment and writes Scheduled included. That is a policy choice left to the owner: the change log records who
-- saved (actor_id, empty for a sync), so that case could wait for a person's save instead.
CREATE FUNCTION private.automation_appointment_state(p_org uuid,p_appointment uuid)
RETURNS TABLE(occurrence_id uuid,starts_at timestamptz,head_outcome text,outcome_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT o.id,o.scheduled_start,coalesce(nullif(head.outcome,'retracted'),crm.final,head.outcome),
    CASE WHEN head.outcome IS NOT NULL AND head.outcome<>'retracted' THEN head.recorded_at
      WHEN crm.final IS NOT NULL AND head.outcome IS NULL THEN o.opened_at
      WHEN crm.final IS NOT NULL THEN greatest(head.recorded_at,crm.updated_at)
      ELSE head.recorded_at END
  FROM private.appointment_occurrences o
  LEFT JOIN LATERAL (
    SELECT CASE WHEN back.at IS NOT NULL THEN 'retracted' ELSE raw.outcome END AS outcome,
      coalesce(back.at,raw.recorded_at) AS recorded_at
    FROM (SELECT oe.outcome,oe.recorded_at,oe.actor_kind,oe.source,oe.supersedes_event_id
      FROM private.appointment_outcome_events oe
      WHERE oe.occurrence_id=o.id AND NOT EXISTS (
        SELECT 1 FROM private.appointment_outcome_events newer WHERE newer.supersedes_event_id=oe.id)
      LIMIT 1) raw
    LEFT JOIN LATERAL (WITH RECURSIVE restated AS (
        SELECT p.actor_kind,p.recorded_at,p.source,p.supersedes_event_id FROM private.appointment_outcome_events p
        WHERE raw.outcome='cancelled' AND raw.source='reclassified' AND p.id=raw.supersedes_event_id
        UNION ALL
        SELECT p.actor_kind,p.recorded_at,p.source,p.supersedes_event_id FROM restated s
        JOIN private.appointment_outcome_events p ON p.id=s.supersedes_event_id WHERE s.source='reclassified')
      SELECT s.actor_kind,s.recorded_at FROM restated s WHERE s.source<>'reclassified') stated ON true
    LEFT JOIN LATERAL (SELECT private.automation_stood_again(o.organization_id,o.appointment_id,
        coalesce(stated.recorded_at,raw.recorded_at)) AS at
      WHERE raw.outcome='cancelled' AND coalesce(stated.actor_kind,raw.actor_kind)='system') back ON true) head ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN private.appointment_status_key(a.status) IS NOT NULL
        THEN nullif(private.appointment_status_key(a.status),'open')
      WHEN EXISTS (SELECT 1 FROM private.appointment_evidence_observations z
          WHERE z.organization_id=o.organization_id AND z.appointment_id=o.appointment_id
            AND z.id>coalesce((SELECT w.id FROM private.appointment_evidence_observations w
              WHERE w.organization_id=o.organization_id AND w.appointment_id=o.appointment_id
                AND private.appointment_status_key(w.next->>'status')='open' ORDER BY w.id DESC LIMIT 1),0)
            AND 'cancelled' IN (private.appointment_status_key(z.prev->>'status'),
              private.appointment_status_key(z.next->>'status')))
        THEN 'cancelled' END AS final,a.updated_at
    FROM public.appointments a
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
-- was on with a booking trigger, or null when it never followed the appointment.
CREATE FUNCTION private.automation_following_since(p_org uuid,p_workflow uuid,p_appointment text)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT min(b.occurred_at) FROM private.automation_events b
  WHERE b.organization_id=p_org AND b.event_type='appointment_booked' AND b.subject ? 'appointment_id'
    AND b.subject->>'appointment_id'=p_appointment
    AND EXISTS (SELECT 1 FROM public.automation_intervals i
      JOIN public.workflow_versions v ON v.organization_id=i.organization_id AND v.workflow_id=i.workflow_id AND v.id=i.version_id
      WHERE i.organization_id=p_org AND i.workflow_id=p_workflow AND i.starts_at<=b.occurred_at
        AND (i.ends_at IS NULL OR i.ends_at>b.occurred_at)
        AND private.automation_trigger(v.graph)->>'type'='appointment_booked')
$$;

-- The moment a booking taken up because its appointment was reopened is judged from, as the run that followed the
-- appointment would have been: the latest of the appointment's bookings up to this one that the automation followed
-- (made while it was on with a booking trigger) and whose save left the appointment standing: a booking, or a move of
-- an appointment that stood. A save that opened the slot counts as standing only when it left the appointment open
-- (or in a status the outcome record ignores) and no save since the one that last left it open, that save included,
-- has Cancelled as its previous or next status, the window automation_stood_again uses. So a save made while the
-- appointment was cancelled never counts, nor one that moves and reopens it, from Cancelled or from a status it was
-- changed to after the cancellation (No Show, Completed, or one the outcome record ignores). An ordinary move counts
-- from itself, as it would have had the worker seen it before the cancellation. When the automation followed no such
-- booking, from when it began following the appointment, so an appointment entered as cancelled is judged from that
-- entry. Never later than the booking itself: automation_cancel_reply ends a run whose booking came before the reply,
-- so a reply verified after admission gives the same answer as one verified before it. A move back to the time a run's
-- reminders were for is judged by the same rule (automation_refresh_appointment_runs).
CREATE FUNCTION private.automation_stops_from(p_org uuid,p_workflow uuid,p_appointment text,p_at timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce((SELECT max(b.occurred_at) FROM private.automation_events b
    WHERE b.organization_id=p_org AND b.event_type='appointment_booked' AND b.subject ? 'appointment_id'
      AND b.subject->>'appointment_id'=p_appointment AND b.occurred_at<=p_at
      AND EXISTS (SELECT 1 FROM (SELECT x.id,x.next FROM private.appointment_evidence_observations x
          WHERE x.organization_id=p_org AND x.appointment_id=p_appointment::uuid AND x.observed_at<=b.occurred_at
          ORDER BY x.id DESC LIMIT 1) opening
        WHERE coalesce(private.appointment_status_key(opening.next->>'status'),'open')='open'
          AND NOT EXISTS (SELECT 1 FROM private.appointment_evidence_observations z
            WHERE z.organization_id=p_org AND z.appointment_id=p_appointment::uuid AND z.id<=opening.id
              AND z.id>coalesce((SELECT w.id FROM private.appointment_evidence_observations w
                WHERE w.organization_id=p_org AND w.appointment_id=p_appointment::uuid AND w.id<opening.id
                  AND private.appointment_status_key(w.next->>'status')='open' ORDER BY w.id DESC LIMIT 1),0)
              AND 'cancelled' IN (private.appointment_status_key(z.prev->>'status'),
                private.appointment_status_key(z.next->>'status'))))
      AND EXISTS (SELECT 1 FROM public.automation_intervals i
        JOIN public.workflow_versions v ON v.organization_id=i.organization_id AND v.workflow_id=i.workflow_id AND v.id=i.version_id
        WHERE i.organization_id=p_org AND i.workflow_id=p_workflow AND i.starts_at<=b.occurred_at
          AND (i.ends_at IS NULL OR i.ends_at>b.occurred_at)
          AND private.automation_trigger(v.graph)->>'type'='appointment_booked')),
    least(p_at,coalesce(private.automation_following_since(p_org,p_workflow,p_appointment),p_at)))
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
    -- A deletion the slot record missed (a capture gap) still ends the run: the calendar row is gone, and no later
    -- save can repair the record.
    ELSIF NOT EXISTS (SELECT 1 FROM public.appointments a WHERE a.organization_id=r.organization_id
        AND a.id=nullif(e.subject->>'appointment_id','')::uuid) THEN
      RETURN QUERY SELECT 'Appointment was removed'::text,clock_timestamp(); RETURN;
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
    -- A deletion the slot record missed ends a run started by an outcome too: the calendar row is gone.
    ELSIF NOT EXISTS (SELECT 1 FROM public.appointments a WHERE a.organization_id=r.organization_id
        AND a.id=nullif(e.subject->>'appointment_id','')::uuid) THEN
      RETURN QUERY SELECT 'Appointment was removed'::text,clock_timestamp(); RETURN;
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
  -- A later booking or a conversation ends the run, counted from the event that started it, or for a booking taken up
  -- because its appointment was reopened, from the moment admission judged it from (stops_from). That includes a fact
  -- recorded after admission, such as a call under way at the reopening whose length is written when it ends.
  IF r.stops_from IS NOT NULL AND settings->>'stop_on_reply'='true' THEN
    -- automation_cancel_reply ends the runs whose event came before the reply; a reply verified after admission but
    -- received after the moment a reopened booking is judged from ends this run here.
    RETURN QUERY SELECT 'Verified reply received'::text,m.latest_reply_at FROM private.automation_reply_watermarks m
      WHERE m.organization_id=r.organization_id AND m.contact_type=r.contact_type AND m.contact_id=r.contact_id
        AND m.latest_reply_at>=r.stops_from;
    IF FOUND THEN RETURN; END IF;
  END IF;
  RETURN QUERY SELECT s.stop_reason,s.stopped_at FROM private.automation_contact_stop(r.organization_id,settings,r.contact_id,
    coalesce(r.stops_from,e.occurred_at),e.subject->>'appointment_id',
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

-- The time the appointment stood at a moment, by its own change log: the start of the latest save at or before that
-- moment that left it standing, an open status or a status the outcome record ignores with no cancellation (as a
-- save's previous or next status) since the save that last left it open. A save that leaves it Cancelled, No Show or
-- Completed is passed over, so an appointment moved while it was cancelled still stood at its time before the
-- cancellation. Null when no such save was recorded by then.
CREATE FUNCTION private.automation_stood_at(p_org uuid,p_appointment uuid,p_at timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT (x.next->>'start_time')::timestamptz FROM private.appointment_evidence_observations x
  WHERE x.organization_id=p_org AND x.appointment_id=p_appointment AND x.observed_at<=p_at
    AND (private.appointment_status_key(x.next->>'status')='open'
      OR (x.op<>'DELETE' AND private.appointment_status_key(x.next->>'status') IS NULL AND NOT EXISTS (
        SELECT 1 FROM private.appointment_evidence_observations z
        WHERE z.organization_id=p_org AND z.appointment_id=p_appointment AND z.id<=x.id
          AND z.id>coalesce((SELECT w.id FROM private.appointment_evidence_observations w
            WHERE w.organization_id=p_org AND w.appointment_id=p_appointment AND w.id<x.id
              AND private.appointment_status_key(w.next->>'status')='open' ORDER BY w.id DESC LIMIT 1),0)
          AND 'cancelled' IN (private.appointment_status_key(z.prev->>'status'),
            private.appointment_status_key(z.next->>'status')))))
  ORDER BY x.id DESC LIMIT 1
$$;

-- Whether a run a booking started holds a time of its appointment. Reopened at a time held so, the automation starts
-- nothing (admission), the cancellation carry-on carries on to it no run that never followed it, and a move back
-- carries no run on there. By how the run ended:
-- (a) Completed: the time it ended at, which is the slot of its appointment wait (anchor_id), else the slot its
--     reminders were for (reminded_for), else its booking's slot. A run with neither (it never reached an appointment
--     wait) also holds the time the appointment stood at when it ended (automation_stood_at). Failed: the same, but
--     only once it gave something other than the message that failed (an intent handed off, accepted or unknown, or a
--     task receipt). A run that failed at its first message gave its time nothing, so that time still gets its
--     reminders. Neither holds a time while a text the automation gave the appointment there is owed its one retry,
--     whichever run gave it (the reminder record, automation_step_record, and the retry window, automation_retry_open):
--     a reopening there starts a run that sends that text once more and skips what was given.
-- (b) Stopped by a person ('Stopped by user'): every time it followed. That is the times in (a), the time the
--     appointment stood at when it was stopped, whatever slot its appointment wait still names, and each time the
--     appointment stood at when the run gave something: a message handed to a provider (an intent no longer
--     'prepared') or a task (a task receipt). A message is dated by its handoff (automation_messages.authorized_at for
--     its run and step, written with the handoff under the appointment's share lock), else, with no message record
--     (as with synthetic transports), by its intent's created_at; a task by its receipt's created_at.
-- (c) Stopped after seven days on hold: the times in (b), but only while it is the automation's latest booking run
--     for the appointment (every later booking run of the automation counts, also one a move back later replaced), or
--     once it gave something. So a run the hold stopped before anything went out holds no time once a later run has
--     followed another time, and a reopening at its time gets the reminders the hold kept from going out.
-- (d) Deliberately, a completed or failed run does not hold a time it passed through and then left (it gave part of
--     that time's sequence and then followed another time): holding it would leave the current time without
--     reminders it is still owed, so such a reopening starts the sequence over, as does the outcome hold's take-back
--     of a later run that never reached an appointment wait and followed an ordinary move back to that time. What was
--     given there is not given again: the reminder record skips each step already given for the time
--     (automation_step_record), and a run reaching a reminder wait whose time passed goes on when another run already
--     gave that reminder (automation_caught_up), so only what the time is still owed goes out. A run stopped any other
--     way holds nothing here: a cancellation's stop is the carry-on's to decide, and a stop rule's (a verified reply, a
--     conversation, another booking) is admission's. At send time, a person's stop and a stop rule's end still hold the
--     times their run followed (automation_time_stopped), a stop rule's end also after a move back recorded its run as
--     replaced, and one a run recorded as rescheduled met before that end was recorded (replaced_stop_reason).
-- Each worker call is its own transaction, so an intent's created_at (now()) is the moment of the call that first
-- leased the message, and a task receipt's is the moment the task was created. Neither changes afterwards, unlike
-- automation_steps.updated_at, which every later finish of the step rewrites (a hold, a receipt, a reconciliation). A
-- message held across leases is dated by its handoff, at the time it went out; only without a message record does it
-- date from its first lease. A reminder held past a move to another time is skipped, never handed off for that time.
CREATE FUNCTION private.automation_run_holds(p_org uuid,p_run uuid,p_starts_at timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.automation_runs; origin private.automation_events; appointment uuid; gave boolean;
  ended_stood timestamptz;
BEGIN
  SELECT * INTO r FROM private.automation_runs x WHERE x.organization_id=p_org AND x.id=p_run;
  IF NOT FOUND OR p_starts_at IS NULL OR NOT (r.status IN ('completed','failed') OR (r.status='stopped'
      AND (r.reason='Stopped by user' OR r.reason LIKE 'Stopped after 7 days on hold:%'))) THEN
    RETURN false;
  END IF;
  SELECT * INTO origin FROM private.automation_events e WHERE e.organization_id=p_org AND e.id=r.event_id;
  IF origin.event_type IS DISTINCT FROM 'appointment_booked' OR NOT coalesce(origin.subject ? 'appointment_id',false) THEN
    RETURN false;
  END IF;
  appointment:=nullif(origin.subject->>'appointment_id','')::uuid;
  -- (a) A failed run that gave nothing but the message that failed holds no time.
  IF r.status='failed' AND NOT (EXISTS (SELECT 1 FROM private.automation_intents i WHERE i.organization_id=p_org
        AND i.run_id=r.id AND i.status IN ('handed_off','accepted','unknown'))
      OR EXISTS (SELECT 1 FROM private.automation_task_receipts k WHERE k.organization_id=p_org AND k.run_id=r.id)) THEN
    RETURN false;
  END IF;
  IF r.status='stopped' THEN
    gave:=EXISTS (SELECT 1 FROM private.automation_intents i WHERE i.organization_id=p_org AND i.run_id=r.id
        AND i.status<>'prepared')
      OR EXISTS (SELECT 1 FROM private.automation_task_receipts k WHERE k.organization_id=p_org AND k.run_id=r.id);
    -- (c) Not the latest booking run, and nothing went out: no time is held.
    IF r.reason<>'Stopped by user' AND NOT gave AND EXISTS (SELECT 1 FROM private.automation_events later_e
        JOIN private.automation_runs later_r ON later_r.organization_id=later_e.organization_id AND later_r.event_id=later_e.id
        WHERE later_e.organization_id=p_org AND later_e.event_type='appointment_booked' AND later_e.subject ? 'appointment_id'
          AND later_e.subject->>'appointment_id'=origin.subject->>'appointment_id'
          AND later_r.workflow_id=r.workflow_id AND later_r.id<>r.id
          AND (later_e.occurred_at,later_e.id)>(origin.occurred_at,origin.id)) THEN
      RETURN false;
    END IF;
  END IF;
  -- (a) Not while a text the automation gave the appointment at this time, by this run or another, is owed its one
  -- retry and the retry window is open (the record's key: organization, automation, appointment, start). The reminder
  -- record is installed by the runtime migration, so an installation stopped before it has none to read.
  IF r.status IN ('completed','failed') AND to_regclass('private.automation_given_steps') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM private.automation_given_steps g WHERE g.organization_id=p_org AND g.workflow_id=r.workflow_id
        AND g.appointment_id=appointment AND g.starts_at=p_starts_at AND g.attempt=1 AND g.kind='sms'
        AND private.automation_step_record(p_org,g.workflow_id,g.appointment_id,g.starts_at,g.node_id,NULL)
          IN ('retry','retry_wait')
        AND private.automation_retry_open(r,g.node_id,g.starts_at)) THEN
      RETURN false;
    END IF;
  END IF;
  -- (a) The time it ended at.
  IF EXISTS (SELECT 1 FROM private.appointment_occurrences o WHERE o.organization_id=p_org
      AND o.id=coalesce(r.anchor_id,r.reminded_for,nullif(origin.subject->>'occurrence_id','')::uuid)
      AND o.scheduled_start=p_starts_at) THEN
    RETURN true;
  END IF;
  -- (a) for a run with neither wait field, and (b) for a stopped run: the time it stood at when it ended, read once.
  IF r.status='stopped' OR (r.anchor_id IS NULL AND r.reminded_for IS NULL) THEN
    ended_stood:=private.automation_stood_at(p_org,appointment,r.ended_at);
    IF ended_stood=p_starts_at THEN RETURN true; END IF;
  END IF;
  -- (d) A completed or failed run holds nothing more.
  IF r.status<>'stopped' THEN RETURN false; END IF;
  -- (b) Each time it stood at when the run gave something. The message record is read by its unique key
  -- (organization_id, run_id, node_id).
  RETURN gave AND EXISTS (SELECT 1 FROM (SELECT coalesce((SELECT m.authorized_at FROM private.automation_messages m
          WHERE m.organization_id=p_org AND m.run_id=r.id AND m.node_id=i.node_id),i.created_at) AS at
        FROM private.automation_intents i WHERE i.organization_id=p_org AND i.run_id=r.id AND i.status<>'prepared'
      UNION ALL SELECT k.created_at FROM private.automation_task_receipts k WHERE k.organization_id=p_org AND k.run_id=r.id) given
    WHERE private.automation_stood_at(p_org,appointment,given.at)=p_starts_at);
END $$;

-- Whether a run a booking started on the automation for the appointment, other than p_except_run, holds the time
-- (automation_run_holds). Admission's reopening path, the cancellation carry-on and the move back after a reopening all
-- decide by it, so they never disagree about a time. A time no run holds may still have been partly given: a run that
-- starts or carries on there skips, step by step, what the reminder record shows was given at that time
-- (automation_step_record), and a finished or failed run does not hold a time while a text the automation gave the
-- appointment there is owed its one retry.
CREATE FUNCTION private.automation_time_held(p_org uuid,p_workflow uuid,p_appointment uuid,p_starts_at timestamptz,
  p_except_run uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM private.automation_events origin
    JOIN private.automation_runs r ON r.organization_id=origin.organization_id AND r.event_id=origin.id
    WHERE origin.organization_id=p_org AND origin.event_type='appointment_booked' AND origin.subject ? 'appointment_id'
      AND origin.subject->>'appointment_id'=p_appointment::text AND r.workflow_id=p_workflow
      AND r.id IS DISTINCT FROM p_except_run
      AND (r.status IN ('completed','failed') OR (r.status='stopped'
        AND (r.reason='Stopped by user' OR r.reason LIKE 'Stopped after 7 days on hold:%')))
      AND private.automation_run_holds(p_org,r.id,p_starts_at))
$$;

CREATE OR REPLACE FUNCTION private.automation_admit_event(e private.automation_events,p_interval uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; trigger_node jsonb; first_node text; halt text; scope text; lock_scope text; reentry text;
  prior private.automation_runs; slot record; stood_again timestamptz; basis timestamptz;
begin
  select i.workflow_id,i.version_id,i.starts_at,i.ends_at,v.graph,v.published_by,w.status into candidate
    from public.automation_intervals i
    join public.workflow_versions v on v.id=i.version_id and v.organization_id=i.organization_id and v.workflow_id=i.workflow_id
    join public.workflows w on w.id=i.workflow_id and w.organization_id=i.organization_id
    where i.organization_id=e.organization_id and i.id=p_interval
    for share of w;
  if not found or candidate.status not in ('paused','active') then return 0; end if;
  if e.event_type='appointment_booked' then
    stood_again:=private.automation_stood_again(e.organization_id,(e.subject->>'appointment_id')::uuid,e.occurred_at);
  end if;
  -- The automation was on when the event happened. A booking whose appointment was reopened (after the booking, or by
  -- the save that opened its slot) is also taken by the automation on at that reopening. An automation that followed
  -- the appointment and was paused at the reopening keeps it, under the interval it was last on, until it resumes, while
  -- the version published last by then still follows bookings; one republished without a booking trigger takes nothing.
  if not ((candidate.starts_at<=e.occurred_at and (candidate.ends_at is null or candidate.ends_at>e.occurred_at))
      or (stood_again is not null and (
        (candidate.starts_at<=stood_again and (candidate.ends_at is null or candidate.ends_at>stood_again))
        or (candidate.starts_at<=stood_again
          and private.automation_following_since(e.organization_id,candidate.workflow_id,e.subject->>'appointment_id') is not null
          and not exists (select 1 from public.automation_intervals later where later.organization_id=e.organization_id
            and later.workflow_id=candidate.workflow_id and later.starts_at>candidate.starts_at and later.starts_at<=stood_again)
          and private.automation_trigger((select v.graph from public.workflow_versions v where v.organization_id=e.organization_id
            and v.workflow_id=candidate.workflow_id and v.published_at<=stood_again
            order by v.published_at desc,v.revision desc limit 1))->>'type'='appointment_booked')))) then
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
    -- Read again under the locks and after the slot, so a reopening that committed while admission waited is seen.
    stood_again:=private.automation_stood_again(e.organization_id,(e.subject->>'appointment_id')::uuid,e.occurred_at);
    -- Only the appointment's current slot, still ahead and without an outcome, starts a run. A booking admitted after
    -- its appointment was opened again counts from that reopening (stood_again), never from a moment while it was
    -- cancelled. A recorded time, so a late worker moves nothing.
    if slot.occurrence_id is null or slot.occurrence_id::text is distinct from e.subject->>'occurrence_id'
      or coalesce(slot.head_outcome,'retracted')<>'retracted'
      or slot.starts_at<=greatest(e.occurred_at,stood_again) then return 0; end if;
    -- A booking taken up because its appointment was reopened, whether it was opened again after this booking or this
    -- slot was opened by the save that reopened it, is judged as the run that followed the appointment would have been:
    -- its stop rules (a verified reply, a conversation, another booking) count from automation_stops_from, kept on the
    -- run (stops_from) for every later check. Ended so already by a stop rule, the automation starts nothing again for
    -- the appointment; otherwise the run is recorded as stopped, so its activity shows why nothing went out. An
    -- ordinary booking, and an ordinary move of an appointment that stood, counts from itself. Reopened at a time that
    -- a run a booking started on the automation for the appointment holds, on the slot that run followed or on another
    -- slot at that time (moved away and back while cancelled), no run starts (automation_time_held): a run that
    -- finished or failed holds the time it ended at, and a person's stop and the stop after seven days on hold also
    -- hold the times the run followed until it was stopped, the hold's only while its run is the latest or gave
    -- something. Another time starts over, and so does a time a run that finished or failed passed through and then
    -- left, or one it ended at while a text the automation gave the appointment there, whichever run gave it, is owed
    -- its one retry and the retry window is open (automation_retry_open); there the reminder record skips what was
    -- already given for the time (automation_step_record). Only this path checks it, against every run a booking
    -- started on the automation for the appointment.
    if stood_again is not null then
      basis:=private.automation_stops_from(e.organization_id,candidate.workflow_id,e.subject->>'appointment_id',
        e.occurred_at);
      if private.automation_time_held(e.organization_id,candidate.workflow_id,(e.subject->>'appointment_id')::uuid,
          slot.starts_at,null) then
        return 0;
      end if;
      select s.stop_reason into halt from private.automation_contact_stop(e.organization_id,candidate.graph->'settings',
        e.contact_id,basis,e.subject->>'appointment_id',null) s limit 1;
      if halt is null and e.contact_id is not null and candidate.graph#>>'{settings,stop_on_reply}'='true' and exists(
          select 1 from private.automation_reply_watermarks m where m.organization_id=e.organization_id
            and m.contact_type=coalesce(e.contact_type,'lead') and m.contact_id=e.contact_id and m.latest_reply_at>=basis) then
        halt:='Verified reply received';
      end if;
      if halt is not null and exists(select 1 from private.automation_runs r join private.automation_events origin
          on origin.organization_id=r.organization_id and origin.id=r.event_id
        where r.organization_id=e.organization_id and r.workflow_id=candidate.workflow_id
          and origin.subject ? 'appointment_id' and origin.subject->>'appointment_id'=e.subject->>'appointment_id') then
        -- Refused, the reopening at another time still replaces the run a cancellation stopped whose reminders were for
        -- another time, as a run started for it would: that run is recorded as rescheduled, so a later move back to its
        -- time carries it on instead of starting over.
        update private.automation_runs r set reason='Appointment was rescheduled',updated_at=clock_timestamp()
          from private.automation_events origin
          where origin.organization_id=r.organization_id and origin.id=r.event_id and origin.subject ? 'appointment_id'
            and origin.subject->>'appointment_id'=e.subject->>'appointment_id'
            and r.organization_id=e.organization_id and r.workflow_id=candidate.workflow_id
            and r.status='stopped' and r.reason='Appointment was cancelled' and r.reminded_for is not null
            and not exists (select 1 from private.appointment_occurrences o where o.organization_id=e.organization_id
              and o.id=r.reminded_for and o.scheduled_start=slot.starts_at);
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
      and m.contact_type=coalesce(e.contact_type,'lead') and m.contact_id=e.contact_id
      and m.latest_reply_at>=coalesce(basis,e.occurred_at)
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
      current_node_id,status,reason,ended_at,paced_from,stops_from)
    values(e.organization_id,candidate.workflow_id,candidate.version_id,e.id,e.contact_id,
      case when e.contact_id is null then null else coalesce(e.contact_type,'lead') end,scope,first_node,
      case when halt is not null then 'stopped' else 'queued' end,
      halt,case when halt is not null then clock_timestamp() end,
      greatest(e.occurred_at,stood_again),basis)
    on conflict do nothing;
  if not found then return 0; end if;
  -- A run started for a booking at another time replaces the run a cancellation stopped whose reminders were for
  -- another time: after a reopening at that time, after a reopening and a move the worker saw together (taken up by the
  -- cancellation carry-on), or when a paused automation resumes and takes up the booking it kept, and also when a stop
  -- rule ends the new run at once. That run is recorded as rescheduled, keeping when it ended, as a live run is when
  -- admission starts over, so a later move back to its time carries it on instead of starting over.
  if e.event_type='appointment_booked' then
    update private.automation_runs r set reason='Appointment was rescheduled',updated_at=clock_timestamp()
      from private.automation_events origin
      where origin.organization_id=r.organization_id and origin.id=r.event_id and origin.subject ? 'appointment_id'
        and origin.subject->>'appointment_id'=e.subject->>'appointment_id'
        and r.organization_id=e.organization_id and r.workflow_id=candidate.workflow_id
        and r.status='stopped' and r.reason='Appointment was cancelled' and r.reminded_for is not null
        and not exists (select 1 from private.appointment_occurrences o where o.organization_id=e.organization_id
          and o.id=r.reminded_for and o.scheduled_start=slot.starts_at);
  end if;
  return 1;
end $$;

-- An appointment moved, was cancelled or was removed. Unfinished runs following it stop when the
-- appointment no longer stands, and a pending reminder moves to the new time.
CREATE FUNCTION private.automation_refresh_appointment_runs(p_org uuid,p_appointment text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior private.automation_runs; node jsonb; placed record; current_slot record; booked private.automation_events;
  person record; flow record; window_id uuid; stood_at timestamptz; reopened timestamptz; reopening_recorded boolean;
  first_stood timestamptz; caught boolean;
BEGIN
  -- The appointment stands again at a time still to come, so no cancellation of it is in effect: on each
  -- automation, the latest run that followed this appointment carries on from the step it was on when a
  -- cancellation is what stopped it. That covers taking a cancellation back on the same slot, a cancellation
  -- restated by retyping, and reopening an appointment that was moved while it was cancelled (its new slot has
  -- no outcome to take back), also after the cancellation was changed to No Show or Completed, and a cancellation a
  -- calendar sync recorded, retyped or not, which a later save that opens the appointment takes back
  -- (automation_appointment_state; a person's cancellation stands over a sync's save). A run is passed over when the
  -- automation has a live or later run that a booking started for the appointment, so at most one run of the
  -- automation carries on (a run another trigger started, such as a no-show run after a republish, follows no booking
  -- and does not count), and, for an automation that stops on a reply, when a verified reply came after its stop basis
  -- (stops_from, else its booking). A run that never followed the appointment's current time (the slot of its
  -- appointment wait, else of its reminders, else of its booking; with neither an appointment wait nor reminders, also
  -- the time the appointment last stood at before it was stopped) is not carried on to a time another booking run of
  -- the automation holds (automation_time_held): that run gave the time its reminders, or a person's stop holds them
  -- there. One whose reminders were for a slot is recorded as rescheduled, and a later move back to
  -- that slot's time carries it on. One whose reminders were for no slot (it has not passed an appointment wait) stays
  -- stopped by the cancellation, and this carry-on takes it up at a later reopening or move to a time it followed (or
  -- that no other booking run of the automation holds). A plain wait that had started keeps its end, or ends at the
  -- recorded reopening when that end passed before it (also an end that passed before the cancellation while the worker
  -- had not yet acted on it). Any other step runs again now, and the worker places an appointment wait against the
  -- appointment's time again, so a reminder time that passed in the meantime follows the step's own rule. Nothing the
  -- run does after it carries on counts from a moment while it was cancelled, so a task it creates is never due before
  -- the recorded moment the appointment stood again.
  -- The carry-on also takes up a run that the seven-day hold ended while an outcome (No Show or Completed) was recorded
  -- on a slot still ahead, since the final send check holds a booking's message then (automation_message_issue). Once
  -- that outcome is no longer in effect (taken back, or changed to Cancelled and the appointment reopened), still
  -- before the start, and a time the run followed (its appointment wait's slot, else its reminders', else its
  -- booking's; with neither an appointment wait nor reminders, also the time the appointment stood at when the hold
  -- ended it, unless another booking run of the automation holds that time) is the current slot's time, the run carries
  -- on as above under the same rules, and its held message goes out on a later lease. A take-back the slot record
  -- cannot show (an outcome it has no record of, then set to Scheduled) records no change, so this refresh does not run
  -- for it.
  -- A cancellation the worker never saw stopped no run, so nothing is carried on or moved: a plain wait that ended while
  -- the appointment was cancelled keeps that end (a known limitation).
  -- A run whose reminders were for an earlier time is treated as a move of an appointment that stood: when every
  -- reminder it passed is still ahead for the new time (automation_restarts_for_new_time), the automation starts over
  -- for the new time through the normal admission of the new slot's booking, so the new time gets every reminder,
  -- whenever the worker sees the changes. When a stop rule refuses that admission, nothing starts and the run is
  -- recorded as rescheduled; a paused automation keeps the booking for its resume; any other refusal lets the run
  -- carry on as above.
  -- When the worker first saw the booking while the appointment was cancelled, there is no run to carry on: each
  -- automation that followed the appointment then admits the current slot's booking normally, once, unless a run a
  -- booking started on it is taken to have followed that slot: one that ended (finished, stopped or failed) after the
  -- appointment first stood at the slot, by its change log, other than one a cancellation stopped, which the carry-on
  -- decides about, or a live one that does not start over for the current time (automation_restarts_for_new_time),
  -- whose booking admission would refuse anyway. So a paused automation keeps no booking for its resume while such a
  -- run follows the appointment, and a person's stop of that run holds. A live run that starts over is left to
  -- admission, which starts the automation over for the current time, or keeps the booking for a paused automation's
  -- resume.
  SELECT s.occurrence_id,s.starts_at,s.head_outcome,s.outcome_at INTO current_slot
    FROM private.automation_appointment_state(p_org,p_appointment::uuid) s;
  IF FOUND AND coalesce(current_slot.head_outcome,'retracted')='retracted' AND current_slot.starts_at>clock_timestamp() THEN
    -- Decided under the locks admission takes for this contact and appointment, so a run carried on here and a run
    -- admitted for the appointment at the same moment never both follow it.
    SELECT e.contact_id,e.contact_type INTO person FROM private.automation_events e
      WHERE e.organization_id=p_org AND e.event_type='appointment_booked' AND e.subject ? 'appointment_id'
        AND e.subject->>'appointment_id'=p_appointment AND e.contact_id IS NOT NULL ORDER BY e.id DESC LIMIT 1;
    IF FOUND THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('automation-contact:'||p_org::text||
        coalesce(person.contact_type,'lead')||person.contact_id::text,0));
    END IF;
    FOR flow IN SELECT DISTINCT r.workflow_id FROM private.automation_runs r JOIN private.automation_events origin
        ON origin.organization_id=r.organization_id AND origin.id=r.event_id
      WHERE r.organization_id=p_org AND r.status='stopped'
        AND (r.reason IN ('Appointment was cancelled','Appointment was rescheduled')
          OR r.reason LIKE 'Stopped after 7 days on hold:%The appointment has an outcome recorded')
        AND origin.event_type='appointment_booked' AND origin.subject ? 'appointment_id'
        AND origin.subject->>'appointment_id'=p_appointment
      ORDER BY r.workflow_id LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('automation-scope:'||flow.workflow_id::text||'appointment:'||p_appointment,0));
    END LOOP;
    SELECT * INTO booked FROM private.automation_events e WHERE e.organization_id=p_org AND e.event_type='appointment_booked'
      AND e.subject ? 'appointment_id' AND e.subject->>'appointment_id'=p_appointment
      AND e.subject->>'occurrence_id'=current_slot.occurrence_id::text
      ORDER BY e.id DESC LIMIT 1;
    -- When the appointment stood again, as its own change log records it: its latest reopening (automation_stood_again),
    -- which is also a cancellation changed to another outcome and then taken back, on this slot or on one the
    -- appointment was moved to while cancelled. A No Show or Completed taken back is not one. A late worker moves nothing.
    stood_at:=private.automation_stood_again(p_org,p_appointment::uuid,'-infinity');
    reopening_recorded:=stood_at IS NOT NULL;
    stood_at:=least(coalesce(stood_at,clock_timestamp()),clock_timestamp());
    FOR prior IN SELECT r.* FROM private.automation_runs r
        JOIN private.automation_events origin ON origin.organization_id=r.organization_id AND origin.id=r.event_id
        JOIN public.workflows w ON w.organization_id=r.organization_id AND w.id=r.workflow_id AND w.status IN ('active','paused')
        JOIN public.workflow_versions v ON v.organization_id=r.organization_id AND v.id=r.version_id
      WHERE r.organization_id=p_org AND r.status='stopped'
        -- A cancellation's stop, or the seven-day hold's while an outcome was recorded, at the slot it followed.
        AND (r.reason='Appointment was cancelled'
          OR (r.reason LIKE 'Stopped after 7 days on hold:%The appointment has an outcome recorded'
          AND (EXISTS (SELECT 1 FROM private.appointment_occurrences ho WHERE ho.organization_id=p_org
            AND ho.id=coalesce(r.anchor_id,r.reminded_for,nullif(origin.subject->>'occurrence_id','')::uuid)
            AND ho.scheduled_start=current_slot.starts_at)
            -- A run with neither an appointment wait nor reminders followed the time the appointment stood at when the
            -- hold ended it. It is carried on there only when no other booking run of the automation holds that time.
            OR (r.anchor_id IS NULL AND r.reminded_for IS NULL AND CASE WHEN coalesce(
              private.automation_stood_at(p_org,p_appointment::uuid,r.ended_at)=current_slot.starts_at,false)
              THEN NOT private.automation_time_held(p_org,r.workflow_id,p_appointment::uuid,current_slot.starts_at,r.id)
              ELSE false END))))
        AND origin.event_type='appointment_booked' AND origin.subject ? 'appointment_id'
        AND origin.subject->>'appointment_id'=p_appointment
        AND NOT EXISTS (SELECT 1 FROM private.automation_runs other JOIN private.automation_events later
            ON later.organization_id=other.organization_id AND later.id=other.event_id
          WHERE other.organization_id=p_org AND other.workflow_id=r.workflow_id AND other.id<>r.id
            AND later.event_type='appointment_booked'
            AND later.subject ? 'appointment_id' AND later.subject->>'appointment_id'=p_appointment
            AND NOT (other.status='stopped' AND other.reason='Appointment was moved back')
            AND (other.status IN ('queued','waiting','held','unknown') OR later.occurred_at>origin.occurred_at))
        AND NOT (v.graph#>>'{settings,stop_on_reply}'='true' AND origin.contact_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM private.automation_reply_watermarks m WHERE m.organization_id=p_org
            AND m.contact_type=coalesce(origin.contact_type,'lead') AND m.contact_id=origin.contact_id
            AND m.latest_reply_at>=coalesce(r.stops_from,origin.occurred_at)))
      ORDER BY r.id FOR UPDATE OF r
    LOOP
      -- Never followed the current time, which another booking run of the automation holds: not carried on (the rule
      -- is in the header above). Only a run whose reminders were for a slot is recorded as rescheduled, as admission
      -- records one, since the move back takes a run up by that slot; one with none stays stopped by the cancellation.
      IF NOT EXISTS (SELECT 1 FROM private.automation_events po JOIN private.appointment_occurrences oc
            ON oc.organization_id=po.organization_id
            AND oc.id=coalesce(prior.anchor_id,prior.reminded_for,nullif(po.subject->>'occurrence_id','')::uuid)
          WHERE po.organization_id=p_org AND po.id=prior.event_id AND oc.scheduled_start=current_slot.starts_at)
        AND NOT (prior.anchor_id IS NULL AND prior.reminded_for IS NULL AND coalesce(
          private.automation_stood_at(p_org,p_appointment::uuid,prior.ended_at)=current_slot.starts_at,false))
        AND private.automation_time_held(p_org,prior.workflow_id,p_appointment::uuid,current_slot.starts_at,prior.id) THEN
        IF prior.reminded_for IS NOT NULL THEN
          UPDATE private.automation_runs SET reason='Appointment was rescheduled',updated_at=clock_timestamp()
            WHERE id=prior.id AND organization_id=p_org;
        END IF;
        CONTINUE;
      END IF;
      IF booked.id IS NOT NULL AND private.automation_restarts_for_new_time(p_org,prior.id,prior.version_id,p_appointment::uuid) THEN
        SELECT i.id INTO window_id FROM public.automation_intervals i
          WHERE i.organization_id=p_org AND i.workflow_id=prior.workflow_id AND i.starts_at<=booked.occurred_at
            AND (i.ends_at IS NULL OR i.ends_at>booked.occurred_at) ORDER BY i.id DESC LIMIT 1;
        IF FOUND THEN
          -- Admission counts the new run from the recorded reopening, and records the run it replaced as rescheduled,
          -- also when a stop rule refuses the new time; that run is then not carried on here.
          IF private.automation_admit_event(booked,window_id)=1 THEN CONTINUE; END IF;
          IF (SELECT r.reason FROM private.automation_runs r WHERE r.organization_id=p_org AND r.id=prior.id)
              ='Appointment was rescheduled' THEN CONTINUE; END IF;
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
    -- Moved away and back to the time a run's reminders were for, after the worker saw the move away: the automation
    -- started over for the other time, ending that run as rescheduled (or recorded it so when a stop rule refused the
    -- other time, starting nothing). While every run a booking started since has passed no step and handed nothing to a
    -- provider (it may have been carried on above, ended by a stop rule since the move away, or stopped by a
    -- cancellation and not carried on), the run that was following this time carries on from the step it was on, and
    -- those others end or are recorded as replaced, so they give this time nothing. A run a stop rule had already ended
    -- in fact is not carried on (found first, below). A stop rule's end of one of the others is kept: one in fact but
    -- not yet recorded (a conversation or another booking, recorded when work is leased) is recorded first
    -- (automation_settle_stop), and the replaced run keeps the stop rule's reason as replaced_stop_reason, so that end
    -- still holds the times the run followed at send time (automation_time_stopped). After a reopening (the
    -- current slot's booking was followed by one, automation_stood_again), a later run that has ended and does not hold
    -- this time (automation_run_holds) does not keep the run from carrying on either: it followed only other times, or it
    -- passed through this time and left (rule (d) there), and the reminder record skips what it gave here. A later
    -- run that was also recorded as rescheduled with its reminders for this time still does, so at most one run of the
    -- automation carries on. The run is not carried on to a time another booking run of the automation holds
    -- (automation_time_held), which admission refuses too. A run another trigger started (a no-show run after a
    -- republish) follows no booking: it neither keeps the run from carrying on nor is replaced, and ends for its own
    -- reason. The carried-on run's stop rules then count as a reopened booking's do (automation_stops_from, kept in
    -- stops_from): from the move back when it was an ordinary move the automation followed, otherwise (a move back made
    -- while the appointment was cancelled) from the latest booking the automation followed while it stood, so a reply or
    -- conversation since then still ends it. An appointment wait is placed again against the current slot, and a plain
    -- wait keeps its end. When the appointment was cancelled and stood again after that run stopped following this time
    -- (as recorded: its slot was left, or it ended, whichever came first), the run counts from the recorded reopening, as
    -- the cancellation carry-on does: a plain wait whose end passed by then ends at the reopening, and a reminder that
    -- goes out late or a task the run creates is never paced from a moment before it. Without such a reopening (an
    -- ordinary move away and back) nothing moves.
    IF booked.id IS NOT NULL THEN
      reopened:=private.automation_stood_again(p_org,p_appointment::uuid,booked.occurred_at);
    END IF;
    -- First, a run recorded as rescheduled whose reminders were for this time, that a stop rule had in fact ended
    -- while it still followed this time, keeps that end. Something else ended the run before the stop rule's end was
    -- recorded: a cancellation (its stop check names the cancellation before any stop rule), a move made before a
    -- call's length was written, or a move while it waited for its provider's answer. The facts are those of
    -- automation_stop_check, under the run's version: another booking or a conversation (automation_contact_stop, asked
    -- for each rule on its own, so a later fact under one never hides an earlier one under the other) and a verified
    -- reply (the reply watermark), counted from its stop basis (stops_from, else its booking) until before it ended or
    -- the appointment left the slot its reminders were for, whichever came first. The first such fact's reason is kept
    -- as replaced_stop_reason: the move back below does not carry the run on, and its end holds this time at send time
    -- for the run that follows the appointment here (automation_time_stopped). A fact after the run ended, such as a
    -- reply or a conversation while the appointment was cancelled, does not count, so that run is still carried on. A
    -- call still under way at the move back has no length yet and is not counted, and nothing attributes it later to
    -- the run it began under: a known limitation.
    WITH ended_by_rule AS (
      SELECT r.id,(SELECT f.stop_reason FROM (
            SELECT s.stop_reason,s.stopped_at FROM private.automation_contact_stop(p_org,
              jsonb_build_object('stop_on_booking',span.settings->>'stop_on_booking'),r.contact_id,span.since,
              p_appointment,NULL) s
            UNION ALL
            SELECT s.stop_reason,s.stopped_at FROM private.automation_contact_stop(p_org,
              jsonb_build_object('stop_on_contact',span.settings->>'stop_on_contact'),r.contact_id,span.since,
              p_appointment,NULL) s
            UNION ALL
            SELECT 'Verified reply received',m.latest_reply_at FROM private.automation_reply_watermarks m
            WHERE span.settings->>'stop_on_reply'='true' AND m.organization_id=p_org AND m.contact_type=r.contact_type
              AND m.contact_id=r.contact_id AND m.latest_reply_at>=span.since) f
          WHERE f.stopped_at<span.until ORDER BY f.stopped_at LIMIT 1) AS stop_reason
      FROM private.automation_runs r
      JOIN private.automation_events origin ON origin.organization_id=r.organization_id AND origin.id=r.event_id
      JOIN private.appointment_occurrences o ON o.organization_id=r.organization_id AND o.id=r.reminded_for
      JOIN public.workflow_versions v ON v.organization_id=r.organization_id AND v.workflow_id=r.workflow_id
        AND v.id=r.version_id
      CROSS JOIN LATERAL (SELECT v.graph->'settings' AS settings,coalesce(r.stops_from,origin.occurred_at) AS since,
        coalesce(least(r.ended_at,o.closed_at),clock_timestamp()) AS until) span
      WHERE r.organization_id=p_org AND r.status='stopped' AND r.reason='Appointment was rescheduled'
        AND r.replaced_stop_reason IS NULL AND r.contact_id IS NOT NULL
        AND origin.event_type='appointment_booked' AND origin.subject ? 'appointment_id'
        AND origin.subject->>'appointment_id'=p_appointment AND o.scheduled_start=current_slot.starts_at)
    UPDATE private.automation_runs r SET replaced_stop_reason=ended_by_rule.stop_reason,updated_at=clock_timestamp()
      FROM ended_by_rule
      WHERE r.organization_id=p_org AND r.id=ended_by_rule.id AND ended_by_rule.stop_reason IS NOT NULL;
    FOR prior IN SELECT r.* FROM private.automation_runs r
        JOIN private.automation_events origin ON origin.organization_id=r.organization_id AND origin.id=r.event_id
        JOIN public.workflows w ON w.organization_id=r.organization_id AND w.id=r.workflow_id AND w.status IN ('active','paused')
      WHERE r.organization_id=p_org AND r.status='stopped' AND r.reason='Appointment was rescheduled'
        -- Not a run a stop rule ended in fact (above).
        AND r.replaced_stop_reason IS NULL
        AND origin.event_type='appointment_booked' AND origin.subject ? 'appointment_id'
        AND origin.subject->>'appointment_id'=p_appointment
        AND EXISTS (SELECT 1 FROM private.appointment_occurrences o WHERE o.organization_id=p_org AND o.id=r.reminded_for
          AND o.scheduled_start=current_slot.starts_at)
        AND NOT (reopened IS NOT NULL
          AND private.automation_time_held(p_org,r.workflow_id,p_appointment::uuid,current_slot.starts_at,r.id))
        AND NOT EXISTS (SELECT 1 FROM private.automation_runs other JOIN private.automation_events later
            ON later.organization_id=other.organization_id AND later.id=other.event_id
          WHERE other.organization_id=p_org AND other.workflow_id=r.workflow_id AND later.event_type='appointment_booked'
            AND later.subject ? 'appointment_id'
            AND later.subject->>'appointment_id'=p_appointment AND later.occurred_at>origin.occurred_at
            AND NOT (other.status='stopped' AND other.reason='Appointment was moved back')
            AND NOT (reopened IS NOT NULL AND other.status NOT IN ('queued','waiting','held','unknown')
              AND NOT private.automation_run_holds(p_org,other.id,current_slot.starts_at)
              -- A later run recorded as rescheduled whose reminders were for this time still keeps this one from
              -- carrying on, so at most one run of the automation carries on here.
              AND NOT (other.status='stopped' AND other.reason='Appointment was rescheduled' AND EXISTS (
                SELECT 1 FROM private.appointment_occurrences oo WHERE oo.organization_id=p_org
                  AND oo.id=other.reminded_for AND oo.scheduled_start=current_slot.starts_at)))
            AND (NOT (other.status IN ('queued','waiting','held') OR (other.status='stopped'
                AND other.reason IN ('Verified reply received','Contact was reached','Appointment booked','Appointment was cancelled')))
              OR EXISTS (SELECT 1 FROM private.automation_steps s WHERE s.organization_id=p_org AND s.run_id=other.id
                AND s.status<>'wait')
              OR EXISTS (SELECT 1 FROM private.automation_intents i WHERE i.organization_id=p_org AND i.run_id=other.id
                AND i.status<>'prepared')))
      ORDER BY r.id FOR UPDATE OF r
    LOOP
      -- A later live run that a stop rule already ended in fact (a conversation or another booking, which is recorded
      -- when work is leased, as the loop below records it on every change) is recorded as stopped by it first, so the
      -- move back keeps that end as it keeps one recorded before (below).
      PERFORM private.automation_settle_stop(other) FROM private.automation_runs other JOIN private.automation_events later
          ON later.organization_id=other.organization_id AND later.id=other.event_id
        WHERE other.organization_id=p_org AND other.workflow_id=prior.workflow_id AND later.event_type='appointment_booked'
          AND later.subject ? 'appointment_id' AND later.subject->>'appointment_id'=p_appointment
          AND later.occurred_at>(SELECT e.occurred_at FROM private.automation_events e
            WHERE e.organization_id=p_org AND e.id=prior.event_id)
          AND other.status IN ('queued','waiting','held');
      UPDATE private.automation_runs other SET status='stopped',reason='Appointment was moved back',ended_at=clock_timestamp(),
          updated_at=clock_timestamp(),lease_token=NULL,leased_until=NULL,held_since=NULL
        FROM private.automation_events later
        WHERE later.organization_id=other.organization_id AND later.id=other.event_id
          AND other.organization_id=p_org AND other.workflow_id=prior.workflow_id AND later.event_type='appointment_booked'
          AND later.subject ? 'appointment_id' AND later.subject->>'appointment_id'=p_appointment
          AND later.occurred_at>(SELECT e.occurred_at FROM private.automation_events e
            WHERE e.organization_id=p_org AND e.id=prior.event_id)
          AND other.status IN ('queued','waiting','held');
      -- The later runs the move back replaced that had already stopped (by a stop rule, or by a cancellation nothing
      -- carried on) are recorded as replaced too, keeping when they ended, so the cancellation carry-on and a reopening's
      -- admission see the run carried on here as the one that follows the appointment. A stop rule's reason is kept as
      -- replaced_stop_reason, so its end still holds the times that run followed at send time (automation_time_stopped),
      -- also after the appointment moves away and back to one of them.
      UPDATE private.automation_runs other SET reason='Appointment was moved back',
          replaced_stop_reason=CASE WHEN other.reason IN ('Verified reply received','Contact was reached','Appointment booked')
            THEN other.reason END,
          updated_at=clock_timestamp()
        FROM private.automation_events later
        WHERE later.organization_id=other.organization_id AND later.id=other.event_id
          AND other.organization_id=p_org AND other.workflow_id=prior.workflow_id AND later.event_type='appointment_booked'
          AND later.subject ? 'appointment_id' AND later.subject->>'appointment_id'=p_appointment
          AND later.occurred_at>(SELECT e.occurred_at FROM private.automation_events e
            WHERE e.organization_id=p_org AND e.id=prior.event_id)
          AND other.status='stopped'
          AND other.reason IN ('Verified reply received','Contact was reached','Appointment booked','Appointment was cancelled');
      UPDATE private.automation_runs r SET
          status=CASE WHEN private.automation_waiting_out(r) THEN 'waiting' ELSE 'queued' END,
          due_at=CASE WHEN NOT private.automation_waiting_out(r) THEN clock_timestamp()
            WHEN reopening_recorded AND stood_at>least(r.ended_at,(SELECT o.closed_at FROM private.appointment_occurrences o
              WHERE o.organization_id=p_org AND o.id=r.reminded_for)) THEN greatest(r.due_at,stood_at) ELSE r.due_at END,
          paced_from=CASE WHEN reopening_recorded AND stood_at>least(r.ended_at,(SELECT o.closed_at FROM private.appointment_occurrences o
              WHERE o.organization_id=p_org AND o.id=r.reminded_for)) THEN greatest(r.paced_from,stood_at) ELSE r.paced_from END,
          reminded_for=current_slot.occurrence_id,
          anchor_id=CASE WHEN r.anchor_id IS NOT NULL THEN current_slot.occurrence_id END,
          anchor_at=CASE WHEN r.anchor_id IS NOT NULL THEN current_slot.starts_at END,
          stops_from=CASE WHEN booked.id IS NULL THEN r.stops_from
            ELSE greatest(coalesce(r.stops_from,(SELECT e.occurred_at FROM private.automation_events e
              WHERE e.organization_id=p_org AND e.id=r.event_id)),
              private.automation_stops_from(p_org,r.workflow_id,p_appointment,booked.occurred_at)) END,
          reason=NULL,ended_at=NULL,updated_at=clock_timestamp(),held_since=NULL,lease_token=NULL,leased_until=NULL,
          workflow_paused=(SELECT w.status='paused' FROM public.workflows w WHERE w.organization_id=r.organization_id AND w.id=r.workflow_id)
        WHERE r.id=prior.id AND r.organization_id=p_org;
    END LOOP;
    -- A booking the worker first saw while the appointment was cancelled started no run, so nothing above carries on.
    -- Once the appointment's own change log shows it opened again (after the current slot was booked, or by the save
    -- that opened it), each automation that followed the appointment (automation_following_since) admits that booking
    -- through the normal admission, unless a run of it already followed this slot (the guard below). Admission applies
    -- every eligibility rule (its filters, the slot still ahead without an outcome, re-entry), judges the stop rules as
    -- the run that followed the appointment would have (stops_from), takes the same locks, counts the run from the
    -- reopening, and starts at most one run per automation and booking however often the reopening is seen. It refuses
    -- while a run still follows the appointment, such as one carried on above, unless that run starts over for this
    -- time, and when a run a booking started holds this slot's time (automation_time_held); a run that finished or
    -- stopped for another time does not block this one. The guard and that check apply only to a reopening: for an
    -- ordinary booking an earlier run blocks only while it still follows the appointment, or when it already waited for
    -- this slot. The automation on when the slot was booked admits it, or else the one on at the reopening, or else,
    -- for an automation paused at the reopening whose version published last by then still follows bookings, the
    -- interval it was last on, which keeps the booking until it resumes. An ordinary move of an appointment that stood
    -- is left to the booking's own admission.
    IF reopened IS NOT NULL THEN
      -- When the appointment first stood at this slot, as its change log records it: the first save, from the one that
      -- opened the slot on, that left it open (an open status, or one the outcome record ignores with no cancellation
      -- since the save that last left it open), else the booking itself. The save that opened the slot is the latest one
      -- at or before its booking, which that save records after its own change-log row and before any later save's.
      SELECT x.observed_at INTO first_stood FROM private.appointment_evidence_observations x
        WHERE x.organization_id=p_org AND x.appointment_id=p_appointment::uuid
          AND x.id>=(SELECT o.id FROM private.appointment_evidence_observations o
            WHERE o.organization_id=p_org AND o.appointment_id=p_appointment::uuid AND o.observed_at<=booked.occurred_at
            ORDER BY o.id DESC LIMIT 1)
          AND (private.appointment_status_key(x.next->>'status')='open'
            OR (x.op<>'DELETE' AND private.appointment_status_key(x.next->>'status') IS NULL AND NOT EXISTS (
              SELECT 1 FROM private.appointment_evidence_observations z
              WHERE z.organization_id=p_org AND z.appointment_id=p_appointment::uuid AND z.id<=x.id
                AND z.id>coalesce((SELECT w.id FROM private.appointment_evidence_observations w
                  WHERE w.organization_id=p_org AND w.appointment_id=p_appointment::uuid AND w.id<x.id
                    AND private.appointment_status_key(w.next->>'status')='open' ORDER BY w.id DESC LIMIT 1),0)
                AND 'cancelled' IN (private.appointment_status_key(z.prev->>'status'),
                  private.appointment_status_key(z.next->>'status')))))
        ORDER BY x.id LIMIT 1;
      FOR flow IN SELECT w.id AS workflow_id FROM public.workflows w WHERE w.organization_id=p_org AND w.status IN ('active','paused')
          AND private.automation_following_since(p_org,w.id,p_appointment) IS NOT NULL ORDER BY w.id LOOP
        -- A run a booking started that ended (finished, stopped or failed) after the appointment first stood at this
        -- slot, strictly after, is taken to have followed this slot, so the booking is not taken up again: a finished
        -- run is not repeated and a person's stop holds, also for a run with no appointment wait, which records no
        -- slot. (In the sync's rewrite window the change log shows the slot standing while it still held a person's
        -- cancellation, so a stop made then is counted too: a known limitation.) A run that ended before then is not
        -- counted, such as one a person stopped before the worker processed a cancellation and a move made while
        -- cancelled: admission judges it by the times it holds, so a new time starts over. A live run that does not
        -- start over for the current time is counted too, since admission refuses the booking while that run follows
        -- the appointment: so no admission is run for it, and a paused automation keeps no booking for its resume. A
        -- live run that starts over is admission's. A run a cancellation stopped is the carry-on's above; one the
        -- carry-on passes over is left to admission unless this guard counts the run that made it pass it over.
        -- Admission records it as rescheduled when its reminders were for another time and a stop rule refuses another
        -- time or a run starts for another time, so a move back to that time still carries it on. A run another trigger
        -- started (a no-show run after a republish) followed no booking and is not counted.
        IF EXISTS (SELECT 1 FROM private.automation_runs r JOIN private.automation_events origin
            ON origin.organization_id=r.organization_id AND origin.id=r.event_id
          WHERE r.organization_id=p_org AND r.workflow_id=flow.workflow_id AND origin.event_type='appointment_booked'
            AND origin.subject ? 'appointment_id' AND origin.subject->>'appointment_id'=p_appointment
            AND ((r.status NOT IN ('queued','waiting','held','unknown') AND r.ended_at>coalesce(first_stood,booked.occurred_at)
                AND (r.status IS DISTINCT FROM 'stopped' OR r.reason IS DISTINCT FROM 'Appointment was cancelled'))
              OR (r.status IN ('queued','waiting','held','unknown')
                AND NOT private.automation_restarts_for_new_time(p_org,r.id,r.version_id,p_appointment::uuid)))) THEN
          CONTINUE;
        END IF;
        SELECT i.id INTO window_id FROM public.automation_intervals i
          JOIN public.workflow_versions v ON v.organization_id=i.organization_id AND v.workflow_id=i.workflow_id AND v.id=i.version_id
          WHERE i.organization_id=p_org AND i.workflow_id=flow.workflow_id
            AND private.automation_trigger(v.graph)->>'type'='appointment_booked'
            AND ((i.starts_at<=booked.occurred_at AND (i.ends_at IS NULL OR i.ends_at>booked.occurred_at))
              OR (i.starts_at<=reopened AND (i.ends_at IS NULL OR i.ends_at>reopened))
              OR (i.starts_at<=reopened AND NOT EXISTS (SELECT 1 FROM public.automation_intervals later
                WHERE later.organization_id=p_org AND later.workflow_id=i.workflow_id
                  AND later.starts_at>i.starts_at AND later.starts_at<=reopened)
                AND private.automation_trigger((SELECT pv.graph FROM public.workflow_versions pv WHERE pv.organization_id=p_org
                  AND pv.workflow_id=i.workflow_id AND pv.published_at<=reopened
                  ORDER BY pv.published_at DESC,pv.revision DESC LIMIT 1))->>'type'='appointment_booked'))
          ORDER BY CASE WHEN i.starts_at<=booked.occurred_at AND (i.ends_at IS NULL OR i.ends_at>booked.occurred_at) THEN 0
              WHEN i.starts_at<=reopened AND (i.ends_at IS NULL OR i.ends_at>reopened) THEN 1 ELSE 2 END,i.starts_at DESC
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
    -- A passed reminder another run of the automation already gave for the new time (automation_caught_up, installed by
    -- the runtime migration, so an installation stopped before it has none) does not end the run here.
    caught:=false;
    IF placed.verdict='skip' AND to_regclass('private.automation_given_steps') IS NOT NULL THEN
      caught:=private.automation_caught_up(prior,node,placed.anchor_start);
    END IF;
    IF placed.verdict IN ('wait','advance') THEN
      UPDATE private.automation_runs SET anchor_id=placed.anchor,anchor_at=placed.anchor_start,
        due_at=CASE placed.verdict WHEN 'wait' THEN placed.due ELSE clock_timestamp() END,updated_at=clock_timestamp()
        WHERE id=prior.id AND organization_id=prior.organization_id;
    ELSIF caught THEN
      -- Due now with its anchor unchanged: the next lease places the wait against the new time and goes on past it to
      -- the next reminder (automation_finish_node), recording it as already reached for this appointment time.
      UPDATE private.automation_runs SET due_at=clock_timestamp(),updated_at=clock_timestamp()
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
  private.automation_following_since(uuid,uuid,text),private.automation_stood_again(uuid,uuid,timestamptz),
  private.automation_stops_from(uuid,uuid,text,timestamptz),
  private.automation_contact_stop(uuid,jsonb,uuid,timestamptz,text,uuid),
  private.automation_stop_check(private.automation_runs),private.automation_settle_stop(private.automation_runs),
  private.automation_restarts_for_new_time(uuid,uuid,uuid,uuid),
  private.automation_waiting_out(private.automation_runs),private.automation_awaits_restart(private.automation_runs),
  private.automation_refresh_appointment_runs(uuid,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.automation_stood_at(uuid,uuid,timestamptz),
  private.automation_run_holds(uuid,uuid,timestamptz),
  private.automation_time_held(uuid,uuid,uuid,timestamptz,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
