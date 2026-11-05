-- Synthetic fixtures only. Runs inside the disposable dialer harness.
BEGIN;
UPDATE public.campaigns SET auto_dial_enabled=false WHERE id=test_uuid(101);
SELECT test_actor(11);
SET LOCAL ROLE authenticated;
SELECT test_assert((public.start_dialer_session(test_uuid(101))->>'auto_dial_enabled')::boolean=false,'manual campaign session starts manual');
SELECT public.set_dialer_session_mode((public.start_dialer_session(test_uuid(101))->>'id')::uuid,true);
SELECT set_config('test.hotfix_session',(public.start_dialer_session(test_uuid(101))->>'id'),true);
SELECT test_assert((public.start_dialer_session(test_uuid(101))->>'auto_dial_enabled')::boolean=true,'runtime mode is recorded');
DO $$BEGIN
 BEGIN PERFORM public.start_dialer_session(test_uuid(102)); RAISE EXCEPTION 'mismatch accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END$$;
RESET ROLE;
SELECT test_actor(21,2); SET LOCAL ROLE authenticated;
DO $$BEGIN
 BEGIN PERFORM public.start_dialer_session(test_uuid(101)); RAISE EXCEPTION 'foreign campaign accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.set_dialer_session_mode(current_setting('test.hotfix_session')::uuid,false); RAISE EXCEPTION 'foreign session changed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END$$;
RESET ROLE;
SELECT test_actor(11); SET LOCAL ROLE authenticated;
-- Real insert guard sets admission_required. A forged display flag cannot count a call.
INSERT INTO public.calls(id,organization_id,agent_id,campaign_id,campaign_lead_id,contact_phone,caller_id_used,status,direction,dialer_provider_admitted)
VALUES(test_uuid(901),test_uuid(1),test_uuid(11),test_uuid(101),test_uuid(301),'+15551234567','+15559990000','ringing','outbound',true);
SELECT test_assert((SELECT dialer_provider_admitted=false FROM public.calls WHERE id=test_uuid(901)),'forged provider flag ignored');
UPDATE public.calls SET dialer_provider_admitted=true WHERE id=test_uuid(901);
SELECT test_assert((SELECT dialer_provider_admitted=false FROM public.calls WHERE id=test_uuid(901)),'forged provider flag update ignored');
SELECT public.record_dialer_dispatch_failure(test_uuid(901),'not_sent');
SELECT test_assert((SELECT status='failed' AND duration=0 AND ended_at IS NULL AND dialer_dispatch_error='not_sent' FROM public.calls WHERE id=test_uuid(901)),'pre-connect failure has no invented duration');
INSERT INTO public.calls(id,organization_id,agent_id,campaign_id,campaign_lead_id,contact_phone,caller_id_used,status,direction)
VALUES(test_uuid(902),test_uuid(1),test_uuid(11),test_uuid(101),test_uuid(301),'+15551234567','+15559990000','ringing','outbound');
SELECT public.record_dialer_dispatch_failure(test_uuid(902),'unconfirmed');
SELECT test_assert((SELECT status='ringing' AND dialer_dispatch_error='unconfirmed' FROM public.calls WHERE id=test_uuid(902)),'ambiguous rejection retains uncertainty');
RESET ROLE;
UPDATE public.calls SET created_at=now()-interval '1 minute' WHERE id IN (test_uuid(901),test_uuid(902));
SET LOCAL ROLE service_role;
SELECT public.admit_twilio_outbound(test_uuid(902),'synthetic_agent_11','+15551234567','+15559990000','CA00000000000000000000000000000902');
RESET ROLE;
SELECT test_actor(11); SET LOCAL ROLE authenticated;
SELECT public.record_dialer_dispatch_failure(test_uuid(902),'not_sent');
SELECT test_assert((SELECT dialer_provider_admitted=true AND status='ringing' FROM public.calls WHERE id=test_uuid(902)),'late browser failure cannot overwrite signed admission');
SELECT test_assert((SELECT calls_made=2 FROM public.get_trusted_today_dialer_stats(test_uuid(101),now()-interval '1 day',now()+interval '1 second')),'legacy + admitted count, prepared failure excluded');
SELECT test_assert((SELECT calls_made=2 FROM public.get_trusted_today_dialer_stats_v2(test_uuid(101),now()-interval '1 day',now()+interval '1 second',(now()-interval '1 day')::date)),'v2 uses the same signed-call inclusion');
RESET ROLE;
INSERT INTO public.calls(id,organization_id,agent_id,campaign_id,campaign_lead_id,contact_phone,caller_id_used,status,direction,duration,dialer_admission_required)
VALUES(test_uuid(903),test_uuid(1),test_uuid(11),test_uuid(102),test_uuid(302),'+15551234567','+15559990000','ringing','outbound',100,true);
SELECT test_actor(11); SET LOCAL ROLE authenticated;
SELECT test_assert((SELECT contacted_leads=0 FROM public.get_campaign_card_stats(ARRAY[test_uuid(102)])),'campaign card excludes unadmitted facts');
RESET ROLE; SET LOCAL ROLE service_role;
SELECT public.admit_twilio_outbound(test_uuid(903),'synthetic_agent_11','+15551234567','+15559990000','CA00000000000000000000000000000903');
RESET ROLE; SELECT test_actor(11); SET LOCAL ROLE authenticated;
SELECT test_assert((SELECT contacted_leads=1 FROM public.get_campaign_card_stats(ARRAY[test_uuid(102)])),'campaign card counts signed admission');
SELECT test_actor(21,2);
DO $$BEGIN
 BEGIN PERFORM public.record_dialer_dispatch_failure(test_uuid(902),'not_sent');RAISE EXCEPTION 'foreign call accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
RESET ROLE;
ROLLBACK;
