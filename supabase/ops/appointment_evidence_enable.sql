-- Appointment evidence enable (D4 §8; class W: its only GRANT is the outcome RPC TO authenticated). Run as postgres
-- after appointment_evidence_disable.sql. Checks the pinned capture bodies, turns the trigger on, grants the outcome
-- RPC and opens a new outcome capture window (the gap between windows stays a disabled interval).
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $enable$
DECLARE f record;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('private.appointment_evidence_capture()', '01d2368818b34a1d3523ec92710dfe72'),
      ('private.appointment_evidence_apply(text,public.appointments,public.appointments)', '609220fa8835efb3dd6d50e3a83a74bc'),
      ('private.appointment_evidence_classify(uuid,text,text,timestamptz,timestamptz)', '1af4856b29f8fd26d866575cbbdb53b5'),
      ('public.record_appointment_outcome(uuid,uuid,timestamptz,text)', '1768b060225f5fb56001e69b82cc2f79')) v(fn, pin) LOOP
    IF to_regprocedure(f.fn) IS NULL OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure(f.fn)) <> f.pin THEN
      RAISE EXCEPTION 'Appointment evidence enable: % pin drift', f.fn USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM private.appointment_evidence_capture_windows WHERE capture_kind = 'appointment_outcomes' AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'Appointment evidence enable: capture is already enabled' USING ERRCODE = 'P0001';
  END IF;
END $enable$;
ALTER TABLE public.appointments ENABLE TRIGGER appointments_v3_evidence_capture;
GRANT EXECUTE ON FUNCTION public.record_appointment_outcome(uuid, uuid, timestamptz, text) TO authenticated;
INSERT INTO private.appointment_evidence_capture_windows (capture_kind) VALUES ('appointment_outcomes');
COMMIT;
