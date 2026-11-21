-- Reuses synthetic scope and purchase functions from phone_number_setup.sql.
SELECT public.phone_purchase_test_assert(
  has_function_privilege('service_role','public.phone_number_setup_sms_intent(uuid,uuid,text,text,text,text,boolean)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.phone_number_setup_sms_intent(uuid,uuid,text,text,text,text,boolean)','EXECUTE')
  AND NOT has_function_privilege('anon','public.phone_number_setup_sms_intent(uuid,uuid,text,text,text,text,boolean)','EXECUTE'),
  'only the trusted worker may reserve a provider registration write');
DO $$ DECLARE
  org uuid:='10000000-0000-4000-8000-000000000001'; pn text:='PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaae1';
  svc text:='MGaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; bn text:='BNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  qe text:='QEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; token uuid:=gen_random_uuid(); paid uuid;
  num uuid:=public.setup_fixture_buy('+12025550139',pn);
BEGIN
  SELECT purchase_id INTO STRICT paid FROM private.phone_number_setup_jobs WHERE phone_number_id=num AND kind='sms';
  UPDATE private.phone_number_setup_jobs SET lease_token=token,lease_until=now()+interval '2 minutes'
    WHERE purchase_id=paid AND kind='sms';
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_sms_intent(paid,gen_random_uuid(),svc,bn,qe,'reserve',false)='busy',
    'different worker lease cannot authorize a provider write');
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_sms_intent(paid,token,'MGbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',bn,qe,'reserve',false)='conflict',
    'shared account and QE never authorize another agency service');
  UPDATE public.a2p_registrations SET operation_id=gen_random_uuid() WHERE organization_id=org;
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_sms_intent(paid,token,svc,bn,qe,'reserve',false)='busy',
    'automatic registration respects an independent manual operation');
  UPDATE public.a2p_registrations SET operation_id=NULL WHERE organization_id=org;
  UPDATE public.organizations SET status='suspended' WHERE id=org;
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_sms_intent(paid,token,svc,bn,qe,'reserve',false)='inactive',
    'late agency suspension blocks registration even when worker preflight passed');
  UPDATE public.organizations SET status='active' WHERE id=org;
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_sms_intent(paid,token,svc,bn,qe,'reserve',true)='capacity',
    'a sole proprietor cannot displace another sender even on stale provider membership');
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_sms_intent(paid,token,svc,bn,qe,'reserve',false)='post'
    AND (SELECT operation_id IS NULL FROM public.a2p_registrations WHERE organization_id=org), 'automatic enrollment cannot pause other agency senders');
  PERFORM public.phone_purchase_test_assert((SELECT status='pending_registration' AND event_at IS NULL AND NOT pool_member
    FROM public.a2p_numbers WHERE phone_number_id=num AND phone_sid=pn AND organization_id=org AND messaging_service_sid=svc),
    'exact event mapping precedes external write; registration and membership stay unconfirmed');
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_sms_intent(paid,token,svc,bn,qe,'reserve',false)='uncertain',
    'crash after a durable intent cannot repeat the external write');
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_sms_intent(paid,gen_random_uuid(),svc,bn,qe,'rejected',false)='busy',
    'a stale worker cannot release a different lease intent');
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_sms_intent(paid,token,svc,bn,qe,'rejected',false)='retry'
    , 'an explicit provider rejection can release this exact intent');
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_sms_intent(paid,token,svc,bn,qe,'reserve',false)='post',
    'after a definite rejection the original sender may retry');
  UPDATE private.phone_number_setup_jobs SET lease_token=gen_random_uuid() WHERE purchase_id=paid AND kind='sms' RETURNING lease_token INTO token;
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_sms_intent(paid,token,svc,bn,qe,'rejected',false)='busy'
    AND public.phone_number_setup_sms_intent(paid,token,svc,bn,qe,'reserve',false)='uncertain','replacement lease can only reconcile the prior attempt');
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_sms_intent(paid,token,svc,bn,qe,'member',false)='member',
    'verified target membership completes enrollment without reposting');
  UPDATE public.a2p_numbers SET status='failed',event_at=now() WHERE phone_number_id=num;
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_sms_intent(paid,token,svc,bn,qe,'member',false)='failed',
    'a signed negative status overrides sender-pool membership');
  UPDATE private.phone_number_setup_jobs SET state='complete',lease_token=NULL,lease_until=NULL WHERE purchase_id=paid;
END $$;
