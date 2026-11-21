-- Destructive-test scope: an empty disposable database copied from the isolated release candidate.
-- The CRM insert commits so the next transaction sees exactly what the production intake hook captured.
-- No provider, external API, or active scheduler is used. All synthetic rows remain in the disposable DB.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'automation_release_channel_test' THEN
    RAISE EXCEPTION 'Use a dedicated disposable automation_release_channel_test database';
  END IF;
  IF EXISTS (SELECT FROM private.automation_runs) OR EXISTS (SELECT FROM private.automation_events) THEN
    RAISE EXCEPTION 'The isolated worker queue must be empty';
  END IF;
END $$;
CREATE FUNCTION pg_temp.cid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('ea110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
CREATE FUNCTION pg_temp.expect(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Failed: %',label; END IF;
  RAISE NOTICE 'PASS %',label;
END $$;
INSERT INTO public.organizations(id,name) VALUES(pg_temp.cid(1),'Synthetic lead intake agency');
INSERT INTO auth.users(id,email) VALUES(pg_temp.cid(2),'eligibility-admin@example.invalid');
INSERT INTO public.profiles(id,organization_id,role,status,email)
  VALUES(pg_temp.cid(2),pg_temp.cid(1),'Admin','Active','eligibility-admin@example.invalid')
  ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,role='Admin',status='Active';
UPDATE private.automation_session_cutover SET visibility_cutover_at=installed_at WHERE visibility_cutover_at IS NULL;
INSERT INTO auth.sessions(id,user_id,created_at) VALUES(pg_temp.cid(3),pg_temp.cid(2),clock_timestamp());
INSERT INTO private.automation_release_controls(organization_id,builder_visible,enrollment_enabled,dispatch_enabled)
  VALUES(pg_temp.cid(1),true,true,true);
-- A healthy ordinary agency mailbox provides a possible Reply-To. It cannot verify an agency Resend From.
INSERT INTO public.user_email_connections(id,organization_id,user_id,provider,provider_account_email,access_token_encrypted,status,last_sync_at)
  VALUES(pg_temp.cid(20),pg_temp.cid(1),pg_temp.cid(2),'google','eligibility-inbox@example.invalid','fixture-only','connected',now());
CREATE FUNCTION pg_temp.graph(kind text,cfg jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('format',1,'settings','{"reentry":"once","stop_on_reply":true}'::jsonb,
    'nodes',jsonb_build_array(
      jsonb_build_object('type','lead_created','version',1,'id',pg_temp.cid(4),'config','{}'::jsonb),
      jsonb_build_object('type',kind,'version',1,'id',pg_temp.cid(5),'config',cfg)),
    'edges',jsonb_build_array(jsonb_build_object('id',pg_temp.cid(6),'source',pg_temp.cid(4),'target',pg_temp.cid(5))))
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',pg_temp.cid(2)::text,true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cid(2),'role','authenticated',
  'session_id',pg_temp.cid(3),'app_metadata',jsonb_build_object('organization_id',pg_temp.cid(1)))::text,true);
DO $$
DECLARE rev bigint:=(public.automation_session_context()->>'revision')::bigint; issues jsonb;
BEGIN
  PERFORM public.save_automation_draft(pg_temp.cid(7),'Synthetic SMS',pg_temp.graph('send_sms','{"purpose":"informational","body":"Fixture"}'),0,rev);
  PERFORM public.publish_automation(pg_temp.cid(7),1,rev,'{"enrollment_enabled":true,"dispatch_enabled":true}');
  PERFORM public.save_automation_draft(pg_temp.cid(8),'Synthetic email',pg_temp.graph('send_email',
    jsonb_build_object('subject','Fixture','body','Fixture','sender_id',pg_temp.cid(20))),0,rev);
  issues:=public.validate_automation_draft(pg_temp.cid(8));
  PERFORM pg_temp.expect(issues @> '[{"message":"Choose a verified agency sender with a connected reply inbox."}]',
    'ordinary connected Google mailbox ID fails workflow sender validation');
  PERFORM pg_temp.expect(public.automation_channel_options()->'senders'='[]'::jsonb,'no verified workflow sender appears');
END $$;
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',pg_temp.cid(2)::text,true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cid(2),'role','authenticated',
  'session_id',pg_temp.cid(3),'app_metadata',jsonb_build_object('organization_id',pg_temp.cid(1)))::text,true);
-- Same public.leads insert boundary as manual CRM creation and imports.
INSERT INTO public.leads(id,organization_id,user_id,first_name,phone,email,state,lead_source)
  VALUES(pg_temp.cid(9),pg_temp.cid(1),pg_temp.cid(2),'Synthetic','+12025550195','new-lead@example.invalid','TN','Synthetic intake');
COMMIT;

BEGIN;
SELECT pg_temp.expect((SELECT count(*)=1 FROM private.automation_events WHERE organization_id=pg_temp.cid(1)
  AND contact_id=pg_temp.cid(9) AND event_type='lead_created'),'committed lead creates exactly one scoped source event');
SELECT pg_temp.expect(NOT EXISTS (SELECT FROM private.automation_recipient_facts WHERE organization_id=pg_temp.cid(1)),
  'CRM intake writes zero verified timezone or contact email permission records');
SELECT pg_temp.expect(NOT EXISTS (SELECT FROM public.sms_enrollments WHERE organization_id=pg_temp.cid(1)),
  'a new lead alone carries no purpose-specific SMS permission');
SELECT pg_temp.expect(NOT EXISTS (SELECT FROM private.automation_channel_policies WHERE organization_id=pg_temp.cid(1)),
  'new lead does not create a sending policy or verify reply-feed freshness');
SELECT pg_temp.expect(public.automation_process_events(10)=1,'published SMS workflow admits the matching committed lead');
CREATE TEMP TABLE proof_claim AS SELECT c item FROM public.automation_claim_work(1) AS c;
CREATE FUNCTION pg_temp.check_hold(expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c jsonb; actual text;
BEGIN
  SELECT item INTO STRICT c FROM proof_claim;
  BEGIN
    PERFORM public.automation_begin_message((c->>'run_id')::uuid,(c->>'lease_token')::uuid,c->>'node_id','sms','+12025550195',
      NULL,'Fixture',NULL,'+12025550196');
  EXCEPTION WHEN raise_exception THEN actual:=SQLERRM;
  END;
  PERFORM pg_temp.expect(actual=expected,'native handoff refused: '||coalesce(actual,'no hold'));
END $$;
SELECT pg_temp.check_hold('Agency sending limits and local sending hours require verification.');
-- Supply only agency-level static settings. No lead facts or affirmative feed-health observations are inserted.
INSERT INTO private.automation_channel_policies(organization_id,channel,daily_limit,local_start,local_end,reply_max_age,enabled)
  VALUES(pg_temp.cid(1),'sms',5,'08:00','19:00',interval '30 minutes',true);
SELECT pg_temp.check_hold('Current recipient eligibility or verified timezone is missing.');

-- Present a trusted synthetic evidence payload to the same database ingress used by the signed SMS bridge.
-- The test exercises its DB contract. It does not call the Underwriter Verified service or certify live availability.
INSERT INTO public.sms_agency_policies(organization_id,enforced,uv_profile_id,uv_project,sender_name,active_from)
  VALUES(pg_temp.cid(1),true,pg_temp.cid(2),'jzdzeevjpootbeuniygx','Synthetic intake',now()-interval '1 hour');
SELECT public.sms_ingest_consent(pg_temp.cid(1),pg_temp.cid(2),pg_temp.cid(13),'+12025550195',jsonb_build_array(
  jsonb_build_object('id',pg_temp.cid(14),'purpose','informational','choice','granted','version','fixture','created_at',now()),
  jsonb_build_object('id',pg_temp.cid(15),'purpose','marketing','choice','not_granted','version','fixture','created_at',now())), 'fixture-hash');
SELECT pg_temp.expect(EXISTS (SELECT FROM public.sms_enrollments WHERE organization_id=pg_temp.cid(1) AND phone_e164='+12025550195'
  AND informational_event=pg_temp.cid(14) AND NOT informational_confirmed AND marketing_event IS NULL),
  'signed-bridge SQL ingress records informational evidence; separate confirmation is still pending');
SELECT pg_temp.expect((SELECT count(*)=1 FROM public.sms_confirmation_jobs WHERE organization_id=pg_temp.cid(1) AND state='pending'),
  'one synthetic confirmation job is queued and its worker is never invoked');
SELECT pg_temp.expect(NOT EXISTS (SELECT FROM private.automation_recipient_facts WHERE organization_id=pg_temp.cid(1)),
  'SMS choice and CRM state still supply zero authoritative Automation recipient records');
SELECT pg_temp.expect(NOT EXISTS (SELECT FROM private.automation_channel_policies WHERE organization_id=pg_temp.cid(1) AND reply_checked_at IS NOT NULL),
  'neither the CRM event, connected mailbox nor SMS ingress advances verified feed health');
SELECT pg_temp.check_hold('Current recipient eligibility or verified timezone is missing.');
SELECT pg_temp.expect(NOT EXISTS (SELECT FROM private.automation_messages WHERE organization_id=pg_temp.cid(1))
  AND NOT EXISTS (SELECT FROM public.sms_dispatches WHERE organization_id=pg_temp.cid(1))
  AND NOT EXISTS (SELECT FROM public.contact_emails WHERE organization_id=pg_temp.cid(1))
  AND NOT EXISTS (SELECT FROM private.automation_intents WHERE organization_id=pg_temp.cid(1) AND status<>'prepared'),
  'zero provider handoffs, dispatch ledger rows, receipts or projected email history');
ROLLBACK;
