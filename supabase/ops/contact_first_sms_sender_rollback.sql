-- Roll back the frontend first. Keep the compatible Edge handler available for outstanding
-- requests; stop admitting new first-contact intents and drain them before running this SQL.
-- No assignment, consent, event, request, message or acceptance record is rewritten.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.sms_dispatches IN SHARE ROW EXCLUSIVE MODE;

DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sms_dispatches WHERE affinity_role = 'first_contact'
       AND state IN ('prepared', 'attempting', 'uncertain')
  ) OR EXISTS (
    SELECT 1 FROM private.contact_number_affinities
     WHERE sms_source = 'first_contact' AND sms_state = 'reserved'
  ) THEN
    RAISE EXCEPTION 'first_contact_sms_rollback_requires_drain';
  END IF;
END $rollback$;

DROP TRIGGER release_failed_first_contact_sms ON public.sms_dispatches;
DROP FUNCTION private.release_failed_first_contact_sms();
DROP TRIGGER preserve_first_contact_sms_receipt ON public.sms_dispatches;
DROP FUNCTION private.preserve_first_contact_sms_receipt();
DROP FUNCTION public.sms_start_first_contact_dispatch(uuid,text);
DROP FUNCTION public.sms_prepare_first_contact_dispatch(uuid,text,text,text,text,text,text,uuid[],uuid,uuid,text,uuid,uuid,bigint);
DROP FUNCTION private.require_first_contact_sms_mode(uuid);
COMMIT;
