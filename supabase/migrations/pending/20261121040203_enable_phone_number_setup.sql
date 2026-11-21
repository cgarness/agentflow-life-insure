-- Final, separately approved cutover after all sending functions enforce managed receipt checks
-- and the scheduled reconciliation worker has been verified. Does not enqueue older purchases.
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('public.phone_number_setup_sms_intent(uuid,uuid,text,text,text,text,boolean)') IS NULL
    OR to_regprocedure('public.phone_number_setup_managed(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'phone_number_setup_prerequisites_missing';
  END IF;
END $$;
ALTER TABLE private.phone_number_purchase_operations ENABLE TRIGGER enqueue_phone_number_setup;
COMMIT;
