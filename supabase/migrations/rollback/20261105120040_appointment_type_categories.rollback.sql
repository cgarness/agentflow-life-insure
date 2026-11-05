-- Rollback for 20261105120040_appointment_type_categories (D4 §3.2). Privilege class C: no GRANT.
-- Drops the guard and audit triggers and their functions only. The business_category column, its CHECK and the audit
-- history are kept, so captured snapshots and the audited type history survive. Refuses while the evidence capture
-- capture (…41) is still installed.
SET LOCAL lock_timeout = '2s';
DO $rollback$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.appointments'::regclass AND tgname = 'appointments_v3_evidence_capture') THEN
    RAISE EXCEPTION 'Appointment type categories rollback: roll back the appointment evidence (…41) first' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('private.guard_appointment_type_classification()') IS NULL THEN
    RAISE EXCEPTION 'Appointment type categories rollback: nothing to roll back' USING ERRCODE = 'P0001';
  END IF;
END $rollback$;
DROP TRIGGER appointment_types_classification_guard ON public.appointment_types;
DROP TRIGGER appointment_types_category_audit ON public.appointment_types;
DROP FUNCTION private.guard_appointment_type_classification();
DROP FUNCTION private.audit_appointment_type_category();
