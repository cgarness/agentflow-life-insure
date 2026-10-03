-- Runs against the isolated minimal dependency schema in scripts/test-a2p-db.mjs.
-- Complements, and does not substitute for, the approved Supabase staging release check.
create function public.a2p_assert(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',msg; end if; end $$;
insert into organizations values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into profiles(id,organization_id,status,role,email_notifications_enabled) values
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Active','Admin',true),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','Active','Super Admin',true),
('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Active','Agent',true),
('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','Inactive','Admin',true),
('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','Active','Admin',false);
insert into a2p_registrations(organization_id,created_by,account_sid,messaging_service_sid) values
('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','AC11111111111111111111111111111111','MG11111111111111111111111111111111'),
('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','AC22222222222222222222222222222222','MG22222222222222222222222222222222');
insert into phone_numbers values('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
insert into a2p_numbers(organization_id,phone_number_id,phone_sid,messaging_service_sid) values
('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','PN11111111111111111111111111111111','MG11111111111111111111111111111111');
select a2p_assert((select count(*)=6 from pg_class where relname like 'a2p_%' and relkind='r' and relrowsecurity),'all six tables have RLS');
select a2p_assert(not has_table_privilege('anon','a2p_registrations','SELECT'),'anonymous access denied');
select a2p_assert(not has_table_privilege('authenticated','a2p_accounts','SELECT'),'account mappings private');
select a2p_assert(not has_table_privilege('authenticated','a2p_registrations','UPDATE'),'client status writes denied');
select a2p_assert(not has_table_privilege('authenticated','a2p_event_inbox','INSERT'),'event forgery denied');
select a2p_assert(not has_function_privilege('authenticated','commit_a2p_snapshot(uuid,uuid,jsonb)','EXECUTE'),'snapshot RPC private');
select a2p_assert(not has_function_privilege('anon','process_a2p_number_event(text,text)','EXECUTE'),'number RPC private');
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
select a2p_assert((select count(*)=1 from a2p_registrations),'admin sees own agency only');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
select a2p_assert((select count(*)=0 from a2p_numbers),'other admin cannot see first agency number');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
select a2p_assert((select count(*)=0 from a2p_registrations),'agent cannot see registration');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',false);
select a2p_assert((select count(*)=0 from a2p_registrations),'inactive admin cannot see registration');
reset role;
set role service_role;
update a2p_registrations set sync_token='30000000-0000-0000-0000-000000000001' where organization_id='00000000-0000-0000-0000-000000000001';
select a2p_assert(not commit_a2p_snapshot('00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','{}'),'stale sync refused');
select a2p_assert(commit_a2p_snapshot('00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','{"brand_status":"APPROVED","identity_status":"VERIFIED","campaign_status":"VERIFIED","brand_errors":[],"campaign_errors":[],"pool":[{"phone_number_id":"20000000-0000-0000-0000-000000000001","pool_member":true}]}'),'current snapshot committed');
select a2p_assert((select count(*)=2 from notifications),'active admin notifications only');
select a2p_assert((select count(*)=1 from a2p_email_outbox),'email preference respected');
select a2p_assert((select status='pending_registration' and pool_member from a2p_numbers),'campaign plus membership does not imply number registration');
update a2p_registrations set sync_token='30000000-0000-0000-0000-000000000001' where organization_id='00000000-0000-0000-0000-000000000001';
select commit_a2p_snapshot('00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','{"brand_status":"APPROVED","identity_status":"VERIFIED","campaign_status":"VERIFIED","brand_errors":[],"campaign_errors":[]}');
select a2p_assert((select count(*)=2 from notifications),'same status does not notify twice');
insert into a2p_event_inbox(account_sid,event_id,organization_id,event_type,event_at,payload) values
('AC11111111111111111111111111111111','success','00000000-0000-0000-0000-000000000001','com.twilio.messaging.compliance.number-registration.successful','2026-01-02','{"phonenumbersid":"PN11111111111111111111111111111111","messagingservicesid":"MG11111111111111111111111111111111"}'),
('AC11111111111111111111111111111111','old','00000000-0000-0000-0000-000000000001','com.twilio.messaging.compliance.number-registration.pending','2026-01-01','{"phonenumbersid":"PN11111111111111111111111111111111","messagingservicesid":"MG11111111111111111111111111111111"}'),
('AC11111111111111111111111111111111','removed','00000000-0000-0000-0000-000000000001','com.twilio.messaging.compliance.number-deregistration.successful','2026-01-03','{"phonenumbersid":"PN11111111111111111111111111111111","messagingservicesid":"MG11111111111111111111111111111111"}');
select process_a2p_number_event('AC11111111111111111111111111111111','success');
select process_a2p_number_event('AC11111111111111111111111111111111','success');
select process_a2p_number_event('AC11111111111111111111111111111111','old');
select a2p_assert((select status='registered' from a2p_numbers),'out-of-order event does not regress registered status');
select a2p_assert((select count(*)=4 from notifications),'event replay does not duplicate notifications');
select process_a2p_number_event('AC11111111111111111111111111111111','removed');
select a2p_assert((select status='unregistered' from a2p_numbers),'new deregistration disables sender');
insert into a2p_event_inbox(account_sid,event_id,organization_id,event_type,event_at,payload) values
('AC22222222222222222222222222222222','cross-tenant','00000000-0000-0000-0000-000000000002','com.twilio.messaging.compliance.number-registration.successful','2026-01-04','{"phonenumbersid":"PN11111111111111111111111111111111","messagingservicesid":"MG11111111111111111111111111111111"}');
do $$ begin
 begin perform process_a2p_number_event('AC22222222222222222222222222222222','cross-tenant'); raise exception 'cross-tenant mapping was accepted';
 exception when others then if sqlerrm <> 'number mapping not established' then raise; end if; end;
end $$;
select a2p_assert((select status='unregistered' from a2p_numbers),'foreign event cannot enable number');
reset role;

-- Existing administrator number removal must not be blocked by an A2P mapping.
set role service_role;
delete from phone_numbers where id='20000000-0000-0000-0000-000000000001';
select a2p_assert((select count(*)=0 from a2p_numbers),'phone deletion removes only its readiness mapping');
select a2p_assert((select count(*)>0 from a2p_history),'phone deletion preserves registration audit history');
reset role;
