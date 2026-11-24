-- Automations V2 appointment events. Observes the canonical appointment slot and outcome records, and the
-- appointment change log for a reopening those records cannot show.
-- An appointment save never waits long for, and never fails because of, these observers.
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

CREATE FUNCTION private.automation_enrolling(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM private.automation_release_controls c WHERE c.organization_id=p_org AND c.enrollment_enabled)
$$;

-- A new slot is a booking, or a reschedule when the appointment had an earlier slot. A slot closed
-- as deleted means the appointment was removed. Callback reminders are not appointments here.
CREATE FUNCTION private.automation_capture_appointment_slot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE kind text; facts jsonb;
BEGIN
  IF NOT private.automation_enrolling(NEW.organization_id) THEN RETURN NEW; END IF;
  facts:=jsonb_build_object('appointment_id',NEW.appointment_id,'occurrence_id',NEW.id);
  IF TG_OP='UPDATE' THEN
    IF OLD.closed_at IS NULL AND NEW.close_reason='deleted' THEN
      PERFORM private.automation_record_event(NEW.organization_id,'appointment_changed',
        md5(NEW.id::text||':removed')::uuid,NULL,NULL,facts||jsonb_build_object('change','removed'),NULL,interval '0');
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.seq>1 THEN
    PERFORM private.automation_record_event(NEW.organization_id,'appointment_changed',
      md5(NEW.id::text||':moved')::uuid,NULL,NULL,facts||jsonb_build_object('change','moved'),NULL,interval '0');
  END IF;
  IF NEW.opened_source='pre_capture' OR NEW.booking_kind IS NOT DISTINCT FROM 'callback' OR NEW.category='callback'
    OR NEW.contact_id IS NULL THEN RETURN NEW; END IF;
  kind:=private.automation_contact_type(NEW.organization_id,NEW.contact_id);
  IF kind IS NULL THEN RETURN NEW; END IF;
  PERFORM private.automation_record_event(NEW.organization_id,'appointment_booked',NEW.id,NEW.contact_id,kind,
    facts,'slot:'||NEW.id::text,interval '0');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Automation appointment capture requires investigation (SQLSTATE %)', SQLSTATE;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_capture_appointment_slot AFTER INSERT OR UPDATE OF closed_at ON private.appointment_occurrences
  FOR EACH ROW EXECUTE FUNCTION private.automation_capture_appointment_slot();

-- Only a person's explicit Held or No-show starts follow-up. An end time alone, a sync or a
-- restated outcome never does. A cancellation, a reopening or a corrected outcome is a change.
CREATE FUNCTION private.automation_capture_appointment_outcome()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE slot private.appointment_occurrences; contact uuid; kind text; facts jsonb;
BEGIN
  IF NOT private.automation_enrolling(NEW.organization_id) THEN RETURN NEW; END IF;
  SELECT * INTO slot FROM private.appointment_occurrences o
    WHERE o.id=NEW.occurrence_id AND o.organization_id=NEW.organization_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  facts:=jsonb_build_object('appointment_id',slot.appointment_id,'occurrence_id',slot.id,'outcome',NEW.outcome);
  IF NEW.outcome IN ('cancelled','retracted') OR NEW.supersedes_event_id IS NOT NULL THEN
    PERFORM private.automation_record_event(NEW.organization_id,'appointment_changed',
      md5(NEW.id::text||':outcome')::uuid,NULL,NULL,facts||jsonb_build_object('change','outcome'),NULL,interval '0');
  END IF;
  IF NEW.outcome NOT IN ('held','no_show') OR NEW.actor_kind<>'human'
    OR NEW.source NOT IN ('outcome_action','status_edit','booking_entry')
    OR slot.booking_kind IS NOT DISTINCT FROM 'callback' OR slot.category='callback' THEN RETURN NEW; END IF;
  contact:=coalesce(NEW.contact_id,slot.contact_id);
  IF contact IS NULL THEN RETURN NEW; END IF;
  kind:=private.automation_contact_type(NEW.organization_id,contact);
  IF kind IS NULL THEN RETURN NEW; END IF;
  PERFORM private.automation_record_event(NEW.organization_id,'appointment_outcome_recorded',NEW.id,contact,kind,
    facts,'outcome:'||slot.id::text||':'||NEW.outcome,interval '0');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Automation appointment outcome capture requires investigation (SQLSTATE %)', SQLSTATE;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_capture_appointment_outcome AFTER INSERT ON private.appointment_outcome_events
  FOR EACH ROW EXECUTE FUNCTION private.automation_capture_appointment_outcome();

-- A cancelled appointment opened again with no outcome left to take back. This is what moving an appointment while
-- it is cancelled leads to: its new slot carries no outcome record, so reopening it records none either. The
-- appointment's own change log still shows the status going from cancelled to open.
CREATE FUNCTION private.automation_capture_appointment_reopened()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT private.automation_enrolling(NEW.organization_id) THEN RETURN NULL; END IF;
  IF private.appointment_status_key(NEW.prev->>'status') IS DISTINCT FROM 'cancelled'
    OR private.appointment_status_key(NEW.next->>'status') IS DISTINCT FROM 'open' THEN RETURN NULL; END IF;
  PERFORM private.automation_record_event(NEW.organization_id,'appointment_changed',
    md5(NEW.id::text||':reopened')::uuid,NULL,NULL,
    jsonb_build_object('appointment_id',NEW.appointment_id,'change','reopened'),NULL,interval '0');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Automation appointment reopen capture requires investigation (SQLSTATE %)', SQLSTATE;
  RETURN NULL;
END $$;
CREATE TRIGGER automation_capture_appointment_reopened AFTER INSERT ON private.appointment_evidence_observations
  FOR EACH ROW WHEN (NEW.op='UPDATE') EXECUTE FUNCTION private.automation_capture_appointment_reopened();

REVOKE ALL ON FUNCTION private.automation_enrolling(uuid),private.automation_capture_appointment_slot(),
  private.automation_capture_appointment_outcome(),private.automation_capture_appointment_reopened() FROM PUBLIC,anon,authenticated;
COMMIT;
