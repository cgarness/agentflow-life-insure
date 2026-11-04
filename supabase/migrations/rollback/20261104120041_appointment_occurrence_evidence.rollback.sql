-- Rollback for 20261104120041_appointment_occurrence_evidence (D4 §8). Privilege class C: no GRANT.
-- Drops the capture trigger and the outcome RPC and closes the open capture windows ('rolled_back'). Every evidence
-- table and row is kept; readers see the disabled interval as capture_gap. A re-forward is a new reviewed migration.
SET LOCAL lock_timeout = '2s';
DO $rollback$
BEGIN
  IF to_regclass('private.appointment_occurrences') IS NULL THEN
    RAISE EXCEPTION 'Appointment evidence rollback: nothing to roll back' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.record_appointment_outcome(uuid,uuid,timestamptz,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.record_appointment_outcome(uuid, uuid, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
    DROP FUNCTION public.record_appointment_outcome(uuid, uuid, timestamptz, text);
  END IF;
END $rollback$;
DROP TRIGGER IF EXISTS appointments_v3_evidence_capture ON public.appointments;
UPDATE private.appointment_evidence_capture_windows SET ended_at = clock_timestamp(), ended_reason = 'rolled_back'
 WHERE ended_at IS NULL;
