-- Isolated synthetic fixture. Requires scripts/tests/phone-number-purchases/run.mjs.
SELECT public.phone_purchase_test_assert(
  (SELECT count(*)=0 FROM private.phone_number_setup_jobs), 'existing completed purchases are not backfilled');
SELECT public.phone_purchase_test_assert(
  public.phone_number_setup_managed('10000000-0000-4000-8000-000000000001','+12025550104')='{"managed":false}'::jsonb,
  'existing purchased number retains its legacy contract');
SELECT public.phone_purchase_test_assert(
  NOT has_table_privilege('authenticated','private.phone_number_setup_jobs','SELECT')
  AND NOT has_table_privilege('service_role','private.phone_number_setup_jobs','UPDATE')
  AND NOT has_table_privilege('anon','public.phone_number_setup_profiles','SELECT')
  AND NOT has_table_privilege('authenticated','public.phone_number_setup_profiles','INSERT')
  AND NOT has_table_privilege('service_role','public.phone_number_setup_profiles','UPDATE')
  AND NOT has_function_privilege('authenticated','public.phone_number_setup_claim()','EXECUTE')
  AND NOT has_function_privilege('anon','public.phone_number_setup_retry(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.phone_number_setup_managed(uuid,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.phone_number_setup_status(uuid,uuid[])','EXECUTE')
  AND NOT has_function_privilege('authenticated','private.select_purchased_sms_sender()','EXECUTE'),
  'worker, ledger and provider profile grants are confined to their roles');

CREATE FUNCTION public.setup_fixture_buy(p_number text,p_sid text,p_type text DEFAULT 'local',
  o uuid DEFAULT '10000000-0000-4000-8000-000000000001',a uuid DEFAULT '10000000-0000-4000-8000-000000000011')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  q uuid := (public.phone_purchase_test_quote(a,o,p_number,p_type)->>'id')::uuid; req uuid:=gen_random_uuid();
  done jsonb;
BEGIN
  PERFORM public.phone_number_purchase_claim(a,o,q,req);
  PERFORM public.phone_number_purchase_record(a,o,q,req,p_sid,'AC11111111111111111111111111111111',p_number);
  PERFORM public.phone_purchase_test_assert(NOT EXISTS (SELECT 1 FROM private.phone_number_setup_jobs WHERE purchase_id=q),
    'provider receipt alone cannot start number setup');
  done:=public.phone_number_purchase_complete(a,o,q,req);
  PERFORM public.phone_purchase_test_assert(public.phone_number_purchase_complete(a,o,q,req)->>'phone_number_id'=done->>'phone_number_id'
    AND (SELECT count(*)=2 FROM private.phone_number_setup_jobs WHERE purchase_id=q), 'completion replay produces two independent jobs exactly once');
  RETURN (done->>'phone_number_id')::uuid;
END $$;

SET request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000011","org_id":"10000000-0000-4000-8000-000000000001"}';
DO $$ DECLARE
  org uuid:='10000000-0000-4000-8000-000000000001'; other_org uuid:='20000000-0000-4000-8000-000000000001';
  admin uuid:='10000000-0000-4000-8000-000000000011';
  acc text:='AC11111111111111111111111111111111'; pn text:='PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
  svc text:='MGaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; profile text:='BUaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  num uuid:=public.setup_fixture_buy('+12025550130',pn); legacy uuid:=(SELECT id FROM public.phone_numbers WHERE phone_number='+12025550104');
  job record; old_lease uuid; paid uuid; tr record; snapshot uuid:=gen_random_uuid();
BEGIN
  PERFORM public.phone_purchase_test_assert((SELECT sms_state='waiting' AND trust_state='pending' FROM public.phone_number_setup_status(org,ARRAY[num])),
    'purchased new number waits independently for trust and agency A2P');
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_managed(other_org,'+12025550130')='{"managed":true,"owned":false}'::jsonb,
    'foreign legacy sender cannot bypass a managed purchase or see its binding');
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_managed(org,'+12025550130')=jsonb_build_object(
    'managed',true,'owned',true,'account_sid',acc,'phone_sid',pn,'phone_number_id',num::text,'agency_active',true,'policy_enforced',false,'policy_enabled',false,'policy_selected',false), 'purchased account and provider SID pinned');
  SELECT * INTO job FROM public.phone_number_setup_claim();
  paid:=job.purchase_id;
  PERFORM public.phone_purchase_test_assert(job.kind='sms' AND job.phone_sid=pn AND job.phone_number_id=num AND job.attempts=1,
    'worker receives exact bounded paid receipt from queue');
  old_lease:=job.lease_token;
  UPDATE private.phone_number_setup_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE purchase_id=paid AND kind='sms';
  SELECT * INTO job FROM public.phone_number_setup_claim();
  PERFORM public.phone_purchase_test_assert(job.kind='sms' AND job.attempts=2 AND job.lease_token<>old_lease
    AND NOT public.phone_number_setup_finish(paid,'sms',old_lease,'complete','submitted',30), 'expired claim is reclaimed and fences stale completion');
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_finish(paid,'sms',job.lease_token,'waiting','waiting_agency',30),
    'waiting agency schedules only setup retry');
  SELECT * INTO tr FROM public.phone_number_setup_claim();
  PERFORM public.phone_purchase_test_assert(tr.kind='trust' AND public.phone_number_setup_finish(paid,'trust',tr.lease_token,'complete','linked',0,profile),
    'trusted success reconciles local binding');
  PERFORM public.phone_purchase_test_assert((SELECT trust_hub_status='pending' FROM public.phone_numbers WHERE id=num)
    AND (SELECT trust_state='review' FROM public.phone_number_setup_status(org,ARRAY[num])), 'missing agency profile prevents trust success');
  INSERT INTO public.phone_settings(organization_id,trust_hub_profile_sid) VALUES(org,profile);
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_retry(org,num), 'admin can retry isolated setup');
  SELECT * INTO tr FROM public.phone_number_setup_claim();
  PERFORM public.phone_number_setup_finish(paid,'trust',tr.lease_token,'complete','linked',0,profile);
  PERFORM public.phone_purchase_test_assert((SELECT trust_hub_status='approved' FROM public.phone_numbers WHERE id=num)
    AND (SELECT trust_state='linked' FROM public.phone_number_setup_status(org,ARRAY[num])), 'exact approval marks Trust independently of SMS');

  UPDATE public.organizations SET status='suspended' WHERE id=org;
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_managed(org,'+12025550130')->'agency_active'='false'::jsonb,
    'suspended platform agency cannot send from a managed receipt');
  UPDATE public.organizations SET status='active' WHERE id=org;
  INSERT INTO public.a2p_accounts(organization_id,account_sid,account_scope,primary_profile_sid,enabled,sms_enforced,
    resources_reconciled_at,fee_version,fees,fees_valid_until)
  VALUES(org,acc,'master',profile,true,true,now(),'fixture','[{"label":"fixture","amount":"0"}]',now()-interval '2 days');
  INSERT INTO public.a2p_registrations(organization_id,created_by,account_sid,brand_status,identity_status,brand_sid,campaign_sid,
    campaign_status,messaging_service_sid,last_synced_at)
  VALUES(org,admin,acc,'APPROVED','VERIFIED','BNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','QEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','VERIFIED',svc,now());
  INSERT INTO public.a2p_registrations(organization_id,created_by,account_sid,messaging_service_sid,campaign_sid)
  VALUES(other_org,'20000000-0000-4000-8000-000000000011',acc,'MGbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','QEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  PERFORM public.phone_purchase_test_assert((SELECT count(*)=2 FROM public.a2p_registrations WHERE account_sid=acc AND campaign_sid='QEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    'two agencies on shared master can use identical Twilio QE on distinct services');
  PERFORM public.phone_purchase_test_error(format('UPDATE public.a2p_registrations SET messaging_service_sid=%L WHERE organization_id=%L',svc,other_org),'23505');
  INSERT INTO public.sms_agency_policies(organization_id,enforced,send_enabled,uv_profile_id,uv_project,sender_name,selected_phone_ids,active_from)
  VALUES(org,true,true,gen_random_uuid(),'jzdzeevjpootbeuniygx','Synthetic',ARRAY[legacy],now());
  UPDATE private.phone_number_setup_jobs SET next_at=clock_timestamp()-interval '1 second' WHERE purchase_id=paid AND kind='sms';
  SELECT * INTO job FROM public.phone_number_setup_claim();
  PERFORM public.phone_number_setup_finish(paid,'sms',job.lease_token,'complete','submitted',0);
  INSERT INTO public.a2p_numbers(organization_id,phone_number_id,phone_sid,messaging_service_sid,pool_member,checked_at)
  VALUES(org,num,pn,svc,true,now());
  PERFORM public.phone_purchase_test_assert((SELECT sms_state='registering' FROM public.phone_number_setup_status(org,ARRAY[num]))
    AND (SELECT selected_phone_ids=ARRAY[legacy] FROM public.sms_agency_policies WHERE organization_id=org),
    'approved campaign, successful attach and current pool membership never imply registered');
  UPDATE private.phone_number_setup_jobs SET submitted_at=now()-interval '25 hours' WHERE purchase_id=paid AND kind='sms';
  PERFORM public.phone_purchase_test_assert((SELECT sms_state='review' AND sms_code='confirmation_overdue' AND NOT can_retry
    FROM public.phone_number_setup_status(org,ARRAY[num])), 'late signed confirmation advises provider review without restarting enrollment');
  INSERT INTO public.a2p_event_inbox(account_sid,event_id,organization_id,event_type,event_at,payload)
  VALUES(acc,'setup-wrong-service',other_org,'com.twilio.messaging.compliance.number-registration.successful',now(),
    jsonb_build_object('phonenumbersid',pn,'messagingservicesid','MGbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'));
  PERFORM public.phone_purchase_test_error(format('SELECT public.process_a2p_number_event(%L,%L)',acc,'setup-wrong-service'),'P0001','number mapping not established');
  INSERT INTO public.a2p_event_inbox(account_sid,event_id,organization_id,event_type,event_at,payload)
  VALUES(acc,'setup-signed',org,'com.twilio.messaging.compliance.number-registration.successful',now(),
    jsonb_build_object('phonenumbersid',pn,'messagingservicesid',svc));
  PERFORM public.process_a2p_number_event(acc,'setup-signed');
  PERFORM public.process_a2p_number_event(acc,'setup-signed');
  PERFORM public.phone_purchase_test_assert((SELECT sms_state='ready' FROM public.phone_number_setup_status(org,ARRAY[num]))
    AND (SELECT selected_phone_ids=ARRAY[legacy,num] AND send_enabled FROM public.sms_agency_policies WHERE organization_id=org),
    'current exact signed registration selects new agency sender exactly once; replay has no additional effect');
  PERFORM public.phone_purchase_test_assert((public.phone_number_setup_managed(org,'+12025550130')->>'policy_selected')::boolean
    AND (public.phone_number_setup_managed(org,'+12025550130')->>'policy_enabled')::boolean
    AND (public.phone_number_setup_managed(org,'+12025550130')->>'policy_enforced')::boolean,
    'send-time receipt exposes exact agency consent selection after verified registration');
  UPDATE public.sms_agency_policies SET selected_phone_ids=ARRAY[legacy] WHERE organization_id=org;
  UPDATE public.a2p_numbers SET pool_member=true,checked_at=now() WHERE phone_number_id=num;
  PERFORM public.phone_purchase_test_assert((SELECT sms_state='review' AND sms_code='sender_not_selected' FROM public.phone_number_setup_status(org,ARRAY[num]))
    AND (SELECT selected_phone_ids=ARRAY[legacy] FROM public.sms_agency_policies WHERE organization_id=org),
    'subsequent reconciliation never restores deliberate removal');
  UPDATE public.sms_agency_policies SET selected_phone_ids=ARRAY[legacy,num],send_enabled=false WHERE organization_id=org;
  PERFORM public.phone_purchase_test_assert((SELECT sms_state='waiting' AND sms_code='policy_disabled' FROM public.phone_number_setup_status(org,ARRAY[num])),
    'disabled agency messaging never reports ready');
  UPDATE public.sms_agency_policies SET send_enabled=true WHERE organization_id=org;
  UPDATE public.a2p_registrations SET campaign_status='SUSPENDED' WHERE organization_id=org;
  PERFORM public.phone_purchase_test_assert((SELECT sms_state<>'ready' FROM public.phone_number_setup_status(org,ARRAY[num])), 'completed job respects later campaign suspension');
  UPDATE public.a2p_registrations SET campaign_status='VERIFIED',sync_token=snapshot WHERE organization_id=org;
  PERFORM public.commit_a2p_snapshot(org,snapshot,jsonb_build_object('brand_status','APPROVED','identity_status','VERIFIED',
    'campaign_status','VERIFIED','pool',jsonb_build_array(jsonb_build_object('phone_number_id',num,'pool_member',false))));
  PERFORM public.phone_purchase_test_assert((SELECT sms_state='review' AND sms_code='sender_removed' FROM public.phone_number_setup_status(org,ARRAY[num])),
    'current provider snapshot showing removed membership revokes readiness');
  UPDATE public.a2p_numbers SET pool_member=true,checked_at=now()-interval '2 days' WHERE phone_number_id=num;
  PERFORM public.phone_purchase_test_assert((SELECT sms_state='waiting' FROM public.phone_number_setup_status(org,ARRAY[num])),
    'stale membership cannot report ready');
  UPDATE public.phone_numbers SET status='inactive' WHERE id=num;
  PERFORM public.phone_purchase_test_assert((SELECT trust_state='inactive' AND sms_state='inactive' FROM public.phone_number_setup_status(org,ARRAY[num])),
    'released number loses display eligibility, purchase evidence retained');
  PERFORM public.phone_purchase_test_assert(public.phone_number_setup_legacy_workflow_sender(org) NOT IN ('+12025550130','+18005550100','+18885550100'),
    'legacy workflow can still select a legacy local agency sender');
END $$;

SET ROLE authenticated;
SET request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000012","org_id":"10000000-0000-4000-8000-000000000001"}';
SELECT public.phone_purchase_test_assert((SELECT count(*)=1 FROM public.phone_number_setup_status(
  '10000000-0000-4000-8000-000000000001',ARRAY[(SELECT id FROM public.phone_numbers WHERE phone_number='+12025550130')])),
  'staff in purchasing agency can read limited status');
SELECT public.phone_purchase_test_error($q$SELECT public.phone_number_setup_retry('10000000-0000-4000-8000-000000000001',gen_random_uuid())$q$,'42501','agency_admin_required');
SET request.jwt.claims='{"sub":"20000000-0000-4000-8000-000000000011","org_id":"10000000-0000-4000-8000-000000000001"}';
SELECT public.phone_purchase_test_error($q$SELECT * FROM public.phone_number_setup_status('10000000-0000-4000-8000-000000000001',ARRAY[]::uuid[])$q$,'42501','agency_access_required');
RESET ROLE;
SET request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000011","org_id":"10000000-0000-4000-8000-000000000001"}';

-- Test the downstream sticky public API contract independently of whether that release is installed on this branch.
CREATE FUNCTION public.sticky_number_guard(p_org uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('sms',coalesce(nullif(current_setting('test.sticky_sms',true),''),'off'));
$$;
-- Leave new, independent jobs for the native concurrent-claim assertion.
DO $$ DECLARE
  org uuid:='10000000-0000-4000-8000-000000000001';
  tf uuid:=public.setup_fixture_buy('+18885550130','PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2','toll_free');
  local_number uuid:=public.setup_fixture_buy('+12025550131','PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3');
  other_org uuid:='20000000-0000-4000-8000-000000000001';
  other_admin uuid:='20000000-0000-4000-8000-000000000011';
  other_num uuid:=public.setup_fixture_buy('+12025550132','PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4','local',other_org,other_admin);
  svc text:='MGbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; acc text:='AC11111111111111111111111111111111';
  pn text:='PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4';
BEGIN
  INSERT INTO public.a2p_accounts(organization_id,account_sid,account_scope,primary_profile_sid,enabled,sms_enforced,
    resources_reconciled_at,fee_version,fees,fees_valid_until)
  VALUES(other_org,acc,'master','BUbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',true,true,now(),'fixture','[{"label":"fee","amount":"0"}]',now());
  UPDATE public.a2p_registrations SET brand_status='APPROVED',identity_status='VERIFIED',brand_sid='BNbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',campaign_status='VERIFIED',
    last_synced_at=now() WHERE organization_id=other_org;
  INSERT INTO public.a2p_numbers(organization_id,phone_number_id,phone_sid,messaging_service_sid) VALUES(other_org,other_num,pn,svc);
  INSERT INTO public.a2p_event_inbox(account_sid,event_id,organization_id,event_type,event_at,payload)
  VALUES(acc,'second-org-signed',other_org,'com.twilio.messaging.compliance.number-registration.successful',now(),jsonb_build_object('phonenumbersid',pn,'messagingservicesid',svc));
  PERFORM public.process_a2p_number_event(acc,'second-org-signed');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_admin,'org_id',other_org)::text,true);
  PERFORM public.phone_purchase_test_assert((SELECT sms_state<>'ready' FROM public.phone_number_setup_status(other_org,ARRAY[other_num])),
    'signed registration before sender pool observation does not enable text');
  UPDATE public.a2p_numbers SET pool_member=true,checked_at=now() WHERE phone_number_id=other_num;
  PERFORM public.phone_purchase_test_assert((SELECT sms_state='waiting' AND sms_code='policy_required' FROM public.phone_number_setup_status(other_org,ARRAY[other_num])),
    'newly registered sender requires an active consent policy even outside sticky mode');
  PERFORM set_config('test.sticky_sms','guard_only',true);
  PERFORM public.phone_purchase_test_assert((SELECT sms_state='waiting' AND sms_code='policy_required'
    FROM public.phone_number_setup_status(other_org,ARRAY[other_num])), 'sticky guarded agency requires policy for readiness');
  INSERT INTO public.sms_agency_policies(organization_id,enforced,send_enabled,uv_profile_id,uv_project,sender_name,selected_phone_ids,active_from)
  VALUES(other_org,true,true,gen_random_uuid(),'jzdzeevjpootbeuniygx','Synthetic second org',ARRAY[other_num],now());
  UPDATE public.a2p_registrations SET operation_id=gen_random_uuid() WHERE organization_id=other_org;
  PERFORM public.phone_purchase_test_assert((SELECT sms_state='waiting' AND sms_code='registration_busy'
    FROM public.phone_number_setup_status(other_org,ARRAY[other_num])), 'sticky live agency operation temporarily blocks readiness');
  UPDATE public.a2p_registrations SET operation_id=NULL WHERE organization_id=other_org;
  UPDATE public.phone_numbers SET assignment_type='personal',assigned_to=other_admin WHERE id=other_num;
  PERFORM public.phone_purchase_test_assert((SELECT sms_state='review' AND sms_code='personal_number'
    FROM public.phone_number_setup_status(other_org,ARRAY[other_num])), 'consent policy sender selection requires an agency number');
  PERFORM set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000011","org_id":"10000000-0000-4000-8000-000000000001"}',true);
  PERFORM public.phone_purchase_test_assert((SELECT sms_state='toll_free' FROM public.phone_number_setup_status(org,ARRAY[tf])),
    '800/888 require toll-free verification even with an approved local campaign');
  PERFORM public.phone_purchase_test_assert((SELECT count(*)=3 FROM private.phone_number_purchase_operations
    WHERE phone_number IN ('+12025550130','+18885550130','+12025550131') AND state='completed'),
    'registration and recovery never create another purchase receipt');
END $$;
