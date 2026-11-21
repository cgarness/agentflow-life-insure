-- Isolated database only. All synthetic actors, templates, messages and event evidence roll back.
BEGIN;
CREATE FUNCTION pg_temp.mid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('aae10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
CREATE FUNCTION pg_temp.expect(ok boolean,explanation text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Automation message assertion: %',explanation; END IF; END $$;

INSERT INTO public.organizations(id,name) VALUES(pg_temp.mid(1),'Message test'),(pg_temp.mid(2),'Separate agency');
INSERT INTO auth.users(id,email) VALUES(pg_temp.mid(3),'message-fixture@example.invalid');
INSERT INTO public.profiles(id,organization_id,role,is_super_admin,status,email)
 VALUES(pg_temp.mid(3),pg_temp.mid(1),'Super Admin',true,'Active','message-fixture@example.invalid')
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,role=excluded.role,is_super_admin=true,status='Active';
UPDATE private.automation_session_cutover SET visibility_cutover_at=installed_at WHERE visibility_cutover_at IS NULL;
INSERT INTO auth.sessions(id,user_id,created_at)
 SELECT pg_temp.mid(12),pg_temp.mid(3),visibility_cutover_at - interval '1 second' FROM private.automation_session_cutover;
-- A previously recorded actor-mode revision must not carry this login across cutover.
WITH old_context AS (
 INSERT INTO private.automation_sessions(session_id,actor_id) VALUES(pg_temp.mid(12),pg_temp.mid(3)) RETURNING revision
)
SELECT set_config('test.automation_revision',revision::text,true) FROM old_context;
UPDATE public.profiles SET role='Admin',is_super_admin=false WHERE id=pg_temp.mid(3);
INSERT INTO auth.sessions(id,user_id,created_at)
 SELECT pg_temp.mid(4),pg_temp.mid(3),visibility_cutover_at + interval '1 second' FROM private.automation_session_cutover;
INSERT INTO private.automation_release_controls(organization_id,builder_visible) VALUES(pg_temp.mid(1),true);
INSERT INTO public.message_templates(id,organization_id,name,type,scope,content,sms_purpose)
 SELECT pg_temp.mid(100+n),pg_temp.mid(1),'Item '||lpad(n::text,2,'0'),'sms','agency','Hello {{first_name}}','marketing'
 FROM generate_series(1,51) n;
INSERT INTO public.message_templates(id,organization_id,name,type,scope,content)
 VALUES(pg_temp.mid(190),pg_temp.mid(1),'Manual','sms','agency','Hi {{agent_first_name}}'),
 (pg_temp.mid(191),pg_temp.mid(2),'Foreign','sms','agency','Hi');
SELECT set_config('request.jwt.claim.sub',pg_temp.mid(3)::text,true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.mid(3),'role','authenticated','session_id',pg_temp.mid(4),
  'app_metadata',jsonb_build_object('organization_id',pg_temp.mid(1),'role','Admin'))::text,true);
SET LOCAL ROLE authenticated;
SELECT public.automation_session_context();
DO $$
DECLARE page jsonb;
BEGIN
 page:=public.automation_channel_options('',0,NULL,NULL,'sms');
 PERFORM pg_temp.expect(jsonb_array_length(page->'templates')=50 AND (page->>'moreTemplates')::boolean,'bounded first page');
 page:=public.automation_channel_options('',50,NULL,NULL,'sms');
 PERFORM pg_temp.expect(jsonb_array_length(page->'templates')=1 AND NOT (page->>'moreTemplates')::boolean,'reachable final template');
 page:=public.automation_channel_options('',0,NULL,pg_temp.mid(151),'sms');
 PERFORM pg_temp.expect(page#>>'{templates,0,id}'=pg_temp.mid(151)::text,'off-page saved template resolves');
 PERFORM pg_temp.expect(public.automation_channel_options('',0,NULL,pg_temp.mid(190),'sms')->'templates'='[]','manual tokens hidden');
 PERFORM pg_temp.expect(public.automation_channel_options('',0,NULL,pg_temp.mid(191),'sms')->'templates'='[]','other tenant hidden');
END $$;
RESET ROLE;
DO $$
DECLARE n jsonb:=jsonb_build_object('type','send_sms','config',jsonb_build_object('body','Edited clean copy','purpose','informational','template_id',pg_temp.mid(101)));
BEGIN
 PERFORM pg_temp.expect(private.automation_channel_issue(pg_temp.mid(1),pg_temp.mid(3),n) IS NOT NULL,'marketing purpose cannot be downgraded');
 n:=jsonb_set(n,'{config,purpose}','"marketing"'::jsonb);
 PERFORM pg_temp.expect(private.automation_channel_issue(pg_temp.mid(1),pg_temp.mid(3),n) IS NULL,'approved marketing selection');
 n:=jsonb_set(n,'{config,template_id}',to_jsonb(pg_temp.mid(190)));
 PERFORM pg_temp.expect(private.automation_channel_issue(pg_temp.mid(1),pg_temp.mid(3),n) IS NOT NULL,'edited body cannot override manual-only source');
END $$;

INSERT INTO public.user_email_connections(id,organization_id,user_id,provider,provider_account_email,access_token_encrypted,status,last_sync_at)
 VALUES(pg_temp.mid(5),pg_temp.mid(1),pg_temp.mid(3),'google','inbox@example.invalid','fixture-only','connected',now());
INSERT INTO private.automation_email_senders(id,organization_id,connection_id,from_email,verified_until,verification_reference,enabled)
 VALUES(pg_temp.mid(6),pg_temp.mid(1),pg_temp.mid(5),'sender@example.invalid',now()+interval '1 day','fixture receipt',true);
DO $$ BEGIN
 BEGIN
  UPDATE private.automation_email_senders SET from_email='changed@example.invalid' WHERE id=pg_temp.mid(6);
  RAISE EXCEPTION 'Identity change was accepted' USING ERRCODE='22023';
 EXCEPTION WHEN raise_exception THEN NULL; END;
END $$;
INSERT INTO public.leads(id,organization_id,email) VALUES(pg_temp.mid(7),pg_temp.mid(1),'recipient@example.invalid');
INSERT INTO private.automation_messages(id,organization_id,run_id,node_id,contact_id,contact_type,channel,recipient,sender,connection_id,owner_id,reply_to,body)
 VALUES(pg_temp.mid(8),pg_temp.mid(1),pg_temp.mid(9),'email',pg_temp.mid(7),'lead','email','recipient@example.invalid','sender@example.invalid',
        pg_temp.mid(5),pg_temp.mid(3),'inbox@example.invalid','Fixture');
SELECT pg_temp.expect(public.automation_email_receipt_scope(pg_temp.mid(8),'provider-fixture','sender@example.invalid','other@example.invalid') IS NULL,'mismatched recipient');
SELECT pg_temp.expect(public.automation_email_receipt_scope(pg_temp.mid(8),'provider-fixture','sender@example.invalid','recipient@example.invalid')->>'id'=pg_temp.mid(8)::text,'matched provider callback');
SELECT public.automation_unsubscribe((SELECT unsubscribe_token FROM private.automation_messages WHERE id=pg_temp.mid(8)));
SELECT pg_temp.expect(EXISTS(SELECT FROM private.automation_email_suppressions WHERE organization_id=pg_temp.mid(1) AND address='recipient@example.invalid' AND reason='unsubscribe'),'contact unsubscribe recorded');
DO $$ DECLARE e public.contact_emails;
BEGIN
 e.organization_id:=pg_temp.mid(1); e.contact_id:=pg_temp.mid(7); e.connection_id:=pg_temp.mid(5); e.provider:='google';
 e.direction:='inbound'; e.from_email:='recipient@example.invalid'; e.received_at:=clock_timestamp(); e.external_message_id:='synthetic-inbound';
 e.in_reply_to:='<'||pg_temp.mid(8)||'@sender.invalid>'; e.to_emails:='["inbox@example.invalid"]';
 PERFORM private.automation_process_email_reply(e);
 PERFORM pg_temp.expect(NOT EXISTS(SELECT FROM private.automation_inbound_events WHERE organization_id=e.organization_id),'wrong thread ignored');
 e.in_reply_to:='<'||pg_temp.mid(8)||'@example.invalid>';
 e.to_emails:='["different@example.invalid"]'; PERFORM private.automation_process_email_reply(e);
 PERFORM pg_temp.expect(NOT EXISTS(SELECT FROM private.automation_inbound_events WHERE organization_id=e.organization_id),'wrong mailbox ignored');
 e.to_emails:='["inbox@example.invalid"]'; PERFORM private.automation_process_email_reply(e); PERFORM private.automation_process_email_reply(e);
 PERFORM pg_temp.expect((SELECT count(*)=1 FROM private.automation_inbound_events WHERE organization_id=e.organization_id AND event_key=e.external_message_id),'one verified typed reply');
END $$;

-- A fresh login sees eligible history for both channels. The same user's older
-- login still gets human history, even after demotion removed the Super Admin flag.
INSERT INTO private.automation_messages(id,organization_id,run_id,node_id,contact_id,contact_type,channel,recipient,sender,owner_id,body)
 VALUES(pg_temp.mid(10),pg_temp.mid(1),pg_temp.mid(9),'sms',pg_temp.mid(7),'lead','sms','+12025550101','+12025550102',pg_temp.mid(3),'Fixture');
INSERT INTO public.messages(organization_id,contact_id,contact_type,direction,body,from_number,to_number,created_by,automation_message_id)
 SELECT pg_temp.mid(1),pg_temp.mid(7),'lead','outbound','Fixture','+12025550102','+12025550101',pg_temp.mid(3),message_id
 FROM (VALUES(NULL::uuid),(pg_temp.mid(10))) copies(message_id);
INSERT INTO public.contact_emails(organization_id,contact_id,owner_user_id,connection_id,provider,direction,external_message_id,from_email,automation_message_id)
 SELECT pg_temp.mid(1),pg_temp.mid(7),pg_temp.mid(3),pg_temp.mid(5),provider,'outbound','synthetic-'||provider,'sender@example.invalid',message_id
 FROM (VALUES('google',NULL::uuid),('resend',pg_temp.mid(8))) copies(provider,message_id);
CREATE FUNCTION pg_temp.check_conversations(expected_automations integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.expect((SELECT count(*) FILTER (WHERE automation_message_id IS NULL)=1 AND count(automation_message_id)=expected_automations
                         FROM public.messages WHERE contact_id=pg_temp.mid(7)), 'SMS Conversations visibility');
 PERFORM pg_temp.expect((SELECT count(*) FILTER (WHERE automation_message_id IS NULL)=1 AND count(automation_message_id)=expected_automations
                         FROM public.contact_emails WHERE contact_id=pg_temp.mid(7)), 'email Conversations visibility');
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_conversations(1);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.mid(3),'role','authenticated','session_id',pg_temp.mid(12),
 'app_metadata',jsonb_build_object('organization_id',pg_temp.mid(1),'role','Super Admin'))::text,true);
SELECT pg_temp.check_conversations(0);
DO $$
DECLARE denied_hint text;
BEGIN
 BEGIN
  PERFORM public.automation_access();
  RAISE EXCEPTION 'Fenced login could read authoring access';
 EXCEPTION WHEN insufficient_privilege THEN
  GET STACKED DIAGNOSTICS denied_hint=PG_EXCEPTION_HINT;
  PERFORM pg_temp.expect(denied_hint='automation_session_reauth','access refused for cutover');
 END;
 BEGIN
  PERFORM public.save_automation_draft(pg_temp.mid(11),'Synthetic cutover test',
    '{"format":1,"nodes":[],"edges":[],"settings":{"reentry":"once","stop_on_reply":false}}',
    0,current_setting('test.automation_revision')::bigint);
  RAISE EXCEPTION 'Fenced login could save with its original authoring revision';
 EXCEPTION WHEN insufficient_privilege THEN
  GET STACKED DIAGNOSTICS denied_hint=PG_EXCEPTION_HINT;
  PERFORM pg_temp.expect(denied_hint='automation_session_reauth','draft refused for cutover');
 END;
END $$;
RESET ROLE;
SELECT pg_temp.expect(NOT EXISTS(SELECT FROM public.workflows WHERE id=pg_temp.mid(11)),'fenced authoring created no draft');
ROLLBACK;
