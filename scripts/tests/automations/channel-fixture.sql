-- Explicit, disposable native provider test. The caller must choose this fixture on a fresh local database.
-- Use only with isolated dummy credentials and the loopback-only channel transport.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_setting('agentflow.synthetic_channels', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'This fixture requires an explicitly selected synthetic database.';
 END IF;
END $$;
CREATE FUNCTION pg_temp.cid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('aacc0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO public.organizations(id,name,slug) VALUES(pg_temp.cid(1),'Synthetic channel acceptance','synthetic-channel-acceptance');
INSERT INTO auth.users(id,email) VALUES(pg_temp.cid(2),'synthetic-sender@example.invalid');
INSERT INTO public.profiles(id,organization_id,role,status,email) VALUES
 (pg_temp.cid(2),pg_temp.cid(1),'Admin','Active','synthetic-sender@example.invalid')
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,role=excluded.role,status=excluded.status;
INSERT INTO public.phone_numbers(id,organization_id,phone_number,status,assignment_type,is_default,twilio_sid,daily_call_limit)
 VALUES(pg_temp.cid(3),pg_temp.cid(1),'+12025550141','active','agency',true,'PN000000000000000000000000000000a1',500);
INSERT INTO public.sms_agency_policies(organization_id,enforced,send_enabled,uv_profile_id,uv_project,sender_name,selected_phone_ids,active_from)
 VALUES(pg_temp.cid(1),true,true,pg_temp.cid(2),'jzdzeevjpootbeuniygx','Synthetic agency',ARRAY[pg_temp.cid(3)],now()-interval '1 hour');
INSERT INTO public.a2p_accounts(organization_id,account_sid,account_scope,primary_profile_sid,fee_version,fees,fees_valid_until,enabled,sms_enforced)
 VALUES(pg_temp.cid(1),'AC000000000000000000000000000000a1','master','BU000000000000000000000000000000a1','synthetic','[{"amount":0}]',now()+interval '1 day',true,true);
INSERT INTO public.a2p_registrations(organization_id,created_by,account_sid,brand_status,identity_status,campaign_status,messaging_service_sid,is_test,last_synced_at)
 VALUES(pg_temp.cid(1),pg_temp.cid(2),'AC000000000000000000000000000000a1','APPROVED','VERIFIED','VERIFIED','MG000000000000000000000000000000a1',false,now());
INSERT INTO public.a2p_numbers(organization_id,phone_number_id,phone_sid,messaging_service_sid,status,pool_member,checked_at)
 VALUES(pg_temp.cid(1),pg_temp.cid(3),'PN000000000000000000000000000000a1','MG000000000000000000000000000000a1','registered',true,now());
INSERT INTO private.contact_number_reconciliation(organization_id,complete) VALUES(pg_temp.cid(1),true);
SELECT public.set_contact_number_modes(pg_temp.cid(1),'enforced','enforced');
INSERT INTO private.automation_release_controls(organization_id,builder_visible,enrollment_enabled,dispatch_enabled) VALUES(pg_temp.cid(1),true,true,true);
INSERT INTO private.automation_channel_policies(organization_id,channel,daily_limit,local_start,local_end,reply_max_age,reply_checked_at,enabled)
 VALUES(pg_temp.cid(1),'sms',5,(clock_timestamp()-interval '1 hour')::time,(clock_timestamp()+interval '1 hour')::time,interval '1 hour',now(),true);
DO $$
DECLARE g jsonb:='{"format":1,"settings":{"reentry":"once","stop_on_reply":true},"nodes":[{"id":"start","type":"lead_created","version":1,"config":{}},{"id":"message","type":"send_sms","version":1,"config":{"body":"Fixture {{first_name}}","purpose":"informational"}}],"edges":[{"id":"next","source":"start","target":"message"}]}';
 n int; destination text; event_id_ bigint;
BEGIN
 INSERT INTO public.workflows(id,organization_id,name,status,trigger_type,automation_graph,automation_revision)
 VALUES(pg_temp.cid(4),pg_temp.cid(1),'Synthetic single action','active','manual',g,1);
 INSERT INTO public.workflow_versions(id,organization_id,workflow_id,name,revision,graph,published_at,published_by)
 VALUES(pg_temp.cid(5),pg_temp.cid(1),pg_temp.cid(4),'Synthetic single action',1,g,clock_timestamp(),pg_temp.cid(2));
 UPDATE public.workflows SET automation_version_id=pg_temp.cid(5) WHERE id=pg_temp.cid(4);
 FOR n IN 1..2 LOOP
   destination:='+1202555014'||(n+1);
   INSERT INTO public.leads(id,organization_id,first_name,phone,user_id) VALUES(pg_temp.cid(10+n),pg_temp.cid(1),'Alex',destination,pg_temp.cid(2));
   INSERT INTO private.automation_events(organization_id,event_type,source_id,source_revision,contact_id,occurred_at,processed_at)
    VALUES(pg_temp.cid(1),'lead_created',pg_temp.cid(10+n),1,pg_temp.cid(10+n),now(),now())
    ON CONFLICT(organization_id,event_type,source_id,source_revision) DO UPDATE SET processed_at=now() RETURNING id INTO event_id_;
   INSERT INTO private.automation_runs(id,organization_id,workflow_id,version_id,event_id,contact_id,contact_type,current_node_id,status,lease_token,leased_until)
    VALUES(pg_temp.cid(20+n),pg_temp.cid(1),pg_temp.cid(4),pg_temp.cid(5),event_id_,pg_temp.cid(10+n),'lead','message','queued',pg_temp.cid(30+n),now()+interval '1 hour');
   INSERT INTO private.automation_intents(organization_id,run_id,node_id,status) VALUES(pg_temp.cid(1),pg_temp.cid(20+n),'message','prepared');
   INSERT INTO private.automation_recipient_facts(organization_id,contact_id,contact_type,channel,destination,timezone_name,valid_until,evidence_reference)
    VALUES(pg_temp.cid(1),pg_temp.cid(10+n),'lead','sms',destination,'UTC',now()+interval '1 hour','Synthetic verified timezone');
   INSERT INTO public.sms_enrollments(organization_id,phone_e164,informational_confirmed) VALUES(pg_temp.cid(1),destination,true);
 END LOOP;
END $$;
COMMIT;
