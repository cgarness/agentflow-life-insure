-- Revert of the appointment type category baseline (D4 §3.3; class R: a data write with no privilege statement).
-- Guards the exact postimage: the 36 rows named by the ops_baseline events, each still at the category it was given
-- and with no later event. Resets them to unclassified with 36 ops_revert events. Captured snapshots keep their
-- categories; classification resolution skips the withdrawn baseline (D-C1).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL agentflow.appointment_category_source = 'ops_revert';
DO $revert$
BEGIN
  IF (SELECT count(*) FROM private.appointment_type_category_events WHERE source = 'ops_baseline') <> 36
     OR EXISTS (SELECT 1 FROM private.appointment_type_category_events b
                 LEFT JOIN public.appointment_types t ON t.id = b.type_id
                WHERE b.source = 'ops_baseline'
                  AND (t.id IS NULL OR t.business_category IS DISTINCT FROM b.category_after
                       OR EXISTS (SELECT 1 FROM private.appointment_type_category_events l WHERE l.type_id = b.type_id AND l.id > b.id))) THEN
    RAISE EXCEPTION 'Appointment category baseline revert: the baseline postimage changed; refusing' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.appointment_types t SET business_category = 'unclassified'
   WHERE t.id IN (SELECT type_id FROM private.appointment_type_category_events WHERE source = 'ops_baseline');
  IF (SELECT count(*) FROM private.appointment_type_category_events WHERE source = 'ops_revert') <> 36 THEN
    RAISE EXCEPTION 'Appointment category baseline revert: postcondition failed' USING ERRCODE = 'P0001';
  END IF;
END $revert$;
COMMIT;
