-- REVIEW ONLY. Requires Chris's explicit approval of this exact production action.
-- Recovery pauses outbound queue/admission; preserves suppression, calls and history.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.get_next_queue_lead(uuid,jsonb) FROM authenticated,anon,service_role;
REVOKE EXECUTE ON FUNCTION public.fetch_and_lock_next_lead(uuid,jsonb) FROM authenticated,anon,service_role;
REVOKE EXECUTE ON FUNCTION public.get_personal_queue_leads(uuid,integer,integer) FROM authenticated,anon,service_role;
REVOKE EXECUTE ON FUNCTION public.check_dialer_dnc(text,uuid) FROM authenticated,anon,service_role;
REVOKE EXECUTE ON FUNCTION public.admit_twilio_outbound(uuid,text,text,text,text) FROM service_role,authenticated,anon;
NOTIFY pgrst, 'reload schema';
COMMIT;
