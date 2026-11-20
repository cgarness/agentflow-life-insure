-- Synthetic, local only. No provider credentials. Reserved example phone numbers.
INSERT INTO public.organizations(id,name,slug) VALUES
 ('10000000-0000-4000-8000-000000000001','Sticky Test A','sticky-test-a'),
 ('10000000-0000-4000-8000-000000000002','Sticky Test B','sticky-test-b');
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('20000000-0000-4000-8000-000000000001','admin-a@example.invalid','{"organization_id":"10000000-0000-4000-8000-000000000001","role":"Admin","first_name":"Synthetic"}'),
 ('20000000-0000-4000-8000-000000000002','agent-a@example.invalid','{"organization_id":"10000000-0000-4000-8000-000000000001","role":"Agent","first_name":"Synthetic"}'),
 ('20000000-0000-4000-8000-000000000003','peer-a@example.invalid','{"organization_id":"10000000-0000-4000-8000-000000000001","role":"Agent","first_name":"Synthetic"}'),
 ('20000000-0000-4000-8000-000000000004','admin-b@example.invalid','{"organization_id":"10000000-0000-4000-8000-000000000002","role":"Admin","first_name":"Synthetic"}');
UPDATE public.profiles SET twilio_client_identity='sticky_'||replace(id::text,'-','');
INSERT INTO public.leads(id,organization_id,first_name,last_name,phone,user_id,assigned_agent_id,status) VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic','Lead','+12025550101','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','New'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Hidden','Lead','+12025550102','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','New'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','Foreign','Lead','+12025550103','20000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004','New');
INSERT INTO public.phone_numbers(id,organization_id,phone_number,status,assignment_type,is_default,twilio_sid,daily_call_limit) VALUES
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','+12025551111','active','agency',true,'PN00000000000000000000000000000001',100000),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','+12025552222','active','agency',false,'PN00000000000000000000000000000002',100000);
INSERT INTO public.sms_agency_policies(organization_id,enforced,send_enabled,uv_profile_id,uv_project,sender_name,selected_phone_ids,active_from)
 VALUES('10000000-0000-4000-8000-000000000001',true,true,'20000000-0000-4000-8000-000000000001','jzdzeevjpootbeuniygx','Synthetic',ARRAY['40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002']::uuid[],now());
INSERT INTO public.a2p_accounts(organization_id,account_sid,account_scope,primary_profile_sid,fee_version,fees,fees_valid_until,enabled,sms_enforced)
 VALUES('10000000-0000-4000-8000-000000000001','AC00000000000000000000000000000001','master','BU00000000000000000000000000000001','synthetic','[{"amount":0}]',now()+interval '1 day',true,true);
INSERT INTO public.a2p_registrations(organization_id,created_by,account_sid,brand_status,identity_status,campaign_status,messaging_service_sid,is_test,last_synced_at)
 VALUES('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','AC00000000000000000000000000000001','APPROVED','VERIFIED','VERIFIED','MG00000000000000000000000000000001',false,now());
INSERT INTO public.a2p_numbers(organization_id,phone_number_id,phone_sid,messaging_service_sid,status,pool_member,checked_at)
 SELECT organization_id,id,twilio_sid,'MG00000000000000000000000000000001','registered',true,now() FROM public.phone_numbers;
INSERT INTO private.contact_number_reconciliation(organization_id,complete) VALUES('10000000-0000-4000-8000-000000000001',true);
SELECT public.set_contact_number_modes('10000000-0000-4000-8000-000000000001','enforced','enforced');
INSERT INTO public.dispositions(id,organization_id,name,affinity_class) VALUES
 ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic conversation','duration'),
 ('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Synthetic callback','confirmed'),
 ('60000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Synthetic no answer','excluded');
