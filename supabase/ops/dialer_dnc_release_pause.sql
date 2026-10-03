-- REVIEW ONLY. NOT EXECUTED. Separate exact production approval required.
-- Run BEFORE the coordinated migration/webhook/frontend release. Existing calls
-- and provider callbacks continue; browsers cannot create new outbound calls.
-- Capture ACLs before this action. The corresponding resume action, only AFTER
-- all release gates pass, is: GRANT INSERT ON public.calls TO authenticated;
BEGIN;
REVOKE INSERT ON public.calls FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.advance_campaign_lead(uuid,uuid,uuid,timestamptz,text,boolean)
  FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
