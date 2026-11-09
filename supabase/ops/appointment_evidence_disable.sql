-- Appointment evidence disable (D4 §8; class R: REVOKE only). Run as postgres. Turns the capture trigger off, revokes
-- the outcome RPC from every role and closes the outcome capture window ('disabled'). Evidence is kept; the disabled
-- interval reads as capture_gap. Re-enable only with appointment_evidence_enable.sql.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $disable$
BEGIN
  IF to_regclass('private.appointment_occurrences') IS NULL
     OR to_regprocedure('public.record_appointment_outcome(uuid,uuid,timestamptz,text)') IS NULL THEN
    RAISE EXCEPTION 'Appointment evidence disable: the evidence (…41) is not installed' USING ERRCODE = 'P0001';
  END IF;
END $disable$;
ALTER TABLE public.appointments DISABLE TRIGGER appointments_v3_evidence_capture;
REVOKE ALL ON FUNCTION public.record_appointment_outcome(uuid, uuid, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
UPDATE private.appointment_evidence_capture_windows SET ended_at = clock_timestamp(), ended_reason = 'disabled'
 WHERE capture_kind = 'appointment_outcomes' AND ended_at IS NULL;
DO $check$
BEGIN
  IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.appointments'::regclass AND tgname = 'appointments_v3_evidence_capture') <> 'D'
     OR has_function_privilege('authenticated', 'public.record_appointment_outcome(uuid,uuid,timestamptz,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Appointment evidence disable: postcondition failed' USING ERRCODE = 'P0001';
  END IF;
END $check$;
COMMIT;
