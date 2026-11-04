-- Rollback for 20261104120042_policy_appointment_attributions (D4 §8). Privilege class C: no GRANT.
-- Drops the three RPCs and closes the attribution capture window. The attributions table and every row are kept.
-- Refuses while the …43 reader body (which reads the attributions) is installed.
SET LOCAL lock_timeout = '2s';
DO $rollback$
BEGIN
  IF to_regprocedure('private.report_v3_appointment_counts(jsonb,uuid,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'Policy appointment attributions rollback: roll back the appointment facts (…43) first' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.link_policy_appointment(uuid,uuid,uuid,timestamptz,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Policy appointment attributions rollback: nothing to roll back' USING ERRCODE = 'P0001';
  END IF;
END $rollback$;
REVOKE ALL ON FUNCTION public.get_policy_appointment_links(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.link_policy_appointment(uuid, uuid, uuid, timestamptz, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.correct_policy_appointment_link(uuid, uuid, uuid, uuid, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.get_policy_appointment_links(uuid);
DROP FUNCTION public.link_policy_appointment(uuid, uuid, uuid, timestamptz, text, text);
DROP FUNCTION public.correct_policy_appointment_link(uuid, uuid, uuid, uuid, timestamptz, text);
UPDATE private.appointment_evidence_capture_windows SET ended_at = clock_timestamp(), ended_reason = 'rolled_back'
 WHERE capture_kind = 'policy_appointment_attribution' AND ended_at IS NULL;
